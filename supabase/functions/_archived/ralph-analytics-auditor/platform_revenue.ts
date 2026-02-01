// Platform commission rate database
// Sources: Public fee schedules from each platform

export const PLATFORM_COMMISSIONS: Record<string, {
  buyer_premium: number;      // % charged to buyer
  seller_commission: number;  // % charged to seller
  flat_fee?: number;          // Fixed fee if any
  notes: string;
}> = {
  // Major Auction Houses
  'bat': {
    buyer_premium: 0.05,
    seller_commission: 0.05,
    notes: 'Bring a Trailer: 5% buyer premium, 5% seller commission (capped at $5k each)'
  },
  'bring_a_trailer': {
    buyer_premium: 0.05,
    seller_commission: 0.05,
    notes: 'Bring a Trailer: 5% buyer premium, 5% seller commission (capped at $5k each)'
  },
  'cars_and_bids': {
    buyer_premium: 0.045,
    seller_commission: 0.045,
    notes: 'Cars & Bids: 4.5% buyer premium (min $225, max $4.5k), seller commission varies'
  },
  'pcarmarket': {
    buyer_premium: 0.05,
    seller_commission: 0.05,
    notes: 'PCarMarket: ~5% each side, Porsche specialist'
  },
  'collecting_cars': {
    buyer_premium: 0.06,
    seller_commission: 0.04,
    notes: 'Collecting Cars: 6% buyer, 4% seller'
  },
  'broad_arrow': {
    buyer_premium: 0.12,
    seller_commission: 0.05,
    notes: 'Broad Arrow: 12% buyer premium, 5% seller'
  },

  // Premium Auction Houses
  'rm_sothebys': {
    buyer_premium: 0.13,
    seller_commission: 0.08,
    notes: 'RM Sotheby\'s: 13% buyer premium, 8%+ seller (negotiable)'
  },
  'rmsothebys': {
    buyer_premium: 0.13,
    seller_commission: 0.08,
    notes: 'RM Sotheby\'s: 13% buyer premium, 8%+ seller (negotiable)'
  },
  'gooding': {
    buyer_premium: 0.12,
    seller_commission: 0.10,
    notes: 'Gooding & Company: 12% buyer premium, ~10% seller'
  },
  'bonhams': {
    buyer_premium: 0.15,
    seller_commission: 0.10,
    notes: 'Bonhams: 15% buyer premium, ~10% seller'
  },
  'mecum': {
    buyer_premium: 0.10,
    seller_commission: 0.05,
    flat_fee: 200,
    notes: 'Mecum: 10% buyer premium, $200 + 5% seller'
  },
  'barrett_jackson': {
    buyer_premium: 0.10,
    seller_commission: 0.08,
    notes: 'Barrett-Jackson: 10% buyer premium, 8% seller'
  },

  // Online Classifieds
  'hemmings': {
    buyer_premium: 0,
    seller_commission: 0.035,
    flat_fee: 79,
    notes: 'Hemmings: $79/month listing or 3.5% auction'
  },
  'autotrader': {
    buyer_premium: 0,
    seller_commission: 0,
    flat_fee: 99,
    notes: 'AutoTrader: $99 listing fee (dealer pricing varies)'
  },
  'ebay_motors': {
    buyer_premium: 0,
    seller_commission: 0.05,
    flat_fee: 125,
    notes: 'eBay Motors: $125 insertion + 5% final value (max $700)'
  },
  'craigslist': {
    buyer_premium: 0,
    seller_commission: 0,
    flat_fee: 5,
    notes: 'Craigslist: $5 per listing'
  },
  'facebook_marketplace': {
    buyer_premium: 0,
    seller_commission: 0,
    notes: 'Facebook Marketplace: Free for private sellers'
  },

  // Other
  'sbx': {
    buyer_premium: 0.04,
    seller_commission: 0.03,
    notes: 'SBX Cars: 4% buyer, 3% seller'
  }
};

export function getCommissionRate(platform: string): number {
  const p = platform.toLowerCase().replace(/[-\s]/g, '_');
  const config = PLATFORM_COMMISSIONS[p];
  if (!config) return 0.05; // Default 5%
  return config.buyer_premium + config.seller_commission;
}

export function estimatePlatformRevenue(platform: string, salePrice: number): {
  buyerPremium: number;
  sellerCommission: number;
  flatFee: number;
  totalRevenue: number;
} {
  const p = platform.toLowerCase().replace(/[-\s]/g, '_');
  const config = PLATFORM_COMMISSIONS[p] || { buyer_premium: 0.025, seller_commission: 0.025, notes: 'Default' };

  return {
    buyerPremium: salePrice * config.buyer_premium,
    sellerCommission: salePrice * config.seller_commission,
    flatFee: config.flat_fee || 0,
    totalRevenue: (salePrice * (config.buyer_premium + config.seller_commission)) + (config.flat_fee || 0)
  };
}
