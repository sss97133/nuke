import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PrefetchLink } from '../../components/PrefetchLink';
import { matchSalesMake, recordedSalesRequest, recordedSalesWindow, useRecordedSales, useSalesScopes,
  type SalesDrill, type SalesPoint, type SalesSeries } from './useRecordedSales';
import './RecordedSalesComparison.css';

const label: React.CSSProperties = { fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 };
const mono: React.CSSProperties = { fontFamily: "'Courier New', monospace" };
const control: React.CSSProperties = { fontFamily: 'Arial, sans-serif', fontSize: 12, color: 'var(--text)',
  background: 'var(--bg)', border: '2px solid var(--border)', padding: 5, maxWidth: '100%' };
const number = (n: number | null | undefined) => n == null ? 'unknown' : n.toLocaleString('en-US');
const day = (date: string) => date.slice(0, 10);
const utc = (date: string) => new Date(date).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
const seriesName = (series: SalesSeries, selected: string) => series === 'selected' ? selected : 'Rest of BaT';
export interface MarketSalesLens { scopeKey: string | null; days: 2 | 7; drill: SalesDrill | null; benchmark: boolean }

function CountBucket({ point, name, max, refused, active, onClick }: {
  point: SalesPoint; name: string; max: number; refused: boolean; active: boolean; onClick: () => void;
}) {
  const unavailable = refused || point.value == null || point.denominator == null;
  return <div style={{ minWidth: 0 }}>
    <button onClick={onClick} disabled={unavailable || point.value === 0} aria-pressed={active}
      aria-label={`${day(point.bucket_start)} UTC · ${name}: ${unavailable ? 'counts refused' : `${point.value} recorded sales, ${point.denominator} eligible ended episodes`}. Show contributors`}
      className="sales-count-point" data-value={unavailable ? undefined : point.value}
      style={{ borderColor: active ? 'var(--text)' : 'transparent' }}>
      <span style={{ ...mono, fontSize: 13 }}>{unavailable ? '—' : number(point.value)}</span>
      {!unavailable && <span aria-hidden="true" className="sales-count-track">
        <span className="sales-count-bar" style={{ height: `${(point.value ?? 0) / max * 100}%`,
          background: point.series === 'selected' ? 'var(--text)' : 'var(--text-secondary)' }} />
      </span>}
      <span style={{ ...mono, fontSize: 10 }}>{day(point.bucket_start).slice(5)}</span>
    </button>
  </div>;
}

