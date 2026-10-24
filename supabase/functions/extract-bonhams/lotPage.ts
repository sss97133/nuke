import { extractOdometerFromText } from "../_shared/odometerText.ts";
import { toMiles } from "../_shared/odometer.ts";
// A Bonhams lot page, read for what the search index does not carry: the whole photo gallery at full size, the sale's
// name, venue and dates, the saleroom notices, the footnotes, the 100-point Seller's Assessment (Bonhams MPH) and the
// condition-report / catalogue links. The page is a Next.js shell whose __NEXT_DATA__ holds the lot and its auction;
// nothing is rendered. Pure functions, tested in lotPage.test.ts and vehicleFacets.test.ts.
import { htmlToText } from '../_shared/htmlToText.ts';
import { extractGeneralBodyStyle, extractVehicleFacets } from '../_shared/vehicleFacets.ts';
import { normalizeVehicleFields } from '../_shared/normalizeVehicle.ts';

export const EXTRACTOR_VERSION = 'bonhams-v3';

export const KNOWN_MAKES = [
  'Alfa Romeo', 'Aston Martin', 'Austin-Healey', 'Mercedes-Benz', 'Rolls-Royce',
  'Land Rover', 'De Tomaso', 'Facel Vega', 'Hispano-Suiza', 'Brough Superior',
  'Pierce-Arrow', 'Harley-Davidson', 'Porsche', 'Ferrari', 'Lamborghini',
  'Bugatti', 'McLaren', 'Maserati', 'Bentley', 'Jaguar', 'BMW', 'Audi',
  'Ford', 'Chevrolet', 'Dodge', 'Plymouth', 'Pontiac', 'Cadillac', 'Lincoln',
  'Chrysler', 'Shelby', 'AC', 'Lancia', 'Iso', 'Bizzarrini', 'Delahaye',
  'Delage', 'Duesenberg', 'Packard', 'Stutz', 'Cord', 'Auburn', 'Tucker',
  'Indian', 'Vincent', 'Norton', 'Triumph', 'MG', 'Lotus', 'TVR', 'Jensen',
  'Sunbeam', 'Riley', 'Alvis', 'Lagonda', 'Singer', 'Standard', 'Wolseley',
  'Humber', 'Vauxhall', 'Rover', 'Daimler', 'Armstrong Siddeley', 'Bristol',
  'Frazer Nash', 'HRG', 'Lea-Francis', 'Morgan', 'Talbot', 'Invicta',
  'Fiat', 'Lola', 'March', 'Brabham', 'Cooper', 'BRM', 'ERA', 'Connaught',
  'Toyota', 'Honda', 'Nissan', 'Mazda', 'Subaru', 'Mitsubishi', 'Datsun',
  'Volkswagen', 'Opel', 'Peugeot', 'Citroen', 'Renault', 'Volvo', 'Saab',
  'Koenigsegg', 'Pagani', 'Rimac', 'Tesla', 'Rivian',
];

export interface ParsedTitle {
  year: number | null;
  make: string | null;
  model: string | null;
  series: string | null;
  trim: string | null;
  body_style: string | null;
  vin: string | null;
  chassis: string | null;
  cleanTitle: string;
}

