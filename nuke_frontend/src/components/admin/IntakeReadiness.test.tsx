// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ responses: {} as Record<string, any>, requests: [] as any[], held: null as Promise<any> | null }));
vi.mock('../../lib/supabase', () => ({ supabase: { functions: {
  invoke: vi.fn((name: string, options: any) => {
    fixture.requests.push({ name, options });
    return fixture.held ?? Promise.resolve(fixture.responses[name.split('=')[1]] ?? { error: { message: 'PRIVATE_FAILURE' } });
  }),
} } }));
import IntakeReadiness from './IntakeReadiness';
let root: Root, container: HTMLDivElement;
const clock = '2026-10-10T12:00:00Z';
async function render() { await act(async () => root.render(<IntakeReadiness />)); }
async function tick(ms: number) { await act(async () => vi.advanceTimersByTimeAsync(ms)); }

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(clock)); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.requests = []; fixture.held = null;
  fixture.responses = {
    coverage: { data: { contract: 'intake_status_v1', section: 'coverage', status: 'measured', measured_at: clock, complete: true,
      rows: [{ source_slug: 'synthetic-source', total_targets: 100, in_queue: 20, extracted: 10, gap: 80, failed: 2, skipped: 8 }] } },
    jobs: { data: { contract: 'intake_status_v1', section: 'jobs',
      config: { status: 'measured', measured_at: clock, rows: [{ jobname: 'synthetic-pull', present: true, active: true, schedule: '* * * * *' },
        { jobname: 'synthetic-paused', present: true, active: false, schedule: '* * * * *' }] },
      health: { status: 'measured', measured_at: clock, rows: [{ jobname: 'synthetic-pull', last_status: 'succeeded', assay_status: 'failed', health_status: 'failed', declared_writer: 'synthetic-writer' }] } } },
    model: { data: { contract: 'intake_status_v1', section: 'model', status: 'measured', measured_at: clock, complete: true,
      rows: [{ table_name: 'vehicle_observations', atlas_present: true, est_rows: 100, n_cols: 10, n_cols_described: 8, triggers: 2,
        registry_owners: ['synthetic-writer'], receipt_writers: null, last_write: null, receipt_undeclared_stmts: 0, receipt_sample_count: 0, receipt_sample_complete: true }],
      links: [{ child_table: 'vehicle_observations', parent_table: 'vehicle_events', constraint_name: 'synthetic_fk', validated: false }], links_complete: true } },
  };
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });

it('keeps URL denominators, queue completion and model delivery distinct', async () => {
  await render();
  expect(container.textContent).toContain('10 completed queue matches / 100 known target URLs');
  expect(container.textContent).toContain('Zero matches can coexist with retained source data');
  expect(container.textContent).toContain('does not prove a vehicle, sale or downstream answer');
  expect(fixture.requests).toHaveLength(3);
  expect(fixture.requests.every(r => r.options.method === 'GET' && r.options.signal instanceof AbortSignal)).toBe(true);
});
it('preserves successful execution alongside failed output and paused unmeasured jobs', async () => {
  await render(); const rows = [...container.querySelectorAll('tr')];
  const live = rows.find(r => r.textContent?.includes('synthetic-pull'))!;
  expect(live.textContent).toContain('succeeded'); expect(live.textContent).toContain('failed');
  expect(live.textContent).toContain('vehicle_observations');
  const paused = rows.find(r => r.textContent?.includes('synthetic-paused'))!;
  expect(paused.textContent).toContain('Paused'); expect(paused.textContent).toContain('Unmeasured');
  expect(container.textContent).toContain('Historical validation pending');
});
it('retains successful sections after an independent reading failure without leaking errors', async () => {
  fixture.responses.jobs = { error: { message: 'PRIVATE_FAILURE' } };
  await render();
  expect(container.textContent).toContain('Unavailable: jobs');
  expect(container.textContent).toContain('synthetic-source'); expect(container.textContent).toContain('MODEL RELATIONSHIPS');
  expect(container.textContent).not.toContain('PRIVATE_FAILURE');
});
it('keeps original clocks and values when a subsequent refresh fails', async () => {
  await render(); fixture.responses.coverage = { data: { contract: 'intake_status_v1', section: 'coverage', status: 'unavailable' } };
  await tick(300_000);
  expect(container.textContent).toContain('Unavailable: coverage');
  expect(container.textContent).toContain('10 completed queue matches / 100 known target URLs');
  expect(container.textContent).toContain(new Date(clock).toLocaleString());
});
it.each([false, 'inconsistent'])('withholds aggregate coverage for a capped or invalid denominator: %s', async (kind) => {
  if (kind === false) fixture.responses.coverage.data.complete = false;
  else fixture.responses.coverage.data.rows[0].extracted = 1000;
  await render(); expect(container.textContent).toContain('Overall target coverage unmeasured');
  expect(container.textContent).not.toContain('10 completed queue matches / 100');
});
it('does not poll each minute or overlap manual refreshes while a read is pending', async () => {
  fixture.held = new Promise(() => {}); await render(); await tick(60_000);
  expect(fixture.requests).toHaveLength(1);
  expect((container.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
});
it('finishes the metadata read before issuing aggregate reads and gives each a separate deadline', async () => {
  let release!: (value: any) => void;
  fixture.held = new Promise(resolve => { release = resolve; });
  await render();
  expect(fixture.requests.map(r => r.name)).toEqual(['db-stats?intake=model']);
  fixture.held = null;
  await act(async () => release(fixture.responses.model));
  expect(fixture.requests.map(r => r.name)).toEqual(['db-stats?intake=model', 'db-stats?intake=coverage', 'db-stats?intake=jobs']);
  expect(new Set(fixture.requests.map(r => r.options.signal)).size).toBe(3);
  expect(container.textContent).toContain('10 completed queue matches / 100 known target URLs');
});
it('does not turn unavailable job declarations into undeclared writers or absent owner matches', async () => {
  fixture.responses.jobs.data.health = { status: 'unavailable', measured_at: null, rows: [] };
  await render();
  const row = [...container.querySelectorAll('tr')].find(r => r.textContent?.includes('synthetic-pull'))!;
  expect(row.textContent).toContain('Owner mapping unmeasured');
  expect(row.textContent).not.toContain('Undeclared');
  expect(row.textContent).not.toContain('No exact owner match');
});
it('stops queued aggregate requests when the component unmounts', async () => {
  let release!: (value: any) => void;
  fixture.held = new Promise(resolve => { release = resolve; });
  await render();
  await act(async () => root.unmount());
  fixture.held = null;
  await act(async () => release(fixture.responses.model));
  expect(fixture.requests).toHaveLength(1);
  expect(fixture.requests[0].options.signal.aborted).toBe(true);
});
it.each(['coverage', 'model', 'jobs'])('rejects malformed %s row shapes while keeping other sections usable', async section => {
  if (section === 'jobs') fixture.responses.jobs.data.health.rows = {};
  else fixture.responses[section].data.rows = [null];
  await render(); expect(container.textContent).toContain(`Unavailable: ${section}`);
  expect(container.textContent).toContain(section === 'coverage' ? 'MODEL RELATIONSHIPS' : 'KNOWN SOURCE TARGETS');
});
