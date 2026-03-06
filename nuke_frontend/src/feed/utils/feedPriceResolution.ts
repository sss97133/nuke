/**
 * feedPriceResolution.ts
 *
 * Pure-function extraction of the price resolution logic from VehicleCardDense.tsx.
 * Determines which price to display and what badge state to show for a vehicle.
 *
 * This replaces the inline useMemo chains (lines 396-454, 1065-1160) in the old
 * 3,197-line monolith. No React dependencies — just data in, data out.
 */

import type { ResolvedPrice, PriceSource } from '../types/feed';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseMoneyNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return Number.isFinite(val) && val > 0 ? val : null;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[^0-9.]/g, '');
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function formatCurrency(amount: number | null, fallback = '\u2014'): string {
  if (amount === null || !Number.isFinite(amount)) return fallback;
  return '$' + amount.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

// ---------------------------------------------------------------------------
// Core resolution
// ---------------------------------------------------------------------------

/**
 * Determine the display price and badge state for a vehicle.
 *
 * Replicates the exact priority order from VehicleCardDense.tsx:
 * 1. Sale price (executed transaction)
 * 2. Live bid (active auction from external_listings)
 * 3. Winning bid (sold auction result)
 * 4. High bid (ended / RNM auctions)
 * 5. Current bid (legacy vehicle field fallback)
 * 6. Asking price (only if explicitly for sale)
 * 7. Current value (Nuke mark / estimate)
 * 8. Purchase price
 * 9. MSRP
 */
export function resolveVehiclePrice(vehicle: Record<string, any>): ResolvedPrice {
  const v = vehicle;

  // --- Extract all price fields ---
  const salePrice = parseMoneyNumber(v.sale_price);
  const winningBid = parseMoneyNumber(v.winning_bid);
  const highBid = parseMoneyNumber(v.high_bid);
  const currentBid = parseMoneyNumber(v.current_bid);
  const currentValue = parseMoneyNumber(v.current_value);
  const purchasePrice = parseMoneyNumber(v.purchase_price);
  const msrp = parseMoneyNumber(v.msrp);

  // --- Live bid from external_listings ---
  const externalListing = v.external_listings?.[0];
  const listingLiveBid = parseMoneyNumber(externalListing?.current_bid);
  const listingEndDate = externalListing?.end_date
    ? new Date(externalListing.end_date).getTime()
    : 0;
  const statusStr = String(externalListing?.listing_status || '').toLowerCase();
  const hasLiveStatus = statusStr === 'active' || statusStr === 'live';
  const isLive =
    (Number.isFinite(listingEndDate) && listingEndDate > Date.now()) ||
    (!externalListing?.end_date && hasLiveStatus);
  const liveBid = isLive ? listingLiveBid : null;

  // --- Asking price (only if for sale) ---
  const saleStatus = String(v.sale_status || '').toLowerCase();
  const rawAskingPrice = parseMoneyNumber(v.asking_price);
  const isForSaleStatus = saleStatus === 'for_sale' || saleStatus === 'available';
  const asking =
    rawAskingPrice !== null && (v.is_for_sale === true || isForSaleStatus)
      ? rawAskingPrice
      : null;

  // --- Resolve price by priority ---
  let amount: number | null = null;
  let source: PriceSource = 'none';

  if (salePrice !== null) { amount = salePrice; source = 'sale'; }
  else if (liveBid !== null) { amount = liveBid; source = 'live_bid'; }
  else if (winningBid !== null) { amount = winningBid; source = 'winning_bid'; }
  else if (highBid !== null) { amount = highBid; source = 'high_bid'; }
  else if (currentBid !== null) { amount = currentBid; source = 'current_bid'; }
  else if (asking !== null) { amount = asking; source = 'asking'; }
  else if (currentValue !== null) { amount = currentValue; source = 'estimate'; }
  else if (purchasePrice !== null) { amount = purchasePrice; source = 'purchase'; }
  else if (msrp !== null) { amount = msrp; source = 'msrp'; }

  // --- Determine vehicle states ---
  const outcome = String(v.auction_outcome || '').toLowerCase();
  const externalStatus = externalListing
    ? String(externalListing.listing_status || '').toLowerCase()
    : '';
  const hasFinalPrice = !!externalListing?.final_price;
  const hasSoldAt = !!externalListing?.sold_at;

  const isSold =
    outcome === 'sold' ||
    saleStatus === 'sold' ||
    (externalStatus === 'sold' && (hasFinalPrice || hasSoldAt)) ||
    (salePrice !== null && saleStatus === 'sold');

  const isResult =
    !isSold &&
    (outcome === 'reserve_not_met' ||
      outcome === 'ended' ||
      outcome === 'no_sale' ||
      externalStatus === 'ended');

  // --- Sold badge time window (hide after 30 days) ---
  const saleDate = v.sale_date || externalListing?.sold_at || null;
  let showSoldBadge = true;
  if (saleDate) {
    const sale = new Date(saleDate).getTime();
    if (Number.isFinite(sale)) {
      const daysSinceSale = (Date.now() - sale) / (1000 * 60 * 60 * 24);
      showSoldBadge = daysSinceSale <= 30;
    }
  }

  // --- Build badge text (replicates badgeMainText logic) ---
  const formatted = formatCurrency(amount);
  let badgeText: string;

  // Active auction: show bid or "BID"
  const isActiveAuction =
    isLive || saleStatus === 'auction_live' || hasLiveStatus;

  if (isActiveAuction) {
    // Live auction bid text
    const bidText = liveBid !== null
      ? formatCurrency(liveBid)
      : currentBid !== null
        ? formatCurrency(currentBid)
        : null;
    badgeText = bidText || 'BID';
  } else if (isSold && showSoldBadge) {
    // Recently sold
    const soldAmount = salePrice ?? winningBid ?? highBid ?? null;
    badgeText = soldAmount !== null ? `SOLD ${formatCurrency(soldAmount)}` : 'SOLD';
  } else if (isResult) {
    // Ended without sale
    const resultAmount = highBid ?? winningBid ?? null;
    badgeText = resultAmount !== null
      ? `RESULT ${formatCurrency(resultAmount)}`
      : 'ENDED';
  } else {
    badgeText = formatted;
  }

  return {
    amount,
    formatted,
    source,
    isLive: isActiveAuction,
    isSold,
    isResult,
    badgeText,
    showSoldBadge,
  };
}
