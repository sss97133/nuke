import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
}

// Robust identity cleanup (prevents saving listing junk into make/model downstream).
function cleanModelName(raw: any): string | null {
  if (!raw) return null
  let s = String(raw).replace(/\s+/g, ' ').trim()
  if (!s) return null
  // L'Art de l'Automobile sometimes appends marketing/location fragments with asterisks:
  // "GTC4 Lusso V8 T *Available on the..." or "*Available in Geneva*".
  // Model should be just the model name; keep badges in metadata elsewhere.
  // Remove any balanced *...* segments (bounded) and any trailing unmatched "*..." segment.
  s = s.replace(/\s*\*[^*]{1,120}\*\s*/g, ' ').replace(/\s+/g, ' ').trim()
  s = s.replace(/\s*\*[^*]{1,200}$/g, '').trim()
  // Remove common trailing "Available ..." fragments even when not wrapped in asterisks.
  s = s.replace(/\s+(available|available in|available on|disponible|available in switzerland|available in geneva)\b[\s\S]*$/i, '').trim()
  // Remove common “listing title junk”
  s = s.replace(/\s*-\s*\$[\d,]+(?:\.\d{2})?.*$/i, '').trim()
  s = s.replace(/\s*\(\s*Est\.\s*payment.*$/i, '').trim()
  s = s.replace(/\s*-\s*craigslist\b.*$/i, '').trim()
  // Remove trailing parenthetical location/dealer
  s = s.replace(/\s*\([^)]*\)\s*$/i, '').trim()
  if (!s || s.length > 140) return null
  return s
}

function cleanMakeName(raw: any): string | null {
  if (!raw) return null
  const s0 = String(raw).replace(/[/_]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!s0 || s0 === '*' || s0.length > 40) return null
  const lower = s0.toLowerCase()
  if (lower === 'chevy') return 'Chevrolet'
  if (lower === 'vw') return 'Volkswagen'
  if (lower === 'benz') return 'Mercedes-Benz'
  // Normalize Mercedes-Benz variations
  if (lower === 'mercedes-benz' || lower === 'mercedes' || lower === 'mercedes benz') return 'Mercedes-Benz'
  // Title-case-ish - handle both spaces and hyphens
  return s0
    .split(/[\s-]+/)
    .map((p) => (p.length <= 2 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()))
    .join('-')
    .replace(/-+/g, '-') // Normalize multiple hyphens
}

// Helper function to extract price from text, avoiding monthly payments
// Handles European-style formatting where period is thousands separator (e.g., $14.500 = $14,500)
function extractVehiclePrice(text: string): number | null {
  if (!text) return null;
  
  // Helper to normalize price string (handles both comma and period as thousands separators)
  const normalizePriceString = (priceStr: string): number | null => {
    // Remove $ and spaces
    let cleaned = priceStr.replace(/[\$\s]/g, '');
    
    // Handle European-style: $14.500 (period as thousands separator)
    // Pattern: digits.three_digits at the end suggests thousands separator
    const euroMatch = cleaned.match(/^(\d+)\.(\d{3})$/);
    if (euroMatch) {
      // This is European format (e.g., "14.500" = 14500)
      return parseInt(euroMatch[1] + euroMatch[2]);
    }
    
    // Handle standard format: $14,500 (comma as thousands separator)
    // Also handle mixed: $1,234.56 (comma thousands, period decimal)
    if (cleaned.includes(',') && cleaned.includes('.')) {
      // Has both comma and period - comma is thousands, period is decimal
      cleaned = cleaned.replace(/,/g, '');
      return Math.round(parseFloat(cleaned));
    }
    
    // Handle comma-only (thousands separator)
    if (cleaned.includes(',')) {
      cleaned = cleaned.replace(/,/g, '');
      return parseInt(cleaned);
    }
    
    // Handle period-only - need to determine if it's decimal or thousands separator
    if (cleaned.includes('.')) {
      const parts = cleaned.split('.');
      // If exactly 3 digits after period, likely thousands separator (e.g., "14.500")
      if (parts.length === 2 && parts[1].length === 3 && parts[1].match(/^\d{3}$/)) {
        // Thousands separator
        return parseInt(parts[0] + parts[1]);
      } else {
        // Decimal separator, round to integer
        return Math.round(parseFloat(cleaned));
      }
    }
    
    // No separators, just digits
    return parseInt(cleaned);
  };
  
  // First, try to find structured price fields (especially "Asking" which is common on Craigslist)
  const structuredPatterns = [
    /Asking[:\s]*\$?\s*([\d,.]+)/i,  // "Asking $14.500" or "Asking $14,500"
    /Price[:\s]*\$?\s*([\d,.]+)/i,
    /Sale\s+Price[:\s]*\$?\s*([\d,.]+)/i,
    /Vehicle\s+Price[:\s]*\$?\s*([\d,.]+)/i
  ];
  
  for (const pattern of structuredPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const price = normalizePriceString(match[1]);
      if (price && price >= 1000) {
        return price;
      }
    }
  }
  
  // Avoid monthly payment patterns
  if (text.match(/Est\.\s*payment|Monthly\s*payment|OAC[†]?/i)) {
    // Look for actual vehicle price, not monthly payment
    const vehiclePriceMatch = text.match(/(?:Price|Asking|Sale)[:\s]*\$?\s*([\d,.]+)/i);
    if (vehiclePriceMatch && vehiclePriceMatch[1]) {
      const price = normalizePriceString(vehiclePriceMatch[1]);
      if (price && price >= 1000) {
        return price;
      }
    }
    return null; // Don't extract if only monthly payment found
  }
  
  // Extract all prices and prefer the largest (vehicle prices are typically $5,000+)
  // Match both $14.500 (European) and $14,500 (US) formats
  const priceMatches = text.match(/\$\s*([\d,.]+)/g);
  if (priceMatches) {
    const prices = priceMatches
      .map(m => {
        const numMatch = m.match(/\$\s*([\d,.]+)/);
        return numMatch ? normalizePriceString(numMatch[1]) : null;
      })
      .filter((p): p is number => p !== null && p >= 1000);
    
    // If multiple $ amounts are present in unstructured text, do not guess.
    if (prices.length === 1) {
      return prices[0];
    }
  }
  
  return null;
}

function detectCurrencyCodeFromText(text: string | null | undefined): string | null {
  const raw = String(text || '');
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper.includes('AED') || raw.includes('د.إ')) return 'AED';
  if (upper.includes('EUR') || raw.includes('€')) return 'EUR';
  if (upper.includes('GBP') || raw.includes('£')) return 'GBP';
  if (upper.includes('CHF')) return 'CHF';
  if (upper.includes('JPY') || raw.includes('¥')) return 'JPY';
  if (upper.includes('CAD')) return 'CAD';
  if (upper.includes('AUD')) return 'AUD';
  if (upper.includes('USD') || raw.includes('US$') || raw.includes('$')) return 'USD';
  return null;
}

function normalizeImageUrls(urls: any[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of urls) {
    if (typeof raw !== 'string') continue
    let s = raw.trim()
    if (!s.startsWith('http')) continue
    // Prefer https (Cloudinary commonly returns http on older sites).
    if (s.startsWith('http://res.cloudinary.com/')) {
      s = 'https://' + s.slice('http://'.length)
    }
    const lower = s.toLowerCase()
    if (lower.includes('youtube.com')) continue
    if (lower.includes('logo') || lower.includes('icon') || lower.includes('avatar')) continue
    if (lower.endsWith('.svg')) continue
    // Craigslist thumbnails: 50x50c / other tiny thumbs
    if (lower.includes('_50x50')) continue
    if (lower.includes('94x63')) continue
    if (lower.includes('thumbnail')) continue
    if (!seen.has(s)) {
      out.push(s)
      seen.add(s)
    }
  }
  return out
}

function promoteBeverlyHillsCarClubImageUrl(raw: string): string {
  let s = (raw || '').trim()
  if (!s) return s
  // Their gallery commonly uses suffixes like _s/_m/_l on jpgs; prefer large when possible.
  // Examples:
  // - .../1660/1660_main_l.jpg
  // - .../1660/1660_1_s.jpg  -> ..._l.jpg
  s = s.replace(/_(s|m)\.(jpg|jpeg|png)$/i, '_l.$2')
  return s
}

function extractBhccStockNoFromHtml(html: string): number | null {
  // BHCC exposes the numeric stock number reliably in the meta description:
  // "Used 1963 Alfa Romeo ... Stock # 17692 in Los Angeles, CA ..."
  const m = html.match(/Stock\s*#\s*(\d{1,10})/i)
  if (!m?.[1]) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) ? n : null
}

/**
 * Extract data from sidebar structure (Classic.com, Hagerty, etc.)
 * Handles: .sidebar .price .price-amount, .condition, .at-a-glance .odomoter, .transmission
 */
function extractSidebarData(doc: any): {
  price: number | null;
  condition: string | null;
  mileage: number | null;
  transmission: string | null;
} {
  const result = {
    price: null as number | null,
    condition: null as string | null,
    mileage: null as number | null,
    transmission: null as string | null,
  };

  // Extract price from .price .price-amount
  const priceEl = doc.querySelector('.sidebar .price .price-amount, .price .price-amount');
  if (priceEl) {
    const priceText = priceEl.textContent?.trim() || '';
    // Remove currency symbol and parse
    const priceMatch = priceText.match(/[\d,]+\.?\d*/);
    if (priceMatch) {
      const price = parseInt(priceMatch[0].replace(/,/g, ''), 10);
      if (price > 0 && price < 100000000) {
        result.price = price;
      }
    }
  }

  // Extract condition from .price .condition
  const conditionEl = doc.querySelector('.sidebar .price .condition, .price .condition');
  if (conditionEl) {
    const condition = conditionEl.textContent?.trim();
    if (condition) {
      result.condition = condition;
    }
  }

  // Extract mileage from .at-a-glance .odomoter (note: typo in HTML class)
  const odometerEl = doc.querySelector('.sidebar .at-a-glance .odomoter, .at-a-glance .odomoter');
  if (odometerEl) {
    const odoText = odometerEl.textContent?.trim() || '';
    // Match patterns like "13,796 mi" or "13,796 miles"
    const odoMatch = odoText.match(/([\d,]+)\s*(?:mi|miles|mile)/i);
    if (odoMatch) {
      const mileage = parseInt(odoMatch[1].replace(/,/g, ''), 10);
      if (mileage > 0 && mileage < 10000000) {
        result.mileage = mileage;
      }
    }
  }

  // Extract transmission from .at-a-glance .transmission
  const transEl = doc.querySelector('.sidebar .at-a-glance .transmission, .at-a-glance .transmission');
  if (transEl) {
    const transText = transEl.textContent?.trim() || '';
    // Clean up common prefixes like icons
    const trans = transText.replace(/^[^\w]*/, '').trim();
    if (trans) {
      result.transmission = trans;
    }
  }

  return result;
}

/**
 * Extract data from description text (rich vehicle details)
 * Parses free-form description for color, interior, engine, features, etc.
 */
