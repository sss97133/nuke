// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  pulse: {} as any, pulseError: null as any, transportFailure: false,
  results: {} as Record<string, any>, requests: [] as any[], held: null as Promise<any> | null,
  intake: null as any, intakeRequests: [] as string[],
}));
vi.mock('../lib/supabase', () => ({ supabase: {
  functions: { invoke: async (name: string) => {
    fixture.intakeRequests.push(name);
    return { data: fixture.intake, error: fixture.intake ? null : { message: 'unavailable' } };
  } },
  rpc: vi.fn(() => ({ abortSignal: async () => ({ data: fixture.pulse, error: fixture.pulseError }) })),
  from(table: string) {
    const request: any = { table, filter: '' };
    const builder: any = {
      select(_columns: string, options: any) { request.options = options; return builder; },
      eq(key: string, value: string) { request.filter = `${key}:${value}`; return builder; },
      order() { return builder; }, limit(n: number) { request.limit = n; return builder; },
      abortSignal(signal: AbortSignal) { request.signal = signal; return builder; },
      then(resolve: any, reject: any) {
        fixture.requests.push(request);
        const result = fixture.results[`${table}:${request.filter}`] ?? fixture.results[table] ?? { data: [], count: 100, error: null };
        return (fixture.held ?? (fixture.transportFailure ? Promise.reject(new Error('private transport body')) : Promise.resolve(result))).then(resolve, reject);
      },
    };
    return builder;
  },
} }));
import SystemStatus from './SystemStatus';

let root: Root, container: HTMLDivElement;
async function render() { await act(async () => root.render(<MemoryRouter><SystemStatus /></MemoryRouter>)); }
async function tick(ms: number) { await act(async () => vi.advanceTimersByTimeAsync(ms)); }
const row = (name: string) => [...container.querySelectorAll('tr')].find(r => r.textContent?.startsWith(name));

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.pulse = { days: 2, generated_at: '2026-10-05T12:00:00Z', degraded: null,
    organs: { vehicles: [{ d: '2026-10-05', n: 4 }], images: [], observations: [], auction_comments: [] },
    backlogs: { import_queue_pending: 0, images_analysis_pending_capped: 10001, images_analysis_failed_capped: 7, cap: 10001 } };
  fixture.pulseError = null; fixture.transportFailure = false; fixture.results = {}; fixture.requests = []; fixture.held = null;
  fixture.intake = null; fixture.intakeRequests = [];
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });

it('labels estimated totals and renders capped counts without converting them to zero', async () => {
  await render();
  expect(container.textContent).toContain('Estimated totals');
  expect(container.textContent).toContain('≈100');
  expect(container.textContent).toContain('images analysis pending: 10,000+');
  expect(container.textContent).toContain('failed: 7');
  const counts = fixture.requests.filter(r => r.options?.head);
  expect(counts).toHaveLength(12);
  expect(counts.every(r => r.options.count === 'planned' && r.limit === 0)).toBe(true);
  expect(fixture.requests.every(r => r.signal === counts[0].signal)).toBe(true);
});

it('keeps failed and missing counts unmeasured while preserving other estimates', async () => {
  fixture.results.vehicle_images = { count: null, data: [], error: { message: 'private failure' } };
  await render();
  expect(container.textContent).toContain('Some totals are unmeasured');
  expect(container.textContent).toContain('of Unmeasured images');
  expect(container.textContent).toContain('≈100');
  expect(container.textContent).not.toContain('private failure');
  expect(container.textContent).not.toContain('of ≈0 images');
});

it('distinguishes a failed organ from a successfully measured zero day', async () => {
  fixture.pulse.degraded = ['images: private query failure', 'comments: private query failure'];
  await render();
  expect(row('IMAGES')?.textContent).toContain('Unmeasured');
  expect(row('AUCTION COMMENTS')?.textContent).toContain('Unmeasured');
  expect(row('OBSERVATIONS')?.textContent).not.toContain('Unmeasured');
  expect(row('OBSERVATIONS')?.querySelectorAll('td')[1].textContent).toBe('0');
  expect(container.textContent).not.toContain('private query failure');
});

it('renders missing organs and missing backlog fields as unmeasured', async () => {
  delete fixture.pulse.organs.observations; fixture.pulse.backlogs = {};
  await render();
  expect(row('OBSERVATIONS')?.textContent).toContain('Unmeasured');
  expect(container.textContent).toContain('import_queue pending: Unmeasured');
  expect(container.textContent).toContain('images analysis pending: Unmeasured');
});

it('keeps the prior pulse dated and reports failed refreshes', async () => {
  await render();
  fixture.pulseError = { message: 'private rpc failure' };
  await tick(60_000);
  expect(container.textContent).toContain('Pipeline measurements unavailable. Showing the last received reading.');
  expect(row('VEHICLES')?.textContent).toContain('4');
  expect(container.textContent).not.toContain('private rpc failure');
});

