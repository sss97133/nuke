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
  id, net_id: 'net-fixture', circuit_id: 'c110', design_status: 'decided', from_termination_id: from, to_termination_id: to,
  gauge_awg: 22, circuit_gauge_awg: 22, colour: 'yellow/red', keyed_part_number: null,
  planned_length_ft: length, measured_length_ft: null, link_state: 'linked',
  specification_state: 'incomplete', legacy_check_state: 'unversioned',
});
function fixture(): PhysicalHarnessModel {
  return { contract_version: 1, vehicle_id: vehicleId, snapshot_hash: 'fixture-snapshot',
    snapshot_kind: 'current_read_not_published_revision',
    nets: [{ id: 'net-fixture' }],
    circuits: [{ id: 'c110', code: '110', name: 'Coolant temperature', section: 'engine', design_status: 'decided' }],
    endpoints: [
      { id: 'ecu', code: 'M130-B', name: 'Engine controller', node_kind: 'terminals' },
      { id: 'cab', code: 'FIREWALL-CABIN', name: 'Firewall cabin half', node_kind: 'terminals' },
      { id: 'bay', code: 'FIREWALL-ENGINE', name: 'Firewall engine half', node_kind: 'terminals' },
      { id: 'sensor', code: 'CLT-ECU', name: 'Coolant temperature sensor', node_kind: 'terminals' },
    ],
    // Deliberately shuffled: display must use keys, never a positional sort.
    terminations: [
      { id: 't4', circuit_id: 'c110', endpoint_id: 'sensor', cavity: '1', cavity_layout_id: null },
      { id: 't2', circuit_id: 'c110', endpoint_id: 'cab', cavity: 'A', cavity_layout_id: null },
      { id: 't1', circuit_id: 'c110', endpoint_id: 'ecu', cavity: 'B04', cavity_layout_id: null },
      { id: 't3', circuit_id: 'c110', endpoint_id: 'bay', cavity: 'A', cavity_layout_id: null },
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
async function render(id = vehicleId, isOwner = false) {
  await act(async () => root.render(<SchematicBlock cw={COLORWAYS.paper} vehicleId={id}
    section="engine" sel="w:110" rel={rel} isOwner={isOwner} onSelect={onSelect} />));
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
it('uses trade gauge labels in accessible physical-piece and conflict descriptions', async () => {
  model.segments = [{ ...model.segments[0], gauge_awg: 0, circuit_gauge_awg: -1,
    specification_state: 'conflict' }];
  await render();
  expect(host.querySelector('[data-segment-id]')?.getAttribute('aria-label')).toContain('1/0 AWG');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('segment 1/0 AWG; circuit 2/0 AWG');
  expect(model.segments[0].gauge_awg).toBe(0);
  expect(model.segments[0].circuit_gauge_awg).toBe(-1);
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
it('retains candidate and rejected segment qualification independently of its decided circuit', async () => {
  model.segments[0].design_status = 'candidate'; model.segments[1].design_status = 'contradicted';
  expect(physicalSchematicPieces(model, 'engine', false)).toHaveLength(0);
  await render(vehicleId, true);
  expect(host.textContent).toContain('Candidate segment'); expect(host.textContent).toContain('Rejected segment');
  expect(host.querySelector('[data-segment-id="piece-engine"] path:last-child')?.getAttribute('stroke-dasharray')).toBe('5 3');
});
it('normalizes annotated cavities for selection without discarding the original annotation', async () => {
  model.terminations.find(t => t.id === 't4')!.cavity = '1 — pin order OPEN until confirmed';
  await render();
  const row = host.querySelector('[data-termination-ids="t4"]')!;
  await act(async () => row.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(onSelect).toHaveBeenCalledWith('p:CLT-ECU|1');
  expect(host.textContent).toContain('pin order OPEN until confirmed');
});
it('joins shared pins only through the existing endpoint/cavity and current net identity', async () => {
  model.circuits.push({ ...model.circuits[0], id: 'c2', code: 'GROUND-2' });
  model.terminations.push({ ...model.terminations.find(t => t.id === 't1')!, id: 't5', circuit_id: 'c2' });
  model.segments.push({ ...segment('branch', 't5', '', 2), circuit_id: 'c2', to_termination_id: null, link_state: 'incomplete' });
  await render();
  expect(host.querySelectorAll('[data-segment-id]')).toHaveLength(3);
  expect(host.querySelectorAll('[data-endpoint-id="ecu"] [data-electrical-node]')).toHaveLength(1);
  expect(host.querySelector('[data-endpoint-id="ecu"] [data-termination-ids]')?.getAttribute('data-termination-ids')).toBe('t1,t5');
  model.nets.push({ id: 'different-net' }); model.segments[2].net_id = 'different-net';
  const pieces = physicalSchematicPieces(model, 'engine', false);
  expect(pieces[0].from?.nodeKey).not.toBe(pieces[2].from?.nodeKey);
});
it('represents a recorded bus as a common node without assigning one lug label to every end', async () => {
  model.endpoints.find(e => e.id === 'ecu')!.node_kind = 'bus';
  model.circuits.push({ ...model.circuits[0], id: 'c2', code: 'RETURN-2' });
  model.terminations.push({ id: 't5', circuit_id: 'c2', endpoint_id: 'ecu', cavity: 'stud, different lug', cavity_layout_id: null });
  model.segments.push({ ...segment('branch', 't5', '', 2), circuit_id: 'c2', to_termination_id: null, link_state: 'incomplete' });
  await render();
  const rows = host.querySelectorAll('[data-endpoint-id="ecu"] [data-electrical-node]');
  expect(rows).toHaveLength(1); expect(rows[0].textContent).toContain('Bus');
  await act(async () => rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(onSelect).toHaveBeenCalledWith('n:M130-B');
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
