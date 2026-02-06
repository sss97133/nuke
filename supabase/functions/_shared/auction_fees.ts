/**
 * Real Auction Fee Calculations
 *
 * Sources:
 * - BaT: https://bringatrailer.com/bat-guide-how-classic-car-auction-fees-work/
 * - RM Sotheby's: Catalog-based, approximately 12% no cap
 * - Mecum: ~10% buyer's premium
 * - Bonhams: Tiered structure
 *
 * These are REAL costs that matter for evaluating true cost of ownership.
 */

export interface AuctionFeeResult {
  platform: string;
  hammer_price: number;
  buyer_premium: number;
  seller_fee: number;
  total_transaction_cost: number;
  effective_rate_pct: number;
}

/**
 * Bring a Trailer fee calculation
 * - Buyer's premium: 5%, min $250, max $7,500
 * - Seller fee: $99-$2,500 depending on service level
 */
export function calculateBaTFees(hammer_price: number, seller_tier: 'classic' | 'plus' | 'white_glove' = 'classic'): AuctionFeeResult {
  // Buyer's premium: 5% with $250 min, $7,500 max
  const raw_buyer_premium = hammer_price * 0.05;
  const buyer_premium = Math.max(250, Math.min(7500, raw_buyer_premium));

  // Seller fees by tier
  const seller_fees = {
    classic: 99,
    plus: 429,
    white_glove: 2500
  };
  const seller_fee = seller_fees[seller_tier];

  const total = buyer_premium + seller_fee;

  return {
    platform: 'Bring a Trailer',
    hammer_price,
    buyer_premium,
    seller_fee,
    total_transaction_cost: total,
    effective_rate_pct: (total / hammer_price) * 100
  };
}

/**
 * RM Sotheby's fee calculation
 * - Buyer's premium: ~12% no cap
 * - Seller commission: negotiated, typically 5-10%
 */
export function calculateRMSothebys(hammer_price: number, seller_commission_pct: number = 8): AuctionFeeResult {
  const buyer_premium = hammer_price * 0.12;
  const seller_fee = hammer_price * (seller_commission_pct / 100);
  const total = buyer_premium + seller_fee;

  return {
    platform: 'RM Sothebys',
    hammer_price,
    buyer_premium,
    seller_fee,
    total_transaction_cost: total,
    effective_rate_pct: (total / hammer_price) * 100
  };
}

/**
 * Mecum fee calculation
 * - Buyer's premium: 10%
 * - Seller fees: Entry fee + commission
 */
export function calculateMecum(hammer_price: number): AuctionFeeResult {
  const buyer_premium = hammer_price * 0.10;
  const seller_fee = 500 + (hammer_price * 0.05); // Estimated
  const total = buyer_premium + seller_fee;

  return {
    platform: 'Mecum',
    hammer_price,
    buyer_premium,
    seller_fee,
    total_transaction_cost: total,
    effective_rate_pct: (total / hammer_price) * 100
  };
}

/**
 * Cars & Bids fee calculation
 * - Buyer's premium: 4.5%, capped at $4,500
 * - Seller: Free to list (funded by buyer's premium)
 */
export function calculateCarsAndBids(hammer_price: number): AuctionFeeResult {
  const buyer_premium = Math.min(4500, hammer_price * 0.045);
  const seller_fee = 0;
  const total = buyer_premium + seller_fee;

  return {
    platform: 'Cars & Bids',
    hammer_price,
    buyer_premium,
    seller_fee,
    total_transaction_cost: total,
    effective_rate_pct: (total / hammer_price) * 100
  };
}

/**
 * PCarMarket fee calculation
 * - Buyer's premium: 5%, capped at $5,000
 * - Seller: Free
 */
export function calculatePCarMarket(hammer_price: number): AuctionFeeResult {
  const buyer_premium = Math.min(5000, hammer_price * 0.05);
  const seller_fee = 0;
  const total = buyer_premium + seller_fee;

  return {
    platform: 'PCarMarket',
    hammer_price,
    buyer_premium,
    seller_fee,
    total_transaction_cost: total,
    effective_rate_pct: (total / hammer_price) * 100
  };
}

/**
 * Calculate fees for all platforms at a given price point
 */
export function compareAllPlatforms(hammer_price: number): AuctionFeeResult[] {
  return [
    calculateBaTFees(hammer_price),
    calculateCarsAndBids(hammer_price),
    calculatePCarMarket(hammer_price),
    calculateRMSothebys(hammer_price),
    calculateMecum(hammer_price),
  ].sort((a, b) => a.total_transaction_cost - b.total_transaction_cost);
}

/**
 * Key insight: At what price does each platform become optimal?
 *
 * < $50K:    C&B (4.5% capped) or BaT (5% capped)
 * $50K-$150K: BaT (fee cap kicks in at $150K)
 * $150K+:    BaT beats % based auctions due to $7.5K cap
 * $500K+:    BaT cap makes it dramatically cheaper than RM (saves $52.5K on $500K car)
 */
export function getOptimalPlatform(hammer_price: number): { platform: string; savings: number } {
  const results = compareAllPlatforms(hammer_price);
  const best = results[0];
  const worst = results[results.length - 1];

  return {
    platform: best.platform,
    savings: worst.total_transaction_cost - best.total_transaction_cost
  };
}
