// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rows: {} as Record<string, any[]>, fail: '', forbiddenVehicleColumns: [] as string[], calls: [] as any[], hold: null as Promise<void> | null }));
vi.mock('../lib/supabase', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) },
  from: (table: string) => {
    let rows = fixture.rows[table] ?? [];
    let denied = false;
    const q: any = { then: (fn: any) => Promise.resolve(fixture.hold).then(() => ({
      data: table === fixture.fail || denied ? null : rows,
      error: table === fixture.fail || denied ? { message: 'permission denied' } : null,
    })).then(fn) };
    q.select = (...args: any[]) => {
      fixture.calls.push([table, 'select', ...args]);
      denied = table === 'vehicles' && args[0].split(',').some((column: string) => fixture.forbiddenVehicleColumns.includes(column.trim()));
      return q;
    };
    q.eq = (key: string, value: any) => { rows = rows.filter(r => r[key] === value); return q; };
    q.in = (key: string, values: any[]) => { rows = rows.filter(r => values.includes(r[key])); return q; };
    return q;
  },
  rpc: async (name: string, params: unknown) => {
    fixture.calls.push(['rpc', name, params]);
    await fixture.hold;
    return { data: name === 'get_my_garage_owner_corrections'
      ? fixture.rows.garage_owner_corrections ?? [] : [], error: null };
  },
} }));

