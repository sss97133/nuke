// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Synthetic offline contracts; no production testimony is created.
const fixture = vi.hoisted(() => ({
  route: { vehicleId: 'offline-vehicle', obsId: 'offline-observation' },
  read: vi.fn(), calls: [] as any[],
}));
vi.mock('react-router-dom', async original => ({
  ...await original<typeof import('react-router-dom')>(), useParams: () => fixture.route,
}));
vi.mock('../../lib/supabase', () => ({ supabase: { from(table: string) {
  const call = { table, filters: [] as any[], selected: '', limit: undefined as number | undefined,
    signal: undefined as AbortSignal | undefined };
  const query: any = {
    select: (selected: string) => { call.selected = selected; return query; },
    eq: (field: string, value: unknown) => { call.filters.push([field, value]); return query; },
    neq: () => query, filter: () => query, order: () => query,
    limit: (limit: number) => { call.limit = limit; return query; },
    abortSignal: (signal: AbortSignal) => { call.signal = signal; return query; },
    maybeSingle: () => query,
    then: (resolve: any, reject: any) => {
      fixture.calls.push(call); return Promise.resolve().then(() => fixture.read(call)).then(resolve, reject);
    },
  };
  return query;
} } }));
import ObservationPage from './ObservationPage';

const PARENT = 'offline-vehicle', OBS = 'offline-observation';
function observation(extra = {}) {
  return { id: OBS, vehicle_id: PARENT, kind: 'condition', observed_at: '2025-03-02T12:00:00Z',
    ingested_at: '2025-03-03T12:00:00Z', source_id: 'offline-source', confidence_score: 0,
    structured_data: { mileage: 731 }, is_superseded: false, superseded_by: null,
    observation_sources: { display_name: 'Offline source', slug: 'offline-source' }, ...extra };
}
function id(call: any, field = 'id') { return call.filters.find((f: any) => f[0] === field)?.[1]; }
function parent(call: any) { return { data: { id: id(call), year: 1965, make: 'Offline', model: 'Example' }, error: null }; }
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.route = { vehicleId: PARENT, obsId: OBS }; fixture.calls = []; fixture.read.mockReset();
  fixture.read.mockImplementation(call => call.table === 'vehicles' ? parent(call) : { data: observation(), error: null });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
async function mount() { await act(async () => root.render(<MemoryRouter><ObservationPage /></MemoryRouter>)); }

it('gates the parent before reading the observation and binds both URL IDs', async () => {
  await mount();
  expect(fixture.calls.map(c => c.table)).toEqual(['vehicles', 'vehicle_observations']);
  expect(fixture.calls[1].filters).toContainEqual(['id', OBS]);
  expect(fixture.calls[1].filters).toContainEqual(['vehicle_id', PARENT]);
  expect(fixture.calls.every(c => c.signal instanceof AbortSignal)).toBe(true);
  expect(host.querySelector('h1')?.textContent).toBe('Condition observation');
  expect(host.textContent).toContain('731');
  expect(host.textContent).toContain('0%');
  expect(host.textContent).toContain('offline-source');
});

it.each([
  { data: null, error: null },
  { data: null, error: { message: 'offline sensitive SQL and contact' } },
  { data: { id: 'offline-other-vehicle' }, error: null },
])('stops denied, failed or wrong parent responses before any child request: %j', async result => {
  fixture.read.mockResolvedValue(result); await mount();
  expect(fixture.calls.map(c => c.table)).toEqual(['vehicles']);
  expect(host.querySelector('h1')).toBeNull();
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  expect(host.textContent).not.toContain('sensitive');
  expect(host.textContent).not.toContain('731');
});

it.each([{ vehicle_id: 'offline-other-vehicle' }, { id: 'offline-other-observation' }])(
  'refuses a payload that contradicts the requested observation/vehicle binding: %j', async extra => {
    fixture.read.mockImplementation(call => call.table === 'vehicles' ? parent(call) : { data: observation(extra), error: null });
    await mount();
    expect(host.textContent).toContain('Observation unavailable for this vehicle.');
    expect(host.querySelector('h1')).toBeNull();
    expect(host.textContent).not.toContain('731');
  },
);

it.each([
  { data: null, error: null },
  { data: null, error: { message: 'offline private source and SQL' } },
])('keeps missing and failed children unavailable with sanitized messages: %j', async result => {
  fixture.read.mockImplementation(call => call.table === 'vehicles' ? parent(call) : result);
  await mount();
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  expect(host.textContent).not.toContain('private source');
  expect(host.textContent).not.toContain('SQL');
  expect(host.querySelector('h1')).toBeNull();
});

