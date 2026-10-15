import { lazy, Suspense, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Text } from '../../kit';
import CapturedListings from './CapturedListings';
const MarketPulse = lazy(() => import('./MarketPulse'));
const AuctionCalendar = lazy(() => import('./AuctionCalendar'));
const AUCTION_LENS_PARAMS = ['view', 'lot', 'make', 'model', 'live', 'sort', 'bidRange', 'inspect', 'day', 'salesScope', 'days', 'benchmark', 'series', 'board'];
const COLLECTIONS = [
  { key: 'auctions', label: 'BaT live auctions' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'listings', label: 'Classifieds' },
] as const;
type Collection = typeof COLLECTIONS[number]['key'];
// The home page's own params (HomePage reads tab and force_treemap). Every other param belongs to one collection's
// lenses and does not apply in another: the classifieds' sort=newest re-sorted the BaT board, near=1 rode onto it.
const PAGE_PARAMS = ['tab', 'force_treemap'];

// Asking/recorded prices never enter the BaT bid board's auction calculations.
// Keep the existing explorer at the Market entry point. Source-only listing
// links and explicit collection choices retain their own reader and context.
export default function MarketInventory({ onUnavailable }: { onUnavailable?: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const requested = params.get('collection') ?? (params.has('source') && !AUCTION_LENS_PARAMS.some(key => params.has(key)) ? 'listings' : 'auctions');
  const collection: Collection = COLLECTIONS.some(c => c.key === requested) ? requested as Collection : 'auctions';
  // The other retained populations, one link away. Each page places them in its scope strip.
  const others = <>{COLLECTIONS.filter(c => c.key !== collection).map(c => <button key={c.key} type="button" className="market-control" aria-pressed={false}
    onClick={() => {
      const next = new URLSearchParams();
      for (const key of PAGE_PARAMS) { const value = params.get(key); if (value != null) next.set(key, value); }
      next.set('collection', c.key);
      setParams(next);
    }}>
    <Text role="label">{c.label}</Text>
  </button>)}</>;
  if (collection === 'calendar') return <Suspense fallback={<p role="status">Reading the auction calendar…</p>}><AuctionCalendar collection={others} /></Suspense>;
  return collection === 'auctions'
    ? <Suspense fallback={<p role="status">Reading auction board…</p>}><MarketPulse onUnavailable={onUnavailable} collection={others} /></Suspense>
    : <CapturedListings collection={others} />;
}
