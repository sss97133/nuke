/**
 * Static registry of collector vehicle auction platforms.
 * Sourced from database/seeds/live_auction_platforms.sql
 */

export interface AuctionPlatform {
  id: string;
  name: string;
  shortName: string;
  tier: 1 | 2 | 3;
  auctionsUrl: string;
  domain: string;
  region?: string;
  specialty?: string;
  description: string;
}

export const auctionPlatforms: AuctionPlatform[] = [
  // ── TIER 1: Online-First ──────────────────────────────────────────────────
  {
    id: 'bat',
    name: 'Bring a Trailer',
    shortName: 'BaT',
    tier: 1,
    auctionsUrl: 'https://bringatrailer.com/auctions/',
    domain: 'bringatrailer.com',
    description: '7-day auctions with 2-minute soft-close. Premier online platform.',
  },
  {
    id: 'carsandbids',
    name: 'Cars & Bids',
    shortName: 'C&B',
    tier: 1,
    auctionsUrl: 'https://carsandbids.com/auctions/',
    domain: 'carsandbids.com',
    description: 'Modern enthusiast vehicles (1981+). Founded by Doug DeMuro.',
  },
  {
    id: 'pcarmarket',
    name: 'PCARMARKET',
    shortName: 'PCARM',
    tier: 1,
    auctionsUrl: 'https://pcarmarket.com/auctions/',
    domain: 'pcarmarket.com',
    specialty: 'Porsche',
    description: 'Leading Porsche and collectible vehicle marketplace.',
  },
  {
    id: 'collectingcars',
    name: 'Collecting Cars',
    shortName: 'CC',
    tier: 1,
    auctionsUrl: 'https://collectingcars.com/search?status=live',
    domain: 'collectingcars.com',
    region: 'UK',
    description: '24/7 global online auctions. UK-based, founded 2018.',
  },
  {
    id: 'hagerty',
    name: 'Hagerty Marketplace',
    shortName: 'Hagerty',
    tier: 1,
    auctionsUrl: 'https://www.hagerty.com/marketplace/search?type=auctions&forSale=true',
    domain: 'hagerty.com',
    description: '1.8M member community. Free to list with soft-close protection.',
  },
  {
    id: 'hemmings',
    name: 'Hemmings Auctions',
    shortName: 'Hemmings',
    tier: 1,
    auctionsUrl: 'https://www.hemmings.com/classifieds/cars-for-sale/hemmings-auction',
    domain: 'hemmings.com',
    description: 'Online auctions from the classic car magazine.',
  },
  {
    id: 'sbxcars',
    name: 'SBX Cars',
    shortName: 'SBX',
    tier: 1,
    auctionsUrl: 'https://sbxcars.com/auctions',
    domain: 'sbxcars.com',
    description: 'Online auctions for collector and enthusiast vehicles.',
  },
  {
    id: 'themarket',
    name: 'The Market',
    shortName: 'Market',
    tier: 1,
    auctionsUrl: 'https://www.themarket.co.uk/vehicles',
    domain: 'themarket.co.uk',
    region: 'UK',
    description: 'Curated classic and collectible car auctions. UK-based.',
  },
  {
    id: 'thembmarket',
    name: 'The MB Market',
    shortName: 'MB Mkt',
    tier: 1,
    auctionsUrl: 'https://thembmarket.com/auctions',
    domain: 'thembmarket.com',
    specialty: 'Mercedes-Benz',
    description: 'Mercedes-Benz focused. Also sells memorabilia and parts.',
  },
  {
    id: 'issimi',
    name: 'ISSIMI',
    shortName: 'ISSIMI',
    tier: 1,
    auctionsUrl: 'https://issimi.com/auctions',
    domain: 'issimi.com',
    description: 'Curated classic and exotic vehicle auctions.',
  },
  {
    id: 'kickdown',
    name: 'Kickdown',
    shortName: 'Kickdown',
    tier: 1,
    auctionsUrl: 'https://kickdown.com/auctions',
    domain: 'kickdown.com',
    region: 'EU',
    description: 'European-focused classic and collector car auctions.',
  },

  // ── TIER 2: Live Auction Houses ───────────────────────────────────────────
  {
    id: 'mecum',
    name: 'Mecum Auctions',
    shortName: 'Mecum',
    tier: 2,
    auctionsUrl: 'https://www.mecum.com/lots/',
    domain: 'mecum.com',
    description: "North America's largest collector car auction. Live + online.",
  },
  {
    id: 'barrettjackson',
    name: 'Barrett-Jackson',
    shortName: 'B-J',
    tier: 2,
    auctionsUrl: 'https://www.barrett-jackson.com/Events/Current',
    domain: 'barrett-jackson.com',
    description: 'No Reserve policy. Live TV broadcasts since 1971.',
  },
  {
    id: 'rmsothebys',
    name: "RM Sotheby's",
    shortName: 'RM',
    tier: 2,
    auctionsUrl: 'https://rmsothebys.com/en/auctions',
    domain: 'rmsothebys.com',
    description: '#1 classic car auction house. 7 of the most expensive sales ever.',
  },
  {
    id: 'gooding',
    name: 'Gooding & Company',
    shortName: 'Gooding',
    tier: 2,
    auctionsUrl: 'https://www.goodingco.com/auctions',
    domain: 'goodingco.com',
    description: 'Premier auctions at Pebble Beach. 3 of top 10 sales.',
  },
  {
    id: 'bonhams',
    name: 'Bonhams',
    shortName: 'Bonhams',
    tier: 2,
    auctionsUrl: 'https://www.bonhams.com/departments/MOT/',
    domain: 'bonhams.com',
    description: '24/7 online car auctions. Goodwood, The Quail, Amelia Island.',
  },
  {
    id: 'broadarrow',
    name: 'Broad Arrow Auctions',
    shortName: 'Broad Arrow',
    tier: 2,
    auctionsUrl: 'https://broadarrowauctions.com/auctions',
    domain: 'broadarrowauctions.com',
    description: 'Hagerty company. Live and online collector car auctions.',
  },
  {
    id: 'russoandsteele',
    name: 'Russo and Steele',
    shortName: 'R&S',
    tier: 2,
    auctionsUrl: 'https://russoandsteele.com/events',
    domain: 'russoandsteele.com',
    description: 'Auction-in-the-round format. European sports, American muscle.',
  },
  {
    id: 'worldwide',
    name: 'Worldwide Auctioneers',
    shortName: 'Worldwide',
    tier: 2,
    auctionsUrl: 'https://www.worldwide-auctioneers.com/auctions',
    domain: 'worldwide-auctioneers.com',
    description: 'Boutique experience. Classic and rare vehicles in Auburn, IN.',
  },
  {
    id: 'leake',
    name: 'Leake Auctions',
    shortName: 'Leake',
    tier: 2,
    auctionsUrl: 'https://leakecar.com/auctions',
    domain: 'leakecar.com',
    description: 'Family-owned Tulsa auctioneer. Acquired by Ritchie Bros.',
  },

  // ── TIER 3: Aggregators ───────────────────────────────────────────────────
  {
    id: 'classic',
    name: 'Classic.com',
    shortName: 'Classic',
    tier: 3,
    auctionsUrl: 'https://www.classic.com/listings/',
    domain: 'classic.com',
    description: 'Aggregates 275+ dealers and all major auctions. Market data.',
  },
  {
    id: 'ebaymotors',
    name: 'eBay Motors',
    shortName: 'eBay',
    tier: 3,
    auctionsUrl: 'https://www.ebay.com/b/Cars-Trucks/6001/bn_1865117',
    domain: 'ebay.com',
    description: 'Largest online vehicle marketplace. Auction and Buy-It-Now.',
  },
  {
    id: 'proxibid',
    name: 'Proxibid',
    shortName: 'Proxibid',
    tier: 3,
    auctionsUrl: 'https://www.proxibid.com/Vehicles/l/3',
    domain: 'proxibid.com',
    description: 'Aggregates multiple auction houses. Timed and live events.',
  },
  {
    id: 'barnfinds',
    name: 'Barn Finds',
    shortName: 'Barn Finds',
    tier: 3,
    auctionsUrl: 'https://barnfinds.com/',
    domain: 'barnfinds.com',
    description: 'Curated finds from auctions, Craigslist, and classifieds.',
  },
];

export const tierLabels: Record<number, string> = {
  1: 'ONLINE AUCTIONS',
  2: 'LIVE AUCTION HOUSES',
  3: 'AGGREGATORS',
};

export function getPlatformsByTier(tier: 1 | 2 | 3): AuctionPlatform[] {
  return auctionPlatforms.filter((p) => p.tier === tier);
}
