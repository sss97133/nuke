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

/**
 * Normalize a transmission value to its canonical form.
 */
export function normalizeTransmission(trans: string | null | undefined): string | null {
  if (!trans || typeof trans !== 'string') return null;
  const trimmed = trans.trim();
  if (!trimmed) return null;
  return TRANSMISSION_MAP[trimmed.toLowerCase()] || trimmed;
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

/**
 * Normalize common vehicle fields in-place.
 * Call this before writing to the vehicles table from any extractor.
 */
export function normalizeVehicleFields(data: Record<string, any>): Record<string, any> {
  if (data.make) data.make = normalizeMake(data.make);
  if (data.model && typeof data.model === 'string') data.model = data.model.trim();
  if (data.vin) data.vin = normalizeVin(data.vin);
  if (data.year) data.year = normalizeYear(data.year);
  if (data.transmission) data.transmission = normalizeTransmission(data.transmission);
  if (data.drivetrain) data.drivetrain = normalizeDrivetrain(data.drivetrain);
  if (data.exterior_color && typeof data.exterior_color === 'string') {
    data.exterior_color = data.exterior_color.trim();
  }
  if (data.interior_color && typeof data.interior_color === 'string') {
    data.interior_color = data.interior_color.trim();
  }
  return data;
}
