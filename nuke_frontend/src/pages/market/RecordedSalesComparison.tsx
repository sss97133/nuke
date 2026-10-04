import React, { useMemo, useState } from 'react';
import { PrefetchLink } from '../../components/PrefetchLink';
import { matchSalesMake, recordedSalesRequest, recordedSalesWindow, useRecordedSales, useSalesScopes,
  type SalesDrill, type SalesPoint, type SalesSeries } from './useRecordedSales';

const label: React.CSSProperties = { fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 };
const mono: React.CSSProperties = { fontFamily: "'Courier New', monospace" };
const control: React.CSSProperties = { fontFamily: 'Arial, sans-serif', fontSize: 12, color: 'var(--text)',
  background: 'var(--bg)', border: '2px solid var(--border)', padding: 5, maxWidth: '100%' };
const number = (n: number | null | undefined) => n == null ? 'unknown' : n.toLocaleString('en-US');
const day = (date: string) => date.slice(0, 10);
const utc = (date: string) => new Date(date).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
const seriesName = (series: SalesSeries, selected: string) => series === 'selected' ? selected : 'Rest of BaT';

function CountBucket({ point, name, max, refused, active, onClick }: {
  point: SalesPoint; name: string; max: number; refused: boolean; active: boolean; onClick: () => void;
}) {
  const unavailable = refused || point.value == null || point.denominator == null;
  return <div style={{ minWidth: 0 }}>
    <button onClick={onClick} disabled={unavailable || point.value === 0} aria-pressed={active}
      aria-label={`${day(point.bucket_start)} UTC · ${name}: ${unavailable ? 'counts refused' : `${point.value} recorded sales, ${point.denominator} eligible ended episodes`}. Show contributors`}
      style={{ ...control, display: 'block', textAlign: 'left', width: '100%', minHeight: 64,
        borderColor: active ? 'var(--text)' : 'var(--border)', cursor: unavailable || point.value === 0 ? 'default' : 'pointer' }}>
      <span style={{ ...label, display: 'block', overflowWrap: 'anywhere' }}>{name}</span>
      <span style={{ ...mono, display: 'block', margin: '4px 0' }}>
        {unavailable ? 'Counts refused' : `${number(point.value)} recorded sales · ${number(point.denominator)} eligible ended`}
      </span>
      {!unavailable && <span aria-hidden="true" style={{ display: 'block', height: 6, background: 'var(--surface)' }}>
        <span style={{ display: 'block', height: '100%', width: `${(point.value ?? 0) / max * 100}%`,
          background: point.series === 'selected' ? 'var(--text)' : 'var(--text-secondary)' }} />
      </span>}
    </button>
    {!unavailable && <div style={{ fontSize: 11, color: 'var(--text-secondary)', padding: '4px 2px', overflowWrap: 'anywhere' }}>
      {point.denominator === 0 ? 'No matched captured episodes; this does not establish zero demand.' :
        `Source clocks: ${number(point.coverage.source_clock_known)} recorded · ${number(point.coverage.source_clock_unknown)} unknown. Ended pending: ${number(point.coverage.ended_pending)}.`}
      {point.coverage.incomplete_bucket && ' Partial UTC bucket.'}
    </div>}
    {!unavailable && <details style={{ fontSize: 11, padding: '0 2px' }}>
      <summary>Captured outcome coverage</summary>
      Explicit no-sale: {number(point.coverage.explicit_no_sale)} · bid-to: {number(point.coverage.bid_to)} · sold without supported amount: {number(point.coverage.sold_without_supported_amount)}. These are recorded categories, not an inference from positive bid numbers.
    </details>}
  </div>;
}

