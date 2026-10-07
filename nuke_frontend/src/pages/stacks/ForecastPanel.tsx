import { useMemo, type ReactNode } from 'react';
import { PrefetchLink as Link } from '../../components/PrefetchLink';
import { useAuth } from '../../hooks/useAuth';
import type { OrderBookRead, OrderBookView } from './orderBookReader';
import {
  STALE_WINDOW_S, forecastGate, useForecast,
  type BandReading, type CohortReading, type CoverageReading, type ForecastReading, type ForecastRequest, type PositionReading, type Stale,
} from './forecastReader';
import { clock, count, ordinal, span, usd } from './stackFormat';

// The Forecast panel on Stack A's page: the 80% band for this lot's hammer, where the lot stands among its comparables,
// and the reader's own evidence for the lot, from the forecast route (case ledger §13.7). The reader is service_role
// only behind that route's auth, so signed out the panel shows no number and says why. Every count is shown with the
// count it is out of; a number the reader gave without one is not shown. The data is the page: no spinner, a plain
// sentence while the answer is read.

const LEVEL_WORD: Record<number, string> = { 1: 'exact make and model text', 2: 'make and model family (normalized_model)' };
const READER_MIN_N = 9;

function Frame({ state, asOf, children }: { state: string; asOf?: number | null; children: ReactNode }) {
  return (
    <section className="stack-forecast" aria-label="Forecast" data-forecast={state}>
      <div className="stack-forecast-head">
        <span className="stack-label">Forecast · this lot</span>
        {asOf != null && <span className="stack-label">As of {clock(asOf)}</span>}
      </div>
      <div className="stack-forecast-body">{children}</div>
    </section>
  );
}

const Note = ({ children, ...p }: { children: ReactNode } & Record<string, unknown>) => <p className="stack-note stack-forecast-note" {...p}>{children}</p>;

// --- The parts of a reading --------------------------------------------------------------------------------------------

function BandPart({ band, reading, request, stale }: { band: BandReading | null; reading: ForecastReading; request: ForecastRequest; stale: Stale | null }) {
  if (!band) {
    const u = reading.bandUnavailable;
    return (
      <>
        <strong>No band.</strong>{' '}
        {reading.cohort?.kind === 'miss' ? 'This lot has no cohort to read one from (see Cohort).' : u ? `${u.reason.charAt(0).toUpperCase()}${u.reason.slice(1)}.` : 'The reader gave none.'}
        {u?.n != null && <> n = {count(u.n)} of the {count(u.minN ?? READER_MIN_N)} comparables the reader needs.</>}
        <div className="stack-basis">The hammer is never below the standing bid {usd(request.bid)}; no upper end is claimed.</div>
      </>
    );
  }
  return (
    <>
      <span className="stack-ratio">{usd(band.low)} to {usd(band.high)}</span>{' '}
      <span className="stack-mono">median {usd(band.mid)}</span>
      {stale && <strong className="stack-forecast-flag"> · not current</strong>}
      <div className="stack-basis" data-forecast-part="band-basis">
        n = {count(band.n)} of {count(band.denominator)}{band.denominatorIsFloor ? '+' : ''} sold lots
        {band.rank != null && <> · the high end is rank {count(band.rank)} of {count(band.n)}{band.ratioHigh != null && <>, {band.ratioHigh}x the standing bid</>}</>}
        {band.rank != null && <> · covers {Math.round((100 * band.rank) / (band.n + 1))}% ({count(band.rank)} of {count(band.n + 1)}) if this lot behaves like its comparables</>}
      </div>
      <div className="stack-basis">The low end is the standing bid {usd(request.bid)}: the hammer is never below it.</div>
    </>
  );
}

