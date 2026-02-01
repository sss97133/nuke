/**
 * Auction Receipt Generator
 *
 * Creates a complete "receipt" for a vehicle's auction appearance,
 * including timing, bids, fees, and video clip.
 */

import { calculateAuctionFees, formatFeeReceipt, AuctionFees } from './auction-fees';
import { createVideoClip, VideoClip, formatTimestamp } from './video-clips';

export interface AuctionReceipt {
  // Event info
  auctionHouse: string;
  auctionName: string;
  auctionDate: string;
  lotNumber: string;

  // Vehicle
  vehicleId: string;
  vehicleDescription: string;
  year: number;
  make: string;
  model: string;

  // Timing (the "moment")
  blockTime: {
    on: string;           // "1:45:03" - when announced
    off: string;          // "1:46:15" - when hammer fell
    duration: number;     // Seconds on block
    durationFormatted: string; // "1m 12s"
  };

  // Outcome
  outcome: 'sold' | 'no_sale' | 'bid_to' | 'withdrawn';
  hammerPrice: number | null;
  hadReserve: boolean;
  reserveMet: boolean | null;

  // Estimates
  estimateLow: number | null;
  estimateHigh: number | null;
  priceVsEstimate: string | null;  // "+15% over" or "-20% under"

  // Bid activity
  bidCount: number;
  startingBid: number | null;
  bidProgression: number[];  // [50000, 55000, 60000, 65000]
  bidsPerMinute: number;

  // Fees (if sold)
  fees: AuctionFees | null;

  // Video clip
  videoClip: VideoClip | null;

  // Alert score
  alertScore: number;
  alerts: string[];

