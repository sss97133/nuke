/**
 * Shared vehicle stats computation logic.
 * Used by loadFilteredStats, filteredStats useMemo, and loadDatabaseStats client fallback.
 */

export interface VehicleStats {
  totalVehicles: number;
  totalValue: number;
  salesVolume: number;
  salesCountToday: number;
  forSaleCount: number;
  activeAuctions: number;
  totalBids: number;
  avgValue: number;
  vehiclesAddedToday: number;
  valueMarkTotal: number;
  valueAskTotal: number;
  valueRealizedTotal: number;
  valueCostTotal: number;
  valueImportedToday: number;
  valueImported24h: number;
  valueImported7d: number;
  marketInterestValue?: number;
  rnmVehicleCount?: number;
}

export const EMPTY_STATS: VehicleStats = {
  totalVehicles: 0,
  totalValue: 0,
  salesVolume: 0,
  salesCountToday: 0,
  forSaleCount: 0,
  activeAuctions: 0,
  totalBids: 0,
  avgValue: 0,
  vehiclesAddedToday: 0,
  valueMarkTotal: 0,
  valueAskTotal: 0,
  valueRealizedTotal: 0,
  valueCostTotal: 0,
  valueImportedToday: 0,
  valueImported24h: 0,
  valueImported7d: 0,
  marketInterestValue: 0,
  rnmVehicleCount: 0,
};

const safeNum = (val: any): number => {
  if (val == null) return 0;
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Compute aggregate stats from a list of vehicles.
 * If `overrideTotalVehicles` is provided, it's used instead of `vehicles.length`
 * (useful when the DB count is more accurate than the fetched subset).
 * If `includeDisplayPrice` is true, display_price is included in the price cascade.
 */
export function computeVehicleStats(
  vehicles: any[],
  overrideTotalVehicles?: number,
  includeDisplayPrice = false,
): VehicleStats {
  let totalValue = 0;
  let vehiclesWithValue = 0;
  let forSaleCount = 0;
  let activeAuctions = 0;
  let totalBids = 0;
  let salesCountToday = 0;
  let valueMarkTotal = 0;
  let valueAskTotal = 0;
  let valueRealizedTotal = 0;
  let valueCostTotal = 0;
  let valueImportedToday = 0;
  let valueImported24h = 0;
  let valueImported7d = 0;

  const nowMs = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const todayStartMs = todayStart.getTime();
  const tomorrowStartMs = tomorrowStart.getTime();
  const todayISO = todayStart.toISOString().split('T')[0];
  const last24hMs = nowMs - 24 * 60 * 60 * 1000;
  const last7dMs = nowMs - 7 * 24 * 60 * 60 * 1000;

  for (const v of vehicles) {
    const hasAskingPrice = safeNum(v.asking_price) > 0;
    const isSold = v.sale_status === 'sold' || v.auction_outcome === 'sold';
    if (v.is_for_sale === true || (hasAskingPrice && !isSold)) {
      forSaleCount++;
    }

    if (v.sale_status === 'auction_live') {
      activeAuctions++;
    }

    if (v.bid_count && Number.isFinite(Number(v.bid_count))) {
      totalBids += Number(v.bid_count);
    }

    const currentValue = safeNum(v.current_value);
    if (currentValue > 0) valueMarkTotal += currentValue;

    const purchase = safeNum(v.purchase_price);
    if (purchase > 0) valueCostTotal += purchase;

    const asking = safeNum(v.asking_price);
    if (v.is_for_sale === true && asking > 0) valueAskTotal += asking;

    const salePrice = safeNum(v.sale_price);
    if (salePrice > 0) valueRealizedTotal += salePrice;

    if (salePrice > 0 && v?.sale_date && String(v.sale_date) >= todayISO) {
      salesCountToday += 1;
    }

    const winning = safeNum(v.winning_bid);
    const high = safeNum(v.high_bid);
    const msrp = safeNum(v.msrp);
    const display = includeDisplayPrice ? safeNum(v.display_price) : 0;

    const vehiclePrice =
      (salePrice > 0 ? salePrice : 0) ||
      (winning > 0 ? winning : 0) ||
      (high > 0 ? high : 0) ||
      (asking > 0 ? asking : 0) ||
      (currentValue > 0 ? currentValue : 0) ||
      (purchase > 0 ? purchase : 0) ||
      (msrp > 0 ? msrp : 0) ||
      (display > 0 ? display : 0) ||
      0;

    if (vehiclePrice > 0) {
      totalValue += vehiclePrice;
      vehiclesWithValue++;

      const createdMs = new Date(v?.created_at || 0).getTime();
      if (Number.isFinite(createdMs)) {
        if (createdMs >= todayStartMs && createdMs < tomorrowStartMs) valueImportedToday += vehiclePrice;
        if (createdMs >= last24hMs) valueImported24h += vehiclePrice;
        if (createdMs >= last7dMs) valueImported7d += vehiclePrice;
      }
    }
  }

  const avgValue = vehiclesWithValue > 0 ? totalValue / vehiclesWithValue : 0;

  const vehiclesAddedToday = vehicles.filter((v: any) => {
    const t = new Date(v?.created_at || 0).getTime();
    return Number.isFinite(t) && t >= todayStartMs && t < tomorrowStartMs;
  }).length;

  const salesVolume = vehicles
    .filter((v: any) => Boolean(v?.sale_price) && Boolean(v?.sale_date) && String(v.sale_date) >= todayISO)
    .reduce((sum, v: any) => {
      const price = safeNum(v.sale_price);
      return sum + price;
    }, 0);

  return {
    totalVehicles: overrideTotalVehicles ?? vehicles.length,
    totalValue,
    salesVolume,
    salesCountToday,
    forSaleCount,
    activeAuctions,
    totalBids,
    avgValue,
    vehiclesAddedToday,
    valueMarkTotal,
    valueAskTotal,
    valueRealizedTotal,
    valueCostTotal,
    valueImportedToday,
    valueImported24h,
    valueImported7d,
    marketInterestValue: 0,
    rnmVehicleCount: 0,
  };
}