function extractDescriptionData(description: string): {
  exteriorColor: string | null;
  interiorColor: string | null;
  engine: string | null;
  features: string[];
  originalMsrp: number | null;
  ownership: string | null;
  condition: string | null;
} {
  const result = {
    exteriorColor: null as string | null,
    interiorColor: null as string | null,
    engine: null as string | null,
    features: [] as string[],
    originalMsrp: null as number | null,
    ownership: null as string | null,
    condition: null as string | null,
  };

  if (!description) return result;

  const desc = description.toLowerCase();

  // Extract exterior color - patterns like "GT Silver Metallic", "finished in [Color]"
  const colorPatterns = [
    /finished in ([A-Z][A-Za-z\s]+(?:Metallic|Pearl|Mica|Paint)?)/i,
    /([A-Z][A-Za-z\s]+(?:Metallic|Pearl|Mica))\s+over/i,
    /color[:\s]+([A-Z][A-Za-z\s]+(?:Metallic|Pearl|Mica)?)/i,
  ];
  for (const pattern of colorPatterns) {
    const match = description.match(pattern);
    if (match) {
      result.exteriorColor = match[1].trim();
      break;
    }
  }

  // Extract interior color - patterns like "Black Leather", "over [Color] interior"
  const interiorPatterns = [
    /over\s+([A-Z][A-Za-z\s]+(?:Leather|Cloth|Vinyl|Suede)?)\s+interior/i,
    /interior[:\s]+([A-Z][A-Za-z\s]+(?:Leather|Cloth|Vinyl|Suede)?)/i,
    /([A-Z][A-Za-z\s]+(?:Leather|Cloth|Vinyl|Suede))\s+interior/i,
  ];
  for (const pattern of interiorPatterns) {
    const match = description.match(pattern);
    if (match) {
      result.interiorColor = match[1].trim();
      break;
    }
  }

  // Extract engine - patterns like "twin-turbo 3.0 liter", "3.0L V6", etc.
  const enginePatterns = [
    /(twin-turbo|turbocharged|supercharged)\s+([\d.]+)\s*(?:liter|L)/i,
    /([\d.]+)\s*(?:liter|L)\s*(?:twin-turbo|turbocharged|supercharged)?\s*(?:flat|inline|V)?\s*\d+/i,
    /engine[:\s]+([^.,]+(?:liter|L|V\d+|inline))/i,
  ];
  for (const pattern of enginePatterns) {
    const match = description.match(pattern);
    if (match) {
      result.engine = match[0].trim();
      break;
    }
  }

  // Extract original MSRP - patterns like "over $161k", "original sticker price over $161k"
  const msrpPatterns = [
    /original\s+(?:sticker\s+)?price\s+(?:over|was|is)\s+\$?([\d,]+(?:k|K)?)/i,
    /msrp[:\s]+\$?([\d,]+(?:k|K)?)/i,
    /sticker[:\s]+\$?([\d,]+(?:k|K)?)/i,
  ];
  for (const pattern of msrpPatterns) {
    const match = description.match(pattern);
    if (match) {
      let msrpStr = match[1].replace(/,/g, '');
      if (msrpStr.toLowerCase().endsWith('k')) {
        msrpStr = msrpStr.slice(0, -1) + '000';
      }
      const msrp = parseInt(msrpStr, 10);
      if (msrp > 0 && msrp < 10000000) {
        result.originalMsrp = msrp;
      }
      break;
    }
  }

  // Extract ownership info - "One Owner", "Two Owner", etc.
  const ownershipMatch = description.match(/(\d+|one|two|three|four|five)\s+owner/i);
  if (ownershipMatch) {
    result.ownership = ownershipMatch[0].trim();
  }

  // Extract condition - "Clean Carfax", "Excellent Condition", etc.
  const conditionPatterns = [
    /clean\s+carfax/i,
    /excellent\s+condition/i,
    /mint\s+condition/i,
    /pristine\s+condition/i,
  ];
  for (const pattern of conditionPatterns) {
    if (pattern.test(description)) {
      result.condition = pattern.source.replace(/[\\^$.*+?()[\]{}|]/g, '').replace(/i$/, '').trim();
      break;
    }
  }

  // Extract features (common equipment/options)
  const featureKeywords = [
    'Front Axle Lift', 'Rear Axle Steering', 'Power Steering Plus',
    'LED-Matrix Headlights', 'Burmester', 'Surround Sound',
    '18-way Seats', 'Memory Seats', 'extended range', 'fuel tank',
    'Sport Chrono', 'PASM', 'PDK', 'Manual Transmission',
  ];
  for (const keyword of featureKeywords) {
    if (description.includes(keyword)) {
      result.features.push(keyword);
    }
  }

  return result;
}

type EventMention = {
  name: string;
  year: number;
  event_date: string;
  context: string;
};