function CohortPart({ cohort, reading }: { cohort: CohortReading | null; reading: ForecastReading }) {
  if (!cohort) return <>Unknown: the reader returned no cohort.</>;
  const name = [cohort.make, cohort.model].filter(Boolean).join(' ') || 'unnamed';
  if (cohort.kind === 'miss') {
    const d = cohort.missDenominators ?? {};
    const of = (a: number | null | undefined, b: number | null | undefined) => `${a == null ? 'unknown' : count(a)} sold of ${b == null ? 'unknown' : count(b)} closed`;
    return (
      <>
        <strong>Miss:</strong> {cohort.missReason ?? 'no reason given'}.
        <div className="stack-basis">
          Counted: {of(d.sold_with_this_text, d.closed_lots_with_this_text)} lots with this make and model text; {of(d.sold_in_the_model_family, d.closed_lots_in_the_model_family)} in the model family
          {d.vehicles_with_this_make_to_10000 != null && <>; {count(d.vehicles_with_this_make_to_10000)} vehicle{d.vehicles_with_this_make_to_10000 === 1 ? '' : 's'} with this make (counted to 10,000)</>}.
          {cohort.familyNote && <> {cohort.familyNote.charAt(0).toUpperCase() + cohort.familyNote.slice(1)}.</>} The reader needs {READER_MIN_N} sold lots.
        </div>
      </>
    );
  }
  if (cohort.kind === 'pool') {
    const pool = reading.band?.pool;
    return (
      <>
        Last hour: sold lots the live collector followed, across cohorts, in the same soft-close state.
        {pool?.inSample != null && pool.read != null && <> {count(pool.inSample)} of {count(pool.read)} followed lots read are in the sample{pool.priceTier ? `, price tier ${pool.priceTier}${pool.tierAlone ? ' alone' : ', all tiers (the tier held under 30 lots)'}` : ''}.</>}
      </>
    );
  }
  const f = cohort.funnel;
  const when = reading.secondsLeft != null ? span(reading.secondsLeft * 1000) : null;
  const family = cohort.level === 2 && cohort.family ? [cohort.make, cohort.family].filter(Boolean).join(' ') : name;
  return (
    <>
      {LEVEL_WORD[cohort.level ?? 0] ?? 'cohort'}: {family}.
      {cohort.exactText && (
        <div className="stack-basis">
          The exact make and model text, {name}, had {cohort.exactText.sold == null ? 'unknown' : count(cohort.exactText.sold)} sold of {cohort.exactText.closed == null ? 'unknown' : count(cohort.exactText.closed)} closed lots,
          under the {READER_MIN_N} sold lots the reader needs, so it read the model family.
        </div>
      )}
      <div className="stack-basis">
        {cohort.denominator != null ? <>{count(cohort.denominator)}{cohort.denominatorIsFloor ? '+' : ''} sold lots in the last 365 days</> : 'sold lots: unknown'}
        {f?.closed_lots != null && <> (of {count(f.closed_lots)} closed)</>}
        {cohort.nComparables != null && <>; {count(cohort.nComparables)} of those {cohort.denominator != null ? count(cohort.denominator) : 'unknown'} had a bid {when ? `${when} ` : ''}before their close and a bid log that reproduces their hammer</>}.
      </div>
    </>
  );
}

function PositionPart({ position, reading, request }: { position: PositionReading | null; reading: ForecastReading; request: ForecastRequest }) {
  if (!position) {
    if (reading.regime === 'minutes') return <>Not built in the last hour: the reader's comparables keep only their final close, which includes any soft-close extension.</>;
    return <>Unknown: {reading.cohort?.kind === 'miss' ? 'no cohort to stand in' : 'no comparable had a bid at this time to close'}.</>;
  }
  const p = position.price;
  const b = position.bidders;
  return (
    <>
      price {usd(p.bid)} is above {count(p.below)} of {count(p.n)} comparables, level with {count(p.same)} ({ordinal(p.percentile)} percentile)
      <br />
      {b
        ? <>bidders {count(b.bidders)} is above {count(b.below)} of {count(b.n)}, level with {count(b.same)} ({ordinal(b.percentile)} percentile)</>
        : <>bidders: not sent{request.biddersWhy ? ` (${request.biddersWhy})` : ''}, so the lot is placed on price alone</>}
      <div className="stack-basis">
        Each comparable is read {position.secondsLeft != null ? span(position.secondsLeft * 1000) : 'the same time'} before its own close, as of {reading.asOf != null ? clock(reading.asOf) : 'an unknown clock'}.
      </div>
    </>
  );
}