/** Public evidence from the existing count owner, with its missing comparisons kept visible. */
export default function RecordedSalesComparison({ make, onMakeChange, view = 'sales', onViewChange, lens, onLensChange }: {
  make: string | null; onMakeChange?: (make: string | null, scopeKey?: string | null) => void;
  view?: 'inventory' | 'sales'; onViewChange?: (view: 'inventory' | 'sales') => void;
  lens?: MarketSalesLens; onLensChange?: (change: Partial<MarketSalesLens>) => void;
}) {
  const catalog = useSalesScopes();
  const [localChosen, setChosen] = useState<string | null>(null);
  const [localDays, setDays] = useState<2 | 7>(7);
  const [windowClock, setWindowClock] = useState(() => Date.now());
  const [localDrill, setDrill] = useState<SalesDrill | null>(null);
  const [localBenchmark, setShowBenchmark] = useState(false);
  const chosen = lens ? lens.scopeKey : localChosen;
  const days = lens?.days ?? localDays;
  const drill = lens ? lens.drill : localDrill;
  const showBenchmark = lens?.benchmark ?? localBenchmark;
  const window = useMemo(() => recordedSalesWindow(days, windowClock), [days, windowClock]);
  const evidenceRef = useRef<HTMLDivElement>(null);
  const focusEvidence = useRef(false);
  const options = catalog.data ?? [];
  // Porsche is the owner's initial comparison case; its ID still comes from the public registry.
  const requestedMake = onMakeChange ? make : make ?? 'PORSCHE';
  const chosenOption = options.find(o => o.key === chosen);
  const option = view === 'sales' && chosen != null
    ? chosenOption?.make.toUpperCase() === requestedMake?.toUpperCase() ? chosenOption : undefined
    : matchSalesMake(options, requestedMake);
  const request = useMemo(() => option && view === 'sales' ? recordedSalesRequest(option.scope, window, drill) : null, [option, window, drill, view]);
  const query = useRecordedSales(request);
  const response = option && view === 'sales' ? query.data : undefined;
  const receipt = response?.state === 'partial' ? response : undefined;
  const buckets = [...new Set(receipt?.series.map(p => p.bucket_start) ?? [])].sort();
  const max = Math.max(1, ...receipt?.series.filter(p => showBenchmark || p.series === 'selected').map(p => p.value ?? 0) ?? []);
  const selectedName = option?.label ?? receipt?.scope.label ?? 'Selected scope';
  const contributors = (receipt?.evidence.contributors ?? []).filter(c => drill
    && c.series === drill.series && day(c.bucket_start) === day(drill.bucket));
  useEffect(() => {
    if (focusEvidence.current && drill && receipt && !query.isFetching && !query.isError) {
      evidenceRef.current?.focus({ preventScroll: true });
      evidenceRef.current?.scrollIntoView?.({ block: 'nearest' });
      focusEvidence.current = false;
    }
  }, [drill, receipt, query.isFetching, query.isError]);
  const refresh = () => {
    const next = recordedSalesWindow(days);
    if (next.event_to !== window.event_to) { setWindowClock(Date.now()); setDrill(null); onLensChange?.({ drill: null }); }
    else void query.refetch();
  };

  return <section className="market-sales-comparison" aria-label="Recorded sales comparison" style={{ border: '2px solid var(--border)', padding: 8, marginBottom: 12, minWidth: 0 }}>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px 16px', flexWrap: 'wrap', marginBottom: 8 }}>
      <h2 style={{ ...label, margin: 0 }}>{view === 'sales' ? 'Recorded sales over time' : 'Market explorer'}</h2>
      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Bring a Trailer · {view === 'sales' ? 'partial capture · daily UTC listing episodes' : 'captured open vehicle lots'}</span>
    </div>
    <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap', marginBottom: 8 }}>
      <label style={{ ...label, minWidth: 0, maxWidth: '100%' }}>{onMakeChange ? 'Market cohort' : 'Recorded sales scope'}<br />
        <select aria-label="Recorded sales scope" value={option?.key ?? ''} style={control}
          onChange={e => { setChosen(e.target.value || null); setDrill(null); onMakeChange?.(options.find(o => o.key === e.target.value)?.make ?? null, e.target.value || null); }}>
          <option value="">{onMakeChange ? 'All makes · live inventory' : 'Choose a registered make or supported grouping'}</option>
          <optgroup label="Make populations">{options.filter(o => o.scope.kind === 'canonical_make').map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</optgroup>
          {view === 'sales' && <optgroup label="Supported comparison groupings">{options.filter(o => o.scope.kind === 'supported_subject').map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</optgroup>}
        </select>
      </label>
      {view === 'sales' && <label style={label}>Event window<br /><select aria-label="Recorded sales event window" value={days} style={control}
        onChange={e => { const n = Number(e.target.value) as 2 | 7; setDays(n); setWindowClock(Date.now()); setDrill(null); onLensChange?.({ days: n, drill: null }); }}>
        <option value={2}>Last 2 full UTC days</option><option value={7}>Last 7 full UTC days</option>
      </select></label>}
      {view === 'sales' && <button style={control} disabled={!option || query.isFetching} onClick={refresh}>Refresh recorded evidence</button>}
      {onViewChange && <div role="group" aria-label="Market view" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {(['inventory', 'sales'] as const).map(mode => <button key={mode} style={{ ...control,
          background: view === mode ? 'var(--text)' : 'var(--bg)', color: view === mode ? 'var(--bg)' : 'var(--text)' }}
          aria-pressed={view === mode} onClick={() => { setDrill(null); onViewChange(mode); }}>
          {mode === 'inventory' ? 'Open inventory' : 'Recorded sales'}
        </button>)}
      </div>}
    </div>
    {onMakeChange && option?.scope.kind === 'supported_subject' && view === 'sales' && <div style={{ fontSize: 11, marginBottom: 8 }}>
      This supported grouping applies to recorded sales; live grouping membership is unavailable.
    </div>}
    {catalog.isError ? <div role="status">The scope registry could not be read. <button style={control} onClick={() => void catalog.refetch()}>Retry scope registry</button></div>
      : catalog.isLoading ? <div role="status">Reading the public scope registry…</div>
      : !option && view === 'sales' ? <div role="status">{make ? `No unique registered make matches ${make}. ` : ''}Choose a registered make or grouping to compare its recorded sales with the rest of BaT.</div> : null}
    {option && view === 'sales' && query.isFetching && <div role="status">Reading recorded outcomes{drill ? ' and bucket contributors' : ''}…</div>}
    {option && view === 'sales' && query.isError && <div role="status">Recorded outcomes could not be refreshed.{receipt ? ' The previous read remains below.' : ''} <button style={control} onClick={() => void query.refetch()}>Retry recorded outcomes</button></div>}
    {response?.state === 'unavailable' && <div role="status">This comparison is unavailable: {response.reason.replace(/_/g, ' ')}. Missing coverage is not zero demand.</div>}
    {drill && <button style={control} onClick={() => { setDrill(null); onLensChange?.({ drill: null }); }}>Clear selected sales day</button>}
    {receipt && <>
      <p style={{ fontSize: 12, margin: '8px 0', overflowWrap: 'anywhere' }}>
        {day(receipt.event_from)} ≤ event time &lt; {day(receipt.event_to)} UTC.
      </p>
      {receipt.truncated ? <div role="status" style={{ fontSize: 12, padding: '8px 0' }}>
        Candidate limit exceeded ({number(receipt.captured_candidates)} captured; limit {number(receipt.candidate_limit)}). Counts, denominators, ratios and changes are refused. Choose a shorter window.
      </div> : null}
      {!receipt.truncated && <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, margin: '8px 0' }}>
        <input type="checkbox" checked={showBenchmark} aria-label="Show rest of BaT absolute counts" onChange={e => { setShowBenchmark(e.target.checked); setDrill(null); onLensChange?.({ benchmark: e.target.checked, drill: null }); }} />
        Add rest of BaT · absolute counts from a larger population
      </label>}
      <div aria-label="Daily recorded sales counts" style={{ display: 'grid', gap: 8 }}>
        {!receipt.truncated && <span style={{ fontSize: 11 }}>Daily sales · shared count scale 0–{number(max)}. Select a day’s count for its sources.</span>}
        {(showBenchmark ? ['selected', 'benchmark'] as const : ['selected'] as const).map(series => <div key={series}>
          <div style={{ ...label, marginBottom: 4 }}>{seriesName(series, selectedName)}</div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, buckets.length)}, minmax(0, 1fr))`, gap: 2 }}>
            {buckets.map(bucket => {
              const point = receipt.series.find(p => p.bucket_start === bucket && p.series === series);
              return point ? <CountBucket key={bucket} point={point} name={seriesName(series, selectedName)} max={max}
                refused={receipt.truncated} active={drill != null && day(drill.bucket) === day(bucket) && drill.series === series}
                onClick={() => { focusEvidence.current = true; setDrill({ bucket, series }); onLensChange?.({ drill: { bucket, series } }); }} /> : <div key={bucket} style={{ fontSize: 10 }}>Unknown<br />{day(bucket).slice(5)}</div>;
            })}
          </div>
        </div>)}
      </div>
      <div style={{ fontSize: 11, margin: '8px 0', color: 'var(--text-secondary)' }}>
        Read <time dateTime={receipt.knowledge_cutoff}>{utc(receipt.knowledge_cutoff)}</time>.{' '}
        Ratios and period changes: unknown. Capture and result completeness are unverified, so these counts do not establish relative market performance.
      </div>
      {!receipt.truncated && <details style={{ fontSize: 11, margin: '8px 0' }}>
        <summary>Daily counts and outcome coverage</summary>
        {receipt.series.map(point => <div key={`${point.bucket_start}:${point.series}`} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
          {day(point.bucket_start)} UTC · {seriesName(point.series, selectedName)}: {number(point.value)} recorded sales · {number(point.denominator)} captured ended listings.
          <div>{point.denominator === 0 ? 'No matched captured episodes; this does not establish zero demand.' :
            `Source clocks: ${number(point.coverage.source_clock_known)} recorded · ${number(point.coverage.source_clock_unknown)} unknown. Ended pending: ${number(point.coverage.ended_pending)}.`}
            {point.coverage.incomplete_bucket && ' Partial UTC bucket.'}</div>
          <div>Explicit no-sale: {number(point.coverage.explicit_no_sale)} · bid-to: {number(point.coverage.bid_to)} · sold without supported amount: {number(point.coverage.sold_without_supported_amount)}.</div>
        </div>)}
      </details>}
      {drill && !receipt.truncated && !query.isFetching && !query.isError && <div ref={evidenceRef} tabIndex={-1} aria-label="Recorded sales contributors" style={{ borderTop: '2px solid var(--border)', paddingTop: 8 }}>
        <h3 style={{ ...label, margin: '0 0 6px' }}>{day(drill.bucket)} UTC · {seriesName(drill.series, selectedName)} · contributors</h3>
        <div style={{ fontSize: 11 }}>Showing {contributors.length}; limit {receipt.evidence.per_bucket_series_limit} per bucket and series. {receipt.evidence.has_more ? 'More contributors omitted; no pagination cursor.' : 'No contributors omitted by this read limit.'} This drill has the current read cutoff shown above.</div>
        {contributors.length === 0 && <div role="status" style={{ fontSize: 12, padding: '6px 0' }}>No supported recorded-sale contributors in this bucket at this read.</div>}
        <ol style={{ paddingLeft: 20, margin: '8px 0' }}>{contributors.map(c => <li key={c.auction_event_id} style={{ marginBottom: 8, overflowWrap: 'anywhere', fontSize: 12 }}>
          <PrefetchLink to={`/vehicle/${c.vehicle_id}`}>Vehicle record</PrefetchLink>{' · '}
          <a href={c.source_url} target="_blank" rel="noopener noreferrer">BaT listing ↗</a>
          <div style={{ ...mono, fontSize: 11, color: 'var(--text-secondary)' }}>{c.source_url}</div>
          <div style={{ fontSize: 11 }}>Recorded listing end <time dateTime={c.event_at}>{utc(c.event_at)}</time>.
            {' '}{c.source_read_basis === 'direct_fetch' || c.source_read_basis === 'cached_snapshot'
              ? c.source_observed_at ? <>Source {c.source_read_basis === 'direct_fetch' ? 'direct read' : 'cached snapshot'} <time dateTime={c.source_observed_at}>{utc(c.source_observed_at)}</time>.</> : 'Source read time unknown.'
              : 'Source read time unknown.'}
          </div>
        </li>)}</ol>
      </div>}
      <details style={{ fontSize: 11, marginTop: 8 }}>
        <summary>Method, eligibility and clocks</summary>
        <p>Recorded knowledge as of <time dateTime={receipt.knowledge_cutoff}>{utc(receipt.knowledge_cutoff)}</time>. Later arrivals can change these counts; this is a current read, not a frozen historical snapshot.</p>
        <p>{number(receipt.coverage.eligible_recorded_episodes)} captured eligible episodes · {number(receipt.coverage.unresolved_scope)} unresolved memberships excluded from both series · {number(receipt.coverage.conflicting_alias_episodes)} conflicting listing aliases.</p>
        <p>Public, undeleted vehicle parents only. One slash-normalized BaT listing episode per count, using its recorded end time and an explicit sold outcome with supported positive amount. The denominator also contains captured non-sale, bid-to, pending and unresolved-outcome episodes assigned to this series. It is not all market inventory or an ownership-transfer count.</p>
        <p>{receipt.scope.comparison_basis}. {receipt.scope.comparison_scope_basis}</p>
        <p>Source reads are qualified as direct, cached or unknown. Query time and row writes are not source freshness. A future recorded result may change an ended-pending count. Full UTC days are full time buckets, not complete source capture. Condition and factory generation are unverified.</p>
      </details>
    </>}
  </section>;
}
