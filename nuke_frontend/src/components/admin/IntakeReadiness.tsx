import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import PrefetchLink from '../PrefetchLink';

type Section = 'coverage' | 'model' | 'jobs';
type Source = { source_slug: string; total_targets: number; in_queue: number; extracted: number; gap: number; failed: number; skipped: number };
type Table = { table_name: string; atlas_present: boolean; est_rows: number; n_cols: number; n_cols_described: number;
  registry_owners: string[] | null; receipt_writers: string[] | null; receipt_undeclared_stmts: number;
  receipt_sample_count: number; receipt_sample_complete: boolean; last_write: string | null; triggers: number };
type Edge = { constraint_name: string; child_table: string; parent_table: string; validated: boolean };
type Job = { jobname: string; present: boolean; active: boolean; schedule: string | null };
type Health = { jobname: string; declared_writer: string | null; last_status: string | null; last_run_at: string | null;
  assay_status: string | null; health_status: string | null };
type Feed = { source_slug: string; feeds: number; enabled_feeds: number; errored_feeds: number;
  last_polled_at: string | null; shortest_interval_minutes: number | null; billing_blocked: boolean | null; rate_limited: boolean | null };
type Reading = { contract: string; section: Section; status?: string; measured_at?: string; complete?: boolean;
  rows?: Source[] | Table[]; links?: Edge[]; links_complete?: boolean;
  config?: { status: string; measured_at: string; rows: Job[] };
  health?: { status: string; measured_at: string | null; rows: Health[]; output_measured?: boolean }; health_scope?: string[];
  feeds?: { status: string; measured_at: string | null; rows: Feed[]; complete: boolean };
  controls?: { status: string; value?: { enabled: boolean; max_feeds: number; max_ingests: number;
    sources: Record<string, { enabled?: boolean; max_ingests?: number }> } } };

// Start with bounded metadata, then avoid overlapping the two aggregate readers.
const sections: Section[] = ['model', 'coverage', 'jobs'];
const count = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n.toLocaleString() : 'Unmeasured';
const time = (s: string | null | undefined) => s && Number.isFinite(Date.parse(s)) ? new Date(s).toLocaleString() : 'Unmeasured';
const sourceValid = (s: Source) => typeof s.source_slug === 'string' && s.source_slug.length > 0
  && [s.total_targets, s.in_queue, s.extracted, s.gap, s.failed, s.skipped].every(n => Number.isSafeInteger(n) && n >= 0)
  && s.in_queue <= s.total_targets && s.extracted <= s.in_queue && s.gap === s.total_targets - s.in_queue;
const names = (rows: any[], key: string, limit: number) => Array.isArray(rows) && rows.length <= limit
  && rows.every(r => r && typeof r[key] === 'string' && r[key].length > 0)
  && new Set(rows.map(r => r[key])).size === rows.length;
const strings = (value: unknown) => value === null || Array.isArray(value) && value.every(s => typeof s === 'string');
const validControls = (controls: any) => controls === undefined || ['invalid', 'unavailable'].includes(controls?.status)
  || controls?.status === 'measured' && typeof controls.value?.enabled === 'boolean'
    && [controls.value.max_feeds, controls.value.max_ingests].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 100)
    && controls.value.sources && typeof controls.value.sources === 'object' && !Array.isArray(controls.value.sources)
    && Object.values(controls.value.sources).every((s: any) => s && typeof s.enabled === 'boolean'
      && Number.isSafeInteger(s.max_ingests) && s.max_ingests >= 0 && s.max_ingests <= 100);
