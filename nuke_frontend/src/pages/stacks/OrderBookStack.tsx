import { useMemo, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { PrefetchLink as Link } from '../../components/PrefetchLink';
import { LiveLotStripsView } from '../market/LiveLotStrips';
import { useLiveLotTemperature } from '../market/useLiveLotTemperature';
import { ORDER_BOOK_STACK, type LayerId, type StackLayer } from './stackDefinitions';
import {
  LOT_WINDOW_DAYS, UUID_RE, shapeOrderBook, useOrderBook,
  type OrderBookRead, type OrderBookView,
} from './orderBookReader';
import { CoverageTable, LayerPath } from './stackParts';
import { ForecastPanel } from './ForecastPanel';
import VehicleCohort from './VehicleCohort';
import CommentMeasurements from './CommentMeasurements';
import { bidDecimal, bidRequestFromParams, selectBidParams, useBidPath, type BidPathReceipt } from './bidPathReader';
import EpisodeInputControls, { resetEpisodeInputs } from './EpisodeInputControls';
import { BidEntryTable, BidKnowledge, BidPathFold, BidPathLog } from './BidPathView';
import { stackBackParams } from './bidExpression';
import { STATE_WORD, clock, count, layerReadings, outcomeWord, span, sourceAmount } from './stackFormat';
import './stacks.css';

// Stack A on one lot: /stacks/order-book/:vehicleId[?lot=<auction_event_id>&layer=<layer>&at=<bid row id>].
// Coverage first, then the nine layers as a path; each layer opens in place and the URL keeps the drill.

const STACK = ORDER_BOOK_STACK;
const LAYER_IDS = STACK.layers.map((l) => l.id);
const trimUrl = (u: string | null | undefined) => (u ?? '').replace(/\/+$/, '');

function lotName(read: OrderBookRead): string {
  const v = read.vehicle;
  return [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle';
}

function sourceAnchor(lotUrl: string, batCommentId: number | null): string {
  return batCommentId != null && Number.isSafeInteger(batCommentId) && batCommentId > 0
    ? `${trimUrl(lotUrl)}/#comment-${batCommentId}` : `${trimUrl(lotUrl)}/`;
}

function LayerHead({ layer, index, children }: { layer: StackLayer; index: number; children?: ReactNode }) {
  return (
    <>
      <div className="stack-layer-head">
        <h2>{index + 1} · {layer.name}</h2>
        <span className="stack-label">{STATE_WORD[layer.state]}</span>
      </div>
      <dl className="stack-layer-def">
        <dt>Holds</dt><dd>{layer.holds}</dd>
        <dt>Reader</dt><dd>{layer.reader ?? 'none'}</dd>
      </dl>
      {children}
    </>
  );
}

// --- Log -----------------------------------------------------------------------------------------------------------

function LiveFrames({ view }: { view: OrderBookView }) {
  const f = view.frames;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="stack-label">Live frames</div>
      {f.frames === 0 ? (
        <p className="stack-note">
          None held for this lot. The public live collector has run since Oct 4, 2026 and subscribes from 15 minutes before
          the scheduled close until the result, so a lot gets frames only in a closing window after that date.
        </p>
      ) : (
        <>
          <p className="stack-note">
            {count(f.frames)} frames held, received {f.firstReceivedAt == null ? 'at unknown times' : `${clock(f.firstReceivedAt, true)} to ${clock(f.lastReceivedAt!, true)}`};
            {' '}{count(f.minutesWithFrame)} of {view.window.minutesLive == null ? 'an unknown number of' : count(view.window.minutesLive)} live minutes have one.
            Bid and comment frames carry BaT's own posted time; the others carry only the collector's receipt time.
          </p>
          <table className="stack-table" style={{ maxWidth: 420 }}>
            <thead><tr><th scope="col">Frame kind</th><th scope="col" className="num">Frames</th><th scope="col" className="num">Of frames held</th></tr></thead>
            <tbody>{f.byKind.map((k) => (
              <tr key={k.kind}><td>{k.kind.replace(/_/g, ' ')}</td><td className="num">{count(k.count)}</td><td className="num">{count(k.count)} / {count(f.frames)}</td></tr>
            ))}</tbody>
          </table>
        </>
      )}
    </div>
  );
}

function LogLayer({ read, view, path, onPickBid }: { read: OrderBookRead; view: OrderBookView; path:BidPathReceipt|null; onPickBid:(id:string)=>void }) {
  const lotUrl=read.lot!.source_url;
  const outside=[...view.partition.outside].sort((a,b)=>Date.parse(a.posted_at??'')-Date.parse(b.posted_at??'')||a.id.localeCompare(b.id));
  return <>
    {path&&<BidPathLog receipt={path} identities={read.identities} onSelect={onPickBid}/>}
    <details><summary>Current retained frame and window context</summary>
      <p className="stack-note">This source context is read from current rows. Its frame history and window exclusions are not a reconstruction at the selected bid/comment cutoff.</p>
      <LiveFrames view={view} />
      {outside.length > 0 && (
        <div className="stack-missing">
          <strong>Window exclusions: {count(outside.length)} of {count(read.comments.length)} rows keyed to this lot</strong>
          <p className="stack-note">
            Posted more than {LOT_WINDOW_DAYS} days before the currently recorded close. These rows are excluded from this model’s assumed window; the date alone does not prove an incorrect auction key.
          </p>
          <div className="stack-scroll">
            <table className="stack-table">
              <thead><tr><th scope="col">Posted</th><th scope="col">Kind</th><th scope="col" className="num">Amount</th><th scope="col">Author</th><th scope="col">Source</th></tr></thead>
              <tbody>
                {outside.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{c.posted_at ? clock(Date.parse(c.posted_at)) : 'unknown'}</td>
                    <td>{c.comment_type ?? 'unknown'}</td>
                    <td className="num">{c.comment_type === 'bid' && c.bid_amount != null ? sourceAmount(Number(c.bid_amount)) : ''}</td>
                    <td className="stack-mono">{c.author_username ?? 'unknown'}</td>
                    <td><a href={sourceAnchor(c.source_url ?? lotUrl, c.bat_comment_id)} target="_blank" rel="noopener noreferrer">BaT ↗</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </details>
  </>;
}

// --- Key -----------------------------------------------------------------------------------------------------------

function LotKey({ label, text, id, read }: { label: string; text: string | null; id: string | null; read: OrderBookRead }) {
  const identity = id ? read.identities[id] : undefined;
  return (
    <tr>
      <td>{label}</td>
      <td className="stack-mono">{text || 'not recorded'}</td>
      <td>{id ? (identity ? <Link to={`/profile/external/${id}`} className="stack-mono">{identity.handle ?? id}</Link> : <span className="stack-mono">{id}</span>) : <span className="stack-basis">not keyed</span>}</td>
    </tr>
  );
}

function KeyLayer({read,path,bookReady}:{read:OrderBookRead;path:BidPathReceipt|null;bookReady:boolean}) {
  const lot=read.lot!;
  const state=path?.states.find(s=>s.bid_comment_id===path.selected_bid_comment_id);
  return <>
    {path&&state&&bookReady&&<><p className="stack-note">Book after bid {state.seq}: {state.identities} keyed platform identities and {state.unresolved_entries} unresolved bid entries. Each entry retains its exact source support.</p>
      <BidEntryTable receipt={path} identities={read.identities} keysOnly/></>}
    {path&&!bookReady&&<p role="status">Reading the selected book’s participant and source relationships…</p>}
    <div className="stack-label">Current lot keys · not reconstructed at the input cutoff</div>
    <table className="stack-table"><thead><tr><th scope="col">Role</th><th scope="col">As written on the current lot</th><th scope="col">Keyed identity</th></tr></thead><tbody>
      <LotKey label="Seller" text={lot.seller_name} id={lot.seller_external_identity_id} read={read}/>
      <LotKey label="Winner" text={lot.winning_bidder} id={lot.winning_bidder_external_identity_id} read={read}/>
    </tbody></table>
  </>;
}

// --- Baseline, residual, feature, prediction, outcome --------------------------------------------------------------

function MissingNote({ layer, name, tail = 'No number is shown for this layer.' }: { layer: StackLayer; name?: string; tail?: string }) {
  return (
    <div className="stack-missing" role="note">
      <strong>Missing layer: {(name ?? layer.name).toLowerCase()}</strong>
      <p className="stack-note">{layer.missing} {tail}</p>
    </div>
  );
}

function BaselineLayer({ applies, temperature, layer, unavailable }: {
  unavailable: string | null;
  applies: boolean;
  temperature: ReturnType<typeof useLiveLotTemperature>;
  layer: StackLayer;
}) {
  return (
    <>
      {applies && temperature.data ? (
        <>
          <div className="stack-label">Present, one point: the lot against comparable lots at its current hours to close</div>
          <div style={{ margin: '8px 0' }}><LiveLotStripsView t={temperature.data} /></div>
        </>
      ) : (
        <p className="stack-note">
          {applies
            ? (temperature.isPending ? 'Reading the one-point comparison…' : 'The one-point comparison returned no reading for this lot.')
            : unavailable ?? "The one-point comparison (live_lot_temperature) answers only while a lot is live and is its vehicle's current listing; this lot is not."}
        </p>
      )}
      <MissingNote layer={layer} name="Baseline curve" tail="No curve is drawn against this lot." />
    </>
  );
}

function OutcomeLayer({ read, view }: { read: OrderBookRead; view: OrderBookView }) {
  const lot = read.lot!;
  // The result can come from a live frame after the last page read, so the row's last write is its clock.
  const at = Date.parse(lot.updated_at ?? '');
  if (view.window.open) {
    return (
      <p className="stack-note">
        Pending. The lot closes {view.window.closeAt == null ? 'at an unknown time' : clock(view.window.closeAt)} as last read; soft-close
        extensions move it. The outcome row joins here when the source records the result.
      </p>
    );
  }
  const winner = lot.winning_bidder_external_identity_id ? read.identities[lot.winning_bidder_external_identity_id] : undefined;
  return (
    <table className="stack-table">
      <tbody>
        <tr><td>Result</td><td>{outcomeWord(lot, false)}</td></tr>
        <tr><td>Recorded winning bid</td><td className="stack-mono">{lot.winning_bid != null ? `${sourceAmount(Number(lot.winning_bid))} (fee basis unestablished)` : 'none recorded'}</td></tr>
        <tr><td>High bid as recorded</td><td className="stack-mono">{lot.high_bid != null ? sourceAmount(Number(lot.high_bid)) : 'not recorded'}</td></tr>
        <tr><td>Winner</td><td>{winner && lot.winning_bidder_external_identity_id
          ? <Link to={`/profile/external/${lot.winning_bidder_external_identity_id}`} className="stack-mono">{winner.handle}</Link>
          : <span className="stack-mono">{lot.winning_bidder ?? 'not recorded'}{lot.winning_bidder ? ' (not keyed)' : ''}</span>}</td></tr>
        <tr><td>As of</td><td className="stack-mono">{Number.isFinite(at) ? `${clock(at)} (lot row last written, by a page read or a live frame)` : 'unknown'}</td></tr>
      </tbody>
    </table>
  );
}

// --- Page ----------------------------------------------------------------------------------------------------------

export default function OrderBookStack() {
  const { vehicleId = '' } = useParams<{ vehicleId: string }>();
  const [params, setParams] = useSearchParams();
  const lotValue = params.get('lot');
  const invalidLot = params.getAll('lot').length > 1 || (lotValue !== null && !UUID_RE.test(lotValue));
  const lotParam = !invalidLot ? lotValue : null;
  const layerParam = params.get('layer') as LayerId | null;
  const layer: LayerId = layerParam && LAYER_IDS.includes(layerParam) ? layerParam : 'fold';
  const query = useOrderBook(invalidLot ? '' : vehicleId, lotParam);
  const read = query.data ?? null;
  // This page consumes SQL bid states. The retained-source reader supplies current metadata only.
  const view = useMemo(() => (read ? shapeOrderBook(read, { fold: false }) : null), [read]);
  const request = useMemo(() => bidRequestFromParams(params), [params]);
  const bidQuery = useBidPath(vehicleId, invalidLot ? '' : read?.lot?.id ?? '', request);
  const path = !bidQuery.isError && bidQuery.data?.state === 'partial' ? bidQuery.data : null;
  const bookReady = Boolean(path && !bidQuery.isPlaceholderData);
  const inputContextReason = !path ? 'The SQL bid measurement is unavailable.'
    : path.knowledge_mode !== 'current_recorded_state' || request?.snapshot_hash
      ? 'This comparison reads current live state; it does not reconstruct a historical or pinned input book.'
      : path.amount_context.currency_state !== 'recorded_claim' || path.amount_context.currency_code !== 'USD'
        || path.amount_context.price_basis !== 'hammer' || path.amount_context.price_basis_conflict !== false
        ? 'The current comparison requires established USD hammer amounts without a fee-basis conflict.'
        : !read?.lot?.high_bid || !Number.isSafeInteger(read.lot.high_bid) || path.summary.running_high_bid === null
          || bidDecimal(String(read.lot.high_bid)) !== bidDecimal(path.summary.running_high_bid)
          ? 'The captured running high bid does not match the current lot state.' : null;
  const measuredBidders = path ? {
    bidders: path.summary.bid_count === read?.lot?.total_bids && path.summary.unresolved_bid_entries === 0
      ? path.summary.keyed_participant_count : null,
    why: path.summary.bid_count !== read?.lot?.total_bids
      ? `${path.summary.bid_count} SQL-eligible bids of the ${read?.lot?.total_bids ?? 'unknown count'} reported by the current lot`
      : path.summary.unresolved_bid_entries ? 'Some eligible bids have no validated platform identity key.' : null,
  } : { bidders: null, why: 'No SQL bid measurement.' };
  const baselineApplies = Boolean(!inputContextReason && read?.lot && view?.window.open && read.vehicle.sale_status === 'auction_live'
    && trimUrl(read.lot.source_url) === trimUrl(read.vehicle.listing_url));
  const temperature = useLiveLotTemperature(baselineApplies ? vehicleId : null);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value == null) next.delete(key); else next.set(key, value);
    setParams(next);
  };
  const openCurrentAuction = () => { const next = resetEpisodeInputs(params); next.delete('lot'); setParams(next); };
  const selectBid = (id: string) => {
    if (path) setParams(selectBidParams(params, path, id), { replace: true });
  };
  const pickBidFromLog = (id: string) => {
    if (!path) return;
    const next = selectBidParams(params, path, id); next.set('layer', 'fold'); setParams(next);
  };

  if (!UUID_RE.test(vehicleId)) {
    return <main className="stack-page"><p className="stack-status" role="status">This address does not name a vehicle. Nothing was read.</p></main>;
  }
  const back = stackBackParams(params.get('back')).toString();
  const header = (
    <div className="stack-eyebrow"><Link to={back ? `/stacks?${back}` : '/stacks'}>Stacks</Link> / Stack {STACK.letter} · {STACK.name}</div>
  );
  if (invalidLot) return <main className="stack-page">{header}<p className="stack-status" role="status">This address does not name one valid auction. No auction was read.</p><button type="button" onClick={openCurrentAuction}>Read current auction</button></main>;
  if (query.isPending) return <main className="stack-page">{header}<p className="stack-status" role="status">Reading the lot…</p></main>;
  if (query.isError) {
    return (
      <main className="stack-page">{header}
        <p className="stack-status" role="status">The lot could not be read completely, so nothing is shown. <button type="button" onClick={() => void query.refetch()}>Read again</button></p>
      </main>
    );
  }
  if (!read) return <main className="stack-page">{header}<p className="stack-status" role="status">No public vehicle with this id. Nothing else was read.</p></main>;
  if (!read.lot || !view) {
    return (
      <main className="stack-page">{header}<h1 className="stack-title">{lotName(read)}</h1>
        <p className="stack-status" role="status">{lotParam ? 'The requested auction is not among this vehicle’s retained public episodes. No other auction was selected.' : `This vehicle has no Bring a Trailer lot. Stack ${STACK.letter} reads BaT lots only.`}</p>
        {lotParam && <button type="button" onClick={openCurrentAuction}>Read current auction</button>}
      </main>
    );
  }

  const lot = read.lot;
  const readAt = Date.parse(read.readAt);
  const layerIndex = LAYER_IDS.indexOf(layer);
  const current = STACK.layers[layerIndex];
  const readings = layerReadings(read, view,
    !baselineApplies ? 'no point' : temperature.data ? '1 point' : temperature.isPending ? 'reading' : 'no point');
  readings.log = path ? `${count(path.summary.bid_count)} bids` : 'unavailable';
  readings.fold = path ? `${count(path.summary.bid_count)} SQL states` : 'unavailable';
  readings.key = path ? `${count(path.summary.keyed_participant_count)} identities` : 'unavailable';
  const toClose = view.window.closeAt == null ? null : view.window.closeAt - readAt;

  return (
    <main className="stack-page">
      {header}
      <h1 className="stack-title">{lotName(read)}</h1>
      <p className="stack-question">Inspect captured bids, prices and discussion on this auction.</p>
      <div className="stack-meta">
        <span className="stack-mono">BaT lot {lot.lot_number ?? 'number not recorded'}</span>
        <span><span className="stack-label">Status</span> {outcomeWord(lot, view.window.open)}</span>
        <span><span className="stack-label">{view.window.open ? 'Scheduled close' : 'Closed'}</span> <span className="stack-mono">{view.window.closeAt == null ? 'unknown' : clock(view.window.closeAt)}</span></span>
        {view.window.open && toClose != null && <span><span className="stack-label">To close</span> <span className="stack-mono">{span(toClose)}</span></span>}
        <Link to={`/vehicle/${read.vehicle.id}?${new URLSearchParams({returnTo: `/stacks/order-book/${read.vehicle.id}?${params}`})}`}>Current vehicle record →</Link>
        <a href={`${trimUrl(lot.source_url)}/`} target="_blank" rel="noopener noreferrer">BaT listing ↗</a>
      </div>
      {read.lots.length > 1 && (
        <div className="stack-lots">
          <span className="stack-label">Lots on this vehicle</span>
          {read.lots.map((l) => (
            <button key={l.id} type="button" className="stack-chip" aria-pressed={l.id === lot.id}
              onClick={() => { const next = new URLSearchParams(params); next.set('lot', l.id);
                const reset = resetEpisodeInputs(next); reset.delete('csFilter'); setParams(reset); }}>
              {l.auction_end_date ? new Date(l.auction_end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' }) : 'no close'} · {l.outcome ?? 'unknown'}
            </button>
          ))}
        </div>
      )}

      <p className="stack-note" data-source-amount-basis>Lot metadata and results below are current retained records. Bid-path amounts and their recorded qualifications appear with the SQL receipt.</p>
      <EpisodeInputControls key={`inputs-${lot.id}`} vehicleId={vehicleId} lotId={lot.id} closeAt={lot.auction_end_date}/>
      {path ? <BidKnowledge receipt={path} pinned={Boolean(request?.snapshot_hash)}/> : <p className="stack-status" role="status" data-bid-path-unavailable>
        {request === null ? 'This address contains invalid bid measurement controls. No bid path was read.'
          : bidQuery.isError ? 'The SQL bid measurement could not be read. Bid curves and measurements are withheld. Refresh auction measurements to retry.'
          : bidQuery.data?.state === 'unavailable' ? `Bid measurement unavailable: ${bidQuery.data.reason.replace(/_/g, ' ')}. Refresh auction measurements to read current inputs.`
          : 'Reading the SQL bid measurements…'}</p>}

      <details><summary>Completed-auction cohort reference · independent of the input cutoff</summary>
        <p className="stack-note">This comparison uses its own retained completed-auction study and current source context. It does not reconstruct peer or selected-episode statistics at the bid/comment cutoff.</p>
        <VehicleCohort key={lot.id} read={read} />
      </details>

      <details><summary>Current retained-source context</summary>
        <p className="stack-note">These capture counts use the current source reader and its assumed window. Bid graphs use the eligible inputs and clocks in the SQL receipt above.</p>
        <CoverageTable rows={view.coverage} readAt={readAt} caption="current source context" compact onOpen={(id) => setParam('layer', id === 'fold' ? null : id)} />
      </details>

      <ForecastPanel read={read} view={view} unavailable={inputContextReason} measuredBidders={measuredBidders} />

      <LayerPath layers={STACK.layers} current={layer} readings={readings} onSelect={(id) => setParam('layer', id === 'fold' ? null : id)} />

      <section className="stack-layer" aria-label={`${current.name} layer`}>
        <LayerHead layer={current} index={layerIndex}>
          {layer === 'log' && <LogLayer read={read} view={view} path={path} onPickBid={pickBidFromLog} />}
          {layer === 'key' && <KeyLayer read={read} path={path} bookReady={bookReady} />}
          {layer === 'dimension' && (<><CommentMeasurements key={lot.id} vehicleId={read.vehicle.id} lotId={lot.id} closeAt={lot.auction_end_date} embedded /><MissingNote layer={current} name="Stance" tail="No comment is labelled with a stance." /></>)}
          {layer === 'fold' && path && <BidPathFold receipt={path} identities={read.identities} selectedId={request?.selected_bid_comment_id ?? path.states.at(-1)?.bid_comment_id ?? null} bookReady={bookReady} onSelect={selectBid} />}
          {layer === 'baseline' && <BaselineLayer applies={baselineApplies} temperature={temperature} layer={current} unavailable={inputContextReason} />}
          {(layer === 'residual' || layer === 'feature' || layer === 'prediction') && <MissingNote layer={current} />}
          {layer === 'outcome' && <OutcomeLayer read={read} view={view} />}
        </LayerHead>
        <div className="stack-walk">
          {layerIndex > 0 ? <button type="button" onClick={() => setParam('layer', LAYER_IDS[layerIndex - 1] === 'fold' ? null : LAYER_IDS[layerIndex - 1])}>← {STACK.layers[layerIndex - 1].name}</button> : <span />}
          {layerIndex < LAYER_IDS.length - 1 ? <button type="button" onClick={() => setParam('layer', LAYER_IDS[layerIndex + 1] === 'fold' ? null : LAYER_IDS[layerIndex + 1])}>{STACK.layers[layerIndex + 1].name} →</button> : <span />}
        </div>
      </section>
    </main>
  );
}
