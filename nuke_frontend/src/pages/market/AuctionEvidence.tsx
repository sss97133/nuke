import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Text } from '../../kit';
import { PrefetchLink as Link } from '../../components/PrefetchLink';
import { listingDescriptionsFromSpecs } from '../../components/vehicle/listingDescriptions';
import { EPISODE_READ_LIMIT, useAuctionEpisode, type EpisodeInteraction } from '../../hooks/useAuctionComments';
import { useLotMovement } from './useLotMovement';
import { selectRowFacts, vehicleIdentity, type LotInspection, type MarketRowDetails } from './useMarketRowDetails';
import { bidBookReading, useBidBook } from '../stacks/orderBookReader';
import { useFinishAnalogs } from './useFinishEstimates';
import './AuctionEvidence.css';

function stamp(value: string | null | undefined) {
  const at = Date.parse(value ?? '');
  return Number.isFinite(at) ? new Date(at).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Los_Angeles', timeZoneName: 'short',
  }) : 'Time unknown';
}
function short(value: string | null | undefined) {
  const at = Date.parse(value ?? '');
  return Number.isFinite(at) ? new Date(at).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles',
  }) : 'time unknown';
}
function ago(at: number, now = Date.now()) {
  const m = Math.max(0, Math.floor((now - at) / 60_000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`;
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
function amount(n: number) { return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 }); }
// Axis ends: short enough to fit the chart's margin on a phone ($467K, $1.2M).
function axis(n: number) { return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `$${Math.round(n / 1_000)}K` : amount(n); }
function closeStamp(value: string) {
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toLocaleString('en-US', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: 'America/Los_Angeles', timeZoneName: 'short',
  }) : 'Time unknown';
}

/** A row's bid and its pace: how long since the last bid, and how much it raised. The bid number is the board's
 *  (the fallback), so the row agrees with the board's total; the pace comes from Stack A's exact-episode fold. */
export function AuctionCompetition({ vehicleId, sourceUrl, row = true, enabled = true, fallback, bid }: {
  vehicleId: string; sourceUrl?: string | null; row?: boolean; enabled?: boolean; fallback?: ReactNode;
  /** The board's bid. The pace is said only when the bid rows have caught up to it; rows trail by hours. */
  bid?: number | null;
}) {
  const query = useBidBook(vehicleId, sourceUrl, enabled);
  const reading = useMemo(() => query.data ? bidBookReading(query.data) : null, [query.data]);
  const latest = reading?.states.length ? reading.states[reading.states.length - 1] : null;
  const inStep = bid == null || (reading?.high != null && Math.abs(reading.high - bid) < 1);
  const last = inStep ? latest : null;
  const pace = last ? <Text role="caption" className="market-lot-last-bid">
    <time dateTime={new Date(last.bid.at).toISOString()} title={stamp(new Date(last.bid.at).toISOString())}>bid {ago(last.bid.at)}</time>
    {reading?.lastRaise != null && <> · +{reading.lastRaise.toFixed(1)}%</>}
  </Text> : null;
  return row ? <>{fallback}{pace}</> : <>{pace}</>;
}

// Draw only the reader's posted bids at their actual time offsets. No peer ranking, interpolation,
// inferred opening time, rate, price forecast or green/red performance classification.
type BidPoint = Pick<EpisodeInteraction, 'id' | 'comment_type' | 'posted_at'> & { bid_amount: number | string | null };
function BidPath({ rows, selected, onSelect }: {
  rows: BidPoint[]; selected: string | null; onSelect: (id: string) => void;
}) {
  const points = rows.filter(r => r.comment_type === 'bid' && r.bid_amount != null
    && Number.isFinite(Number(r.bid_amount)) && Number(r.bid_amount) >= 0 && Number.isFinite(Date.parse(r.posted_at ?? '')))
    .sort((a, b) => Date.parse(a.posted_at!) - Date.parse(b.posted_at!) || a.id.localeCompare(b.id));
  if (!points.length) return <p className="auction-evidence-note">No dated bids in this retained window.</p>;
  const lo = Math.min(...points.map(r => Number(r.bid_amount)));
  const hi = Math.max(...points.map(r => Number(r.bid_amount)));
  const from = Date.parse(points[0].posted_at!), to = Date.parse(points[points.length - 1].posted_at!);
  const x = (r: BidPoint) => 76 + (to === from ? .5 : (Date.parse(r.posted_at!) - from) / (to - from)) * 614;
  const y = (r: BidPoint) => 176 - (hi === lo ? .5 : (Number(r.bid_amount) - lo) / (hi - lo)) * 138;
  return <>
    <div className="auction-evidence-chart-heading"><h4>Bids</h4><span>{points.length} · Pacific time</span></div>
    <svg className="auction-evidence-chart" viewBox="0 0 720 190" role="group" aria-label="Recorded bid amounts over posted time, in US dollars">
      <line x1="76" x2="690" y1="176" y2="176" className="auction-evidence-grid" />
      <line x1="76" x2="690" y1="38" y2="38" className="auction-evidence-grid" />
      <text x="66" y="42" textAnchor="end">{axis(hi)}</text>
      {hi !== lo && <text x="66" y="180" textAnchor="end">{axis(lo)}</text>}
      {points.map((r, i) => i > 0 && <path key={`line-${r.id}`} d={`M ${x(points[i - 1])} ${y(points[i - 1])} H ${x(r)} V ${y(r)}`} className="auction-evidence-path" />)}
      {points.map((r, i) => <g key={r.id} role="button" tabIndex={selected === r.id || (selected == null && i === points.length - 1) ? 0 : -1}
        aria-label={`Bid ${amount(Number(r.bid_amount))}, ${short(r.posted_at)}. Inspect source event`}
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
        <title>{amount(Number(r.bid_amount))} · {short(r.posted_at)}</title>
      </g>)}
    </svg>
    <div className="auction-evidence-chart-dates"><time dateTime={points[0].posted_at!}>{short(points[0].posted_at)}</time><time dateTime={points[points.length - 1].posted_at!}>{short(points[points.length - 1].posted_at)}</time></div>
  </>;
}

function money(n: number | null) {
  if (n == null) return '—';
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n).toLocaleString('en-US')}`;
}
function day(value: string | null) {
  const t = Date.parse(value ?? '');
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null;
}
// Where it should finish, said once, at the top of the drawer: the estimate, its 80% range, how often that range has
// held for lots like this, and the past lots it rests on with their bid at this point and their finish.
function FinishBlock({ vehicleId }: { vehicleId: string }) {
  const q = useFinishAnalogs(vehicleId);
  const e = q.data?.board.byId.get(vehicleId);
  if (!e) return null;
  const analogs = q.data?.analogs ?? [];
  return <section className="market-finish" aria-label="Where it should finish">
    <Text role="label">Likely finish</Text>
    <div className="market-finish__value"><Text role="measure">{money(e.estimate)}</Text>
      <Text role="body">80% range {money(e.low)}–{money(e.high)}</Text></div>
    {e.sentence && <Text role="body" as="p">{e.sentence}</Text>}
    {analogs.length > 0 && <ol className="market-finish__analogs" aria-label="Past lots it rests on">{analogs.map((a, i) =>
      <li key={`${a.url ?? a.title}-${i}`}>
        {a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer">{a.title}</a> : <span>{a.title}</span>}
        <Text role="caption">{[day(a.closed), a.bid != null ? `bid ${money(a.bid)} at this point` : null,
          a.final != null ? `${a.outcome === 'reserve_not_met' ? 'high bid' : 'finished'} ${money(a.final)}` : null].filter(Boolean).join(' · ')}</Text>
      </li>)}</ol>}
    <Text role="caption" as="div">{[e.compsThrough ? `Comparable sales through ${day(e.compsThrough)}` : null,
      `estimated ${ago(e.estimatedAt)}${e.bidAtEstimate != null ? ` at a ${money(e.bidAtEstimate)} bid` : ''}`].filter(Boolean).join(' · ')}</Text>
  </section>;
}

export default function AuctionEvidence({ vehicleId, onClose, compact = false, summary, sourceUrl }: {
  vehicleId: string; onClose: () => void; compact?: boolean; inspection?: LotInspection; summary?: MarketRowDetails;
  onInspectionChange?: (view: LotInspection) => void; sourceUrl?: string | null;
}) {
  const query = useAuctionEpisode(vehicleId, sourceUrl);
  const book = useBidBook(vehicleId, sourceUrl ?? query.data?.sourceUrl, compact);
  const ids = useMemo(() => query.data ? [vehicleId] : [], [query.data, vehicleId]);
  const activity = useLotMovement(ids);
  const receipt = activity.coverage?.lots.find(l => l.vehicle_id === vehicleId
    && l.source_url?.replace(/\/$/, '') === query.data?.sourceUrl.replace(/\/$/, ''));
  const [selected, setSelected] = useState<string | null>(null);
  const [allDiscussion, setAllDiscussion] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    setSelected(null); setAllDiscussion(false);
    const previous = document.activeElement as HTMLElement | null;
    if (!compact) ref.current?.focus({ preventScroll: true });
    // Inline inspection focus belongs to its row owner, including effect replay.
    return () => { if (!compact && previous?.isConnected) previous.focus({ preventScroll: true }); };
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
    // One panel, each datum once. The row above already says the name, the bid, its pace and the row facts; this
    // says what it cannot: how the bidding went, what buyers are asking and the seller is saying, and the rest of
    // the car. The venue link sits where a reader looks for it.
    const rowFacts = new Set(selectRowFacts(specs, name).map(f => f.field));
    const more = ([['mileage', 'Miles'], ['color', 'Exterior'], ['interior_color', 'Interior'], ['vin', 'VIN']] as const)
      .map(([field, label]) => ({ field, label, spec: specs.find(sp => sp.field === field) }))
      .filter(({ field, spec }) => !rowFacts.has(field) && spec && (spec.reported_value ?? spec.value) != null)
      .map(({ field, label, spec }) => {
        const raw = spec!.reported_value ?? spec!.value;
        const value = field === 'mileage' && Number.isFinite(Number(raw)) ? Number(raw).toLocaleString('en-US') : String(raw);
        return { field, label, value };
      });
    // The chart draws every bid the lot's bid book holds (the row's Stack A read, shared through the query cache); the
    // episode read keeps only the newest 100 interactions, so on a busy lot it would drop the early bids.
    const pathRows: BidPoint[] = book.data?.bids?.length ? book.data.bids : rows;
    const bids = pathRows.filter(r => r.comment_type === 'bid' && r.bid_amount != null && Number.isFinite(Number(r.bid_amount))
      && Number(r.bid_amount) >= 0 && Number.isFinite(Date.parse(r.posted_at ?? '')));
    const latestBid = bids.reduce<BidPoint | null>((best, r) => !best || Date.parse(r.posted_at!) > Date.parse(best.posted_at!) ? r : best, null);
    const seller = rows.find(r => r.is_seller || r.comment_type === 'seller_response');
    const question = rows.find(r => r.comment_type === 'question');
    return <section className="market-lot-inspection" id={`lot-inspection-${vehicleId}`} ref={ref}
      aria-label={`Inspect ${name}`} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <header className="market-inspection-header">
        <span className="market-inspection-counts">
          {summary?.bidCount != null && <span><strong>{summary.bidCount.toLocaleString('en-US')}</strong> bids</span>}
          {summary?.watchers != null && <span><strong>{summary.watchers.toLocaleString('en-US')}</strong> watching</span>}
        </span>
        <nav aria-label="This lot elsewhere">
          {evidence && <a href={evidence.sourceUrl} target="_blank" rel="noopener noreferrer">Bring a Trailer ↗</a>}
          <Link to={`/vehicle/${vehicleId}`}>Vehicle record →</Link>
          <Link to={`/stacks/order-book/${vehicleId}`}>Stack A →</Link>
        </nav>
        <button type="button" onClick={onClose} aria-label="Close lot inspection">Close ×</button>
      </header>
      {query.isPending && <p role="status">Reading this auction…</p>}
      {query.isError && <p role="status">This auction could not be read. <button type="button" onClick={() => void query.refetch()}>Retry</button></p>}
      {!query.isPending && !query.isError && !evidence && <p role="status">This listing has changed or is no longer publicly available.</p>}
      {evidence && <>
        <FinishBlock vehicleId={vehicleId} />
        {bids.length > 0 ? <BidPath rows={pathRows} selected={selected ?? latestBid?.id ?? null} onSelect={setSelected} />
          : <p className="auction-evidence-note">No bids yet.</p>}
        {(question || seller) && <div className="market-inspection-talk">
          {[question, seller].filter((r): r is EpisodeInteraction => !!r).map(r => <div key={r.id}>
            <Text role="label">{r.comment_type === 'question' ? 'Latest question' : 'Seller'}</Text>{' '}
            <Text role="caption"><time dateTime={r.posted_at || undefined} title={stamp(r.posted_at)}>{Number.isFinite(Date.parse(r.posted_at ?? '')) ? ago(Date.parse(r.posted_at!)) : ''}</time></Text>
            <p>{r.comment_text?.trim() || 'Posted photos or video.'}</p>
          </div>)}
        </div>}
        {(more.length > 0 || summary?.location) && <dl className="market-inspection-facts">
          {more.map(f => <div key={f.field}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}
          {summary?.location && <div><dt>Located</dt><dd>{summary.location}</dd></div>}
        </dl>}
      </>}
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
