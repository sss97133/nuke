// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
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
async function render() { await act(async () => root.render(<MemoryRouter><IntakeReadiness /></MemoryRouter>)); }
async function tick(ms: number) { await act(async () => vi.advanceTimersByTimeAsync(ms)); }

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(clock)); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.requests = []; fixture.held = null;
  fixture.responses = {
    consumers: { data: { contract: 'intake_status_v1', section: 'consumers', status: 'measured', measured_at: clock, complete: true,
      rows: [{ stack_id: 'SA', version: 1, name: 'Synthetic question', question: 'Which retained observations support the answer?', status: 'building',
        coverage: 0.5, n_needs: 2, n_present: 1, n_partial: 0, n_missing: 1, needs_complete: true,
        needs: [{ layer: 'log', kind: 'table', object: 'vehicle_observations', related_table: 'vehicle_observations', verdict: 'present', reason: null },
          { layer: 'fold', kind: 'abstract', object: 'synthetic fold', related_table: null, verdict: 'missing', reason: 'no table declared for this substrate' }] }] } },
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
  expect(fixture.requests).toHaveLength(4);
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
  expect(fixture.requests.map(r => r.name)).toEqual(['db-stats?intake=model', 'db-stats?intake=coverage', 'db-stats?intake=jobs', 'db-stats?intake=consumers']);
  expect(new Set(fixture.requests.map(r => r.options.signal)).size).toBe(4);
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

it('shows configured zero separately from provider failure and polling evidence', async () => {
  fixture.responses.jobs.data.controls = { status: 'measured', value: { enabled: true, max_feeds: 40, max_ingests: 20,
    sources: { synthetic: { enabled: true, max_ingests: 0 } } } };
  fixture.responses.jobs.data.feeds = { status: 'measured', measured_at: clock, complete: true,
    rows: [{ source_slug: 'synthetic', feeds: 2, enabled_feeds: 1, errored_feeds: 0, last_polled_at: clock,
      shortest_interval_minutes: 60, billing_blocked: false, rate_limited: false }] };
  await render();
  expect(container.textContent).toContain('Held at zero');
  expect(container.textContent).toContain('Monetary cost is unmeasured');
  expect(container.textContent).toContain('does not prove new data landed');
});

it('surfaces failed output and filters jobs without treating paused jobs as incidents', async () => {
  await render();
  const attention = [...container.querySelectorAll('h3')].find(h => h.textContent === 'NEEDS ATTENTION')!.parentElement!;
  expect(attention.textContent).toContain('synthetic-pull');
  expect(attention.textContent).not.toContain('synthetic-paused');
  const filter = [...container.querySelectorAll('button')].find(b => b.textContent === 'FAILURES')!;
  await act(async () => filter.click());
  expect(filter.getAttribute('aria-pressed')).toBe('true');
  const jobs = container.querySelector('#status-jobs')!;
  expect(jobs.textContent).toContain('synthetic-pull');
  expect(jobs.textContent).not.toContain('synthetic-paused');
});

it('shows execution-only fallback as an observability gap, not passed output', async () => {
  fixture.responses.jobs.data.health.output_measured = false;
  fixture.responses.jobs.data.health.rows[0].assay_status = null;
  fixture.responses.jobs.data.health.rows[0].health_status = null;
  await render();
  expect(container.textContent).toContain('Output assays unavailable. Execution readings remain available');
  expect(container.querySelector('#status-jobs')!.textContent).toContain('succeeded');
  expect(container.querySelector('#status-jobs')!.textContent).not.toContain('passed');
});

it('opens source details from the summary and navigates declared table relationships', async () => {
  fixture.responses.model.data.rows.push({ ...fixture.responses.model.data.rows[0], table_name: 'vehicle_events' });
  await render();
  await act(async () => (container.querySelector('a[href="#status-sources"]') as HTMLAnchorElement).click());
  expect((container.querySelector('#status-sources') as HTMLDetailsElement).open).toBe(true);
  const relationship = [...container.querySelectorAll('button')].find(b => b.textContent === 'vehicle_events →')!;
  await act(async () => relationship.click());
  expect((container.querySelector('select') as HTMLSelectElement).value).toBe('vehicle_events');
  expect(container.textContent).toContain('Referenced by');
  expect(container.textContent).toContain('vehicle_observations →');
});

it('exposes declared consumer gaps and drills a dependency into its table owners', async () => {
  await render();
  expect(container.textContent).toContain('1 present · 0 partial · 1 missing / 2 dependency declarations');
  expect(container.textContent).toContain('Registry structure, not verified answers');
  expect(container.textContent).toContain('no table declared for this substrate');
  const link = container.querySelector('#status-consumers a[href="#status-model"]') as HTMLAnchorElement;
  await act(async () => link.click());
  expect((container.querySelector('#status-model') as HTMLDetailsElement).open).toBe(true);
  expect((container.querySelector('select[aria-label="Inspect table"]') as HTMLSelectElement).value).toBe('vehicle_observations');
  const search = container.querySelector('input[type="search"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'no matching question');
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(container.querySelector('#status-consumers')!.textContent).toContain('No question matches');
});

it('does not count paused jobs as execution readings for enabled jobs', async () => {
  fixture.responses.jobs.data.health.rows.push({ jobname: 'synthetic-paused', last_status: 'succeeded',
    assay_status: null, health_status: 'paused', declared_writer: null });
  await render();
  expect(container.textContent).toContain('1 execution readings / 1 enabled jobs');
  expect(container.textContent).not.toContain('2 execution readings / 1 enabled jobs');
});

it('withholds consumer aggregates on overflow and rejects malformed declared counts', async () => {
  fixture.responses.consumers.data.complete = false;
  await render();
  expect(container.textContent).toContain('aggregate totals withheld');
  expect(container.textContent).not.toContain('1 present · 0 partial · 1 missing / 2');
  fixture.responses.consumers.data = structuredClone(fixture.responses.consumers.data);
  fixture.responses.consumers.data.rows[0].n_present = 20;
  await tick(300_000);
  expect(container.textContent).toContain('Unavailable: consumers');
  expect(container.textContent).not.toContain('20 / 2');
});
