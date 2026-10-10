import { useEffect, useMemo, useRef, useState } from 'react';
import { PrefetchLink as Link } from '../../components/PrefetchLink';
import { listingDescriptionsFromSpecs } from '../../components/vehicle/listingDescriptions';
import { EPISODE_READ_LIMIT, useAuctionEpisode, type EpisodeInteraction } from '../../hooks/useAuctionComments';
import { useLotMovement } from './useLotMovement';
import { selectRowFacts, vehicleIdentity, type LotInspection, type MarketRowDetails } from './useMarketRowDetails';
import './AuctionEvidence.css';

function stamp(value: string | null | undefined) {
  const at = Date.parse(value ?? '');
  return Number.isFinite(at) ? new Date(at).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Los_Angeles', timeZoneName: 'short',
  }) : 'Time unknown';
}
function safeUrl(value: string | null | undefined) {
  try { const url = new URL(value ?? ''); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
function hasSourceAnchor(row: EpisodeInteraction) {
  return row.bat_comment_id != null && Number.isSafeInteger(row.bat_comment_id) && row.bat_comment_id > 0;
}
function sourceLink(row: EpisodeInteraction, url: string) {
  return hasSourceAnchor(row)
    ? `${url}#comment-${row.bat_comment_id}` : url;
}
function kind(row: EpisodeInteraction) {
  return row.comment_type === 'bid' ? 'Bid' : row.is_seller || row.comment_type === 'seller_response'
    ? 'Seller statement' : row.comment_type === 'question' ? 'Question' : 'Comment';
}
function amount(n: number) { return n.toLocaleString('en-US', { maximumFractionDigits: 2 }); }
function closeStamp(value: string) {
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toLocaleString('en-US', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: 'America/Los_Angeles', timeZoneName: 'short',
  }) : 'Time unknown';
}

// Draw only the reader's posted bids at their actual time offsets. No peer ranking, interpolation,
// inferred opening time, rate, price forecast or green/red performance classification.
function BidPath({ rows, selected, onSelect }: {
  rows: EpisodeInteraction[]; selected: string | null; onSelect: (id: string) => void;
}) {
  const points = rows.filter(r => r.comment_type === 'bid' && r.bid_amount != null
    && Number.isFinite(Number(r.bid_amount)) && Number(r.bid_amount) >= 0 && Number.isFinite(Date.parse(r.posted_at ?? '')))
    .sort((a, b) => Date.parse(a.posted_at!) - Date.parse(b.posted_at!) || a.id.localeCompare(b.id));
  if (!points.length) return <p className="auction-evidence-note">No dated bids in this retained window.</p>;
  const lo = Math.min(...points.map(r => Number(r.bid_amount)));
  const hi = Math.max(...points.map(r => Number(r.bid_amount)));
  const from = Date.parse(points[0].posted_at!), to = Date.parse(points[points.length - 1].posted_at!);
  const x = (r: EpisodeInteraction) => 76 + (to === from ? .5 : (Date.parse(r.posted_at!) - from) / (to - from)) * 614;
  const y = (r: EpisodeInteraction) => 176 - (hi === lo ? .5 : (Number(r.bid_amount) - lo) / (hi - lo)) * 138;
  return <>
    <div className="auction-evidence-chart-heading"><h4>Recorded bid path</h4><span>{points.length} dated bids in this read</span></div>
    <svg className="auction-evidence-chart" viewBox="0 0 720 190" role="group" aria-label="Recorded bid amounts over posted time, currency unverified">
      <line x1="76" x2="690" y1="176" y2="176" className="auction-evidence-grid" />
      <line x1="76" x2="690" y1="38" y2="38" className="auction-evidence-grid" />
      <text x="66" y="42" textAnchor="end">{amount(hi)}</text>
      {hi !== lo && <text x="66" y="180" textAnchor="end">{amount(lo)}</text>}
      {points.map((r, i) => i > 0 && <path key={`line-${r.id}`} d={`M ${x(points[i - 1])} ${y(points[i - 1])} H ${x(r)} V ${y(r)}`} className="auction-evidence-path" />)}
      {points.map((r, i) => <g key={r.id} role="button" tabIndex={selected === r.id || (selected == null && i === points.length - 1) ? 0 : -1}
        aria-label={`Bid ${amount(Number(r.bid_amount))}, ${stamp(r.posted_at)}. Inspect source event`}
        aria-pressed={selected === r.id} onClick={() => onSelect(r.id)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(r.id); }
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const next = e.key === 'ArrowRight' ? Math.min(i + 1, points.length - 1) : Math.max(i - 1, 0);
            (e.currentTarget.parentElement?.querySelectorAll<SVGGElement>('[role="button"]')[next])?.focus();
            onSelect(points[next].id);
          }
        }}>
        <circle cx={x(r)} cy={y(r)} r="12" fill="transparent" />
        <circle cx={x(r)} cy={y(r)} r={selected === r.id ? 5 : 3} className="auction-evidence-point" />
        <title>{amount(Number(r.bid_amount))} · {stamp(r.posted_at)}</title>
      </g>)}
    </svg>
    <div className="auction-evidence-chart-dates"><time dateTime={points[0].posted_at!}>{stamp(points[0].posted_at)}</time><time dateTime={points[points.length - 1].posted_at!}>{stamp(points[points.length - 1].posted_at)}</time></div>
    <p className="auction-evidence-note">Venue time · America/Los_Angeles. Recorded bid numbers; currency unverified. Dashed steps connect retained bids, with missing events possible. This is the observed path, not a forecast or peer comparison.</p>
    <details className="auction-evidence-bid-table"><summary>Read bid events as a table</summary>
      <table><thead><tr><th scope="col">Posted time · PT</th><th scope="col">Recorded number</th></tr></thead>
        <tbody>{points.map(r => <tr key={r.id}><td><time dateTime={r.posted_at!}>{stamp(r.posted_at)}</time></td>
          <td><button onClick={() => onSelect(r.id)} aria-pressed={selected === r.id}
            aria-label={`Inspect recorded bid ${amount(Number(r.bid_amount))} at ${stamp(r.posted_at)}`}>{amount(Number(r.bid_amount))} →</button></td></tr>)}</tbody>
      </table>
    </details>
  </>;
}

