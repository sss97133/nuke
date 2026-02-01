/**
 * Auction Fee Calculators
 *
 * Fee structures for major auction houses.
 * Sources: https://support.classic.com/auction-fees-and-prices
 */

export interface AuctionFees {
  house: string;
  hammerPrice: number;

  // Buyer side
  buyerPremium: number;
  buyerPremiumPct: number;
  buyerTotal: number;

  // Seller side
  sellerCommission: number;
  sellerCommissionPct: number;
  sellerEntryFee: number;
  sellerNet: number;

  // House take
  houseTake: number;
  houseTakePct: number;
}

export interface FeeSchedule {
  buyerPremium: { inPerson: number; phone: number; internet: number };
  sellerCommission: { reserve: number; noReserve: number };
  sellerEntryFee: { min: number; max: number; noReserveDiscount: number };
}

// Fee schedules by auction house
export const FEE_SCHEDULES: Record<string, FeeSchedule> = {
  mecum: {
    buyerPremium: { inPerson: 0.10, phone: 0.12, internet: 0.12 },
    sellerCommission: { reserve: 0.10, noReserve: 0.06 },
    sellerEntryFee: { min: 350, max: 1000, noReserveDiscount: 0.50 },
  },
  barrett_jackson: {
    buyerPremium: { inPerson: 0.10, phone: 0.12, internet: 0.12 },
    sellerCommission: { reserve: 0.10, noReserve: 0.08 },
    sellerEntryFee: { min: 300, max: 800, noReserveDiscount: 0.50 },
  },
  // Add more as needed
};

export function calculateAuctionFees(
  hammerPrice: number,
  house: string = 'mecum',
  options: {
    hasReserve?: boolean;
    bidSource?: 'inPerson' | 'phone' | 'internet';
    entryFeeTier?: 'min' | 'max' | number;
  } = {}
): AuctionFees {
  const schedule = FEE_SCHEDULES[house] || FEE_SCHEDULES.mecum;
  const { hasReserve = true, bidSource = 'inPerson', entryFeeTier = 'min' } = options;

  // Buyer premium
  const buyerPremiumPct = schedule.buyerPremium[bidSource];
  const buyerPremium = hammerPrice * buyerPremiumPct;
  const buyerTotal = hammerPrice + buyerPremium;

  // Seller commission
  const sellerCommissionPct = hasReserve
    ? schedule.sellerCommission.reserve
    : schedule.sellerCommission.noReserve;
  const sellerCommission = hammerPrice * sellerCommissionPct;

  // Entry fee
  let sellerEntryFee: number;
  if (typeof entryFeeTier === 'number') {
    sellerEntryFee = entryFeeTier;
  } else {
    sellerEntryFee = schedule.sellerEntryFee[entryFeeTier];
  }
  if (!hasReserve) {
    sellerEntryFee *= (1 - schedule.sellerEntryFee.noReserveDiscount);
  }

  const sellerNet = hammerPrice - sellerCommission - sellerEntryFee;

  // House total take
  const houseTake = buyerPremium + sellerCommission + sellerEntryFee;
  const houseTakePct = houseTake / hammerPrice;

  return {
    house,
    hammerPrice,
    buyerPremium,
    buyerPremiumPct,
    buyerTotal,
    sellerCommission,
    sellerCommissionPct,
    sellerEntryFee,
    sellerNet,
    houseTake,
    houseTakePct,
  };
}

/**
 * Format fees as a human-readable receipt
 */
export function formatFeeReceipt(fees: AuctionFees): string {
  const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

  return `
┌─────────────────────────────────────────┐
│ ${fees.house.toUpperCase()} AUCTION RECEIPT             │
├─────────────────────────────────────────┤
│ Hammer Price:          ${fmt(fees.hammerPrice).padStart(14)} │
├─────────────────────────────────────────┤
│ BUYER PAYS:                             │
│   Premium (${pct(fees.buyerPremiumPct)}):        ${fmt(fees.buyerPremium).padStart(14)} │
│   ─────────────────────────────────     │
│   Total:               ${fmt(fees.buyerTotal).padStart(14)} │
├─────────────────────────────────────────┤
│ SELLER RECEIVES:                        │
│   Commission (${pct(fees.sellerCommissionPct)}):     -${fmt(fees.sellerCommission).padStart(13)} │
│   Entry Fee:           -${fmt(fees.sellerEntryFee).padStart(13)} │
│   ─────────────────────────────────     │
│   Net:                 ${fmt(fees.sellerNet).padStart(14)} │
├─────────────────────────────────────────┤
│ HOUSE TAKE:            ${fmt(fees.houseTake).padStart(14)} │
│   (${pct(fees.houseTakePct)} of hammer)                    │
└─────────────────────────────────────────┘
`.trim();
}
