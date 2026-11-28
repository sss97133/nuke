// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../../lib/supabase', () => ({ supabase: {} }));
import { PhysicalRecordDetail, sourceCircuitForRecord } from './PhysicalRecordDetail';
import type { PhysicalHarnessModel } from './physicalHarnessModel';

const model: PhysicalHarnessModel = {
  contract_version: 1, vehicle_id: 'vehicle', snapshot_hash: 'content', snapshot_kind: 'current_read_not_published_revision',
  circuits: [
    { id: 'c1', code: 'SHARED_CODE', name: 'First source', section: 'engine', design_status: 'decided' },
    { id: 'c2', code: 'SHARED_CODE', name: 'Second source', section: 'engine', design_status: 'decided' },
  ],
  segments: [{ id: 'piece', net_id: 'net', circuit_id: 'c2', design_status: 'decided', from_termination_id: 'end', to_termination_id: null,
    gauge_awg: null, circuit_gauge_awg: null, colour: null, keyed_part_number: null, planned_length_ft: null, measured_length_ft: null,
    link_state: 'incomplete', specification_state: 'incomplete', legacy_check_state: 'not_checked' }],
  terminations: [{ id: 'end', circuit_id: 'c2', endpoint_id: 'endpoint', cavity: '1', cavity_layout_id: null }],
  endpoints: [{ id: 'endpoint', code: 'CONNECTOR', name: 'Connector', node_kind: 'terminals' }],
  nets: [], connector_matings: [], unsegmented_end_records: [{ id: 'unsegmented', circuit_id: 'c2', endpoint_id: 'endpoint', endpoint_node_kind: 'terminals' }],
};
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('retains reachable owner evidence alongside the exact physical source record', async () => {
  await act(async () => root.render(<PhysicalRecordDetail model={model} target={{ kind: 'circuits', id: 'c2' }} onRecord={() => {}}
    isOwner ownerExtra={<a href="/observation/retained-evidence">Retained supporting evidence</a>} />));
  expect(host.querySelector('.physical-owner-evidence summary')?.textContent).toContain('Owner evidence');
  expect(host.querySelector('.physical-owner-evidence a')?.getAttribute('href')).toBe('/observation/retained-evidence');
  expect(host.textContent).toContain('Second source');
});

it('does not render private evidence for a visitor even if an extra node is supplied', async () => {
  await act(async () => root.render(<PhysicalRecordDetail model={model} target={{ kind: 'circuits', id: 'c2' }} onRecord={() => {}}
    ownerExtra={<a href="/observation/retained-evidence">Private supporting evidence</a>} />));
  expect(host.querySelector('.physical-owner-evidence')).toBeNull();
  expect(host.textContent).not.toContain('Private supporting evidence');
});

it('resolves evidence circuit scope through typed IDs rather than a repeated display code', () => {
  expect(sourceCircuitForRecord(model, { kind: 'segments', id: 'piece' })?.id).toBe('c2');
  expect(sourceCircuitForRecord(model, { kind: 'ends', id: 'end' })?.id).toBe('c2');
  expect(sourceCircuitForRecord(model, { kind: 'ends', id: 'unsegmented' })?.id).toBe('c2');
  expect(sourceCircuitForRecord(model, { kind: 'segments', id: 'missing' })).toBeNull();
});