import { resolveGarageRelationships, useVehiclesDashboard } from './useVehiclesDashboard';
import { GarageVehicleCard } from '../components/vehicles/GarageVehicleCard';
import GarageTab from '../components/garage/GarageTab';

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
const snapshots: { viewer: string | null; ids: string[]; loading: boolean; dataIds: string[]; sources: string[]; warnings: string[]; error: string | null }[] = [];
function Harness({ viewer = 'user' }: { viewer?: string | null }) {
  state = useVehiclesDashboard(viewer);
  snapshots.push({viewer, ids: state.vehicles.map(v => v.id), loading: state.isLoading,
    dataIds: state.data?.my_vehicles.map(v => v.vehicle_id) ?? [], sources: state.unresolvedSources?.map(s => s.id) ?? [],
    warnings: state.warnings ?? [], error: state.error});
  return null;
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.rows = {}; fixture.fail = ''; fixture.forbiddenVehicleColumns = []; fixture.calls = []; fixture.hold = null; snapshots.length = 0;
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
  expect(container.querySelector('button[aria-label="Remove discovery from garage"]')).toBeNull();
  await act(async () => root.render(<MemoryRouter><GarageVehicleCard vehicle={{ ...vehicle, relationship_source: 'discovered' }} /></MemoryRouter>));
  expect(container.querySelector('button[aria-label="Remove discovery from garage"]')).not.toBeNull();
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

it('excludes a rejected legacy association from rendered garage, every section and all dashboard counts', async () => {
  seedGarage();
  fixture.rows.garage_owner_corrections = [{ id: 'denial', vehicle_id: 'car', observed_at: '2026-10-08',
    cover_image_url: null, correction: { relationship: { roles: [], ownership_denied: true,
      title_status: 'unknown', disputed: false, start_date: null, end_date: null } } }];
  await act(async () => root.render(<Harness />));
  expect(state.vehicles.map(v => v.id)).toEqual(['old']);
  expect(state.sections.flatMap(s => s.vehicles.map(v => v.id))).toEqual(['old']);
  expect(state.sections.some(s => s.relationship_type === 'RELATIONSHIP REVIEW')).toBe(false);
  expect(state.data?.my_vehicles.map(v => v.vehicle_id)).toEqual(['old']);
  expect(state.totalEstimatedValue).toBe(0);
  await act(async () => root.render(<MemoryRouter><GarageTab dashboard={state} /></MemoryRouter>));
  expect(container.querySelector('a[href="/vehicle/car"]')).toBeNull();
  expect(container.querySelector('a[href="/vehicle/old"]')).not.toBeNull();
});

it('shows a pending-only garage with exact source context and no physical vehicle hydration or asset', async () => {
  fixture.rows.garage_owner_corrections = [{ id: 'raw', vehicle_id: null, observed_at: '2026-10-08',
    cover_image_url: null, source_excerpt: 'Synthetic shared interest, identity unknown.',
    correction: { unresolved_vehicle: { label: 'Synthetic shared vehicle', stated_roles: ['shared_interest'] } } }];
  await act(async () => root.render(<Harness />));
  expect(fixture.calls.find(c => c[0] === 'rpc' && c[1] === 'get_my_garage_owner_corrections')?.[2])
    .toEqual({ p_user_id: 'user', p_include_unresolved: true });
  expect(fixture.calls.some(c => c[0] === 'vehicles')).toBe(false);
  expect(state.vehicles).toEqual([]);
  expect(state.totalEstimatedValue).toBe(0);
  expect(state.data?.my_vehicles).toEqual([]);
  await act(async () => root.render(<MemoryRouter><GarageTab dashboard={state} /></MemoryRouter>));
  expect(container.textContent).toContain('Identity pending');
  expect(container.textContent).toContain('Synthetic shared vehicle');
  expect(container.querySelector('details')?.textContent).toContain('Synthetic shared interest, identity unknown.');
  expect(container.textContent).not.toContain('YOUR GARAGE IS EMPTY');
  expect([...container.querySelectorAll('a[href*="/vehicle/"]')].filter(link => link.getAttribute('href') !== '/vehicle/add')).toEqual([]);
});

it('withholds a previous viewer garage in the first render after identity change or sign-out', async () => {
  seedGarage(); await act(async () => root.render(<Harness />));
  snapshots.length = 0;
  await act(async () => root.render(<Harness viewer="other" />));
  expect(snapshots[0]).toMatchObject({ viewer: 'other', ids: [], loading: true });
  await act(async () => root.render(<Harness />));
  snapshots.length = 0;
  await act(async () => root.render(<Harness viewer={null} />));
  expect(snapshots[0]).toMatchObject({ viewer: null, ids: [], loading: false });
});

it.each(['records', 'error'])('withholds prior viewer %s throughout the next viewer deferred read', async (prior) => {
  seedGarage();
  fixture.rows.garage_owner_corrections = [{ id: 'private-source', vehicle_id: null, observed_at: '2026-10-08',
    correction: { unresolved_vehicle: { label: 'Private prior viewer source', stated_roles: ['shared_interest'] } },
    source_excerpt: 'Synthetic prior viewer testimony.' }];
  fixture.fail = prior === 'records' ? 'nuke_estimates' : 'vehicle_ownerships';
  await act(async () => root.render(<Harness />));
  if (prior === 'records') {
    expect(state.vehicles).toHaveLength(2); expect(state.unresolvedSources).toHaveLength(1); expect(state.warnings).not.toEqual([]);
  } else expect(state.error).not.toBeNull();

  let release!: () => void;
  fixture.hold = new Promise<void>(resolve => { release = resolve; });
  fixture.fail = ''; fixture.rows.garage_owner_corrections = [];
  fixture.rows.vehicle_ownerships = [period({ vehicle_id: 'other-car', owner_profile_id: 'other', role: 'owner', verification_id: null })];
  fixture.rows.vehicles = [{ ...fixture.rows.vehicles[0], id: 'other-car' }];
  snapshots.length = 0;
  await act(async () => root.render(<Harness viewer="other" />));
  await act(async () => root.render(<Harness viewer="other" />));
  expect(snapshots.length).toBeGreaterThanOrEqual(2);
  for (const snapshot of snapshots) expect(snapshot).toEqual({
    viewer: 'other', ids: [], loading: true, dataIds: [], sources: [], warnings: [], error: null,
  });
  await act(async () => release());
  expect(state.vehicles.map(v => v.id)).toEqual(['other-car']);
  expect(state.unresolvedSources).toEqual([]); expect(state.warnings).toEqual([]); expect(state.error).toBeNull();
});

it('retains known vehicle relationships when optional estimates fail and reports unavailable coverage', async () => {
  seedGarage(); fixture.fail = 'nuke_estimates';
  await act(async () => root.render(<Harness />));
  expect(state.error).toBeNull(); expect(state.vehicles).toHaveLength(2);
  expect(state.vehicles.every(v => v.estimated_value === null)).toBe(true);
  expect(state.warnings).toContain('Recorded estimates are unavailable. Vehicle relationships remain visible.');
});
it('marks optional event reads unavailable without inventing zero activity', async () => {
  seedGarage(); fixture.fail = 'vehicle_event_summary';
  await act(async () => root.render(<Harness />));
  expect(state.vehicles).toHaveLength(2);
  expect(state.vehicles.every(v => v.event_count === null)).toBe(true);
  expect(state.warnings).toContain('Event summaries are unavailable. Activity counts remain unknown.');
});

it('names real vehicle destinations and omits unsupported relationship and drag actions in every view', async () => {
  seedGarage(); await act(async () => root.render(<Harness />));
  const vehicle = state.vehicles[0];
  for (const viewMode of ['GRID','LIST','COMPACT'] as const) {
    await act(async () => root.render(<MemoryRouter><GarageVehicleCard vehicle={vehicle} viewMode={viewMode} /></MemoryRouter>));
    expect(container.querySelector('a[aria-label]')?.getAttribute('aria-label')).toContain('Open 1970 EXAMPLE CAR');
    expect(container.querySelector('a[aria-label]')?.getAttribute('href')).toBe(`/vehicle/${vehicle.id}`);
    expect(container.querySelector('a [role="button"],a button')).toBeNull();
    expect(container.querySelector('[draggable="true"]')).toBeNull();
    expect(container.textContent).not.toMatch(/ASSIGN RELATIONSHIP|CATEGORIZE|ADD PHOTOS/);
    if (viewMode !== 'COMPACT') expect(container.querySelector('.garage-card-open')?.textContent).toBe('View vehicle');
  }
  expect(fixture.calls.some(call => ['upsert','insert','update'].includes(call[1]))).toBe(false);
});

it('loads the garage when direct purchase-price reads are denied', async () => {
  seedGarage(); fixture.forbiddenVehicleColumns = ['purchase_price'];
  await act(async () => root.render(<Harness />));
  expect(state.error).toBeNull();
  expect(state.vehicles).toHaveLength(2);
  expect(state.vehicles.every(vehicle => vehicle.purchase_price === null)).toBe(true);
  expect(state.vehicles[0].estimated_value).toBe(12000);
});
