// Pure utility functions extracted from VehicleHeader.tsx
// These have no React dependencies and can be used anywhere.

export const RELATIONSHIP_LABELS: Record<string, string> = {
  owner: 'Owner',
  consigner: 'Consignment',
  collaborator: 'Collaborator',
  service_provider: 'Service',
  work_location: 'Work site',
  seller: 'Seller',
  buyer: 'Buyer',
  parts_supplier: 'Parts',
  fabricator: 'Fabricator',
  painter: 'Paint',
  upholstery: 'Upholstery',
  transport: 'Transport',
  storage: 'Storage',
  inspector: 'Inspector'
};

export const parseMoneyNumber = (val: any): number | null => {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return Number.isFinite(val) && val > 0 ? val : null;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[^0-9.]/g, '');
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
};

export const formatLivePlatformLabel = (provider?: string | null, platform?: string | null) => {
  if (provider === 'mux') return 'Nuke Live';
  if (!platform) return 'Live';
  if (platform === 'twitch') return 'Twitch';
  if (platform === 'youtube') return 'YouTube';
  if (platform === 'custom') return 'Live';
  return platform;
};

export const normalizePartyHandle = (raw?: string | null): string | null => {
  const h = String(raw || '').trim();
  if (!h) return null;
  const normalized = h
    .replace(/^@/, '')
    .replace(/^https?:\/\/bringatrailer\.com\/member\//i, '')
    .replace(/^https?:\/\/carsandbids\.com\/u\//i, '')
    .replace(/^https?:\/\/www\.hagerty\.com\/marketplace\/profile\//i, '')
    .replace(/^https?:\/\/pcarmarket\.com\/member\//i, '')
    .replace(/\/+$/, '')
    .trim();
  return normalized || null;
};

export const toTitleCase = (input: string) =>
  input
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

export const formatAuctionHouseLabel = (platform?: string | null, host?: string | null, source?: string | null) => {
  const raw = String(platform || source || host || '').trim();
  if (!raw) return null;
  const normalized = raw
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.com$/, '')
    .replace(/\s+/g, '_');
  const map: Record<string, string> = {
    bat: 'Bring a Trailer',
    bringatrailer: 'Bring a Trailer',
    bring_a_trailer: 'Bring a Trailer',
    carsandbids: 'Cars & Bids',
    cars_and_bids: 'Cars & Bids',
    hagerty: 'Hagerty Marketplace',
    hagerty_marketplace: 'Hagerty Marketplace',
    pcarmarket: 'PCarMarket',
    mecum: 'Mecum',
    barrett_jackson: 'Barrett-Jackson',
    barrettjackson: 'Barrett-Jackson',
    rm_sothebys: "RM Sotheby's",
    rmsothebys: "RM Sotheby's",
    collecting_cars: 'Collecting Cars',
    collectingcars: 'Collecting Cars',
    sbxcars: 'SBX Cars',
    broadarrow: 'Broad Arrow',
    broad_arrow: 'Broad Arrow',
    ebay_motors: 'eBay Motors',
    ebay: 'eBay Motors',
    facebook_marketplace: 'Facebook Marketplace',
    facebook: 'Facebook Marketplace',
    hemmings: 'Hemmings',
    autotrader: 'AutoTrader',
    classic: 'Classic.com',
    classic_com: 'Classic.com',
  };
  if (map[normalized]) return map[normalized];
  return toTitleCase(normalized.replace(/[_-]+/g, ' '));
};

// Classified platforms are not auctions - they have sellers, not consigners
export const isClassifiedPlatform = (platform?: string | null) => {
  const normalized = String(platform || '').trim().toLowerCase().replace(/[_\s-]+/g, '');
  const classifiedPlatforms = [
    'facebookmarketplace', 'facebook',
    'craigslist',
    'autotrader',
    'carscom', 'cars',
    'carfax',
    'carsdirect',
    'truecar',
    'ksl',
    'offerup',
  ];
  return classifiedPlatforms.some(p => normalized.includes(p));
};

export const normalizeBusinessType = (value?: string | null) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
};

export const isIntermediaryBusinessType = (value?: string | null) => {
  const normalized = normalizeBusinessType(value);
  if (!normalized) return false;
  return (
    normalized.includes('auction') ||
    normalized.includes('platform') ||
    normalized.includes('marketplace') ||
    normalized.includes('broker') ||
    normalized.includes('aggregator')
  );
};

export const roleLabelFromBusinessType = (value?: string | null) => {
  const normalized = normalizeBusinessType(value);
  if (!normalized) return null;
  if (normalized === 'auction_house' || normalized.includes('auction')) return 'Auction platform';
  if (normalized === 'dealer' || normalized === 'dealership' || normalized === 'classic_car_dealer' || normalized === 'dealer_group') return 'Dealer';
  if (normalized.includes('broker')) return 'Broker';
  if (normalized.includes('marketplace') || normalized.includes('platform') || normalized.includes('aggregator')) return 'Marketplace';
  return null;
};

export const formatSellerRoleLabel = (relationship?: string | null, businessType?: string | null) => {
  const fromBusiness = roleLabelFromBusinessType(businessType);
  if (fromBusiness) return fromBusiness;
  const rel = String(relationship || '').toLowerCase();
  if (rel === 'consigner') return 'Consigner';
  if (rel === 'sold_by' || rel === 'seller') return 'Seller';
  return rel ? toTitleCase(rel.replace(/[_-]+/g, ' ')) : 'Seller';
};

export const formatRelationship = (relationship?: string | null) => {
  if (!relationship) return 'Partner';
  return RELATIONSHIP_LABELS[relationship] || relationship.replace(/_/g, ' ');
};

export const escapeRegExp = (input: string) => input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const extractMileageFromText = (text: string | null | undefined): number | null => {
  if (!text) return null;
  const km = text.match(/\b(\d{1,3}(?:,\d{3})?)\s*[kK]\s*[-\s]*mile\b/);
  if (km?.[1]) return parseInt(km[1].replace(/,/g, ''), 10) * 1000;
  const mile = text.match(/\b(\d{1,3}(?:,\d{3})+|\d{1,6})\s*[-\s]*mile\b/i);
  if (mile?.[1]) return parseInt(mile[1].replace(/,/g, ''), 10);
  const odo = text.match(/\bodometer\s+shows\s+(\d{1,3}(?:,\d{3})+|\d{1,6})\b/i);
  if (odo?.[1]) return parseInt(odo[1].replace(/,/g, ''), 10);
  return null;
};

export const cleanListingishTitle = (raw: string, year?: number | null, make?: string | null): string => {
  let s = String(raw || '').trim();
  if (!s) return s;

  // Drop the trailing site name (often after a pipe)
  s = s.split('|')[0].trim();

  // Remove common BaT boilerplate
  s = s.replace(/\bon\s+BaT\s+Auctions\b/gi, '').trim();
  s = s.replace(/\bBaT\s+Auctions\b/gi, '').trim();
  s = s.replace(/\bBring\s+a\s+Trailer\b/gi, '').trim();

  // Fix numeric model designations like "3 0csi" -> "3.0 CSi"
  s = s.replace(/\b(\d)\s+(\d)([a-z]+)\b/gi, (match, d1, d2, suffix) => {
    let formattedSuffix = suffix.toLowerCase();
    if (formattedSuffix === 'csi') {
      formattedSuffix = 'CSi';
    } else {
      formattedSuffix = suffix.charAt(0).toUpperCase() + suffix.slice(1);
    }
    return `${d1}.${d2} ${formattedSuffix}`;
  });
  s = s.replace(/\bending\b[\s\S]*$/i, '').trim();

  // Remove lot number parenthetical
  s = s.replace(/\(\s*Lot\s*#.*?\)\s*/gi, ' ').trim();

  // Remove leading mileage words like "42k-mile"
  s = s.replace(/^\s*\d{1,3}(?:,\d{3})?\s*[kK]\s*[-\s]*mile\s+/i, '').trim();
  s = s.replace(/^\s*\d{1,3}(?:,\d{3})+\s*[-\s]*mile\s+/i, '').trim();

  // Remove leading year (we render year separately)
  if (typeof year === 'number') {
    const yr = escapeRegExp(String(year));
    s = s.replace(new RegExp(`^\\s*${yr}\\s+`, 'i'), '').trim();
  } else {
    s = s.replace(/^\s*(19|20)\d{2}\s+/, '').trim();
  }

  // Remove leading make if it already exists (avoid "Porsche Porsche ...")
  if (make) {
    const mk = String(make).trim();
    if (mk) s = s.replace(new RegExp(`^\\s*${escapeRegExp(mk)}\\s+`, 'i'), '').trim();
  }

  // Remove contaminated listing patterns: "Model - COLOR - $Price (Location)"
  if (s.includes(' - $') || (s.includes(' - ') && s.match(/\$[\d,]+/))) {
    const parts = s.split(/\s*-\s*(?=\$|\([A-Z])/);
    if (parts.length > 0) {
      s = parts[0].trim();
    }
  }

  // Remove color patterns that might still be present
  s = s.replace(/\s*-\s*(BLACK|WHITE|RED|BLUE|GREEN|SILVER|GRAY|GREY|YELLOW|ORANGE|PURPLE|BROWN|BEIGE|TAN)\s*$/i, '').trim();

  // Remove location patterns like "(Torrance)", "(Los Angeles)"
  s = s.replace(/\s*\([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\)\s*$/g, '').trim();

  // Collapse whitespace + trim dangling separators.
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/[-\u2013\u2014]\s*$/g, '').trim();

  // Guardrails: if it's still a paragraph, treat as unusable.
  if (s.length > 80) return '';
  return s;
};

export const appendUnique = (arr: Array<string | number>, part: any) => {
  const p = String(part || '').trim();
  if (!p) return;
  const existing = arr.map(v => String(v).toLowerCase());
  const lower = p.toLowerCase();
  if (existing.some(e => e === lower || e.includes(lower) || lower.includes(e))) return;
  arr.push(p);
};

export const normalizeListingLocation = (raw: any): string | null => {
  let s = String(raw ?? '').trim();
  if (!s) return null;

  const junkPhrases = ['View all listings', 'Notify me about new listings'];
  for (const phrase of junkPhrases) {
    const re = new RegExp(escapeRegExp(phrase).replace(/\s+/g, '\\s*'), 'gi');
    s = s.replace(re, ' ');
  }

  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/[•·|,;:\u2013\u2014-]\s*$/g, '').trim();
  return s || null;
};

export const formatShortDate = (value?: string | null) => {
  if (!value) return undefined;
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
  } catch {
    return undefined;
  }
};

export const formatAge = (iso?: string | null) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const diff = Date.now() - t;
  if (diff < 0) return '0s';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
};

export const formatRemaining = (iso?: string | null) => {
  if (!iso) return null;
  const end = new Date(iso).getTime();
  if (!Number.isFinite(end)) return null;
  const diff = end - Date.now();
  const maxReasonable = 60 * 24 * 60 * 60 * 1000;
  if (diff > maxReasonable) return null;
  if (diff <= 0) return 'Ended';
  const s = Math.floor(diff / 1000);
  const d = Math.floor(s / (60 * 60 * 24));
  const h = Math.floor((s % (60 * 60 * 24)) / (60 * 60));
  const m = Math.floor((s % (60 * 60)) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

export const isValidUsername = (username: string | null | undefined): boolean => {
  if (!username || typeof username !== 'string') return false;
  const u = username.trim().toLowerCase();
  const invalid = ['everyone', 'unknown', 'n/a', 'none', 'null', 'undefined', 'seller', 'buyer', 'owner', 'user', 'admin'];
  return u.length > 0 && !invalid.includes(u) && u.length >= 2;
};
