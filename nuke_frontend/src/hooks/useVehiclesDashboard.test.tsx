// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rows: {} as Record<string, any[]>, fail: '', calls: [] as any[] }));
vi.mock('../lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    let rows = fixture.rows[table] ?? [];
    const q: any = { then: (fn: any) => Promise.resolve({
      data: table === fixture.fail ? null : rows,
      error: table === fixture.fail ? { message: 'unavailable' } : null,
    }).then(fn) };
    q.select = (...args: any[]) => { fixture.calls.push([table, 'select', ...args]); return q; };
    q.eq = (key: string, value: any) => { rows = rows.filter(r => r[key] === value); return q; };
    q.in = (key: string, values: any[]) => { rows = rows.filter(r => values.includes(r[key])); return q; };
    return q;
  },
  rpc: async (name: string) => ({ data: name === 'get_my_garage_owner_corrections'
    ? fixture.rows.garage_owner_corrections ?? [] : [], error: null }),
} }));

import { resolveGarageRelationships, useVehiclesDashboard } from './useVehiclesDashboard';
import { GarageVehicleCard } from '../components/vehicles/GarageVehicleCard';

const now = new Date('2026-10-07T12:00:00Z');
const period = (changes: Record<string, unknown> = {}) => ({
  id: 'period', vehicle_id: 'car', role: 'verified_owner', is_current: true,
  start_date: '2020-01-01', end_date: null, verification_id: 'proof', created_at: '2020-02-01T00:00:00Z',
  ...changes,
});
const proof = (changes: Record<string, unknown> = {}) => ({
  id: 'proof', vehicle_id: 'car', status: 'approved', expires_at: '2027-01-01T00:00:00Z', ...changes,
});

it('keeps ended ownership despite an approval and uses the acquisition clock', () => {
  const result = resolveGarageRelationships([period({ is_current: false, end_date: '2023-01-01' })], [proof()], [], now);
  expect(result.get('car')).toMatchObject({ type: 'PREVIOUSLY OWNED', source: 'ownership',
    id: 'period', start_date: '2020-01-01', end_date: '2023-01-01' });
});

it('selects reacquisition over earlier periods independently of row order', () => {
  const rows = [period({ id: 'old', is_current: false, end_date: '2023-01-01' }),
    period({ id: 'new', start_date: '2024-01-01' })];
  for (const input of [rows, [...rows].reverse()]) {
    expect(resolveGarageRelationships(input, [proof()], [], now).get('car'))
      .toMatchObject({ type: 'VERIFIED OWNER', id: 'new', start_date: '2024-01-01' });
  }
});

it('does not promote expired, mismatched, unverified or unknown roles to verified ownership', () => {
  expect(resolveGarageRelationships([period()], [proof({ expires_at: '2025-01-01' })], [], now).get('car')?.type).toBe('OWNER');
  expect(resolveGarageRelationships([period()], [proof({ vehicle_id: 'other' })], [], now).get('car')?.type).toBe('OWNER');
  for (const role of ['unverified_claim', 'photographer', null]) {
    expect(resolveGarageRelationships([period({ role })], [proof()], [], now).get('car')?.type).toBe('OWNERSHIP CLAIM');
  }
  expect(resolveGarageRelationships([], [proof({ expires_at: '2025-01-01' })], [], now).get('car')?.type).toBe('OWNERSHIP CLAIM');
});

it('retains a declared prior relationship without inventing its dates or an acquisition', () => {
  const result = resolveGarageRelationships([], [], [{ id: 'discovery', vehicle_id: 'car' }], now);
  expect(result.get('car')).toMatchObject({ type: 'PREVIOUSLY OWNED', start_date: null, end_date: null });
  expect(resolveGarageRelationships([period({ start_date: '2027-01-01' })], [], [], now).get('car')?.type).toBe('OWNERSHIP CLAIM');
});

let state: ReturnType<typeof useVehiclesDashboard>, root: Root, container: HTMLDivElement;
function Harness() { state = useVehiclesDashboard('user'); return null; }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.rows = {}; fixture.fail = ''; fixture.calls = [];
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

function seedGarage() {
  fixture.rows.vehicle_ownerships = [period({ owner_profile_id: 'user', role: 'owner', verification_id: null }),
    period({ id: 'ended', vehicle_id: 'old', owner_profile_id: 'user', is_current: false, end_date: '2023-01-01' })];
  fixture.rows.vehicles = ['car', 'old'].map(id => ({ id, year: 1970, make: 'Example', model: 'Car', status: 'active',
    current_value: 999999, purchase_price: 5000, image_count: 4, primary_image_url: 'photo',
    created_at: '2025-01-01', updated_at: '2026-01-01' }));
  fixture.rows.nuke_estimates = ['car', 'old'].map(vehicle_id => ({ vehicle_id, estimated_value: 12000,
    calculated_at: '2026-10-06T00:00:00Z', comp_method: 'class_stratified', is_stale: false, is_circular: false }));
}

it('loads prior periods, excludes them from current asset totals, and does not report an unattributed gain', async () => {
  seedGarage(); await act(async () => root.render(<Harness />));
  expect(state.vehicles).toHaveLength(2);
  expect(state.totalEstimatedValue).toBe(12000);
  expect(state.vehicles.map(v => v.value_delta)).toEqual([null, null]);
  expect(state.vehicles[0].estimate_calculated_at).toBe('2026-10-06T00:00:00Z');
  expect(state.data?.my_vehicles[0].acquisition_date).toBe('2020-01-01');
  expect(fixture.calls.find(c => c[0] === 'vehicles')?.[2]).not.toContain('current_value');
});