export function parseBonhamsName(name: string): ParsedTitle {
  let cleanTitle = name.trim();
  let vin: string | null = null;
  let chassis: string | null = null;

  // Extract VIN from "VIN. XXXXX" or "VIN: XXXXX" in name
  const vinInName = cleanTitle.match(/VIN[.:]\s*([A-HJ-NPR-Z0-9]{17})/i);
  if (vinInName) {
    vin = vinInName[1].toUpperCase();
    cleanTitle = cleanTitle.replace(vinInName[0], '').trim();
  }

  // Extract chassis from "Chassis no. XXXXX" or "Chassis no XXXXX"
  const chassisInName = cleanTitle.match(/(?:chassis|frame)\s*no\.?\s*([A-Z0-9\-\/]{3,25})/i);
  if (chassisInName) {
    chassis = chassisInName[1].toUpperCase();
    cleanTitle = cleanTitle.slice(0, cleanTitle.indexOf(chassisInName[0])).trim();
  }

  // Extract engine no. to clean title further
  const engineInName = cleanTitle.match(/engine\s*no\.?\s*[A-Z0-9\-\/]+/i);
  if (engineInName) {
    cleanTitle = cleanTitle.slice(0, cleanTitle.indexOf(engineInName[0])).trim();
  }

  // Strip "Coachwork by ..." (common in Bonhams titles for coachbuilt cars)
  const coachworkInName = cleanTitle.match(/\s+coachwork\s+by\s+.*/i);
  if (coachworkInName) {
    cleanTitle = cleanTitle.slice(0, cleanTitle.indexOf(coachworkInName[0])).trim();
  }

  // Strip "Registration no. ..."
  const regInName = cleanTitle.match(/\s+registration\s+no\.?\s*.*/i);
  if (regInName) {
    cleanTitle = cleanTitle.slice(0, cleanTitle.indexOf(regInName[0])).trim();
  }

  // Strip "Serial no. ..." or "Body no. ..."
  const serialInName = cleanTitle.match(/\s+(?:serial|body)\s+no\.?\s*.*/i);
  if (serialInName) {
    cleanTitle = cleanTitle.slice(0, cleanTitle.indexOf(serialInName[0])).trim();
  }

  // Extract year (4 digits 1880-2030)
  const yearMatch = cleanTitle.match(/\b(1[89]\d{2}|20[0-3]\d)\b/);
  const year = yearMatch ? parseInt(yearMatch[0], 10) : null;

  // Parse make/model from what follows the year
  let make: string | null = null;
  let model: string | null = null;

  if (year) {
    const afterYear = cleanTitle.slice(cleanTitle.indexOf(String(year)) + 4).trim();

    // Try known multi-word makes first
    for (const knownMake of KNOWN_MAKES) {
      if (afterYear.toLowerCase().startsWith(knownMake.toLowerCase())) {
        make = knownMake;
        model = afterYear.slice(knownMake.length).trim() || null;
        break;
      }
    }

    // If no known make found, take first word
    if (!make && afterYear.length > 0) {
      const parts = afterYear.split(/\s+/);
      make = parts[0] || null;
      model = parts.slice(1).join(' ') || null;
    }
  } else {
    // No year — try to parse make/model from full title
    for (const knownMake of KNOWN_MAKES) {
      if (cleanTitle.toLowerCase().includes(knownMake.toLowerCase())) {
        make = knownMake;
        const idx = cleanTitle.toLowerCase().indexOf(knownMake.toLowerCase());
        model = cleanTitle.slice(idx + knownMake.length).trim() || null;
        break;
      }
    }
  }

  // Clean up model: remove trailing noise like "(see text)" or "See footnote"
  if (model) {
    model = model
      .replace(/\s*\(see\s+text\)/i, '')
      .replace(/\s*see\s+(?:text|footnote)\s*$/i, '')
      .trim();
    if (!model) model = null;
  }

  const facets = extractVehicleFacets({
    year,
    make,
    model,
    title: cleanTitle,
  });

  return {
    year,
    make,
    model,
    series: facets.series_code,
    trim: facets.trim_package,
    body_style: facets.body_style_facet,
    vin,
    chassis,
    cleanTitle,
  };
}

export function extractSpecsFromContent(text: string): {
  mileage: number | null;
  engine: string | null;
  transmission: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  body_style: string | null;
} {
  let mileage: number | null = null;
  let engine: string | null = null;
  let transmission: string | null = null;
  let exterior_color: string | null = null;
  let interior_color: string | null = null;
  let body_style: string | null = null;

  // Mileage: odometer context required (see _shared/odometerText.ts); stored in miles.
  const od = extractOdometerFromText(text);
  if (od) mileage = toMiles(od);

  // Engine from description (first line often has "XXXci OHV V8" or "X.XL Turbo")
  const enginePatterns = [
    /(\d+(?:\.\d+)?)\s*(?:cu\.?\s*in\.?|ci)\s+(?:OHV\s+)?(?:V\d+|[Ii]nline[-\s]?\d|[Ff]lat[-\s]?\d|[Ss]traight[-\s]?\d)/i,
    /(\d+(?:\.\d+)?)\s*(?:liter|litre|L)\s+(?:[A-Za-z0-9\-]+\s+)?(?:V\d+|[Ii]nline[-\s]?\d|[Ff]lat[-\s]?\d)/i,
    /(\d+(?:\.\d+)?)\s*(?:cc)\s+(?:[A-Za-z0-9\-]+\s+)?(?:engine)/i,
    /(\d+(?:\.\d+)?)\s*(?:liter|litre|L)\s+([A-Za-z0-9\-\s]+?)\s+engine/i,
  ];
  for (const p of enginePatterns) {
    const m = text.match(p);
    if (m) {
      engine = m[0].trim().slice(0, 80);
      break;
    }
  }

  // Transmission
  const transPatterns = [
    /(\d+)[- ]speed\s+(manual|automatic|PDK|DSG|sequential|gearbox|transaxle)/i,
    /(manual|automatic)\s+(transmission|transaxle|gearbox)/i,
  ];
  for (const p of transPatterns) {
    const m = text.match(p);
    if (m) { transmission = m[0].trim().slice(0, 60); break; }
  }

  // Exterior color — be careful not to match words like "and", "with", "equipped" as part of color
  const stopWords = /\b(and|with|equipped|the|was|has|is|are|were|over|on|in|for|by|at|of|a|an)\b/i;
  const colorPatterns = [
    /refinished in[^.]*?(?:colors? of|iconic colors? of)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/i,
    /finished in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    /(?:painted|repainted|color|colour)[^.]{0,20}?:\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
  ];
  for (const p of colorPatterns) {
    const m = text.match(p);
    if (m && m[1]) {
      let color = m[1].trim();
      const stopMatch = color.match(stopWords);
      if (stopMatch && stopMatch.index && stopMatch.index > 0) {
        color = color.slice(0, stopMatch.index).trim();
      }
      if (color.length >= 3 && color.length <= 40 && !stopWords.test(color)) {
        exterior_color = color;
        break;
      }
    }
  }

  // Interior color
  const intPatterns = [
    /interior[^.]*?(?:in|of|with)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:leather|vinyl|cloth|hide)/i,
    /upholstered in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    /([A-Z][a-z]+)\s+(?:leather|vinyl|cloth|hide)\s+(?:interior|upholstery|seats)/i,
  ];
  for (const p of intPatterns) {
    const m = text.match(p);
    if (m && m[1]) {
      const color = m[1].trim();
      if (color.length <= 40) { interior_color = color; break; }
    }
  }

  // Body style from title/description using shared collector body-style rules
  // (checks "Drophead Coupé" / "Shooting Brake" / "Fixed-Head Coupé" before generic "Coupe")
  body_style = extractGeneralBodyStyle(text);

  return { mileage, engine, transmission, exterior_color, interior_color, body_style };
}

