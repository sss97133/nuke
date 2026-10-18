// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Offline reader contracts only; these fixtures never enter production.
const fixture = vi.hoisted(() => ({
  route: { vehicleId: 'offline-vehicle', date: '2026-04-03' },
  read: vi.fn(), calls: [] as any[],
}));
vi.mock('react-router-dom', async original => ({
  ...await original<typeof import('react-router-dom')>(), useParams: () => fixture.route,
}));
vi.mock('../../lib/supabase', () => {
  function query(table: string, params?: unknown) {
    const call = { table, params, filters: [] as any[], limit: undefined as number | undefined, signal: undefined as AbortSignal | undefined };
    const q: any = {
      select: () => q,
      eq: (field: string, value: unknown) => { call.filters.push(['eq', field, value]); return q; },
      gte: (field: string, value: unknown) => { call.filters.push(['gte', field, value]); return q; },
      lt: (field: string, value: unknown) => { call.filters.push(['lt', field, value]); return q; },
      order: () => q, maybeSingle: () => q,
      limit: (limit: number) => { call.limit = limit; return q; },
      abortSignal: (signal: AbortSignal) => { call.signal = signal; return q; },
      then: (resolve: any, reject: any) => {
        fixture.calls.push(call); return Promise.resolve().then(() => fixture.read(call)).then(resolve, reject);
      },
    }; return q;
  }
  return { supabase: { from: query, rpc: query } };
});
vi.mock('./DayCard', () => ({ default: ({ detail }: any) => <div data-testid="day-detail">{detail.vehicle.id}:{detail.receipt_date}</div> }));
import DayPage from './DayPage';

const PARENT = 'offline-vehicle', DATE = '2026-04-03';
function parent(call: any) { return { data: { id: call.filters.find((f: any) => f[1] === 'id')?.[2], year: 1965, make: 'Offline', model: 'Example' }, error: null }; }
function observation(extra = {}) { return { id: 'offline-observation', vehicle_id: PARENT, kind: 'condition', observed_at: DATE + 'T12:00:00Z', ingested_at: DATE + 'T13:00:00Z', confidence_score: null, structured_data: { mileage: 731 }, ...extra }; }
function receipt(extra = {}) { return { vehicle: { id: PARENT }, receipt_date: DATE, photo_count: 2, parts_count: 3, photos: [], component_events: [], line_items: [], summary: {}, ...extra }; }
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.route = { vehicleId: PARENT, date: DATE }; fixture.calls = []; fixture.read.mockReset();
  fixture.read.mockImplementation(call => call.table === 'vehicles' ? parent(call) : { data: call.table === 'get_daily_work_receipt' ? receipt() : [observation()], error: null });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
async function mount() { await act(async () => root.render(<MemoryRouter><DayPage /></MemoryRouter>)); }

it('gates both day readers on the visible parent and uses a bounded half-open UTC event interval', async () => {
  await mount();
  expect(fixture.calls.map(c => c.table)).toEqual(['vehicles', 'get_daily_work_receipt', 'vehicle_observations']);
  expect(fixture.calls[1].params).toEqual({ p_vehicle_id: PARENT, p_date: DATE });
  expect(fixture.calls[2].filters).toContainEqual(['eq', 'vehicle_id', PARENT]);
  expect(fixture.calls[2].filters).toContainEqual(['gte', 'observed_at', DATE + 'T00:00:00Z']);
  expect(fixture.calls[2].filters).toContainEqual(['lt', 'observed_at', '2026-04-04T00:00:00.000Z']);
  expect(fixture.calls[2].limit).toBe(500);
  expect(fixture.calls.every(c => c.signal instanceof AbortSignal)).toBe(true);
  expect(host.textContent).toContain('2 PHOTOS · 3 PART ITEMS');
});

it.each([{ data: null, error: null }, { data: null, error: { message: 'offline sensitive SQL' } }, { data: { id: 'offline-other' }, error: null }])(
  'stops denied, failed and contradictory parent responses before either child read: %j', async response => {
    fixture.read.mockResolvedValue(response); await mount();
    expect(fixture.calls.map(c => c.table)).toEqual(['vehicles']);
    expect(host.querySelector('[role=alert]')).not.toBeNull();
    expect(host.textContent).not.toContain('0 PHOTOS');
    expect(host.textContent).not.toContain('sensitive');
    expect(host.querySelector('[data-testid=day-detail]')).toBeNull();
  },
);

it.each(['2026-02-30', '2026-13-03', 'not-a-date', '2026-4-3'])(
  'rejects impossible or malformed calendar dates without any read: %s', async date => {
    fixture.route.date = date; await mount();
    expect(fixture.calls).toEqual([]); expect(host.textContent).toContain('Invalid calendar date.');
  },
);

it.each([DATE + 'T00:00:00.000001Z', DATE + 'T23:59:59.999999Z'])(
  'retains valid source events at both sub-millisecond day boundaries: %s', async observed_at => {
    fixture.read.mockImplementation(c => c.table === 'vehicles' ? parent(c) : { data: c.table === 'get_daily_work_receipt' ? null : [observation({ observed_at })], error: null });
    await mount(); expect(host.textContent).toContain('1 OBSERVATIONS RETURNED');
    expect(host.textContent).not.toContain('Observations unavailable');
  },
);

it.each([{ vehicle_id: 'offline-other' }, { observed_at: '2026-04-04T00:00:00Z' }, { observed_at: null }])(
  'refuses a collection whose response contradicts its vehicle or UTC day: %j', async extra => {
    fixture.read.mockImplementation(c => c.table === 'vehicles' ? parent(c) : { data: c.table === 'get_daily_work_receipt' ? receipt() : [observation(extra)], error: null });
    await mount(); expect(host.textContent).toContain('Observations unavailable');
    expect(host.textContent).not.toContain('OBSERVATIONS RETURNED');
    expect(host.querySelector('[data-testid=day-detail]')).not.toBeNull();
  },
);