export default function AuctionEvidence({ vehicleId, onClose, compact = false, inspection = 'auction', summary, onInspectionChange, sourceUrl }: {
  vehicleId: string; onClose: () => void; compact?: boolean; inspection?: LotInspection; summary?: MarketRowDetails;
  onInspectionChange?: (view: LotInspection) => void; sourceUrl?: string | null;
}) {
  const query = useAuctionEpisode(vehicleId, sourceUrl);
  const ids = useMemo(() => query.data ? [vehicleId] : [], [query.data, vehicleId]);
  const activity = useLotMovement(ids);
  const receipt = activity.coverage?.lots.find(l => l.vehicle_id === vehicleId
    && l.source_url?.replace(/\/$/, '') === query.data?.sourceUrl.replace(/\/$/, ''));
  const [selected, setSelected] = useState<string | null>(null);
  const [allDiscussion, setAllDiscussion] = useState(false);
  const [view, setView] = useState<LotInspection>(inspection);
  useEffect(() => setView(inspection), [inspection]);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    setSelected(null); setAllDiscussion(false);
    const previous = document.activeElement as HTMLElement | null;
    if (!compact) ref.current?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [vehicleId, compact]);
  const evidence = query.data;
  const rows = evidence?.interactions ?? [];
  const event = rows.find(r => r.id === selected) ?? rows.find(r => r.comment_type === 'bid'
    && r.bid_amount != null && Number.isFinite(Number(r.bid_amount)) && Number(r.bid_amount) >= 0
    && Number.isFinite(Date.parse(r.posted_at ?? '')));
  const discussion = rows.filter(r => r.comment_type !== 'bid' && (allDiscussion || r.comment_type === 'question'
    || r.is_seller || r.comment_type === 'seller_response')).slice().reverse();
  const descriptions = listingDescriptionsFromSpecs(evidence?.specs);
  const description = evidence?.specs.find(s => s.field === 'description');
  const native = descriptions.find(d => d.source_url.replace(/\/$/, '') === evidence?.sourceUrl.replace(/\/$/, ''));
  const specs = evidence?.specs.filter(s => s.field !== 'description' && (s.value != null || s.reported_value != null)) ?? [];
  const name = evidence ? vehicleIdentity(evidence.vehicle) : 'Auction';
  if (compact) {
    const facts = selectRowFacts(specs, name);
    const bids = rows.filter(r => r.comment_type === 'bid' && r.bid_amount != null && Number.isFinite(Number(r.bid_amount))
      && Number(r.bid_amount) >= 0 && Number.isFinite(Date.parse(r.posted_at ?? '')))
      .sort((a, b) => Date.parse(b.posted_at!) - Date.parse(a.posted_at!) || a.id.localeCompare(b.id));
    const recent = bids.slice(0, 3);
    const change = bids.length > 1 ? Number(bids[0].bid_amount) - Number(bids[1].bid_amount) : null;
    const seller = rows.find(r => r.is_seller || r.comment_type === 'seller_response');
    const question = rows.find(r => r.comment_type === 'question');
    return <section className="market-lot-inspection" id={`lot-inspection-${vehicleId}`} ref={ref}
      aria-label={`Inspect ${name}`} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <header className="market-inspection-header">
        <nav aria-label="Inspect this lot">{(['auction', 'vehicle', 'sources'] as const).map(v =>
          <button type="button" key={v} aria-pressed={view === v} onClick={() => { setView(v); onInspectionChange?.(v); }}>{v === 'auction' ? 'Auction' : v === 'vehicle' ? 'Vehicle' : 'Sources'}</button>)}</nav>
        <button type="button" onClick={onClose} aria-label="Close lot inspection">Close ×</button>
      </header>
      {query.isPending && <p role="status">Reading this auction…</p>}
      {query.isError && <p role="status">This auction could not be read. <button type="button" onClick={() => void query.refetch()}>Retry</button></p>}
      {!query.isPending && !query.isError && !evidence && <p role="status">This listing has changed or is no longer publicly available.</p>}
      {evidence && view === 'auction' && <>
        <div className="market-inspection-reading">
          {recent.length ? <p><strong>Latest recorded bid {amount(Number(recent[0].bid_amount))}</strong>
            {change != null && <> · {change >= 0 ? '+' : ''}{amount(change)} from the previous retained bid</>}
            <span className="market-inspection-caption">Posted <time dateTime={recent[0].posted_at!}>{stamp(recent[0].posted_at)}</time> · currency unverified</span></p>
            : <p>No dated bid records are available for this listing.</p>}
          {(summary?.bidCount != null || summary?.watchers != null) && <p className="market-inspection-counts">
            {summary.bidCount != null && <span><strong>{summary.bidCount.toLocaleString('en-US')}</strong> bids recorded</span>}
            {summary.watchers != null && <span><strong>{summary.watchers.toLocaleString('en-US')}</strong> watching</span>}
            <span className="market-inspection-caption">Listing counts; latest record write {stamp(summary.recordedAt)}. Source freshness is separate.</span>
          </p>}
        </div>
        {recent.length > 1 && <div className="market-inspection-bids" aria-label="Recent retained bids">
          {recent.slice().reverse().map(r => <div key={r.id}><strong>{amount(Number(r.bid_amount))}</strong>
            <time dateTime={r.posted_at!}>{new Date(r.posted_at!).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</time></div>)}
        </div>}
        <p className="market-inspection-caption">{receipt?.source_read_at && receipt.source_read_basis !== 'unknown'
          ? <>Source {receipt.source_read_basis === 'cached_snapshot' ? 'snapshot' : 'read'}: <time dateTime={receipt.source_read_at}>{stamp(receipt.source_read_at)}</time>.</>
          : 'Source read time unavailable.'} {evidence.truncated ? 'Earlier records are outside this read.' : 'Capture completeness is unknown.'}</p>
        {(question || seller) && <details className="market-inspection-more"><summary>Latest question & seller update</summary>
          {[question, seller].filter((r): r is EpisodeInteraction => !!r).map(r => <div key={r.id}>
            <strong>{kind(r)}</strong><p>{r.comment_text?.trim() || 'Media statement; text not recorded.'}</p>
            <time dateTime={r.posted_at || undefined}>{stamp(r.posted_at)}</time></div>)}
          <p className="market-inspection-caption">Separate source statements; a reply relationship is not established.</p>
        </details>}
        {bids.length > 0 && <details className="market-inspection-more"><summary>Inspect the recorded bid sequence</summary>
          <BidPath rows={rows} selected={event?.id ?? null} onSelect={setSelected} />
          {event && <p className="market-inspection-caption">Selected: {amount(Number(event.bid_amount))} · {stamp(event.posted_at)}</p>}
        </details>}
      </>}
      {evidence && view === 'vehicle' && <>
        <strong>{name}</strong>
        {summary?.location && <p>Listing location: {summary.location}</p>}
        {facts.length ? <dl className="market-inspection-facts">{facts.map(f => <div key={f.field}>
          <dt>{f.label}</dt><dd><strong>{f.value}</strong>
            {f.conflict && <span className="market-inspection-caption">Reports differ; compare the supporting evidence.</span>}
            {f.observationId && <Link to={`/vehicle/${vehicleId}/observation/${f.observationId}`}>Evidence →</Link>}</dd>
        </div>)}</dl> : <p>No attributed distinguishing specifications are available in this read.</p>}
        {facts.length > 0 && <details className="market-inspection-more"><summary>Why these facts?</summary>
          <p>Disagreements come first, then powertrain, body and appearance. Facts already in the identity are omitted.
            These are attributed vehicle reports; rarity and current installed configuration have not been established.</p>
        </details>}
        <Link to={`/vehicle/${vehicleId}`}>Explore the vehicle record →</Link>
      </>}
      {evidence && view === 'sources' && <div className="market-inspection-sources">
        <p><strong>Bring a Trailer</strong>{evidence.vehicle.title && <span className="market-inspection-caption">Published headline: {evidence.vehicle.title}</span>}</p>
        <a href={evidence.sourceUrl} target="_blank" rel="noopener noreferrer">Open original listing ↗</a>
        <p>{rows.length} retained interactions in this read{evidence.truncated ? '; earlier records omitted' : '; capture completeness unknown'}.</p>
        <p>Source read: {receipt?.source_read_at && receipt.source_read_basis !== 'unknown' ? stamp(receipt.source_read_at) : 'unavailable'}.
          Browser read: {stamp(evidence.fetchedAt)}.</p>
        {summary?.location && <p>Listing location: {summary.location} · {summary.locationSource}.</p>}
        <p>Amounts retain their source numbers; currency is unverified. Record-write time does not establish source freshness.</p>
      </div>}
    </section>;
  }
  return <section className="auction-evidence" ref={ref} tabIndex={-1} aria-label="Listing activity evidence"
    onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
    <header className="auction-evidence-header">
      <div><div className="auction-evidence-eyebrow">Bring a Trailer / one recorded listing</div><h3>{name}</h3></div>
      <button onClick={onClose} className="auction-evidence-close" aria-label="Close listing evidence">×</button>
    </header>
    {query.isPending && <p role="status">Reading listing evidence…</p>}
    {query.isError && <p role="status">Listing evidence could not be read. <button onClick={() => void query.refetch()}>Retry evidence</button></p>}
    {!query.isPending && !query.isError && !evidence && <p role="status">No publicly readable BaT vehicle listing. No discussion was requested.</p>}
    {evidence && <>
      <div className="auction-evidence-links"><Link to={`/vehicle/${vehicleId}`}>Vehicle record →</Link>
        <a href={evidence.sourceUrl} target="_blank" rel="noopener noreferrer">Original BaT listing ↗</a>
        {evidence.vehicle.year && evidence.vehicle.make && evidence.vehicle.model && <Link to={`/valuation?${new URLSearchParams({
          year: String(evidence.vehicle.year), make: evidence.vehicle.make, model: evidence.vehicle.model, vehicle_id: vehicleId,
        })}`}>Recorded sale context →</Link>}
        {evidence.vehicle.auction_end_date && <span>Stored scheduled close: {closeStamp(evidence.vehicle.auction_end_date)}</span>}
      </div>
      {query.isError && <p role="status">Refresh failed. The retained read below may be out of date.</p>}
      <div className="auction-evidence-layout">
        <div className="auction-evidence-build">
          <h4>Vehicle stored fields</h4>
          <p className="auction-evidence-note">Canonical values from the vehicle record. Reported evidence can disagree; these are not confirmed build specifications.</p>
          {specs.length > 0 && <dl>{specs.map(s => <div key={s.field}><dt>{s.label || s.field.replaceAll('_', ' ')}</dt>
            <dd>{s.value != null ? String(s.value) : 'Canonical unknown'}
              {s.reported_value != null && <span className="auction-evidence-note">Reported: {String(s.reported_value)}</span>}
              {s.field === 'mileage' && <span className="auction-evidence-note">Stored number; unit and odometer/total-distance basis unresolved in this field.</span>}
              {s.reported_conflict && <span className="auction-evidence-conflict">Conflicting reports</span>}
              {s.source_observation_id && <Link to={`/vehicle/${vehicleId}/observation/${s.source_observation_id}`} className="auction-evidence-spec-source">Reported evidence →</Link>}
            </dd></div>)}</dl>}
          {(native || description?.value) ? <>
            {description?.value && <>
              <div className="auction-evidence-eyebrow">Stored summary</div>
              <p className="auction-evidence-prose">{String(description.value)}</p>
            </>}
            {native && <details className="auction-evidence-native">
              <summary>Full preserved listing text · {native.text.length.toLocaleString('en-US')} characters</summary>
              <p className="auction-evidence-prose">{native.text}</p>
              <Link to={`/vehicle/${vehicleId}/observation/${native.source_observation_id}`}>Text observation →</Link>
              <p className="auction-evidence-note">Recorded: {stamp(native.recorded_observed_at)}. Captured: {stamp(native.source_captured_at)}. Received: {stamp(native.ingested_at)}. Original event date and source completeness unknown.</p>
            </details>}
            <p className="auction-evidence-note">Source claims remain separate from confirmed build specifications. {native ? 'Expand the preserved text for the retained build description.' : 'Full source text is unavailable in this read.'}</p>
          </> : <p className="auction-evidence-note">No retained build description in this read.</p>}
        </div>
        <div className="auction-evidence-analysis">
          <BidPath rows={rows} selected={event?.id ?? null} onSelect={setSelected} />
          {event && <div className="auction-evidence-event" aria-live="polite">
            <strong>{selected == null ? 'Latest retained bid' : kind(event)}{event.bid_amount != null ? ` · ${amount(Number(event.bid_amount))}` : ''}</strong>
            <time dateTime={event.posted_at || undefined}>{stamp(event.posted_at)}</time>
            <a href={sourceLink(event, evidence.sourceUrl)} target="_blank" rel="noopener noreferrer">{hasSourceAnchor(event) ? 'This source event ↗' : 'Source listing · event anchor unavailable ↗'}</a>
          </div>}
          <div className="auction-evidence-receipt">
            <span>{rows.length} retained interactions in this read · limit {EPISODE_READ_LIMIT}.
              {evidence.truncated ? ' Earlier interactions omitted by the limit.' : ' Capture completeness unknown.'}</span>
            <span>Browser read: <time dateTime={evidence.fetchedAt}>{stamp(evidence.fetchedAt)}</time>.</span>
            {receipt?.source_read_at && receipt.source_read_basis !== 'unknown'
              ? <span>Latest supported listing-page read: <time dateTime={receipt.source_read_at}>{stamp(receipt.source_read_at)}</time> · {receipt.source_read_basis === 'direct_fetch' ? 'direct fetch' : 'cached snapshot'}. Discussion rows have their own posted times.</span>
              : <span>Listing-page read time unavailable in this view.</span>}
            {receipt?.source_bid_amount != null && <span>Source bid number {amount(receipt.source_bid_amount)} · vehicle number at activity read {receipt.current_bid_at_capture == null ? 'unknown' : amount(receipt.current_bid_at_capture)}.
              {' '}{receipt.source_bid_match === 'matched' ? 'Numeric agreement at capture.' : receipt.source_bid_match === 'mismatched' ? 'Numeric disagreement at capture.' : 'Agreement unknown.'} Currency unverified.</span>}
          </div>
          <div className="auction-evidence-discussion-heading"><h4>{allDiscussion ? 'Retained discussion' : 'Questions & seller statements'}</h4>
            <button onClick={() => setAllDiscussion(!allDiscussion)} aria-pressed={allDiscussion}>{allDiscussion ? 'Questions & seller statements' : 'All discussion'}</button></div>
          <p className="auction-evidence-note">Chronological source statements. Reply targets and component classifications are not established by this read; adjacent statements are not automatically an answer pair. No measured commentary score yet.</p>
          {discussion.length === 0 && <p className="auction-evidence-note">No {allDiscussion ? 'discussion' : 'questions or seller statements'} in this retained window.</p>}
          <div className="auction-evidence-discussion">{discussion.map(row => <article key={row.id}><details>
            <summary><span className="auction-evidence-comment-header"><span>{kind(row)}</span><time dateTime={row.posted_at || undefined}>{stamp(row.posted_at)}</time></span>
              <span className="auction-evidence-preview">{row.comment_text?.trim() ? row.comment_text.trim().slice(0, 140) + (row.comment_text.trim().length > 140 ? '…' : '')
                : row.media_urls?.some(url => safeUrl(url)) ? 'Source media attached' : 'Text and media not retained'}</span></summary>
            <a href={sourceLink(row, evidence.sourceUrl)} target="_blank" rel="noopener noreferrer">{hasSourceAnchor(row) ? 'Source ↗' : 'Source listing · anchor unavailable ↗'}</a>
            {row.comment_text?.trim() && <p>{row.comment_text}</p>}
            {row.media_urls?.filter(url => safeUrl(url)).map((url, i) => <a key={`${url}-${i}`} className="auction-evidence-media" href={safeUrl(url)!} target="_blank" rel="noopener noreferrer">Source media {i + 1} ↗</a>)}
            {!row.comment_text?.trim() && !row.media_urls?.some(url => safeUrl(url)) && <p className="auction-evidence-note">Text and media not retained.</p>}
          </details></article>)}</div>
        </div>
      </div>
    </>}
  </section>;
}
