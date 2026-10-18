import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { PrefetchLink as Link } from '../PrefetchLink';
import type { DatedSourceSale, comparePriceToSourceSales } from '../../lib/dealRead/batComps';
import './SourceSaleDistribution.css';

type Comparison = ReturnType<typeof comparePriceToSourceSales>;
export interface SourceSaleGraphProps {
  sales: readonly DatedSourceSale[];
  currency: string;
  label: string;
  basis: string;
  memberRows: number;
  minimumSales: number;
  yearRestricted?: boolean;
  modelRestricted?: boolean;
  eventFrom?: string;
  eventBefore?: string;
  evidenceAsOf?: string;
  knowledgeMode?: string;
  recordedLabels?: Readonly<Record<string, string>>;
  summary: { median: number | null; p10: number | null; p90: number | null };
  comparison: Comparison | null;
  candidateInput?: ReactNode;
  renderEvidence?: (sale: DatedSourceSale) => ReactNode;
  cohortAction?: ReactNode;
  page?: number;
  onPageChange?: (page: number) => void;
}

function sourceUrl(raw: string | null) {
  try { const u = new URL(raw ?? ''); return u.protocol === 'https:' && u.hostname === 'bringatrailer.com' && !u.username && !u.password && !u.port && /^\/listing\/[^/?#]+\/$/.test(u.pathname) && !u.search && !u.hash ? u.href : null; } catch { return null; }
}
function day(raw: string | null) {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const n = Date.parse(`${raw}T00:00:00Z`);
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === raw ? n : null;
}
function money(n: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
}
function axisMoney(n: number, currency: string) {
  if (n === 0) return '0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 0 }).format(n);
}
function cutoffStamp(raw: string) {
  return new Date(raw).toISOString().slice(0, 16).replace('T', ' ');
}

// Coordinates arrange the reader's actual members. Quantiles come from its SQL summary;
// candidate ranking reuses the existing audited calculator, never a new market fold.
export default function SourceSaleDistribution(props: SourceSaleGraphProps) {
  const { sales, currency, label, basis, memberRows, minimumSales, summary, comparison } = props;
  const [view, setView] = useState<'records' | 'timeline' | 'distribution'>('records');
  const [selected, setSelected] = useState<string | null>(null);
  const sourceRows = useMemo(() => [...sales].sort((a, b) => (a.eventAt ?? '').localeCompare(b.eventAt ?? '') || (a.sourceUrl ?? '').localeCompare(b.sourceUrl ?? '')), [sales]);
  const rows = useMemo(() => view === 'timeline' ? sourceRows : [...sourceRows].sort((a,b) => (a.amount ?? 0) - (b.amount ?? 0) || (a.sourceUrl ?? '').localeCompare(b.sourceUrl ?? '')), [sourceRows, view]);
  if (!rows.length) return props.cohortAction ? <div className="source-sales-cohort-action">{props.cohortAction}</div> : null;
  const valid = rows.every(r => r.outcome === 'sold' && r.currency === currency && r.priceBasis === 'published_bid_excluding_fees'
    && r.amount != null && Number.isFinite(r.amount) && r.amount > 0 && day(r.eventAt) != null && sourceUrl(r.sourceUrl)
    && sourceUrl(r.unitSource) === sourceUrl(r.sourceUrl)
    && r.knownAt != null && Number.isFinite(Date.parse(r.knownAt)) && Date.parse(r.knownAt) >= day(r.eventAt)!
    && (!props.evidenceAsOf || Date.parse(r.knownAt) <= Date.parse(props.evidenceAsOf)))
    && new Set(rows.map(r => r.sourceUrl)).size === rows.length;
  if (!valid) return <p role="status">The sale graph is unavailable: source rows do not match this receipt.</p>;
  const selectedSale = rows.find(r => r.sourceUrl === selected);
  const current = selectedSale ?? sourceRows[sourceRows.length - 1];
  const candidate = comparison?.percentile != null ? comparison.subject.amount : null;
  const highest = Math.max(...rows.map(r => r.amount!));
  const earliest = props.eventFrom ? Date.parse(props.eventFrom) : day(sourceRows[0].eventAt)!;
  const latest = props.eventBefore ? Date.parse(props.eventBefore) : day(sourceRows[sourceRows.length - 1].eventAt)!;
  if (!Number.isFinite(earliest) || !Number.isFinite(latest) || earliest > latest
    || rows.some(r => day(r.eventAt)! < earliest || (props.eventBefore ? day(r.eventAt)! + 86_400_000 > latest : day(r.eventAt)! > latest))) {
    return <p role="status">The sale graph is unavailable: source dates do not match the event window.</p>;
  }
  const x = (r: DatedSourceSale) => view === 'timeline' ? 72 + (latest === earliest ? .5 : (day(r.eventAt)! - earliest) / (latest - earliest)) * 610 : 72 + r.amount! / highest * 610;
  // Stack only marks that would collide at this resolution; no time/score is encoded by height.
  const lanes: number[][] = [], laneBySource = new Map<string, number>();
  for (const row of view === 'distribution' ? [...rows].sort((a,b) => a.amount! - b.amount!) : []) {
    const at = 72 + row.amount! / highest * 610;
    let lane = lanes.findIndex(points => points.every(prev => Math.abs(prev - at) >= 16));
    if (lane < 0) { lane = lanes.length; lanes.push([]); }
    lanes[lane].push(at); laneBySource.set(row.sourceUrl!, lane);
  }
  const chartHeight = view === 'distribution' ? Math.max(140, 95 + lanes.length * 16) : 275;
  const plotBottom = chartHeight - 45;
  const y = (r: DatedSourceSale) => view === 'timeline' ? 230 - r.amount! / highest * 190 : 50 + laneBySource.get(r.sourceUrl!)! * 16;
  const enough = rows.length >= minimumSales;
  const quantiles = enough && summary.median != null && summary.p10 != null && summary.p90 != null
    && [summary.median, summary.p10, summary.p90].every(n => Number.isFinite(n) && n >= 0 && n <= highest)
    && summary.p10 <= summary.median && summary.median <= summary.p90;
  const q = (n: number) => view === 'timeline' ? 230 - n / highest * 190 : 72 + n / highest * 610;
  const inspect = (url: string) => {
    setSelected(url);
    if (view === 'records') {
      const at = [...sourceRows].reverse().findIndex(r => r.sourceUrl === url);
      if (at >= 0) props.onPageChange?.(Math.floor(at / 25));
    }
  };
  const page = Math.min(props.page ?? 0, Math.floor((rows.length - 1) / 25));
  const visibleRecords = [...sourceRows].reverse().slice(page * 25, (page + 1) * 25);
  const selectedEvidence = <>
    <div className="source-sales-selected" aria-live="polite"><div><span className="source-sales-label">{selectedSale ? 'Selected source sale' : 'Latest qualified source sale'}</span><strong>{money(current.amount!, currency)} · {current.eventAt}</strong></div>
      <div className="source-sales-links">{current.vehicleId && <Link to={`/vehicle/${current.vehicleId}`}>Vehicle record →</Link>}<a href={sourceUrl(current.sourceUrl)!} target="_blank" rel="noopener noreferrer">Original sold result ↗</a></div>
      <span className="source-sales-note">{props.recordedLabels?.[current.sourceUrl!] ? `Current recorded label: ${props.recordedLabels[current.sourceUrl!]}` : 'Vehicle label not included in this receipt’s bounded summaries.'} A label does not establish matched build or condition.</span>
      <span className="source-sales-note">Evidence known: {current.knownAt ?? 'unknown'}. Sale date is separate from capture and ingestion.</span></div>
    {props.renderEvidence && <div className="source-sales-ancestry" key={current.sourceUrl}>{props.renderEvidence(current)}</div>}
  </>;
  const membership = props.modelRestricted === false ? props.yearRestricted ? 'Recorded make/year context; model unrestricted' : 'Recorded make context; model and year unrestricted'
    : props.yearRestricted ? basis === 'registered_same_year_model_context' ? 'Registered make/model/year context' : 'Same recorded make/model/year context'
      : 'Recorded make/model context; model year unrestricted';
  return <section className="source-sales" aria-label="Source-qualified sale graph">
    <div className="source-sales-heading"><div><span className="source-sales-label">Bring a Trailer / qualified recorded sales</span><h2>{label}</h2></div>
      <div className="source-sales-views" aria-label="Sale graph view"><button aria-pressed={view === 'records'} onClick={() => setView('records')}>Sale records</button><button aria-pressed={view === 'timeline'} onClick={() => setView('timeline')}>Over time</button><button aria-pressed={view === 'distribution'} onClick={() => setView('distribution')}>Distribution</button></div></div>
    <div className="source-sales-match"><strong>Sale-time features and condition are not matched.</strong></div>
    <div className="source-sales-window"><span>{rows.length} recorded sales · {currency} · buyer fees excluded</span><span>{new Date(earliest).toISOString().slice(0, 10)} – {new Date(latest).toISOString().slice(0, 10)}</span></div>
    <details className="source-sales-context"><summary>Membership, coverage and evidence dates</summary>
    <p className="source-sales-note">Build, body style, trim, engine, mileage and equipment are unmeasured here. These amounts do not establish a vehicle’s value.</p>
    <p className="source-sales-scope">{rows.length} source lots qualify from {memberRows.toLocaleString('en-US')} current public cohort records. This is a qualification subset, not complete BaT market coverage.</p>
    {props.cohortAction && <div className="source-sales-cohort-action">{props.cohortAction}</div>}
    <p className="source-sales-note">{props.eventFrom && props.eventBefore && <>Requested sale window: {cutoffStamp(props.eventFrom)} to {cutoffStamp(props.eventBefore)} UTC (end excluded). Full source-date intervals must fit. </>}Latest qualifying sale: {sourceRows[sourceRows.length-1].eventAt}. Gaps mean missing qualifying evidence, not zero market sales.
      {props.evidenceAsOf && <> Evidence through {new Date(props.evidenceAsOf).toLocaleString('en-US', { timeZone: 'UTC', timeZoneName: 'short' })}. {props.knowledgeMode === 'retrospective' ? 'Retrospective: later-discovered sales can enter.' : 'Evidence known at the declared cutoff.'}</>}</p>
    <p className="source-sales-note">{membership}, using current recorded identity. {!props.yearRestricted && 'Related model variants may be absent; this differs from a registered year/model context.'} Labels below describe current records, not verified features at the time of sale.</p></details>
    {view === 'records' ? <>
      <p className="source-sales-scale">Each mark locates a sold amount on the same 0–{money(highest, currency)} scale.</p>
      <div className="source-sales-record-head"><span>Current record label · newest sale first</span><span className="source-sales-record-axis"><span>0</span><span>{axisMoney(highest, currency)}</span></span><span>Sold price</span></div>
      <ol className="source-sales-records" aria-label="Recorded sale vehicles">
        {visibleRecords.map(r => <li key={r.sourceUrl}>
          <div className="source-sales-record-name"><button aria-expanded={selectedSale != null && r === current} aria-label={`Inspect ${props.recordedLabels?.[r.sourceUrl!] || 'untitled record'}, ${money(r.amount!, currency)}, sold ${r.eventAt}`} onClick={() => selected === r.sourceUrl ? setSelected(null) : inspect(r.sourceUrl!)}>{props.recordedLabels?.[r.sourceUrl!] || 'Recorded title unavailable'}</button><span>{r.eventAt} · <a href={sourceUrl(r.sourceUrl)!} target="_blank" rel="noopener noreferrer">BaT result ↗</a></span></div>
          <div className="source-sales-record-position" aria-hidden="true"><span className="source-sales-record-track" /><span className="source-sales-record-dot" style={{ left: `${r.amount! / highest * 100}%` }} /></div>
          <span className="source-sales-record-price">{money(r.amount!, currency)}</span>
          {selectedSale && r === current && <div className="source-sales-record-evidence">{selectedEvidence}</div>}
        </li>)}
      </ol>
      {rows.length > 25 && props.onPageChange && <nav className="source-sales-pages" aria-label="Sale vehicle pages"><span>{page * 25 + 1}–{Math.min((page + 1) * 25, rows.length)} of {rows.length} sales; scale uses all sales</span><button disabled={page === 0} onClick={() => { setSelected(null); props.onPageChange?.(page - 1); }}>Previous</button><button disabled={(page + 1) * 25 >= rows.length} onClick={() => { setSelected(null); props.onPageChange?.(page + 1); }}>Next</button></nav>}
    </> : <>
    <svg viewBox={`0 0 720 ${chartHeight}`} className="source-sales-chart" role="group" aria-label={`${view === 'timeline' ? 'Sale amounts by source date' : 'Sale amount distribution'}, ${currency}. Each point opens its evidence.`}>
      {quantiles && view === 'distribution' && <rect x={q(summary.p10!)} width={q(summary.p90!) - q(summary.p10!)} y="20" height={plotBottom - 20} className="source-sales-band" />}
      {[0, .5, 1].map(f => view === 'timeline' ? <g key={f}><line x1="72" x2="682" y1={230 - f * 190} y2={230 - f * 190} className="source-sales-grid" /><text x="63" y={234 - f * 190} textAnchor="end">{axisMoney(highest * f, currency)}</text></g>
        : <g key={f}><line x1={72 + f * 610} x2={72 + f * 610} y1="20" y2={plotBottom} className="source-sales-grid" /><text x={72 + f * 610} y={chartHeight - 21} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}>{axisMoney(highest * f, currency)}</text></g>)}
      {quantiles && view === 'distribution' && <line x1={q(summary.median!)} x2={q(summary.median!)} y1="20" y2={plotBottom} className="source-sales-median" />}
      {rows.map((r, i) => <g key={r.sourceUrl} role="button" tabIndex={r === current ? 0 : -1} aria-pressed={r === current}
        aria-label={`${props.recordedLabels?.[r.sourceUrl!] || 'Recorded title unavailable'}. ${money(r.amount!, currency)}, sold ${r.eventAt}. Inspect source sale`} onClick={() => inspect(r.sourceUrl!)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inspect(r.sourceUrl!); }
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault(); const next = Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)));
            (e.currentTarget.parentElement?.querySelectorAll<SVGGElement>('[role="button"]')[next])?.focus(); inspect(rows[next].sourceUrl!);
          }
        }}><circle cx={x(r)} cy={y(r)} r="13" fill="transparent" /><circle cx={x(r)} cy={y(r)} r={r === current ? 6 : 4} className="source-sales-point" /><title>{props.recordedLabels?.[r.sourceUrl!] || 'Recorded title unavailable'} · {money(r.amount!, currency)} · {r.eventAt}</title></g>)}
      {view === 'timeline' && <><text x="72" y="254">{new Date(earliest).toISOString().slice(0,10)}</text><text x="682" y="254" textAnchor="end">{new Date(latest).toISOString().slice(0,10)}</text></>}
    </svg>
    <div className="source-sales-legend"><span>● One source sale</span>{quantiles && view === 'distribution' && <><span className="source-sales-band-key">Shading: whole-window P10–P90</span><span>Dashed: median</span></>}</div>
    <p className="source-sales-note">{view === 'timeline' ? 'Source dates retain day precision; points are not joined into a trend. Vehicle mix can change across dates.' : 'Horizontal position is the sale amount. Vertical stacking separates colliding marks at this chart’s resolution; height is not time or another measure.'} Nominal {currency}, excluding buyer fees; no inflation or currency adjustment.</p>
    </>}
    <details className="source-sales-raw-position"><summary>Compare an amount with these unmatched sales</summary><p className="source-sales-note">This ranks a number in the recorded sample. It cannot tell you whether a particular vehicle is cheap, expensive or fairly valued.</p><div className="source-sales-answer">
      <div className="source-sales-price-input">{props.candidateInput}</div>
      {candidate != null && comparison?.percentile != null ? <><strong>{money(candidate, currency)} · {comparison.percentile.toFixed(1)} percentile in unmatched sales</strong><span>{comparison.counts.below} sales lower · {comparison.counts.equal} equal · {comparison.counts.above} higher. Ties receive half weight.</span></>
        : quantiles ? <><strong>Median recorded sale {money(summary.median!, currency)}</strong><span>Enter a candidate amount to see its price position in these sales.</span></>
          : <><strong>{rows.length} retained source sales</strong><span>Aggregate prices require {minimumSales} qualified sales.</span></>}
    </div>
    </details>
    {view !== 'records' && <div>{selectedEvidence}</div>}
    <details className="source-sales-table"><summary>Inspect all {rows.length} source sales as a table</summary><div><table><thead><tr><th scope="col">Source sale date</th><th scope="col">Amount · {currency}</th><th scope="col">Evidence</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.sourceUrl}><td>{r.eventAt}</td><td><button aria-pressed={r === current} onClick={() => inspect(r.sourceUrl!)}>{money(r.amount!, currency)}</button></td><td><a href={sourceUrl(r.sourceUrl)!} target="_blank" rel="noopener noreferrer">Source ↗</a>{r.vehicleId && <Link to={`/vehicle/${r.vehicleId}`}>Record →</Link>}</td></tr>)}</tbody></table></div></details>
  </section>;
}
