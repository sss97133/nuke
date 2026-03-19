/**
 * Shared vehicle data normalization.
 * Single source of truth for make/model/field normalization across all extractors.
 *
 * Usage:
 *   import { normalizeMake, normalizeVehicleFields } from "../_shared/normalizeVehicle.ts";
 */

/** Canonical make names. Keys are lowercase aliases → values are canonical display forms. */
const MAKE_ALIASES: Record<string, string> = {
  // Common abbreviations
  'chevy': 'Chevrolet',
  'chev': 'Chevrolet',
  'chevrolet': 'Chevrolet',
  'vw': 'Volkswagen',
  'volkswagen': 'Volkswagen',
  'merc': 'Mercedes-Benz',
  'mercedes': 'Mercedes-Benz',
  'mercedes-benz': 'Mercedes-Benz',
  'mercedes benz': 'Mercedes-Benz',
  'mb': 'Mercedes-Benz',
  'alfa': 'Alfa Romeo',
  'alfa romeo': 'Alfa Romeo',
  'alfa-romeo': 'Alfa Romeo',
  'bmw': 'BMW',
  'gmc': 'GMC',
  'amg': 'Mercedes-AMG',

  // Hyphenated / multi-word makes
  'aston martin': 'Aston Martin',
  'aston-martin': 'Aston Martin',
  'rolls royce': 'Rolls-Royce',
  'rolls-royce': 'Rolls-Royce',
  'land rover': 'Land Rover',
  'land-rover': 'Land Rover',
  'range rover': 'Land Rover',
  'austin healey': 'Austin-Healey',
  'austin-healey': 'Austin-Healey',
  'de tomaso': 'De Tomaso',
  'de-tomaso': 'De Tomaso',
  'detomaso': 'De Tomaso',

  // Common makes (ensure canonical casing)
  'ford': 'Ford',
  'dodge': 'Dodge',
  'jeep': 'Jeep',
  'toyota': 'Toyota',
  'nissan': 'Nissan',
  'honda': 'Honda',
  'porsche': 'Porsche',
  'ferrari': 'Ferrari',
  'lamborghini': 'Lamborghini',
  'maserati': 'Maserati',
  'bugatti': 'Bugatti',
  'bentley': 'Bentley',
  'jaguar': 'Jaguar',
  'lotus': 'Lotus',
  'mclaren': 'McLaren',
  'audi': 'Audi',
  'volvo': 'Volvo',
  'saab': 'Saab',
  'subaru': 'Subaru',
  'mazda': 'Mazda',
  'mitsubishi': 'Mitsubishi',
  'hyundai': 'Hyundai',
  'kia': 'Kia',
  'lexus': 'Lexus',
  'infiniti': 'Infiniti',
  'acura': 'Acura',
  'genesis': 'Genesis',
  'lincoln': 'Lincoln',
  'cadillac': 'Cadillac',
  'buick': 'Buick',
  'pontiac': 'Pontiac',
  'oldsmobile': 'Oldsmobile',
  'chrysler': 'Chrysler',
  'plymouth': 'Plymouth',
  'ram': 'RAM',
  'tesla': 'Tesla',
  'rivian': 'Rivian',
  'lucid': 'Lucid',
  'polestar': 'Polestar',
  'mini': 'MINI',
  'fiat': 'FIAT',
  'lancia': 'Lancia',
  'triumph': 'Triumph',
  'mg': 'MG',
  'tvr': 'TVR',
  'morgan': 'Morgan',
  'sunbeam': 'Sunbeam',
  'datsun': 'Datsun',
  'shelby': 'Shelby',
  'delorean': 'DeLorean',
  'pantera': 'De Tomaso',
  'studebaker': 'Studebaker',
  'packard': 'Packard',
  'hudson': 'Hudson',
  'nash': 'Nash',
  'willys': 'Willys',
  'international': 'International',
  'international harvester': 'International Harvester',
  'ih': 'International Harvester',
  'scout': 'International Harvester',
  'hummer': 'Hummer',
  'am general': 'AM General',
  'amg general': 'AM General',
};