function extractEventMentionsFromText(text: string): EventMention[] {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const patterns: Array<{ name: string; pattern: RegExp }> = [
    { name: "Pebble Beach Concours d'Elegance", pattern: /Pebble Beach Concours d[’']Elegance/i },
    { name: 'Colorado Grand 1000', pattern: /Colorado\s+(?:Grand\s+)?1000/i },
    { name: 'Quail Motorsports Gathering', pattern: /Quail Motorsports Gathering/i },
    { name: 'Concorso Italiano', pattern: /Concorso Italiano/i },
    { name: "Villa d'Este Concorso d'Eleganza", pattern: /Villa d[’']Este Concorso d[’']Eleganza/i },
    { name: "St. James Concours d'Elegance", pattern: /St\.\s*James Concours d[’']Elegance/i },
    { name: 'Geneva Salon', pattern: /Geneva Salon/i },
    { name: 'Paris Salon', pattern: /Paris Salon/i },
    { name: '24 Hours of Le Mans', pattern: /24\s*Hours?\s+of\s+Le\s+Mans/i },
    { name: 'Mille Miglia Storica', pattern: /Mille Miglia Storica/i },
    { name: 'Mille Miglia', pattern: /Mille Miglia(?! Storica)/i },
  ];

  const results: EventMention[] = [];
  const seen = new Set<string>();

  for (const entry of patterns) {
    const regex = new RegExp(`\\b((?:19|20)\\d{2})\\b[^.]{0,120}?${entry.pattern.source}`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(normalized)) !== null) {
      const year = parseInt(match[1], 10);
      if (!Number.isFinite(year)) continue;
      const key = `${year}:${entry.name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        name: entry.name,
        year,
        event_date: `${year}-01-01`,
        context: match[0].trim(),
      });
    }
  }

  return results;
}

/**
 * Extract data from table-based listings (Cantech Automotive, etc.)
 * Handles: .table.table-striped with th/td pairs in Details and Specifications tabs
 */
function extractTableData(doc: any): {
  price: number | null;
  mileage: number | null;
  transmission: string | null;
  driveType: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  seats: number | null;
  doors: number | null;
  fuelType: string | null;
} {
  const result = {
    price: null as number | null,
    mileage: null as number | null,
    transmission: null as string | null,
    driveType: null as string | null,
    year: null as number | null,
    make: null as string | null,
    model: null as string | null,
    seats: null as number | null,
    doors: null as number | null,
    fuelType: null as string | null,
  };

  // Find all tables with class "table table-striped"
  const tables = Array.from(doc.querySelectorAll('.table.table-striped, table.table-striped')) || [];
  
  for (const table of tables) {
    const rows = Array.from(table.querySelectorAll('tbody tr, tr')) || [];
    
    for (const row of rows as any[]) {
      const th = row.querySelector('th');
      const td = row.querySelector('td');
      
      if (!th || !td) continue;
      
      const label = (th.textContent || '').trim().toLowerCase();
      const value = (td.textContent || '').trim();
      
      if (!label || !value) continue;
      
      // Details tab fields
      if (label === 'price') {
        // Extract price from .price-amount or direct text
        const priceEl = td.querySelector('.price-amount');
        const priceText = priceEl ? (priceEl.textContent || '').trim() : value;
        const priceMatch = priceText.match(/[\d,]+\.?\d*/);
        if (priceMatch) {
          const price = parseInt(priceMatch[0].replace(/,/g, ''), 10);
          if (price > 0 && price < 100000000) {
            result.price = price;
          }
        }
      } else if (label === 'miles' || label === 'mileage') {
        const mileageMatch = value.match(/([\d,]+)\s*(?:mi|miles|mile)?/i);
        if (mileageMatch) {
          const mileage = parseInt(mileageMatch[1].replace(/,/g, ''), 10);
          if (mileage > 0 && mileage < 10000000) {
            result.mileage = mileage;
          }
        }
      } else if (label === 'transmission' || label === 'transmission type') {
        result.transmission = value;
      } else if (label === 'drive type') {
        result.driveType = value.toLowerCase();
      }
      
      // Specifications tab fields
      if (label === 'year') {
        const year = parseInt(value, 10);
        if (year >= 1885 && year <= new Date().getFullYear() + 1) {
          result.year = year;
        }
      } else if (label === 'make') {
        result.make = cleanMakeName(value) || value;
      } else if (label === 'model') {
        result.model = cleanModelName(value) || value;
      } else if (label === 'seats') {
        const seats = parseInt(value, 10);
        if (seats > 0 && seats <= 20) {
          result.seats = seats;
        }
      } else if (label === 'doors') {
        const doors = parseInt(value, 10);
        if (doors > 0 && doors <= 10) {
          result.doors = doors;
        }
      } else if (label === 'fuel type') {
        result.fuelType = value.toLowerCase();
      }
    }
  }

  return result;
}

function parseBeverlyHillsCarClubListing(html: string, url: string): any {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  // Prefer the on-page H1 and meta description; BHCC pages are consistent here.
  const metaDesc =
    (doc?.querySelector('meta[name="description"]')?.getAttribute('content') || '')
      .replace(/\s+/g, ' ')
      .trim()

  const title =
    (doc?.querySelector('h1.listing-title')?.textContent || doc?.querySelector('h1')?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()

  const priceText =
    (doc?.querySelector('.price')?.textContent || doc?.querySelector('[class*="price"]')?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()

  const specs: Record<string, string> = {}
  const rows = Array.from(doc?.querySelectorAll('.listing-details-wrapper .detail-row') || [])
  for (const row of rows as any[]) {
    const label = (row.querySelector('.detail-label')?.textContent || '').replace(/\s+/g, ' ').replace(/:$/, '').trim()
    const value = (row.querySelector('.detail-value')?.textContent || '').replace(/\s+/g, ' ').trim()
    if (label && value) specs[label] = value
  }

  // Y/M/M: prefer explicit spec table; if missing, fall back to meta description and H1.
  let year = parseNumberLoose(specs['Year'] || '') || null
  let make = cleanMakeName(specs['Make']) || null
  let model = cleanModelName(specs['Model']) || null

  // VIN might be incomplete on some classic listings; still pass through if present.
  const vinRaw = (specs['VIN'] || specs['Vin'] || '').trim()
  const vin = vinRaw ? vinRaw.toUpperCase() : null

  const mileage = parseNumberLoose(specs['Mileage'] || specs['Miles'] || specs['Odometer'] || '') || null

  // Pull best-available images.
  const imageCandidates: string[] = []
  const galleryImgs = Array.from(doc?.querySelectorAll('.gallery-item img, .gallery img, img') || [])
  for (const img of galleryImgs as any[]) {
    const src = (img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy') || '').trim()
    if (!src) continue
    if (!src.includes('galleria_images')) continue
    imageCandidates.push(promoteBeverlyHillsCarClubImageUrl(src))
  }

  // Some BHCC pages include hi-res URLs in anchors.
  const galleryLinks = Array.from(doc?.querySelectorAll('a[href*="galleria_images"]') || [])
  for (const a of galleryLinks as any[]) {
    const href = (a.getAttribute('href') || '').trim()
    if (!href) continue
    imageCandidates.push(promoteBeverlyHillsCarClubImageUrl(href))
  }

  const images = normalizeImageUrls(imageCandidates)

  const description =
    (doc?.querySelector('.listing-description')?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim() || null

  // Multi-word makes are common on BHCC. Prefer matching known multiword makes first.
  // (This is a pragmatic bridge until the OEM reference library is in place.)
  const MULTIWORD_MAKES = [
    'Mercedes-Benz',
    'Alfa Romeo',
    'Aston Martin',
    'Rolls-Royce',
    'Land Rover',
    'Range Rover',
    'Austin Healey',
    'Auto Union',
    'De Tomaso',
    'Willys Jeep',
  ]

  function parseYmmFromTitleLike(s: string): { year: number | null; make: string | null; model: string | null } {
    const cleaned = (s || '').replace(/\s+/g, ' ').trim()
    const m = cleaned.match(/^(\d{4})\s+(.+)$/)
    if (!m) return { year: null, make: null, model: null }
    const y = parseInt(m[1], 10)
    const rest = (m[2] || '').trim()
    if (!rest) return { year: Number.isFinite(y) ? y : null, make: null, model: null }

    for (const candidate of MULTIWORD_MAKES) {
      if (rest.toLowerCase().startsWith(candidate.toLowerCase() + ' ')) {
        const mm = rest.slice(candidate.length).trim()
        return {
          year: Number.isFinite(y) ? y : null,
          make: cleanMakeName(candidate),
          model: cleanModelName(mm),
        }
      }
    }

    const parts = rest.split(/\s+/).filter(Boolean)
    if (parts.length < 2) return { year: Number.isFinite(y) ? y : null, make: cleanMakeName(rest), model: null }
    const mk = parts[0]
    const mdl = parts.slice(1).join(' ')
    return {
      year: Number.isFinite(y) ? y : null,
      make: cleanMakeName(mk),
      model: cleanModelName(mdl),
    }
  }

  // Meta description is very reliable: "Used 1955 Mercedes-Benz 190SL Stock # 1068 ..."
  if ((!year || !make || !model) && metaDesc) {
    const md = metaDesc.match(/Used\s+(\d{4})\s+(.+?)\s+Stock\s*#\s*\d+/i)
    if (md?.[1] && md?.[2]) {
      const parsed = parseYmmFromTitleLike(`${md[1]} ${md[2]}`)
      year = year || parsed.year
      make = make || parsed.make
      model = model || parsed.model
    }
  }

  // If still missing, parse from H1 text.
  if ((!year || !make || !model) && title) {
    const parsed = parseYmmFromTitleLike(title)
    year = year || parsed.year
    make = make || parsed.make
    model = model || parsed.model
  }

  const bhcc_stockno = extractBhccStockNoFromHtml(html)

  return {
    source: 'beverlyhillscarclub',
    title,
    year: year || null,
    make: make || null,
    model: model || null,
    vin,
    asking_price: parseNumberLoose(priceText),
    mileage,
    images,
    thumbnail_url: images[0] || null,
    bhcc_stockno,
    specs,
    description,
  }
}

function parseNumberLoose(raw: string): number | null {
  const s = (raw || '').replace(/\u00a0/g, ' ').trim()
  if (!s) return null
  // Remove currency/units and keep digits (including spaces that might be in formatted numbers like "53 171 km").
  const digits = s.replace(/[^\d]/g, '').replace(/\s+/g, '')
  if (!digits) return null
  const n = parseInt(digits, 10)
  return Number.isFinite(n) ? n : null
}

function splitLinesFromHtml(html: string): string[] {
  return (html || '')
    .replace(/\r/g, '')
    .split(/<br\s*\/?>/i)
    .map((x) => x.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function parseLartFiche(html: string, url: string): any {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const brand = doc?.querySelector('.carDetails-brand')?.textContent?.trim() || ''
  const modelRaw = doc?.querySelector('.carDetails-model')?.textContent?.trim() || ''
  const title = [brand, modelRaw].filter(Boolean).join(' ').trim()

  // Extract year from model name (e.g. "911 2.0L 1965" -> year: 1965, model: "911 2.0L")
  // Also try to extract from URL slug or registration date
  let year: number | null = null
  let cleanedModel = modelRaw
  
  // Try to extract year from model name (look for 4-digit year at the end)
  const yearMatch = modelRaw.match(/\b(19|20)\d{2}\b/)
  if (yearMatch) {
    year = parseInt(yearMatch[0], 10)
    if (Number.isFinite(year) && year >= 1885 && year <= new Date().getFullYear() + 1) {
      // Remove year from model name
      cleanedModel = modelRaw.replace(/\s*\b(19|20)\d{2}\b\s*$/, '').trim()
    } else {
      year = null
    }
  }

  // Listing status: on sold listings, L'Art renders a badge (e.g. "Sold" / "Vendu")
  // inside the price block. This is more reliable than URL patterns.
  const soldBadgeText =
    (doc?.querySelector('.carDetail.-price .dataList-value--special')?.textContent ||
      doc?.querySelector('.dataList-value--special')?.textContent ||
      '').replace(/\s+/g, ' ').trim()
  const soldBadgeLower = soldBadgeText.toLowerCase()
  const isSold =
    soldBadgeLower === 'sold' ||
    soldBadgeLower === 'vendu' ||
    soldBadgeLower.includes('sold') ||
    soldBadgeLower.includes('vendu')

  // Hi-res images are in data-big/href; thumbnails are in src with Cloudinary transforms.
  const hiRes: string[] = []
  const thumbs: string[] = []
  const seenHi = new Set<string>()
  const seenTh = new Set<string>()
  const imgs = Array.from(doc?.querySelectorAll('img.carouselPicture') || [])
  for (const img of imgs as any[]) {
    const big = (img.getAttribute('data-big') || img.getAttribute('href') || '').trim()
    const src = (img.getAttribute('src') || '').trim()
    if (big && big.startsWith('http') && !seenHi.has(big)) {
      hiRes.push(big)
      seenHi.add(big)
    }
    if (src && src.startsWith('http') && !seenTh.has(src)) {
      thumbs.push(src)
      seenTh.add(src)
    }

    // Fallback: derive original Cloudinary URL from transformed thumbnail src.
    // Example:
    //   .../image/upload/c_fill,g_center,h_467,w_624/v172.../file.jpg
    // ->.../image/upload/v172.../file.jpg
    if (src && src.includes('res.cloudinary.com') && src.includes('/image/upload/')) {
      const httpsSrc = src.startsWith('http://res.cloudinary.com/') ? ('https://' + src.slice('http://'.length)) : src
      const m = httpsSrc.match(/^(https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)([^/]+\/)?(v\d+\/.+)$/i)
      if (m && m[1] && m[3]) {
        const candidate = `${m[1]}${m[3]}`
        if (candidate.startsWith('http') && !seenHi.has(candidate)) {
          hiRes.push(candidate)
          seenHi.add(candidate)
        }
      }
    }
  }

  // Parse label/value pairs
  const dl = doc?.querySelector('dl.dataList')
  const dts = Array.from(dl?.querySelectorAll('dt') || [])
  const ddByLabel = new Map<string, any>()
  for (const dt of dts as any[]) {
    const label = (dt.textContent || '').replace(/\s+/g, ' ').trim()
    let dd = dt.nextElementSibling
    while (dd && dd.tagName !== 'DD') dd = dd.nextElementSibling
    if (label && dd) ddByLabel.set(label.toLowerCase(), dd)
  }

  const priceText = ddByLabel.get('prix')?.textContent || ''
  const mileageText = ddByLabel.get('km')?.textContent || ''
  const colorsText = ddByLabel.get('couleurs')?.textContent || ''
  const fuelText = ddByLabel.get('energie')?.textContent || ''
  const transmissionText = ddByLabel.get('boîte de vitesse')?.textContent || ddByLabel.get('boite de vitesse')?.textContent || ''
  const regDateText = ddByLabel.get('date de mise en circulation')?.textContent || ''

  // If year not extracted from model, try to extract from registration date (e.g. "28/09/65" -> 1965)
  if (!year && regDateText) {
    // Handle DD/MM/YY or DD/MM/YYYY formats
    const dateMatch = regDateText.match(/\/(\d{2,4})$/)
    if (dateMatch) {
      let yearCandidate = parseInt(dateMatch[1], 10)
      if (yearCandidate < 100) {
        // Two-digit year: assume 1900s for years > 50, 2000s for years <= 50
        yearCandidate = yearCandidate > 50 ? 1900 + yearCandidate : 2000 + yearCandidate
      }
      if (Number.isFinite(yearCandidate) && yearCandidate >= 1885 && yearCandidate <= new Date().getFullYear() + 1) {
        year = yearCandidate
      }
    }
  }

  // Also try extracting year from URL slug (e.g. "porsche-911-2-0l-1965")
  if (!year) {
    const urlYearMatch = url.match(/-(\d{4})(?:[\/\?]|$)/)
    if (urlYearMatch) {
      const urlYear = parseInt(urlYearMatch[1], 10)
      if (Number.isFinite(urlYear) && urlYear >= 1885 && urlYear <= new Date().getFullYear() + 1) {
        year = urlYear
      }
    }
  }

  const optionsDd = ddByLabel.get('options')
  const optionsHtml = optionsDd?.innerHTML || ''
  const options = splitLinesFromHtml(optionsHtml)

  const infoDd = ddByLabel.get('informations')
  const infoHtml = infoDd?.innerHTML || ''
  const infoParts = infoHtml.split(/<hr\s*\/?>/i)
  const frHtml = infoParts[0] || ''
  const enHtml = infoParts.slice(1).join('<hr>') || ''

  // Pull paragraphs in order from FR section
  const frDoc = new DOMParser().parseFromString(`<div>${frHtml}</div>`, 'text/html')
  const frParas = Array.from(frDoc?.querySelectorAll('p') || []).map((p: any) => (p.textContent || '').trim()).filter(Boolean)

  // First paragraph is typically bullet-ish (br-delimited in source); use HTML splitter for fidelity.
  const frBullets = splitLinesFromHtml(frHtml).slice(0, 20) // bounded

  // Service history: find the paragraph after "Suivi et entretien"
  let serviceHistory: string[] = []
  const followIdx = frParas.findIndex((p) => p.toLowerCase().includes('suivi') && p.toLowerCase().includes('entretien'))
  if (followIdx >= 0 && frParas[followIdx + 1]) {
    serviceHistory = frParas[followIdx + 1]
      .split(/\n|<br\s*\/?>/i)
      .map((x) => x.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  }

  // Narrative description: take paragraphs after service history block.
  const narrativeStart = followIdx >= 0 ? Math.min(frParas.length, followIdx + 2) : 0
  const descriptionFr = frParas.slice(narrativeStart).join('\n\n').trim()

  const enDoc = new DOMParser().parseFromString(`<div>${enHtml}</div>`, 'text/html')
  const enParas = Array.from(enDoc?.querySelectorAll('p') || []).map((p: any) => (p.textContent || '').trim()).filter(Boolean)
  const descriptionEn = enParas.join('\n\n').trim()

  return {
    source: "lartdelautomobile",
    title,
    year: year || null,
    make: cleanMakeName(brand) || brand || null,
    model: cleanModelName(cleanedModel) || cleanedModel || null,
    // Status flags used by import queue to correctly tag dealer_inventory + org relationships
    listing_status: isSold ? 'sold' : 'in_stock',
    status: isSold ? 'sold' : null,
    sold: isSold,
    is_sold: isSold,
    sold_badge: soldBadgeText || null,
    asking_price: parseNumberLoose(priceText),
    mileage: parseNumberLoose(mileageText),
    // Also map into canonical vehicle fields used elsewhere (best-effort).
    fuel_type: fuelText ? fuelText.replace(/\s+/g, ' ').trim() : null,
    color: colorsText ? colorsText.replace(/\s+/g, ' ').trim() : null,
    colors: colorsText ? colorsText.replace(/\s+/g, ' ').trim() : null,
    fuel: fuelText ? fuelText.replace(/\s+/g, ' ').trim() : null,
    transmission: transmissionText ? transmissionText.replace(/\s+/g, ' ').trim() : null,
    registration_date: regDateText ? regDateText.replace(/\s+/g, ' ').trim() : null,
    options,
    info_bullets: frBullets,
    service_history: serviceHistory,
    description_fr: descriptionFr || null,
    description_en: descriptionEn || null,
    images_hi_res: hiRes,
    image_thumbnails: thumbs,
  }
}

// ScraperAPI fallback for sites with PerimeterX (like KSL)
async function tryScraperAPI(url: string): Promise<string | null> {
  const SCRAPERAPI_KEY = Deno.env.get('SCRAPERAPI_KEY')
  if (!SCRAPERAPI_KEY) {
    console.log('⚠️  SCRAPERAPI_KEY not set, skipping ScraperAPI fallback')
    return null
  }

  try {
    console.log('🔧 Trying ScraperAPI to bypass PerimeterX...')
    // ScraperAPI automatically rotates proxies and handles JavaScript rendering
    const scraperUrl = `http://api.scraperapi.com?api_key=${SCRAPERAPI_KEY}&url=${encodeURIComponent(url)}&render=true&premium=true`
    
    const response = await fetch(scraperUrl, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })

    if (!response.ok) {
      console.warn(`⚠️  ScraperAPI HTTP error ${response.status}`)
      return null
    }

    const html = await response.text()
    
    // Check if we got a block page
    if (html && (
      html.includes('PerimeterX') ||
      html.includes('Access to this page has been denied') ||
      html.includes('_pxCustomLogo')
    )) {
      console.warn('⚠️  ScraperAPI also got blocked by PerimeterX')
      return null
    }

    if (html && html.length > 1000) {
      console.log(`✅ ScraperAPI returned HTML (${html.length} chars)`)
      return html
    }

    return null
  } catch (e: any) {
    console.warn(`⚠️  ScraperAPI exception: ${e?.message || String(e)}`)
    return null
  }
}

// Try Firecrawl Stealth Mode for PerimeterX bypass (5 credits per request)
async function tryFirecrawlStealth(url: string): Promise<string | null> {
  const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY')
  if (!FIRECRAWL_API_KEY) return null

  try {
    console.log('🥷 Trying Firecrawl STEALTH MODE for PerimeterX bypass...')
    
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify({
        url,
        formats: ['html'], // Only need HTML for image extraction
        
        // CRITICAL: Stealth proxy mode for PerimeterX bypass
        proxy: 'stealth', // Uses residential proxies + advanced fingerprinting
        
        onlyMainContent: false,
        timeout: 90000, // Longer timeout for stealth mode
        waitFor: 15000, // Wait for page to fully load
        removeBase64Images: false,
        
        // Actions to load lazy-loaded gallery images
        actions: [
          {
            type: 'wait',
            milliseconds: 8000,
          },
          {
            type: 'scroll',
            direction: 'down',
            pixels: 1000,
          },
          {
            type: 'wait',
            milliseconds: 3000,
          },
          {
            type: 'scroll',
            direction: 'down',
            pixels: 2000,
          },
          {
            type: 'wait',
            milliseconds: 5000,
          },
        ],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      console.warn(`⚠️  Firecrawl stealth HTTP error ${response.status}: ${errorText?.slice(0, 200)}`)
      return null
    }

    const data = await response.json()
    const html = data?.data?.html

    if (!data?.success) {
      console.warn(`⚠️  Firecrawl stealth failed: ${JSON.stringify(data)?.slice(0, 300)}`)
      // Check if we still got HTML despite failure
      if (html && html.length > 1000) {
        console.log(`📄 Firecrawl stealth reported failure but we have HTML (${html.length} chars)`)
      } else {
        return null
      }
    }

    if (!html || html.length < 100) {
      console.warn('⚠️  Firecrawl stealth returned no HTML')
      return null
    }

    // Check if still blocked
    if (html.includes('PerimeterX') || html.includes('_pxCustomLogo') || html.includes('Access to this page has been denied')) {
      console.warn('⚠️  Firecrawl stealth still got blocked by PerimeterX')
      // But still return the HTML - we can extract the one image from block page
      return html
    }

    console.log(`✅ Firecrawl STEALTH MODE returned HTML (${html.length} chars)`)
    return html
  } catch (e: any) {
    console.warn(`⚠️  Firecrawl stealth exception: ${e?.message || String(e)}`)
    return null
  }
}

async function tryFirecrawl(url: string): Promise<any | null> {
  const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY')
  if (!FIRECRAWL_API_KEY) return null

  const extractionSchema = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      year: { type: 'number' },
      make: { type: 'string' },
      model: { type: 'string' },
      trim: { type: 'string' },
      vin: { type: 'string' },
      asking_price: { type: 'number' },
      price: { type: 'number' },
      mileage: { type: 'number' },
      location: { type: 'string' },
      description: { type: 'string' },
      thumbnail_url: { type: 'string' },
      images: {
        type: 'array',
        items: { type: 'string' },
      },
    },
  }

  // For KSL, try multiple strategies to bypass PerimeterX
  const isKsl = url.includes('ksl.com')
  
  try {
    // Strategy 1: Enhanced scrape with mobile mode and longer waits for KSL
    const scrapeConfig: any = {
      url,
      formats: ['extract', 'html'],
      extract: { schema: extractionSchema },
      onlyMainContent: false,
    }

    if (isKsl) {
      // Enhanced KSL-specific settings to bypass PerimeterX
      scrapeConfig.mobile = false // Desktop mode sometimes works better
      scrapeConfig.waitFor = 15000 // Longer initial wait for PerimeterX challenge
      scrapeConfig.actions = [
        {
          type: 'wait',
          milliseconds: 8000, // Long wait for PerimeterX challenge to resolve
        },
        {
          type: 'scroll',
          direction: 'down',
          pixels: 500,
        },
        {
          type: 'wait',
          milliseconds: 3000,
        },
        {
          type: 'scroll',
          direction: 'down',
          pixels: 1000,
        },
        {
          type: 'wait',
          milliseconds: 3000,
        },
        {
          type: 'scroll',
          direction: 'down',
          pixels: 2000,
        },
        {
          type: 'wait',
          milliseconds: 4000, // Final wait for gallery to load
        },
      ]
      
      scrapeConfig.pageOptions = {
        waitFor: 12000,
        waitUntil: 'networkidle',
      }
      
      scrapeConfig.headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://www.google.com/',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
      }
    } else {
      // Standard settings for other sites
      scrapeConfig.waitFor = 8000
      scrapeConfig.actions = [
        {
          type: 'wait',
          milliseconds: 3000,
        },
        {
          type: 'scroll',
          direction: 'down',
          pixels: 2000,
        },
        {
          type: 'wait',
          milliseconds: 3000,
        },
      ]
    }

    const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify(scrapeConfig),
    })

    if (!firecrawlResponse.ok) {
      const errorText = await firecrawlResponse.text().catch(() => '')
      console.warn(`⚠️  Firecrawl HTTP error ${firecrawlResponse.status}: ${errorText?.slice(0, 200) || ''}`)
      
      // For 403/blocked responses, sometimes Firecrawl still returns HTML (the block page)
      // Try to get it if available
      if (firecrawlResponse.status === 403 || firecrawlResponse.status === 429) {
        try {
          const errorData = JSON.parse(errorText || '{}')
          if (errorData?.data?.html) {
            console.log(`📄 Got HTML from blocked response, will try to extract...`)
            return { _firecrawl_html: errorData.data.html, _is_blocked: true }
          }
        } catch (e) {
          // Not JSON or no HTML, continue
        }
      }
      
      return null
    }

    const firecrawlData = await firecrawlResponse.json()
    const extract = firecrawlData?.data?.extract || null
    const html = firecrawlData?.data?.html || null
    
    // Even if Firecrawl reports failure, try to extract from HTML if available
    // (sometimes blocked pages still contain useful HTML)
    if (!firecrawlData?.success) {
      console.warn(`⚠️  Firecrawl reported failure: ${JSON.stringify(firecrawlData)?.slice(0, 300)}`)
      // Still try to extract from HTML if we have it (block pages often have some HTML)
      if (!html || html.length < 100) {
        console.warn('No HTML available from Firecrawl, returning null')
        return null
      }
      console.log(`📄 Firecrawl failed but we have HTML (${html.length} chars), will try to extract...`)
    }
    
    // Check if KSL blocked the request (block page detection)
    const isBlocked = html && (
      html.includes('Blocked Request Notification') || 
      html.includes('forbiddenconnection@deseretdigital.com') ||
      html.includes('Access to this page has been denied') ||
      html.includes('PerimeterX') ||
      html.includes('_pxCustomLogo') ||
      (extract?.title && (extract.title.includes('Blocked') || extract.title.includes('Error') || extract.title.includes('Denied')))
    )
    
    if (isBlocked && isKsl) {
      console.warn('⚠️  Firecrawl returned KSL block page (PerimeterX detected) - trying fallback strategies...')
      
      // Strategy 2: Try to extract listing ID and construct image URLs
      const listingIdMatch = url.match(/listing\/(\d+)/)
      if (listingIdMatch) {
        const listingId = listingIdMatch[1]
        console.log(`📋 Found KSL listing ID: ${listingId}, attempting image URL construction...`)
        
        // KSL image pattern: https://img.ksl.com/slc/{first3}/{middle3}/{full}.{ext}
        // Based on the one image we found: img.ksl.com/slc/2865/286508/28650891.png
        // We can try to construct potential image URLs
        // But this is limited - we'd need the actual image IDs
        
        // Try to extract any image URLs from the block page HTML itself
        const blockPageImages: string[] = []
        if (html) {
          // Look for any img.ksl.com references in the HTML (even in block page)
          const kslImgRegex = /https?:\/\/img\.(?:ksl\.com|ksldigital\.com)\/[^\s"<>]+\.(?:jpg|jpeg|png|webp|gif)/gi
          let match
          while ((match = kslImgRegex.exec(html)) !== null) {
            blockPageImages.push(match[0])
          }
          
          // Also try to extract from window._pxCustomLogo or other JS variables
          const logoMatch = html.match(/window\._pxCustomLogo\s*=\s*['"]([^'"]+)['"]/)
          if (logoMatch && logoMatch[1]) {
            blockPageImages.push(logoMatch[1])
          }
          
          // Look for image patterns in script tags
          const scriptMatches = html.matchAll(/"https?:\/\/img\.(?:ksl\.com|ksldigital\.com)[^"]+"/gi)
          for (const m of scriptMatches) {
            blockPageImages.push(m[0].replace(/^["']|["']$/g, ''))
          }
        }
        
        if (blockPageImages.length > 0) {
          console.log(`✅ Found ${blockPageImages.length} image reference(s) in block page`)
          // Return what we found even if blocked
          return {
            ...(extract || {}),
            images: [...new Set(blockPageImages)],
            _firecrawl_html: html,
            _is_blocked: true,
            _source: 'block_page_extraction'
          }
        }
      }
    }
    
    // Return both extract and HTML so we can extract images from HTML if extract doesn't have them
    // Even if extract is empty, return HTML for extraction
    const result = { ...(extract || {}), _firecrawl_html: html, _is_blocked: isBlocked || false }
    if (!extract || typeof extract !== 'object') {
      // Still return HTML for extraction even if extract failed
      return html ? result : null
    }
    
    // Attach HTML to extract object so caller can use it
    return result
  } catch (e: any) {
    console.warn(`Firecrawl exception: ${e?.message || String(e)}`)
    return null
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { url } = await req.json()

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    console.log('🔍 Scraping URL:', url)

    // Initialize Supabase client for schema lookup
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    let supabase = null;
    try {
      supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
    } catch (e: any) {
      console.warn('Failed to initialize Supabase client:', e?.message);
      supabase = null;
    }

    // Robust path: Firecrawl structured extraction first (works better on JS-heavy dealer sites).
    let firecrawlResult: any = null
    let firecrawlExtract: any = null
    let firecrawlHtml: string | null = null
    
    try {
      firecrawlResult = await tryFirecrawl(url)
      firecrawlExtract = firecrawlResult && typeof firecrawlResult === 'object' && !firecrawlResult._firecrawl_html
        ? { ...firecrawlResult }
        : firecrawlResult && typeof firecrawlResult === 'object'
          ? Object.fromEntries(Object.entries(firecrawlResult).filter(([k]) => k !== '_firecrawl_html' && k !== '_is_blocked'))
          : null
      firecrawlHtml = firecrawlResult?._firecrawl_html || null
    } catch (e: any) {
      console.warn(`⚠️  Firecrawl call failed: ${e?.message || String(e)}`)
      // Continue without Firecrawl - will try direct fetch or HTML parsing
    }
    // Remove internal field from extract
    if (firecrawlExtract && '_firecrawl_html' in firecrawlExtract) {
      delete firecrawlExtract._firecrawl_html
    }

    let html = firecrawlHtml || ''
    let doc: any = null

    // Fallback path: fetch and parse HTML
    // NOTE: Some sites (like lartdelautomobile.com) require HTML parsing even when Firecrawl returns extract,
    // because the page contains hi-res image URLs in data attributes.
    const needsHtmlParse = url.includes('lartdelautomobile.com') || url.includes('beverlyhillscarclub.com')
    // For KSL, always use HTML from Firecrawl for image extraction (even if extract exists)
    // If Firecrawl failed for KSL, try direct fetch (even if blocked, we might get block page HTML with image refs)
    const isKsl = url.includes('ksl.com')
    const needsKslHtmlParse = isKsl && firecrawlHtml
    const needsKslFallback = isKsl && !firecrawlHtml && !firecrawlExtract // KSL and Firecrawl completely failed
    
    if (!html && (!firecrawlExtract || needsHtmlParse || needsKslFallback)) {
      // Strategy 1: Try Playwright service for KSL (proven to bypass PerimeterX)
      if (needsKslFallback) {
        const playwrightUrl = Deno.env.get('PLAYWRIGHT_SERVICE_URL')
        if (playwrightUrl) {
          try {
            console.log(`🥷 Calling Playwright service for KSL...`)
            const playwrightResponse = await fetch(`${playwrightUrl}/scrape-listing`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url }),
              signal: AbortSignal.timeout(120000), // 2 min timeout
            })
            
            if (playwrightResponse.ok) {
              const playwrightData = await playwrightResponse.json()
              if (playwrightData?.success && playwrightData?.data) {
                html = playwrightData.data.html
                data.images = playwrightData.data.images || []
                data.title = playwrightData.data.title
                data.year = playwrightData.data.year
                data.make = playwrightData.data.make
                data.model = playwrightData.data.model
                data.vin = playwrightData.data.vin
                data.mileage = playwrightData.data.mileage
                data.asking_price = playwrightData.data.asking_price
                console.log(`✅ Playwright service: ${data.images.length} images, ${html.length} chars HTML`)
              }
            }
          } catch (e: any) {
            console.warn(`⚠️  Playwright service failed: ${e?.message}`)
          }
        }
      }
      
      // Strategy 2: Try Firecrawl stealth as fallback
      if (!html && needsKslFallback) {
        const stealthHtml = await tryFirecrawlStealth(url)
        if (stealthHtml && stealthHtml.length > 100) {
          html = stealthHtml
          console.log(`✅ Using Firecrawl STEALTH MODE HTML for KSL (${html.length} chars)`)
        }
      }
      
      // Strategy 3: Direct fetch (last resort)
      if (!html) {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        })

        // Even if response is not ok (403/blocked), try to get HTML (might be block page with image refs)
        if (!response.ok) {
          if (needsKslFallback && (response.status === 403 || response.status === 429)) {
            // For KSL, even blocked responses might have HTML with image references
            try {
              const blockedHtml = await response.text()
              if (blockedHtml && blockedHtml.length > 100) {
                console.log(`⚠️  Got blocked response (${response.status}) but extracting from HTML (${blockedHtml.length} chars)...`)
                html = blockedHtml
              } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`)
              }
            } catch (e) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`)
            }
          } else {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }
        } else {
          html = await response.text()
        }
      }
      try {
        doc = new DOMParser().parseFromString(html, 'text/html')
        if (!doc) {
          console.warn('Failed to parse HTML document');
        }
      } catch (parseError: any) {
        console.warn('HTML parsing error:', parseError?.message);
        doc = null;
      }
    }

    if (!doc && html) {
      try {
        doc = new DOMParser().parseFromString(html, 'text/html')
        if (!doc) {
          console.warn('Failed to parse HTML document');
        }
      } catch (parseError: any) {
        console.warn('HTML parsing error:', parseError?.message);
        doc = null;
      }
    }

    // Check for registered extraction patterns for this domain
    let domain = '';
    let registeredSchema = null;
    try {
      domain = new URL(url).hostname.replace(/^www\./, '');
      if (supabase) {
        const schemaResponse = await supabase
          .from('source_site_schemas')
          .select('schema_data, site_name')
          .eq('domain', domain)
          .single();
        if (schemaResponse.data && !schemaResponse.error) {
          registeredSchema = schemaResponse.data;
          console.log(`📋 Found registered schema for ${domain}: ${registeredSchema.site_name}`);
        }
      }
    } catch (e: any) {
      // Non-critical - continue with generic extraction
      console.log(`No registered schema for ${domain || 'unknown domain'}, using generic extraction`);
    }

    // Extract sidebar data if doc is available (Classic.com, Hagerty, etc.)
    let sidebarData = null;
    let tableData = null;
    let descriptionText = '';
    let descriptionData = null;
    
    try {
      sidebarData = doc ? extractSidebarData(doc) : null;
    } catch (e: any) {
      console.warn('Error extracting sidebar data:', e?.message);
    }
    
    try {
      tableData = doc ? extractTableData(doc) : null;
    } catch (e: any) {
      console.warn('Error extracting table data:', e?.message);
    }
    
    try {
      if (doc) {
        if (url.includes('rmsothebys.com')) {
          const rmBlocks = Array.from(doc.querySelectorAll('.body-text--copy'));
          const rmText = rmBlocks
            .map((block: any) => (block.textContent || '').replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .join('\n\n');
          if (rmText) {
            descriptionText = rmText;
          }
        }

        if (!descriptionText) {
          const descriptionEl = doc.querySelector('.description, [class*="description"], .listing-description, .vehicle-description');
          descriptionText = descriptionEl?.textContent?.trim() || '';
        }
      }

      descriptionData = descriptionText ? extractDescriptionData(descriptionText) : null;
    } catch (e: any) {
      console.warn('Error extracting description:', e?.message);
    }

    // Basic data extraction (normalized output shape)
    const data: any = {
      success: true,
      source: 'Unknown',
      listing_url: url,
      discovery_url: url,
      title: firecrawlExtract?.title || doc?.querySelector('title')?.textContent || '',
      description: '', // Initialize with empty string to prevent undefined
      images: [],
      timestamp: new Date().toISOString(),
      year: tableData?.year || null,
      make: tableData?.make || null,
      model: tableData?.model || null,
      asking_price: tableData?.price || sidebarData?.price || null,
      mileage: tableData?.mileage || sidebarData?.mileage || null,
      transmission: tableData?.transmission || sidebarData?.transmission || null,
      drivetrain: tableData?.driveType || null,
      seats: tableData?.seats || null,
      doors: tableData?.doors || null,
      fuel_type: tableData?.fuelType || null,
      color: descriptionData?.exteriorColor || null,
      interior_color: descriptionData?.interiorColor || null,
      engine: descriptionData?.engine || null,
      msrp: descriptionData?.originalMsrp || null,
      features: descriptionData?.features || [],
      condition: descriptionData?.condition || sidebarData?.condition || null,
      description: descriptionText || '',
      location: null,
      thumbnail_url: null,
      _function_version: firecrawlExtract ? '2.1-firecrawl' : '2.1-html'  // Debug version identifier
    }

    // If Firecrawl returned structured fields, use them as the primary truth.
    if (firecrawlExtract) {
      data.source = 'Firecrawl'
      data.year = typeof firecrawlExtract.year === 'number' ? firecrawlExtract.year : null
      data.make = cleanMakeName(firecrawlExtract.make) || null
      data.model = cleanModelName(firecrawlExtract.model) || null
      data.vin = firecrawlExtract.vin ? String(firecrawlExtract.vin).toUpperCase() : null
      data.asking_price =
        typeof firecrawlExtract.asking_price === 'number'
          ? firecrawlExtract.asking_price
          : typeof firecrawlExtract.price === 'number'
            ? firecrawlExtract.price
            : tableData?.price || sidebarData?.price || null
      data.year = typeof firecrawlExtract.year === 'number' ? firecrawlExtract.year : tableData?.year || data.year
      data.make = cleanMakeName(firecrawlExtract.make) || tableData?.make || data.make
      data.model = cleanModelName(firecrawlExtract.model) || tableData?.model || data.model
      data.mileage = typeof firecrawlExtract.mileage === 'number' ? firecrawlExtract.mileage : tableData?.mileage || sidebarData?.mileage || null
      data.transmission = firecrawlExtract.transmission ? String(firecrawlExtract.transmission).trim() : tableData?.transmission || sidebarData?.transmission || null
      data.drivetrain = firecrawlExtract.drivetrain ? String(firecrawlExtract.drivetrain).trim() : tableData?.driveType || data.drivetrain
      data.seats = typeof firecrawlExtract.seats === 'number' ? firecrawlExtract.seats : tableData?.seats || data.seats
      data.doors = typeof firecrawlExtract.doors === 'number' ? firecrawlExtract.doors : tableData?.doors || data.doors
      data.fuel_type = firecrawlExtract.fuel_type ? String(firecrawlExtract.fuel_type).trim() : tableData?.fuelType || data.fuel_type
      data.location = firecrawlExtract.location ? String(firecrawlExtract.location).trim() : null
      const firecrawlDescription = firecrawlExtract.description ? String(firecrawlExtract.description).trim() : ''
      if (firecrawlDescription) {
        data.description = firecrawlDescription
      }
      data.thumbnail_url = firecrawlExtract.thumbnail_url ? String(firecrawlExtract.thumbnail_url).trim() : null

      const imgs = normalizeImageUrls([
        ...(data.thumbnail_url ? [data.thumbnail_url] : []),
        ...(Array.isArray(firecrawlExtract.images) ? firecrawlExtract.images : []),
      ])
      data.images = imgs
    }

    const isBatListing = url.includes('bringatrailer.com/listing/')
    const isRmsothebys = url.includes('rmsothebys.com')

    // BaT: never scan arbitrary <img> tags (sidebar ads/CTAs contaminate galleries).
    // Prefer the canonical gallery JSON embedded in #bat_listing_page_photo_gallery[data-gallery-items].
    if (isBatListing && html) {
      try {
        const bat = extractBatGalleryImagesFromHtml(html)
        if (bat && bat.length > 0) {
          data.images = normalizeImageUrls(bat)
        }
      } catch (e: any) {
        console.warn('Error extracting BaT gallery images:', e?.message);
      }
    }

    // If Firecrawl didn't yield images (or it wasn't used), use HTML extraction.
    // NOTE: For BaT listings, this is intentionally bypassed in favor of canonical gallery extraction above.
    // For KSL, ALWAYS try HTML extraction (critical - Firecrawl extract misses gallery images)
    // Even if Firecrawl was blocked, HTML might still have image references
    const shouldExtractFromHtml = (!data.images || data.images.length === 0)
      || (url.includes('ksl.com') && html && html.length > 200)
      || (isRmsothebys && html && html.length > 200)
    if (shouldExtractFromHtml && html) {
      try {
        console.log(`Extracting images from HTML (${html.length} chars) for ${url.includes('ksl.com') ? 'KSL' : isRmsothebys ? 'RM Sothebys' : 'non-KSL'} URL...`)
        // Pass the original URL for KSL so we can resolve relative paths and filter properly
        const extractedImages = extractImageURLs(html, url)
        console.log(`Extracted ${extractedImages?.length || 0} images from HTML`)
        if (extractedImages && extractedImages.length > 0) {
          const normalized = normalizeImageUrls(extractedImages)
          console.log(`After normalization: ${normalized.length} images`)
          // For KSL and RM Sothebys, merge HTML images with extracted images (HTML usually has the full gallery).
          if (url.includes('ksl.com') || isRmsothebys) {
            const combined = [...new Set([...normalized, ...(data.images || [])])]
            data.images = combined
            console.log(`Merged HTML images: ${combined.length} (${normalized.length} from HTML + ${(data.images || []).length} from extract)`)
          } else {
            data.images = normalized
          }

          if (!data.thumbnail_url && data.images.length > 0) {
            data.thumbnail_url = data.images[0]
          }
        }
      } catch (e: any) {
        console.warn('Error extracting images from HTML:', e?.message);
      }
    }

    // Site-specific: L'Art de l'Automobile (/fiche/*) has structured spec blocks + explicit hi-res image URLs.
    if (url.includes('lartdelautomobile.com/fiche/') && html) {
      try {
        const parsed = parseLartFiche(html, url)
        if (!parsed) {
          throw new Error('parseLartFiche returned null/undefined');
        }
        data.source = parsed.source || data.source
      data.title = parsed.title || data.title
      data.year = parsed.year ?? data.year
      data.make = parsed.make || data.make
      data.model = parsed.model || data.model
      data.asking_price = parsed.asking_price ?? data.asking_price
      data.mileage = parsed.mileage ?? data.mileage
      data.listing_status = parsed.listing_status ?? data.listing_status
      data.status = parsed.status ?? data.status
      data.sold = parsed.sold ?? data.sold
      data.is_sold = parsed.is_sold ?? data.is_sold
      data.sold_badge = parsed.sold_badge ?? data.sold_badge
      // Prefer French narrative as canonical description, but keep structured fields for repackaging.
      data.description = (parsed.description_fr || '').trim() || data.description || ''
      data.description_fr = parsed.description_fr
      data.description_en = parsed.description_en
      data.options = parsed.options
      data.info_bullets = parsed.info_bullets
      data.service_history = parsed.service_history
      data.colors = parsed.colors
      data.fuel_type = parsed.fuel_type || parsed.fuel
      data.transmission = parsed.transmission
      data.registration_date = parsed.registration_date

      const hires = normalizeImageUrls(parsed.images_hi_res || [])
      const thumbs = normalizeImageUrls(parsed.image_thumbnails || [])
      if (hires.length > 0) {
        data.images = hires
        data.thumbnail_url = thumbs[0] || hires[0] || data.thumbnail_url
      }
      data.image_thumbnails = thumbs
      } catch (e: any) {
        console.warn('Error parsing L\'Art de l\'Automobile listing:', e?.message);
      }
    }

    // Site-specific: Beverly Hills Car Club uses explicit galleria_images URLs and a structured details panel.
    // Firecrawl often under-returns hi-res images here, so prefer HTML parsing when available.
    if (url.includes('beverlyhillscarclub.com') && html) {
      try {
        const parsed = parseBeverlyHillsCarClubListing(html, url)
        if (!parsed) {
          throw new Error('parseBeverlyHillsCarClubListing returned null/undefined');
        }
      data.source = parsed.source
      data.title = parsed.title || data.title
      data.year = parsed.year ?? data.year
      data.make = parsed.make || data.make
      data.model = parsed.model || data.model
      data.vin = parsed.vin || data.vin
      data.asking_price = parsed.asking_price ?? data.asking_price
      data.mileage = parsed.mileage ?? data.mileage
      data.description = parsed.description || data.description || ''
      data.specs = parsed.specs
      data.bhcc_stockno = parsed.bhcc_stockno ?? data.bhcc_stockno
      if (Array.isArray(parsed.images) && parsed.images.length > 0) {
        data.images = parsed.images
        data.thumbnail_url = parsed.thumbnail_url || parsed.images[0] || data.thumbnail_url
      }

      // Dealer identity (critical for org extraction in process-import-queue when ingesting single listings).
      data.dealer_name = 'Beverly Hills Car Club'
      data.dealer_website = 'https://www.beverlyhillscarclub.com'
      } catch (e: any) {
        console.warn('Error parsing Beverly Hills Car Club listing:', e?.message);
      }
    }

    // Extract VIN from HTML - works for multiple sites
    if (html && !data.vin) {
      try {
        const vinPatterns = [
          // Pattern 1: Dealer listings with <span class="valu">VIN</span> (Jordan Motorsports pattern)
          /<span[^>]*class="[^"]*valu[^"]*"[^>]*>([A-HJ-NPR-Z0-9]{17})<\/span>/i,
          // Pattern 2: Worldwide Vintage Autos format: <div class="spec-line vin">VIN 1Z8749S420546</div>
          /<div[^>]*class="[^"]*spec-line[^"]*vin[^"]*"[^>]*>VIN\s+([A-HJ-NPR-Z0-9]{17})/i,
          // Pattern 3: General VIN pattern with class containing "vin"
          /<[^>]*class="[^"]*vin[^"]*"[^>]*>[\s\S]*?VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i,
          // Pattern 4: Simple VIN: pattern
          /VIN[:\s]+([A-HJ-NPR-Z0-9]{17})/i,
          // Pattern 5: Any 17-char alphanumeric near "VIN" text
          /VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i,
        ]

        for (const pattern of vinPatterns) {
          const match = html.match(pattern)
          if (match && match[1] && match[1].length === 17 && !/[IOQ]/.test(match[1])) {
            data.vin = match[1].toUpperCase()
            console.log(`✅ VIN extracted: ${data.vin}`)
            break
          }
        }
      } catch (e: any) {
        console.warn('Error extracting VIN:', e?.message);
      }
    }

    // Simple Craigslist detection and parsing
    if (url.includes('craigslist.org')) {
      data.source = 'Craigslist'

      // Extract title
      const titleElement = doc?.querySelector('h1 .postingtitletext')
      if (titleElement) {
        data.title = titleElement.textContent?.trim()
      }

      // Extract price
      const priceElement = doc?.querySelector('.price')
      let initialPrice: number | null = null
      if (priceElement) {
        const priceText = priceElement.textContent?.trim()
        const extractedPrice = extractVehiclePrice(priceText || '')
        if (extractedPrice) {
          initialPrice = extractedPrice
          data.asking_price = extractedPrice
        }
      }

      // Extract location
      const locationElement = doc?.querySelector('.postingtitle .postingtitletext small')
      if (locationElement) {
        data.location = locationElement.textContent?.trim().replace(/[()]/g, '')
      }

      // Extract description
      const bodyElement = doc?.querySelector('#postingbody')
      if (bodyElement) {
        data.description = bodyElement.textContent?.trim() || ''
        
        // IMPORTANT: Check description for price if:
        // 1. No price found yet, OR
        // 2. Price found is suspiciously low (< $3000) - Craigslist sellers often hide real price in description
        // This handles cases where seller puts fake/low price in price field but real price in description
        if (!data.asking_price || (initialPrice && initialPrice < 3000)) {
          const descPrice = extractVehiclePrice(data.description)
          if (descPrice && descPrice >= 1000) {
            // If description has a higher/valid price, prefer it (likely the real asking price)
            if (!data.asking_price || descPrice > (data.asking_price || 0)) {
              data.asking_price = descPrice
            }
          }
        }
      }

      // Extract dealer information from listing (for multi-city dealers like Jordan Motorsports)
      const dealerInfo = extractDealerInfo(html, data.description || '', data.title || '')
      if (dealerInfo.name) {
        data.dealer_name = dealerInfo.name
      }
      if (dealerInfo.website) {
        data.dealer_website = dealerInfo.website
      }
      if (dealerInfo.phone) {
        data.dealer_phone = dealerInfo.phone
      }

      // Extract basic vehicle info from title
      if (data.title) {
        const yearMatch = data.title.match(/\b(19|20)\d{2}\b/)
        if (yearMatch) {
          data.year = parseInt(yearMatch[0])
        }

        // Simple make/model extraction
        const parts = data.title.split(' ')
        if (parts.length >= 3) {
          // Skip year if it's the first part
          let startIndex = 0
          if (parts[0] && parts[0].match(/\b(19|20)\d{2}\b/)) {
            startIndex = 1
          }
          if (parts[startIndex]) data.make = parts[startIndex]
          if (parts[startIndex + 1]) data.model = parts[startIndex + 1]
        }
      }

      console.log('🔍 Craigslist extraction results:', {
        title: data.title,
        year: data.year,
        make: data.make,
        model: data.model,
        price: data.asking_price,
        location: data.location
      })
    }

    // Final normalization pass (regardless of source)
    // Normalize Mercedes-Benz variations BEFORE cleanMakeName
    if (data.make && (data.make.toLowerCase() === 'mercedes-benz' || data.make.toLowerCase() === 'mercedes' || data.make.toLowerCase() === 'mercedes benz')) {
      data.make = 'Mercedes-Benz'
    }
    data.make = cleanMakeName(data.make) || data.make
    data.model = cleanModelName(data.model) || data.model

    // Worldwide Vintage Autos detection and parsing
    if (url.includes('worldwidevintageautos.com')) {
      data.source = 'Worldwide Vintage Autos'

      // Extract title
      const titleElement = doc.querySelector('h1') || doc.querySelector('title')
      if (titleElement) {
        data.title = titleElement.textContent?.trim()
      }

      // Extract price
      const priceElement = doc.querySelector('.price') || doc.querySelector('[class*="price"]')
      if (priceElement) {
        const priceText = priceElement.textContent?.trim()
        const priceMatch = priceText?.match(/\$?([\d,]+)/)
        if (priceMatch) {
          data.asking_price = parseInt(priceMatch[1].replace(/,/g, ''))
        }
      }

      // Extract description - look for description divs or meta descriptions
      const descriptionElement = doc.querySelector('[class*="description"]') || 
                                 doc.querySelector('[id*="description"]') ||
                                 doc.querySelector('meta[name="description"]')
      if (descriptionElement) {
        if (descriptionElement.tagName === 'META') {
          data.description = descriptionElement.getAttribute('content')?.trim() || ''
        } else {
          data.description = descriptionElement.textContent?.trim() || ''
        }
      }

      // Also try to extract from spec lines (common format on dealer sites)
      const specLines = doc.querySelectorAll('[class*="spec"]')
      let descriptionParts: string[] = []
      specLines.forEach(spec => {
        const text = spec.textContent?.trim()
        if (text && text.length > 0 && !text.includes('VIN') && !text.includes('Price')) {
          descriptionParts.push(text)
        }
      })
      if (descriptionParts.length > 0 && !data.description) {
        data.description = descriptionParts.join(' ')
      }

      // Extract year, make, model from title
      if (data.title) {
        const yearMatch = data.title.match(/\b(19|20)\d{2}\b/)
        if (yearMatch) {
          data.year = parseInt(yearMatch[0])
        }

        const parts = data.title.split(' ')
        if (parts.length >= 3) {
          let startIndex = 0
          if (parts[0] && parts[0].match(/\b(19|20)\d{2}\b/)) {
            startIndex = 1
          }
          if (parts[startIndex]) data.make = parts[startIndex]
          if (parts[startIndex + 1]) data.model = parts.slice(startIndex + 1).join(' ')
        }
      }

      // Try to extract engine/transmission from description
      if (data.description) {
        // Engine patterns: "L82 350 V8", "350 V8", "5.7L V8", etc.
        const engineMatch = data.description.match(/([A-Z0-9]+\s*\d+\.?\d*\s*[LV]?\s*V?\d+)/i)
        if (engineMatch) {
          data.engine_type = engineMatch[1].trim()
        }

        // Transmission patterns: "AUTO", "AUTOMATIC", "MANUAL", "4-SPEED", etc.
        const transMatch = data.description.match(/\b(AUTO|AUTOMATIC|MANUAL|\d+-SPEED)\b/i)
        if (transMatch) {
          data.transmission = transMatch[1].toUpperCase()
          if (data.transmission === 'AUTO') {
            data.transmission = 'AUTOMATIC'
          }
        }
      }

      console.log('🔍 Worldwide Vintage Autos extraction results:', {
        title: data.title,
        year: data.year,
        make: data.make,
        model: data.model,
        vin: data.vin,
        price: data.asking_price,
        description: data.description?.substring(0, 100),
        engine_type: data.engine_type,
        transmission: data.transmission,
        imageCount: data.images?.length || 0
      })
    }

    // SBX Cars detection and parsing
    if (url.includes('sbxcars.com')) {
      data.source = 'SBX Cars'

      // Extract lot number from URL first (most reliable)
      const lotMatch = url.match(/\/listing\/(\d+)\//)
      if (lotMatch && lotMatch[1]) {
        data.lot_number = lotMatch[1]
      }

      // Extract year/make/model from URL slug (most reliable for SBX Cars)
      // URL pattern: /listing/{lot}/{year}-{make}-{model}-{rest}
      // Examples: 
      //   /listing/555/2024-mercedes-amg-gt-63-4matic (mercedes without benz)
      //   /listing/405/1987-mercedes-benz-300slr (mercedes-benz)
      //   /listing/564/1966-jaguar-xke-coupe-3-8l (single-word make)
      const urlSlugMatch = url.match(/\/listing\/\d+\/([^/?]+)/)
      if (urlSlugMatch && urlSlugMatch[1]) {
        const slug = urlSlugMatch[1]
        const slugParts = slug.split('-')
        
        // First part should be year
        if (slugParts.length > 0 && /^(19|20)\d{2}$/.test(slugParts[0])) {
          data.year = parseInt(slugParts[0])
          
          // Rest is make and model
          if (slugParts.length > 1) {
            // Handle Mercedes-Benz (two-word make: mercedes-benz)
            if (slugParts[1].toLowerCase() === 'mercedes' && slugParts.length > 2 && slugParts[2].toLowerCase() === 'benz') {
              data.make = 'Mercedes-Benz'
              data.model = slugParts.slice(3).join('-').replace(/-/g, ' ') || null
            } 
            // Handle Mercedes (without benz) - common in SBX Cars URLs
            else if (slugParts[1].toLowerCase() === 'mercedes' && slugParts.length > 2) {
              data.make = 'Mercedes-Benz' // Normalize to Mercedes-Benz
              // Capitalize model words properly (AMG, GT, etc. should be uppercase)
              const modelParts = slugParts.slice(2).map((part, idx) => {
                const lower = part.toLowerCase()
                // Keep common abbreviations uppercase
                if (['amg', 'gt', 'gts', 'gtr', 'gtrs', 'sl', 'sls', 'slr', 'cls', 'gl', 'gle', 'glc', 'gla', 'g', 's', 'e', 'c', 'a', 'b'].includes(lower)) {
                  return part.toUpperCase()
                }
                // Capitalize first letter
                return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
              })
              data.model = modelParts.join(' ') || null
            }
            // Single-word make
            else if (slugParts.length > 1) {
              // Capitalize first letter, lowercase rest for make
              const makeWord = slugParts[1]
              data.make = makeWord.charAt(0).toUpperCase() + makeWord.slice(1).toLowerCase()
              // Normalize common makes
              if (data.make.toLowerCase() === 'mercedes-benz' || data.make.toLowerCase() === 'mercedes') {
                data.make = 'Mercedes-Benz'
              }
              // Rest is model - capitalize properly
              if (slugParts.length > 2) {
                const modelParts = slugParts.slice(2).map((part, idx) => {
                  const lower = part.toLowerCase()
                  // Keep common abbreviations uppercase
                  if (['amg', 'gt', 'gts', 'gtr', 'gtrs', 'sl', 'sls', 'slr', 'cls', 'gl', 'gle', 'glc', 'gla', 'g', 's', 'e', 'c', 'a', 'b', 'xke', 'xkr', 'sv', 'gts', 'gtb', 'gto', 'gtr'].includes(lower)) {
                    return part.toUpperCase()
                  }
                  // Capitalize first letter
                  return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
                })
                data.model = modelParts.join(' ') || null
              }
            }
          }
        }
      }

      // Try to get title from page (more specific selectors to avoid site branding)
      const titleSelectors = [
        'h1[class*="listing"]',
        'h1[class*="title"]',
        '[class*="listing-title"]',
        '[class*="vehicle-title"]',
        'h1'
      ]
      
      let titleElement: any = null
      for (const selector of titleSelectors) {
        titleElement = doc?.querySelector(selector)
        if (titleElement) {
          const titleText = titleElement.textContent?.trim() || ''
          // Skip if it looks like site branding
          if (titleText && !titleText.toLowerCase().includes('sbx cars by supercar blondie')) {
            data.title = titleText
            break
          }
        }
      }

      // If we don't have year/make/model yet, try parsing from title
      if (data.title && (!data.year || !data.make || !data.model)) {
        const yearMatch = data.title.match(/\b(19|20)\d{2}\b/)
        if (yearMatch && !data.year) {
          data.year = parseInt(yearMatch[0])
        }

        const parts = data.title.split(/\s+/)
        if (parts.length >= 3) {
          const yearIndex = parts.findIndex((p) => /^(19|20)\d{2}$/.test(p))
          if (yearIndex >= 0 && yearIndex < parts.length - 1) {
            // Handle Mercedes-Benz (two words)
            if (parts[yearIndex + 1]?.toLowerCase() === 'mercedes' && parts[yearIndex + 2]?.toLowerCase() === 'benz') {
              if (!data.make) data.make = 'Mercedes-Benz'
              if (!data.model) data.model = parts.slice(yearIndex + 3).join(' ') || null
            } else {
              if (!data.make) data.make = parts[yearIndex + 1] || null
              if (!data.model) data.model = parts.slice(yearIndex + 2).join(' ') || null
            }
          }
        }
      }

      // Extract price/bid information
      const priceElement = doc?.querySelector('[class*="price"]') || doc?.querySelector('[class*="bid"]')
      if (priceElement) {
        const priceText = priceElement.textContent?.trim()
        const priceMatch = priceText?.match(/\$?([\d,]+)/)
        if (priceMatch) {
          data.asking_price = parseInt(priceMatch[1].replace(/,/g, ''))
        }
        const currencyCode = detectCurrencyCodeFromText(priceText)
        if (currencyCode) {
          data.currency_code = currencyCode
        }
      }

      // Extract auction end date
      const dateElement = doc?.querySelector('[class*="end"]') || doc?.querySelector('[class*="date"]')
      if (dateElement) {
        const dateText = dateElement.textContent?.trim()
        const dateMatch = dateText?.match(/(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})/)
        if (dateMatch) {
          data.auction_end_date = dateMatch[1]
        }
      }

      // Extract description
      const descriptionElement = doc?.querySelector('[class*="description"]')
      if (descriptionElement) {
        data.description = descriptionElement.textContent?.trim() || data.description
      }

      // Extract location
      const locationElement = doc?.querySelector('[class*="location"]')
      if (locationElement) {
        data.location = locationElement.textContent?.trim()
      }

      // Determine auction status
      const urlLower = url.toLowerCase()
      if (urlLower.includes('upcoming')) {
        data.auction_status = 'upcoming'
      } else if (urlLower.includes('live') || urlLower.includes('active')) {
        data.auction_status = 'live'
      } else if (urlLower.includes('ended') || urlLower.includes('sold')) {
        data.auction_status = 'ended'
      }

      console.log('🔍 SBX Cars extraction results:', {
        title: data.title,
        year: data.year,
        make: data.make,
        model: data.model,
        price: data.asking_price,
        lot_number: data.lot_number,
        auction_status: data.auction_status,
        imageCount: data.images?.length || 0
      })
    }

    // Final normalization pass (regardless of source)
    // Normalize Mercedes-Benz variations BEFORE cleanMakeName
    if (data.make && (data.make.toLowerCase() === 'mercedes-benz' || data.make.toLowerCase() === 'mercedes' || data.make.toLowerCase() === 'mercedes benz')) {
      data.make = 'Mercedes-Benz'
    }
    data.make = cleanMakeName(data.make) || data.make
    data.model = cleanModelName(data.model) || data.model

    const eventMentions = extractEventMentionsFromText(data.description || '')
    if (eventMentions.length > 0) {
      data.event_mentions = eventMentions
    }

    console.log(`✅ Final data structure being returned:`, data)

    return new Response(
      JSON.stringify(data),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error: any) {
    console.error('Error in scrape-vehicle:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || String(error)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

// Helper function to extract image URLs
function extractImageURLs(html: string, baseUrl?: string): string[] {
  const images: string[] = []
  const seen = new Set<string>()
  
  // Extract base domain from URL for relative path resolution
  let baseDomain = ''
  if (baseUrl) {
    try {
      const urlObj = new URL(baseUrl)
      baseDomain = `${urlObj.protocol}//${urlObj.hostname}`
    } catch (e) {
      // Invalid URL, skip base domain
    }
  }
  
  // Pattern 1: Standard img tags (including data-src, data-lazy-src for KSL)
  const imgRegex = /<img[^>]+(?:src|data-src|data-lazy-src|data-original)=["']([^"']+)["'][^>]*>/gi
  let match

  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1]
    if (src && !src.startsWith('data:') && !src.includes('icon') && !src.includes('logo') && !src.includes('avatar')) {
      // Convert relative URLs to absolute
      let fullUrl = src
      if (src.startsWith('//')) {
        fullUrl = 'https:' + src
      } else if (src.startsWith('/')) {
        // For KSL, resolve relative URLs
        if (baseDomain && (baseUrl?.includes('ksl.com'))) {
          fullUrl = baseDomain + src
        } else {
          continue // Skip relative URLs without base
        }
      } else if (src.startsWith('http')) {
        fullUrl = src
      } else {
        continue
      }
      
      // Extract from Next.js image proxy URLs (KSL uses these)
      if (fullUrl.includes('_next/image?url=')) {
        try {
          const urlObj = new URL(fullUrl)
          const urlParam = urlObj.searchParams.get('url')
          if (urlParam) {
            fullUrl = decodeURIComponent(urlParam)
          }
        } catch (e) {
          // Keep original if parsing fails
        }
      }
      
      // Filter KSL-specific images
      if (baseUrl?.includes('ksl.com')) {
        if (!fullUrl.includes('ksl.com') && !fullUrl.includes('ksldigital.com') && !fullUrl.includes('image.ksldigital.com')) {
          continue // Only include KSL domain images
        }
        if (fullUrl.includes('logo') || fullUrl.includes('icon') || fullUrl.includes('flag') || fullUrl.includes('svg')) {
          continue
        }
      }
      
      if (!seen.has(fullUrl)) {
        images.push(fullUrl)
        seen.add(fullUrl)
      }
    }
  }

  // Pattern 2: Data attributes (for galleries) - data-src, data-lazy-src, etc.
  const dataSrcPatterns = [
    /<[^>]+data-src=["']([^"']+)["'][^>]*>/gi,
    /<[^>]+data-lazy-src=["']([^"']+)["'][^>]*>/gi,
    /<[^>]+data-original=["']([^"']+)["'][^>]*>/gi,
    /<[^>]+data-image=["']([^"']+)["'][^>]*>/gi,
  ]
  
  for (const pattern of dataSrcPatterns) {
    while ((match = pattern.exec(html)) !== null) {
      const src = match[1]
      if (src && src.startsWith('http') && !seen.has(src)) {
        images.push(src)
        seen.add(src)
      }
    }
  }

  // Pattern 3: Background images in style attributes
  const bgImageRegex = /background-image:\s*url\(["']?([^"')]+)["']?\)/gi
  while ((match = bgImageRegex.exec(html)) !== null) {
    const src = match[1]
    if (src && src.startsWith('http') && !seen.has(src)) {
      images.push(src)
      seen.add(src)
    }
  }

  // Pattern 4: srcset attributes (responsive images - KSL uses these heavily)
  const srcsetRegex = /srcset=["']([^"']+)["']/gi
  while ((match = srcsetRegex.exec(html)) !== null) {
    const srcset = match[1]
    // srcset format: "url1 1x, url2 2x" or "url1 640w, url2 1280w"
    const urls = srcset.split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean)
    for (const url of urls) {
      let fullUrl = url
      if (url.startsWith('//')) {
        fullUrl = 'https:' + url
      } else if (url.startsWith('/') && baseDomain) {
        fullUrl = baseDomain + url
      } else if (!url.startsWith('http')) {
        continue
      }
      
      // Extract from Next.js image proxy
      if (fullUrl.includes('_next/image?url=')) {
        try {
          const urlObj = new URL(fullUrl)
          const urlParam = urlObj.searchParams.get('url')
          if (urlParam) {
            fullUrl = decodeURIComponent(urlParam)
          }
        } catch (e) {}
      }
      
      if (fullUrl.startsWith('http') && !seen.has(fullUrl)) {
        // For KSL, filter appropriately
        if (baseUrl?.includes('ksl.com')) {
          if (fullUrl.includes('ksl.com') || fullUrl.includes('ksldigital.com')) {
            images.push(fullUrl)
            seen.add(fullUrl)
          }
        } else {
          images.push(fullUrl)
          seen.add(fullUrl)
        }
      }
    }
  }

  // Pattern 5: JSON data in script tags (for gallery systems)
  const jsonImagePatterns = [
    /"image":\s*"([^"]+)"/gi,
    /"url":\s*"([^"]+\.(jpg|jpeg|png|webp))"/gi,
    /"src":\s*"([^"]+\.(jpg|jpeg|png|webp))"/gi,
    /"imageUrl":\s*"([^"]+)"/gi,
    /"image_url":\s*"([^"]+)"/gi,
    /images:\s*\[([^\]]+)\]/gi,
    // KSL-specific patterns
    /"photos":\s*\[([^\]]+)\]/gi,
    /images.*\[([^\]]+\.(jpg|jpeg|png|webp))\]/gi,
  ]
  
  for (const pattern of jsonImagePatterns) {
    while ((match = pattern.exec(html)) !== null) {
      const src = match[1]
      if (src && src.startsWith('http') && !seen.has(src)) {
        // Clean up URLs that might have trailing commas or brackets
        let cleanUrl = src.replace(/[,\]}]+$/g, '').trim()
        if (cleanUrl.includes('ksl.com') || cleanUrl.includes('ksldigital.com')) {
          images.push(cleanUrl)
          seen.add(cleanUrl)
        }
      }
    }
  }
  
  // Pattern 6: KSL-specific gallery patterns (look for img.ksl.com or img.ksldigital.com)
  // KSL uses patterns like: img.ksl.com/slc/2865/286508/28650891.png
  if (baseUrl?.includes('ksl.com')) {
    // Multiple patterns to catch all KSL image formats
    const kslPatterns = [
      /https?:\/\/img\.(?:ksl\.com|ksldigital\.com)\/[^\s"<>]+\.(?:jpg|jpeg|png|webp|gif)/gi,
      /img\.(?:ksl\.com|ksldigital\.com)\/[^\s"<>]+\.(?:jpg|jpeg|png|webp|gif)/gi,
      // Also catch relative paths like /slc/2865/286508/28650891.png
      /\/slc\/\d+\/\d+\/\d+\.(?:jpg|jpeg|png|webp|gif)/gi,
    ]
    
    for (const pattern of kslPatterns) {
      while ((match = pattern.exec(html)) !== null) {
        let url = match[0]
        // Convert relative paths to full URLs
        if (url.startsWith('/')) {
          url = `https://img.ksl.com${url}`
        } else if (!url.startsWith('http')) {
          url = `https://${url}`
        }
        if (!seen.has(url) && !url.includes('logo') && !url.includes('icon') && !url.includes('svg')) {
          images.push(url)
          seen.add(url)
        }
      }
    }
    
    // Also look for KSL image patterns in JSON/script data
    const kslJsonPatterns = [
      /"image":\s*"(https?:\/\/[^"]*img\.(?:ksl\.com|ksldigital\.com)[^"]+)"/gi,
      /"url":\s*"(https?:\/\/[^"]*img\.(?:ksl\.com|ksldigital\.com)[^"]+)"/gi,
      /"src":\s*"(https?:\/\/[^"]*img\.(?:ksl\.com|ksldigital\.com)[^"]+)"/gi,
      /images:\s*\[([^\]]*img\.(?:ksl\.com|ksldigital\.com)[^\]]*)\]/gi,
    ]
    
    for (const pattern of kslJsonPatterns) {
      while ((match = pattern.exec(html)) !== null) {
        let url = match[1]
        // Clean up any trailing commas/brackets
        url = url.replace(/[,\]}]+$/g, '').trim()
        if (url && url.startsWith('http') && !seen.has(url) && !url.includes('logo') && !url.includes('icon')) {
          images.push(url)
          seen.add(url)
        }
      }
    }
  }

  // Pattern 5: Worldwide Vintage Autos specific - dealeraccelerate CDN patterns
  // They use patterns like: cdn.dealeraccelerate.com/worldwide/1/9741/606782/1920x1440/w/1979-chevrolet-corvette
  const dealerAcceleratePattern = /https?:\/\/cdn\.dealeraccelerate\.com\/[^"'\s<>]+\.(jpg|jpeg|png|webp)/gi
  while ((match = dealerAcceleratePattern.exec(html)) !== null) {
    const src = match[0]
    if (src && !seen.has(src)) {
      images.push(src)
      seen.add(src)
    }
  }

  // Filter out junk images (thumbnails, icons, etc.) but keep larger sizes
  const filtered = images.filter(img => {
    const lower = img.toLowerCase()
    // Keep full-size images, filter out small thumbnails
    const isThumbnail = lower.includes('94x63') || 
                       lower.includes('thumbnail') || 
                       lower.includes('thumb/') ||
                       lower.match(/\/\d+x\d+[xp]\//) // Small size patterns like /94x63xp/
    
    return !isThumbnail &&
           !lower.includes('icon') && 
           !lower.includes('logo') &&
           !lower.includes('placeholder') &&
           !lower.includes('youtube.com') // YouTube thumbnails
  })

  // Sort by size (prefer larger images first)
  return filtered.sort((a, b) => {
    const aSize = extractImageSize(a)
    const bSize = extractImageSize(b)
    return (bSize || 0) - (aSize || 0)
  })
}

function stripBatSidebarHtml(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html')
    if (!doc) return String(html || '')
    doc.querySelectorAll('.sidebar, #sidebar, [class*=\"sidebar\"]').forEach((n) => n.remove())
    return doc.documentElement?.outerHTML || String(html || '')
  } catch {
    return String(html || '')
  }
}

