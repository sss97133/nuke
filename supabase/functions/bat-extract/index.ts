/**
 * bat-extract - Unified BaT listing extractor
 *
 * Version: 2.0.0
 * - Handles resales (same VIN, different auction) by updating existing vehicle
 * - Creates auction_events for each sale
 * - Detects BaT Alumni status (previously sold on BaT)
 * - Sanitizes control characters from JSON output
 * - Tracks extractor version in database
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { fetchBatPage, logFetchCost, type FetchResult } from '../_shared/batFetcher.ts';
import { normalizeListingUrlKey } from '../_shared/listingUrl.ts';
import { ExtractionLogger, validateVin } from '../_shared/extractionHealth.ts';

// Extractor versioning - update on each significant change
const EXTRACTOR_VERSION = 'bat-extract:2.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BatComment {
  type: 'bid' | 'observation' | 'question' | 'seller_response';
  author_username: string;
  is_seller: boolean;
  posted_at: string | null;
  text: string;
  bid_amount: number | null;
  likes: number;
}

interface BatExtracted {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  location: string | null;
  mileage: number | null;
  exterior_color: string | null;
  interior_color: string | null;
  transmission: string | null;
  drivetrain: string | null;
  engine: string | null;
  body_style: string | null;
  seller_username: string | null;
  buyer_username: string | null;
  sale_price: number | null;
  high_bid: number | null;
  bid_count: number;
  comment_count: number;
  view_count: number;
  watcher_count: number;
  lot_number: string | null;
  reserve_status: string | null;
  auction_end_date: string | null;
  description: string | null;
  vehicle_id?: string;
  image_urls: string[];
  comments: BatComment[];
  is_alumni: boolean;  // Previously sold on BaT
  is_resale: boolean;  // This extraction found existing vehicle
  extractor_version: string;
}

// Sanitize string for JSON - remove control characters that break parsers
function sanitizeForJson(text: string | null): string | null {
  if (!text) return null;
  // Remove control characters (0x00-0x1F) except \n, \r, \t
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

// Non-vehicle listing keywords - these are parts, memorabilia, etc.
const NON_VEHICLE_KEYWORDS = [
  'wheels for', 'wheel for', 'rims for',
  'seats for', 'seat for',
  'engine for', 'motor for',
  'transmission for', 'gearbox for',
  'hardtop for', 'soft top for', 'tonneau',
  'literature', 'manual for', 'brochure',
  'memorabilia', 'sign', 'neon',
  'tool kit', 'toolkit', 'jack',
  'luggage', 'suitcase',
  'helmet', 'racing suit', 'driving shoes',
  'watch', 'chronograph',
  'model car', 'diecast', 'sculpture',
  'poster', 'artwork', 'painting',
  'badge', 'emblem', 'key fob',
  'spare parts', 'nos parts',
];

// Check if this is a vehicle listing vs parts/memorabilia
function isVehicleListing(extracted: { title: string | null; year: number | null; make: string | null; model: string | null }): { isVehicle: boolean; reason?: string } {
  const title = (extracted.title || '').toLowerCase();

  // Check for non-vehicle keywords in title
  for (const keyword of NON_VEHICLE_KEYWORDS) {
    if (title.includes(keyword)) {
      return { isVehicle: false, reason: `Title contains non-vehicle keyword: "${keyword}"` };
    }
  }

  // Must have year to be a vehicle (BaT always has year in vehicle titles)
  if (!extracted.year) {
    // Exception: some vehicles don't have year (customs, kit cars)
    // But they should at least have make AND model
    if (!extracted.make || !extracted.model) {
      return { isVehicle: false, reason: 'No year and missing make/model - likely not a vehicle' };
    }
  }

  // Must have make OR model (some valid listings only have one)
  if (!extracted.make && !extracted.model) {
    return { isVehicle: false, reason: 'No make or model extracted - likely not a vehicle' };
  }

  return { isVehicle: true };
}

// Find existing vehicle by VIN or year/make/model/url
async function findExistingVehicle(
  supabase: any,
  extracted: { vin: string | null; year: number | null; make: string | null; model: string | null; url: string }
): Promise<{ id: string; matchType: 'vin' | 'url' | 'ymm' } | null> {
  // 1. Check by VIN (strongest match) - allow shorter pre-1981 VINs/chassis
  if (extracted.vin && extracted.vin.length >= 6) {
    const { data: vinMatch } = await supabase
      .from('vehicles')
      .select('id')
      .eq('vin', extracted.vin)
      .limit(1)
      .single();

    if (vinMatch) {
      return { id: vinMatch.id, matchType: 'vin' };
    }
  }

  // 2. Check by bat_auction_url (exact same listing)
  const { data: urlMatch } = await supabase
    .from('vehicles')
    .select('id')
    .eq('bat_auction_url', extracted.url)
    .limit(1)
    .single();

  if (urlMatch) {
    return { id: urlMatch.id, matchType: 'url' };
  }

  // 3. Check by year/make/model (fuzzy - only if we have all three)
  // This prevents creating duplicate profiles for the same car
  if (extracted.year && extracted.make && extracted.model) {
    const { data: ymmMatch } = await supabase
      .from('vehicles')
      .select('id, bat_auction_url')
      .eq('year', extracted.year)
      .ilike('make', extracted.make)
      .ilike('model', extracted.model)
      .is('bat_auction_url', null)  // Only match vehicles without BaT URL (user-created)
      .limit(1)
      .single();

    if (ymmMatch) {
      return { id: ymmMatch.id, matchType: 'ymm' };
    }
  }

  return null;
}

// VIN patterns by manufacturer
const VIN_PATTERNS = [
  /\b([1-5][A-HJ-NPR-Z0-9]{16})\b/g,
  /\b(J[A-HJ-NPR-Z0-9]{16})\b/g,
  /\b(K[A-HJ-NPR-Z0-9]{16})\b/g,
  /\b(L[A-HJ-NPR-Z0-9]{16})\b/g,
  /\b(S[A-HJ-NPR-Z0-9]{16})\b/g,
  /\b(W[A-HJ-NPR-Z0-9]{16})\b/g,
  /\b(Y[A-HJ-NPR-Z0-9]{16})\b/g,
  /\b(Z[A-HJ-NPR-Z0-9]{16})\b/g,
  /\b(WP0[A-Z0-9]{14})\b/g,
  /\b(WDB[A-Z0-9]{14})\b/g,
  /\b(WVW[A-Z0-9]{14})\b/g,
  /\b(WBA[A-Z0-9]{14})\b/g,
  /\b(WAU[A-Z0-9]{14})\b/g,
  /\b(ZFF[A-Z0-9]{14})\b/g,
  /\b(ZAM[A-Z0-9]{14})\b/g,
  /\b(SCFZ[A-Z0-9]{13})\b/g,
  /\b(SAJ[A-Z0-9]{14})\b/g,
  /\b(SAL[A-Z0-9]{14})\b/g,
];

function extractVin(html: string): string | null {
  for (const pattern of VIN_PATTERNS) {
    const matches = html.match(pattern);
    if (matches && matches.length > 0) {
      const counts: Record<string, number> = {};
      for (const m of matches) {
        counts[m] = (counts[m] || 0) + 1;
      }
      const vin = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      // VIN column is varchar(17) - ensure we don't exceed
      if (vin.length <= 17) {
        return vin;
      }
      // If longer, it's probably a malformed match - skip
      console.warn(`VIN too long (${vin.length} chars), skipping: ${vin}`);
    }
  }

  // Fall back to chassis/serial for pre-1981
  const chassisMatch = html.match(/Chassis:\s*<a[^>]*>([A-Z0-9*-]+)<\/a>/i) ||
                       html.match(/Chassis:\s*([A-Z0-9*-]+)/i) ||
                       html.match(/>Chassis<\/strong>:\s*([A-Z0-9*-]+)/i) ||
                       html.match(/Serial(?:\s*Number)?:\s*<a[^>]*>([A-Z0-9*-]+)<\/a>/i) ||
                       html.match(/Serial(?:\s*Number)?:\s*([A-Z0-9*-]+)/i);
  if (chassisMatch) {
    const chassis = chassisMatch[1].trim();
    // Must be 6-17 chars to fit in VIN column
    if (chassis.length >= 6 && chassis.length <= 17 && /^[A-Z0-9*-]+$/i.test(chassis)) {
      return chassis;
    }
  }

  return null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/&#x([a-fA-F0-9]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&times;/g, '×')
    .replace(/&#215;/g, '×');
}

function extractTitle(html: string): { title: string | null; year: number | null; make: string | null; model: string | null } {
  const h1Match = html.match(/<h1[^>]*class="[^"]*post-title[^"]*"[^>]*>([^<]+)</i);
  let title = h1Match?.[1]?.trim() || null;

  if (!title) return { title: null, year: null, make: null, model: null };

  title = decodeHtmlEntities(title);
  title = title
    .replace(/\s+for sale on BaT Auctions.*$/i, '')
    .replace(/\s+on BaT Auctions.*$/i, '')
    .replace(/\s*\|.*Bring a Trailer.*$/i, '')
    .replace(/\s*\(Lot #[\d,]+\).*$/i, '')
    .trim();

  const yearMatch = title.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? parseInt(yearMatch[0]) : null;

  if (year) {
    const afterYear = title.slice(title.indexOf(yearMatch![0]) + yearMatch![0].length).trim();
    const parts = afterYear.split(/\s+/);
    const make = parts[0] || null;
    const model = parts.slice(1).join(' ') || null;
    return { title, year, make, model };
  }

  return { title, year: null, make: null, model: null };
}

function parseMoney(raw: string | null): number | null {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return null;
  const normalized = s.replace(/,/g, "").replace(/\s+/g, "");
  const m = normalized.match(/^([0-9]+(?:\.[0-9]+)?)([km])?$/i);
  if (!m?.[1]) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const suffix = m[2]?.toLowerCase();
  const multiplier = suffix === "k" ? 1000 : suffix === "m" ? 1_000_000 : 1;
  return Math.round(n * multiplier);
}

// Check if listing is a BaT Alumni (previously sold on BaT)
function detectAlumni(html: string): boolean {
  // BaT marks resales with "Alumni" badge
  return html.includes('bat-alumni') ||
         html.includes('BaT Alumni') ||
         html.includes('class="alumni"') ||
         html.includes('Previously Sold on BaT');
}

function extractAuctionData(html: string): {
  seller_username: string | null;
  buyer_username: string | null;
  sale_price: number | null;
  high_bid: number | null;
  bid_count: number;
  comment_count: number;
  view_count: number;
  watcher_count: number;
  lot_number: string | null;
  auction_end_date: string | null;
  reserve_status: string | null;
} {
  const sellerMatch = html.match(/Sold by <strong>([^<]+)<\/strong>/i) ||
                      html.match(/>Seller<\/strong>:\s*<a[^>]*>([^<]+)<\/a>/i) ||
                      html.match(/"authorName":"([^"]+)\s*\(The Seller\)"/);
  const seller_username = sellerMatch?.[1]?.trim() || null;

  const buyerMatch = html.match(/to <strong>([^<]+)<\/strong> for/i) ||
                     html.match(/<a[^>]*href="[^"]*\/member\/([^"\/]+)\/"[^>]*target="_blank">([^<]+)<\/a>\s*<\/span>\s*<\/div>\s*<div class="identifier">This Listing/i);
  const buyer_username = buyerMatch?.[1]?.trim() || null;

  const priceMatch = html.match(/Sold for\s*<strong>USD \$([0-9,]+(?:\.\d+)?)/i) ||
                     html.match(/to <strong>[^<]+<\/strong> for <strong>USD \$([0-9,]+(?:\.\d+)?)<\/strong>/i);
  let sale_price: number | null = null;
  if (priceMatch) {
    sale_price = parseMoney(priceMatch[1]);
  }

  const bidMatch = html.match(/Bid to[^$]*USD \$([0-9,]+(?:\.\d+)?)/i) ||
                   html.match(/USD[^$]*\$([0-9,]+(?:\.\d+)?)\s*\(Reserve Not Met\)/i) ||
                   html.match(/Current Bid[^$]*\$([0-9,]+(?:\.\d+)?)/i) ||
                   html.match(/High Bid[^$]*\$([0-9,]+(?:\.\d+)?)/i);
  const high_bid = bidMatch ? parseMoney(bidMatch[1]) : null;

  const bidCountMatch = html.match(/"type":"bat-bid"/g);
  const bid_count = bidCountMatch ? bidCountMatch.length : 0;

  const commentHeaderMatch = html.match(/<span class="info-value">(\d+)<\/span>\s*<span class="info-label">Comments<\/span>/i);
  const comment_count = commentHeaderMatch ? parseInt(commentHeaderMatch[1]) : 0;

  const viewMatch = html.match(/data-stats-item="views">([0-9,]+)/);
  const view_count = viewMatch ? parseInt(viewMatch[1].replace(/,/g, '')) : 0;

  const watcherMatch = html.match(/data-stats-item="watchers">([0-9,]+)/);
  const watcher_count = watcherMatch ? parseInt(watcherMatch[1].replace(/,/g, '')) : 0;

  const lotMatch = html.match(/<strong>Lot<\/strong>\s*#([0-9,]+)/i);
  const lot_number = lotMatch ? lotMatch[1].replace(/,/g, '') : null;

  let reserve_status: string | null = null;
  if (html.includes('Reserve Not Met') || html.includes('reserve-not-met')) {
    reserve_status = 'reserve_not_met';
    sale_price = null;
  } else if (html.match(/class="[^"]*no-reserve[^"]*"/) || html.match(/>No Reserve</)) {
    reserve_status = 'no_reserve';
  } else if (html.includes('Reserve Met') || sale_price) {
    reserve_status = 'reserve_met';
  }

  let auction_end_date: string | null = null;
  const endMatch = html.match(/data-ends="(\d+)"/) || html.match(/data-until="(\d+)"/);
  if (endMatch) {
    const timestamp = parseInt(endMatch[1]);
    const endDate = new Date(timestamp * 1000);
    auction_end_date = endDate.toISOString().split('T')[0];
  } else {
    const dateMatch = html.match(/on (\d{1,2})\/(\d{1,2})\/(\d{2})\b/);
    if (dateMatch) {
      const [, month, day, year] = dateMatch;
      auction_end_date = `20${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }

  return {
    seller_username, buyer_username, sale_price, high_bid, bid_count,
    comment_count, view_count, watcher_count, lot_number, auction_end_date, reserve_status
  };
}

function extractLocation(html: string): string | null {
  const locMatch = html.match(/Location<\/strong>Located in ([^<]+)/i) ||
                   html.match(/group-title-label">Location<\/strong>([^<]+)/i) ||
                   html.match(/title="Listing location"[^>]*>([^<]+)</i);
  return locMatch?.[1]?.trim() || null;
}

function extractSpecs(html: string): {
  mileage: number | null;
  exterior_color: string | null;
  interior_color: string | null;
  transmission: string | null;
  drivetrain: string | null;
  engine: string | null;
  body_style: string | null;
} {
  const descMatch = html.match(/<div[^>]*class="post-excerpt"[^>]*>([\s\S]*?)<\/div>\s*<script/i);
  const descText = descMatch ? descMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') : html;

  let mileage: number | null = null;
  const mileagePatterns = [
    /odometer\s+(?:indicates|shows|reads)\s+([0-9,]+)\s*k?\s*miles/i,
    /([0-9,]+)\s*k?\s*miles\s+(?:are|were)\s+(?:shown|indicated)/i,
    /shows?\s+(?:just\s+|only\s+|approximately\s+|roughly\s+|about\s+)?([0-9,]+)\s*k?\s*miles/i,
    /has\s+(?:just\s+|only\s+|approximately\s+)?([0-9,]+)\s*k?\s*(?:documented\s+)?miles/i,
    /with\s+(?:just\s+|only\s+|approximately\s+)?([0-9,]+)\s*k?\s*miles/i,
    /indicates\s+([0-9,]+)\s*k?\s*miles/i,
    /\b([0-9,]+)\s*k\s+miles\b/i,
    /(?:^|\.\s+)(?:this\s+\w+\s+)?(?:shows?\s+|has\s+|with\s+)?([0-9,]+)\s+miles\b/i,
  ];
  for (const pattern of mileagePatterns) {
    const match = descText.match(pattern);
    if (match) {
      let num = parseInt(match[1].replace(/,/g, ''));
      if (match[0].toLowerCase().match(/[0-9,]+\s*k\s+miles/i) && num < 1000) {
        num = num * 1000;
      }
      mileage = num;
      break;
    }
  }

  let exterior_color: string | null = null;
  const colorPatterns = [
    /finished in ([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3}(?:\s+Metallic)?)/i,
    /wears ([A-Za-z]+(?:\s+[A-Za-z-]+)?)\s+(?:camouflage[- ]?style\s+)?paint/i,
    /wears ([A-Za-z]+)\s+camouflage/i,
    /painted (?:in )?([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})/i,
    /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(?:over|exterior|paint)/i,
  ];
  for (const pattern of colorPatterns) {
    const match = descText.match(pattern);
    if (match && match[1].length < 30) {
      const colorRaw = match[1].trim().toLowerCase();
      if (colorRaw.includes('mounted') || colorRaw.includes('wheel') || colorRaw.includes('and')) continue;
      exterior_color = colorRaw
        .split(/[\s-]+/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      break;
    }
  }

  let interior_color: string | null = null;
  const intMatch = descText.match(/(?:trimmed in|upholstered in)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(?:and\s+[A-Z][a-zA-Z]+\s+)?leather/i) ||
                   descText.match(/([A-Z][a-zA-Z]+(?:\s+Beige|Black|Brown|Tan|Red)?)\s+leather\s+interior/i);
  if (intMatch) {
    interior_color = intMatch[1].trim();
  }

  let transmission: string | null = null;
  const titleMatch = html.match(/<h1[^>]*class="[^"]*post-title[^"]*"[^>]*>([^<]+)</i);
  const title = titleMatch?.[1] || '';
  const fullText = title + ' ' + descText;

  const speedWords: Record<string, string> = {
    'three': '3', 'four': '4', 'five': '5', 'six': '6', 'seven': '7', 'eight': '8'
  };
  let normalizedText = fullText;
  for (const [word, digit] of Object.entries(speedWords)) {
    normalizedText = normalizedText.replace(new RegExp(`\\b${word}[- ]speed`, 'gi'), `${digit}-speed`);
  }

  if (normalizedText.match(/PDK|dual-clutch/i)) {
    const speedMatch = normalizedText.match(/(\d+)-speed\s+PDK/i);
    transmission = speedMatch ? `${speedMatch[1]}-Speed PDK` : 'PDK Dual-Clutch';
  } else if (normalizedText.match(/(\d+)[- ]speed\s+manual/i)) {
    const speedMatch = normalizedText.match(/(\d+)[- ]speed\s+manual/i);
    transmission = speedMatch ? `${speedMatch[1]}-Speed Manual` : 'Manual';
  } else if (normalizedText.match(/(\d+)[- ]speed/i) && !normalizedText.match(/automatic/i)) {
    const speedMatch = normalizedText.match(/(\d+)[- ]speed/i);
    transmission = speedMatch ? `${speedMatch[1]}-Speed Manual` : 'Manual';
  } else if (normalizedText.match(/automatic/i)) {
    const speedMatch = normalizedText.match(/(\d+)-speed\s+automatic/i);
    transmission = speedMatch ? `${speedMatch[1]}-Speed Automatic` : 'Automatic';
  } else if (normalizedText.match(/manual\s+trans(?:mission|axle)/i)) {
    transmission = 'Manual';
  }

  let drivetrain: string | null = null;
  if (fullText.match(/\b4[x×]4\b/i) || fullText.match(/\b4WD\b/i) || fullText.match(/\bfour[- ]wheel[- ]drive\b/i)) {
    drivetrain = '4WD';
  } else if (fullText.match(/\ball[- ]wheel[- ]drive\b/i) || fullText.match(/\bAWD\b/)) {
    drivetrain = 'AWD';
  } else if (fullText.match(/\brear[- ]wheel[- ]drive\b/i) || fullText.match(/\bRWD\b/)) {
    drivetrain = 'RWD';
  } else if (fullText.match(/\bfront[- ]wheel[- ]drive\b/i) || fullText.match(/\bFWD\b/)) {
    drivetrain = 'FWD';
  }

  let engine: string | null = null;
  const engineMatch = descText.match(/(twin-turbocharged|turbocharged|supercharged|naturally-aspirated)?\s*([0-9.]+)[- ]?(?:liter|L)\s+(flat-six|flat-four|V6|V8|V10|V12|inline-four|inline-six|I4|I6|straight-six)/i);
  if (engineMatch) {
    const [, turbo, displacement, config] = engineMatch;
    engine = `${turbo ? turbo + ' ' : ''}${displacement}L ${config}`.trim();
  }

  let body_style: string | null = null;
  const titleLower = title.toLowerCase() || descText.toLowerCase();
  if (titleLower.includes('coupe')) body_style = 'Coupe';
  else if (titleLower.includes('convertible') || titleLower.includes('cabriolet') || titleLower.includes('roadster') || titleLower.includes('spyder') || titleLower.includes('targa')) body_style = 'Convertible';
  else if (titleLower.includes('sedan')) body_style = 'Sedan';
  else if (titleLower.includes('wagon') || titleLower.includes('estate') || titleLower.includes('avant') || titleLower.includes('touring') || titleLower.includes('suburban')) body_style = 'Wagon';
  else if (titleLower.includes('suv') || titleLower.includes('crossover')) body_style = 'SUV';
  else if (titleLower.includes('hatchback')) body_style = 'Hatchback';
  else if (titleLower.includes('pickup') || titleLower.includes('truck')) body_style = 'Truck';

  return { mileage, exterior_color, interior_color, transmission, drivetrain, engine, body_style };
}

function extractDescription(html: string): string | null {
  const excerptMatch = html.match(/<div[^>]*class="post-excerpt"[^>]*>([\s\S]*?)<\/div>\s*<script/i);
  if (excerptMatch) {
    const paragraphs = excerptMatch[1].match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
    const text = paragraphs
      .map(p => p.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(p => p.length > 0 && !p.includes('Carfax'))
      .join('\n\n');
    // Sanitize control characters before returning
    return sanitizeForJson(text.slice(0, 10000)) || null;
  }
  return null;
}

function extractImages(html: string): string[] {
  const galleryMatch = html.match(/data-gallery-items="([^"]+)"/);
  if (!galleryMatch) return [];

  try {
    const json = galleryMatch[1]
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&amp;/g, '&');

    const items = JSON.parse(json);
    return items.map((item: any) => {
      const url = item?.full?.url || item?.large?.url || item?.small?.url;
      if (!url) return null;
      return url.split('?')[0].replace(/-scaled\./, '.');
    }).filter(Boolean);
  } catch {
    return [];
  }
}

let lastFetchResult: FetchResult | null = null;

async function extractBatListing(url: string): Promise<BatExtracted> {
  const fetchResult = await fetchBatPage(url);
  lastFetchResult = fetchResult;

  if (!fetchResult.html) {
    throw new Error(`Failed to fetch ${url}: ${fetchResult.error || 'unknown error'}`);
  }

  const html = fetchResult.html;
  const titleData = extractTitle(html);
  const auctionData = extractAuctionData(html);
  const specs = extractSpecs(html);
  const isAlumni = detectAlumni(html);

  return {
    url,
    ...titleData,
    vin: extractVin(html),
    location: extractLocation(html),
    ...specs,
    seller_username: auctionData.seller_username,
    buyer_username: auctionData.buyer_username,
    sale_price: auctionData.sale_price,
    high_bid: auctionData.high_bid,
    bid_count: auctionData.bid_count,
    comment_count: auctionData.comment_count,
    view_count: auctionData.view_count,
    watcher_count: auctionData.watcher_count,
    lot_number: auctionData.lot_number,
    reserve_status: auctionData.reserve_status,
    auction_end_date: auctionData.auction_end_date,
    description: extractDescription(html),
    image_urls: extractImages(html),
    comments: [],
    is_alumni: isAlumni,
    is_resale: false,  // Will be set during save if VIN exists
    extractor_version: EXTRACTOR_VERSION,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { url, save_to_db, vehicle_id } = await req.json();

    if (!url || !url.includes('bringatrailer.com/listing/')) {
      return new Response(
        JSON.stringify({ error: 'Invalid BaT listing URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    console.log(`[${EXTRACTOR_VERSION}] Extracting: ${url}`);
    const extracted = await extractBatListing(url);

    if (lastFetchResult) {
      await logFetchCost(supabase, 'bat-extract', url, lastFetchResult);
      console.log(`Fetch source: ${lastFetchResult.source} (${lastFetchResult.costCents}c)`);
    }

    console.log(`Title: ${extracted.title} | VIN: ${extracted.vin || 'N/A'} | Alumni: ${extracted.is_alumni}`);

    const healthLogger = new ExtractionLogger(supabase, {
      source: 'bat',
      extractorName: 'bat-extract',
      extractorVersion: EXTRACTOR_VERSION,
      sourceUrl: url,
      vehicleId: vehicle_id,
    });

    // Log fields...
    healthLogger.logField('title', extracted.title, 0.95);
    healthLogger.logField('year', extracted.year, extracted.year ? 0.95 : 0);
    healthLogger.logField('make', extracted.make, extracted.make ? 0.90 : 0);
    healthLogger.logField('model', extracted.model, extracted.model ? 0.85 : 0);
    if (extracted.vin) {
      const vinValidation = validateVin(extracted.vin);
      if (vinValidation.valid) {
        healthLogger.logField('vin', extracted.vin, extracted.vin.length === 17 ? 0.95 : 0.75);
      } else {
        healthLogger.logValidationFail('vin', extracted.vin, vinValidation.errorCode!, vinValidation.errorDetails);
      }
    }

    // Save to database
    if (save_to_db || vehicle_id) {
      let targetVehicleId = vehicle_id;
      let isResale = false;

      // Check for existing vehicle by VIN, URL, or year/make/model
      if (!vehicle_id) {
        const existing = await findExistingVehicle(supabase, extracted);
        if (existing) {
          targetVehicleId = existing.id;
          isResale = true;
          extracted.is_resale = true;
          console.log(`Resale detected (${existing.matchType}): updating existing vehicle ${targetVehicleId}`);
        }
      }

      if (targetVehicleId) {
        // Update existing vehicle
        const { error: updateError } = await supabase
          .from('vehicles')
          .update({
            bat_auction_url: extracted.url,
            bat_listing_title: extracted.title,
            bat_seller: extracted.seller_username,
            bat_buyer: extracted.buyer_username,
            sale_price: extracted.sale_price,
            high_bid: extracted.high_bid,
            bat_bids: extracted.bid_count,
            bat_comments: extracted.comment_count,
            bat_views: extracted.view_count,
            bat_watchers: extracted.watcher_count,
            bat_lot_number: extracted.lot_number,
            bat_location: extracted.location,
            reserve_status: extracted.reserve_status,
            mileage: extracted.mileage,
            color: extracted.exterior_color,
            interior_color: extracted.interior_color,
            transmission: extracted.transmission,
            drivetrain: extracted.drivetrain,
            engine_type: extracted.engine,
            body_style: extracted.body_style,
            description: extracted.description,
            auction_end_date: extracted.auction_end_date,
            sale_status: extracted.sale_price ? 'sold' : 'available',
            extractor_version: EXTRACTOR_VERSION,
            vin: extracted.vin || undefined,
          })
          .eq('id', targetVehicleId);

        if (updateError) {
          console.error('Vehicle update error:', updateError);
          throw new Error(`Failed to update vehicle: ${updateError.message}`);
        }

        console.log(`Updated vehicle: ${targetVehicleId}${isResale ? ' (resale)' : ''}`);
        extracted.vehicle_id = targetVehicleId;
        healthLogger.setVehicleId(targetVehicleId);
      } else {
        // VALIDATION: Check if this is actually a vehicle listing
        const vehicleCheck = isVehicleListing(extracted);
        if (!vehicleCheck.isVehicle) {
          console.log(`Skipping non-vehicle listing: ${vehicleCheck.reason}`);
          console.log(`  Title: ${extracted.title}`);
          console.log(`  URL: ${extracted.url}`);

          // Return success but indicate it was skipped
          return new Response(
            JSON.stringify({
              success: true,
              skipped: true,
              reason: vehicleCheck.reason,
              title: extracted.title,
              url: extracted.url,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // DEDUPLICATION: Check for existing vehicle before creating
        const existingVehicle = await findExistingVehicle(supabase, extracted);
        if (existingVehicle) {
          console.log(`Found existing vehicle ${existingVehicle.id} via ${existingVehicle.matchType}, updating instead of creating`);

          // Update existing vehicle with BaT data
          const { error: updateError } = await supabase
            .from('vehicles')
            .update({
              bat_auction_url: extracted.url,
              bat_listing_title: extracted.title,
              bat_seller: extracted.seller_username,
              bat_buyer: extracted.buyer_username,
              sale_price: extracted.sale_price,
              high_bid: extracted.high_bid,
              bat_bids: extracted.bid_count,
              bat_comments: extracted.comment_count,
              bat_views: extracted.view_count,
              bat_watchers: extracted.watcher_count,
              bat_lot_number: extracted.lot_number,
              bat_location: extracted.location,
              reserve_status: extracted.reserve_status,
              mileage: extracted.mileage || undefined,
              color: extracted.exterior_color || undefined,
              interior_color: extracted.interior_color || undefined,
              transmission: extracted.transmission || undefined,
              drivetrain: extracted.drivetrain || undefined,
              engine_type: extracted.engine || undefined,
              body_style: extracted.body_style || undefined,
              description: extracted.description || undefined,
              auction_end_date: extracted.auction_end_date,
              sale_status: extracted.sale_price ? 'sold' : 'available',
              extractor_version: EXTRACTOR_VERSION,
              vin: extracted.vin || undefined,
            })
            .eq('id', existingVehicle.id);

          if (updateError) {
            console.error('Vehicle update error:', updateError);
            throw new Error(`Failed to update existing vehicle: ${updateError.message}`);
          }

          console.log(`Updated existing vehicle: ${existingVehicle.id} (matched by ${existingVehicle.matchType})`);
          extracted.vehicle_id = existingVehicle.id;
          healthLogger.setVehicleId(existingVehicle.id);
        } else {
          // Insert new vehicle
          const { data, error } = await supabase
            .from('vehicles')
            .insert({
              bat_auction_url: extracted.url,
              year: extracted.year,
              make: extracted.make,
              model: extracted.model,
              vin: extracted.vin,
              bat_listing_title: extracted.title,
              bat_seller: extracted.seller_username,
              bat_buyer: extracted.buyer_username,
              sale_price: extracted.sale_price,
              high_bid: extracted.high_bid,
              bat_bids: extracted.bid_count,
              bat_comments: extracted.comment_count,
              bat_views: extracted.view_count,
              bat_watchers: extracted.watcher_count,
              bat_lot_number: extracted.lot_number,
              bat_location: extracted.location,
              reserve_status: extracted.reserve_status,
              mileage: extracted.mileage,
              color: extracted.exterior_color,
              interior_color: extracted.interior_color,
              transmission: extracted.transmission,
              drivetrain: extracted.drivetrain,
              engine_type: extracted.engine,
              body_style: extracted.body_style,
              description: extracted.description,
              auction_end_date: extracted.auction_end_date,
              listing_source: EXTRACTOR_VERSION,
              extractor_version: EXTRACTOR_VERSION,
              profile_origin: 'bat_import',
              discovery_url: extracted.url,
              discovery_source: 'bat',
              is_public: true,
              sale_status: extracted.sale_price ? 'sold' : 'available',
              status: 'active',
            })
            .select()
            .single();

          if (error) {
            // Handle VIN duplicate race condition - another worker inserted first
            if (error.message?.includes('vin_unique') || error.message?.includes('duplicate key')) {
              console.log('VIN race condition detected, retrying lookup...');
              const retryExisting = await findExistingVehicle(supabase, extracted);
              if (retryExisting) {
                console.log(`Found vehicle on retry: ${retryExisting.id}`);
                extracted.vehicle_id = retryExisting.id;
                healthLogger.setVehicleId(retryExisting.id);
                // Don't throw - we found the vehicle, continue with auction_events
              } else {
                console.error('DB insert error (no retry match):', error);
                throw new Error(`Failed to save vehicle: ${error.message}`);
              }
            } else {
              console.error('DB insert error:', error);
              throw new Error(`Failed to save vehicle: ${error.message}`);
            }
          } else {
            console.log(`Created vehicle: ${data.id}`);
            extracted.vehicle_id = data.id;
            healthLogger.setVehicleId(data.id);
          }
        }
      }

      // Create auction_events record (for every auction, including resales)
      if (extracted.vehicle_id && extracted.lot_number) {
        // Check if auction event already exists
        const { data: existingEvent } = await supabase
          .from('auction_events')
          .select('id')
          .eq('source', 'bat')
          .eq('source_listing_id', extracted.lot_number)
          .limit(1)
          .single();

        if (existingEvent) {
          // Update existing
          const { error: auctionError } = await supabase
            .from('auction_events')
            .update({
              vehicle_id: extracted.vehicle_id,
              source_url: extracted.url,
              auction_end_date: extracted.auction_end_date ? new Date(extracted.auction_end_date).toISOString() : null,
              winning_bid: extracted.sale_price,
              high_bid: extracted.high_bid,
              total_bids: extracted.bid_count,
              page_views: extracted.view_count,
              watchers: extracted.watcher_count,
              seller_name: extracted.seller_username,
              winning_bidder: extracted.buyer_username,
              outcome: extracted.sale_price ? 'sold' : (extracted.reserve_status === 'reserve_not_met' ? 'not_sold' : 'ended'),
              raw_data: { is_alumni: extracted.is_alumni, extractor_version: EXTRACTOR_VERSION },
            })
            .eq('id', existingEvent.id);

          if (auctionError) {
            console.warn('Auction event update warning:', auctionError.message);
          } else {
            console.log(`Updated auction_events for lot #${extracted.lot_number}`);
          }
        } else {
          // Insert new
          const { error: auctionError } = await supabase
            .from('auction_events')
            .insert({
              vehicle_id: extracted.vehicle_id,
              source: 'bat',
              source_url: extracted.url,
              source_listing_id: extracted.lot_number,
              lot_number: extracted.lot_number,
              auction_end_date: extracted.auction_end_date ? new Date(extracted.auction_end_date).toISOString() : null,
              winning_bid: extracted.sale_price,
              high_bid: extracted.high_bid,
              total_bids: extracted.bid_count,
              page_views: extracted.view_count,
              watchers: extracted.watcher_count,
              comments_count: extracted.comment_count,
              seller_name: extracted.seller_username,
              winning_bidder: extracted.buyer_username,
              outcome: extracted.sale_price ? 'sold' : (extracted.reserve_status === 'reserve_not_met' ? 'not_sold' : 'ended'),
              raw_data: { is_alumni: extracted.is_alumni, extractor_version: EXTRACTOR_VERSION },
            });

          if (auctionError) {
            console.warn('Auction event insert warning:', auctionError.message);
          } else {
            console.log(`Created auction_events for lot #${extracted.lot_number}`);
          }
        }
      }

      // Save images (skip on resale to avoid duplicates)
      if (extracted.image_urls.length > 0 && extracted.vehicle_id && !isResale) {
        const imageRecords = extracted.image_urls.map((img_url, i) => ({
          vehicle_id: extracted.vehicle_id,
          image_url: img_url,
          position: i,
          source: 'bat_import',
          is_external: true,
        }));

        const { error: imgError } = await supabase
          .from('vehicle_images')
          .insert(imageRecords);

        if (imgError) {
          console.warn('Image save warning:', imgError.message);
        } else {
          console.log(`Saved ${imageRecords.length} images`);
        }
      }

      // Create/update external_listings
      if (extracted.vehicle_id) {
        const listingUrlKey = normalizeListingUrlKey(extracted.url);
        const { error: listingError } = await supabase
          .from('external_listings')
          .upsert({
            vehicle_id: extracted.vehicle_id,
            platform: 'bat',
            listing_url: extracted.url,
            listing_url_key: listingUrlKey,
            listing_id: extracted.lot_number || listingUrlKey,
            listing_status: extracted.sale_price ? 'sold' : 'ended',
            end_date: extracted.auction_end_date,
            final_price: extracted.sale_price,
            bid_count: extracted.bid_count,
            view_count: extracted.view_count,
            watcher_count: extracted.watcher_count,
            sold_at: extracted.sale_price ? extracted.auction_end_date : null,
            metadata: {
              lot_number: extracted.lot_number,
              seller_username: extracted.seller_username,
              buyer_username: extracted.buyer_username,
              reserve_status: extracted.reserve_status,
              is_alumni: extracted.is_alumni,
              extractor_version: EXTRACTOR_VERSION,
            },
          }, {
            onConflict: 'platform,listing_url_key'
          });

        if (listingError) {
          console.warn('External listing warning:', listingError.message);
        }
      }

      // Timeline events
      const events = [];
      if (extracted.auction_end_date && extracted.vehicle_id) {
        const endDate = new Date(extracted.auction_end_date);
        const listDate = new Date(endDate);
        listDate.setDate(listDate.getDate() - 7);

        events.push({
          vehicle_id: extracted.vehicle_id,
          event_type: 'auction_listed',
          event_date: listDate.toISOString().split('T')[0],
          title: `Listed on Bring a Trailer (Lot #${extracted.lot_number || 'N/A'})${extracted.is_alumni ? ' - BaT Alumni' : ''}`,
          description: `Listed by @${extracted.seller_username || 'seller'}. ${extracted.reserve_status === 'no_reserve' ? 'No Reserve.' : ''}`,
          source: 'bat_import',
          metadata: { lot_number: extracted.lot_number, seller: extracted.seller_username, extractor_version: EXTRACTOR_VERSION },
        });

        if (extracted.sale_price) {
          events.push({
            vehicle_id: extracted.vehicle_id,
            event_type: 'auction_sold',
            event_date: extracted.auction_end_date,
            title: `Sold for $${extracted.sale_price.toLocaleString()}`,
            description: `Won by @${extracted.buyer_username || 'unknown'} with ${extracted.bid_count} bids.`,
            source: 'bat_import',
            metadata: {
              lot_number: extracted.lot_number,
              buyer: extracted.buyer_username,
              sale_price: extracted.sale_price,
              bid_count: extracted.bid_count,
              extractor_version: EXTRACTOR_VERSION,
            },
          });
        }
      }

      if (events.length > 0) {
        await supabase.from('timeline_events').insert(events);
        console.log(`Created ${events.length} timeline events`);
      }

      // Link to BaT organization
      if (extracted.vehicle_id) {
        const BAT_ORG_ID = "d2bd6370-11d1-4af0-8dd2-3de2c3899166";
        await supabase
          .from('organization_vehicles')
          .upsert({
            organization_id: BAT_ORG_ID,
            vehicle_id: extracted.vehicle_id,
            relationship_type: extracted.sale_price ? 'sold_by' : 'consigner',
            status: 'active',
            auto_tagged: true,
            notes: `Imported via ${EXTRACTOR_VERSION}: ${extracted.url}`
          }, {
            onConflict: 'organization_id,vehicle_id,relationship_type'
          });
      }

      // Trigger comment extraction
      if (extracted.vehicle_id && extracted.url) {
        const commentExtractionUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/extract-auction-comments`;
        fetch(commentExtractionUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({
            auction_url: extracted.url,
            vehicle_id: extracted.vehicle_id,
          }),
        }).catch(e => console.warn(`Comment extraction trigger failed: ${e.message}`));
      }

      healthLogger.flush().catch(err => console.error('Health log flush error:', err));
    } else {
      healthLogger.flush().catch(err => console.error('Health log flush error:', err));
    }

    return new Response(
      JSON.stringify({
        success: true,
        extracted,
        _meta: {
          extractor_version: EXTRACTOR_VERSION,
          fetch_source: lastFetchResult?.source,
          fetch_cost_cents: lastFetchResult?.costCents,
          is_resale: extracted.is_resale,
          is_alumni: extracted.is_alumni,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message, extractor_version: EXTRACTOR_VERSION }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
