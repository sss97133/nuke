import { useMemo, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';
import { useVehiclePermissions } from '../../../hooks/useVehiclePermissions';
import { COLORWAYS } from '../connector-inspector/colorways';
import { wiringWorkbookBytes } from './wiringSchedule';
import { usePhysicalWorkspace } from './usePhysicalWorkspace';
import { RecordDetail, type RecordSelection } from './PhysicalRecordDetail';
import { PhysicalDiagram } from './PhysicalDiagram';
import { matchesWorkspaceSearch, physicalSchedule, sectionName, shortId, workspaceIndex, workspaceTables, tableLabels,
  type PhysicalWorkspace as Workspace, type WorkspaceIndex, type WorkspaceTable } from './physicalWorkspaceModel';
import './physical-workspace.css';

const visibleColumns: Record<WorkspaceTable, string[]> = {
  segments: ['code', 'design', 'issues', 'name', 'from', 'to', 'gauge', 'colour', 'planned', 'measured', 'build'],
  ends: ['circuit', 'connection', 'cavity', 'terminal', 'seal', 'tool', 'role', 'revision'],
  endpoints: ['code', 'name', 'type', 'part', 'design', 'revision'],
  circuits: ['code', 'name', 'design', 'gauge', 'colour', 'pieces', 'checks', 'revision'],
};
const cw = COLORWAYS.paper;
const theme = { '--hw-bg': cw.bg, '--hw-surface': cw.surface, '--hw-ink': cw.ink,
  '--hw-muted': cw.inkMuted, '--hw-border': cw.border, '--hw-accent': cw.accent,
  '--hw-selected': cw.elevated, '--hw-danger': cw.danger, '--hw-warn': cw.warn,
  '--hw-mono': cw.fontMono, fontFamily: cw.fontBody } as CSSProperties;

export function PhysicalWorkspace({ vehicleId }: { vehicleId?: string }) {
  const { session } = useAuth();
  const { data, loading, error, refresh } = usePhysicalWorkspace(vehicleId, session?.user?.id ?? null);
  const { isOwner } = useVehiclePermissions(vehicleId ?? null, session, null);
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(''), [section, setSection] = useState(''), [filter, setFilter] = useState('current_plan');
  const [sort, setSort] = useState<{ key: string; descending: boolean } | null>(null);
  const [exporting, setExporting] = useState(false), [exportError, setExportError] = useState<string | null>(null);
  const records = params.get('records');
  const table: WorkspaceTable = workspaceTables.includes(records as WorkspaceTable) ? records as WorkspaceTable : 'segments';
  const activeFilter = table !== 'segments' && filter !== 'unmodeled' ? 'all' : filter;
  const diagram = table === 'segments' && params.get('presentation') === 'diagram';
  const ix = useMemo(() => data ? workspaceIndex(data) : null, [data]);
  const schedule = useMemo(() => data ? physicalSchedule(data, !!session?.user && isOwner) : null, [data, session?.user, isOwner]);
  const selected = selectionFromUrl(params, data);
  const currentTable = schedule?.tables.find(t => t.id === table);
  const columns = visibleColumns[table].flatMap(key => { const column = currentTable?.columns.find(c => c.key === key); return column ? [column] : []; });
  const rows = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    const exactCircuitCode = !!search && !!data?.circuits.some(c => c.circuit_code.toLocaleLowerCase() === search);
    const filtered = (currentTable?.rows ?? []).filter(row => {
      if (section && rowSection(row.id, table, ix) !== section) return false;
      if (!matchesWorkspaceSearch(row, table, search, exactCircuitCode)) return false;
      if (filter === 'current_plan' && table === 'segments' && ix?.segments.get(row.id)?.in_current_plan !== true) return false;
      if (filter === 'alternatives' && table === 'segments' && ix?.segments.get(row.id)?.in_current_plan !== false) return false;
      if (filter === 'blocked' && table === 'segments' && !ix?.segments.get(row.id)?.blockers.length) return false;
      if (filter === 'unmeasured' && table === 'segments' && ix?.segments.get(row.id)?.measured_length_ft != null) return false;
      if (filter === 'unmodeled' && table === 'circuits' && row.cells.pieces !== 0) return false;
      return true;
    });
    if (sort) filtered.sort((a, b) => {
      const x = a.cells[sort.key], y = b.cells[sort.key];
      if (x == null || x === '') return y == null || y === '' ? 0 : 1;
      if (y == null || y === '') return -1;
      const comparison = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return sort.descending ? -comparison : comparison;
    });
    return filtered;
  }, [currentTable, data, query, section, table, ix, filter, sort]);
  const diagramIds = useMemo(() => rows.map(row => row.id), [rows]);
  const sections = useMemo(() => {
    const counts = new Map<string, number>();
    currentTable?.rows.forEach(row => { const key = rowSection(row.id, table, ix); counts.set(key, (counts.get(key) ?? 0) + 1); });
    return [...counts].sort((a, b) => sectionName(a[0]).localeCompare(sectionName(b[0])));
  }, [currentTable, table, ix]);
  const write = (patch: Record<string, string | null>) => setParams(prev => {
    const next = new URLSearchParams(prev);
    for (const [key, value] of Object.entries(patch)) value === null ? next.delete(key) : next.set(key, value);
    return next;
  }, { replace: true });
  const pick = (nextTable: WorkspaceTable, id: string) => {
    if (nextTable !== table) { setQuery(''); setFilter(nextTable === 'segments' ? 'current_plan' : 'all'); setSort(null); setSection(''); }
    write({ records: nextTable, record: id, sel: null, door: null, view: null });
  };
  const changeTable = (next: WorkspaceTable) => { setFilter(next === 'segments' ? 'current_plan' : 'all'); setSort(null); write({ records: next, record: null, sel: null, door: null, view: null }); };
  const showSummary = (next: WorkspaceTable, scope: string) => { changeTable(next); setQuery(''); setSection(''); setFilter(scope); };
  const download = async () => {
    if (!schedule || exporting) return;
    setExporting(true); setExportError(null);
    try {
      const bytes = await wiringWorkbookBytes(schedule);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'Harness-physical-records.xlsx';
      document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setExportError(err instanceof Error ? err.message : 'The workbook could not be created.'); }
    finally { setExporting(false); }
  };
  if (!data || !ix || !schedule) return <div className="hw-workspace hw-loading" style={theme} role="status">
    <h2>{loading ? 'Reading the physical harness…' : 'Harness unavailable'}</h2>
    {error && <><p>{error}</p><button type="button" onClick={refresh}>Retry database read</button></>}
  </div>;
  return <div className="hw-workspace" style={theme}>
    <header className="hw-header"><div><h1>Harness workspace</h1><p>Physical wire pieces, connections and source circuits</p></div>
      <div className="hw-header-actions"><button type="button" onClick={refresh}>Refresh</button><button type="button" className="hw-primary" disabled={exporting} onClick={download}>{exporting ? 'Creating workbook…' : 'Download Excel'}</button></div></header>
    <div className="hw-summary" aria-label="Database coverage">
      <Summary value={data.counts.current_plan_segments} label="current plan pieces" onClick={() => showSummary('segments', 'current_plan')} />
      <Summary value={data.counts.physical_ends} label="physical ends" onClick={() => showSummary('ends', 'all')} />
      <Summary value={data.counts.segments_with_material_blockers} label="pieces with material / revision issues" onClick={() => showSummary('segments', 'blocked')} />
      <Summary value={data.counts.current_circuits_without_segments} label="circuits without physical pieces" onClick={() => showSummary('circuits', 'unmodeled')} />
    </div>
    {exportError && <p className="hw-error" role="alert">Workbook unavailable: {exportError}</p>}
    <div className={`hw-body ${selected ? 'hw-with-detail' : ''}`}>
      <aside className="hw-sidebar" aria-label="Harness sections"><div className="hw-sidebar-heading">Sections</div>
        <button type="button" className={section === '' ? 'hw-current' : ''} onClick={() => setSection('')}><span>All sections</span><span>{currentTable?.rows.length}</span></button>
        {sections.map(([key, count]) => <button type="button" key={key} className={section === key ? 'hw-current' : ''} onClick={() => setSection(key)}><span>{sectionName(key)}</span><span>{count}</span></button>)}
        <div className="hw-sidebar-note">Planned lengths and recorded checks are shown with their basis. A design record does not establish received stock or permission to cut.</div>
      </aside>
      <main className="hw-main"><nav className="hw-tabs" aria-label="Harness record tables">{workspaceTables.map(id => <button type="button" key={id} aria-current={table === id ? 'page' : undefined} onClick={() => changeTable(id)}>{tableLabels[id]}</button>)}</nav>
        <div className="hw-toolbar"><input aria-label="Search harness records" type="search" placeholder="Search circuit, connection, part or record…" value={query} onChange={e => setQuery(e.target.value)} />
          {(table === 'segments' || table === 'circuits') && <select aria-label="Record filter" value={activeFilter} onChange={e => setFilter(e.target.value)}>{table === 'segments' && <option value="current_plan">Current plan</option>}<option value="all">All records</option>
            {table === 'segments' && <><option value="alternatives">Alternatives / retained</option><option value="blocked">All pieces with issues</option><option value="unmeasured">All unmeasured pieces</option></>}{table === 'circuits' && <option value="unmodeled">Without linked pieces</option>}</select>}
          {table === 'segments' && <div className="hw-view-toggle" aria-label="Physical piece presentation"><button type="button" aria-pressed={!diagram} onClick={() => write({ presentation: null })}>Table</button><button type="button" aria-pressed={diagram} onClick={() => write({ presentation: 'diagram' })}>Diagram</button></div>}
          <span className="hw-row-count" role="status">{rows.length} of {currentTable?.rows.length}</span></div>
        {selected?.table === table && !rows.some(row => row.id === selected.id) && <div className="hw-filter-note">The selected record is outside these filters. <button type="button" className="hw-link" onClick={() => { setQuery(''); setSection(''); setFilter('all'); }}>Show all records</button></div>}
        {diagram ? <PhysicalDiagram data={data} ix={ix} segmentIds={diagramIds} selectedId={selected?.table === 'segments' ? selected.id : undefined} pick={pick} /> : <div className="hw-table-scroll" tabIndex={0} aria-label={`${tableLabels[table]} table`}><table className="hw-table"><thead><tr>{columns.map(c => <th key={c.key} scope="col" className={c.numeric ? 'hw-numeric' : c.key === 'issues' ? 'hw-issues-heading' : ''} aria-sort={sort?.key === c.key ? sort.descending ? 'descending' : 'ascending' : 'none'}><button type="button" onClick={() => setSort({ key: c.key, descending: sort?.key === c.key ? !sort.descending : false })}>{c.key === 'issues' ? 'Material / revision' : c.label}{sort?.key === c.key ? sort.descending ? ' ↓' : ' ↑' : ''}</button></th>)}</tr></thead>
          <tbody>{rows.map(row => <tr key={row.id} className={selected?.id === row.id ? 'hw-selected-row' : undefined} onClick={() => pick(table, row.id)}>{columns.map((c, index) => <td key={c.key} className={`${c.numeric ? 'hw-numeric' : ''} ${['from', 'to', 'cavity', 'name'].includes(c.key) ? 'hw-wrap' : ''}`}>
            {index === 0 ? <button type="button" className="hw-row-link" aria-label={`Inspect ${tableLabels[table].toLowerCase()} ${row.cells[c.key] ?? shortId(row.id)}, ${shortId(row.id)}`} onClick={event => { event.stopPropagation(); pick(table, row.id); }}>{row.cells[c.key] ?? 'Unresolved'}{table === 'segments' && <small>{shortId(row.id)}</small>}</button>
              : c.key === 'issues' ? row.cells.issues ? <span className="hw-issue">{ix.segments.get(row.id)?.blockers.length} {ix.segments.get(row.id)?.blockers.length === 1 ? 'issue' : 'issues'}</span> : <span className="hw-muted">None reported</span>
              : row.cells[c.key] == null || row.cells[c.key] === '' ? <span className="hw-unknown">—</span> : row.cells[c.key]}
          </td>)}</tr>)}</tbody></table>
          {!rows.length && <div className="hw-empty"><h3>No matching records</h3><p>{currentTable?.rows.length ? 'Adjust the search, section or record filter.' : 'This database read contains no records in this table.'}</p>{!!currentTable?.rows.length && <button type="button" onClick={() => { setQuery(''); setSection(''); setFilter(table === 'segments' ? 'current_plan' : 'all'); }}>Reset filters</button>}</div>}</div>}
        <div className="hw-table-note">{table === 'segments' ? 'Current plan identifies design membership, not readiness to cut. One row per piece; lengths in feet; — means not recorded.' : table === 'circuits' ? 'Circuit function and design source. A circuit can contain several physical wire pieces.' : 'Every returned record keeps its own identity and recorded uncertainty.'}</div>
      </main>
      {selected && <aside className="hw-inspector" aria-label="Selected harness record"><div className="hw-inspector-heading"><span>Record inspector</span><button type="button" aria-label="Close record inspector" onClick={() => write({ record: null, sel: null })}>×</button></div><RecordDetail selected={selected} data={data} ix={ix} pick={pick} /></aside>}
    </div>
    <footer className="hw-footer"><span>Database read {new Date(data.read_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span><span title={data.snapshot_key}>Snapshot {data.snapshot_key.slice(0, 12)}</span><span>Excel includes all four record tables, including alternatives.</span></footer>
  </div>;
}
function Summary({ value, label, onClick }: { value: number; label: string; onClick: () => void }) { return <button type="button" onClick={onClick}><strong>{value.toLocaleString()}</strong><span>{label}</span></button>; }
function rowSection(id: string, table: WorkspaceTable, ix: WorkspaceIndex | null): string {
  if (!ix) return 'unassigned';
  if (table === 'endpoints') return ix.endpoints.get(id)?.harness_section ?? 'unassigned';
  const circuitId = table === 'segments' ? ix.segments.get(id)?.circuit_id : table === 'ends' ? ix.ends.get(id)?.circuit_id : id;
  return ix.circuits.get(circuitId ?? '')?.harness_section ?? 'unassigned';
}
function selectionFromUrl(params: URLSearchParams, data: Workspace | null): RecordSelection | null {
  const table = params.get('records') as WorkspaceTable, id = params.get('record');
  if (id) return { table: workspaceTables.includes(table) ? table : 'segments', id };
  const old = params.get('sel');
  if (old?.startsWith('s:')) return { table: 'segments', id: old.slice(2) };
  if (old?.startsWith('w:')) { const c = data?.circuits.find(c => c.circuit_code === old.slice(2) && !c.is_superseded); if (c) return { table: 'circuits', id: c.id }; }
  if (old?.startsWith('n:')) { const e = data?.endpoints.find(e => e.code === old.slice(2) && !e.is_superseded); if (e) return { table: 'endpoints', id: e.id }; }
  return null;
}
