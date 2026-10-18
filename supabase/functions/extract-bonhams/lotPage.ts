// A Bonhams lot page, read for what the search index does not carry: the whole photo gallery at full size, the sale's
// name, venue and dates, the footnotes and the condition-report link. The page is a Next.js shell whose __NEXT_DATA__ holds
// the lot and its auction; nothing is rendered. Pure functions, tested in lotPage.test.ts and vehicleFacets.test.ts.
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

  // Mileage
  const mileagePatterns = [
    /(\d{1,3}(?:,\d{3})*)\s*(?:miles|mi)\b/i,
    /mileage[^:]*:?\s*(\d{1,3}(?:,\d{3})*)/i,
    /odometer[^:]*:?\s*(\d{1,3}(?:,\d{3})*)/i,
    /(\d{1,3}(?:,\d{3})*)\s*km\b/i,
  ];
  for (const p of mileagePatterns) {
    const m = text.match(p);
    if (m) {
      const num = parseInt(m[1].replace(/,/g, ''));
      if (num > 0 && num < 10_000_000) { mileage = num; break; }
    }
  }

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

export interface LotPage {
  images: Array<{ url: string; primary: boolean }>;
  catalog_text: string | null;
  footnotes: string | null;
  chassis: string | null;
  engine_number: string | null;
  registration: string | null;
  sale_name: string | null;
  sale_venue: string | null;
  sale_starts_on: string | null;
  sale_ends_on: string | null;
  number_of_lots: number | null;
  condition_report_url: string | null;
  hammer_price: number | null;
  hammer_premium: number | null;
  currency: string | null;
  without_reserve: boolean | null;
  raw: Record<string, unknown>;
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
  const grab = (label: string) => catalog.match(new RegExp(`${label}\\s*:?\\s*([A-Z0-9*][A-Za-z0-9*./-]*(?: [A-Z0-9][A-Za-z0-9*./-]*)?)`, 'i'))?.[1] ?? null;
  const foot = [lot.footnote_sExtraDesc, lot.sExtraDesc].filter((x) => typeof x === 'string' && x.trim()).map((x: string) => htmlToText(x)).filter(Boolean);

  const starts: string[] = (auction?.dates?.start ?? []).map((s: any) => String(s?.date?.datetime ?? '').slice(0, 10)).filter(Boolean).sort();
  const end = String(auction?.dates?.end?.datetime ?? '').slice(0, 10);
  const num = (v: unknown) => (typeof v === 'number' && v > 0 ? Math.round(v) : null);
  const cond = typeof lot.sCondition === 'string' && /^https:\/\//.test(lot.sCondition) ? lot.sCondition : null;

  return {
    images,
    catalog_text: catalog || null,
    footnotes: foot.length ? foot.join('\n\n') : null,
    chassis: grab('Chassis no\\.?')?.replace(/[./-]+$/, '').toUpperCase().split(' ')[0] ?? null,
    engine_number: grab('Engine no\\.?')?.toUpperCase().split(' ')[0] ?? null,
    registration: catalog.match(/Registration no\.?\s*:?\s*([^\n(]{2,20})/i)?.[1]?.trim() ?? null,
    sale_name: htmlToText(String(auction?.sSaleName ?? '')) || null,
    sale_venue: htmlToText(String(auction?.sVenue ?? '')) || null,
    sale_starts_on: starts[0] ?? null,
    sale_ends_on: end || starts[starts.length - 1] || null,
    number_of_lots: num(auction?.number_of_lots),
    condition_report_url: cond,
    hammer_price: num(lot.dHammerPrice),
    hammer_premium: num(lot.dHammerPremium),
    currency: lot.currency?.iso_code ?? null,
    without_reserve: typeof lot.lWithoutReserve === 'boolean' ? lot.lWithoutReserve : null,
    // The retained capture: the lot and its auction, without the neighbouring-lot and related-lot lists.
    raw: { lot: { ...lot, prev_next_lot: undefined, relatedLots: undefined }, auction: { ...auction, highlights: undefined, groups: undefined, aggregated: undefined } },
  };
}
