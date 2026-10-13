import { lazy, Suspense, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  return <>
    <nav aria-label="Market collection" style={{ display: 'flex', gap: 12, padding: '12px' }}>
      <button aria-pressed={auctions} onClick={() => { const next = new URLSearchParams(params); next.set('collection', 'auctions'); setParams(next); }}>BaT auctions</button>
      <button aria-pressed={!auctions} onClick={() => { const next = new URLSearchParams(params); next.set('collection', 'listings'); setParams(next); }}>Captured listings</button>
    </nav>
    {auctions ? <Suspense fallback={<p role="status">Reading auction board…</p>}><MarketPulse onUnavailable={onUnavailable} /></Suspense> : <CapturedListings />}
  </>;
}
