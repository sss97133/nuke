import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

type Section = 'coverage' | 'model' | 'jobs';
type Source = { source_slug: string; total_targets: number; in_queue: number; extracted: number; gap: number; failed: number; skipped: number };
type Table = { table_name: string; atlas_present: boolean; est_rows: number; n_cols: number; n_cols_described: number;
  registry_owners: string[] | null; receipt_writers: string[] | null; receipt_undeclared_stmts: number;
  receipt_sample_count: number; receipt_sample_complete: boolean; last_write: string | null; triggers: number };
type Edge = { constraint_name: string; child_table: string; parent_table: string; validated: boolean };
type Job = { jobname: string; present: boolean; active: boolean; schedule: string | null };
type Health = { jobname: string; declared_writer: string | null; last_status: string | null; last_run_at: string | null;
  assay_status: string | null; health_status: string | null };
type Reading = { contract: string; section: Section; status?: string; measured_at?: string; complete?: boolean;
  rows?: Source[] | Table[]; links?: Edge[]; links_complete?: boolean;
  config?: { status: string; measured_at: string; rows: Job[] };
  health?: { status: string; measured_at: string | null; rows: Health[] }; health_scope?: string[] };

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
function validReading(data: any, section: Section): data is Reading {
  if (data?.contract !== 'intake_status_v1' || data.section !== section) return false;
  if (section === 'jobs') return data.config?.status === 'measured'
    && Number.isFinite(Date.parse(data.config.measured_at)) && names(data.config.rows, 'jobname', 12)
    && data.health && ['measured', 'unavailable'].includes(data.health.status)
    && (data.health.status === 'unavailable' || Number.isFinite(Date.parse(data.health.measured_at))
      && names(data.health.rows, 'jobname', 5));
  if (data.status !== 'measured' || !Number.isFinite(Date.parse(data.measured_at))) return false;
  if (section === 'coverage') return names(data.rows, 'source_slug', 30) && typeof data.complete === 'boolean';
  return names(data.rows, 'table_name', 14) && data.rows.every((t: Table) => strings(t.registry_owners) && strings(t.receipt_writers))
    && Array.isArray(data.links) && data.links.length <= 500 && typeof data.links_complete === 'boolean'
    && data.links.every((e: Edge) => e && typeof e.constraint_name === 'string' && typeof e.child_table === 'string'
      && typeof e.parent_table === 'string' && typeof e.validated === 'boolean');
}
const box = { border: '2px solid var(--border)', padding: 12, marginBottom: 16 };
const cell = { padding: '6px 8px', textAlign: 'left' as const, borderBottom: '1px solid var(--border)', verticalAlign: 'top' as const };