export interface ExtractionResult {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  series?: string | null;
  trim?: string | null;
  vin: string | null;
  chassis_number: string | null;
  mileage: number | null;
  engine: string | null;
  transmission: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  body_style: string | null;
  description: string | null;
  sale_price: number | null;
  price_currency: string | null;
  auction_status: string | null;
  lot_number: string | null;
  sale_id: string | null;
  sale_name: string | null;
  sale_date: string | null;
  sale_location: string | null;
  estimate_low: number | null;
  estimate_high: number | null;
  estimate_currency: string | null;
  image_urls: string[];
  fetch_source: string;
  cost_cents: number;
  /** Set by the Typesense lander: the lot's own key (auctionId-lotId) and the retained source document. */
  event_key?: string;
  hammer_price?: number | null;
  hammer_premium?: number | null;
  raw_document?: unknown;
  /** Typesense page this lot came from; the lander's cursor reads it back from vehicle_events.metadata.ts_page. */
  ts_page?: number;
  /** No chassis/frame/VIN line and no year in the title: the lot is an item, not a vehicle (set by the Typesense lander). */
  non_vehicle_item?: boolean;
  /** Calendar and depth keys merged into the event metadata (session days, sale key, engine/registration numbers). */
  extra_metadata?: Record<string, unknown>;
}

export function buildVehicleRecord(extracted: ExtractionResult): Record<string, any> {
  const facets = extractVehicleFacets({
    year: extracted.year,
    make: extracted.make,
    model: extracted.model,
    title: extracted.title,
    url: extracted.url,
    description: extracted.description,
    seriesHint: extracted.series ?? null,
    trimHint: extracted.trim ?? null,
    bodyStyleHint: extracted.body_style ?? null,
  });
  const normalized = normalizeVehicleFields({
    year: extracted.year,
    make: extracted.make,
    model: extracted.model,
    body_style: extracted.body_style ?? facets.body_style_facet,
  });
  const resolvedSeries = extracted.series ?? facets.series_code ?? null;
  const resolvedTrim = extracted.trim ?? facets.trim_package ?? null;
  const resolvedBodyStyle = normalized.body_style ?? extracted.body_style ?? facets.body_style_facet ?? null;

  return {
    year: extracted.year,
    make: extracted.make?.toLowerCase() || null,
    model: extracted.model?.toLowerCase() || null,
    series: resolvedSeries,
    trim: resolvedTrim,
    // Store chassis in VIN field for vintage vehicles if no modern VIN
    vin: extracted.vin
      ? extracted.vin.toUpperCase()
      : (extracted.chassis_number ? extracted.chassis_number.toUpperCase() : null),
    mileage: extracted.mileage,
    color: extracted.exterior_color,
    interior_color: extracted.interior_color,
    transmission: extracted.transmission,
    engine_type: extracted.engine,
    body_style: resolvedBodyStyle,
    description: extracted.description,
    sale_price: extracted.sale_price,
    sale_date: extracted.sale_date,
    sale_status: extracted.auction_status === 'sold' ? 'sold'
      : extracted.auction_status === 'upcoming' ? 'available'
      : extracted.auction_status === 'unsold' ? 'not_sold'
      : extracted.auction_status === 'withdrawn' ? 'ended'
      : 'ended',
    auction_end_date: extracted.sale_date,
    auction_outcome: extracted.auction_status === 'sold'
      ? 'sold'
      : extracted.auction_status === 'unsold' ? 'reserve_not_met' : null,
    listing_url: extracted.url,
    discovery_url: extracted.url,
    discovery_source: 'bonhams',
    profile_origin: 'bonhams_import',
    is_public: true,
    status: 'active',
    extractor_version: EXTRACTOR_VERSION,
    origin_metadata: {
      source: 'bonhams_import',
      lot_number: extracted.lot_number,
      sale_id: extracted.sale_id,
      sale_name: extracted.sale_name,
      sale_location: extracted.sale_location,
      chassis_number: extracted.chassis_number,
      estimate_low: extracted.estimate_low,
      estimate_high: extracted.estimate_high,
      estimate_currency: extracted.estimate_currency,
      price_currency: extracted.price_currency,
      ...(resolvedSeries ? { series: resolvedSeries } : {}),
      ...(resolvedTrim ? { trim: resolvedTrim } : {}),
      ...(resolvedBodyStyle ? { body_style: resolvedBodyStyle } : {}),
      imported_at: new Date().toISOString(),
    },
  };
}

