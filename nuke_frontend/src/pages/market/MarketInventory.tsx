import { lazy, Suspense, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import CapturedListings from './CapturedListings';
const MarketPulse = lazy(() => import('./MarketPulse'));

// Asking/recorded prices never enter the BaT bid board's auction calculations.
// Preserve existing auction and sales deep links at the same Market entry point.
export default function MarketInventory({ onUnavailable }: { onUnavailable?: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const collection = params.get('collection') ?? (params.has('view') || params.has('lot') ? 'auctions' : 'listings');
  const auctions = collection === 'auctions';
  return <>
    <nav aria-label="Market collection" style={{ display: 'flex', gap: 12, padding: '12px' }}>
      <button aria-pressed={!auctions} onClick={() => { const next = new URLSearchParams(params); next.set('collection', 'listings'); setParams(next); }}>Captured listings</button>
      <button aria-pressed={auctions} onClick={() => { const next = new URLSearchParams(params); next.set('collection', 'auctions'); setParams(next); }}>BaT auctions</button>
    </nav>
    {auctions ? <Suspense fallback={<p role="status">Reading auction board…</p>}><MarketPulse onUnavailable={onUnavailable} /></Suspense> : <CapturedListings />}
  </>;
}
