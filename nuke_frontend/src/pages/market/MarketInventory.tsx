import { lazy, Suspense, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Text } from '../../kit';
import CapturedListings from './CapturedListings';
const MarketPulse = lazy(() => import('./MarketPulse'));
const AuctionCalendar = lazy(() => import('./AuctionCalendar'));
const AUCTION_LENS_PARAMS = ['view', 'lot', 'make', 'model', 'live', 'sort', 'bidRange', 'inspect', 'day', 'salesScope', 'days', 'benchmark', 'series', 'board'];
const COLLECTIONS = [
  { key: 'auctions', label: 'BaT live auctions' },
  { key: 'calendar', label: 'Auction calendar' },
  { key: 'listings', label: 'Captured listings' },
] as const;
type Collection = typeof COLLECTIONS[number]['key'];

// Asking/recorded prices never enter the BaT bid board's auction calculations.
// Keep the existing explorer at the Market entry point. Source-only listing
// links and explicit collection choices retain their own reader and context.
export default function MarketInventory({ onUnavailable }: { onUnavailable?: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const requested = params.get('collection') ?? (params.has('source') && !AUCTION_LENS_PARAMS.some(key => params.has(key)) ? 'listings' : 'auctions');
  const collection: Collection = COLLECTIONS.some(c => c.key === requested) ? requested as Collection : 'auctions';
  // The other retained populations, one link away. Each page places them in its scope strip.
  const others = <>{COLLECTIONS.filter(c => c.key !== collection).map(c => <button key={c.key} type="button" className="market-control" aria-pressed={false}
    onClick={() => { const next = new URLSearchParams(params); next.set('collection', c.key); next.delete('sale'); setParams(next); }}>
    <Text role="label">{c.label}</Text>
  </button>)}</>;
  if (collection === 'calendar') return <Suspense fallback={<p role="status">Reading the auction calendar…</p>}><AuctionCalendar collection={others} /></Suspense>;
  return collection === 'auctions'
    ? <Suspense fallback={<p role="status">Reading auction board…</p>}><MarketPulse onUnavailable={onUnavailable} collection={others} /></Suspense>
    : <CapturedListings collection={others} />;
}