it.each(['not-a-day', '2026-10-05T00:00:00Z', '2026-02-31', 'duplicate'])('withholds malformed or duplicate organ dates: %s', async (day) => {
  fixture.pulse.organs.vehicles = day === 'duplicate'
    ? [{ d: '2026-10-05', n: 4 }, { d: '2026-10-05', n: 7 }]
    : [{ d: day, n: 4 }];
  await render();
  const cells = [...row('VEHICLES')!.querySelectorAll('td')].slice(1);
  expect(cells.map(cell => cell.textContent)).toEqual(['Unmeasured', 'Unmeasured']);
  expect(row('OBSERVATIONS')?.querySelectorAll('td')[1].textContent).toBe('0');
});

it('refuses malformed pulse metadata without crashing or showing zeros', async () => {
  fixture.pulse.generated_at = 'invalid'; fixture.pulse.degraded = 'not-an-array';
  await render();
  expect(container.textContent).toContain('Pipeline measurements unavailable');
  expect(container.textContent).not.toContain('PIPELINE PULSE —');
});

it('does not poll every two seconds or overlap an unfinished totals read', async () => {
  fixture.held = new Promise(() => {});
  await render(); expect(fixture.requests).toHaveLength(1);
  await tick(120_000); expect(fixture.requests).toHaveLength(1);
});

it('reports a transport failure instead of leaving an endless loading message', async () => {
  fixture.transportFailure = true;
  await render();
  expect(container.textContent).toContain('System totals unavailable. Retrying each minute.');
  fixture.transportFailure = false;
  await tick(60_000);
  expect(container.textContent).toContain('ADMIN SYSTEM STATUS');
});
it('shows intake coverage through a failed totals read and does not re-fetch it when totals recover', async () => {
  fixture.transportFailure = true;
  fixture.intake = { contract: 'intake_status_v1', section: 'coverage', status: 'measured', measured_at: '2026-10-05T12:00:00Z', complete: true,
    rows: [{ source_slug: 'synthetic-source', total_targets: 10, in_queue: 0, extracted: 0, gap: 10, failed: 0, skipped: 0 }] };
  await render();
  expect(container.textContent).toContain('System totals unavailable');
  expect(container.textContent).toContain('0 completed queue matches / 10 known target URLs');
  fixture.transportFailure = false; await tick(60_000);
  expect(container.textContent).toContain('ADMIN SYSTEM STATUS');
  expect(fixture.intakeRequests).toHaveLength(3);
});

it('keeps exact capped and unavailable days separate within one degraded organ', async () => {
  fixture.pulse.days = 3;
  fixture.pulse.coverage = { contract: 'pipeline_pulse_capped_v1', timezone: 'UTC', backlogs: {} };
  fixture.pulse.degraded = ['vehicles: unavailable'];
  fixture.pulse.organs.vehicles = [
    { d: '2026-10-03', n: 0, status: 'exact', lower_bound: null },
    { d: '2026-10-04', n: null, status: 'capped', lower_bound: 10001 },
    { d: '2026-10-05', n: null, status: 'unavailable', lower_bound: null },
  ];
  await render();
  expect([...row('VEHICLES')!.querySelectorAll('td')].slice(1).map(cell => cell.textContent))
    .toEqual(['0', '≥10,001', 'Unmeasured']);
});

it('requires explicit day and backlog coverage under the capped contract', async () => {
  fixture.pulse.coverage = { contract: 'pipeline_pulse_capped_v1', timezone: 'UTC', backlogs: {
    import_queue_pending: { status: 'capped', n: null, lower_bound: 10001 },
  } };
  fixture.pulse.organs.vehicles = [{ d: '2026-10-05', n: 4, status: 'exact', lower_bound: null }];
  await render();
  expect([...row('VEHICLES')!.querySelectorAll('td')].slice(1).map(cell => cell.textContent))
    .toEqual(['Unmeasured', '4']);
  expect(container.textContent).toContain('import_queue pending: ≥10,001');
  expect(container.textContent).toContain('images analysis pending: Unmeasured');
});

it('rejects a capped sentinel mislabeled as an exact number', async () => {
  fixture.pulse.coverage = { contract: 'pipeline_pulse_capped_v1', timezone: 'UTC', backlogs: {} };
  fixture.pulse.organs.vehicles = [{ d: '2026-10-05', n: 10001, status: 'exact', lower_bound: null }];
  await render();
  expect([...row('VEHICLES')!.querySelectorAll('td')].slice(1).map(cell => cell.textContent))
    .toEqual(['Unmeasured', 'Unmeasured']);
});
