// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ responses: {} as Record<string, any>, requests: [] as any[], held: null as Promise<any> | null,
  book: null as any, bookCalls: 0 }));
vi.mock('../../pages/stacks/orderBookReader', async importOriginal => ({
  ...await importOriginal<typeof import('../../pages/stacks/orderBookReader')>(),
  useOrderBook: () => { fixture.bookCalls++; return fixture.book; },
}));
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
  fixture.requests = []; fixture.held = null; fixture.bookCalls = 0; fixture.book = { isPending: true };
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
it('links resolved public sources to their canonical profile inventory and leaves unresolved sources explicit', async () => {
  const source = fixture.responses.coverage.data.rows[0];
  source.organization_id = '11111111-1111-1111-1111-111111111111'; source.display_name = 'Synthetic Source';
  await render();
  expect(container.querySelector('#status-sources tbody a')?.getAttribute('href')).toBe('/org/11111111-1111-1111-1111-111111111111#source-targets');
  expect(container.querySelector('#status-sources tbody a')?.textContent).toContain('Synthetic Source');
  source.organization_id = null;
  await tick(300_000);
  expect(container.querySelector('#status-sources tbody a')).toBeNull();
  expect(container.textContent).toContain('Public profile unavailable');
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
  expect(fixture.requests.map(r => r.name)).toEqual(['db-stats?intake=model', 'db-stats?intake=consumers', 'db-stats?intake=coverage', 'db-stats?intake=jobs']);
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
  expect(container.querySelector('.status-flow')?.textContent).toContain('Failure readings unmeasured');
  expect(container.querySelector('.status-flow')?.textContent).not.toContain('0 reporting failure');
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

it('preserves an independently measured fold while naming only the unavailable checks', async () => {
  const jobs = fixture.responses.jobs.data;
  jobs.config.rows.push({ jobname: 'synthetic-fold', present: true, active: true, schedule: '* * * * *' });
  jobs.health.rows[0].assay_status = null; jobs.health.rows[0].health_status = null;
  jobs.health.rows.push({ jobname: 'synthetic-fold', last_status: 'succeeded', assay_status: 'passed',
    health_status: 'passed', declared_writer: 'synthetic-writer', last_run_at: clock });
  jobs.health.output_measured = false;
  jobs.health_scope = ['synthetic-pull', 'synthetic-fold'];
  jobs.health.readings = [
    { jobname: 'synthetic-pull', status: 'unavailable', measured_at: null, reason: 'query_unavailable' },
    { jobname: 'synthetic-fold', status: 'measured', measured_at: clock, reason: null },
  ];
  await render();
  expect(container.textContent).toContain('Health readings unavailable for synthetic-pull. Other checks retain their own results.');
  expect(container.textContent).toContain('1 / 2 job health readings measured independently');
  const fold = [...container.querySelectorAll('#status-jobs tr')].find(row => row.textContent?.includes('synthetic-fold'))!;
  expect(fold.textContent).toContain('passed');
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

it('keeps execution tables folded until requested and leads with declared live or showable questions', async () => {
  fixture.responses.consumers.data.rows.push({ ...structuredClone(fixture.responses.consumers.data.rows[0]),
    stack_id: 'S03', name: 'Synthetic showable question', status: 'showable' });
  await render();
  expect((container.querySelector('#status-job-readings') as HTMLDetailsElement).open).toBe(false);
  expect(container.querySelector('#status-consumers > div > table > tbody > tr')!.textContent).toContain('Synthetic showable question');
  await act(async () => (container.querySelector('a[href="#status-jobs"]') as HTMLAnchorElement).click());
  expect((container.querySelector('#status-job-readings') as HTMLDetailsElement).open).toBe(true);
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

it('traces a failed output check to declared consumers without claiming affected records', async () => {
  fixture.responses.jobs.data.health.rows[0].assay_counts = { failed: 4, pending: 12 };
  fixture.responses.consumers.data.rows.push({ ...structuredClone(fixture.responses.consumers.data.rows[0]),
    stack_id: 'S03', name: 'Unrelated question', needs: [{ layer: 'log', kind: 'table', object: 'auction_events',
      related_table: 'auction_events', verdict: 'present', reason: null },
      { layer: 'fold', kind: 'abstract', object: 'other fold', related_table: null, verdict: 'missing', reason: null }] });
  await render();
  const incident = container.querySelector('.status-incident')!;
  expect(incident.textContent).toContain('OUTPUT CHECK FAILED');
  expect(incident.textContent).toContain('Execution: succeeded');
  expect(incident.textContent).toContain('this does not identify affected records');
  expect(incident.querySelector('dd')?.textContent).toBe('4');
  await act(async () => (incident.querySelector('a[href="#status-consumers"]') as HTMLAnchorElement).click());
  expect((container.querySelector('#status-consumers') as HTMLDetailsElement).open).toBe(true);
  expect(container.querySelector('#status-consumers')?.textContent).toContain('Synthetic question');
  expect(container.querySelector('#status-consumers')?.textContent).not.toContain('Unrelated question');
  await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === 'Clear table filter')!.click());
  expect(container.querySelector('#status-consumers')?.textContent).toContain('Unrelated question');
});

it('leaves undeclared failure consequences unmeasured rather than guessing consumers', async () => {
  fixture.responses.jobs.data.health.rows[0].declared_writer = null;
  await render();
  const incident = container.querySelector('.status-incident')!;
  expect(incident.textContent).toContain('affected records and questions are unmeasured');
  expect(incident.textContent).not.toContain('Inspect declared consumers');
});

it('shows the canonical retained replay on load and preserves its bid states with their clocks', async () => {
  const first = '2026-10-09T12:00:00Z', last = '2026-10-10T11:00:00Z';
  fixture.book = { isPending: false, isError: false, refetch: vi.fn(), data: {
    vehicle: { id: 'synthetic-vehicle', year: 2000, make: 'Synthetic', model: 'Model' },
    lot: { source_url: 'https://bringatrailer.com/listing/synthetic/', auction_end_date: '2026-10-12T12:00:00Z', total_bids: 2, updated_at: clock },
    lots: [], unkeyedOnUrl: 0, frames: [], readAt: clock,
    identities: { one: { id: 'one', handle: 'first' }, two: { id: 'two', handle: 'second' } },
    comments: [{ id: 'bid-one', posted_at: first, created_at: last, comment_type: 'bid', bid_amount: 12000, external_identity_id: 'one', bat_comment_id: 1 },
      { id: 'bid-two', posted_at: last, created_at: clock, comment_type: 'bid', bid_amount: 20000, external_identity_id: 'two', bat_comment_id: 2 }],
  } };
  await render(); expect(fixture.bookCalls).toBeGreaterThan(0);
  let answer = container.querySelector('.status-replay-answer')!;
  expect(answer.textContent).toContain('$20,000'); expect(answer.textContent).toContain('2 keyed identities');
  await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === 'First bid')!.click());
  answer = container.querySelector('.status-replay-answer')!;
  expect(answer.textContent).toContain('$12,000'); expect(answer.textContent).toContain('1 keyed identities');
  expect(answer.textContent).toContain(timeForTest(first)); expect(answer.textContent).toContain(timeForTest(last));
  expect(answer.querySelector('a')?.getAttribute('href')).toBe('https://bringatrailer.com/listing/synthetic/#comment-1');
  expect(container.textContent).toContain('not a forecast or proof of what was known then');
  expect(container.querySelector('.status-replay-head a')?.getAttribute('href')).toContain('lot=88a000fd-fc51-4d02-a93a-84b159deea7e');
  fixture.book.isError = true; await render();
  expect(container.textContent).toContain('Refresh unavailable. Showing the retained reading');
  expect(container.querySelector('.status-replay-answer')?.textContent).toContain('$12,000');
});
const timeForTest = (s: string) => new Date(s).toLocaleString();

it('separates browser capture, acknowledged listing/sighting writes and linked observations with both clocks', async () => {
  const observed = '2026-10-10T11:58:00Z';
  fixture.responses.jobs.data.activity = { status: 'measured', measured_at: clock, window_hours: 24,
    limit_per_worker: 50, complete: true, rows: [{ run_id: 'capture-run', worker: 'extract-facebook-marketplace',
      started_at: clock, completed_at: clock, observed_at: observed, status: 'completed', scope_complete: false,
      actual_region: 'Synthetic region', retrieval_surface: 'native_browser', basis: 'declared_browser_capture',
      sources: [{ source: 'facebook_marketplace', counts: { captured_cards: 20, listing_rows_acknowledged: 18,
        sightings_verified: 17, linked_observation_receipts: 2, observation_errors: 1 }, reasons: [], consumer_usable: null }] }] };
  await render();
  const receipts = [...container.querySelectorAll('details')].find(d => d.querySelector('summary')?.textContent?.includes('Source intake receipts'))!;
  expect(receipts.textContent).toContain('facebook_marketplace'); expect(receipts.textContent).toContain('Synthetic region');
  expect(receipts.textContent).toContain(timeForTest(observed)); expect(receipts.textContent).toContain(timeForTest(clock));
  expect(receipts.textContent).toContain('Partial target surface');
  expect([...receipts.querySelectorAll('tbody td')].map(td => td.textContent)).toEqual(expect.arrayContaining(['20','18','17','2','1']));
  expect(receipts.textContent).toContain('Canonical property coverage and consumer usability remain unmeasured');
});
it('a malformed or unavailable activity reading does not hide independent job failure evidence', async () => {
  fixture.responses.jobs.data.activity = { status: 'measured', measured_at: clock, window_hours: 24,
    limit_per_worker: 50, complete: true, rows: [{ worker: 'unknown-worker', sources: [] }] };
  await render();
  expect(container.textContent).toContain('Source intake receipts unavailable');
  expect(container.textContent).toContain('synthetic-pull'); expect(container.textContent).toContain('reporting failure');
});
it('an empty measured receipt window reports unmeasured attempts rather than no source data', async () => {
  fixture.responses.jobs.data.activity = { status: 'measured', measured_at: clock, window_hours: 24,
    limit_per_worker: 50, complete: true, rows: [] };
  await render(); expect(container.textContent).toContain('No matching receipts in this measured window');
  expect(container.textContent).toContain('Source attempts and landing remain unmeasured');
});

it('offers a retry after an incomplete retained read without rendering invented results', async () => {
  fixture.book = { isPending: false, isError: true, data: null, refetch: vi.fn() };
  await render();
  expect(container.querySelector('.status-price')).toBeNull();
  expect(container.textContent).toContain('could not be read completely');
  await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === 'Retry retained lot')!.click());
  expect(fixture.book.refetch).toHaveBeenCalledOnce();
});
