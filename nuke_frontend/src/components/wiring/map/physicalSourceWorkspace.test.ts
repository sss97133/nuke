import { expect, it } from 'vitest';
import { physicalSchematicPieces, readPhysicalSourceWorkspace } from './physicalHarnessModel';

function fixture() {
  return { contract_version: 1, vehicle_id: 'vehicle', snapshot_hash: 'content',
    snapshot_kind: 'current_read_not_published_revision',
    selection: { owner: 'harness_model_inputs', contract_version: 2, kind: 'decided_design',
      circuit_ids: ['circuit'], segment_ids: ['piece-a'] },
    source: { contract_version: 1, vehicle_id: 'vehicle', snapshot_hash: 'raw-content',
      snapshot_kind: 'current_read_not_published_revision',
      circuits: [{ id: 'circuit', code: '110', name: 'Signal', section: 'engine', design_status: 'decided' }],
      endpoints: [], terminations: [], nets: [], connector_matings: [],
      segments: ['piece-a', 'piece-b'].map(id => ({ id, circuit_id: 'circuit', design_status: 'decided',
        from_termination_id: null, to_termination_id: null, gauge_awg: 22,
        planned_length_ft: null, measured_length_ft: null })) } };
}

it('uses database membership even when another source piece has the same decided scalar', () => {
  const response = fixture();
  const model = readPhysicalSourceWorkspace(response, 'vehicle');
  expect(physicalSchematicPieces(model, 'engine', false).map(p => p.id)).toEqual(['piece-a']);
  expect(physicalSchematicPieces(model, 'engine', true).map(p => p.id)).toEqual(['piece-a', 'piece-b']);
  expect(model.snapshot_hash).toBe('content');
  expect(model.segments[0].planned_length_ft).toBeNull();
  expect(model.segments[0]).not.toHaveProperty('current_circuit_id');
  expect(model.segments[0]).not.toHaveProperty('needs_revision');
  expect(response.source.snapshot_hash).toBe('raw-content');
});

it('respects an explicitly empty selection without falling back to browser filtering', () => {
  const response = fixture(); response.selection.segment_ids = [];
  expect(physicalSchematicPieces(readPhysicalSourceWorkspace(response, 'vehicle'), 'engine', false)).toEqual([]);
});

it.each([
  (r: ReturnType<typeof fixture>) => { r.vehicle_id = 'other'; },
  (r: ReturnType<typeof fixture>) => { r.source.vehicle_id = 'other'; },
  (r: ReturnType<typeof fixture>) => { r.contract_version = 2; },
  (r: ReturnType<typeof fixture>) => { r.selection.contract_version = 1; },
  (r: ReturnType<typeof fixture>) => { r.selection.kind = 'browser_decided'; },
  (r: ReturnType<typeof fixture>) => { r.selection.segment_ids = ['missing']; },
  (r: ReturnType<typeof fixture>) => { r.selection.segment_ids = ['piece-a', 'piece-a']; },
  (r: ReturnType<typeof fixture>) => { r.selection.circuit_ids = []; },
])('rejects misrouted, incompatible, missing and inconsistent membership', mutate => {
  const response = fixture(); mutate(response);
  expect(() => readPhysicalSourceWorkspace(response, 'vehicle')).toThrow();
});
