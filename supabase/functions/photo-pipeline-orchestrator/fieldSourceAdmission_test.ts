import { admitPhotoFields } from './fieldSourceAdmission.ts';
const fields = [
  { field_name: 'engine_type', value: 'Badge text', confidence: .95, evidence: 'Text on hood scoop' },
  { field_name: 'color', value: 'Red', confidence: .95, evidence: 'Visible red body paint' },
];
function assert(value: unknown, message = 'assertion failed'): asserts value { if (!value) throw new Error(message); }
Deno.test('uses one existing semantic-owner read and keeps source-role refusals without mutating raw readings', async () => {
  let calls = 0; const before = JSON.stringify(fields);
  const result = await admitPhotoFields(fields, 'Source photograph', async (name, args) => {
    calls++; assert(name === 'photo_field_not_about_vehicle'); assert(args.p_fields === fields);
    return { error: null, data: { status: 'ok', decisions: [{ index: 0, reason: 'appearance_text_not_vehicle_specification' }, { index: 1, reason: null }] } };
  });
  assert(calls === 1 && result.fields.length === 1 && result.fields[0] === fields[1]);
  assert(result.refusals[0].field === 'engine_type' && result.status === 'ok');
  assert(JSON.stringify(fields) === before, 'literal source readings remain intact');
});
Deno.test('guard failure or incomplete/misaligned decisions cannot become unguarded admission', async () => {
  for (const result of [
    { error: new Error('offline'), data: null }, { error: null, data: null },
    { error: null, data: { status: 'ok', decisions: [] } },
    { error: null, data: { status: 'ok', decisions: [{ index: 1, reason: null }, { index: 0, reason: null }] } },
    { error: null, data: { status: 'ok', decisions: [{ index: 0 }, { index: 1, reason: null }] } },
  ]) {
    const read = await admitPhotoFields(fields, '', async () => result);
    assert(read.fields.length === 0 && read.status === 'source_role_guard_unavailable' && read.refusals.length === 2);
  }
});
Deno.test('no generic fields means no additional read and leaves the dedicated VIN path independent', async () => {
  const result = await admitPhotoFields([], '', () => { throw new Error('Unexpected read'); });
  assert(result.status === 'ok' && result.fields.length === 0 && result.refusals.length === 0);
});
