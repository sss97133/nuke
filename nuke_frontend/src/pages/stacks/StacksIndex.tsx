import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { PrefetchLink as Link } from '../../components/PrefetchLink';
import { LOT_WINDOW_DAYS, shapeOrderBook, useOrderBook } from './orderBookReader';
import { STACKS, type StackDefinition } from './stackDefinitions';
import { CoverageTable, LayerPath } from './stackParts';
import { clock, count, layerReadings } from './stackFormat';
import './stacks.css';

// /stacks: every stack with its layers and its coverage. One stack today (A, the auction as an order book); its
// coverage is read live on the lot it was demonstrated on, with the receipt of how that lot was selected.

function StackCard({ stack }: { stack: StackDefinition }) {
  const navigate = useNavigate();
  const demo = stack.demonstration;
  const query = useOrderBook(demo.vehicleId, demo.auctionEventId);
  const view = useMemo(() => (query.data ? shapeOrderBook(query.data) : null), [query.data]);
  const read = query.data;
  const href = `${stack.route}/${demo.vehicleId}?lot=${demo.auctionEventId}`;
  const name = read ? [read.vehicle.year, read.vehicle.make, read.vehicle.model].filter(Boolean).join(' ') : null;
  const withReader = stack.layers.filter((l) => l.state === 'reader').length;
  const partial = stack.layers.filter((l) => l.state === 'partial').length;
  const missing = stack.layers.filter((l) => l.state === 'missing').length;
  return (
    <article className="stack-card" aria-labelledby={`stack-${stack.stackId}`}>
      <div className="stack-eyebrow">Stack {stack.letter} · registry id {stack.stackId}, version {stack.version}</div>
      <h2 id={`stack-${stack.stackId}`}><Link to={href}>{stack.name}</Link></h2>
      <p className="stack-question">{stack.question}</p>
      <p className="stack-note">
        Layers: {withReader} of {stack.layers.length} have a reader, {partial} have part of one, {missing} have none.
        Each opens on the demonstration lot.
      </p>
      <LayerPath layers={stack.layers} current={null} readings={read && view ? layerReadings(read, view, null) : {}}
        onSelect={(id) => navigate(id === 'fold' ? href : `${href}&layer=${id}`)} />
      <p className="stack-note" style={{ marginTop: 10 }}>
        <strong>Demonstration lot{name ? `: ${name}` : ''}.</strong> Selected {clock(Date.parse(demo.selectedAt))} by rule: {demo.rule}{' '}
        It held {count(demo.keyedBidsInWindow)} keyed bids from {count(demo.identities)} identities, the most among {count(demo.liveLots)} live BaT lots.
        {demo.excluded && <> The raw ranking's first lot was left out: {count(demo.excluded.outsideWindow)} of its {count(demo.excluded.keyedBids)} keyed bids were posted more than {LOT_WINDOW_DAYS} days before its scheduled close, in an earlier sale of the same vehicle (a key conflict, kept on <Link to={`${stack.route}/${demo.excluded.vehicleId}?lot=${demo.excluded.auctionEventId}&layer=log`}>its log</Link>).</>}
      </p>
      {query.isPending && <p className="stack-note" role="status">Reading the demonstration lot's coverage…</p>}
      {query.isError && <p className="stack-note" role="status">The demonstration lot could not be read completely; no coverage is shown.</p>}
      {read && view && <CoverageTable rows={view.coverage} readAt={Date.parse(read.readAt)} caption="demonstration lot, read now"
        onOpen={(id) => navigate(id === 'fold' ? href : `${href}&layer=${id}`)} />}
      {read && !view && <p className="stack-note" role="status">The demonstration vehicle has no readable BaT lot now.</p>}
      <Link className="stack-card-open" to={href}>Open stack {stack.letter} on this lot →</Link>
    </article>
  );
}

export default function StacksIndex() {
  return (
    <main className="stack-page">
      <div className="stack-eyebrow">Stacks</div>
      <h1 className="stack-title">Stacks</h1>
      <p className="stack-question">
        A stack is a path through nine layers, from the log to the outcome. Each layer has a reader, part of one, or none,
        and says which; every number carries its denominator and the clock it is as of.
      </p>
      {STACKS.map((s) => <StackCard key={s.stackId} stack={s} />)}
    </main>
  );
}
