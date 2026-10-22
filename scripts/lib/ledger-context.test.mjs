// Acceptance cases A/B/C from nuke-strategy/image-context-review.md (real DB rows, 2026-10-22).
import test from 'node:test';
import assert from 'node:assert/strict';
import { documentGate, ledgerClaimErrors, packetPromptText } from './ledger-context.mjs';

const BMW = {
  vehicle_id: '00a23a04-cf99-4d19-846e-82d2b0df2f58',
  description: 'This 1973 BMW 3.0CS is said to have been initially distributed via Hoffman Motors of New York and was refurbished in the early 2010s under previous ownership.',
  identity: { year: 1973, make: 'BMW', model: '3.0CS 4-Speed' }, field_claims: [], receipt_items: [],
  timeline: [{ id: 'c4dd2319-30e8-4f7b-b61d-f8a12175782f', event_type: 'auction', platform: 'bat' }], condition_baseline: null,
};
const BMW_IMG = { id: '9b68414a-22b6-4743-ad11-d13a85a0f327',
  image_url: 'https://bringatrailer.com/wp-content/uploads/2023/10/1973_bmw_m90-powered-3.0-cs_1973_bmw_m90-powered-3.0-cs_doc01716220231108142612_111-94449-1-64769.jpg' };
const OLDS = { vehicle_id: '00f31ad0-cd30-4437-9348-8b22173d27fe',
  description: 'Features include a W-30-style fiberglass hood with dual scoops, rear wing, a 12-bolt differential',
  identity: { year: 1970, make: 'Oldsmobile', model: '442 5-Speed' }, field_claims: [], receipt_items: [], timeline: [], condition_baseline: null };
const OLDS_IMG = { id: '0620290d-81a5-4170-abac-6a1782484ac7',
  image_url: 'https://bringatrailer.com/wp-content/uploads/2021/05/1970_oldsmobile_442_16262892017ba846e20210714_102218_HDR.jpg' };
const VETTE = { vehicle_id: '011f624f-cff2-4e54-a20a-59fb2e1e5bb1', description: 'has 46k miles following history in Tennessee, Texas, and Alabama.',
  identity: { year: 2003, make: 'Chevrolet', model: 'Corvette' }, field_claims: [], receipt_items: [], timeline: [], condition_baseline: null };
const VETTE_IMG = { id: 'aa934df5-3adf-4c70-9ffa-a49e03a8735f',
  image_url: 'https://bringatrailer.com/wp-content/uploads/2025/03/Photo-Mar-19-2025-12-25-18-PM-99699.jpg' };

test('A: the BMW repair order is gated as a document; a condition/paint_fade claim is refused', () => {
  assert.equal(documentGate(BMW_IMG), true);
  const paintFade = { kind: 'condition', scene_type: 'body_exterior', confidence: 0.6, baseline: null,
    ledger_target: { field: 'paint_condition', action: 'add' }, value: { damage: 'paint_fade' } };
  assert.match(ledgerClaimErrors(paintFade, BMW, BMW_IMG).join(), /document gate/);
  const service = { kind: 'work_record', scene_type: 'receipt_document', confidence: 0.85,
    ledger_target: { field: 'service_history', action: 'add' },
    value: { date: '2009-04-30', vendor: 'Munich Motorwerke', total_usd: 1147.30 } };
  assert.deepEqual(ledgerClaimErrors(service, BMW, BMW_IMG), []);
});

test('B: the 442 hood confirms the description\'s "W-30-style" claim; an invented ref is refused', () => {
  assert.equal(documentGate(OLDS_IMG), false);
  const hood = { kind: 'specification', scene_type: 'engine_bay', confidence: 0.75,
    ledger_target: { field: 'modification.hood', action: 'confirm', ref: 'description', excerpt: 'W-30-style fiberglass hood' },
    value: { modification: 'reproduction W-30-style ram-air hood', factory_w30: false } };
  assert.deepEqual(ledgerClaimErrors(hood, OLDS, OLDS_IMG), []);
  const bogus = { ...hood, ledger_target: { ...hood.ledger_target, excerpt: 'factory W-30 hood' } };
  assert.match(ledgerClaimErrors(bogus, OLDS, OLDS_IMG).join(), /does not resolve/);
});

test('C: rust with no Y/M/M baseline must be stated as absolute, not vehicle-relative', () => {
  const relative = { kind: 'condition', scene_type: 'undercarriage', confidence: 0.6,
    ledger_target: { field: 'condition.undercarriage', action: 'add' },
    value: { descriptor: 'surface_rust', severity: 'surface', relative_to_ymm: 'worse_than_typical' } };
  const errs = ledgerClaimErrors(relative, VETTE, VETTE_IMG).join();
  assert.match(errs, /baseline:null/); assert.match(errs, /relative_to_ymm/);
  const absolute = { ...relative, baseline: null, value: { ...relative.value, relative_to_ymm: 'unknown' } };
  assert.deepEqual(ledgerClaimErrors(absolute, VETTE, VETTE_IMG), []);
  assert.match(packetPromptText(VETTE), /none \(condition is absolute/);
});