function validReading(data: any, section: Section): data is Reading {
  if (data?.contract !== 'intake_status_v1' || data.section !== section) return false;
  if (section === 'jobs') return data.config?.status === 'measured'
    && Number.isFinite(Date.parse(data.config.measured_at)) && names(data.config.rows, 'jobname', 14)
    && data.health && ['measured', 'unavailable'].includes(data.health.status)
    && (data.health.status === 'unavailable' || Number.isFinite(Date.parse(data.health.measured_at))
      && names(data.health.rows, 'jobname', 6))
    && validControls(data.controls)
    && (data.feeds === undefined || data.feeds.status === 'unavailable' || data.feeds.status === 'measured'
      && Number.isFinite(Date.parse(data.feeds.measured_at)) && names(data.feeds.rows, 'source_slug', 60)
      && typeof data.feeds.complete === 'boolean');
  if (data.status !== 'measured' || !Number.isFinite(Date.parse(data.measured_at))) return false;
  if (section === 'coverage') return names(data.rows, 'source_slug', 30) && typeof data.complete === 'boolean';
  return names(data.rows, 'table_name', 14) && data.rows.every((t: Table) => strings(t.registry_owners) && strings(t.receipt_writers))
    && Array.isArray(data.links) && data.links.length <= 500 && typeof data.links_complete === 'boolean'
    && data.links.every((e: Edge) => e && typeof e.constraint_name === 'string' && typeof e.child_table === 'string'
      && typeof e.parent_table === 'string' && typeof e.validated === 'boolean');
}
const box = { border: '2px solid var(--border)', padding: 12, marginBottom: 16 };
const cell = { padding: '6px 8px', textAlign: 'left' as const, borderBottom: '1px solid var(--border)', verticalAlign: 'top' as const };
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 12 };
const label = { fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase' as const, fontWeight: 700 };
const metric = { fontFamily: 'Courier New', fontSize: 24, fontWeight: 700, margin: '8px 0' };

export default function IntakeReadiness() {
  const [readings, setReadings] = useState<Partial<Record<Section, Reading>>>({});
  const [failed, setFailed] = useState<Section[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedTable, setSelectedTable] = useState('vehicle_observations');
  const [jobFilter, setJobFilter] = useState('all');
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);

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
  const table = tables.find(t => t.table_name === selectedTable);
  const edges = (model?.links ?? []).filter(e => e.child_table === selectedTable || e.parent_table === selectedTable);
  const jobs = readings.jobs;
  const health = jobs?.health?.status === 'measured' ? jobs.health.rows : [];
  const config = jobs?.config?.rows ?? [];
  const activeJobs = config.filter(j => j.present && j.active === true);
  const pausedJobs = config.filter(j => j.present && j.active === false);
  const failedJobs = activeJobs.filter(j => {
    const h = health.find(h => h.jobname === j.jobname);
    return h?.last_status === 'failed' || h?.assay_status === 'failed' || h?.health_status === 'failed';
  });
  const visibleJobs = config.filter(j => jobFilter === 'all' || (jobFilter === 'active' ? j.active === true
    : jobFilter === 'paused' ? j.active === false : failedJobs.includes(j)));
  const feedProblems = jobs?.feeds?.status === 'measured' ? jobs.feeds.rows.filter(f => f.errored_feeds > 0) : [];
  const receiptProblems = tables.filter(t => t.receipt_undeclared_stmts > 0);
  const parents = [...new Set(edges.filter(e => e.child_table === selectedTable).map(e => e.parent_table))];
  const children = [...new Set(edges.filter(e => e.parent_table === selectedTable).map(e => e.child_table))];

  return <section aria-labelledby="intake-readiness-title" style={{ ...box, fontSize: 11 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <h2 id="intake-readiness-title" style={{ fontSize: 14, margin: 0 }}>OPERATIONS</h2>
      <button type="button" disabled={loading} onClick={() => setRefresh(n => n + 1)} style={{ fontSize: 11 }}>
        {loading ? 'Reading…' : 'Refresh intake readings'}
      </button>
    </div>
    <p style={{ color: 'var(--text-secondary)' }}>Source coverage, scheduled work and model relationships. Readings refresh every five minutes.</p>
    {failed.length > 0 && <p role="status">Unavailable: {failed.join(', ')}. Retained readings below keep their original dates.</p>}

    <div style={grid}>
      <a href="#status-sources" onClick={() => setSourcesOpen(true)} style={{ ...box, color: 'inherit', textDecoration: 'none' }}>
        <div style={label}>Known targets complete</div>
        <div style={metric}>{totals && totals.targets > 0 ? `${(100 * totals.completed / totals.targets).toFixed(2)}%` : 'Unmeasured'}</div>
        <div>{totals ? `${count(totals.completed)} / ${count(totals.targets)} target URLs` : 'Waiting for source coverage'}</div>
        <div style={{ color: 'var(--text-secondary)', marginTop: 6 }}>Queue completion · inspect sources ↓</div>
      </a>
      <a href="#status-jobs" style={{ ...box, color: 'inherit', textDecoration: 'none' }}>
        <div style={label}>Scheduled jobs</div><div style={metric}>{jobs ? count(activeJobs.length) : 'Unmeasured'}</div>
        <div>{jobs ? `${count(pausedJobs.length)} paused · ${count(config.length)} in scope` : 'Waiting for job configuration'}</div>
        <div style={{ color: 'var(--text-secondary)', marginTop: 6 }}>Enabled configuration · inspect jobs ↓</div>
      </a>
      <a href="#status-jobs" style={{ ...box, color: 'inherit', textDecoration: 'none' }}>
        <div style={label}>Jobs reporting failure</div><div style={metric}>{health.length > 0 ? count(failedJobs.length) : 'Unmeasured'}</div>
        <div>{health.length} execution readings / {activeJobs.length} enabled jobs</div>
        <div style={{ color: 'var(--text-secondary)', marginTop: 6 }}>Output {jobs?.health?.output_measured === false || jobs?.health?.status !== 'measured' ? 'unmeasured' : 'assays below'} · not fleet health</div>
      </a>
      <a href="#status-model" onClick={() => setModelOpen(true)} style={{ ...box, color: 'inherit', textDecoration: 'none' }}>
        <div style={label}>Model relationships</div><div style={metric}>{model ? count(model.links?.length) : 'Unmeasured'}</div>
        <div>{model ? `${count(tables.length)} tables · ${count(model.links?.length)} declared links` : 'Waiting for model metadata'}</div>
        <div style={{ color: 'var(--text-secondary)', marginTop: 6 }}>Declared structure · inspect writer receipts ↓</div>
      </a>
    </div>

    {(failedJobs.length > 0 || feedProblems.length > 0 || receiptProblems.length > 0 || jobs?.health?.output_measured === false || jobs?.health?.status === 'unavailable') &&
      <div style={{ ...box, borderLeft: '4px solid var(--warning, var(--text))' }}>
        <h3 style={label}>NEEDS ATTENTION</h3>
        {failedJobs.map(j => <p key={j.jobname}><a href="#status-jobs">{j.jobname}</a> · {health.find(h => h.jobname === j.jobname)?.last_status === 'failed' ? 'Execution failed' : 'Output or health check failed'}</p>)}
        {feedProblems.length > 0 && <p>{feedProblems.map(f => f.source_slug).join(', ')} · enabled feeds report errors. <PrefetchLink to="/admin/sources">Inspect sources →</PrefetchLink></p>}
        {receiptProblems.length > 0 && <p>{receiptProblems.map(t => t.table_name).join(', ')} · undeclared writers in the latest receipt sample. <a href="#status-model" onClick={() => setModelOpen(true)}>Inspect model →</a></p>}
        {(jobs?.health?.output_measured === false || jobs?.health?.status === 'unavailable') && <p>Output assays unavailable. {health.length > 0 ? 'Execution readings remain available; successful exits do not prove output.' : 'Job configuration remains available; execution and output are unmeasured.'}</p>}
      </div>}

    {coverage && <details id="status-sources" open={sourcesOpen} onToggle={e => setSourcesOpen(e.currentTarget.open)} style={box}>
      <summary style={label}>SOURCE COVERAGE · {sources.length} sources · {totals && totals.targets > 0 ? `${(100 * totals.completed / totals.targets).toFixed(2)}% queue complete` : 'Unmeasured'}</summary>
      <h3 style={{ fontSize: 11 }}>KNOWN SOURCE TARGETS · {time(coverage.measured_at)}</h3>
      <p>{totals ? `${count(totals.completed)} completed queue matches / ${count(totals.targets)} known target URLs`
        : 'Overall target coverage unmeasured.'}{coverage.complete === false ? ' First 30 sources only; totals withheld.' : ''}</p>
      <p>Target URLs matched to import_queue by exact URL. A completed queue entry does not prove a vehicle, sale or downstream answer. Zero matches can coexist with retained source data.</p>
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <caption style={{ textAlign: 'left' }}>Coverage within the known URL inventory, rather than the whole market</caption>
        <thead><tr>{['Source', 'Known targets', 'In queue', 'Complete', 'Completion', 'Not queued', 'Failed', 'Skipped'].map(label => <th scope="col" key={label} style={cell}>{label}</th>)}</tr></thead>
        <tbody>{sources.map(s => <tr key={s.source_slug}><th scope="row" style={cell}>{s.source_slug}</th>
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
      <h3 style={label}>INTAKE AND FOLD JOBS</h3>
      <p style={{ color: 'var(--text-secondary)' }}>Configuration {time(jobs.config?.measured_at)} · Executions {time(jobs.health?.measured_at)}. Six named jobs in health scope; other readings are unmeasured. Paused jobs remain paused.</p>
      <div role="group" aria-label="Filter jobs" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {['all', 'active', 'paused', 'failures'].map(filter => <button key={filter} type="button" aria-pressed={jobFilter === filter}
          onClick={() => setJobFilter(filter)} style={{ fontSize: 11, padding: '5px 10px', border: '2px solid var(--border)',
            color: jobFilter === filter ? 'var(--bg)' : 'var(--text)', background: jobFilter === filter ? 'var(--text)' : 'var(--bg)' }}>{filter.toUpperCase()}</button>)}
      </div>
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{['Job / UTC schedule', 'Enabled', 'Last execution', 'Output assay', 'Reported health', 'Declared writer → tables'].map(label => <th scope="col" key={label} style={cell}>{label}</th>)}</tr></thead>
        <tbody>{visibleJobs.map(j => {
          const h = health.find(h => h.jobname === j.jobname);
          const owned = h?.declared_writer ? tables.filter(t => t.registry_owners?.includes(h.declared_writer!)).map(t => t.table_name) : [];
          return <tr key={j.jobname}>
            <th scope="row" style={cell}>{j.jobname}<div style={{ fontFamily: 'Courier New', fontWeight: 400 }}>{j.present ? j.schedule : 'Missing job'}</div></th>
            <td style={cell}>{j.present && typeof j.active === 'boolean' ? j.active ? 'Active' : 'Paused' : 'Unmeasured'}</td>
            <td style={cell}>{h?.last_status ?? <span aria-label="Unmeasured">—</span>}{h?.last_run_at && <div>{time(h.last_run_at)}</div>}</td>
            <td style={cell}>{h?.assay_status ?? <span aria-label="Unmeasured">—</span>}</td>
            <td style={cell}>{h?.health_status ?? <span aria-label="Unmeasured">—</span>}</td>
            <td style={cell}><details><summary>{h ? h.declared_writer ?? 'Undeclared' : 'Unmeasured'}</summary><div>{!h || !model ? 'Owner mapping unmeasured' : owned.length ? owned.join(', ') : 'No exact owner match in the table scope'}</div></details></td>
          </tr>;
        })}</tbody>
      </table></div>
      {visibleJobs.length === 0 && <p>No jobs match this filter in the measured configuration.</p>}
      <p style={{ color: 'var(--text-secondary)' }}>— = Unmeasured. An execution can succeed while its output assay fails. Owner matches are registry declarations, not observed job-to-reader flow.</p>
    </div>}

    {model && <details id="status-model" open={modelOpen} onToggle={e => setModelOpen(e.currentTarget.open)} style={box}>
      <summary style={label}>MODEL RELATIONSHIPS · {tables.length} tables · {model.links?.length} declared links</summary>
      <h3 style={{ fontSize: 11 }}>MODEL RELATIONSHIPS · {time(model.measured_at)}</h3>
      <label>Inspect table <select value={selectedTable} onChange={e => setSelectedTable(e.target.value)} style={{ fontSize: 11 }}>
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
      <p><PrefetchLink to="/stacks">Inspect downstream stacks →</PrefetchLink></p>
    </details>}
  </section>;
}