export interface SellerAssessmentCategory {
  score: number;
  max: number;
  items: Record<string, number>;
}

export interface SellerAssessment {
  vendor_score_total: number;
  vendor_score_max: number;
  summary_label?: string | null;
  categories: {
    exterior?: SellerAssessmentCategory;
    running_gear?: SellerAssessmentCategory;
    interior?: SellerAssessmentCategory;
    electrical?: SellerAssessmentCategory;
    engine?: SellerAssessmentCategory;
  };
  history_file?: {
    score: number;
    max: number;
  };
}

export interface LotPage {
  images: Array<{ url: string; primary: boolean }>;
  catalog_text: string | null;
  footnotes: string | null;
  saleroom_notices: string | null;
  seller_assessment: SellerAssessment | null;
  highlights: string[];
  chassis: string | null;
  engine_number: string | null;
  registration: string | null;
  sale_name: string | null;
  sale_venue: string | null;
  sale_starts_on: string | null;
  sale_ends_on: string | null;
  number_of_lots: number | null;
  condition_report_url: string | null;
  catalogue_pdf_url: string | null;
  hammer_price: number | null;
  hammer_premium: number | null;
  estimate_low: number | null;
  estimate_high: number | null;
  currency: string | null;
  without_reserve: boolean | null;
  lot_number: string | null;
  sale_id: string | null;
  lot_title: string | null;
  raw: Record<string, unknown>;
}

/**
 * Parse Bonhams MPH 100-point Seller's Assessment from footnotes text or HTML.
 * Example header: "Vendor Score Total: 20/100" (or "Vendor Score Total: 32/100 - Project").
 * Categories: EXTERIOR TOTAL (x/25), RUNNING GEAR TOTAL (x/20), INTERIOR TOTAL (x/20),
 * ELECTRICAL TOTAL (x/10), ENGINE TOTAL (x/20), Car History File: x (or x/5).
 */