  // Raw forensics
  forensicsData: any;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

export function calculatePriceVsEstimate(
  price: number,
  low: number,
  high: number
): string {
  const midpoint = (low + high) / 2;
  const diff = ((price - midpoint) / midpoint) * 100;

  if (diff > 5) return `+${Math.round(diff)}% over estimate`;
  if (diff < -5) return `${Math.round(diff)}% under estimate`;
  return 'Within estimate range';
}

export function createAuctionReceipt(
  forensicsData: any,
  auctionEvent: any,
  vehicle: any,
  videoUrl?: string
): AuctionReceipt {
  const fd = forensicsData;

  // Block timing - prefer absolute timestamps from auction_event
  const blockTimeOn = auctionEvent?.broadcast_timestamp_start || fd.announcementTime || 0;
  const blockTimeOff = auctionEvent?.broadcast_timestamp_end || fd.hammerTime || blockTimeOn + (fd.duration || 0);
  const duration = fd.duration || (blockTimeOff - blockTimeOn);

  // Outcome
  const outcome = fd.outcome === 'sold'
    ? 'sold'
    : (fd.bidCount > 0 ? 'bid_to' : 'no_sale');

  const hammerPrice = fd.finalPrice > 0 ? fd.finalPrice : null;

  // Price vs estimate
  let priceVsEstimate: string | null = null;
  if (hammerPrice && auctionEvent?.estimate_low && auctionEvent?.estimate_high) {
    priceVsEstimate = calculatePriceVsEstimate(
      hammerPrice,
      auctionEvent.estimate_low,
      auctionEvent.estimate_high
    );
  }

  // Bid progression
  const bidProgression = (fd.bids || []).map((b: any) => b.amount);

  // Calculate fees if sold
  let fees: AuctionFees | null = null;
  if (outcome === 'sold' && hammerPrice) {
    fees = calculateAuctionFees(hammerPrice, auctionEvent?.source || 'mecum', {
      hasReserve: true, // Assume reserve unless we know otherwise
    });
  }

  // Video clip - use provided URL or from auction event
  let videoClip: VideoClip | null = null;
  const vUrl = videoUrl || auctionEvent?.broadcast_video_url;
  if (vUrl && blockTimeOn > 0) {
    videoClip = createVideoClip(vUrl, blockTimeOn, blockTimeOff);
  }

  return {
    auctionHouse: auctionEvent?.source || 'unknown',
    auctionName: auctionEvent?.auction_name || '',
    auctionDate: auctionEvent?.auction_date || '',
    lotNumber: fd.lotNumber || auctionEvent?.lot_number || '',

    vehicleId: vehicle?.id || auctionEvent?.vehicle_id,
    vehicleDescription: fd.vehicleDescription || '',
    year: vehicle?.year || 0,
    make: vehicle?.make || '',
    model: vehicle?.model || '',

    blockTime: {
      on: formatTimestamp(blockTimeOn),
      off: formatTimestamp(blockTimeOff),
      duration,
      durationFormatted: formatDuration(duration),
    },

    outcome,
    hammerPrice,
    hadReserve: true, // Default assumption
    reserveMet: outcome === 'sold',

    estimateLow: auctionEvent?.estimate_low || null,
    estimateHigh: auctionEvent?.estimate_high || null,
    priceVsEstimate,

    bidCount: fd.bidCount || 0,
    startingBid: bidProgression[0] || null,
    bidProgression,
    bidsPerMinute: duration > 0 ? (fd.bidCount / duration) * 60 : 0,

    fees,
    videoClip,

    alertScore: fd.alertScore || 0,
    alerts: fd.alerts || [],

    forensicsData: fd,
  };
}

/**
 * Format receipt as text for display
 */
export function formatReceiptText(receipt: AuctionReceipt): string {
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push(`  ${receipt.year} ${receipt.make} ${receipt.model}`);
  lines.push(`  ${receipt.auctionHouse.toUpperCase()} - ${receipt.auctionName}`);
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');

  // Timing
  lines.push(`📍 Lot ${receipt.lotNumber}`);
  lines.push(`🕐 On Block: ${receipt.blockTime.on} → ${receipt.blockTime.off} (${receipt.blockTime.durationFormatted})`);
  lines.push('');

  // Outcome
  if (receipt.outcome === 'sold' && receipt.hammerPrice) {
    lines.push(`✅ SOLD: $${receipt.hammerPrice.toLocaleString()}`);
  } else if (receipt.outcome === 'bid_to' && receipt.startingBid) {
    lines.push(`❌ NO SALE (High bid: $${Math.max(...receipt.bidProgression).toLocaleString()})`);
  } else {
    lines.push('❌ NO SALE');
  }

  // Estimate comparison
  if (receipt.estimateLow && receipt.estimateHigh) {
    lines.push(`📊 Estimate: $${(receipt.estimateLow/1000).toFixed(0)}K - $${(receipt.estimateHigh/1000).toFixed(0)}K`);
    if (receipt.priceVsEstimate) {
      lines.push(`   ${receipt.priceVsEstimate}`);
    }
  }

  // Bid activity
  lines.push('');
  lines.push(`🔨 Bids: ${receipt.bidCount} (${receipt.bidsPerMinute.toFixed(1)}/min)`);
  if (receipt.bidProgression.length > 0) {
    const progression = receipt.bidProgression.map(b => `$${(b/1000).toFixed(0)}K`).join(' → ');
    lines.push(`   ${progression}`);
  }

  // Fees
  if (receipt.fees) {
    lines.push('');
    lines.push('💰 FEES:');
    lines.push(`   Buyer pays: $${receipt.fees.buyerTotal.toLocaleString()} (incl ${(receipt.fees.buyerPremiumPct*100).toFixed(0)}% premium)`);
    lines.push(`   Seller nets: $${receipt.fees.sellerNet.toLocaleString()} (after ${(receipt.fees.sellerCommissionPct*100).toFixed(0)}% + $${receipt.fees.sellerEntryFee} fees)`);
    lines.push(`   House take: $${receipt.fees.houseTake.toLocaleString()}`);
  }

  // Video
  if (receipt.videoClip) {
    lines.push('');
    lines.push(`🎬 Watch: ${receipt.videoClip.watchUrl}`);
    lines.push(`   Clip: ${receipt.videoClip.clipDescription}`);
  }

  // Alerts
  if (receipt.alertScore > 30) {
    lines.push('');
    lines.push(`⚠️ Alert Score: ${receipt.alertScore}`);
    receipt.alerts.forEach(a => lines.push(`   - ${a}`));
  }

  lines.push('');
  lines.push('───────────────────────────────────────────────────────────────');

  return lines.join('\n');
}
