import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PrefetchLink as Link } from '../../components/PrefetchLink';
import { LOT_WINDOW_DAYS, shapeOrderBook, useOrderBook } from './orderBookReader';
import { STACKS, type StackDefinition } from './stackDefinitions';
import { CoverageTable, LayerPath } from './stackParts';
import { FoldLayer } from './OrderBookStack';
import { ForecastPanel } from './ForecastPanel';
import { clock, count, layerReadings, outcomeWord, usd } from './stackFormat';
import './stacks.css';

// /stacks shows the available stack operating on real evidence. Registry and layer mechanics open below the reading.

function StackCard({ stack }: { stack: StackDefinition }) {
  const navigate = useNavigate();
  const demo = stack.demonstration;
  const query = useOrderBook(demo.vehicleId, demo.auctionEventId);
  const view = useMemo(() => (query.data ? shapeOrderBook(query.data) : null), [query.data]);
  const [bidId, setBidId] = useState<string | null>(null);
  const read = query.data;
  const href = `${stack.route}/${demo.vehicleId}?lot=${demo.auctionEventId}`;
  const name = read ? [read.vehicle.year, read.vehicle.make, read.vehicle.model].filter(Boolean).join(' ') : null;
  const withReader = stack.layers.filter((l) => l.state === 'reader').length;
  const partial = stack.layers.filter((l) => l.state === 'partial').length;
  const missing = stack.layers.filter((l) => l.state === 'missing').length;
  const picked = view?.states.findIndex((s) => s.bid.id === bidId) ?? -1;
  const selected = picked >= 0 ? picked : (view?.states.length ?? 0) - 1;
  const selectedBid = view?.states[selected]?.bid;
  const readingHref = selectedBid && selected < (view?.states.length ?? 0) - 1 ? `${href}&at=${selectedBid.id}` : href;
  return (
    <article className="stack-card" aria-labelledby={`stack-${stack.stackId}`}>
      <div className="stack-card-heading">
        <div>
          <div className="stack-eyebrow">Stack {stack.letter} · {stack.stackId} · v{stack.version}</div>
          <h2 id={`stack-${stack.stackId}`}><Link to={href}>{stack.name}</Link></h2>
        </div>
        {view && <span className="stack-mode">{view.window.open ? 'Current lot · reads every minute' : 'Recorded lot · replay'}</span>}
      </div>
      <p className="stack-question">{stack.question}</p>
      {query.isPending && <p className="stack-note" role="status">Reading the demonstration lot's coverage…</p>}
      {query.isError && <p className="stack-note" role="status">The latest read failed{read ? '; the previous reading remains below' : '; no coverage is shown'}. <button type="button" className="stack-chip" onClick={() => void query.refetch()}>Read again</button></p>}
      {!query.isPending && !query.isError && !read && <p className="stack-note" role="status">The demonstration vehicle is not publicly readable. No operating reading is shown.</p>}
      {read && view && <>
        <div className="stack-operation-context">
          <Link to={href}>{name || 'Vehicle'} · BaT lot {read.lot?.lot_number ?? 'number unknown'}</Link>
          <span className="stack-label">{outcomeWord(read.lot!, view.window.open)}</span>
          <Link to={`/vehicle/${read.vehicle.id}`}>Vehicle record →</Link>
        </div>
        <CoverageTable rows={view.coverage} readAt={Date.parse(read.readAt)} caption="this lot" compact
          onOpen={(id) => navigate(id === 'fold' ? readingHref : `${readingHref}&layer=${id}`)} />
        <section className="stack-operation" aria-label="Auction order book in action">
          <div className="stack-operation-heading">
            <h3>Bid → bidder → demand</h3>
            <Link to={readingHref}>Inspect this reading →</Link>
          </div>
          <FoldLayer view={view} selected={selected} compact sourceUrl={read.lot!.source_url}
            onSelect={(i) => setBidId(i === view.states.length - 1 ? null : view.states[i].bid.id)} />
        </section>
        <ForecastPanel read={read} view={view} />
        {!view.window.open && <Link className="stack-result" to={`${href}&layer=outcome`}>
          <span className="stack-label">Recorded outcome</span>
          <strong>{outcomeWord(read.lot!, false)}{read.lot!.outcome === 'sold' && read.lot!.winning_bid != null ? ` · ${usd(Number(read.lot!.winning_bid))} (buyer fee excluded)` : ''}</strong>
          <span>Inspect result →</span>
        </Link>}
      </>}
      {read && !view && <p className="stack-note" role="status">The demonstration vehicle has no readable BaT lot now.</p>}
      <details className="stack-method">
        <summary>Evidence path & selection receipt <span className="stack-basis">{withReader} / {stack.layers.length} readers · {partial} partial · {missing} missing</span></summary>
        <LayerPath layers={stack.layers} current={null} readings={read && view ? layerReadings(read, view, null) : {}}
          onSelect={(id) => navigate(id === 'fold' ? readingHref : `${readingHref}&layer=${id}`)} />
        <p className="stack-note">
          <strong>Demonstration selection.</strong> Selected {clock(Date.parse(demo.selectedAt))} by rule: {demo.rule}{' '}
          It then held {count(demo.keyedBidsInWindow)} keyed bids from {count(demo.identities)} identities, the most among {count(demo.liveLots)} live BaT lots. These are selection-time counts.
          {demo.excluded && <> The raw ranking's first lot was left out: {count(demo.excluded.outsideWindow)} of its {count(demo.excluded.keyedBids)} keyed bids were posted more than {LOT_WINDOW_DAYS} days before its scheduled close, in an earlier sale of the same vehicle (a key conflict, kept on <Link to={`${stack.route}/${demo.excluded.vehicleId}?lot=${demo.excluded.auctionEventId}&layer=log`}>its log</Link>).</>}
        </p>
      </details>
    </article>
  );
}

export default function StacksIndex() {
  return (
    <main className="stack-page">
      <div className="stack-eyebrow">Stacks</div>
      <h1 className="stack-title">Stacks</h1>
      <p className="stack-question">Explore the working readings. Move through received events to see how the evidence changes the answer.</p>
      {STACKS.map((s) => <StackCard key={s.stackId} stack={s} />)}
    </main>
  );
}