export function parseSellerAssessment(rawText: string | null | undefined): SellerAssessment | null {
  if (!rawText || typeof rawText !== 'string') return null;
  const text = rawText.includes('<') ? htmlToText(rawText) : rawText;
  const headerMatch = text.match(/Vendor\s+Score\s+Total\s*:\s*(\d{1,3})\s*\/\s*(\d{1,3})(?:\s*[-–—]\s*([^\n\r]+))?/i);
  if (!headerMatch) return null;

  const vendorScoreTotal = parseInt(headerMatch[1], 10);
  const vendorScoreMax = parseInt(headerMatch[2], 10) || 100;
  if (!Number.isFinite(vendorScoreTotal) || vendorScoreTotal < 0 || vendorScoreTotal > vendorScoreMax) return null;

  const summaryLabel = headerMatch[3]?.trim() || null;

  const categoryDefs: Array<{
    key: keyof SellerAssessment['categories'];
    headerRe: RegExp;
    defaultMax: number;
    itemPatterns: Array<[string, RegExp]>;
  }> = [
    {
      key: 'exterior',
      headerRe: /EXTERIOR\s+TOTAL\s*:\s*(\d{1,2})\s*\/\s*(\d{1,2})/i,
      defaultMax: 25,
      itemPatterns: [
        ['body_work', /Body\s*Work\s*:\s*(\d)(?:\s*\/\s*5)?/i],
        ['paint', /Paint\s*:\s*(\d)(?:\s*\/\s*5)?/i],
        ['glass', /Glass\s*:\s*(\d)(?:\s*\/\s*5)?/i],
        ['chrome_plastics_trim', /Chrome\s*\/\s*Plastics\s*\/\s*Trim\s*:\s*(\d)(?:\s*\/\s*5)?/i],
        ['wheels_tyres', /Wheels\s*\/\s*Tyres\s*:\s*(\d)(?:\s*\/\s*5)?/i],
      ],
    },
    {
      key: 'running_gear',
      headerRe: /RUNNING\s+GEAR\s+TOTAL\s*:\s*(\d{1,2})\s*\/\s*(\d{1,2})/i,
      defaultMax: 20,
      itemPatterns: [
        ['gearbox_clutch', /Gearbox\s*\/\s*Clutch\s*:\s*(\d)(?:\s*\/\s*5)?/i],
        ['axles', /Axles\s*:\s*(\d)(?:\s*\/\s*5)?/i],
        ['suspension', /Suspension\s*:\s*(\d)(?:\s*\/\s*5)?/i],
        ['brakes', /Brakes\s*:\s*(\d)(?:\s*\/\s*5)?/i],
      ],
    },
    {
      key: 'interior',
      headerRe: /INTERIOR\s+TOTAL\s*:\s*(\d{1,2})\s*\/\s*(\d{1,2})/i,
      defaultMax: 20,
      itemPatterns: [
        ['seats', /Seats\s*:\s*(\d)(?:\s*\/\s*5)?/i],
        ['dashboard_door_cards_carpets', /Dashboard\s*\/\s*Door\s*cards\s*\/\s*Carpets\s*:\s*(\d)(?:\s*\/\s*5)?/i],
        ['headlining', /Headlining\s*:\s*(\d)(?:\s*\/\s*5)?/i],
        ['trim', /(?:^|\n)\s*Trim\s*:\s*(\d)(?:\s*\/\s*5)?/i],
      ],
    },
    {
      key: 'electrical',
      headerRe: /ELECTRICAL\s+TOTAL\s*:\s*(\d{1,2})\s*\/\s*(\d{1,2})/i,
      defaultMax: 10,
      itemPatterns: [
        ['main_components', /Main\s+components\s*:\s*(\d)(?:\s*\/\s*5)?/i],
        ['ancillary_components', /Ancillary\s+components\s*:\s*(\d)(?:\s*\/\s*5)?/i],
      ],
    },
    {
      key: 'engine',
      headerRe: /ENGINE\s+TOTAL\s*:\s*(\d{1,2})\s*\/\s*(\d{1,2})/i,
      defaultMax: 20,
      itemPatterns: [
        ['starting', /Starting\s*:\s*(\d)(?:\s*\/\s*5)?/i],
        ['running', /Running\s*:\s*(\d)(?:\s*\/\s*5)?/i],
        ['under_bonnet', /Under\s+Bonnet\s*:\s*(\d)(?:\s*\/\s*5)?/i],
        ['mechanical_components', /Mechanical\s+components\s*:\s*(\d)(?:\s*\/\s*5)?/i],
      ],
    },
  ];

  const categories: SellerAssessment['categories'] = {};
  for (const def of categoryDefs) {
    const m = text.match(def.headerRe);
    const items: Record<string, number> = {};
    for (const [itemKey, re] of def.itemPatterns) {
      const im = text.match(re);
      if (im) {
        const val = parseInt(im[1], 10);
        if (Number.isFinite(val)) items[itemKey] = val;
      }
    }
    if (m || Object.keys(items).length > 0) {
      const score = m ? parseInt(m[1], 10) : Object.values(items).reduce((a, b) => a + b, 0);
      const max = m ? parseInt(m[2], 10) || def.defaultMax : def.defaultMax;
      categories[def.key] = { score, max, items };
    }
  }

  let historyFile: SellerAssessment['history_file'] | undefined;
  const histMatch = text.match(/Car\s+History\s+File\s*:\s*(\d)(?:\s*\/\s*(\d))?/i);
  if (histMatch) {
    const score = parseInt(histMatch[1], 10);
    const max = histMatch[2] ? parseInt(histMatch[2], 10) : 5;
    if (Number.isFinite(score)) historyFile = { score, max };
  }

  return {
    vendor_score_total: vendorScoreTotal,
    vendor_score_max: vendorScoreMax,
    ...(summaryLabel ? { summary_label: summaryLabel } : {}),
    categories,
    ...(historyFile ? { history_file: historyFile } : {}),
  };
}

/**
 * Extract bullet highlights from Bonhams catalogDesc HTML or plain text.
 * Bonhams frequently starts LotDesc with `• Point 1<br />• Point 2` or `*Point 1<br />*Point 2`.
 */