/** Canonical transmission values */
const TRANSMISSION_MAP: Record<string, string> = {
  'auto': 'Automatic',
  'automatic': 'Automatic',
  'auto transmission': 'Automatic',
  'a/t': 'Automatic',
  'manual': 'Manual',
  'stick': 'Manual',
  'stick shift': 'Manual',
  'standard': 'Manual',
  'm/t': 'Manual',
  '5-speed': '5-Speed Manual',
  '5 speed': '5-Speed Manual',
  '5-speed manual': '5-Speed Manual',
  '6-speed': '6-Speed Manual',
  '6 speed': '6-Speed Manual',
  '6-speed manual': '6-Speed Manual',
  '4-speed': '4-Speed Manual',
  '4 speed': '4-Speed Manual',
  '4-speed manual': '4-Speed Manual',
  '3-speed': '3-Speed Manual',
  '3 speed': '3-Speed Manual',
  'sequential': 'Sequential',
  'semi-automatic': 'Semi-Automatic',
  'semi automatic': 'Semi-Automatic',
  'pdk': 'PDK',
  'dct': 'DCT',
  'dual clutch': 'DCT',
  'cvt': 'CVT',
};

/** Canonical drivetrain values */
const DRIVETRAIN_MAP: Record<string, string> = {
  'rwd': 'RWD',
  'rear wheel drive': 'RWD',
  'rear-wheel drive': 'RWD',
  'fwd': 'FWD',
  'front wheel drive': 'FWD',
  'front-wheel drive': 'FWD',
  'awd': 'AWD',
  'all wheel drive': 'AWD',
  'all-wheel drive': 'AWD',
  '4wd': '4WD',
  '4x4': '4WD',
  'four wheel drive': '4WD',
  'four-wheel drive': '4WD',
  '2wd': 'RWD',
};

/**
 * Normalize a vehicle make to its canonical form.
 * Returns title-cased make if no alias match is found.
 */
