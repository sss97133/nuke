import { lazy, Suspense, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Text } from '../../kit';
import CapturedListings from './CapturedListings';
const MarketPulse = lazy(() => import('./MarketPulse'));
const AUCTION_LENS_PARAMS = ['view', 'lot', 'make', 'model', 'live', 'sort', 'bidRange', 'inspect', 'day', 'salesScope', 'days', 'benchmark', 'series', 'board'];

// Asking/recorded prices never enter the BaT bid board's auction calculations.
// Keep the existing explorer at the Market entry point. Source-only listing
// links and explicit collection choices retain their own reader and context.
export default function MarketInventory({ onUnavailable }: { onUnavailable?: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const collection = params.get('collection') ?? (params.has('source') && !AUCTION_LENS_PARAMS.some(key => params.has(key)) ? 'listings' : 'auctions');
  const auctions = collection === 'auctions';
  // The other retained population, one link away. The auction page places it in its scope strip.
  const other = <button type="button" className="market-control" aria-pressed={false}
    onClick={() => { const next = new URLSearchParams(params); next.set('collection', auctions ? 'listings' : 'auctions'); setParams(next); }}>
    <Text role="label">{auctions ? 'Captured listings' : 'BaT auctions'}</Text>
  </button>;
  return auctions
    ? <Suspense fallback={<p role="status">Reading auction board…</p>}><MarketPulse onUnavailable={onUnavailable} collection={other} /></Suspense>
    : <CapturedListings collection={other} />;
}