it('handles a rejected transport and finishes loading without exposing the error', async () => {
  fixture.read.mockRejectedValue(new Error('offline secret transport detail')); await mount();
  expect(host.textContent).toContain('Unable to load this observation. Try again.');
  expect(host.textContent).not.toContain('secret');
  expect(host.querySelector('[role=status]')).toBeNull();
});

it('withholds previous observation and related links when the route changes', async () => {
  await mount();
  let resolve: (value: any) => void = () => {};
  fixture.read.mockImplementation(() => new Promise(r => { resolve = r; }));
  fixture.route = { vehicleId: 'offline-next-vehicle', obsId: 'offline-next-observation' };
  await mount();
  expect(host.textContent).not.toContain('731');
  expect(host.textContent).not.toContain('Offline Example');
  expect(host.querySelector('h1')).toBeNull();
  await act(async () => resolve({ data: null, error: { message: 'offline sensitive failure' } }));
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  expect(host.textContent).not.toContain('731');
});

it('ignores a cancelled parent completion and never starts its child query', async () => {
  let release: (value: any) => void = () => {};
  fixture.read.mockImplementation(call => id(call) === PARENT
    ? new Promise(r => { release = r; }) : { data: null, error: null });
  await mount();
  const oldSignal = fixture.calls[0].signal;
  fixture.route = { vehicleId: 'offline-next-vehicle', obsId: 'offline-next-observation' }; await mount();
  expect(oldSignal.aborted).toBe(true);
  await act(async () => release({ data: { id: PARENT }, error: null }));
  expect(fixture.calls.every(c => c.table === 'vehicles')).toBe(true);
  expect(host.querySelector('h1')).toBeNull();
});

it('ignores a late child when only the observation ID changes', async () => {
  let release: (value: any) => void = () => {};
  fixture.read.mockImplementation(call => call.table === 'vehicles' ? parent(call)
    : id(call) === OBS ? new Promise(r => { release = r; })
    : { data: observation({ id: 'offline-next-observation', structured_data: { mileage: 902 } }), error: null });
  await mount();
  const oldSignal = fixture.calls.find(c => c.table === 'vehicle_observations').signal;
  fixture.route = { vehicleId: PARENT, obsId: 'offline-next-observation' }; await mount();
  expect(oldSignal.aborted).toBe(true);
  expect(host.textContent).toContain('902');
  await act(async () => release({ data: observation(), error: null }));
  expect(host.textContent).toContain('902');
  expect(host.textContent).not.toContain('731');
  expect(host.textContent).not.toContain(`id: ${OBS}`);
});

it('scopes supersession and related queries and refuses foreign lineage rows', async () => {
  fixture.read.mockImplementation(call => {
    if (call.table === 'vehicles') return parent(call);
    if (id(call) === OBS) return { data: observation({ superseded_by: 'offline-successor',
      structured_data: { mileage: 731, supersedes_original_id: 'offline-original', merchant: 'Offline workshop' } }), error: null };
    if (call.limit === 10) return { data: [observation({ id: 'offline-related' }), observation({ id: 'offline-foreign', vehicle_id: 'offline-other-vehicle' })], error: null };
    return { data: observation({ id: id(call), vehicle_id: 'offline-other-vehicle' }), error: null };
  });
  await mount();
  expect(fixture.calls.filter(c => c.table === 'vehicle_observations').every(c => id(c, 'vehicle_id') === PARENT)).toBe(true);
  expect(host.querySelector('a[href*="offline-related"]')).not.toBeNull();
  expect(host.querySelector('a[href*="offline-foreign"]')).toBeNull();
  expect(host.querySelector('a[href*="offline-original"]')).toBeNull();
  expect(host.querySelector('a[href*="offline-successor"]')).toBeNull();
});

it('keeps valid same-vehicle supersession links drillable', async () => {
  fixture.read.mockImplementation(call => call.table === 'vehicles' ? parent(call)
    : { data: observation({ id: id(call), superseded_by: id(call) === OBS ? 'offline-successor' : null }), error: null });
  await mount();
  expect(host.querySelector('a[href$="/observation/offline-successor"]')).not.toBeNull();
});

it.each(['vehicles', 'vehicle_observations'])('ends a stalled %s reader at a finite deadline rather than claiming an empty result', async table => {
  vi.useFakeTimers();
  fixture.read.mockImplementation(call => call.table !== table ? parent(call)
    : new Promise((_, reject) => call.signal.addEventListener('abort', () => reject(new Error('offline timeout')), { once: true })));
  await mount();
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(fixture.calls.map(c => c.table)).toEqual(table === 'vehicles' ? ['vehicles'] : ['vehicles', 'vehicle_observations']);
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  expect(host.querySelector('[role=status]')).toBeNull();
  expect(host.querySelector('h1')).toBeNull();
});