function CoveragePart({ coverage, reading, request }: { coverage: CoverageReading; reading: ForecastReading; request: ForecastRequest }) {
  const rows = coverage.bidRows;
  const frames = coverage.frames;
  if (!rows && !frames) return null;
  const asOf = reading.asOf != null ? clock(reading.asOf) : 'unknown';
  return (
    <table aria-label="Coverage of the reader's own evidence for this lot" data-forecast-part="coverage">
      <caption className="stack-label" style={{ textAlign: 'left', paddingBottom: 4 }}>Coverage · the reader's own evidence for this lot</caption>
      <thead><tr><th scope="col">Measure</th><th scope="col">Held / denominator</th><th scope="col">As of</th><th scope="col">Basis</th></tr></thead>
      <tbody>
        {rows && (
          <tr data-forecast-row="bid_rows">
            <td>Bid rows held</td>
            <td className="stack-ratio">{count(rows.n)} / {request.totalBids == null ? 'unknown' : count(request.totalBids)}<span className="stack-basis"> bids the lot row reports</span></td>
            <td className="stack-mono">{asOf}</td>
            <td className="stack-basis">
              auction_comments bid rows posted at or before that clock{rows.bidders != null && <>, from {count(rows.bidders)} bidders</>}.
              {rows.maxBid != null && <> The highest, {usd(rows.maxBid)}, {rows.agrees === false ? <strong>DISAGREES with</strong> : 'agrees with'} the stored high bid {usd(request.bid)}.</>}
              {rows.lastPostedAt != null && <> Last posted {clock(rows.lastPostedAt, true)}.</>}
            </td>
          </tr>
        )}
        {frames && (
          <tr data-forecast-row="frames">
            <td>Live frames, last 15 minutes</td>
            <td className="stack-ratio">{frames.minutesWithFrameOfLast15 == null ? 'unknown' : count(frames.minutesWithFrameOfLast15)} / 15<span className="stack-basis"> minutes with a frame</span></td>
            <td className="stack-mono">{asOf}</td>
            <td className="stack-basis">vehicle_observations bat_public_live_v1, observed and ingested at or before that clock; {count(frames.n)} frames in the 3 hours before it.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

// --- A reading ---------------------------------------------------------------------------------------------------------

function ReadingView({ reading, request }: { reading: ForecastReading; request: ForecastRequest }) {
  if (reading.status !== 'ok') {
    return (
      <Frame state="status" asOf={reading.asOf}>
        <Note>The reader answered {reading.status.replace(/_/g, ' ')}: {reading.reason ?? 'no reason given'}. No forecast is shown.</Note>
      </Frame>
    );
  }
  if (reading.unreadable) {
    return <Frame state="unreadable" asOf={reading.asOf}><Note>The reader's band came without the count it rests on or that count's denominator, so no number is shown.</Note></Frame>;
  }
  const stale = reading.stale;
  const state = stale ? 'stale' : reading.band ? 'band' : reading.cohort?.kind === 'miss' ? 'miss' : 'no-band';
  return (
    <Frame state={state} asOf={reading.asOf}>
      {stale && (
        <p className="stack-forecast-stale" role="note">
          <strong>Not current.</strong>{' '}
          {stale.kind === 'stale'
            ? <>The stored lot state is {span((stale.ageS ?? 0) * 1000)} old at this read, and the lot is inside its last {STALE_WINDOW_S / 60} minutes, where a bid or the close can move in seconds.</>
            : <>The age of the stored lot state is unknown, and the lot is inside its last {STALE_WINDOW_S / 60} minutes, where a bid or the close can move in seconds.</>}
          {' '}Everything below is as of {reading.asOf != null ? clock(reading.asOf) : 'an unknown clock'}.
        </p>
      )}
      <dl className="stack-forecast-grid">
        <dt>Hammer · 80% band</dt>
        <dd data-forecast-part="band"><BandPart band={reading.band} reading={reading} request={request} stale={stale} /></dd>
        <dt>Cohort</dt>
        <dd data-forecast-part="cohort"><CohortPart cohort={reading.cohort} reading={reading} /></dd>
        <dt>Position</dt>
        <dd data-forecast-part="position"><PositionPart position={reading.position} reading={reading} request={request} /></dd>
        <dt>Numbers</dt>
        <dd className="stack-basis" data-forecast-part="inputs">
          Stored high bid {usd(request.bid)}{request.totalBids != null && <> over {count(request.totalBids)} bids</>}, close {clock(Date.parse(request.endsAt))} as last read,
          as of the lot row's last write{reading.ageS != null && <>, {span(reading.ageS * 1000)} before this read</>}. Amounts are as stored, with no currency conversion.
        </dd>
        <dt>Limits</dt>
        <dd className="stack-basis">
          The band is for {reading.band?.appliesTo ?? 'the hammer of a lot that sells; a lot that ends under its reserve has no hammer to bracket'}. Nothing is fitted: its coverage is the order-statistic rule's, not a measured hit rate.
        </dd>
      </dl>
      <CoveragePart coverage={reading.coverage} reading={reading} request={request} />
    </Frame>
  );
}

function AskedForecast({ request, token }: { request: ForecastRequest; token: string }) {
  const q = useForecast(request, token);
  if (q.isPending) return <Frame state="reading"><Note role="status">Reading the forecast.</Note></Frame>;
  const again = <> <button type="button" onClick={() => void q.refetch()}>Read again</button></>;
  if (q.isError || !q.data) return <Frame state="unavailable"><Note role="status">The forecast could not be read. No forecast is shown.{again}</Note></Frame>;
  const r = q.data;
  switch (r.kind) {
    case 'ok': return <ReadingView reading={r.reading} request={request} />;
    case 'refused':
      return <Frame state="refused"><Note role="status">The forecast route refused this session (HTTP {r.status}: {r.message}). Sign in again. No forecast is shown. <Link to="/login">Sign in</Link></Note></Frame>;
    case 'rate_limited':
      return <Frame state="rate-limited"><Note role="status">The forecast route is rate limiting this account{r.retryAfterS != null ? `; try again in ${span(r.retryAfterS * 1000)}` : ''}. No forecast is shown.{again}</Note></Frame>;
    case 'not_found':
      return <Frame state="not-found"><Note role="status">The forecast route holds no Bring a Trailer lot with this id ({r.message}). No forecast is shown.</Note></Frame>;
    case 'unreadable':
      return <Frame state="unreadable"><Note role="status">The forecast came back in a shape this page does not read ({r.message}), so no number is shown.</Note></Frame>;
    default:
      return <Frame state="unavailable"><Note role="status">The forecast could not be read ({r.message}). No forecast is shown.{again}</Note></Frame>;
  }
}

// --- The panel ---------------------------------------------------------------------------------------------------------

export function ForecastPanel({ read, view }: { read: OrderBookRead; view: OrderBookView }) {
  const { session } = useAuth();
  const token: string | null = typeof session?.access_token === 'string' && session.access_token ? session.access_token : null;
  const lot = read.lot!;
  const gate = useMemo(() => forecastGate(lot, view), [lot, view]);

  switch (gate.kind) {
    case 'no_close':
      return <Frame state="no-close"><Note>This lot has no close time recorded, so its time to close is unknown and no forecast is made.</Note></Frame>;
    case 'closed':
      return (
        <Frame state="closed">
          <Note>
            This lot closed {clock(gate.closeAt)}. The forecast grades a standing bid on a live lot against comparable lots at the same time to close,
            so none is made for a closed lot. Its result is in the Outcome layer.
          </Note>
        </Frame>
      );
    case 'no_bid':
      return <Frame state="no-bid"><Note>No bid is recorded for this lot. The forecast grades a standing bid against comparable lots, so it starts at the first bid.</Note></Frame>;
    case 'no_state':
      return <Frame state="no-state"><Note>The lot row has no write time, so the clock its numbers are as of is unknown. No forecast is made.</Note></Frame>;
    default:
      break;
  }
  if (!token) {
    return (
      <Frame state="signed-out">
        <Note>
          Signed out, so no forecast is shown. The reader is service_role only and answers through a route that needs a signed-in account or an API key.{' '}
          <Link to="/login">Sign in</Link>
        </Note>
      </Frame>
    );
  }
  return <AskedForecast request={gate.request} token={token} />;
}