function extractBatGalleryImagesFromHtml(html: string): string[] {
  const h = String(html || '')
  const upgradeBatImageUrl = (url: string): string => {
    if (!url || typeof url !== 'string' || !url.includes('bringatrailer.com')) {
      return url;
    }
    return url
      .replace(/&#038;/g, '&')
      .replace(/&#039;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/[?&]w=\d+/g, '')
      .replace(/[?&]h=\d+/g, '')
      .replace(/[?&]resize=[^&]*/g, '')
      .replace(/[?&]fit=[^&]*/g, '')
      .replace(/[?&]quality=[^&]*/g, '')
      .replace(/[?&]strip=[^&]*/g, '')
      .replace(/[?&]+$/, '')
      .replace(/-scaled\.(jpg|jpeg|png|webp)$/i, '.$1')
      .replace(/-\d+x\d+\.(jpg|jpeg|png|webp)$/i, '.$1')
      .trim();
  };
  const normalize = (u: string) => {
    const upgraded = upgradeBatImageUrl(u);
    return upgraded
      .split('#')[0]
      .split('?')[0]
      .replace(/&#038;/g, '&')
      .replace(/&amp;/g, '&')
      .replace(/-scaled\./g, '.')
      .trim();
  }

  const isOk = (u: string) => {
    const s = u.toLowerCase()
    return (
      u.startsWith('http') &&
      s.includes('bringatrailer.com/wp-content/uploads/') &&
      !s.endsWith('.svg') &&
      !s.endsWith('.pdf')
    )
  }

  // 1) Canonical source: listing gallery JSON
  try {
    let idx = h.indexOf('id="bat_listing_page_photo_gallery"')
    if (idx < 0) idx = h.indexOf("id='bat_listing_page_photo_gallery'")
    if (idx >= 0) {
      const window = h.slice(idx, idx + 300000)
      const m = window.match(/data-gallery-items=(?:\"([^\"]+)\"|'([^']+)')/i)
      const encoded = (m?.[1] || m?.[2] || '').trim()
      if (encoded) {
        const jsonText = encoded
          .replace(/&quot;/g, '\"')
          .replace(/&#038;/g, '&')
          .replace(/&amp;/g, '&')
        const items = JSON.parse(jsonText)
        if (Array.isArray(items)) {
          const urls: string[] = []
          for (const it of items) {
            // Prioritize highest resolution: full/original > large > small
            let u = it?.full?.url || it?.original?.url || it?.large?.url || it?.small?.url
            if (typeof u !== 'string' || !u.trim()) continue
            // Aggressively upgrade to highest resolution
            u = upgradeBatImageUrl(u)
            const nu = normalize(u)
            if (!isOk(nu)) continue
            urls.push(nu)
          }
          if (urls.length) return [...new Set(urls)]
        }
      }
    }
  } catch {
    // fall through
  }

  // 2) Fallback: scan uploads, but strip sidebar first to avoid ad/CTA images.
  const cleaned = stripBatSidebarHtml(h)
  const abs = cleaned.match(/https:\/\/bringatrailer\.com\/wp-content\/uploads\/[^\"'\\s>]+\\.(jpg|jpeg|png|webp)(?:\\?[^\"'\\s>]*)?/gi) || []
  const protoRel = cleaned.match(/\/\/bringatrailer\.com\/wp-content\/uploads\/[^\"'\\s>]+\\.(jpg|jpeg|png|webp)(?:\\?[^\"'\\s>]*)?/gi) || []
  const rel = cleaned.match(/\/wp-content\/uploads\/[^\"'\\s>]+\\.(jpg|jpeg|png|webp)(?:\\?[^\"'\\s>]*)?/gi) || []
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of [...abs, ...protoRel, ...rel]) {
    let u = raw
    if (u.startsWith('//')) u = 'https:' + u
    if (u.startsWith('/')) u = 'https://bringatrailer.com' + u
    const nu = normalize(u)
    if (!isOk(nu)) continue
    if (seen.has(nu)) continue
    seen.add(nu)
    out.push(nu)
    if (out.length >= 400) break
  }
  return out
}

// Helper to extract image size from URL for sorting
function extractImageSize(url: string): number | null {
  const sizeMatch = url.match(/(\d+)x(\d+)/)
  if (sizeMatch) {
    return parseInt(sizeMatch[1]) * parseInt(sizeMatch[2])
  }
  return null
}

/**
 * Extract dealer information from Craigslist listing
 * Detects dealers who post across multiple cities (like Jordan Motorsports)
 */
function extractDealerInfo(html: string, description: string, title: string): {
  name: string | null
  website: string | null
  phone: string | null
} {
  const combinedText = `${title} ${description}`.toLowerCase()
  const result: { name: string | null; website: string | null; phone: string | null } = {
    name: null,
    website: null,
    phone: null
  }

  // Extract website URLs from HTML (dealers often include their site)
  const websitePatterns = [
    // Full URLs: https://www.jordanmotorsport.com
    /https?:\/\/(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+\.(?:com|net|org|us|io|co))/gi,
    // Without protocol: www.jordanmotorsport.com or jordanmotorsport.com
    /(?:^|\s)(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+\.(?:com|net|org|us|io|co))(?:\s|$|[^\w.])/gi
  ]

  for (const pattern of websitePatterns) {
    const matches = html.match(pattern) || combinedText.match(pattern)
    if (matches) {
      // Filter out common non-dealer domains
      const excludeDomains = ['craigslist', 'facebook', 'google', 'youtube', 'instagram', 'twitter']
      for (const match of matches) {
        const cleanUrl = match.replace(/^https?:\/\//, '').replace(/^www\./, '').toLowerCase()
        const domain = cleanUrl.split('/')[0]
        if (!excludeDomains.some(ex => domain.includes(ex))) {
          result.website = `https://${cleanUrl}`
          break
        }
      }
      if (result.website) break
    }
  }

  // Extract dealer name from common patterns
  // Pattern 1: Business name followed by phone or website
  const namePatterns = [
    // "Jordan Motorsports" or "JORDAN MOTORSPORTS"
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:MOTORSPORTS?|MOTORS?|AUTO|CLASSICS?|COLLECTION|PERFORMANCE)/i,
    // Dealer name before phone: "Name (555) 123-4567"
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*\(?\s*(\d{3})\s*\)?\s*(\d{3})[-\s]?(\d{4})/,
    // Name with website: "Name www.domain.com"
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(?:www\.)?[a-z0-9-]+\.[a-z]+/i,
    // Uppercase dealer names: "JORDAN MOTORSPORTS" or "DESERT PERFORMANCE"
    /\b([A-Z]{2,}(?:\s+[A-Z]{2,})+)\s+(?:MOTORSPORTS?|MOTORS?|AUTO|CLASSICS?|PERFORMANCE)/,
  ]

  for (const pattern of namePatterns) {
    const match = combinedText.match(pattern) || html.match(pattern)
    if (match && match[1]) {
      const name = match[1].trim()
      // Filter out common false positives
      if (name.length > 3 && 
          !['View', 'Click', 'Call', 'Visit', 'Contact', 'Location', 'Mileage'].includes(name)) {
        result.name = name
        // Extract phone if present in same match
        if (match[2] && match[3] && match[4]) {
          result.phone = `(${match[2]}) ${match[3]}-${match[4]}`
        }
        break
      }
    }
  }

  // Extract phone number (if not already extracted)
  if (!result.phone) {
    const phonePattern = /\(?\s*(\d{3})\s*\)?\s*[-.\s]?\s*(\d{3})\s*[-.\s]?\s*(\d{4})/
    const phoneMatch = combinedText.match(phonePattern)
    if (phoneMatch) {
      result.phone = `(${phoneMatch[1]}) ${phoneMatch[2]}-${phoneMatch[3]}`
    }
  }

  // If we found a website but no name, try to extract name from domain
  if (result.website && !result.name) {
    const domainMatch = result.website.match(/https?:\/\/(?:www\.)?([^.]+)/)
    if (domainMatch) {
      const domainName = domainMatch[1].replace(/-/g, ' ')
      // Convert "jordanmotorsport" -> "Jordan Motorsport"
      result.name = domainName
        .split(/(?=[A-Z])/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ')
    }
  }

  return result
}