it('withholds stale, circular, unqualified and invalid estimates without falling back to paid price', async () => {
  seedGarage();
  const estimate = { ...fixture.rows.nuke_estimates[0] };
  for (const change of [{ is_stale: true }, { is_circular: true }, { comp_method: 'canonical' },
    { estimated_value: 0 }, { estimated_value: null }, { calculated_at: null }]) {
    fixture.rows.nuke_estimates = [{ ...estimate, ...change }];
    await act(async () => { root.render(<Harness />); state?.refresh(); });
    expect(state.vehicles.find(v => v.id === 'car')?.estimated_value).toBeNull();
    expect(state.totalEstimatedValue).toBe(0);
  }
});

it('surfaces relationship and vehicle read failures instead of showing an empty successful garage', async () => {
  seedGarage(); fixture.fail = 'vehicle_ownerships';
  await act(async () => root.render(<Harness />));
  expect(state.error).toMatch(/relationships unavailable/);
  fixture.fail = 'vehicles'; await act(async () => state.refresh());
  expect(state.error).toMatch(/vehicles unavailable/);
  expect(state.vehicles).toEqual([]);
});

it('shows the recorded period and unknown estimate without a scalar-value action or ineffective period eject', async () => {
  seedGarage(); fixture.rows.nuke_estimates = [];
  await act(async () => root.render(<Harness />));
  const vehicle = state.vehicles.find(v => v.id === 'old')!;
  await act(async () => root.render(<MemoryRouter><GarageVehicleCard vehicle={vehicle} /></MemoryRouter>));
  const markup = container.innerHTML;
  expect(markup).toContain('2020-01-01 → 2023-01-01');
  expect(markup).toContain('NOT ESTIMATED');
  expect(markup).not.toContain('SET VALUE');
  expect(markup).not.toContain('REMOVE FROM GARAGE');
  await act(async () => root.render(<MemoryRouter><GarageVehicleCard vehicle={{ ...vehicle, relationship_source: 'discovered' }} /></MemoryRouter>));
  expect(container.innerHTML).toContain('REMOVE FROM GARAGE');
});

it('keeps data confidence out of mechanical health in every card view', async () => {
  seedGarage();
  fixture.rows.vehicles[0] = { ...fixture.rows.vehicles[0], confidence_score: 50 };
  await act(async () => root.render(<Harness />));
  const vehicle = state.vehicles.find(v => v.id === 'car')!;
  expect(vehicle.health_score).toBeNull();
  expect(state.data?.my_vehicles.find(v => v.vehicle_id === 'car')?.confidence_score).toBe(50);
  for (const viewMode of ['GRID', 'LIST', 'COMPACT'] as const) {
    await act(async () => root.render(<MemoryRouter><GarageVehicleCard vehicle={vehicle} viewMode={viewMode} /></MemoryRouter>));
    expect(container.textContent).not.toContain('HEALTH');
  }
});

it('uses the retained model name and keeps distinguishing trim in every garage view', async () => {
  seedGarage();
  fixture.rows.vehicles[0] = { ...fixture.rows.vehicles[0], model: 'Blazer',
    normalized_model: 'K5 Blazer', trim: 'Cheyenne' };
  await act(async () => root.render(<Harness />));
  const vehicle = state.vehicles.find(v => v.id === 'car')!;
  expect(vehicle.model).toBe('K5 Blazer');
  expect(state.data?.my_vehicles.find(v => v.vehicle_id === 'car')?.model).toBe('K5 Blazer');
  for (const viewMode of ['GRID', 'LIST', 'COMPACT'] as const) {
    await act(async () => root.render(<MemoryRouter><GarageVehicleCard vehicle={vehicle} viewMode={viewMode} /></MemoryRouter>));
    expect(container.textContent).toContain('K5 BLAZER');
    expect(container.textContent).toContain('CHEYENNE');
  }
  fixture.rows.vehicles[0] = { ...fixture.rows.vehicles[0], model: 'K5',
    normalized_model: 'K5', trim: 'Jimmy' };
  await act(async () => root.render(<Harness />));
  await act(async () => root.render(<MemoryRouter><GarageVehicleCard vehicle={state.vehicles.find(v => v.id === 'car')!} /></MemoryRouter>));
  expect(container.textContent).toContain('K5');
  expect(container.textContent).toContain('JIMMY');
});

it('loads private corrections into sections, personal assets and the selected garage cover', async () => {
  seedGarage();
  fixture.rows.garage_owner_corrections = [
    { id: 'statement', vehicle_id: 'car', observed_at: '2026-10-07', cover_image_url: null,
      correction: { relationship: { roles: ['consignment'], ownership_denied: false,
        title_status: 'unknown', disputed: false, start_date: null, end_date: null } } },
    { id: 'cover', vehicle_id: 'car', observed_at: '2026-10-07', cover_image_url: 'chosen-whole-car',
      correction: { cover_image_id: 'chosen-image' } },
  ];
  await act(async () => root.render(<Harness />));
  const car = state.vehicles.find(v => v.id === 'car')!;
  expect(car.relationship_type).toBe('CONSIGNED');
  expect(car.resolved_image_url).toBe('chosen-whole-car');
  expect(state.sections.find(s => s.relationship_type === 'CONSIGNED')?.vehicles[0].id).toBe('car');
  expect(state.data?.my_vehicles.some(v => v.vehicle_id === 'car')).toBe(false);
  expect(state.data?.client_vehicles.map(v => v.vehicle_id)).toEqual(['car']);
  expect(state.totalEstimatedValue).toBe(0);
  await act(async () => state.setFilterMode('OWNED'));
  expect(state.vehicles.map(v => v.id)).toEqual(['old']);
});
