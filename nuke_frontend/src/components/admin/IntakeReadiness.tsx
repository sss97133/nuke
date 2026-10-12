import { useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../../lib/supabase';
import PrefetchLink from '../PrefetchLink';
import { OrgLogo } from '../common/OrgLogo';
import { ORDER_BOOK_STACK } from '../../pages/stacks/stackDefinitions';
import { useOrderBook, shapeOrderBook } from '../../pages/stacks/orderBookReader';
import { VehicleIdentity } from '../common/MakeIdentity';
import './IntakeReadiness.css';

type Section = 'coverage' | 'model' | 'jobs' | 'consumers';
type Source = { source_slug: string; total_targets: number; in_queue: number; extracted: number; gap: number; failed: number; skipped: number;
  organization_id?: string | null; display_name?: string | null; base_url?: string | null };
type Table = { table_name: string; atlas_present: boolean; est_rows: number; n_cols: number; n_cols_described: number;
  registry_owners: string[] | null; receipt_writers: string[] | null; receipt_undeclared_stmts: number;
  receipt_sample_count: number; receipt_sample_complete: boolean; last_write: string | null; triggers: number };
type Edge = { constraint_name: string; child_table: string; parent_table: string; validated: boolean };
type Job = { jobname: string; present: boolean; active: boolean; schedule: string | null };
type Health = { jobname: string; declared_writer: string | null; last_status: string | null; last_run_at: string | null;
  assay_status: string | null; health_status: string | null; assay_counts?: Record<string, number> };
type Feed = { source_slug: string; feeds: number; enabled_feeds: number; errored_feeds: number;
  last_polled_at: string | null; shortest_interval_minutes: number | null; billing_blocked: boolean | null; rate_limited: boolean | null };
type SourceRun = { run_id: string; worker: string; started_at: string; completed_at: string | null;
  status: string; observed_at: string | null; retrieval_surface: string | null; actual_region: string | null;
  scope_complete: boolean | null; basis: string; reason: string | null; sources: { source: string; selected_targets?: number;
    attempted_targets?: number; unattempted_targets?: number; deferred_targets?: number; counts: Record<string, number | null> | null;
    reasons: string[]; consumer_usable: null }[] };
type Need = { layer: string; kind: string; object: string; verdict: 'present' | 'partial' | 'missing'; reason: string | null; related_table: string | null };
type Consumer = { stack_id: string; version: number; name: string; question: string; status: string; coverage: number | null;
  n_needs: number; n_present: number; n_partial: number; n_missing: number; needs_complete: boolean; needs: Need[] };
type Reading = { contract: string; section: Section; status?: string; measured_at?: string; complete?: boolean;
  rows?: Source[] | Table[] | Consumer[]; links?: Edge[]; links_complete?: boolean;
  config?: { status: string; measured_at: string; rows: Job[] };
  health?: { status: string; measured_at: string | null; rows: Health[]; output_measured?: boolean;
    readings?: { jobname: string; status: string; measured_at: string | null; reason: string | null }[] }; health_scope?: string[];
  feeds?: { status: string; measured_at: string | null; rows: Feed[]; complete: boolean };
  activity?: { status: string; measured_at: string | null; rows: SourceRun[]; complete: boolean;
    window_hours: number; limit_per_worker: number };
  controls?: { status: string; value?: { enabled: boolean; max_feeds: number; max_ingests: number;
    sources: Record<string, { enabled?: boolean; max_ingests?: number }> } } };

// Start with bounded metadata, then avoid overlapping the two aggregate readers.
const sections: Section[] = ['model', 'consumers', 'coverage', 'jobs'];
const count = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n.toLocaleString() : 'Unmeasured';
const time = (s: string | null | undefined) => s && Number.isFinite(Date.parse(s)) ? new Date(s).toLocaleString() : 'Unmeasured';
const validActivity = (reading: Reading['activity']) => reading?.status === 'measured'
  && Number.isFinite(Date.parse(reading.measured_at ?? '')) && reading.window_hours === 24
  && reading.limit_per_worker === 50 && typeof reading.complete === 'boolean' && Array.isArray(reading.rows)
  && reading.rows.length <= 100 && reading.rows.every(r => r && typeof r.run_id === 'string'
    && ['poll-listing-feeds', 'extract-facebook-marketplace'].includes(r.worker)
    && Number.isFinite(Date.parse(r.started_at)) && typeof r.status === 'string'
    && Array.isArray(r.sources) && r.sources.length <= 100 && r.sources.every(s => s
      && typeof s.source === 'string' && Array.isArray(s.reasons) && s.reasons.every(v => typeof v === 'string')
      && s.consumer_usable === null && (s.counts === null || typeof s.counts === 'object' && !Array.isArray(s.counts)
        && Object.values(s.counts).every(n => n === null || Number.isSafeInteger(n) && n >= 0))));
const sourceValid = (s: Source) => typeof s.source_slug === 'string' && s.source_slug.length > 0
  && [s.total_targets, s.in_queue, s.extracted, s.gap, s.failed, s.skipped].every(n => Number.isSafeInteger(n) && n >= 0)
  && s.in_queue <= s.total_targets && s.extracted <= s.in_queue && s.gap === s.total_targets - s.in_queue;
const names = (rows: any[], key: string, limit: number) => Array.isArray(rows) && rows.length <= limit
  && rows.every(r => r && typeof r[key] === 'string' && r[key].length > 0)
  && new Set(rows.map(r => r[key])).size === rows.length;
const strings = (value: unknown) => value === null || Array.isArray(value) && value.every(s => typeof s === 'string');
const consumerValid = (c: Consumer) => /^[A-Z0-9]+$/.test(c.stack_id)
  && Number.isSafeInteger(c.version) && c.version > 0 && typeof c.name === 'string' && typeof c.question === 'string'
  && ['proposed', 'measured', 'building', 'showable', 'live', 'retired'].includes(c.status)
  && [c.n_needs, c.n_present, c.n_partial, c.n_missing].every(n => Number.isSafeInteger(n) && n >= 0)
  && c.n_present + c.n_partial + c.n_missing === c.n_needs
  && (c.n_needs === 0 ? c.coverage === null : typeof c.coverage === 'number'
    && Number.isFinite(c.coverage) && Math.abs(c.coverage - c.n_present / c.n_needs) <= 0.0001)
  && typeof c.needs_complete === 'boolean' && Array.isArray(c.needs) && c.needs.length <= 64
  && (c.needs_complete ? c.needs.length === c.n_needs : c.needs.length === 64 && c.n_needs > 64)
  && (!c.needs_complete || c.needs.filter(n => n?.verdict === 'present').length === c.n_present
    && c.needs.filter(n => n?.verdict === 'partial').length === c.n_partial
    && c.needs.filter(n => n?.verdict === 'missing').length === c.n_missing)
  && c.needs.every(n => n && typeof n.object === 'string' && typeof n.layer === 'string' && typeof n.kind === 'string'
    && ['present', 'partial', 'missing'].includes(n.verdict) && (n.reason === null || typeof n.reason === 'string')
    && (n.related_table === null || typeof n.related_table === 'string' && /^[a-z_][a-z0-9_]*$/.test(n.related_table)));
const validControls = (controls: any) => controls === undefined || ['invalid', 'unavailable'].includes(controls?.status)
  || controls?.status === 'measured' && typeof controls.value?.enabled === 'boolean'
    && [controls.value.max_feeds, controls.value.max_ingests].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 100)
    && controls.value.sources && typeof controls.value.sources === 'object' && !Array.isArray(controls.value.sources)
    && Object.values(controls.value.sources).every((s: any) => s && typeof s.enabled === 'boolean'
      && Number.isSafeInteger(s.max_ingests) && s.max_ingests >= 0 && s.max_ingests <= 100);