export function normalizeMake(make: string | null | undefined): string | null {
  if (!make || typeof make !== 'string') return null;
  const trimmed = make.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (MAKE_ALIASES[lower]) return MAKE_ALIASES[lower];

  // Title-case fallback: "PORSCHE" → "Porsche", "porsche" → "Porsche"
  return trimmed
    .split(/[\s-]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(trimmed.includes('-') ? '-' : ' ');
}

/** Word-to-number map for transmission parsing */
const WORD_TO_NUM: Record<string, string> = {
  'two': '2', 'three': '3', 'four': '4', 'five': '5',
  'six': '6', 'seven': '7', 'eight': '8', 'nine': '9', 'ten': '10',
};

/**
 * Normalize a transmission value to its canonical form.
 * Handles verbose patterns like "Four-Speed Automatic Transmission" → "4-Speed Automatic"
 */
export function normalizeTransmission(trans: string | null | undefined): string | null {
  if (!trans || typeof trans !== 'string') return null;
  const trimmed = trans.trim();
  if (!trimmed) return null;

  // Exact dict lookup first
  const exact = TRANSMISSION_MAP[trimmed.toLowerCase()];
  if (exact) return exact;

  let result = trimmed;

  // Strip trailing "transmission" / "gearbox" / "transaxle"
  result = result.replace(/\s*(transmission|gearbox|transaxle)\s*$/i, '');

  // Convert word-numbers to digits: "Four-Speed" → "4-Speed"
  result = result.replace(
    /^(two|three|four|five|six|seven|eight|nine|ten)[-\s]*/i,
    (_, word) => (WORD_TO_NUM[word.toLowerCase()] || word) + '-'
  );

  // Normalize "N speed" → "N-Speed"
  result = result.replace(/^(\d+)\s*[-\s]\s*speed/i, '$1-Speed');

  // Capitalize auto/manual after speed count
  result = result.replace(/(\d-Speed\s+)(automatic|auto)/i, '$1Automatic');
  result = result.replace(/(\d-Speed\s+)(manual)/i, '$1Manual');
  result = result.replace(/(\d-Speed\s+)(sequential)/i, '$1Sequential');

  // Final trim and check exact map again after normalization
  result = result.trim();
  const postNorm = TRANSMISSION_MAP[result.toLowerCase()];
  if (postNorm) return postNorm;

  return result;
}

/**
 * Normalize a drivetrain value to its canonical form.
 */
export function normalizeDrivetrain(dt: string | null | undefined): string | null {
  if (!dt || typeof dt !== 'string') return null;
  const trimmed = dt.trim();
  if (!trimmed) return null;
  return DRIVETRAIN_MAP[trimmed.toLowerCase()] || trimmed;
}

/**
 * Normalize a VIN: uppercase, trim, validate length.
 * Returns null for invalid/placeholder VINs.
 */
export function normalizeVin(vin: string | null | undefined): string | null {
  if (!vin || typeof vin !== 'string') return null;
  const cleaned = vin.trim().toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
  // VINs are 17 chars for modern, 6-13 for classics
  if (cleaned.length < 6 || cleaned.length > 17) return null;
  // Reject obvious placeholders
  if (/^[0]+$/.test(cleaned) || /^[X]+$/i.test(cleaned) || cleaned === 'UNKNOWN') return null;
  return cleaned;
}

/**
 * Normalize a year value. Returns null for obviously invalid years.
 */
export function normalizeYear(year: number | string | null | undefined): number | null {
  if (year === null || year === undefined) return null;
  const num = typeof year === 'number' ? year : parseInt(String(year), 10);
  if (!Number.isFinite(num)) return null;
  // First automobile was 1885 (Benz Patent-Motorwagen). Allow +2 for pre-production models.
  const currentYear = new Date().getFullYear();
  if (num < 1885 || num > currentYear + 2) return null;
  return num;
}

/** Auction metadata patterns that indicate a polluted field */
const AUCTION_JUNK_PATTERNS = [
  /for sale on/i,
  /bring a trailer/i,
  /sold for \$/i,
  /lot\s*#/i,
  /barrett[\s-]*jackson/i,
  /mecum/i,
  /\|/,
  /\(lot\b/i,
];

/**
 * Normalize a trim value. Nulls out listing titles stuffed into trim field.
 */
export function normalizeTrim(trim: string | null | undefined): string | null {
  if (!trim || typeof trim !== 'string') return null;
  const trimmed = trim.trim();
  if (!trimmed) return null;

  // Reject if too long (likely a listing title)
  if (trimmed.length > 80) return null;

  // Reject if contains auction metadata
  if (AUCTION_JUNK_PATTERNS.some(p => p.test(trimmed))) return null;

  return trimmed;
}

/** Canonical body style values */
const CANONICAL_BODY_STYLES = new Set([
  'coupe', 'sedan', 'convertible', 'wagon', 'hatchback', 'suv',
  'pickup', 'van', 'roadster', 'targa', 'fastback', 'minivan',
  'limousine', 'cab & chassis', 'suburban', 'truck', 'cabriolet',
  'shooting brake', 'hardtop', 'bus',
]);

/** Display form of body styles */
const BODY_STYLE_DISPLAY: Record<string, string> = {
  'coupe': 'Coupe', 'sedan': 'Sedan', 'convertible': 'Convertible',
  'wagon': 'Wagon', 'hatchback': 'Hatchback', 'suv': 'SUV',
  'pickup': 'Pickup', 'van': 'Van', 'roadster': 'Roadster',
  'targa': 'Targa', 'fastback': 'Fastback', 'minivan': 'Minivan',
  'limousine': 'Limousine', 'cab & chassis': 'Cab & Chassis',
  'suburban': 'Suburban', 'truck': 'Truck', 'cabriolet': 'Cabriolet',
  'shooting brake': 'Shooting Brake', 'hardtop': 'Hardtop', 'bus': 'Bus',
};

/** Values that should be nulled out */
const BODY_STYLE_NULLS = new Set(['n/a', 'n/a', 'none', 'other', 'unknown', 'custom', '--', '-']);

/**
 * Normalize a body_style value against canonical list.
 * Returns null for garbage, moves RPO codes to a returned sidecar.
 */
export function normalizeBodyStyle(bodyStyle: string | null | undefined): { body_style: string | null; rpo_code?: string } {
  if (!bodyStyle || typeof bodyStyle !== 'string') return { body_style: null };
  const trimmed = bodyStyle.trim();
  if (!trimmed) return { body_style: null };

  let lower = trimmed.toLowerCase();

  // Null out known garbage values
  if (BODY_STYLE_NULLS.has(lower)) return { body_style: null };

  // Map Spider/Spyder → Convertible
  if (lower === 'spider' || lower === 'spyder') return { body_style: 'Convertible' };

  // Check direct canonical match first
  if (CANONICAL_BODY_STYLES.has(lower)) {
    return { body_style: BODY_STYLE_DISPLAY[lower] || trimmed };
  }

  // Strip slash alternatives: "Convertible/Cabriolet" → "Convertible", "Sedan/Saloon" → "Sedan"
  if (lower.includes('/')) {
    const firstPart = lower.split('/')[0].trim();
    if (CANONICAL_BODY_STYLES.has(firstPart)) {
      return { body_style: BODY_STYLE_DISPLAY[firstPart] || firstPart };
    }
  }

  // Strip prefixes and re-match
  let stripped = lower;
  // "Custom 2 Door Coupe" → "2 Door Coupe" → "Coupe"
  stripped = stripped.replace(/^custom\s+/i, '');
  // "2 Door Coupe" / "4 Door Sedan" / "2-door Sedan"
  stripped = stripped.replace(/^\d\s*-?\s*door\s+/i, '');
  // "Station Wagon" → "Wagon"
  stripped = stripped.replace(/^station\s+/i, '');
  // "Sport Utility Vehicle..." → try SUV
  stripped = stripped.replace(/^sport\s+utility.*$/i, 'suv');
  // Retry after stripping "Custom" again (handles "Custom 2 Door" → "2 Door" → stripped again)
  stripped = stripped.replace(/^custom\s+/i, '');
  stripped = stripped.replace(/^\d\s*-?\s*door\s+/i, '');
  stripped = stripped.trim();

  if (stripped && CANONICAL_BODY_STYLES.has(stripped)) {
    return { body_style: BODY_STYLE_DISPLAY[stripped] || stripped };
  }

  // Check if stripped contains a canonical style as a substring
  for (const canonical of CANONICAL_BODY_STYLES) {
    if (stripped.includes(canonical)) {
      return { body_style: BODY_STYLE_DISPLAY[canonical] || canonical };
    }
  }

  // Also check original lower for substring match (e.g. "Woody Wagon" → "Wagon")
  if (stripped !== lower) {
    for (const canonical of CANONICAL_BODY_STYLES) {
      if (lower.includes(canonical)) {
        return { body_style: BODY_STYLE_DISPLAY[canonical] || canonical };
      }
    }
  }

  // RPO code pattern (2-3 uppercase letters + optional numbers, like "L79", "Z28")
  const rpoMatch = trimmed.match(/^([A-Z]{2,3}\d{1,3})$/);
  if (rpoMatch) {
    return { body_style: null, rpo_code: rpoMatch[1] };
  }

  // Too long or too many words → garbage
  if (trimmed.length > 60 || trimmed.split(/\s+/).length > 6) return { body_style: null };

  // Pass through short, reasonable values
  return { body_style: trimmed };
}

/**
 * Normalize a model value. Nulls out listing titles stuffed into model field.
 */
export function normalizeModel(model: string | null | undefined): string | null {
  if (!model || typeof model !== 'string') return null;
  const trimmed = model.trim();
  if (!trimmed) return null;

  // Reject if too long
  if (trimmed.length > 80) return null;

  // Reject if contains auction metadata
  if (AUCTION_JUNK_PATTERNS.some(p => p.test(trimmed))) return null;

  return trimmed;
}

/** Common color words for extraction from verbose descriptions */
const COLOR_WORDS = new Set([
  'black', 'white', 'red', 'blue', 'green', 'silver', 'gray', 'grey',
  'gold', 'yellow', 'orange', 'brown', 'tan', 'beige', 'cream', 'ivory',
  'burgundy', 'maroon', 'navy', 'charcoal', 'pewter', 'bronze',
  'champagne', 'copper', 'platinum', 'sand', 'saddle', 'camel',
  'cognac', 'parchment', 'palomino', 'biscuit', 'cashmere',
]);

/**
 * Normalize a color value (interior or exterior).
 * Strips HTML, extracts color from verbose descriptions.
 */
export function normalizeColor(color: string | null | undefined): string | null {
  if (!color || typeof color !== 'string') return null;

  // Strip HTML tags
  let cleaned = color.replace(/<[^>]+>/g, '').trim();
  if (!cleaned) return null;

  // Reject if contains pricing or auction metadata
  if (/\$\d|sold for|for sale|bring a trailer/i.test(cleaned)) return null;

  // If short enough, keep as-is
  if (cleaned.length <= 60) return cleaned;

  // Try to extract color from verbose description
  // Truncate at first comma, parenthesis, semicolon, or "with"
  const truncated = cleaned.split(/[,(;]|\bwith\b/i)[0].trim();
  if (truncated.length <= 60 && truncated.length > 0) return truncated;

  // Try to find a recognizable color word
  const lowerCleaned = cleaned.toLowerCase();
  for (const cw of COLOR_WORDS) {
    const idx = lowerCleaned.indexOf(cw);
    if (idx !== -1) {
      // Return the color word with original casing
      return cleaned.substring(idx, idx + cw.length).charAt(0).toUpperCase() +
             cleaned.substring(idx + 1, idx + cw.length);
    }
  }

  // Last resort: first 60 chars
  return cleaned.slice(0, 60);
}

/**
 * Normalize common vehicle fields in-place.
 * Call this before writing to the vehicles table from any extractor.
 */
export function normalizeVehicleFields(data: Record<string, any>): Record<string, any> {
  if (data.make) data.make = normalizeMake(data.make);
  if (data.model !== undefined) data.model = normalizeModel(data.model);
  if (data.vin) data.vin = normalizeVin(data.vin);
  if (data.year) data.year = normalizeYear(data.year);
  if (data.transmission) data.transmission = normalizeTransmission(data.transmission);
  if (data.drivetrain) data.drivetrain = normalizeDrivetrain(data.drivetrain);
  if (data.trim !== undefined) data.trim = normalizeTrim(data.trim);

  // Body style normalization — may extract RPO code into trim
  if (data.body_style !== undefined) {
    const { body_style, rpo_code } = normalizeBodyStyle(data.body_style);
    data.body_style = body_style;
    if (rpo_code && !data.trim) {
      data.trim = rpo_code;
    }
  }

  // Color normalization
  if (data.exterior_color !== undefined) {
    data.exterior_color = normalizeColor(data.exterior_color);
  }
  if (data.interior_color !== undefined) {
    data.interior_color = normalizeColor(data.interior_color);
  }
  if (data.color !== undefined) {
    data.color = normalizeColor(data.color);
  }

  // Source normalization — resolve to canonical platform slug
  for (const field of ['source', 'listing_source', 'discovery_source', 'auction_source'] as const) {
    if (data[field]) {
      data[field] = normalizeSource(data[field]);
    }
  }

  return data;
}

/** Canonical source platform aliases. Maps raw values → canonical slugs matching source_alias_mapping table. */
const SOURCE_ALIASES: Record<string, string> = {
  // BaT
  'bat': 'bat',
  'bat_simple_extract': 'bat',
  'bat_core': 'bat',
  'bring a trailer': 'bat',
  'bringatrailer': 'bat',
  'bat_listing': 'bat',
  'bat_profile_extraction': 'bat',
  'bat_import': 'bat',
  'bat-extract:2.0.0': 'bat',
  'bring a trailer_agent_extraction': 'bat',
  'bat_seller_monitor': 'bat',

  // Mecum
  'mecum': 'mecum',
  'mecum-checkpoint-discover': 'mecum',
  'mecum-fast-discover': 'mecum',
  'mecum auctions': 'mecum',
  'mecum auctions_agent_extraction': 'mecum',

  // Cars & Bids
  'cars_and_bids': 'cars-and-bids',
  'carsandbids': 'cars-and-bids',
  'extract-cars-and-bids-core': 'cars-and-bids',
  'cab-fast-discover': 'cars-and-bids',
  'cab-local-extract': 'cars-and-bids',
  'cars & bids': 'cars-and-bids',
  'cars & bids_agent_extraction': 'cars-and-bids',
  'extract-cab-vehicles-pw': 'cars-and-bids',

  // Barrett-Jackson
  'barrett-jackson': 'barrett-jackson',
  'barrett-jackson_agent_extraction': 'barrett-jackson',

  // Gooding
  'gooding': 'gooding',
  'gooding_extract': 'gooding',

  // PCarMarket
  'pcarmarket': 'pcarmarket',
  'PCARMARKET': 'pcarmarket',
  'import-pcarmarket-listing': 'pcarmarket',
  'pcarmarket-fast-discover': 'pcarmarket',

  // Facebook Marketplace
  'facebook_marketplace': 'facebook-marketplace',
  'facebook-marketplace': 'facebook-marketplace',

  // Facebook Saved Items
  'facebook-saved': 'facebook-saved',
  'facebook_saved': 'facebook-saved',
  'facebook_saved_items': 'facebook-saved',

  // Bonhams
  'bonhams': 'bonhams',
  'bh_auction': 'bonhams',

  // RM Sotheby's
  'rm-sothebys': 'rm-sothebys',
  'rmsothebys': 'rm-sothebys',

  // Broad Arrow
  'broad_arrow': 'broad-arrow',
  'broadarrow': 'broad-arrow',
  'broadarrowauctions': 'broad-arrow',
  'broad arrow auctions': 'broad-arrow',

  // Craigslist
  'craigslist': 'craigslist',
  'craigslist_scrape': 'craigslist',

  // Collecting Cars
  'collecting_cars': 'collecting-cars',

  // GAA Classic Cars
  'gaa-classic-cars': 'gaa-classic-cars',
  'gaa_classic_cars': 'gaa-classic-cars',

  // Classic.com
  'classic-com': 'classic-com',
  'CLASSIC_COM_AUCTION': 'classic-com',
  'www.classic.com': 'classic-com',

  // ClassicCars.com
  'ClassicCars.com': 'classiccars-com',
  'classiccars_com': 'classiccars-com',

  // SBX Cars
  'sbx-cars': 'sbx-cars',
  'sbxcars': 'sbx-cars',

  // Hagerty
  'hagerty': 'hagerty',
  'hagerty_extract': 'hagerty',
  'hagerty-fast-discover': 'hagerty',

  // Hemmings
  'hemmings': 'hemmings',
  'hemmings-fast-discover': 'hemmings',

  // eBay
  'ebay': 'ebay',
  'ebay_motors_extract': 'ebay',
  'ebay-motors': 'ebay',

  // KSL
  'ksl': 'ksl',
  'ksl_automated_import': 'ksl',

  // TBTFW
  'TBTFW': 'tbtfw',
  'tbtfw.com': 'tbtfw',

  // User submission
  'user-submission': 'user-submission',
  'user_import': 'user-submission',
  'owner_import': 'user-submission',
  'owner': 'user-submission',
  'manual': 'user-submission',

  // Deal jacket OCR
  'deal_jacket_ocr': 'deal-jacket-ocr',
};

/**
 * Normalize a source string to its canonical platform slug.
 * Mirrors the SQL resolve_platform_slug() function.
 */
export function normalizeSource(source: string | null | undefined): string | null {
  if (!source || typeof source !== 'string') return null;
  const trimmed = source.trim();
  if (!trimmed) return null;

  // Direct lookup
  if (SOURCE_ALIASES[trimmed]) return SOURCE_ALIASES[trimmed];

  // Case-insensitive lookup
  const lower = trimmed.toLowerCase();
  for (const [key, val] of Object.entries(SOURCE_ALIASES)) {
    if (key.toLowerCase() === lower) return val;
  }

  // Fallback: basic slug normalization (matches SQL function behavior)
  return lower.replace(/[_\s]+/g, '-').replace(/[^a-z0-9-]/g, '');
}
