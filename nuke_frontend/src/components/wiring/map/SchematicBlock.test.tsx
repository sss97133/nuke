// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { COLORWAYS } from '../connector-inspector/colorways';
import { physicalSchematicPieces, readPhysicalHarnessModel, type PhysicalHarnessModel, type PhysicalSegment } from './physicalHarnessModel';
import type { Rel } from './useWorkspaceSelection';

const transport = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../../lib/supabase', () => ({ supabase: transport }));
import { SchematicBlock } from './SchematicBlock';

const vehicleId = 'vehicle-fixture';
const segment = (id: string, from: string, to: string, length: number): PhysicalSegment => ({
  id, circuit_id: 'c110', from_termination_id: from, to_termination_id: to,
  gauge_awg: 22, circuit_gauge_awg: 22, colour: 'yellow/red', keyed_part_number: null,
  planned_length_ft: length, measured_length_ft: null, link_state: 'linked',
  specification_state: 'incomplete', legacy_check_state: 'unversioned',
});
function fixture(): PhysicalHarnessModel {
  return { contract_version: 1, vehicle_id: vehicleId, snapshot_hash: 'fixture-snapshot',
    snapshot_kind: 'current_read_not_published_revision',
    circuits: [{ id: 'c110', code: '110', name: 'Coolant temperature', section: 'engine', design_status: 'decided' }],
    endpoints: [
      { id: 'ecu', code: 'M130-B', name: 'Engine controller' },
      { id: 'cab', code: 'FIREWALL-CABIN', name: 'Firewall cabin half' },
      { id: 'bay', code: 'FIREWALL-ENGINE', name: 'Firewall engine half' },
      { id: 'sensor', code: 'CLT-ECU', name: 'Coolant temperature sensor' },
    ],
    // Deliberately shuffled: display must use keys, never a positional sort.
    terminations: [
      { id: 't4', circuit_id: 'c110', endpoint_id: 'sensor', cavity: '1' },
      { id: 't2', circuit_id: 'c110', endpoint_id: 'cab', cavity: 'A' },
      { id: 't1', circuit_id: 'c110', endpoint_id: 'ecu', cavity: 'B04' },
      { id: 't3', circuit_id: 'c110', endpoint_id: 'bay', cavity: 'A' },
    ],
    segments: [segment('piece-cabin', 't1', 't2', 1.09), segment('piece-engine', 't3', 't4', 3.54)],
    connector_matings: [{ from_endpoint_id: 'cab', to_endpoint_id: 'bay' }],
  };
}
let host: HTMLDivElement, root: Root, model: PhysicalHarnessModel;
const onSelect = vi.fn();
const rel: Rel = { nodes: new Set(), wires: new Set(), pins: new Set(), segs: new Set(), devs: new Set(), sections: new Set() };
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  model = fixture(); transport.rpc.mockReset(); onSelect.mockReset();
  transport.rpc.mockImplementation(async () => ({ data: model, error: null }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(id = vehicleId) {
  await act(async () => root.render(<SchematicBlock cw={COLORWAYS.paper} vehicleId={id}
    section="engine" sel="w:110" rel={rel} isOwner={false} onSelect={onSelect} />));
}
it('draws exactly the two keyed physical pieces, retaining a separate connector mate', async () => {
  await render();
  expect(transport.rpc).toHaveBeenCalledWith('harness_schematic_model', { p_vehicle_id: vehicleId });
  expect([...host.querySelectorAll('[data-segment-id]')].map(n => n.getAttribute('data-segment-id'))).toEqual(['piece-cabin', 'piece-engine']);
  expect(host.querySelectorAll('[data-mating="connector"]')).toHaveLength(1);
  expect(host.querySelector('[data-snapshot-hash]')?.getAttribute('data-snapshot-hash')).toBe('fixture-snapshot');
  expect(host.textContent).toContain('1.09 ft planned'); expect(host.textContent).toContain('3.54 ft planned');
  await act(async () => host.querySelector('[data-segment-id]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(onSelect).toHaveBeenCalledWith('w:110');
  onSelect.mockClear();
  await act(async () => host.querySelector('[data-segment-id]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(onSelect).toHaveBeenCalledWith('w:110');
});
it('keeps the specification conflict visible rather than displaying the imported PASS', async () => {
  model.circuits[0].code = '23';
  model.segments = [{ ...model.segments[0], gauge_awg: 20, circuit_gauge_awg: 18,
    keyed_part_number: 'M22759/32-18-2', specification_state: 'conflict' }];
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('segment 20 AWG; circuit 18 AWG; part M22759/32-18-2');
  expect(host.querySelector('[role="alert"]')?.textContent).not.toContain('PASS');
});
it('never guesses a missing end from cavity labels or legacy ordering', () => {
  model.terminations = model.terminations.filter(t => t.id !== 't2');
  const pieces = physicalSchematicPieces(model, 'engine', false);
  expect(pieces[0].to).toBeNull(); expect(pieces[1].from?.id).toBe('t3');
  expect(pieces.map(p => p.id)).toEqual(['piece-cabin', 'piece-engine']);
});
it('omits concepts for public readers and never creates a cable from a mating pair', () => {
  model.circuits[0].design_status = 'concept';
  expect(physicalSchematicPieces(model, 'engine', false)).toEqual([]);
  expect(physicalSchematicPieces(model, 'engine', true)).toHaveLength(2);
  model.segments = [];
  expect(physicalSchematicPieces(model, 'engine', true)).toEqual([]);
});
it('rejects wrong-vehicle and incompatible snapshots', () => {
  expect(() => readPhysicalHarnessModel(model, 'another-vehicle')).toThrow();
  expect(() => readPhysicalHarnessModel({ ...model, contract_version: 2 }, vehicleId)).toThrow();
});
it('removes the drawing when its new vehicle model is unavailable', async () => {
  await render(); expect(host.querySelectorAll('[data-segment-id]')).toHaveLength(2);
  transport.rpc.mockResolvedValue({ data: null, error: { message: 'Unavailable' } });
  await render('another-vehicle');
  expect(host.querySelectorAll('[data-segment-id]')).toHaveLength(0);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not be read');
});
