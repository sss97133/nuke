// A reader's classification (the owner's subscription worker ran the orchestrator's checklist) is validated exactly like a
// provider answer: good JSON becomes a classification, bad JSON is classifier_response_invalid, never a thrown error.
import { __setGuardDb, allowAllGuardDb } from '../_shared/geminiGuard.ts';
__setGuardDb(allowAllGuardDb());
import { classificationFromParsed, classificationFromReader, renderPromptV2, SCHEMA_MANIFEST } from './classifierProvider.ts';
import type { ClassifierReceipt } from './classifierTypes.ts';

function assert(value: unknown, message = 'assertion failed'): asserts value { if (!value) throw new Error(message); }
const receipt = (): ClassifierReceipt => ({ model: 'reader:test', attempts: 1, token_count_attempts: 0, timing_ms: { image_download: 0, token_count: 0, generation: 0, total: 0 } });
const good = { image_type: 'receipt_document', image_medium: 'photograph', confidence: 0.91, is_automotive: false,
  description: 'A photographed parts invoice', detected_text: ['INVOICE', '15676063'], vehicle_hints: { make: 'Pontiac', model: 'Firebird', year_range: '', color: null } };

Deno.test('a valid reader answer becomes a classification with the legacy fields and a receipt', () => {
  const c = classificationFromParsed(structuredClone(good), SCHEMA_MANIFEST, true, receipt());
  assert(c.classifier_ok === true, 'classifier_ok');
  assert(c.image_type === 'receipt_document');
  assert(c.confidence === 0.91);
  assert(c.image_medium === 'photograph');
  assert(c.detected_text?.length === 2);
  assert(c.vehicle_hints?.make === 'Pontiac' && !('year_range' in (c.vehicle_hints ?? {})) && !('color' in (c.vehicle_hints ?? {})), 'empty hints are dropped');
  assert(c.classifier_receipt?.model === 'reader:test');
});

Deno.test('an unusable reader answer throws SyntaxError (the provider path maps it to classifier_response_invalid)', () => {
  let threw = false;
  try { classificationFromParsed({ image_type: 'spaceship', image_medium: 'photograph', confidence: 0.5, is_automotive: true, description: 'x' }, SCHEMA_MANIFEST, true, receipt()); }
  catch (e) { threw = e instanceof SyntaxError; }
  assert(threw, 'invalid image_type must throw SyntaxError');
});

Deno.test('classificationFromReader never throws: bad JSON is classifier_response_invalid under the reader model name', async () => {
  const bad = await classificationFromReader({ confidence: 2 }, 'claude-cli sonnet subscription');
  assert(bad.classifier_ok === false);
  assert(bad.classifier_receipt?.error_class === 'classifier_response_invalid');
  assert(bad.classifier_receipt?.model === 'reader:claude-cli sonnet subscription');
  const ok = await classificationFromReader(structuredClone(good), 'claude-cli sonnet subscription');
  assert(ok.classifier_ok === true && ok.image_type === 'receipt_document');
  assert(ok.classifier_receipt?.prompt_version === 'v98');
});

Deno.test('a malformed VIN is dropped (the classification stands), a well-formed one is kept with its checksum read', async () => {
  const badVin = await classificationFromReader({ ...structuredClone(good), vin_detected: 'NOT-A-VIN' }, 'r');
  assert(badVin.classifier_ok === true, 'a bad VIN does not fail the classification');
  assert(badVin.vin_detected === undefined, 'the malformed VIN is dropped');
  const okVin = await classificationFromReader({ ...structuredClone(good), vin_detected: '1HGCM82633A004352' }, 'r'); // checksum-valid, 17 characters
  assert(okVin.classifier_ok === true && okVin.vin_detected === '1HGCM82633A004352', 'the VIN is kept');
  assert(okVin.v2?.vin?.checksum_ok === true, 'the v98 extras carry the checksum verdict');
});

Deno.test('prompt separates body-tag, fender, scoop and casting inscriptions from specification claims', () => {
  const prompt = renderPromptV2();
  for (const [source, refusal] of [
    ['Body tag "TR 297 A51"', 'omit trim and engine_type'],
    ['Fender lettering "TRANS AM"', 'omit trim'],
    ['Hood-scoop lettering "SD-455"', 'omit engine_type and displacement'],
    ['Engine casting "9799140"', 'separate attributable decoder/reference'],
  ]) {
    const example = prompt.split('\n').find(line => line.startsWith(`- ${source}`));
    assert(example?.includes('text_lines') && example.includes(refusal), `${source} must retain literal text without promoting it`);
  }
  assert(!prompt.includes('a legible badge, emblem text, VIN character, spec plate or document line'), 'removed the former blanket permission');
});

Deno.test('prompt preserves direct VIN, attributed document specifications and visible appearance paths', () => {
  const prompt = renderPromptV2();
  assert(prompt.includes('physical dash plate belongs in vin with evidence_role "vehicle_vin_plate"'));
  assert(prompt.includes('invoice line explicitly stating "Engine: 455 V8" may supply engine_type "455 V8"'));
  assert(prompt.includes('do not turn its date into an installation date'));
  assert(prompt.includes('visibly red exterior may supply color "red"'));
  assert(prompt.includes('Appearance alone supplies no factory paint name or code'));
});

Deno.test('literal-only component and appearance reads retain every inscription without creating spec fields', () => {
  const text = ['TR 297 A51', 'TRANS AM', 'SD-455', '9799140'];
  const c = classificationFromParsed({ ...good, image_type: 'vin_plate', is_document: false,
    text_lines: text.map(text => ({ text, confidence: .95 })), vehicle_fields: [] }, SCHEMA_MANIFEST, true, receipt());
  assert(JSON.stringify(c.v2?.text_lines.map(line => line.text)) === JSON.stringify(text));
  assert(c.v2?.vehicle_fields.length === 0 && !c.v2?.vin, 'literal text never self-promotes into vehicle specs');
});
