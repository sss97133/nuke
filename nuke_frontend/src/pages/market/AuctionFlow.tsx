import { useEffect, useRef, useState } from 'react';
import { houseName, tapeEpisode, type SourceReceiptStatus, type HouseStatus, type LiveAuction, type TapeBid } from './useMarketPulse';
import './AuctionFlow.css';

export function sourceActivity(bids: TapeBid[], now: number) {
  const seen = new Set<string>();
  return bids.filter(b => {
    if (seen.has(b.id) || b.ingestedAt == null || b.ingestedAt > now || b.ingestedAt <= now - 300_000) return false;
    seen.add(b.id); return true;
  });
}
const receiptMoney = (b: TapeBid) => {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: b.currency ?? 'XXX', maximumFractionDigits: 6 }).format(b.amount); }
  catch { return `${b.currency ?? 'Unknown currency'} ${b.amount}`; }
};
const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Source groups describe admitted evidence, not source traffic inferred from a moving vehicle row. */
export function AuctionFlow({ bids, houses, auctions, configuredSources, sourceStatus = [], now: suppliedNow, error, updatedAt, onInspect }: {
  sourceStatus?: SourceReceiptStatus[]; configuredSources: string[]; bids: TapeBid[]; houses: HouseStatus[]; auctions: LiveAuction[]; now: number; error: boolean; updatedAt: number;
  onInspect: (auction: LiveAuction) => void;
}) {
  const now = Math.max(suppliedNow, Date.now());
  const [selected, setSelected] = useState<string | null>(null);
  const [flashing, setFlashing] = useState(new Set<string>());
  const seen = useRef<Set<string> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const before = seen.current;
    const fresh = before ? bids.filter(b => !before.has(b.id) && b.house && b.ingestedAt != null && b.ingestedAt <= Date.now() && b.bidAt <= Date.now() && !b.recovered && Date.now() - b.bidAt < 60_000) : [];
    seen.current = new Set(bids.map(b => b.id));
    if (!fresh.length) return;
    setFlashing(new Set(fresh.map(b => b.house!)));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFlashing(new Set()), 1800);
  }, [bids]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const recent = sourceActivity(bids, now);
  const current = recent.filter(b => !b.recovered && b.bidAt > now - 300_000);
  const sources = [...new Set(['bringatrailer', ...configuredSources, ...houses.map(h => h.house), ...auctions.map(a => a.house), ...recent.flatMap(b => b.house ? [b.house] : [])])];
  const scale = Math.max(1, ...sources.flatMap(h => Array.from({ length: 5 }, (_, i) => current.filter(b => b.house === h && b.ingestedAt! > now - (5 - i) * 60_000 && b.ingestedAt! <= now - (4 - i) * 60_000).length)));
  const stale = error || !updatedAt || now - updatedAt > 45_000;
  const rows = recent.filter(b => !selected || b.house === selected).sort((a, b) => (b.ingestedAt ?? 0) - (a.ingestedAt ?? 0));
  return <section className="auction-flow" aria-label="Auction data arriving">
    <div className="auction-flow__heading"><h2>Arriving now</h2><span>{stale ? 'Receipt refresh unavailable' : `Receipts read ${clock(updatedAt)}`}</span></div>
    <p>Last five minutes of admitted evidence. A snapshot records a high bid when polled; it is not an individual bid. Recovered history is listed separately and does not light up current activity. No arrivals does not prove a quiet source.</p>
    <div className="auction-flow__sources">
      {sources.map(house => {
        const status = sourceStatus.find(s => s.house === house);
        const held = houses.find(h => h.house === house);
        const group = recent.filter(b => b.house === house);
        const individual = group.filter(b => b.eventKind === 'bid' && !b.recovered && b.bidAt > now - 300_000).length;
        const recovered = group.filter(b => b.recovered || b.bidAt <= now - 300_000).length;
        const snapshots = group.filter(b => b.eventKind === 'bid_snapshot' && !b.recovered && b.bidAt > now - 300_000).length;
        const bins = Array.from({ length: 5 }, (_, i) => current.filter(b => b.house === house).filter(b => b.ingestedAt! > now - (5 - i) * 60_000 && b.ingestedAt! <= now - (4 - i) * 60_000).length);
        return <button key={house} type="button" className={`auction-flow__source${flashing.has(house) && !stale ? ' auction-flow__source--arrival' : ''}`}
          aria-pressed={selected === house} onClick={() => setSelected(selected === house ? null : house)}>
          <strong>{houseName(house)}</strong>
          <span>{individual} bids · {snapshots} snapshots{recovered > 0 ? ` · ${recovered} recovered` : ''}</span>
          <span className="auction-flow__bars" aria-label={`Admitted updates in successive minutes: ${bins.join(', ')}`}>
            {bins.map((n, i) => <span key={i} title={`${n} admitted updates`} style={{ height: `${Math.max(2, n / scale * 24)}px`, opacity: n ? 1 : 0.2 }} />)}
          </span>
          {status && <small>{status.hasError ? 'Source reader reports an error' : status.readAt == null ? 'Source reader has no measured check' : now - status.readAt > 900_000 ? 'Source reader check is stale' : `Reader found ${status.lots ?? 'unknown'} lots`}{status.readAt != null ? ` · ${new Date(status.readAt).toLocaleString()}` : ''}{status.state ? ` · ${status.state.replaceAll('_', ' ')}` : ''}</small>}
          <small>{stale ? 'Last received evidence' : held && !held.onBoard ? 'Board freshness gate holds this source' : group.length ? 'Arrivals observed · completeness unverified' : 'No receipts in window · coverage unverified'}</small>
        </button>;
      })}
    </div>
    <details className="auction-flow__detail"><summary>{selected ? houseName(selected) : 'All sources'} · inspect {rows.length} received updates</summary>
      {rows.length === 0 ? <p>No eligible receipts in this window. This does not establish that no bids occurred.</p> :
        <ol>{rows.map(b => {
          const lot = auctions.find(a => a.id === b.vehicleId && a.house === b.house && tapeEpisode(a.listingUrl) === tapeEpisode(b.sourceUrl));
          const lag = b.ingestedAt! - b.bidAt;
          return <li key={b.id}>
            <div><strong>{houseName(b.house ?? 'Unrecorded source')} · {receiptMoney(b)}</strong> <span>{b.recovered || b.bidAt <= now - 300_000 ? 'Recovered evidence' : b.eventKind === 'bid' ? 'Bid' : 'High-bid snapshot'}</span></div>
            {lot ? <button className="market-control" onClick={() => onInspect(lot)}>{lot.title ?? [lot.year, lot.make, lot.model].filter(Boolean).join(' ')} · inspect evidence</button>
              : <span>Listing outside the current board</span>}
            <div>Observed {new Date(b.bidAt).toLocaleDateString()} {clock(b.bidAt)} · admitted {clock(b.ingestedAt!)} · {lag >= 0 ? `${(lag / 1000).toFixed(1)}s observation-to-admission` : 'Clock discrepancy'}{b.clockBasis ? ` · ${b.clockBasis === 'native_comment_timestamp' ? 'source event clock' : 'poll observation clock'}` : ''}</div>
            {b.sourceEventId && <div>Source event {b.sourceEventId}{b.endAt != null ? ` · closes ${new Date(b.endAt).toLocaleString()}` : ''}</div>}
            {b.bidCount != null && <div>Source reports {b.bidCount} total bids; this receipt does not recover intervening bids.</div>}
            {b.receivedAt != null && <div>Received {clock(b.receivedAt)} · {((b.ingestedAt! - b.receivedAt) / 1000).toFixed(1)}s receipt-to-admission</div>}
            {b.projectionError && <div role="status">Projection incomplete: {b.projectionError}</div>}
            <div>{b.sourceUrl && <a href={b.sourceUrl} target="_blank" rel="noopener noreferrer">Source listing ↗</a>} · Evidence {b.observationId ?? b.id}</div>
          </li>;
        })}</ol>}
    </details>
  </section>;
}