/** Public evidence from the existing count owner, with its missing comparisons kept visible. */
export default function RecordedSalesComparison({ make }: { make: string | null }) {
  const catalog = useSalesScopes();
  const [chosen, setChosen] = useState<string | null>(null);
  const [days, setDays] = useState<2 | 7>(2);
  const [window, setWindow] = useState(() => recordedSalesWindow(2));
  const [drill, setDrill] = useState<SalesDrill | null>(null);
  const options = catalog.data ?? [];
  // Porsche is the owner's initial comparison case; its ID still comes from the public registry.
  const option = chosen == null ? matchSalesMake(options, make ?? 'PORSCHE') : options.find(o => o.key === chosen);
  const request = useMemo(() => option ? recordedSalesRequest(option.scope, window, drill) : null, [option, window, drill]);
  const query = useRecordedSales(request);
  const response = option ? query.data : undefined;
  const receipt = response?.state === 'partial' ? response : undefined;
  const buckets = [...new Set(receipt?.series.map(p => p.bucket_start) ?? [])].sort();
  const max = Math.max(1, ...receipt?.series.map(p => p.value ?? 0) ?? []);
  const selectedName = option?.label ?? receipt?.scope.label ?? 'Selected scope';
  const contributors = (receipt?.evidence.contributors ?? []).filter(c => drill
    && c.series === drill.series && day(c.bucket_start) === day(drill.bucket));
  const refresh = () => {
    const next = recordedSalesWindow(days);
    if (next.event_to !== window.event_to) { setWindow(next); setDrill(null); }
    else void query.refetch();
  };

  return <section aria-label="Recorded sales comparison" style={{ border: '2px solid var(--border)', padding: 8, marginBottom: 12, minWidth: 0 }}>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px 16px', flexWrap: 'wrap', marginBottom: 8 }}>
      <h2 style={{ ...label, margin: 0 }}>Recorded sales · selected scope vs rest of BaT</h2>
      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Partial capture · daily UTC listing episodes</span>
    </div>
    <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap', marginBottom: 8 }}>
      <label style={{ ...label, minWidth: 0, maxWidth: '100%' }}>Recorded sales scope<br />
        <select aria-label="Recorded sales scope" value={option?.key ?? ''} style={control}
          onChange={e => { setChosen(e.target.value); setDrill(null); }}>
          <option value="">Choose a registered make or supported grouping</option>
          <optgroup label="Make populations">{options.filter(o => o.scope.kind === 'canonical_make').map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</optgroup>
          <optgroup label="Supported comparison groupings">{options.filter(o => o.scope.kind === 'supported_subject').map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</optgroup>
        </select>
      </label>
      <label style={label}>Event window<br /><select aria-label="Recorded sales event window" value={days} style={control}
        onChange={e => { const n = Number(e.target.value) as 2 | 7; setDays(n); setWindow(recordedSalesWindow(n)); setDrill(null); }}>
        <option value={2}>Last 2 full UTC days</option><option value={7}>Last 7 full UTC days</option>
      </select></label>
      <button style={control} disabled={!option || query.isFetching} onClick={refresh}>Refresh recorded evidence</button>
    </div>
    {catalog.isError ? <div role="status">The scope registry could not be read. <button style={control} onClick={() => void catalog.refetch()}>Retry scope registry</button></div>
      : catalog.isLoading ? <div role="status">Reading the public scope registry…</div>
      : !option ? <div role="status">{make ? `No unique registered make matches ${make}. ` : ''}Choose a scope to compare its captured outcomes with other resolved BaT listings.</div> : null}
    {option && query.isFetching && <div role="status">Reading recorded outcomes{drill ? ' and bucket contributors' : ''}…</div>}
    {option && query.isError && <div role="status">Recorded outcomes could not be refreshed.{receipt ? ' The previous read remains below.' : ''} <button style={control} onClick={() => void query.refetch()}>Retry recorded outcomes</button></div>}
    {response?.state === 'unavailable' && <div role="status">This comparison is unavailable: {response.reason.replace(/_/g, ' ')}. Missing coverage is not zero demand.</div>}
    {receipt && <>
      <p style={{ fontSize: 12, margin: '8px 0', overflowWrap: 'anywhere' }}>
        {day(receipt.event_from)} ≤ event time &lt; {day(receipt.event_to)} UTC. Recorded knowledge as of <time dateTime={receipt.knowledge_cutoff}>{utc(receipt.knowledge_cutoff)}</time>.
        {' '}Counts can change as outcomes arrive; this is a current read, not a frozen historical snapshot.
      </p>
      {receipt.truncated ? <div role="status" style={{ fontSize: 12, padding: '8px 0' }}>
        Candidate limit exceeded ({number(receipt.captured_candidates)} captured; limit {number(receipt.candidate_limit)}). Counts, denominators, ratios and changes are refused. Choose a shorter window.
      </div> : <div style={{ fontSize: 11, marginBottom: 8, overflowWrap: 'anywhere' }}>
        {number(receipt.coverage.eligible_recorded_episodes)} captured eligible episodes · {number(receipt.coverage.unresolved_scope)} unresolved memberships excluded from both series · {number(receipt.coverage.conflicting_alias_episodes)} conflicting listing aliases.
      </div>}
      <div aria-label="Daily recorded sales counts" style={{ display: 'grid', gap: 8 }}>
        {!receipt.truncated && <span style={{ fontSize: 11 }}>Select a sales count to open its source and vehicle contributors.</span>}
        {buckets.map(bucket => <div key={bucket}>
          <div style={{ ...label, marginBottom: 4 }}>{day(bucket)} UTC</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 6 }}>
            {(['selected', 'benchmark'] as const).map(series => {
              const point = receipt.series.find(p => p.bucket_start === bucket && p.series === series);
              return point ? <CountBucket key={series} point={point} name={seriesName(series, selectedName)} max={max}
                refused={receipt.truncated} active={drill?.bucket === bucket && drill.series === series}
                onClick={() => setDrill({ bucket, series })} /> : <div key={series}>Bucket coverage unavailable</div>;
            })}
          </div>
        </div>)}
      </div>
      <div style={{ fontSize: 11, margin: '8px 0', color: 'var(--text-secondary)' }}>
        Ratios and period changes: unknown. Each denominator counts captured eligible ended listing episodes in that series. External capture and result settlement are unverified; unknown source clocks do not prove staleness. No currency or valuation comparison is returned.
      </div>
      {drill && !receipt.truncated && <div aria-label="Recorded sales contributors" style={{ borderTop: '2px solid var(--border)', paddingTop: 8 }}>
        <h3 style={{ ...label, margin: '0 0 6px' }}>{day(drill.bucket)} UTC · {seriesName(drill.series, selectedName)} · contributors</h3>
        <div style={{ fontSize: 11 }}>Showing {contributors.length}; limit {receipt.evidence.per_bucket_series_limit} per bucket and series. {receipt.evidence.has_more ? 'More contributors omitted; no pagination cursor.' : 'No contributors omitted by this read limit.'} This drill has the current read cutoff shown above.</div>
        {contributors.length === 0 && <div role="status" style={{ fontSize: 12, padding: '6px 0' }}>No supported recorded-sale contributors in this bucket at this read.</div>}
        <ol style={{ paddingLeft: 20, margin: '8px 0' }}>{contributors.map(c => <li key={c.auction_event_id} style={{ marginBottom: 8, overflowWrap: 'anywhere', fontSize: 12 }}>
          <PrefetchLink to={`/vehicle/${c.vehicle_id}`}>Vehicle record</PrefetchLink>{' · '}
          <a href={c.source_url} target="_blank" rel="noopener noreferrer">BaT listing ↗</a>
          <div style={{ fontSize: 11 }}>Recorded listing end <time dateTime={c.event_at}>{utc(c.event_at)}</time>.
            {' '}{c.source_read_basis === 'direct_fetch' || c.source_read_basis === 'cached_snapshot'
              ? c.source_observed_at ? <>Source {c.source_read_basis === 'direct_fetch' ? 'direct read' : 'cached snapshot'} <time dateTime={c.source_observed_at}>{utc(c.source_observed_at)}</time>.</> : 'Source read time unknown.'
              : 'Source read time unknown.'}
          </div>
        </li>)}</ol>
      </div>}
      <details style={{ fontSize: 11, marginTop: 8 }}>
        <summary>Method, eligibility and clocks</summary>
        <p>Public, undeleted vehicle parents only. One slash-normalized BaT listing episode per count, using its recorded end time and an explicit sold outcome with supported positive amount. The denominator also contains captured non-sale, bid-to, pending and unresolved-outcome episodes assigned to this series. It is not all market inventory or an ownership-transfer count.</p>
        <p>{receipt.scope.comparison_basis}. {receipt.scope.comparison_scope_basis}</p>
        <p>Source reads are qualified as direct, cached or unknown. Query time and row writes are not source freshness. A future recorded result may change an ended-pending count. Full UTC days are full time buckets, not complete source capture. Condition and factory generation are unverified.</p>
      </details>
    </>}
  </section>;
}
