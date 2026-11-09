// A reader's classification (the owner's subscription worker ran the orchestrator's checklist) is validated exactly like a
// provider answer: good JSON becomes a classification, bad JSON is classifier_response_invalid, never a thrown error.
import { __setGuardDb, allowAllGuardDb } from '../_shared/geminiGuard.ts';
__setGuardDb(allowAllGuardDb());
import { classificationFromParsed, classificationFromReader, SCHEMA_MANIFEST } from './classifierProvider.ts';
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

Deno.test('a VIN that fails the pattern is refused, a well-formed one is kept', async () => {
  const badVin = await classificationFromReader({ ...structuredClone(good), vin_detected: 'NOT-A-VIN' }, 'r');
  assert(badVin.classifier_ok === false);
  const okVin = await classificationFromReader({ ...structuredClone(good), vin_detected: '1HGCM82633A004352' }, 'r'); // a checksum-valid 17-character VIN
  assert(okVin.classifier_ok === true, 'a well-formed VIN keeps the classification');
  assert(okVin.vin_detected === '1HGCM82633A004352' || okVin.v2?.vin === '1HGCM82633A004352', 'the VIN is kept on the result');
});
