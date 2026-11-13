import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FORBIDDEN_BUTTON, matchDom, normLabel, pickOption, planFill } from './bat-submit-plan.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/bat-form-firebird-labels.json', import.meta.url), 'utf8'));
const f = (value, tier, order, control = 'text') => ({ value, tier, order, control, nameHint: null });
const fieldMap = {
  // deliberately out of DOM order: the plan must reorder
  VIN: f('2F87X3N000000', 'decode', 18),
  Year: f(1973, 'decode', 0, 'select'),
  Make: f('Pontiac', 'decode', 1, 'select'),
  Model: f('Firebird', 'decode', 2, 'select'),
  City: f('Testville', 'decode', 4),
  'Exterior color': f('75', 'decode', 22, 'select'),
  Equipment: f(['Console', 'Tachometer'], 'observe', 42, 'checkboxes'),
  Photos: { ...f([{ image_id: 'img-1' }], 'decode', 15, 'files'), nameHint: 'files[]' },
  'List the modifications': f('Dual exhaust', 'deliberate', 47, 'textarea'),
  'Rust': f('None found', 'deliberate', 41, 'textarea'), // not in this fixture step list
  'Tire brand': f(null, 'observe', 26), // no value: not planned
  'Are you a dealer?': f('No', 'sign', 12, 'radio'),
  'Title status': f('Clean', 'sign', 30, 'select'),
  'Odometer reading': f(51000, 'sign', 33),
  'Do you want a reserve?': f(null, 'sign', 55, 'radio'),
  'I attest that the information provided is accurate': f(null, 'sign', 58, 'checkboxes'),
};

test('labels normalize past BaT asterisks and helper text', () => {
  assert.equal(normLabel('VIN*'), 'vin');
  assert.equal(normLabel('YouTube links (optional)'), 'youtube links optional');
  const dom = fixture.steps.basic_facts;
  assert.equal(matchDom('YouTube links', {}, dom)?.name, 'input_20');
  assert.equal(matchDom('Photos', { nameHint: 'files[]' }, [{ label: 'Drop files here', name: 'files[]' }])?.name, 'files[]');
});

test('plan follows DOM order on every step and never includes a sign field', () => {
  const all = [...fixture.steps.make_model, ...fixture.steps.basic_facts, ...fixture.steps.details];
  const plan = planFill(all, fieldMap);
  const order = plan.fill.map((s) => s.label);
  assert.deepEqual(order, ['Year', 'Make', 'Model', 'City', 'Photos', 'VIN', 'Exterior color', 'Equipment', 'List the modifications']);
  const signs = Object.entries(fieldMap).filter(([, v]) => v.tier === 'sign').map(([k]) => k);
  for (const s of signs) assert.ok(!order.includes(s), `${s} must not be auto-filled`);
  assert.deepEqual(plan.ownerTaps.sort(), signs.sort());
  assert.deepEqual(plan.unmatched, ['Rust']);
  assert.ok(plan.notOnForm.includes('Ownership duration in months'), 'new BaT questions surface on the receipt');
});

test('a step plans only the questions it shows', () => {
  const plan = planFill(fixture.steps.make_model, fieldMap);
  assert.deepEqual(plan.fill.map((s) => s.label), ['Year', 'Make', 'Model']);
});

test('options resolve by exact label, paint code prefix and displacement', () => {
  assert.equal(pickOption(['Firebird', 'Firebird Esprit', 'Firebird Formula', 'Firebird Trans Am'], 'Firebird Trans Am'), 'Firebird Trans Am');
  assert.equal(pickOption(['Firebird', 'Firebird Esprit'], 'Firebird'), 'Firebird');
  assert.equal(pickOption(['24 - Cameo White', '75 - Buccaneer Red', '97 - Navajo Orange'], '75'), '75 - Buccaneer Red');
  assert.equal(pickOption(['350ci V8', '400ci V8', 'Other'], '400 cid V8 4-bbl'), '400ci V8');
  assert.equal(pickOption(['350ci V8', '400ci V8'], ''), null);
});

test('Finish and Submit are forbidden buttons; Next is not', () => {
  for (const t of ['Finish', 'Submit', 'submit listing']) assert.ok(FORBIDDEN_BUTTON.test(t));
  assert.ok(!FORBIDDEN_BUTTON.test('Next'));
});
