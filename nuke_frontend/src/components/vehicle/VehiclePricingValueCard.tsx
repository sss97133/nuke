import React, { useMemo, useState } from 'react';
import '../../design-system.css';
import { isListingLive, parseMoneyNumber } from '../../lib/auctionUtils';
import { getPlatformDisplayName, normalizePlatform } from '../../services/platformNomenclature';
import PriceAnalysisPanel from './PriceAnalysisPanel';
import PriceHistoryModal from './PriceHistoryModal';
import { CollapsibleWidget } from '../ui/CollapsibleWidget';

type AuctionPulseLike = {
  platform?: string | null;
  listing_url?: string | null;
  listing_status?: string | null;
  end_date?: string | null;
  current_bid?: number | null;
  final_price?: number | null;
  bid_count?: number | null;
  watcher_count?: number | null;
  view_count?: number | null;
  comment_count?: number | null;
  updated_at?: string | null;
};

type ValuationIntelLike = {
  estimated_value?: number | string | null;
  confidence_score?: number | null;
  evidence_score?: number | null;
  valuation_date?: string | null;
};

type ReadinessSnapshotLike = {
  readiness_score?: number | null;
  missing_items?: string[] | null;
  created_at?: string | null;
};

function formatUsd(n: number | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function formatTs(ts?: string | null): string | null {
  if (!ts) return null;
  try {
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return null;
    return d.toLocaleString();
  } catch {
    return null;
  }
}

export function VehiclePricingValueCard(props: {
  vehicle: any;
  auctionPulse?: AuctionPulseLike | null;
  valuationIntel?: ValuationIntelLike | null;
  readinessSnapshot?: ReadinessSnapshotLike | null;
}) {
  const { vehicle, auctionPulse, valuationIntel, readinessSnapshot } = props;
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const vehicleId = String(vehicle?.id || '');

  const saleStatus = String(vehicle?.sale_status || '').toLowerCase();
  const auctionOutcome = String(vehicle?.auction_outcome || '').toLowerCase();
  const sold = saleStatus === 'sold' || auctionOutcome === 'sold';

  const askingPrice = parseMoneyNumber(vehicle?.asking_price);
  const salePrice = parseMoneyNumber(vehicle?.sale_price);
  const highBid = parseMoneyNumber(vehicle?.high_bid);
  const winningBid = parseMoneyNumber(vehicle?.winning_bid);

  const nukeValue = useMemo(() => {
    const v = parseMoneyNumber((valuationIntel as any)?.estimated_value);
    if (v) return v;
    return parseMoneyNumber(vehicle?.current_value);
  }, [valuationIntel, vehicle?.current_value]);

  const liveBid = useMemo(() => {
    if (!auctionPulse?.listing_url) return null;
    const bid = parseMoneyNumber(auctionPulse.current_bid);
    if (!bid) return null;
    const live = isListingLive({
      listing_status: auctionPulse.listing_status || null,
      end_date: auctionPulse.end_date || null,
      current_bid: bid,
      final_price: auctionPulse.final_price ?? null,
    });
    if (!live) return null;
    return bid;
  }, [auctionPulse]);

  const platformKey = normalizePlatform(auctionPulse?.platform || null);
  const platformName = getPlatformDisplayName(platformKey);
  const listingUrl = auctionPulse?.listing_url ? String(auctionPulse.listing_url) : null;
  const listingStatus = auctionPulse?.listing_status ? String(auctionPulse.listing_status) : null;

  const financePreview = useMemo(() => {
    const base = nukeValue;
    const readiness = typeof readinessSnapshot?.readiness_score === 'number' ? readinessSnapshot.readiness_score : null;
    const conf = typeof (valuationIntel as any)?.confidence_score === 'number' ? (valuationIntel as any).confidence_score : null;
    if (!base || !readiness) return null;

    // Conservative default policy preview (placeholder until finance policy is formalized).
    const rate =
      readiness >= 80 && (conf ?? 0) >= 80 ? 0.65 :
      readiness >= 70 ? 0.55 :
      readiness >= 60 ? 0.50 :
      0.0;

    if (rate <= 0) return { rate, amount: null as number | null };
    return { rate, amount: Math.round(base * rate) };
  }, [nukeValue, readinessSnapshot?.readiness_score, (valuationIntel as any)?.confidence_score]);

  const sub = (left: string, right: React.ReactNode, onClick?: () => void) => (
    <div 
      style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        gap: 10,
        cursor: onClick ? 'pointer' : 'default',
        padding: '2px 4px',
        borderRadius: '3px',
        transition: 'background-color 0.12s ease'
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        if (onClick) {
          (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--grey-100)';
        }
      }}
      onMouseLeave={(e) => {
        if (onClick) {
          (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
        }
      }}
    >
      <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>{left}</div>
      <div style={{ fontSize: '8pt' }}>{right}</div>
    </div>
  );

  return (
    <>
      <CollapsibleWidget
        title="Pricing & Value"
        defaultCollapsed={true}
        action={
          <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
            <button className="button button-small" onClick={() => setShowAnalysis(true)} style={{ fontSize: '8pt' }}>
              Price analysis
            </button>
            <button className="button button-small" onClick={() => setShowHistory(true)} style={{ fontSize: '8pt' }}>
              Price ledger
            </button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Market lane */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: '9pt', fontWeight: 800 }}>Market (observed)</div>
            {sub('Live bid', liveBid ? (
              <span>
                <span style={{ fontWeight: 800 }}>{formatUsd(liveBid)}</span>
                {listingUrl && (
                  <>
                    {' '}·{' '}
                    <a href={listingUrl} target="_blank" rel="noreferrer" style={{ fontSize: '8pt' }} onClick={(e) => e.stopPropagation()}>
                      {platformName}
                    </a>
                  </>
                )}
                {auctionPulse?.end_date && (
                  <span style={{ color: 'var(--text-muted)' }}> · ends {formatTs(auctionPulse.end_date) || '—'}</span>
                )}
              </span>
            ) : '—', () => liveBid && setShowAnalysis(true))}

            {sub('High bid', (!liveBid && !sold && highBid) ? <span style={{ fontWeight: 700 }}>{formatUsd(highBid)}</span> : '—', () => highBid && setShowAnalysis(true))}

            {sub('Sold for', (sold && salePrice) ? <span style={{ fontWeight: 800 }}>{formatUsd(salePrice)}</span> : '—', () => salePrice && setShowHistory(true))}

            {sub('Outcome', sold ? 'sold' : (auctionOutcome || listingStatus || '—'), () => listingUrl && window.open(listingUrl, '_blank'))}

            {/* Auction stats */}
            {sub('Bids', typeof auctionPulse?.bid_count === 'number' ? auctionPulse.bid_count.toLocaleString() : '—')}
            {sub('Comments', typeof auctionPulse?.comment_count === 'number' ? auctionPulse.comment_count.toLocaleString() : '—')}
            {sub('Views', typeof auctionPulse?.view_count === 'number' && auctionPulse.view_count > 0 ? auctionPulse.view_count.toLocaleString() : '—')}
            {sub('Watchers', typeof auctionPulse?.watcher_count === 'number' && auctionPulse.watcher_count > 0 ? auctionPulse.watcher_count.toLocaleString() : '—')}
          </div>

          {/* Owner lane */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: '9pt', fontWeight: 800 }}>Owner (intent)</div>
            {sub('Asking', askingPrice ? <span style={{ fontWeight: 700 }}>{formatUsd(askingPrice)}</span> : '—', () => askingPrice && setShowHistory(true))}
          </div>

          {/* Nuke lane */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: '9pt', fontWeight: 800 }}>Nuke (marks)</div>
            {sub('Nuke value', nukeValue ? <span style={{ fontWeight: 800 }}>{formatUsd(nukeValue)}</span> : '—', () => nukeValue && setShowAnalysis(true))}
            {sub('Valuation confidence', (typeof (valuationIntel as any)?.confidence_score === 'number') ? `${(valuationIntel as any).confidence_score}/100` : '—', () => setShowAnalysis(true))}
            {sub('Evidence score', (typeof (valuationIntel as any)?.evidence_score === 'number') ? `${(valuationIntel as any).evidence_score}/100` : '—', () => setShowAnalysis(true))}
            {sub('Readiness', (typeof readinessSnapshot?.readiness_score === 'number') ? `${readinessSnapshot.readiness_score}/100` : '—', () => setShowAnalysis(true))}
            {sub('Missing items', (Array.isArray(readinessSnapshot?.missing_items) && readinessSnapshot!.missing_items!.length > 0)
              ? `${readinessSnapshot!.missing_items!.length} items`
              : '—', () => readinessSnapshot?.missing_items && readinessSnapshot.missing_items.length > 0 && window.scrollTo({ top: document.getElementById('vehicle-proof-tasks')?.offsetTop || 0, behavior: 'smooth' }))}
          </div>

          {/* Finance preview */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: '9pt', fontWeight: 800 }}>Finance (preview)</div>
            {sub('Advance rate', financePreview ? `${Math.round((financePreview.rate || 0) * 100)}%` : '—', () => financePreview && setShowAnalysis(true))}
            {sub('Max loan', (financePreview && financePreview.amount) ? <span style={{ fontWeight: 800 }}>{formatUsd(financePreview.amount)}</span> : '—', () => financePreview?.amount && setShowAnalysis(true))}
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
              Preview only. Final finance policy will key off inspection/evidence + market liquidity + borrower history.
            </div>
          </div>

          {/* Debug / provenance hint */}
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
            Tip: click the main price in the header to view provenance. Live bid is sourced from `external_listings` and cached to `vehicles.high_bid`.
          </div>
        </div>
      </CollapsibleWidget>

      {showAnalysis && vehicleId && (
        <PriceAnalysisPanel vehicleId={vehicleId} isOpen={showAnalysis} onClose={() => setShowAnalysis(false)} />
      )}
      {showHistory && vehicleId && (
        <PriceHistoryModal vehicleId={vehicleId} isOpen={showHistory} onClose={() => setShowHistory(false)} />
      )}
    </>
  );
}