function validReading(data: any, section: Section): data is Reading {
  if (data?.contract !== 'intake_status_v1' || data.section !== section) return false;
  if (section === 'jobs') return data.config?.status === 'measured'
    && Number.isFinite(Date.parse(data.config.measured_at)) && names(data.config.rows, 'jobname', 18)
    && data.health && ['measured', 'unavailable'].includes(data.health.status)
    && (data.health.status === 'unavailable' || Number.isFinite(Date.parse(data.health.measured_at))
      && names(data.health.rows, 'jobname', 10))
    && (data.health.readings === undefined || names(data.health.readings, 'jobname', 10)
      && data.health.readings.every((r: any) => ['measured', 'unavailable'].includes(r.status)
        && (r.measured_at === null || Number.isFinite(Date.parse(r.measured_at)))
        && (r.status !== 'measured' || r.measured_at !== null)
        && (r.status === 'measured' ? r.reason === null : r.reason !== null)
        && [null, 'reading_budget_exhausted', 'query_unavailable', 'assay_unavailable', 'job_absent'].includes(r.reason)))
    && validControls(data.controls)
    && (data.feeds === undefined || data.feeds.status === 'unavailable' || data.feeds.status === 'measured'
      && Number.isFinite(Date.parse(data.feeds.measured_at)) && names(data.feeds.rows, 'source_slug', 60)
      && typeof data.feeds.complete === 'boolean');
  if (data.status !== 'measured' || !Number.isFinite(Date.parse(data.measured_at))) return false;
  if (section === 'coverage') return names(data.rows, 'source_slug', 30) && typeof data.complete === 'boolean';
  if (section === 'consumers') return names(data.rows, 'stack_id', 100) && typeof data.complete === 'boolean'
    && data.rows.every(consumerValid);
  return names(data.rows, 'table_name', 14) && data.rows.every((t: Table) => strings(t.registry_owners) && strings(t.receipt_writers))
    && Array.isArray(data.links) && data.links.length <= 500 && typeof data.links_complete === 'boolean'
    && data.links.every((e: Edge) => e && typeof e.constraint_name === 'string' && typeof e.child_table === 'string'
      && typeof e.parent_table === 'string' && typeof e.validated === 'boolean');
}
const box = { border: '2px solid var(--border)', padding: 12, marginBottom: 16 };
const cell = { padding: '6px 8px', textAlign: 'left' as const, borderBottom: '1px solid var(--border)', verticalAlign: 'top' as const };
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 12 };
const label = { fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase' as const, fontWeight: 700 };
const lifecycleOrder = ['live', 'showable', 'building', 'measured', 'proposed', 'retired'];

// Purpose is from the canonical job owners; health and counts come from the live assay.
const jobPurpose: Record<string, string> = {
  'project-retained-listing-properties': 'Turns retained listing claims into attributed vehicle observations. Failed work or stale source custody prevents a clean output check.',
  'qualify-bat-archived-sales': 'Qualifies retained BaT captures as sale observations. Failed work, stale qualified evidence or stalled replay can fail this check.',
  'drain-sale-residual-fold': 'Maintains the sale residual fold from admitted sale evidence.',
};
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function RetainedBidReplay() {
  const demo = ORDER_BOOK_STACK.demonstration;
  const result = useOrderBook(demo.vehicleId, demo.auctionEventId);
  const [picked, setPicked] = useState<string | null>(null);
  const read = result.data;
  const view = read ? shapeOrderBook(read) : null;
  const selected = view?.states.find(s => s.bid.id === picked) ?? (view ? view.states[view.states.length - 1] : undefined);
  const route = `${ORDER_BOOK_STACK.route}/${demo.vehicleId}?lot=${demo.auctionEventId}`;
  if (result.isPending) return <p role="status">Reading the retained lot and its keyed bids…</p>;
  if (!read || !view || !selected) return <div role="status"><p>{result.isError
    ? 'The retained lot could not be read completely.' : 'No replayable bids returned for this retained lot.'}</p>
    <button type="button" onClick={() => void result.refetch()}>Retry retained lot</button></div>;
  const prices = view.states.map(s => s.price);
  const low = Math.min(...prices), high = Math.max(...prices);
  const x = (i: number) => 12 + i / Math.max(1, prices.length - 1) * 576;
  const y = (price: number) => 100 - (price - low) / Math.max(1, high - low) * 80;
  const keyed = view.bids.filter(b => b.keyed).length;
  const sourceUrl = /^https:\/\/bringatrailer\.com\/listing\/[^/?#]+\/?$/.test(read.lot!.source_url) ? read.lot!.source_url : null;
  return <div className="status-replay">
    <div className="status-replay-head">
      <VehicleIdentity year={read.vehicle.year} make={read.vehicle.make ?? ''} model={read.vehicle.model ?? ''} />
      <PrefetchLink to={route}>Open full evidence & missing layers →</PrefetchLink>
    </div>
    {result.isError && <p role="status">Refresh unavailable. Showing the retained reading from {time(read.readAt)}.</p>}
    <div className="status-trace" aria-label="Retained evidence path">
      <span><b>Source</b>BaT · one lot</span><span><b>Evidence</b>{count(view.partition.inWindow.length)} rows in the lot window</span>
      <span><b>Keys</b>{count(keyed)} / {count(view.bids.length)} bids linked to identities</span><span><b>Calculation</b>Book folded at each posted bid</span>
    </div>
    <div className="status-replay-grid">
      <div>
        <div className="status-kicker">HIGH BID BY BID SEQUENCE · USD</div>
        <svg viewBox="0 0 600 116" width="600" height="116" className="status-bid-chart" role="img" aria-label={`Retained bid prices from ${usd(low)} to ${usd(high)}; selected bid ${selected.index + 1}`}>
          <path d={`M 12 100 H 588`} fill="none" stroke="var(--border)" />
          <polyline points={prices.map((p, i) => `${x(i)},${y(p)}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" />
          <line x1={x(selected.index)} x2={x(selected.index)} y1="12" y2="104" stroke="currentColor" strokeDasharray="3 3" />
          <circle cx={x(selected.index)} cy={y(selected.price)} r="4" fill="currentColor" />
        </svg>
        <div className="status-chart-scale"><span>First retained: {usd(prices[0])}</span><span>Latest retained: {usd(prices[prices.length - 1])}</span></div>
        <div className="status-replay-controls">
          <button type="button" disabled={selected.index === 0} onClick={() => setPicked(view.states[0].bid.id)}>First bid</button>
          <label>Replay bid {selected.index + 1} / {view.states.length}
            <input type="range" aria-label="Replay bid" min="0" max={view.states.length - 1} value={selected.index}
              onChange={e => setPicked(view.states[Number(e.target.value)].bid.id)} />
          </label>
          <button type="button" disabled={selected.index === view.states.length - 1} onClick={() => setPicked(null)}>Latest retained</button>
        </div>
      </div>
      <div className="status-replay-answer" aria-live="polite">
        <div className="status-kicker">BOOK AT SELECTED BID</div>
        <strong className="status-price">{usd(selected.price)}</strong>
        <p>{count(selected.identities)} keyed identities · {count(selected.unresolved)} unresolved entries</p>
        <p>Posted {time(new Date(selected.bid.at).toISOString())}<br />Landed {time(selected.bid.landedAt == null ? null : new Date(selected.bid.landedAt).toISOString())}</p>
        {sourceUrl && <a href={`${sourceUrl.replace(/\/+$/, '')}/${selected.bid.batCommentId ? `#comment-${selected.bid.batCommentId}` : ''}`} target="_blank" rel="noopener noreferrer">Open source bid ↗</a>}
      </div>
    </div>
    <p className="status-basis">Event-time replay of retained bids. Each state uses bids posted through that point; landing clocks are shown separately. This is revealed bidding, not a forecast or proof of what was known then. Read {time(read.readAt)}.</p>
  </div>;
}

export default function IntakeReadiness({ arrivals }: { arrivals?: ReactNode }) {
  const [readings, setReadings] = useState<Partial<Record<Section, Reading>>>({});
  const [failed, setFailed] = useState<Section[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedTable, setSelectedTable] = useState('vehicle_observations');
  const [jobFilter, setJobFilter] = useState('all');
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [consumerSearch, setConsumerSearch] = useState('');
  const [consumerTableOnly, setConsumerTableOnly] = useState(false);
  const [consumerLimit, setConsumerLimit] = useState(8);
  const [consumerTables, setConsumerTables] = useState<string[]>([]);
  const [consumersOpen, setConsumersOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    const load = async (section: Section) => {
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]);
        const { data, error } = await supabase.functions.invoke(`db-stats?intake=${section}`, { method: 'GET', signal });
        if (error || !validReading(data, section)) throw new Error('unavailable');
        if (!cancelled) {
          setReadings(previous => ({ ...previous, [section]: data }));
          setFailed(previous => previous.filter(s => s !== section));
        }
      } catch {
        if (!cancelled) setFailed(previous => [...new Set([...previous, section])]);
      }
    };
    void (async () => {
      for (const section of sections) {
        if (cancelled) break;
        await load(section);
      }
      if (!cancelled) setLoading(false);
    })();
    const interval = setInterval(() => setRefresh(n => n + 1), 300_000);
    return () => { cancelled = true; controller.abort(); clearInterval(interval); };
  }, [refresh]);

  const coverage = readings.coverage;
  const sources = (coverage?.rows ?? []) as Source[];
  const totals = coverage?.complete === true && sources.length > 0 && sources.every(sourceValid)
    ? sources.reduce((sum, s) => ({ targets: sum.targets + s.total_targets, completed: sum.completed + s.extracted }), { targets: 0, completed: 0 }) : null;
  const model = readings.model;
  const tables = (model?.rows ?? []) as Table[];
  const observationRows = tables.find(t => t.table_name === 'vehicle_observations' && t.atlas_present)?.est_rows;
  const table = tables.find(t => t.table_name === selectedTable);
  const edges = (model?.links ?? []).filter(e => e.child_table === selectedTable || e.parent_table === selectedTable);
  const jobs = readings.jobs;
  const health = jobs?.health?.status === 'measured' ? jobs.health.rows : [];
  const config = jobs?.config?.rows ?? [];
  const activeJobs = config.filter(j => j.present && j.active === true);
  const pausedJobs = config.filter(j => j.present && j.active === false);
  const executionReadings = activeJobs.filter(j => health.some(h => h.jobname === j.jobname && typeof h.last_status === 'string')).length;
  const unavailableChecks = jobs?.health?.readings?.filter(r => r.status === 'unavailable') ?? [];
  const failedJobs = activeJobs.filter(j => {
    const h = health.find(h => h.jobname === j.jobname);
    return h?.last_status === 'failed' || h?.assay_status === 'failed' || h?.health_status === 'failed';
  });
  const visibleJobs = config.filter(j => jobFilter === 'all' || (jobFilter === 'active' ? j.active === true
    : jobFilter === 'paused' ? j.active === false : failedJobs.includes(j)));
  const feedProblems = jobs?.feeds?.status === 'measured' ? jobs.feeds.rows.filter(f => f.errored_feeds > 0) : [];
  const landingProblems = validActivity(jobs?.activity) ? jobs!.activity!.rows.flatMap(r => r.sources
    .filter(s => (s.counts?.ledger_write_failures ?? s.counts?.observation_errors ?? 0) > 0)
    .map(s => ({ run: r, source: s }))) : [];
  const receiptProblems = tables.filter(t => t.receipt_undeclared_stmts > 0);
  const parents = [...new Set(edges.filter(e => e.child_table === selectedTable).map(e => e.parent_table))];
  const children = [...new Set(edges.filter(e => e.parent_table === selectedTable).map(e => e.child_table))];
  const consumers = readings.consumers;
  const questions = (consumers?.rows ?? []) as Consumer[];
  const needsTotals = consumers?.complete && questions.length > 0
    ? questions.reduce((sum, q) => ({ total: sum.total + q.n_needs, present: sum.present + q.n_present,
      partial: sum.partial + q.n_partial, missing: sum.missing + q.n_missing }), { total: 0, present: 0, partial: 0, missing: 0 }) : null;
  const matchingQuestions = questions.filter(q => (!consumerTableOnly || q.needs.some(n => consumerTables.length
    ? consumerTables.includes(n.related_table ?? '') : n.related_table === selectedTable))
    && `${q.stack_id} ${q.name} ${q.question} ${q.needs.map(n => n.object).join(' ')}`.toLowerCase().includes(consumerSearch.toLowerCase().trim()))
    .sort((a, b) => lifecycleOrder.indexOf(a.status) - lifecycleOrder.indexOf(b.status)
      || b.n_present - a.n_present || a.stack_id.localeCompare(b.stack_id));

  return <section className="status-view" aria-labelledby="intake-readiness-title" style={{ ...box, fontSize: 11 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <h2 id="intake-readiness-title" style={{ fontSize: 14, margin: 0 }}>THE DATA MACHINE</h2>
      <button type="button" disabled={loading} onClick={() => setRefresh(n => n + 1)} style={{ fontSize: 11 }}>
        {loading ? 'Reading…' : 'Refresh intake readings'}
      </button>
    </div>
    <p className="status-basis">Follow what is captured, what is retained, what is processed and what can be answered. Readings refresh every five minutes.</p>
    {failed.length > 0 && <p role="status">Unavailable: {failed.join(', ')}. Retained readings below keep their original dates.</p>}

    <nav className="status-flow" aria-label="Explore the data flow">
      <a href="#status-sources" onClick={() => setSourcesOpen(true)}>
        <span className="status-kicker">01 · SOURCES</span><strong>{coverage ? count(sources.length) : '…'}</strong>
        <span>{coverage?.complete === false ? 'sources in returned inventory slice' : 'sources in target inventory'}</span><small>{totals ? `${count(totals.completed)} / ${count(totals.targets)} URL queue matches complete` : 'Coverage reading pending or unavailable'}{coverage && <><br />Read {time(coverage.measured_at)}</>}</small><em>Inspect capture gaps →</em>
      </a>
      <a href="#status-model" onClick={() => { setSelectedTable('vehicle_observations'); setModelOpen(true); }}>
        <span className="status-kicker">02 · RETAINED EVIDENCE</span><strong>{typeof observationRows === 'number' && Number.isFinite(observationRows) && observationRows >= 0 ? `≈${count(Math.round(observationRows))}` : 'Unmeasured'}</strong>
        <span>estimated vehicle observations</span><small>{model ? `${count(tables.length)} tables in this view · owners & keys` : 'Model reading pending or unavailable'}{model && <><br />Read {time(model.measured_at)}</>}</small><em>Trace evidence relationships →</em>
      </a>
      <a href="#status-jobs" onClick={() => setJobsOpen(true)} data-attention={failedJobs.length > 0}>
        <span className="status-kicker">03 · PROCESSING</span><strong>{jobs ? count(activeJobs.length) : '…'}</strong>
        <span>enabled in this view · {jobs ? count(pausedJobs.length) : '…'} paused</span><small>{jobs ? `${health.length ? `${count(failedJobs.length)} reporting failure` : 'Failure readings unmeasured'} · ${executionReadings} execution readings / ${activeJobs.length} enabled jobs` : 'Reading execution and output checks'}{jobs && <><br />Configuration {time(jobs.config?.measured_at)}</>}</small><em>Inspect execution & output →</em>
      </a>
      <a href="#status-consumers" onClick={() => setConsumersOpen(true)}>
        <span className="status-kicker">04 · QUESTIONS</span><strong>{consumers ? count(questions.length) : '…'}</strong>
        <span>{consumers?.complete === false ? 'questions in returned registry slice' : 'registered questions'}</span><small>{needsTotals ? `${count(needsTotals.present)} / ${count(needsTotals.total)} dependencies present · ${count(needsTotals.missing)} missing` : 'Dependency reading pending or unavailable'}{consumers && <><br />Read {time(consumers.measured_at)}</>}</small><em>Find a question & its gaps →</em>
      </a>
    </nav>
    <p className="status-basis">Independent readings of the same machine. URL completion, stored structure, job checks and delivered answers have different scopes.</p>

    <div className="status-operating-panels">
    {(failedJobs.length > 0 || feedProblems.length > 0 || landingProblems.length > 0 || receiptProblems.length > 0 || jobs?.health?.output_measured === false || jobs?.health?.status === 'unavailable') &&
      <div className="status-attention">
        <h3 style={label}>NEEDS ATTENTION</h3>
        {failedJobs.map(j => {
          const h = health.find(h => h.jobname === j.jobname);
          const owned = h?.declared_writer ? tables.filter(t => t.registry_owners?.includes(h.declared_writer!)).map(t => t.table_name) : [];
          const related = questions.filter(q => q.needs.some(n => owned.includes(n.related_table ?? '')));
          const counts = Object.entries(h?.assay_counts ?? {}).filter(([key, n]) => /^[a-z_]+$/.test(key) && Number.isSafeInteger(n) && n >= 0);
          return <details key={j.jobname} className="status-incident">
            <summary><span className="status-kicker">{h?.assay_status === 'failed' ? 'OUTPUT CHECK FAILED' : h?.last_status === 'failed' ? 'EXECUTION FAILED' : 'HEALTH CHECK FAILED'}</span>
              <strong>{j.jobname}</strong>{typeof h?.assay_counts?.failed === 'number' && Number.isSafeInteger(h.assay_counts.failed) && h.assay_counts.failed > 0 && <span>{count(h.assay_counts.failed)} failed work items</span>}</summary>
            <div><p>{jobPurpose[j.jobname] ?? (owned.length ? `Declared writer for ${owned.join(', ')}.` : 'The canonical check reports a failure; its owner-to-consumer path is unmeasured in this scope.')}</p>
              {counts.length > 0 && <dl className="status-assay-counts">{counts.map(([key, n]) => <div key={key}><dt>{key.replace(/_/g, ' ')}</dt><dd>{count(n)}</dd></div>)}</dl>}
              <p className="status-basis">Execution: {h?.last_status ?? 'unmeasured'} · {time(h?.last_run_at)}. {owned.length ? `${related.length} registered questions declare these tables; this does not identify affected records.` : 'No exact writer-to-table declaration returned; affected records and questions are unmeasured.'}</p>
            </div>
            <div className="status-incident-actions"><a href="#status-jobs" onClick={() => { setJobFilter('failures'); setJobsOpen(true); }}>Inspect failed checks →</a>
              {related.length > 0 && <a href="#status-consumers" onClick={() => { setConsumerTables(owned); setConsumerTableOnly(true); setConsumerSearch(''); setConsumerLimit(8); setConsumersOpen(true); }}>Inspect declared consumers →</a>}
            </div>
          </details>;
        })}
        {feedProblems.length > 0 && <details className="status-reading-gap"><summary>{feedProblems.length} sources report feed errors</summary><p>{feedProblems.map(f => f.source_slug).join(', ')} · enabled feeds report errors. Capture freshness needs inspection. <PrefetchLink to="/admin/sources">Inspect sources →</PrefetchLink></p></details>}
        {landingProblems.length > 0 && <details className="status-reading-gap"><summary>{landingProblems.length} source-run receipts report landing failures</summary>
          <p>{landingProblems.map(p => `${p.source.source} · ${time(p.run.started_at)}`).join('; ')}.
            A completed run does not establish acknowledged landing. <a href="#status-jobs" onClick={() => setJobsOpen(true)}>Inspect source receipts →</a></p></details>}
        {receiptProblems.length > 0 && <p>{receiptProblems.map(t => t.table_name).join(', ')} · undeclared writers in the latest receipt sample. <a href="#status-model" onClick={() => setModelOpen(true)}>Inspect model →</a></p>}
        {(jobs?.health?.output_measured === false || jobs?.health?.status === 'unavailable') && <details className="status-reading-gap"><summary>Missing health readings · {unavailableChecks.length || 'scope unmeasured'}</summary><p>{unavailableChecks.length > 0
          ? `Health readings unavailable for ${unavailableChecks.map(r => r.jobname).join(', ')}. Other checks retain their own results.`
          : 'Output assays unavailable.'} {health.length > 0 ? 'Execution readings remain available; successful exits do not prove output.' : 'Job configuration remains available; execution and output are unmeasured.'}</p></details>}
      </div>}

    <section id="status-delivery" className="status-delivery" aria-labelledby="status-delivery-title">
      <div className="status-section-head"><div><div className="status-kicker">INSPECT A RESULT · RETAINED EVIDENCE</div>
        <h3 id="status-delivery-title">How did bidding build on this lot?</h3>
        <p>Move through posted bids. Watch the high bid and the identity count change from the same retained log.</p></div>
      </div>
      <RetainedBidReplay />
      <p className="status-basis">SA · One retained demonstration. The full reader exposes coverage, source clocks and the missing baseline, residual and prediction layers.</p>
    </section>
    </div>

    {arrivals}

    {coverage && <details id="status-sources" open={sourcesOpen} onToggle={e => setSourcesOpen(e.currentTarget.open)} style={box}>
      <summary style={label}>SOURCE COVERAGE · {sources.length} sources · {totals && totals.targets > 0 ? `${(100 * totals.completed / totals.targets).toFixed(2)}% queue complete` : 'Unmeasured'}</summary>
      <h3 style={{ fontSize: 11 }}>KNOWN SOURCE TARGETS · {time(coverage.measured_at)}</h3>
      <p>{totals ? `${count(totals.completed)} completed queue matches / ${count(totals.targets)} known target URLs`
        : 'Overall target coverage unmeasured.'}{coverage.complete === false ? ' First 30 sources only; totals withheld.' : ''}</p>
      <p>Target URLs matched to import_queue by exact URL. A completed queue entry does not prove a vehicle, sale or downstream answer. Zero matches can coexist with retained source data.</p>
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <caption style={{ textAlign: 'left' }}>Coverage within the known URL inventory, rather than the whole market</caption>
        <thead><tr>{['Source', 'Known targets', 'In queue', 'Complete', 'Completion', 'Not queued', 'Failed', 'Skipped'].map(label => <th scope="col" key={label} style={cell}>{label}</th>)}</tr></thead>
        <tbody>{sources.map(s => <tr key={s.source_slug}><th scope="row" style={cell}>
          {s.organization_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.organization_id)
            ? <PrefetchLink to={`/org/${s.organization_id}#source-targets`} style={{ color: 'var(--text)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <OrgLogo website={s.base_url} businessName={s.display_name || s.source_slug} size={16} />
                {s.display_name || s.source_slug}
              </PrefetchLink>
            : <>{s.display_name || s.source_slug}<div style={{ fontWeight: 400 }}>Public profile unavailable</div></>}
        </th>
          {[s.total_targets, s.in_queue, s.extracted].map((n, i) => <td key={i} style={cell}>{sourceValid(s) ? count(n) : 'Unmeasured'}</td>)}
          <td style={cell}>{sourceValid(s) && s.total_targets > 0 ? `${(100 * s.extracted / s.total_targets).toFixed(2)}%` : 'Unmeasured'}</td>
          {[s.gap, s.failed, s.skipped].map((n, i) => <td key={i} style={cell}>{sourceValid(s) ? count(n) : 'Unmeasured'}</td>)}</tr>)}</tbody>

      </table></div>
      <p><PrefetchLink to="/admin/sources">Source management →</PrefetchLink></p>
    </details>}

    {jobs && <div id="status-jobs" style={box}>
      {jobs.controls?.status === 'measured' && jobs.controls.value && <p>
        Intake {jobs.controls.value.enabled && jobs.controls.value.max_ingests > 0 ? 'open within capacity limits' : 'paused'} ·
        Ceiling {count(jobs.controls.value.max_feeds)} feeds / {count(jobs.controls.value.max_ingests)} admissions per invocation.
        Source rotation and measured extraction latency reduce actual work to fit the worker deadline. Monetary cost is unmeasured.
      </p>}
      {jobs.controls?.status === 'invalid' && <p role="status">Invalid throttle configuration: source work is refused.</p>}
      {validActivity(jobs.activity) ? <details>
        <summary>Source intake receipts · last 24 hours · {time(jobs.activity?.measured_at)}</summary>
        {jobs.activity?.rows.length === 0 ? <p>No matching receipts in this measured window. Source attempts and landing remain unmeasured.</p>
          : <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Source / worker', 'Source observed / run started', 'Run state', 'Target work started / selected / unattempted / deferred',
              'Captured cards or discovered items', 'Acknowledged ledger or listing rows', 'Verified sightings', 'Linked observation receipts', 'Write failures / deferrals'].map(h => <th scope="col" key={h} style={cell}>{h}</th>)}</tr></thead>
            <tbody>{jobs.activity?.rows.flatMap(r => (r.sources.length ? r.sources : [{ source: 'No selected target',
              selected_targets: 0, attempted_targets: 0, unattempted_targets: 0, deferred_targets: 0, counts: null,
              reasons: r.reason ? [r.reason] : [], consumer_usable: null }]).map(s => ({ r, s }))).slice(0, 100).map(({ r, s }) =>
              <tr key={`${r.run_id}:${s.source}`}><th scope="row" style={cell}>{s.source}<br /><small>{r.worker}</small></th>
                <td style={cell}>{time(r.observed_at)}<br />{time(r.started_at)}
                  {r.actual_region && <><br />{r.actual_region}</>}
                  <br /><small>{r.scope_complete === false ? 'Partial target surface' : r.scope_complete === true ? 'Declared target scope' : 'Target scope unmeasured'}</small></td>
                <td style={cell}>{r.status}<br />{time(r.completed_at)}</td>
                <td style={cell}>{count(s.attempted_targets)} / {count(s.selected_targets)} / {count(s.unattempted_targets)} / {count(s.deferred_targets)}</td>
                <td style={cell}>{count(s.counts?.captured_cards ?? s.counts?.discovered_items)}</td>
                <td style={cell}>{count(s.counts?.listing_rows_acknowledged ?? s.counts?.landed_ledger_acknowledged)}
                  {s.counts?.queue_rows_acknowledged !== undefined && <><br />{count(s.counts.queue_rows_acknowledged)} queued</>}</td>
                <td style={cell}>{count(s.counts?.sightings_verified)}</td>
                <td style={cell}>{count(s.counts?.linked_observation_receipts)}</td>
                <td style={cell}>{count(s.counts?.ledger_write_failures ?? s.counts?.observation_errors)}<br />{s.reasons.join(', ')}</td>
              </tr>)}</tbody>
          </table></div>}
        <p>Receipts measure selected targets and acknowledged processing, not new vehicles or source-wide coverage.
          Work started records dispatch intent; fetch success is separate. First observed is not listed time.
          Canonical property coverage and consumer usability remain unmeasured here.
          {' '}Browser captures are separate from scheduled-feed ceilings.
          {' '}{jobs.activity?.complete ? '' : 'Run history exceeds this reading.'} At most 100 source-run rows shown.</p>
      </details> : <p role="status">Source intake receipts unavailable. Attempts and landing remain unmeasured; job execution readings are separate.</p>}
      {jobs.feeds?.status === 'measured' && <details><summary>Scheduled source feeds · {time(jobs.feeds.measured_at)}</summary>
        <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Source', 'Enabled feeds', 'Throttle', 'Errored feeds', 'Latest poll', 'Minimum interval'].map(label => <th scope="col" key={label} style={cell}>{label}</th>)}</tr></thead>
          <tbody>{jobs.feeds.rows.map(f => {
            const control = jobs.controls?.value?.sources[f.source_slug];
            const state = jobs.controls?.status === 'invalid' ? 'Invalid controls: work refused'
              : jobs.controls?.status !== 'measured' ? 'Controls unavailable'
              : jobs.controls.value?.enabled === false || jobs.controls.value?.max_ingests === 0
              || control?.enabled === false || control?.max_ingests === 0 ? 'Held at zero'
              : f.billing_blocked ? 'Billing blocked' : f.rate_limited ? 'Provider limited' : 'Shared capacity budget';
            return <tr key={f.source_slug}><th scope="row" style={cell}>{f.source_slug}</th>
              <td style={cell}>{count(f.enabled_feeds)} / {count(f.feeds)}</td><td style={cell}>{state}</td>
              <td style={cell}>{count(f.errored_feeds)}</td><td style={cell}>{time(f.last_polled_at)}</td>
              <td style={cell}>{count(f.shortest_interval_minutes)} min</td></tr>;
          })}</tbody>
        </table></div>
        <p>Feed discovery and polling only; a poll timestamp does not prove new data landed. {jobs.feeds.complete ? '' : 'First 60 source keys only.'}</p>
      </details>}
      <details id="status-job-readings" open={jobsOpen} onToggle={e => setJobsOpen(e.currentTarget.open)}>
      <summary style={label}>JOB EXECUTIONS · {activeJobs.length} ENABLED / {config.length} IN SCOPE</summary>
      <h3 style={label}>INTAKE AND FOLD JOBS</h3>
      <p style={{ color: 'var(--text-secondary)' }}>Configuration {time(jobs.config?.measured_at)} · Executions {time(jobs.health?.measured_at)}. {jobs.health_scope?.length ?? 6} named jobs in health scope; other readings are unmeasured. Paused jobs remain paused.</p>
      {jobs.health?.readings && <p>{jobs.health.readings.filter(r => r.status === 'measured').length} / {jobs.health.readings.length} job health readings measured independently. A null output assay means no output check was returned.</p>}
      <div role="group" aria-label="Filter jobs" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {['all', 'active', 'paused', 'failures'].map(filter => <button key={filter} type="button" aria-pressed={jobFilter === filter}
          onClick={() => setJobFilter(filter)} style={{ fontSize: 11, padding: '5px 10px', border: '2px solid var(--border)',
            color: jobFilter === filter ? 'var(--bg)' : 'var(--text)', background: jobFilter === filter ? 'var(--text)' : 'var(--bg)' }}>{filter.toUpperCase()}</button>)}
      </div>
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{['Job / UTC schedule', 'Enabled', 'Last execution', 'Output assay', 'Reported health', 'Declared writer → tables'].map(label => <th scope="col" key={label} style={cell}>{label}</th>)}</tr></thead>
        <tbody>{visibleJobs.map(j => {
          const h = health.find(h => h.jobname === j.jobname);
          const check = jobs.health?.readings?.find(r => r.jobname === j.jobname);
          const owned = h?.declared_writer ? tables.filter(t => t.registry_owners?.includes(h.declared_writer!)).map(t => t.table_name) : [];
          return <tr key={j.jobname}>
            <th scope="row" style={cell}>{j.jobname}<div style={{ fontFamily: 'Courier New', fontWeight: 400 }}>{j.present ? j.schedule : 'Missing job'}</div></th>
            <td style={cell}>{j.present && typeof j.active === 'boolean' ? j.active ? 'Active' : 'Paused' : 'Unmeasured'}</td>
            <td style={cell}>{h?.last_status ?? <span aria-label="Unmeasured">—</span>}{h?.last_run_at && <div>{time(h.last_run_at)}</div>}</td>
            <td style={cell}>{h?.assay_status ?? <span aria-label="Unmeasured">—</span>}{check?.measured_at
              && <div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>{time(check.measured_at)}</div>}</td>
            <td style={cell}>{h?.health_status ?? <span aria-label="Unmeasured">—</span>}</td>
            <td style={cell}><details><summary>{h ? h.declared_writer ?? 'Undeclared' : 'Unmeasured'}</summary><div>{!h || !model ? 'Owner mapping unmeasured' : owned.length ? owned.join(', ') : 'No exact owner match in the table scope'}</div></details></td>
          </tr>;
        })}</tbody>
      </table></div>
      {visibleJobs.length === 0 && <p>No jobs match this filter in the measured configuration.</p>}
      <p style={{ color: 'var(--text-secondary)' }}>— = Unmeasured. An execution can succeed while its output assay fails. Owner matches are registry declarations, not observed job-to-reader flow.</p>
      </details>
    </div>}

    {consumers && <details id="status-consumers" open={consumersOpen} onToggle={e => setConsumersOpen(e.currentTarget.open)} style={box}>
      <summary style={label}>QUESTIONS & MISSING DEPENDENCIES · {questions.length} registered questions</summary>
      <h3 id="status-consumers-title" style={label}>QUESTIONS & MISSING DEPENDENCIES</h3>
      <p>{needsTotals ? `${count(needsTotals.present)} present · ${count(needsTotals.partial)} partial · ${count(needsTotals.missing)} missing / ${count(needsTotals.total)} dependency declarations`
        : 'First 100 questions only; aggregate totals withheld.'}</p>
      <p style={{ color: 'var(--text-secondary)' }}>Reading {time(consumers.measured_at)}. Registry structure, not verified answers. A present table or function does not prove correct processing, replay or delivery.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <label>Find a question or dependency <input type="search" value={consumerSearch} onChange={e => { setConsumerSearch(e.target.value); setConsumerLimit(8); }} style={{ fontSize: 11 }} /></label>
        <label><input type="checkbox" checked={consumerTableOnly} onChange={e => { setConsumerTableOnly(e.target.checked); setConsumerLimit(8); }} /> Uses {consumerTables.length ? consumerTables.join(', ') : selectedTable}</label>
        {consumerTableOnly && <button type="button" onClick={() => { setConsumerTableOnly(false); setConsumerTables([]); }}>Clear table filter</button>}
      </div>
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{['Question / declared dependencies', 'Registry status', 'Present', 'Partial', 'Missing'].map(name => <th scope="col" key={name} style={cell}>{name}</th>)}</tr></thead>
        <tbody>{matchingQuestions.slice(0, consumerLimit).map(q => <tr key={q.stack_id}>
          <td style={cell}><div className="status-question">{q.question}</div><details><summary>{q.stack_id} · {q.name}</summary>
            <p>Definition v{q.version} · {q.needs_complete ? 'All declared needs shown' : 'First 64 needs only'}</p>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr>{['Layer', 'Dependency', 'Structure', 'Reason'].map(name => <th scope="col" key={name} style={cell}>{name}</th>)}</tr></thead>
              <tbody>{q.needs.map((n, i) => <tr key={`${n.layer}:${n.object}:${i}`}><td style={cell}>{n.layer}</td>
                <td style={cell}>{n.related_table && tables.some(t => t.table_name === n.related_table)
                  ? <a href="#status-model" onClick={() => { setSelectedTable(n.related_table!); setModelOpen(true); }}>{n.object} →</a> : n.object}</td>
                <td style={cell}>{n.verdict}</td><td style={cell}>{n.reason ?? '—'}</td></tr>)}</tbody>
            </table>
            <p><PrefetchLink to={`/stacks?stack=${encodeURIComponent(q.stack_id)}`}>Open stack workbench →</PrefetchLink></p>
            {q.stack_id === ORDER_BOOK_STACK.stackId && <p><PrefetchLink
              to={`${ORDER_BOOK_STACK.route}/${ORDER_BOOK_STACK.demonstration.vehicleId}?lot=${ORDER_BOOK_STACK.demonstration.auctionEventId}`}>
              Replay retained demonstration →</PrefetchLink> · The reader shows its own evidence coverage and missing layers.</p>}
          </details></td>
          <td style={cell}>{q.status}</td><td style={cell}>{count(q.n_present)} / {count(q.n_needs)}</td>
          <td style={cell}>{count(q.n_partial)}</td><td style={cell}>{count(q.n_missing)}</td>
        </tr>)}</tbody>
      </table></div>
      <p style={{ color: 'var(--text-secondary)' }}>Showing {Math.min(consumerLimit, matchingQuestions.length)} of {matchingQuestions.length} matching questions, ordered by declared lifecycle status, then present dependencies. Shared dependencies count once per declaration.</p>
      {matchingQuestions.length > consumerLimit && <button type="button" onClick={() => setConsumerLimit(n => n + 8)} style={{ fontSize: 11 }}>Show more questions</button>}
      {matchingQuestions.length === 0 && <p>No question matches this filter in the returned registry scope.</p>}
    </details>}

    {model && <details id="status-model" open={modelOpen} onToggle={e => setModelOpen(e.currentTarget.open)} style={box}>
      <summary style={label}>MODEL RELATIONSHIPS · {tables.length} tables · {model.links?.length} declared links</summary>
      <h3 style={{ fontSize: 11 }}>MODEL RELATIONSHIPS · {time(model.measured_at)}</h3>
      <label>Inspect table <select aria-label="Inspect table" value={selectedTable} onChange={e => setSelectedTable(e.target.value)} style={{ fontSize: 11 }}>
        {tables.map(t => <option key={t.table_name} value={t.table_name}>{t.table_name}</option>)}
      </select></label>
      {table && <>
        <p>{table.atlas_present ? `≈${count(table.est_rows)} estimated rows · ${count(table.n_cols_described)} / ${count(table.n_cols)} columns described · ${count(table.triggers)} triggers` : 'Atlas metadata unavailable for this table.'}</p>
        <p>Declared owners: {table.registry_owners?.join(', ') || 'Unregistered'}</p>
        <p>Latest {count(table.receipt_sample_count)} receipts within 30 days{table.receipt_sample_complete === false ? ' · capped at 32' : ''}: {table.receipt_writers?.join(', ') || 'Unmeasured'} · Undeclared in sample: {count(table.receipt_undeclared_stmts)} · Latest receipt: {time(table.last_write)}</p>
        <div style={grid}>{[['References', parents], ['Referenced by', children]].map(([heading, nodes]) =>
          <div key={heading as string} style={box}><h4 style={label}>{heading as string}</h4>
            {(nodes as string[]).length > 0 ? (nodes as string[]).map(name => <div key={name} style={{ marginBottom: 6 }}>
              {tables.some(t => t.table_name === name) ? <button type="button" onClick={() => setSelectedTable(name)} style={{ fontSize: 11, fontFamily: 'Courier New' }}>{name} →</button>
                : <span style={{ fontFamily: 'Courier New' }}>{name} · outside inspector scope</span>}
            </div>) : <p>No links in this reading.</p>}
          </div>)}</div>
        <details><summary>Foreign-key relationships{model.links_complete === false ? ' · first 500 only' : ''}</summary>
          {edges.length ? <ul>{edges.map(e => <li key={`${e.child_table}:${e.constraint_name}`}>
            {e.child_table} → {e.parent_table} · {e.validated ? 'Validated' : 'Historical validation pending'} · {e.constraint_name}
          </li>)}</ul> : <p>{model.links_complete ? 'No public-to-public foreign keys in this reading.' : 'No relationship in the returned slice; remaining links unmeasured.'}</p>}
        </details>
      </>}
      <p>Fourteen named tables. Foreign keys establish declared structure. Trigger counts, description coverage and receipts do not prove semantic correctness, replay or consumer delivery.</p>
      <p><a href="#status-consumers" onClick={() => { setConsumerTableOnly(true); setConsumerTables([]); setConsumersOpen(true); setConsumerSearch(''); setConsumerLimit(8); }}>Show registered questions using {selectedTable} →</a></p>
      <p><PrefetchLink to="/stacks">Inspect downstream stacks →</PrefetchLink></p>
    </details>}
  </section>;
}
