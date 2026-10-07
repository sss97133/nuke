import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { PrefetchLink as Link } from '../../components/PrefetchLink';
import { LiveLotStripsView } from '../market/LiveLotStrips';
import { useLiveLotTemperature } from '../market/useLiveLotTemperature';
import { ORDER_BOOK_STACK, type LayerId, type StackLayer } from './stackDefinitions';
import {
  LOT_WINDOW_DAYS, UUID_RE, depthAt, shapeOrderBook, useOrderBook,
  type BidEvent, type CommentRow, type FoldState, type OrderBookRead, type OrderBookView,
} from './orderBookReader';
import { CoverageTable, LayerPath } from './stackParts';
import { STATE_WORD, clock, count, layerReadings, outcomeWord, span, usd } from './stackFormat';
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

function IdentityName({ id, handle, keyed }: { id: string | null; handle: string; keyed: boolean }) {
  if (keyed && id) return <Link to={`/profile/external/${id}`} className="stack-mono">{handle}</Link>;
  return <span className="stack-mono">{handle} <span className="stack-basis">(not keyed)</span></span>;
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

function LotClock({ view }: { view: OrderBookView }) {
  const { firstHeldAt, closeAt, open, liveUntil } = view.window;
  if (firstHeldAt == null || closeAt == null || closeAt <= firstHeldAt) return null;
  const end = Math.max(closeAt, view.bids.length ? view.bids[view.bids.length - 1].at : closeAt);
  const x = (t: number) => `${Math.max(0, Math.min(1, (t - firstHeldAt) / (end - firstHeldAt))) * 100}%`;
  return (
    <div>
      <div className="stack-label">The lot's life, one tick per bid</div>
      <div className="stack-clock" role="img" aria-label={`${view.bids.length} bids between the first comment held and the scheduled close`}>
        <span className="stack-clock-line" />
        {view.bids.map((b) => <span key={b.id} className="stack-clock-tick" style={{ left: x(b.at) }} title={`${usd(b.amount)} · ${clock(b.at, true)}`} />)}
        {open && liveUntil != null && (<>
          <span className="stack-clock-now" style={{ left: x(liveUntil) }} title={`Read ${clock(liveUntil)}`} />
          <span className="stack-clock-now-label" style={{ left: x(liveUntil) }}>now</span>
        </>)}
      </div>
      <div className="stack-clock-ends">
        <span>First comment held {clock(firstHeldAt)}</span>
        <span>{open ? 'Scheduled close' : 'Closed'} {clock(closeAt)}</span>
      </div>
    </div>
  );
}

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

function LogLayer({ read, view, onPickBid }: { read: OrderBookRead; view: OrderBookView; onPickBid: (id: string) => void }) {
  const lotUrl = read.lot!.source_url;
  const outside = [...view.partition.outside].sort((a, b) => Date.parse(a.posted_at ?? '') - Date.parse(b.posted_at ?? '') || a.id.localeCompare(b.id));
  return (
    <>
      <LotClock view={view} />
      {view.window.closeAt == null && (
        <p className="stack-note">
          This lot has no close time recorded, so its rows cannot be checked against its own window: rows from another
          run on the same URL would not be caught, and time to close is unknown.
        </p>
      )}
      <p className="stack-note">
        {count(view.bids.length)} bids among {count(view.partition.inWindow.length)} rows keyed to this lot inside its window.
        Posted is the source clock (BaT comment time, to the second); landed is when the row reached the database.
        {view.landedThrough != null && <> Rows landed through {clock(view.landedThrough)}.</>}
      </p>
      {view.bids.length === 0 ? (
        <p className="stack-note">No bid rows are keyed to this lot inside its window.</p>
      ) : (
        <div className="stack-scroll">
          <table className="stack-table">
            <thead>
              <tr>
                <th scope="col" className="num">#</th><th scope="col">Posted</th><th scope="col" className="num">Before close</th>
                <th scope="col" className="num">Amount</th><th scope="col">Identity</th><th scope="col" className="hide-narrow">Landed</th><th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {view.states.map((s) => (
                <tr key={s.bid.id}>
                  <td className="num"><button type="button" className="stack-link" onClick={() => onPickBid(s.bid.id)} aria-label={`Open the book as of bid ${s.index + 1}`}>{s.index + 1}</button></td>
                  <td className="mono">{clock(s.bid.at, true)}</td>
                  <td className="num">{s.msToClose == null ? 'unknown' : span(s.msToClose)}</td>
                  <td className="num">{usd(s.bid.amount)}</td>
                  <td><IdentityName id={s.bid.identityId} handle={s.bid.handle} keyed={s.bid.keyed} /></td>
                  <td className="mono hide-narrow">{s.bid.landedAt == null ? 'unknown' : clock(s.bid.landedAt)}</td>
                  <td><a href={sourceAnchor(lotUrl, s.bid.batCommentId)} target="_blank" rel="noopener noreferrer">BaT ↗</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LiveFrames view={view} />
      {outside.length > 0 && (
        <div className="stack-missing">
          <strong>Key conflicts: {count(outside.length)} of {count(read.comments.length)} rows keyed to this lot</strong>
          <p className="stack-note">
            Posted more than {LOT_WINDOW_DAYS} days before this lot's scheduled close, so they cannot be from this run.
            They are kept here as evidence of the key and left out of every count above and of the fold.
          </p>
          <div className="stack-scroll">
            <table className="stack-table">
              <thead><tr><th scope="col">Posted</th><th scope="col">Kind</th><th scope="col" className="num">Amount</th><th scope="col">Author</th><th scope="col">Source</th></tr></thead>
              <tbody>
                {outside.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{c.posted_at ? clock(Date.parse(c.posted_at)) : 'unknown'}</td>
                    <td>{c.comment_type ?? 'unknown'}</td>
                    <td className="num">{c.comment_type === 'bid' && c.bid_amount != null ? usd(Number(c.bid_amount)) : ''}</td>
                    <td className="stack-mono">{c.author_username ?? 'unknown'}</td>
                    <td><a href={sourceAnchor(c.source_url ?? lotUrl, c.bat_comment_id)} target="_blank" rel="noopener noreferrer">BaT ↗</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// --- Key -----------------------------------------------------------------------------------------------------------

interface IdentityLine {
  key: string;
  identityId: string | null;
  handle: string;
  keyed: boolean;
  bids: number;
  max: number;
  first: BidEvent;
  last: BidEvent;
}

function identityLines(bids: BidEvent[]): IdentityLine[] {
  const m = new Map<string, IdentityLine>();
  for (const b of bids) {
    const key = b.identityId ? `id:${b.identityId}` : `bid:${b.id}`;
    const line = m.get(key);
    if (!line) m.set(key, { key, identityId: b.identityId, handle: b.handle, keyed: b.keyed, bids: 1, max: b.amount, first: b, last: b });
    else { line.bids += 1; line.max = Math.max(line.max, b.amount); line.last = b; }
  }
  return [...m.values()].sort((a, b) => b.max - a.max || a.first.at - b.first.at);
}

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

function KeyLayer({ read, view }: { read: OrderBookRead; view: OrderBookView }) {
  const lines = identityLines(view.bids);
  const keyed = lines.filter((l) => l.keyed).length;
  const close = view.window.closeAt;
  const lot = read.lot!;
  return (
    <>
      <p className="stack-note">
        {count(keyed)} identities keyed from {count(view.bids.filter((b) => b.keyed).length)} of {count(view.bids.length)} bids.
        {lines.length > keyed && <> {count(lines.length - keyed)} bids carry no key; their authors are not unified by handle.</>}
        {' '}Each handle opens that identity's record.
      </p>
      {lines.length > 0 && (
        <table className="stack-table">
          <thead>
            <tr><th scope="col">Identity</th><th scope="col" className="num">Bids</th><th scope="col" className="num">Highest</th>
              <th scope="col" className="num">First bid before close</th><th scope="col" className="num">Last bid before close</th></tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <td><IdentityName id={l.identityId} handle={l.handle} keyed={l.keyed} /></td>
                <td className="num">{count(l.bids)}</td>
                <td className="num">{usd(l.max)}</td>
                <td className="num">{close == null ? 'unknown' : span(close - l.first.at)}</td>
                <td className="num">{close == null ? 'unknown' : span(close - l.last.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="stack-label" style={{ marginTop: 12 }}>The lot's own keys</div>
      <table className="stack-table">
        <thead><tr><th scope="col">Role</th><th scope="col">As written on the lot</th><th scope="col">Keyed identity</th></tr></thead>
        <tbody>
          <LotKey label="Seller" text={lot.seller_name} id={lot.seller_external_identity_id} read={read} />
          <LotKey label="Winner" text={lot.winning_bidder} id={lot.winning_bidder_external_identity_id} read={read} />
        </tbody>
      </table>
    </>
  );
}

// --- Dimension -----------------------------------------------------------------------------------------------------

function DimensionLayer({ read, view }: { read: OrderBookRead; view: OrderBookView }) {
  const [open, setOpen] = useState<string | null>(null);
  const total = view.partition.inWindow.length;
  const rowsOf = (kind: string): CommentRow[] => view.partition.inWindow
    .filter((c) => (c.comment_type || 'unknown') === kind)
    .sort((a, b) => Date.parse(a.posted_at ?? '') - Date.parse(b.posted_at ?? ''));
  return (
    <>
      <p className="stack-note">
        {count(total)} rows keyed to this lot inside its window, by the kind the comment builder wrote. That rule is mechanical
        (an amount makes a bid, the seller's name a seller response, a question mark a question); it does not read stance.
      </p>
      <table className="stack-table">
        <thead><tr><th scope="col">Kind as written</th><th scope="col" className="num">Rows</th><th scope="col" className="num">Of rows in window</th></tr></thead>
        <tbody>
          {view.kinds.map((k) => (
            <tr key={k.kind} aria-selected={open === k.kind}>
              <td><button type="button" className="stack-link" aria-expanded={open === k.kind} onClick={() => setOpen(open === k.kind ? null : k.kind)}>{k.kind.replace(/_/g, ' ')}</button></td>
              <td className="num">{count(k.count)}</td>
              <td className="num">{count(k.count)} / {count(total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && (
        <div className="stack-scroll" style={{ marginTop: 8 }}>
          <table className="stack-table">
            <thead><tr><th scope="col">Posted</th><th scope="col">Author</th><th scope="col">Text</th><th scope="col">Source</th></tr></thead>
            <tbody>
              {rowsOf(open).map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.posted_at ? clock(Date.parse(c.posted_at), true) : 'unknown'}</td>
                  <td>{c.external_identity_id ? <Link to={`/profile/external/${c.external_identity_id}`} className="stack-mono">{read.identities[c.external_identity_id]?.handle ?? c.author_username}</Link> : <span className="stack-mono">{c.author_username ?? 'unknown'}</span>}</td>
                  <td>{c.comment_type === 'bid' && c.bid_amount != null ? usd(Number(c.bid_amount)) : (c.comment_text ?? '').slice(0, 280) || <span className="stack-basis">no text</span>}</td>
                  <td><a href={sourceAnchor(c.source_url ?? read.lot!.source_url, c.bat_comment_id)} target="_blank" rel="noopener noreferrer">BaT ↗</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// --- Fold ----------------------------------------------------------------------------------------------------------

const W = 640;
const H = 220;
const PAD = { l: 72, r: 16, t: 14, b: 30 };

/** One price scale for both fold charts: the lowest to the highest bid on the lot, so the curve is never zoomed in. */
function priceScale(states: FoldState[]) {
  const amounts = states.map((s) => s.bid.amount);
  const lo = Math.min(...amounts);
  const hi = Math.max(...amounts);
  return { lo, hi, y: (v: number) => PAD.t + (hi === lo ? (H - PAD.t - PAD.b) / 2 : (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b)) };
}

function BidPathChart({ states, selected, onSelect }: { states: FoldState[]; selected: number; onSelect: (i: number) => void }) {
  const n = states.length;
  const { lo, hi, y } = priceScale(states);
  const x = (i: number) => PAD.l + (n === 1 ? (W - PAD.l - PAD.r) / 2 : (i / (n - 1)) * (W - PAD.l - PAD.r));
  const path = states.map((s, i) => (i === 0 ? `M ${x(0)} ${y(s.price)}` : `H ${x(i)} V ${y(s.price)}`)).join(' ');
  const key = (e: KeyboardEvent<SVGGElement>, i: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = e.key === 'ArrowRight' ? Math.min(i + 1, n - 1) : Math.max(i - 1, 0);
      onSelect(next);
      (e.currentTarget.parentElement?.querySelectorAll<SVGGElement>('[role="button"]')[next])?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(i); }
  };
  return (
    <figure style={{ margin: 0 }}>
      <figcaption className="stack-label">Price path · bids in posted order (spacing is by bid, not by time)</figcaption>
      <svg className="stack-chart" viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Bids in posted order; choose one to see the book as of that bid">
        <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={y(hi)} y2={y(hi)} />
        <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={y(lo)} y2={y(lo)} />
        <text x={PAD.l - 6} y={y(hi) + 4} textAnchor="end">{usd(hi)}</text>
        {hi !== lo && <text x={PAD.l - 6} y={y(lo) + 4} textAnchor="end">{usd(lo)}</text>}
        <path className="path" d={path} />
        {states.map((s, i) => (
          <g key={s.bid.id} role="button" tabIndex={i === selected ? 0 : -1} aria-pressed={i === selected}
            aria-label={`Bid ${i + 1}: ${usd(s.bid.amount)} by ${s.bid.handle}, ${clock(s.bid.at, true)}`}
            onClick={() => onSelect(i)} onKeyDown={(e) => key(e, i)}>
            <circle cx={x(i)} cy={y(s.bid.amount)} r={10} fill="transparent" />
            <circle cx={x(i)} cy={y(s.bid.amount)} r={i === selected ? 5 : 3} className={i === selected ? 'pt-on' : i < selected ? 'pt' : 'pt-future'} />
            <title>{`Bid ${i + 1} · ${usd(s.bid.amount)} · ${s.bid.handle} · ${clock(s.bid.at, true)}`}</title>
          </g>
        ))}
        <text x={x(0)} y={H - 10} textAnchor="start">bid 1{states[0].msToClose != null ? ` · ${span(states[0].msToClose)} before close` : ''}</text>
        {n > 1 && <text x={x(n - 1)} y={H - 10} textAnchor="end">bid {n}{states[n - 1].msToClose != null ? ` · ${span(states[n - 1].msToClose!)}` : ''}</text>}
      </svg>
    </figure>
  );
}

function DemandCurve({ state, states }: { state: FoldState; states: FoldState[] }) {
  const book = state.book;
  const m = book.length;
  const { lo, hi, y } = priceScale(states);
  const x = (k: number) => PAD.l + (k / m) * (W - PAD.l - PAD.r);
  let d = `M ${x(0)} ${y(book[0].max)}`;
  book.forEach((e, j) => {
    d += ` H ${x(j + 1)}`;
    if (j + 1 < m) d += ` V ${y(book[j + 1].max)}`;
  });
  const labelled = m <= 12;
  return (
    <figure style={{ margin: 0 }}>
      <figcaption className="stack-label">Revealed demand · identities with a bid at or above each price</figcaption>
      <svg className="stack-chart" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Demand curve as of bid ${state.index + 1}: ${m} entries from ${usd(book[m - 1].max)} to ${usd(book[0].max)}`}>
        <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} />
        <text x={PAD.l - 6} y={y(hi) + 4} textAnchor="end">{usd(hi)}</text>
        {hi !== lo && <text x={PAD.l - 6} y={y(lo) + 4} textAnchor="end">{usd(lo)}</text>}
        <path className="curve" d={d} />
        {labelled && book.map((e, j) => (
          <text key={e.key} x={(x(j) + x(j + 1)) / 2} y={y(e.max) - 6} textAnchor="middle">{e.handle.slice(0, 14)}</text>
        ))}
        <text x={x(0)} y={H - 10} textAnchor="start">0</text>
        <text x={x(m)} y={H - 10} textAnchor="end">{m} at or above {usd(book[m - 1].max)}</text>
      </svg>
    </figure>
  );
}

function FoldLayer({ view, selected, onSelect }: { view: OrderBookView; selected: number; onSelect: (i: number) => void }) {
  const states = view.states;
  if (states.length === 0) {
    return <p className="stack-note">No bids in this lot's window, so the book is empty: no identity has revealed a price.</p>;
  }
  const s = states[selected];
  const top = s.book[0]?.max ?? s.price;
  return (
    <>
      <div className="stack-asof" aria-live="polite">
        <button type="button" onClick={() => onSelect(selected - 1)} disabled={selected === 0} aria-label="Previous bid">‹</button>
        <button type="button" onClick={() => onSelect(selected + 1)} disabled={selected === states.length - 1} aria-label="Next bid">›</button>
        <span><span className="stack-label">As of bid</span> <span className="stack-mono">{s.index + 1} of {states.length}</span></span>
        <span className="stack-mono">{clock(s.bid.at, true)}</span>
        <span><span className="stack-label">Before close</span> <span className="stack-mono">{s.msToClose == null ? 'unknown' : span(s.msToClose)}</span></span>
        <span><span className="stack-label">Price</span> <span className="stack-mono">{usd(s.price)}</span></span>
        <span><span className="stack-label">Identities revealed</span> <span className="stack-mono">{count(s.identities)}</span>
          {s.unresolved > 0 && <span className="stack-basis"> + {count(s.unresolved)} unkeyed bids</span>}</span>
        {selected !== states.length - 1 && <button type="button" onClick={() => onSelect(states.length - 1)} style={{ minWidth: 60 }}>Latest</button>}
      </div>
      <div className="stack-fold-grid">
        <BidPathChart states={states} selected={selected} onSelect={onSelect} />
        <DemandCurve state={s} states={states} />
      </div>
      <p className="stack-note">
        The curve uses only bids posted at or before the selected one. Each entry is one identity's highest bid so far;
        depth at a price counts the entries at or above it. A bid reveals a willingness to pay at least that amount, so
        the curve is a lower bound on demand, not a measured reservation price.
      </p>
      <table className="stack-table">
        <thead>
          <tr><th scope="col" className="num">Depth</th><th scope="col">Identity</th><th scope="col" className="num">Highest revealed</th>
            <th scope="col" className="num hide-narrow">Posted before close</th><th scope="col" className="num">Bids</th><th scope="col" className="hide-narrow" style={{ width: '30%' }}>Against the top</th></tr>
        </thead>
        <tbody>
          {s.book.map((e) => (
            <tr key={e.key} aria-selected={e.bidId === s.bid.id}>
              <td className="num">{depthAt(s.book, e.max)}</td>
              <td><IdentityName id={e.identityId} handle={e.handle} keyed={Boolean(e.identityId)} /></td>
              <td className="num">{usd(e.max)}</td>
              <td className="num hide-narrow">{view.window.closeAt == null ? 'unknown' : span(view.window.closeAt - e.at)}</td>
              <td className="num">{count(e.bids)}</td>
              <td className="hide-narrow"><span className="stack-ladder-bar" style={{ width: `${top > 0 ? (100 * e.max) / top : 0}%` }} title={`${usd(e.max)} of ${usd(top)}`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
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

function BaselineLayer({ applies, temperature, layer }: {
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
            : "The one-point comparison (live_lot_temperature) answers only while a lot is live and is its vehicle's current listing; this lot is not."}
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
        <tr><td>Hammer</td><td className="stack-mono">{lot.winning_bid != null ? `${usd(Number(lot.winning_bid))} (buyer fee excluded)` : 'none recorded'}</td></tr>
        <tr><td>High bid as recorded</td><td className="stack-mono">{lot.high_bid != null ? usd(Number(lot.high_bid)) : 'not recorded'}</td></tr>
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
  const lotParam = UUID_RE.test(params.get('lot') ?? '') ? params.get('lot') : null;
  const layerParam = params.get('layer') as LayerId | null;
  const layer: LayerId = layerParam && LAYER_IDS.includes(layerParam) ? layerParam : 'fold';
  const query = useOrderBook(vehicleId, lotParam);
  const read = query.data ?? null;
  const view = useMemo(() => (read ? shapeOrderBook(read) : null), [read]);
  const baselineApplies = Boolean(read?.lot && view?.window.open && read.vehicle.sale_status === 'auction_live'
    && trimUrl(read.lot.source_url) === trimUrl(read.vehicle.listing_url));
  const temperature = useLiveLotTemperature(baselineApplies ? vehicleId : null);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value == null) next.delete(key); else next.set(key, value);
    setParams(next);
  };
  const states = view?.states ?? [];
  const atParam = params.get('at');
  const found = states.findIndex((s) => s.bid.id === atParam);
  const selected = found >= 0 ? found : states.length - 1;
  const selectBid = (i: number) => {
    if (i < 0 || i >= states.length) return;
    const next = new URLSearchParams(params);
    if (i === states.length - 1) next.delete('at'); else next.set('at', states[i].bid.id);
    setParams(next, { replace: true });
  };
  const pickBidFromLog = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('layer', 'fold');
    if (states.length && states[states.length - 1].bid.id === id) next.delete('at'); else next.set('at', id);
    setParams(next);
  };

  if (!UUID_RE.test(vehicleId)) {
    return <main className="stack-page"><p className="stack-status" role="status">This address does not name a vehicle. Nothing was read.</p></main>;
  }
  const header = (
    <div className="stack-eyebrow"><Link to="/stacks">Stacks</Link> / Stack {STACK.letter} · {STACK.name}</div>
  );
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
        <p className="stack-status" role="status">This vehicle has no Bring a Trailer lot. Stack {STACK.letter} reads BaT lots only.</p>
      </main>
    );
  }

  const lot = read.lot;
  const readAt = Date.parse(read.readAt);
  const layerIndex = LAYER_IDS.indexOf(layer);
  const current = STACK.layers[layerIndex];
  const readings = layerReadings(read, view,
    !baselineApplies ? 'no point' : temperature.data ? '1 point' : temperature.isPending ? 'reading' : 'no point');
  const toClose = view.window.closeAt == null ? null : view.window.closeAt - readAt;

  return (
    <main className="stack-page">
      {header}
      <h1 className="stack-title">{lotName(read)}</h1>
      <p className="stack-question">{STACK.question}</p>
      <div className="stack-meta">
        <span className="stack-mono">BaT lot {lot.lot_number ?? 'number not recorded'}</span>
        <span><span className="stack-label">Status</span> {outcomeWord(lot, view.window.open)}</span>
        <span><span className="stack-label">{view.window.open ? 'Scheduled close' : 'Closed'}</span> <span className="stack-mono">{view.window.closeAt == null ? 'unknown' : clock(view.window.closeAt)}</span></span>
        {view.window.open && toClose != null && <span><span className="stack-label">To close</span> <span className="stack-mono">{span(toClose)}</span></span>}
        <Link to={`/vehicle/${read.vehicle.id}`}>Vehicle record →</Link>
        <a href={`${trimUrl(lot.source_url)}/`} target="_blank" rel="noopener noreferrer">BaT listing ↗</a>
      </div>
      {read.lots.length > 1 && (
        <div className="stack-lots">
          <span className="stack-label">Lots on this vehicle</span>
          {read.lots.map((l) => (
            <button key={l.id} type="button" className="stack-chip" aria-pressed={l.id === lot.id}
              onClick={() => { const next = new URLSearchParams(params); next.set('lot', l.id); next.delete('at'); setParams(next); }}>
              {l.auction_end_date ? new Date(l.auction_end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' }) : 'no close'} · {l.outcome ?? 'unknown'}
            </button>
          ))}
        </div>
      )}

      <CoverageTable rows={view.coverage} readAt={readAt} caption="this lot" onOpen={(id) => setParam('layer', id === 'fold' ? null : id)} />

      <LayerPath layers={STACK.layers} current={layer} readings={readings} onSelect={(id) => setParam('layer', id === 'fold' ? null : id)} />

      <section className="stack-layer" aria-label={`${current.name} layer`}>
        <LayerHead layer={current} index={layerIndex}>
          {layer === 'log' && <LogLayer read={read} view={view} onPickBid={pickBidFromLog} />}
          {layer === 'key' && <KeyLayer read={read} view={view} />}
          {layer === 'dimension' && (<><DimensionLayer read={read} view={view} /><MissingNote layer={current} name="Stance" tail="No comment is labelled with a stance." /></>)}
          {layer === 'fold' && <FoldLayer view={view} selected={selected} onSelect={selectBid} />}
          {layer === 'baseline' && <BaselineLayer applies={baselineApplies} temperature={temperature} layer={current} />}
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