it.each([{ vehicle: { id: 'offline-other' } }, { receipt_date: '2026-04-04' }, { error: 'offline private details' }])(
  'keeps a contradictory or error-shaped receipt unavailable while preserving qualified observations: %j', async extra => {
    fixture.read.mockImplementation(c => c.table === 'vehicles' ? parent(c) : { data: c.table === 'get_daily_work_receipt' ? receipt(extra) : [observation()], error: null });
    await mount(); expect(host.textContent).toContain('Build-log details unavailable');
    expect(host.textContent).toContain('1 OBSERVATIONS RETURNED');
    expect(host.querySelector('[data-testid=day-detail]')).toBeNull();
    expect(host.textContent).not.toContain('private');
  },
);

it.each(['get_daily_work_receipt', 'vehicle_observations'])('isolates a rejected %s transport without manufacturing zeros for it', async table => {
  fixture.read.mockImplementation(c => c.table === table ? Promise.reject(new Error('offline private transport')) : c.table === 'vehicles' ? parent(c) : { data: c.table === 'get_daily_work_receipt' ? receipt() : [observation()], error: null });
  await mount(); expect(host.textContent).not.toContain('private transport');
  expect(host.textContent).toContain(table === 'get_daily_work_receipt' ? 'Build-log details unavailable' : 'Observations unavailable');
  if (table === 'get_daily_work_receipt') {
    expect(host.textContent).not.toContain('0 PHOTOS'); expect(host.textContent).toContain('1 OBSERVATIONS RETURNED');
  } else expect(host.querySelector('[data-testid=day-detail]')).not.toBeNull();
});

it('distinguishes a completed empty observation read from a failed or missing receipt', async () => {
  fixture.read.mockImplementation(c => c.table === 'vehicles' ? parent(c) : { data: c.table === 'get_daily_work_receipt' ? null : [], error: null });
  await mount(); expect(host.textContent).toContain('0 OBSERVATIONS RETURNED');
  expect(host.textContent).toContain('No build-log details returned');
  expect(host.textContent).not.toContain('0 PHOTOS');
});

it('labels a full read-limit response without claiming complete evidence coverage', async () => {
  fixture.read.mockImplementation(c => c.table === 'vehicles' ? parent(c) : { data: c.table === 'get_daily_work_receipt' ? null : Array.from({ length: 500 }, (_, i) => observation({ id: `offline-${i}` })), error: null });
  await mount(); expect(host.textContent).toContain('READ LIMIT 500; MORE MAY EXIST');
});

it('uses UTC row times and keeps the keyboard drill on the bound parent', async () => {
  fixture.read.mockImplementation(c => c.table === 'vehicles' ? parent(c) : { data: c.table === 'get_daily_work_receipt' ? null : [observation({ observed_at: DATE + 'T23:00:00Z' })], error: null });
  await mount(); const button = host.querySelector('button')!;
  expect(button.textContent).toContain('23:00'); expect(button.getAttribute('aria-expanded')).toBe('false');
  await act(async () => button.click()); expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(host.querySelector('a[href$="/observation/offline-observation"]')?.getAttribute('href')).toBe(`/vehicle/${PARENT}/observation/offline-observation`);
});

it('hides previous-day evidence immediately and ignores a late cancelled response', async () => {
  const oldResolvers: Array<() => void> = [];
  fixture.read.mockImplementation(c => c.table === 'vehicles' ? parent(c) : new Promise(resolve => {
    oldResolvers.push(() => resolve({ data: c.table === 'get_daily_work_receipt' ? receipt() : [observation()], error: null }));
  }));
  await mount(); const oldCalls = [...fixture.calls];
  fixture.route = { vehicleId: 'offline-second', date: '2026-04-04' };
  fixture.read.mockImplementation(c => c.table === 'vehicles' ? parent(c) : { data: c.table === 'get_daily_work_receipt' ? null : [], error: null });
  await mount(); await act(async () => oldResolvers.forEach(resolve => resolve()));
  expect(oldCalls.every(c => c.signal.aborted)).toBe(true);
  expect(host.querySelector('[data-testid=day-detail]')).toBeNull();
  expect(host.textContent).not.toContain('2 PHOTOS');
  expect(host.textContent).toContain('0 OBSERVATIONS RETURNED');
});

it('withholds already rendered evidence while a new subject parent read is pending', async () => {
  await mount(); expect(host.textContent).toContain('2 PHOTOS');
  fixture.route = { vehicleId: 'offline-second', date: '2026-04-04' };
  fixture.read.mockImplementation(() => new Promise(() => {}));
  await mount(); expect(host.textContent).not.toContain('2 PHOTOS');
  expect(host.textContent).not.toContain('1 OBSERVATIONS RETURNED');
  expect(host.querySelector('[data-testid=day-detail]')).toBeNull();
  expect(host.textContent).toContain('Loading day');
});

it.each(['vehicles', 'get_daily_work_receipt'])('bounds a stalled %s read with cancellation and a deliberate unavailable state', async table => {
  vi.useFakeTimers();
  fixture.read.mockImplementation(c => c.table === table ? new Promise(resolve => c.signal.addEventListener('abort', () => resolve({ data: null, error: { message: 'offline abort' } }))) : c.table === 'vehicles' ? parent(c) : { data: [], error: null });
  await mount(); await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(host.querySelector('[role=status]')).toBeNull();
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  expect(host.textContent).not.toContain('offline abort');
});