export function extractBonhamsHighlights(catalogHtmlOrText: string | null | undefined): string[] {
  if (!catalogHtmlOrText) return [];
  const text = catalogHtmlOrText.includes('<') ? htmlToText(catalogHtmlOrText) : catalogHtmlOrText;
  const highlights: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const m = line.match(/^(?:[•●▪]\s*|\*(?=[A-Z0-9'"]))(.{4,160})$/);
    if (m) {
      const clean = m[1].trim().replace(/^[•*-\s]+/, '');
      if (clean && !highlights.includes(clean)) highlights.push(clean);
    }
  }
  return highlights;
}

/**
 * Extract chassis number, engine number, and registration from catalog text + saleroom notices.
 * Handles both formal header lines ("Chassis no. S818529", "Engine no. G7652-8S") and prose
 * saleroom notices ("chassis number stamped on the ... which is 860286, and the engine block number stamping reads KJ2451-8").
 */
export function extractIdentifiersFromText(
  catalogText: string | null | undefined,
  noticesText?: string | null | undefined,
): { chassis: string | null; engine_number: string | null; registration: string | null } {
  const catalog = catalogText ?? '';
  const notices = noticesText ?? '';
  const combined = [catalog, notices].filter(Boolean).join('\n');

  const rejectToken = /^(not|none|unknown|unrecorded|tba|n\/a|na|see|stamped|located|on|in|which|is|reads|the|a|an|and|to|with)$/i;
  const cleanId = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    const token = raw.trim().replace(/^[#:'"“”‘’]+|[.,;:!?'"“”‘’)/-]+$/g, '').trim();
    if (!token || token.length < 2 || token.length > 30) return null;
    if (rejectToken.test(token)) return null;
    if (!/\d/.test(token)) return null; // Vehicle chassis/engine numbers always contain at least one digit
    return token.toUpperCase();
  };

  // 1. Formal "Chassis no. XXXXX" or "Frame no. XXXXX"
  let chassis: string | null = null;
  const formalChassis = combined.match(/(?:Chassis|Frame)\s+no\.?\s*:?\s*([A-Z0-9*][A-Za-z0-9*./-]*(?: [A-Z0-9][A-Za-z0-9*./-]*)?)/i);
  if (formalChassis?.[1]) {
    const firstWord = formalChassis[1].replace(/[./-]+$/, '').split(/\s+/)[0];
    chassis = cleanId(firstWord);
  }
  // 2. Prose saleroom notice patterns: "chassis number ... which is 860286" / "chassis number is XXXXX" / "chassis number reads XXXXX"
  if (!chassis) {
    const proseChassisPatterns = [
      /(?:chassis|frame)\s+(?:number|no\.?)\b[^.\n]{0,80}?\b(?:which\s+is|reads|is|:)\s*['"“”‘’]?([A-Z0-9][A-Z0-9*./-]{2,24})/i,
      /(?:chassis|frame)\s+(?:number|no\.?)\s+(?:stamped\s+|reading\s+)?['"“”‘’]?([A-Z0-9][A-Z0-9*./-]{2,24})/i,
    ];
    for (const re of proseChassisPatterns) {
      const m = combined.match(re);
      const cand = cleanId(m?.[1]);
      if (cand) {
        chassis = cand;
        break;
      }
    }
  }

  // 1. Formal "Engine no. XXXXX"
  let engineNumber: string | null = null;
  const formalEngine = combined.match(/Engine\s+no\.?\s*:?\s*([A-Z0-9*][A-Za-z0-9*./-]*(?: [A-Z0-9][A-Za-z0-9*./-]*)?)/i);
  if (formalEngine?.[1]) {
    const firstWord = formalEngine[1].replace(/[./-]+$/, '').split(/\s+/)[0];
    engineNumber = cleanId(firstWord);
  }
  // 2. Prose saleroom notice patterns: "engine block number stamping reads KJ2451-8" / "engine number is XXXXX"
  if (!engineNumber) {
    const proseEnginePatterns = [
      /engine\s+(?:block\s+)?(?:number|no\.?)\b[^.\n]{0,60}?\b(?:which\s+is|reads|is|:)\s*['"“”‘’]?([A-Z0-9][A-Z0-9*./-]{2,24})/i,
      /engine\s+(?:block\s+)?(?:number|no\.?)\s+(?:stamped\s+|stamping\s+reads\s+|reading\s+)?['"“”‘’]?([A-Z0-9][A-Z0-9*./-]{2,24})/i,
    ];
    for (const re of proseEnginePatterns) {
      const m = combined.match(re);
      const cand = cleanId(m?.[1]);
      if (cand) {
        engineNumber = cand;
        break;
      }
    }
  }

  // Registration no.
  const regRaw = combined.match(/Registration\s+no\.?\s*:?\s*([^\n(]{2,25})/i)?.[1]?.trim() ?? null;
  const registration = regRaw && !/^(not\s+(?:uk\s+)?registered|none|unregistered|n\/a|tba)$/i.test(regRaw)
    ? regRaw
    : null;

  return { chassis, engine_number: engineNumber, registration };
}

/** A page that is not a lot page (a challenge, an error shell) comes back null; the caller must not treat it as data. */
export function parseLotPage(html: string): LotPage | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let data: any;
  try { data = JSON.parse(m[1]); } catch { return null; }
  const lot = data?.props?.pageProps?.lot;
  const auction = data?.props?.pageProps?.auction;
  if (!lot || typeof lot !== 'object' || lot.iSaleLotNoUnique == null) return null;

  // Full size: the image URL with its crop parameters removed is the original (4315 x 2880 on the sampled lot).
  const seen = new Set<string>();
  const images: LotPage['images'] = [];
  for (const img of Array.isArray(lot.images) ? lot.images : []) {
    const raw = typeof img?.image_url === 'string' ? img.image_url : '';
    if (!/^https:\/\/[a-z0-9.-]*bonhams\.com\//i.test(raw)) continue;
    const url = raw.split('&')[0];
    if (seen.has(url)) continue;
    seen.add(url);
    images.push({ url, primary: !!img.lPrimary });
  }

  const catalog = typeof lot.sCatalogDesc === 'string' ? htmlToText(lot.sCatalogDesc) : '';
  const foot = [lot.footnote_sExtraDesc, lot.sExtraDesc]
    .filter((x) => typeof x === 'string' && x.trim())
    .map((x: string) => htmlToText(x))
    .filter(Boolean);
  const footnotesText = foot.length ? foot.join('\n\n') : null;

  // Saleroom notices (lot.notices — e.g. chassis/engine stamping discovered at the venue)
  const noticesRaw = Array.isArray(lot.notices)
    ? lot.notices.map((n: unknown) => typeof n === 'string' ? htmlToText(n) : '').filter(Boolean).join('\n\n')
    : (typeof lot.notices === 'string' && lot.notices.trim() ? htmlToText(lot.notices) : '');
  const saleroomNotices = noticesRaw || null;

  const ids = extractIdentifiersFromText(catalog, saleroomNotices);
  const sellerAssessment = parseSellerAssessment(footnotesText);
  const highlights = extractBonhamsHighlights(lot.sCatalogDesc || catalog);

  const starts: string[] = (auction?.dates?.start ?? []).map((s: any) => String(s?.date?.datetime ?? '').slice(0, 10)).filter(Boolean).sort();
  const end = String(auction?.dates?.end?.datetime ?? lot?.hammerTime?.datetime ?? '').slice(0, 10);
  const num = (v: unknown) => (typeof v === 'number' && v > 0 ? Math.round(v) : null);
  const cond = typeof lot.sCondition === 'string' && /^https:\/\//.test(lot.sCondition) ? lot.sCondition : null;
  const catPdf = typeof auction?.catalogue?.download_path === 'string' && /^https:\/\//.test(auction.catalogue.download_path)
    ? auction.catalogue.download_path
    : null;

  const lotNo = lot.iSaleLotNo != null ? `${lot.iSaleLotNo}${lot.sSaleLotNoA || ''}`.trim() : null;
  const saleId = (auction?.iSaleNo ?? lot.iSaleNo?.iSaleNo) != null ? String(auction?.iSaleNo ?? lot.iSaleNo?.iSaleNo) : null;
  const lotTitle = typeof lot.sDesc === 'string' && lot.sDesc.trim() ? htmlToText(lot.sDesc).trim() : null;

  return {
    images,
    catalog_text: catalog || null,
    footnotes: footnotesText,
    saleroom_notices: saleroomNotices,
    seller_assessment: sellerAssessment,
    highlights,
    chassis: ids.chassis,
    engine_number: ids.engine_number,
    registration: ids.registration,
    sale_name: htmlToText(String(auction?.sSaleName ?? '')) || null,
    sale_venue: htmlToText(String(auction?.sVenue ?? '')) || null,
    sale_starts_on: starts[0] ?? null,
    sale_ends_on: end || starts[starts.length - 1] || null,
    number_of_lots: num(auction?.number_of_lots),
    condition_report_url: cond,
    catalogue_pdf_url: catPdf,
    hammer_price: num(lot.dHammerPrice),
    hammer_premium: num(lot.dHammerPremium),
    estimate_low: num(lot.dEstimateLow),
    estimate_high: num(lot.dEstimateHigh),
    currency: lot.currency?.iso_code ?? null,
    without_reserve: typeof lot.lWithoutReserve === 'boolean' ? lot.lWithoutReserve : null,
    lot_number: lotNo || null,
    sale_id: saleId,
    lot_title: lotTitle,
    // The retained capture: the lot and its auction, without the neighbouring-lot and related-lot lists.
    raw: { lot: { ...lot, prev_next_lot: undefined, relatedLots: undefined }, auction: { ...auction, highlights: undefined, groups: undefined, aggregated: undefined } },
  };
}

/** The lot page as cars.bonhams.com serves it: the same lot, with the whole lot in __NEXT_DATA__ (www.bonhams.com redirects there). */
export function bonhamsLotPageUrl(url: string): string {
  return url.replace(/^https?:\/\/(?:www\.)?bonhams\.com\/auction\//i, 'https://cars.bonhams.com/auction/').replace(/\/?$/, '/');
}

// A model, a toy or a part, whatever year the title carries.
const MODEL_OR_TOY = /\b(?:child'?s|children'?s|pedal\s+car|half[- ]scale|quarter[- ]scale|\d+:\d+\s+scale|scale\s+model|display\s+model|wind\s+tunnel\s+model)\b/i;
// Automobilia: keeps a year-less lot an item even when its title names a body ("a bronze sculpture of a roadster").
const AUTOMOBILIA = /\b(?:sculpture|bronze|mascot|badge|sign|poster|painting|artwork|lithograph|photograph|watch|chronograph|luggage|suitcase|helmet|overalls|race\s+suit|trophy|handbook|brochure|catalogue|tool\s?kit|set\s+of\s+(?:four\s+|five\s+)?wheels|(?:registration|number)\s+(?:mark|plate|number)s?)\b|^\s*(?:the\s+)?registration\b/i;
// Lot-level evidence of a vehicle: an identity line or a Seller's Assessment in the text, or a body or project noun in the title.
const VEHICLE_LINE = /(?:chassis|frame|registration)\s+no\.?|\bVIN[: .]|vendor\s+score\s+total|car\s+history\s+file/i;
const BODY_NOUN = /\b(?:replica|project|roadster|coup[eé]|saloon|sedan|tourer|cabriolet|convertible|limousine|phaeton|berlinetta|spyder|spider|targa|shooting\s+brake|pick-?up|landaul?et|drophead|fixed[- ]head|buggy|cyclecar)\b/i;

/**
 * A Bonhams motor-car sale also sells mascots, handbooks and models; the department is the sale's, so the lot decides.
 * A year-less lot with no identity line was an item (#1693), but "Zealia Engineering D-Type Replica Project" (no year,
 * "Registration no. not registered", chassis in the saleroom notice) was landed as one, so a registration line, a
 * Seller's Assessment or a body noun in the title now also mark a vehicle.
 */
export function isBonhamsNonVehicleLot(lot: { title: string | null; catalogText?: string | null; footnotes?: string | null; year: number | null }): boolean {
  const title = lot.title ?? '';
  if (MODEL_OR_TOY.test(title)) return true;
  if (lot.year != null) return false;
  if (AUTOMOBILIA.test(title)) return true;
  const text = `${title} ${lot.catalogText ?? ''} ${lot.footnotes ?? ''}`;
  return !(VEHICLE_LINE.test(text) || BODY_NOUN.test(title));
}

/** The seller's own 100-point assessment as a vehicle_condition_scores row (tiers on the v1 scale). Self-reported, not verified. */
export function sellerAssessmentConditionScore(a: SellerAssessment): Record<string, unknown> {
  const pct = (score: number, max: number) => (max > 0 ? Math.round((score / max) * 100) : null);
  const total = Math.max(0, Math.min(100, pct(a.vendor_score_total, a.vendor_score_max) ?? 0));
  const { exterior, interior, engine, running_gear, electrical } = a.categories;
  const mech = [engine, running_gear, electrical].filter((c): c is SellerAssessmentCategory => !!c);
  return {
    condition_score: total,
    condition_tier: total >= 80 ? 'excellent' : total >= 65 ? 'good' : total >= 45 ? 'driver' : 'project',
    exterior_score: exterior ? pct(exterior.score, exterior.max) : null,
    interior_score: interior ? pct(interior.score, interior.max) : null,
    mechanical_score: mech.length ? pct(mech.reduce((s, c) => s + c.score, 0), mech.reduce((s, c) => s + c.max, 0)) : null,
    provenance_score: a.history_file ? pct(a.history_file.score, a.history_file.max) : null,
    computation_version: SELLER_ASSESSMENT_VERSION,
    descriptor_summary: { source: 'bonhams_seller_assessment', self_reported: true, ...a },
  };
}

export const SELLER_ASSESSMENT_VERSION = 'bonhams-mph-100pt-v1';

/**
 * A Bonhams "preview-lot" URL (/auction/{sale}/preview-lot/{id}/...) is a showcase card, not a lot of that sale: often a car
 * sold at an earlier sale, shown to promote this one. Its offer carries no hammer (the JSON-LD "price" read 5 and 11 on
 * 2026-10-23) and OutOfStock availability, which the catalog import used to record as a sale.
 */
export function isBonhamsPreviewLotUrl(u: string | null | undefined): boolean {
  return /\/auction\/\d+\/preview-lot\//i.test(u ?? "");
}

/** A catalog offer's result: sold only for a real lot whose offer is OutOfStock; preview cards are never a sale. */
export function catalogOfferIsSold(url: string | null | undefined, availability: string | null | undefined): boolean {
  if (isBonhamsPreviewLotUrl(url)) return false;
  return (availability ?? "").includes("OutOfStock");
}

/** Full chassis/frame number from a Bonhams lot URL slug ("...-chassis-no-wp0zzz93zds000846-engine-no-..."), or null. */
export function chassisFromLotUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let path: string;
  try { path = new URL(url).pathname; } catch { path = url; }
  const slug = path.replace(/\/+$/, "").split("/").pop() ?? "";
  const m = slug.match(/(?:^|-)(?:chassis|frame)-no-([a-z0-9][a-z0-9-]*?)(?:-engine-no-.*)?$/i);
  return m && m[1].replace(/-/g, "").length >= 4 ? m[1].toUpperCase() : null;
}

const alnum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Prefer the URL-slug chassis when the parsed one is missing, looks like a slug fragment, or is a cut-short prefix of it. */
export function pickChassis(parsed: string | null, fromUrl: string | null): string | null {
  if (!fromUrl) return parsed;
  if (!parsed) return fromUrl;
  const p = alnum(parsed.replace(/^-?NO-/i, "")), u = alnum(fromUrl);
  if (/^-/.test(parsed) || /CHASSIS|ENGINE/i.test(parsed)) return fromUrl;
  if (p.length < u.length && u.startsWith(p)) return fromUrl;
  return parsed;
}