export default function IntakeReadiness() {
  const [readings, setReadings] = useState<Partial<Record<Section, Reading>>>({});
  const [failed, setFailed] = useState<Section[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedTable, setSelectedTable] = useState('vehicle_observations');

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    const load = async (section: Section) => {
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
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

  return <section aria-labelledby="intake-readiness-title" style={{ ...box, fontSize: 11 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <h2 id="intake-readiness-title" style={{ fontSize: 11, margin: 0 }}>INTAKE → MODEL → CONSUMER</h2>
      <button type="button" disabled={loading} onClick={() => setRefresh(n => n + 1)} style={{ fontSize: 11 }}>
        {loading ? 'Reading…' : 'Refresh intake readings'}
      </button>
    </div>
    <p>Refreshes every five minutes. Independent reading clocks; row arrivals, job exits and relationships have separate meanings.</p>
    {failed.length > 0 && <p role="status">Unavailable: {failed.join(', ')}. Retained readings below keep their original dates.</p>}

    {coverage && <div style={box}>
      <h3 style={{ fontSize: 11 }}>KNOWN SOURCE TARGETS · {time(coverage.measured_at)}</h3>
      <p>{totals ? `${count(totals.completed)} completed queue matches / ${count(totals.targets)} known target URLs`
        : 'Overall target coverage unmeasured.'}{coverage.complete === false ? ' First 30 sources only; totals withheld.' : ''}</p>
      <p>Target URLs matched to import_queue by exact URL. A completed queue entry does not prove a vehicle, sale or downstream answer. Zero matches can coexist with retained source data.</p>
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <caption style={{ textAlign: 'left' }}>Coverage within the known URL inventory, rather than the whole market</caption>
        <thead><tr>{['Source', 'Known targets', 'In queue', 'Complete', 'Not queued', 'Failed', 'Skipped'].map(label => <th scope="col" key={label} style={cell}>{label}</th>)}</tr></thead>
        <tbody>{sources.map(s => <tr key={s.source_slug}><th scope="row" style={cell}>{s.source_slug}</th>
          {[s.total_targets, s.in_queue, s.extracted, s.gap, s.failed, s.skipped].map((n, i) => <td key={i} style={cell}>{sourceValid(s) ? count(n) : 'Unmeasured'}</td>)}</tr>)}</tbody>
      </table></div>
    </div>}

    {jobs && <div style={box}>
      <h3 style={{ fontSize: 11 }}>INTAKE AND FOLD JOBS · CONFIGURATION {time(jobs.config?.measured_at)}</h3>
      <p>Output health: {time(jobs.health?.measured_at)}. Five named jobs assayed here; other output readings are unmeasured. Paused jobs remain paused.</p>
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{['Job / UTC schedule', 'Enabled', 'Last execution', 'Output assay', 'Reported health', 'Declared writer → tables'].map(label => <th scope="col" key={label} style={cell}>{label}</th>)}</tr></thead>
        <tbody>{jobs.config?.rows.map(j => {
          const h = health.find(h => h.jobname === j.jobname);
          const owned = h?.declared_writer ? tables.filter(t => t.registry_owners?.includes(h.declared_writer!)).map(t => t.table_name) : [];
          return <tr key={j.jobname}>
            <th scope="row" style={cell}>{j.jobname}<div style={{ fontFamily: 'Courier New', fontWeight: 400 }}>{j.present ? j.schedule : 'Missing job'}</div></th>
            <td style={cell}>{j.present && typeof j.active === 'boolean' ? j.active ? 'Active' : 'Paused' : 'Unmeasured'}</td>
            <td style={cell}>{h?.last_status ?? 'Unmeasured'}{h?.last_run_at && <div>{time(h.last_run_at)}</div>}</td>
            <td style={cell}>{h?.assay_status ?? 'Unmeasured'}</td>
            <td style={cell}>{h?.health_status ?? 'Unmeasured'}</td>
            <td style={cell}>{h ? h.declared_writer ?? 'Undeclared' : 'Unmeasured'}<div>{!h || !model ? 'Owner mapping unmeasured' : owned.length ? owned.join(', ') : 'No exact owner match in the table scope'}</div></td>
          </tr>;
        })}</tbody>
      </table></div>
      <p>An execution can succeed while its output assay fails. Owner matches are registry declarations, not observed job-to-reader flow.</p>
    </div>}

    {model && <div style={box}>
      <h3 style={{ fontSize: 11 }}>MODEL RELATIONSHIPS · {time(model.measured_at)}</h3>
      <label>Inspect table <select value={selectedTable} onChange={e => setSelectedTable(e.target.value)} style={{ fontSize: 11 }}>
        {tables.map(t => <option key={t.table_name} value={t.table_name}>{t.table_name}</option>)}
      </select></label>
      {table && <>
        <p>{table.atlas_present ? `≈${count(table.est_rows)} estimated rows · ${count(table.n_cols_described)} / ${count(table.n_cols)} columns described · ${count(table.triggers)} triggers` : 'Atlas metadata unavailable for this table.'}</p>
        <p>Declared owners: {table.registry_owners?.join(', ') || 'Unregistered'}</p>
        <p>Latest {count(table.receipt_sample_count)} receipts within 30 days{table.receipt_sample_complete === false ? ' · capped at 32' : ''}: {table.receipt_writers?.join(', ') || 'Unmeasured'} · Undeclared in sample: {count(table.receipt_undeclared_stmts)} · Latest receipt: {time(table.last_write)}</p>
        <details><summary>Foreign-key relationships{model.links_complete === false ? ' · first 500 only' : ''}</summary>
          {edges.length ? <ul>{edges.map(e => <li key={`${e.child_table}:${e.constraint_name}`}>
            {e.child_table} → {e.parent_table} · {e.validated ? 'Validated' : 'Historical validation pending'} · {e.constraint_name}
          </li>)}</ul> : <p>{model.links_complete ? 'No public-to-public foreign keys in this reading.' : 'No relationship in the returned slice; remaining links unmeasured.'}</p>}
        </details>
      </>}
      <p>Fourteen named tables. Foreign keys establish declared structure. Trigger counts, description coverage and receipts do not prove semantic correctness, replay or consumer delivery.</p>
    </div>}
  </section>;
}
