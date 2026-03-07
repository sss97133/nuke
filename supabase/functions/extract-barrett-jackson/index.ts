/**
 * EXTRACT BARRETT-JACKSON v2.0
 *
 * Two-tier extraction for Barrett-Jackson auction pages:
 *   1. PREFERRED: Direct HTTP fetch via archiveFetch (free, tries to bypass Cloudflare)
 *      - Parse JSON-LD, embedded JSON, or HTML for structured data
 *   2. FALLBACK: archiveFetch with Firecrawl (JS-rendered, costs $0.01/page)
 *      - Parse markdown + raw HTML with regex patterns
 *
 * BJ docket pages have:
 *   - Labeled fields in markdown: "1966Year", "CHEVROLETMake", "EL CAMINOModel"
 *   - Images on Azure CDN: BarrettJacksonCDN.azureedge.net/staging/carlist/items/fullsize/cars/
 *   - Embedded JSON with price/sold status (sometimes)
 *   - JSON-LD schema.org Product or Vehicle data (sometimes)
 *
 * All pages archived to listing_page_snapshots via archiveFetch.
 * Quality gate prevents garbage data from entering the database.
 *
 * Actions:
 *   POST { "url": "..." }                            -- Extract single URL
 *   POST { "action": "batch_from_queue", "limit": 10 } -- Process queue items
 *   POST { "action": "re_enrich", "limit": 50 }     -- Re-enrich existing vehicles
 *   POST { "action": "stats" }                       -- Queue statistics
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { archiveFetch } from "../_shared/archiveFetch.ts";
import { qualityGate } from "../_shared/extractionQualityGate.ts";
import { cleanVehicleFields } from "../_shared/pollutionDetector.ts";

const EXTRACTOR_VERSION = "2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function okJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface BJVehicle {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  style: string | null;
  vin: string | null;
  transmission: string | null;
  engine: string | null;
  cylinders: number | null;
  exterior_color: string | null;
  interior_color: string | null;
  mileage: number | null;
  sale_price: number | null;
  description: string | null;
  auction_name: string | null;
  lot_number: string | null;
  status: string | null;
  image_urls: string[];
  extraction_method: "json_ld" | "embedded_json" | "html" | "markdown";
}

// ─── Title case helper ──────────────────────────────────────────────────────

function titleCase(s: string): string {
  const preserveUpper = new Set([
    'BMW', 'AMG', 'GT', 'SS', 'RS', 'GTS', 'GTO', 'GTI', 'GTR',
    'SL', 'SLK', 'SLS', 'CLS', 'CLK', 'SUV', 'TDI', 'TSI',
    'V6', 'V8', 'V10', 'V12', 'I4', 'I6', 'W12', 'HP', 'RPM', 'CI',
    'AWD', 'FWD', 'RWD', '4WD', 'CVT', 'DSG', 'PDK',
    'SC', 'SE', 'LE', 'LT', 'LS', 'LTZ', 'SRT', 'TRD', 'SSR',
    'XJ', 'XK', 'XF', 'DB', 'DB5', 'DB9', 'DB11',
    'M3', 'M4', 'M5', 'M6', 'Z3', 'Z4', 'X3', 'X5', 'X6',
    'F1', 'F40', 'F50', 'II', 'III', 'IV', 'VI',
  ]);
  return s
    .split(/\s+/)
    .map(word => {
      const upper = word.toUpperCase();
      if (preserveUpper.has(upper)) return upper;
      if (/^[A-Z]\d+$/i.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

// ─── Parse BJ RSC (React Server Components) vehicle data ────────────────────
// BJ is a Next.js app that embeds rich vehicle data in the RSC payload.
// This is the BEST extraction method: all fields, structured, free.

function parseRscVehicleData(html: string, url: string): BJVehicle | null {
  // Look for the vehicle JSON pattern in RSC payload:
  //   "vehicle":{"id":55543,"documentId":"...","attributes":{...}}
  // The data is escaped JSON inside script tags with self.__next_f.push()
  const vehiclePatterns = [
    // Unescaped JSON (rare but possible)
    /"vehicle":\{"id":\d+[^}]*"attributes":\{[^}]*"title":"([^"]+)"/,
    // Escaped JSON in RSC payload (common)
    /\\?"vehicle\\?":\{\\?"id\\?":\d+[^}]*\\?"attributes\\?":\{[^}]*\\?"title\\?":\\?"([^"\\]+)\\?"/,
  ];

  for (const pattern of vehiclePatterns) {
    const match = html.match(pattern);
    if (!match) continue;

    // Found vehicle data. Now extract the full attributes block.
    // Find the start of the "attributes" object
    const titleInHtml = match[0];
    const titleIdx = html.indexOf(titleInHtml);
    if (titleIdx === -1) continue;

    // Find "attributes":{...} - go back to find it
    const searchStart = Math.max(0, titleIdx - 200);
    const searchBlock = html.substring(searchStart, titleIdx + 3000);

    // Extract key fields using regex (more reliable than trying to parse escaped JSON)
    const vehicle = newEmptyVehicle(url);
    vehicle.extraction_method = "embedded_json";

    // Title
    const titleField = searchBlock.match(/\\?"title\\?":\s*\\?"([^"\\]+)\\?"/);
    if (titleField) {
      vehicle.title = titleCase(titleField[1]);
      const ymm = titleField[1].match(/^(\d{4})\s+(\S+)\s+(.+)$/);
      if (ymm) {
        vehicle.year = parseInt(ymm[1], 10);
        vehicle.make = titleCase(ymm[2]);
        vehicle.model = titleCase(ymm[3]);
      }
    }

    // Structured year/make/model fields
    const yearField = searchBlock.match(/\\?"year\\?":\s*\\?"(\d{4})\\?"/);
    if (yearField && !vehicle.year) vehicle.year = parseInt(yearField[1], 10);

    const makeField = searchBlock.match(/\\?"make\\?":\s*\\?"([^"\\]+)\\?"/);
    if (makeField && !vehicle.make) vehicle.make = titleCase(makeField[1]);

    const modelField = searchBlock.match(/\\?"model\\?":\s*\\?"([^"\\]+)\\?"/);
    if (modelField && !vehicle.model) vehicle.model = titleCase(modelField[1]);

    // VIN
    const vinField = searchBlock.match(/\\?"vin\\?":\s*\\?"([A-Z0-9]+)\\?"/i);
    if (vinField) vehicle.vin = vinField[1];

    // Description - extract full_description value, stopping at the next field boundary
    // BJ RSC format: \"full_description\":\"text here\",\"short_description\":\"...
    const descIdx = searchBlock.indexOf("full_description");
    if (descIdx !== -1) {
      // Find the value start (after the colon and opening quote)
      const afterKey = searchBlock.substring(descIdx);
      const valueStart = afterKey.match(/full_description\\?":\s*\\?"/);
      if (valueStart) {
        const startPos = descIdx + (valueStart.index ?? 0) + valueStart[0].length;
        const remaining = searchBlock.substring(startPos);
        // Find the end: look for ","short_description" or next field boundary
        // The pattern is: text\\",\\\"short_description  or  text","short_description
        const endPatterns = [
          /\\?",\s*\\?"short_description/,
          /\\?",\s*\\?"[a-z_]+\\?":/,
          /",\s*"[a-z_]+"/,
        ];
        let endPos = remaining.length;
        for (const ep of endPatterns) {
          const m = remaining.match(ep);
          if (m && m.index !== undefined && m.index < endPos) {
            endPos = m.index;
          }
        }
        const rawDesc = remaining.substring(0, endPos);
        if (rawDesc.length > 20) {
          vehicle.description = rawDesc
            .replace(/\\n/g, "\n")
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, "\\")
            .replace(/<[^>]+>/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&nbsp;/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 5000);
        }
      }
    }

    // Price - BJ uses "$$12,100.00" format
    const priceField = searchBlock.match(/\\?"price\\?":\s*\\?"([^"\\]+)\\?"/);
    if (priceField) {
      const priceStr = priceField[1].replace(/[$,]/g, "");
      const price = parseFloat(priceStr);
      if (Number.isFinite(price) && price >= 100 && price < 100_000_000) {
        vehicle.sale_price = Math.round(price);
      }
    }

    // Colors
    const extColorField = searchBlock.match(/\\?"exterior_color\\?":\s*\\?"([^"\\]+)\\?"/);
    if (extColorField && extColorField[1].trim()) vehicle.exterior_color = titleCase(extColorField[1]);

    const intColorField = searchBlock.match(/\\?"interior_color\\?":\s*\\?"([^"\\]+)\\?"/);
    if (intColorField && intColorField[1].trim()) vehicle.interior_color = titleCase(intColorField[1]);

    // Engine size
    const engineField = searchBlock.match(/\\?"engine_size\\?":\s*\\?"([^"\\]+)\\?"/);
    if (engineField && engineField[1].trim()) vehicle.engine = engineField[1];

    // Cylinders
    const cylField = searchBlock.match(/\\?"number_of_cylinders\\?":\s*\\?"(\d+)\\?"/);
    if (cylField) vehicle.cylinders = parseInt(cylField[1], 10);

    // Transmission
    const transField = searchBlock.match(/\\?"transmission_type_name\\?":\s*\\?"([^"\\]+)\\?"/);
    if (transField && transField[1].trim()) vehicle.transmission = titleCase(transField[1]);

    // Style
    const styleField = searchBlock.match(/\\?"style\\?":\s*\\?"([^"\\]+)\\?"/);
    if (styleField && styleField[1].trim()) vehicle.style = titleCase(styleField[1]);

    // Lot number
    const lotField = searchBlock.match(/\\?"lot_number\\?":\s*\\?"([^"\\]+)\\?"/);
    if (lotField) vehicle.lot_number = lotField[1];

    // Event slug -> auction name
    const eventField = searchBlock.match(/\\?"event_slug\\?":\s*\\?"([^"\\]+)\\?"/);
    if (eventField) vehicle.auction_name = titleCase(eventField[1].replace(/-/g, " "));

    // Is sold
    const soldField = searchBlock.match(/\\?"is_sold\\?":\s*(true|false)/);
    if (soldField) {
      vehicle.status = soldField[1] === "true" ? "Sold" : "Not Sold";
    }

    // Is canceled
    const cancelField = searchBlock.match(/\\?"is_canceled\\?":\s*(true|false)/);
    if (cancelField && cancelField[1] === "true") {
      vehicle.status = "Withdrawn";
    }

    // Mileage from description
    if (vehicle.description) {
      extractMileageFromText(vehicle, vehicle.description);
    }

    // Fallback: extract auction from URL
    extractAuctionFromUrl(vehicle, url);

    if (vehicle.year || vehicle.make) {
      console.log(`[BJ] RSC extraction found: ${vehicle.year} ${vehicle.make} ${vehicle.model}, vin=${vehicle.vin}, price=$${vehicle.sale_price}`);
      return vehicle;
    }
  }

  return null;
}

// ─── Parse JSON-LD from HTML ────────────────────────────────────────────────

function parseJsonLd(html: string, url: string): BJVehicle | null {
  // Look for JSON-LD schema.org Vehicle or Product data
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const type = item["@type"];
        if (type === "Vehicle" || type === "Car" || type === "Product") {
          const vehicle = newEmptyVehicle(url);
          vehicle.extraction_method = "json_ld";

          if (item.name) vehicle.title = titleCase(String(item.name));
          if (item.vehicleIdentificationNumber) vehicle.vin = item.vehicleIdentificationNumber;
          if (item.mileageFromOdometer?.value) {
            const miles = parseInt(String(item.mileageFromOdometer.value).replace(/,/g, ""), 10);
            if (miles > 0 && miles < 1_000_000) vehicle.mileage = miles;
          }
          if (item.color) vehicle.exterior_color = titleCase(String(item.color));
          if (item.vehicleInteriorColor) vehicle.interior_color = titleCase(String(item.vehicleInteriorColor));
          if (item.vehicleTransmission) vehicle.transmission = titleCase(String(item.vehicleTransmission));
          if (item.vehicleEngine?.name) vehicle.engine = String(item.vehicleEngine.name);
          if (item.bodyType) vehicle.style = titleCase(String(item.bodyType));
          if (item.description) vehicle.description = String(item.description).slice(0, 5000);

          // Price from offers
          if (item.offers?.price) {
            const price = parseInt(String(item.offers.price).replace(/[$,]/g, ""), 10);
            if (price >= 100 && price < 100_000_000) vehicle.sale_price = price;
          }

          // Parse year/make/model from name: "1966 CHEVROLET EL CAMINO"
          if (item.name) {
            const titleMatch = String(item.name).match(/^(\d{4})\s+(\S+)\s+(.+)$/);
            if (titleMatch) {
              vehicle.year = parseInt(titleMatch[1], 10);
              vehicle.make = titleCase(titleMatch[2]);
              vehicle.model = titleCase(titleMatch[3]);
            }
          }
          // Or use structured fields
          if (item.brand?.name && !vehicle.make) vehicle.make = titleCase(String(item.brand.name));
          if (item.model && !vehicle.model) vehicle.model = titleCase(String(item.model));
          if (item.vehicleModelDate && !vehicle.year) vehicle.year = parseInt(String(item.vehicleModelDate), 10) || null;

          // Extract auction info from URL
          extractAuctionFromUrl(vehicle, url);

          if (vehicle.year || vehicle.make) return vehicle;
        }
      }
    } catch { /* malformed JSON-LD, skip */ }
  }
  return null;
}

// ─── Parse embedded JSON from BJ HTML ───────────────────────────────────────

function extractEmbeddedJson(html: string): Record<string, unknown> | null {
  const patterns = [
    /\{"title":\s*"[^"]*",\s*"full_description"/,
    /\\?"title\\?":\s*\\?"[^"]*\\?",\s*\\?"full_description\\?"/,
  ];
  for (const pattern of patterns) {
    const idx = html.search(pattern);
    if (idx === -1) continue;
    let depth = 0;
    let end = idx;
    const isEscaped = html[idx] === '\\';
    for (let i = idx; i < Math.min(idx + 10000, html.length); i++) {
      if (isEscaped) {
        if (html.substring(i, i + 2) === '\\{') depth++;
        if (html.substring(i, i + 2) === '\\}') { depth--; if (depth <= 0) { end = i + 2; break; } }
      } else {
        if (html[i] === '{') depth++;
        if (html[i] === '}') { depth--; if (depth <= 0) { end = i + 1; break; } }
      }
    }
    try {
      let raw = html.substring(idx, end);
      if (isEscaped) raw = raw.replace(/\\"/g, '"').replace(/\\{/g, '{').replace(/\\}/g, '}');
      return JSON.parse(raw);
    } catch { continue; }
  }
  return null;
}

function parseEmbeddedJsonVehicle(embedded: Record<string, unknown>, url: string): BJVehicle | null {
  if (!embedded.title && !embedded.full_description) return null;

  const vehicle = newEmptyVehicle(url);
  vehicle.extraction_method = "embedded_json";

  if (typeof embedded.title === "string") {
    vehicle.title = titleCase(embedded.title);
    const titleMatch = embedded.title.match(/^(\d{4})\s+(\S+)\s+(.+)$/);
    if (titleMatch) {
      vehicle.year = parseInt(titleMatch[1], 10);
      vehicle.make = titleCase(titleMatch[2]);
      vehicle.model = titleCase(titleMatch[3]);
    }
  }

  if (typeof embedded.full_description === "string" && embedded.full_description.length > 20) {
    vehicle.description = String(embedded.full_description)
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 5000);
  }

  if (typeof embedded.price === "string") {
    const priceStr = embedded.price.replace(/[$,]/g, "");
    const price = parseFloat(priceStr);
    if (Number.isFinite(price) && price >= 100) vehicle.sale_price = Math.round(price);
  } else if (typeof embedded.price === "number" && embedded.price >= 100) {
    vehicle.sale_price = Math.round(embedded.price as number);
  }

  if (typeof embedded.is_sold === "boolean" && embedded.is_sold) {
    vehicle.status = "Sold";
  }

  if (typeof embedded.vin === "string") vehicle.vin = String(embedded.vin);
  if (typeof embedded.year === "number") vehicle.year = embedded.year as number;
  if (typeof embedded.make === "string") vehicle.make = titleCase(String(embedded.make));
  if (typeof embedded.model === "string") vehicle.model = titleCase(String(embedded.model));

  extractAuctionFromUrl(vehicle, url);

  return (vehicle.year || vehicle.make) ? vehicle : null;
}

// ─── Parse HTML structure (before falling back to markdown) ─────────────────

function parseHtmlStructured(html: string, url: string): BJVehicle | null {
  const vehicle = newEmptyVehicle(url);
  vehicle.extraction_method = "html";

  // Try og:title meta tag for vehicle name
  const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (ogTitle) {
    vehicle.title = titleCase(ogTitle[1].trim());
    const titleMatch = ogTitle[1].match(/(\d{4})\s+(\S+)\s+(.+?)(?:\s*[-|]|$)/);
    if (titleMatch) {
      vehicle.year = parseInt(titleMatch[1], 10);
      vehicle.make = titleCase(titleMatch[2]);
      vehicle.model = titleCase(titleMatch[3].trim());
    }
  }

  // Try <title> tag
  if (!vehicle.year) {
    const htmlTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (htmlTitle) {
      const titleMatch = htmlTitle[1].match(/(\d{4})\s+(\S+)\s+(.+?)(?:\s*[-|]|$)/);
      if (titleMatch) {
        vehicle.year = parseInt(titleMatch[1], 10);
        vehicle.make = titleCase(titleMatch[2]);
        vehicle.model = titleCase(titleMatch[3].trim());
      }
    }
  }

  // Try og:description for description
  const ogDesc = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
  if (ogDesc && ogDesc[1].length > 30) {
    vehicle.description = ogDesc[1].slice(0, 5000);
  }

  extractAuctionFromUrl(vehicle, url);

  return (vehicle.year || vehicle.make) ? vehicle : null;
}

// ─── Parse markdown (most reliable fallback for BJ) ─────────────────────────

function parseMarkdown(markdown: string, url: string): BJVehicle {
  const vehicle = newEmptyVehicle(url);
  vehicle.extraction_method = "markdown";

  // Extract title: "# 1966 CHEVROLET EL CAMINO PICKUP"
  const titleMatch = markdown.match(/^#\s+(\d{4}\s+[A-Z][A-Z\s\-\/\d]+?)$/m);
  if (titleMatch) {
    vehicle.title = titleCase(titleMatch[1].trim());
  }

  // Extract labeled fields from the Details section
  // Pattern: "1966Year", "CHEVROLETMake", "EL CAMINOModel", etc.
  const fieldPatterns: [RegExp, keyof BJVehicle][] = [
    [/(\d{4})Year/m, "year"],
    [/([A-Z][A-Z\s\-\.\/]+?)Make/m, "make"],
    [/([A-Z][A-Z\s\-\.\/\d]+?)Model/m, "model"],
    [/([A-Z][A-Z\s\-\.\/]+?)Style/m, "style"],
    [/(\d+)Cylinders?/m, "cylinders"],
    [/([A-Z][A-Z\s\-\.\/\d]+?)Transmission/m, "transmission"],
    [/([A-Z\d][A-Z\s\-\.\/\d]+?)Engine Size/m, "engine"],
    [/([A-Z][A-Z\s\-\.\/]+?)Exterior Color/m, "exterior_color"],
    [/([A-Z][A-Z\s\-\.\/]+?)Interior Color/m, "interior_color"],
    [/([A-Z0-9]+)Vin/m, "vin"],
  ];

  for (const [pattern, field] of fieldPatterns) {
    const match = markdown.match(pattern);
    if (match) {
      const val = match[1].trim();
      if (field === "year") {
        vehicle.year = parseInt(val, 10);
      } else if (field === "cylinders") {
        vehicle.cylinders = parseInt(val, 10);
      } else if (
        field === "make" || field === "model" || field === "style" ||
        field === "exterior_color" || field === "interior_color" ||
        field === "transmission"
      ) {
        vehicle[field] = titleCase(val);
      } else if (field === "engine" || field === "vin") {
        vehicle[field] = val;
      }
    }
  }

  // Fallback: parse year/make/model from title text
  if (!vehicle.year && vehicle.title) {
    const titleYMM = vehicle.title.match(/^(\d{4})\s+(\S+)\s+(.+)$/);
    if (titleYMM) {
      vehicle.year = parseInt(titleYMM[1], 10);
      if (!vehicle.make) vehicle.make = titleCase(titleYMM[2]);
      if (!vehicle.model) vehicle.model = titleCase(titleYMM[3]);
    }
  }

  // Fallback: parse from URL slug: /1965-pontiac-gto-200318
  if (!vehicle.year || !vehicle.make) {
    const slugMatch = url.match(/\/(\d{4})-([a-z]+(?:-[a-z]+)?)-(.+?)-(\d{4,})$/i);
    if (slugMatch) {
      if (!vehicle.year) vehicle.year = parseInt(slugMatch[1], 10);
      if (!vehicle.make) vehicle.make = titleCase(slugMatch[2].replace(/-/g, " "));
      if (!vehicle.model) {
        // Model is everything between make and the numeric ID
        vehicle.model = titleCase(slugMatch[3].replace(/-/g, " "));
      }
      if (!vehicle.lot_number) vehicle.lot_number = slugMatch[4];
    }
  }

  // Sale price
  const pricePatterns = [
    /Sold\s+for\s+\$([0-9,]+)/i,
    /Hammer\s+Price[:\s]+\$([0-9,]+)/i,
    /Final\s+Price[:\s]+\$([0-9,]+)/i,
    /Sale\s+Price[:\s]+\$([0-9,]+)/i,
    /Sold\s*[-–]\s*\$([0-9,]+)/i,
    /\$([0-9,]+)\s*(?:sold|hammer|final)/i,
  ];
  for (const pattern of pricePatterns) {
    const priceMatch = markdown.match(pattern);
    if (priceMatch) {
      const price = parseInt(priceMatch[1].replace(/,/g, ""), 10);
      if (price >= 100 && price < 100_000_000) {
        vehicle.sale_price = price;
        break;
      }
    }
  }

  // Auction name from URL
  extractAuctionFromUrl(vehicle, url);

  // Status
  const statusMatch = markdown.match(
    /Status:\s*(Sold|No Sale|Upcoming|Withdrawn)/i,
  );
  if (statusMatch) {
    vehicle.status = statusMatch[1];
  }
  // Also try "SOLD" badge pattern
  if (!vehicle.status && /\b(SOLD)\b/.test(markdown)) {
    vehicle.status = "Sold";
  }

  // Description
  const descMatch = markdown.match(
    /### Description[\s\S]*?## Details\s+([\s\S]+?)(?=\n##|\n###|!\[|$)/,
  );
  if (descMatch) {
    vehicle.description = descMatch[1].trim().slice(0, 5000);
  } else {
    // Try alternate patterns
    const altPatterns = [
      /## Details\s+(This \d{4}[\s\S]+?)(?=\n##|\n###|\n!\[|$)/,
      /## Details\s+([\s\S]+?)(?=\n##|\n###|\n!\[|$)/,
      /## Description\s+([\s\S]+?)(?=\n##|\n###|\n!\[|$)/,
      // BJ docket pages may have description in a different format
      /(?:^|\n)(This (?:exceptional|stunning|beautiful|rare|remarkable|incredible|gorgeous|pristine|immaculate|original|restored|custom)[\s\S]{50,2000})(?=\n\n|\n##|$)/im,
    ];
    for (const pattern of altPatterns) {
      const altMatch = markdown.match(pattern);
      if (altMatch && altMatch[1].trim().length > 30) {
        vehicle.description = altMatch[1].trim().slice(0, 5000);
        break;
      }
    }
  }

  // Mileage from text
  extractMileageFromText(vehicle, (vehicle.description || "") + " " + markdown);

  return vehicle;
}

// ─── Image URL extraction ───────────────────────────────────────────────────

function extractImageUrls(html: string): string[] {
  const urls = new Set<string>();

  // Azure CDN image URLs (primary BJ CDN)
  const cdnRegex =
    /https:\/\/BarrettJacksonCDN\.azureedge\.net\/staging\/carlist\/items\/(?:fullsize|thumbnail)\/cars\/[^"'\s)]+\.(jpg|jpeg|png|webp)/gi;
  let m;
  while ((m = cdnRegex.exec(html)) !== null) {
    // Prefer fullsize over thumbnail
    const imgUrl = m[0].replace('/thumbnail/', '/fullsize/');
    urls.add(imgUrl);
  }

  // Also check for other image CDN patterns BJ may use
  const altCdnRegex =
    /https:\/\/[^"'\s)]*barrett[^"'\s)]*\.(?:azureedge\.net|cloudfront\.net|amazonaws\.com)[^"'\s)]+\.(jpg|jpeg|png|webp)/gi;
  while ((m = altCdnRegex.exec(html)) !== null) {
    urls.add(m[0]);
  }

  // og:image
  const ogImage = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
  if (ogImage && ogImage[1].includes("barrett")) {
    urls.add(ogImage[1]);
  }

  // Filter out non-vehicle images (venue maps, logos, site chrome)
  const junkLower = ['/auctionsite', 'location_map', '/images/auctionsite'];
  return [...urls].filter(u => !junkLower.some(p => u.toLowerCase().includes(p)));
}

// ─── Mileage extraction helper ──────────────────────────────────────────────

function extractMileageFromText(vehicle: BJVehicle, text: string): void {
  if (vehicle.mileage) return;

  const mileagePatterns = [
    /(\d[\d,]*)\s*(?:actual|original|documented|indicated)\s*miles/i,
    /mileage\s*(?:of|:)?\s*(\d[\d,]*)/i,
    /odometer\s*(?:reads?|shows?|indicates?|:)?\s*(\d[\d,]*)/i,
    /(\d[\d,]*)\s*miles\s*(?:on\s*(?:the\s*)?(?:odometer|clock))/i,
    /only\s*(\d[\d,]*)\s*miles/i,
    /(\d[\d,]*)\s*total\s*miles/i,
    /(\d[\d,]*)\s*actual\s*miles/i,
    /showing\s*(\d[\d,]*)\s*miles/i,
    // BJ often has "X,XXX miles" in parenthetical notes
    /[.\s](\d[\d,]+)\s*miles\s*\(/i,
    // Generic "X,XXX miles" at sentence boundary (last resort, use carefully)
    /\b(\d{1,3}(?:,\d{3})+)\s*miles\b/i,
  ];

  for (const pattern of mileagePatterns) {
    const match = text.match(pattern);
    if (match) {
      const miles = parseInt(match[1].replace(/,/g, ""), 10);
      if (miles > 0 && miles < 1_000_000) {
        vehicle.mileage = miles;
        return;
      }
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function newEmptyVehicle(url: string): BJVehicle {
  return {
    url,
    title: null,
    year: null,
    make: null,
    model: null,
    style: null,
    vin: null,
    transmission: null,
    engine: null,
    cylinders: null,
    exterior_color: null,
    interior_color: null,
    mileage: null,
    sale_price: null,
    description: null,
    auction_name: null,
    lot_number: null,
    status: null,
    image_urls: [],
    extraction_method: "markdown",
  };
}

function extractAuctionFromUrl(vehicle: BJVehicle, url: string): void {
  // Auction name: /scottsdale-2024/ or /palm-beach-2022/
  const auctionMatch = url.match(/barrett-jackson\.com\/([a-z\-]+-\d{4})\//i);
  if (auctionMatch && !vehicle.auction_name) {
    vehicle.auction_name = titleCase(auctionMatch[1].replace(/-/g, " "));
  }

  // Lot number (numeric ID at end of URL)
  const lotMatch = url.match(/-(\d{4,})$/);
  if (lotMatch && !vehicle.lot_number) {
    vehicle.lot_number = lotMatch[1];
  }
}

function isPageRemoved(html: string | null, markdown: string | null): boolean {
  // BJ is a Next.js app that includes 404 component text in the SSR bundle
  // of EVERY page. We can't just search for "no longer available" in raw HTML.
  // Instead, check the <title> tag — if it contains a vehicle year+make, page is valid.
  if (html) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      const title = titleMatch[1];
      // If title contains year + vehicle info, page is valid
      if (/\d{4}\s+[A-Z]/.test(title)) return false;
      // If title says "not found" or "error", page is removed
      if (/not found|error|404/i.test(title)) return true;
    }
  }

  // For markdown (Firecrawl output), check more carefully
  if (markdown) {
    // If markdown has the BJ labeled fields pattern, it's a real vehicle page
    if (/\d{4}Year/m.test(markdown)) return false;
    // If the markdown heading has a vehicle pattern, it's valid
    if (/^#\s+\d{4}\s+[A-Z]/m.test(markdown)) return false;

    // Check for 404 patterns in markdown (not just anywhere in raw HTML)
    if (
      /item you are looking.*no longer available/i.test(markdown) ||
      /page not found/i.test(markdown) ||
      /404\s+not found/i.test(markdown)
    ) {
      return true;
    }
  }

  return false;
}

// ─── Fetch + parse (tries direct first, falls back to Firecrawl) ────────────

async function fetchAndParse(url: string): Promise<BJVehicle> {
  // Step 1: Try direct HTTP fetch (free, uses archiveFetch with cache)
  // BJ has Cloudflare but archiveFetch handles retries/proxies
  const directResult = await archiveFetch(url, {
    platform: "barrett-jackson",
    useFirecrawl: false,
    callerName: "extract-barrett-jackson",
  });

  const isBlocked = directResult.statusCode === 403 || directResult.statusCode === 503 ||
    (directResult.html && directResult.html.length < 50000 &&
     (directResult.html.includes("cf_chl_opt") || directResult.html.includes("Just a moment")));
  if (directResult.html && !isBlocked) {
    if (isPageRemoved(directResult.html, null)) {
      throw new Error("PAGE_NOT_FOUND");
    }

    // Try RSC vehicle data first (best source: all fields, structured, free)
    const fromRsc = parseRscVehicleData(directResult.html, url);
    if (fromRsc && fromRsc.year && fromRsc.make) {
      fromRsc.image_urls = extractImageUrls(directResult.html);
      return fromRsc;
    }

    // Try JSON-LD (schema.org structured data)
    const fromJsonLd = parseJsonLd(directResult.html, url);
    if (fromJsonLd && fromJsonLd.year && fromJsonLd.make) {
      fromJsonLd.image_urls = extractImageUrls(directResult.html);
      console.log(`[BJ] Parsed via JSON-LD (free): ${fromJsonLd.year} ${fromJsonLd.make} ${fromJsonLd.model}`);
      return fromJsonLd;
    }

    // Try legacy embedded JSON
    const embedded = extractEmbeddedJson(directResult.html);
    if (embedded) {
      const fromEmbedded = parseEmbeddedJsonVehicle(embedded, url);
      if (fromEmbedded && fromEmbedded.year && fromEmbedded.make) {
        fromEmbedded.image_urls = extractImageUrls(directResult.html);
        if (fromEmbedded.description) {
          extractMileageFromText(fromEmbedded, fromEmbedded.description);
        }
        console.log(`[BJ] Parsed via embedded JSON (free): ${fromEmbedded.year} ${fromEmbedded.make} ${fromEmbedded.model}`);
        return fromEmbedded;
      }
    }

    // Try HTML meta tags
    const fromHtml = parseHtmlStructured(directResult.html, url);
    if (fromHtml && fromHtml.year && fromHtml.make) {
      fromHtml.image_urls = extractImageUrls(directResult.html);
      console.log(`[BJ] Parsed via HTML meta (free): ${fromHtml.year} ${fromHtml.make} ${fromHtml.model}`);
      return fromHtml;
    }
  }

  // Step 2: Fallback to Firecrawl (BJ usually requires JS rendering)
  console.log(`[BJ] Direct fetch insufficient, falling back to Firecrawl for ${url}`);
  const fcResult = await archiveFetch(url, {
    platform: "barrett-jackson",
    useFirecrawl: true,
    includeMarkdown: true,
    waitForJs: 5000,
    callerName: "extract-barrett-jackson",
    forceRefresh: true, // Don't use the direct-fetch cache
  });

  if (fcResult.error && !fcResult.html && !fcResult.markdown) {
    throw new Error(`Fetch failed: ${fcResult.error}`);
  }

  if (isPageRemoved(fcResult.html, fcResult.markdown)) {
    throw new Error("PAGE_NOT_FOUND");
  }

  // Try structured data from Firecrawl HTML
  if (fcResult.html) {
    // RSC vehicle data (best source)
    const fromRsc = parseRscVehicleData(fcResult.html, url);
    if (fromRsc && fromRsc.year && fromRsc.make) {
      fromRsc.image_urls = extractImageUrls(fcResult.html);
      return fromRsc;
    }

    const fromJsonLd = parseJsonLd(fcResult.html, url);
    if (fromJsonLd && fromJsonLd.year && fromJsonLd.make) {
      fromJsonLd.image_urls = extractImageUrls(fcResult.html);
      console.log(`[BJ] Parsed via JSON-LD (Firecrawl): ${fromJsonLd.year} ${fromJsonLd.make} ${fromJsonLd.model}`);
      return fromJsonLd;
    }

    const embedded = extractEmbeddedJson(fcResult.html);
    if (embedded) {
      const fromEmbedded = parseEmbeddedJsonVehicle(embedded, url);
      if (fromEmbedded && fromEmbedded.year && fromEmbedded.make) {
        fromEmbedded.image_urls = extractImageUrls(fcResult.html);
        if (fromEmbedded.description) extractMileageFromText(fromEmbedded, fromEmbedded.description);
        console.log(`[BJ] Parsed via embedded JSON (Firecrawl): ${fromEmbedded.year} ${fromEmbedded.make} ${fromEmbedded.model}`);
        return fromEmbedded;
      }
    }
  }

  // Final fallback: markdown parsing (most reliable for BJ)
  if (fcResult.markdown) {
    const fromMd = parseMarkdown(fcResult.markdown, url);

    // Also apply embedded JSON data on top of markdown results
    if (fcResult.html) {
      const embedded = extractEmbeddedJson(fcResult.html);
      if (embedded) {
        if (!fromMd.sale_price && typeof embedded.price === "string") {
          const priceStr = (embedded.price as string).replace(/[$,]/g, "");
          const price = parseFloat(priceStr);
          if (Number.isFinite(price) && price >= 100) fromMd.sale_price = Math.round(price);
        }
        if (typeof embedded.is_sold === "boolean" && embedded.is_sold && !fromMd.status) {
          fromMd.status = "Sold";
        }
        if (typeof embedded.full_description === "string" && !fromMd.description) {
          const desc = String(embedded.full_description)
            .replace(/<[^>]+>/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&nbsp;/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          if (desc.length > 30) fromMd.description = desc.slice(0, 5000);
        }
      }

      fromMd.image_urls = extractImageUrls(fcResult.html);
    }

    // Also extract images from markdown
    if (fromMd.image_urls.length === 0) {
      const mdImageSet = new Set<string>();
      const mdImgRegex = /https:\/\/BarrettJacksonCDN\.azureedge\.net[^)\s"']+\.(jpg|jpeg|png|webp)/gi;
      let imgM;
      while ((imgM = mdImgRegex.exec(fcResult.markdown)) !== null) {
        mdImageSet.add(imgM[0]);
      }
      fromMd.image_urls = [...mdImageSet];
    }

    if (fromMd.year || fromMd.make) {
      console.log(`[BJ] Parsed via markdown: ${fromMd.year} ${fromMd.make} ${fromMd.model}`);
      return fromMd;
    }
  }

  throw new Error("Could not parse vehicle data from page");
}

// ─── Save vehicle (with quality gate + pollution detection) ─────────────────

async function saveVehicle(
  supabase: ReturnType<typeof createClient>,
  vehicle: BJVehicle,
  forceVehicleId?: string,
): Promise<{ vehicleId: string; isNew: boolean; fieldsUpdated: string[]; qualityScore: number }> {
  // Check if vehicle already exists by URL
  const { data: byUrl } = await supabase
    .from("vehicles")
    .select("id")
    .eq("discovery_url", vehicle.url)
    .limit(1)
    .maybeSingle();

  // Check import_queue for existing vehicle_id
  const { data: queueEntry } = await supabase
    .from("import_queue")
    .select("vehicle_id")
    .eq("listing_url", vehicle.url)
    .not("vehicle_id", "is", null)
    .limit(1)
    .maybeSingle();

  let existingId = forceVehicleId || queueEntry?.vehicle_id || byUrl?.id;

  // Also check by VIN (prevents duplicate key violations)
  if (!existingId && vehicle.vin && vehicle.vin.length >= 5) {
    const safeVin = String(vehicle.vin).replace(/[",().\\]/g, "");
    const { data: byVin } = await supabase
      .from("vehicles")
      .select("id")
      .eq("vin", safeVin)
      .limit(1)
      .maybeSingle();
    if (byVin?.id) existingId = byVin.id;
  }

  // Build raw data payload
  const rawData: Record<string, unknown> = {
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    vin: vehicle.vin && vehicle.vin.length >= 5 ? vehicle.vin : null,
    transmission: vehicle.transmission,
    engine_type: vehicle.engine,
    color: vehicle.exterior_color,
    interior_color: vehicle.interior_color,
    mileage: vehicle.mileage,
    sale_price: vehicle.sale_price,
    description: vehicle.description,
    discovery_url: vehicle.url,
    discovery_source: "barrett-jackson",
    listing_source: "barrett-jackson",
    source: "barrett-jackson",
    extractor_version: EXTRACTOR_VERSION,
    ...(vehicle.style ? { body_style: vehicle.style } : {}),
  };

  // Clean fields (strip HTML, reject polluted values)
  const cleaned = cleanVehicleFields(rawData, { platform: "barrett-jackson" });

  // Quality gate
  const gate = qualityGate(cleaned as Record<string, any>, {
    source: "barrett-jackson",
    sourceType: "auction",
  });

  if (gate.action === "reject") {
    console.warn(`[BJ] Quality gate REJECTED ${vehicle.url}: ${gate.issues.join(", ")}`);
    throw new Error(`Quality gate rejected (score=${gate.score}): ${gate.issues.slice(0, 3).join(", ")}`);
  }

  if (gate.action === "flag_for_review") {
    console.warn(`[BJ] Quality gate FLAGGED ${vehicle.url} (score=${gate.score}): ${gate.issues.join(", ")}`);
  }

  // Build clean upsert payload (no nulls for updates)
  const cleanData: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(gate.cleaned)) {
    if (v !== null && v !== undefined) cleanData[k] = v;
  }

  let vehicleId: string;
  let isNew = false;
  const fieldsUpdated: string[] = [];

  if (existingId) {
    // Track which fields we're adding
    const { data: existing } = await supabase
      .from("vehicles")
      .select("vin,mileage,color,description,transmission,body_style,engine_type,sale_price,interior_color")
      .eq("id", existingId)
      .maybeSingle();

    if (existing) {
      const trackFields = ["vin", "mileage", "color", "description", "transmission", "body_style", "engine_type", "sale_price", "interior_color"];
      for (const f of trackFields) {
        if (!(existing as any)[f] && cleanData[f]) fieldsUpdated.push(f);
      }
    }

    // Strip identity/source fields that should only be set on insert
    const { discovery_url: _du, discovery_source: _ds, source: _src, listing_source: _ls, ...updateData } = cleanData;

    const { error: updateErr } = await supabase.from("vehicles").update(updateData).eq("id", existingId);
    if (updateErr) {
      // VIN unique constraint: another vehicle already has this VIN. Retry without VIN.
      if (updateErr.code === "23505" && updateErr.message?.includes("vin")) {
        console.warn(`[BJ] VIN conflict for ${existingId} (vin=${cleanData.vin}), retrying without VIN`);
        const { vin: _skipVin, ...dataWithoutVin } = updateData;
        const { error: retryErr } = await supabase.from("vehicles").update(dataWithoutVin).eq("id", existingId);
        if (retryErr) throw new Error(`Vehicle update failed: ${retryErr.message}`);
      } else {
        throw new Error(`Vehicle update failed: ${updateErr.message}`);
      }
    }
    vehicleId = existingId;
  } else {
    const { data: inserted, error: insertErr } = await supabase
      .from("vehicles")
      .insert({ ...cleanData, status: "active" })
      .select("id")
      .maybeSingle();

    if (insertErr) throw new Error(`Vehicle insert failed: ${insertErr.message} (${insertErr.code})`);
    vehicleId = inserted.id;
    isNew = true;
  }

  // Save images (non-fatal)
  if (vehicle.image_urls.length > 0) {
    const imageLimit = Math.min(vehicle.image_urls.length, 80);
    for (let idx = 0; idx < imageLimit; idx++) {
      try {
        const imgUrl = vehicle.image_urls[idx];
        const { data: existingImg } = await supabase
          .from("vehicle_images")
          .select("id")
          .eq("vehicle_id", vehicleId)
          .eq("image_url", imgUrl)
          .limit(1)
          .maybeSingle();
        if (!existingImg) {
          await supabase.from("vehicle_images").insert({
            vehicle_id: vehicleId,
            image_url: imgUrl,
            source: "external_import",
            source_url: imgUrl,
            is_external: true,
            position: idx,
          });
        }
      } catch (e) {
        console.warn(`[BJ] Image insert failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // Create vehicle_event record (non-fatal)
  try {
    const { data: existingListing } = await supabase
      .from("vehicle_events")
      .select("id")
      .eq("vehicle_id", vehicleId)
      .eq("source_platform", "barrettjackson")
      .eq("source_url", vehicle.url)
      .limit(1)
      .maybeSingle();

    if (!existingListing) {
      await supabase.from("vehicle_events").insert({
        vehicle_id: vehicleId,
        source_platform: "barrettjackson",
        event_type: "auction",
        source_url: vehicle.url,
        event_status: vehicle.status?.toLowerCase() === "sold" ? "sold" :
                        vehicle.status?.toLowerCase() === "not sold" ? "unsold" :
                        vehicle.status?.toLowerCase() === "withdrawn" ? "cancelled" :
                        "ended",
        final_price: vehicle.sale_price || null,
        metadata: {
          lot_number: vehicle.lot_number,
          auction_name: vehicle.auction_name,
          extraction_method: vehicle.extraction_method,
          extractor_version: EXTRACTOR_VERSION,
        },
      });
    }
  } catch (e) {
    console.warn(`[BJ] External listing insert failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
  }

  // Create auction event (non-fatal)
  try {
    const { data: existingEvent } = await supabase
      .from("auction_events")
      .select("id")
      .eq("vehicle_id", vehicleId)
      .eq("source", "barrett-jackson")
      .eq("source_url", vehicle.url)
      .limit(1)
      .maybeSingle();

    if (!existingEvent) {
      await supabase.from("auction_events").insert({
        vehicle_id: vehicleId,
        source: "barrett-jackson",
        source_url: vehicle.url,
        outcome: vehicle.status?.toLowerCase() === "sold" ? "sold" : "listed",
        winning_bid: vehicle.sale_price || null,
        lot_number: vehicle.lot_number || null,
      });
    }
  } catch (e) {
    console.warn(`[BJ] Auction event insert failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
  }

  return { vehicleId, isNew, fieldsUpdated, qualityScore: gate.score };
}

// ─── Main handler ───────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body.action || "extract";
    const url = body.url as string | undefined;

    // ── Single URL extraction ─────────────────────────────────────────────
    if (action === "extract" && url) {
      if (!url.includes("barrett-jackson.com")) {
        return okJson({ success: false, error: "Not a Barrett-Jackson URL" }, 400);
      }

      console.log(`[BJ] Extracting: ${url}`);

      let vehicle: BJVehicle;
      try {
        vehicle = await fetchAndParse(url);
      } catch (e: any) {
        if (e.message === "PAGE_NOT_FOUND") {
          return okJson({ success: false, error: "Page not found (removed by Barrett-Jackson)" }, 410);
        }
        throw e;
      }

      if (!vehicle.year && !vehicle.make) {
        return okJson({ success: false, error: "Could not parse vehicle data from page" }, 422);
      }

      console.log(
        `[BJ] Parsed: ${vehicle.year} ${vehicle.make} ${vehicle.model}, ` +
          `vin=${vehicle.vin}, price=$${vehicle.sale_price}, mileage=${vehicle.mileage}, ` +
          `${vehicle.image_urls.length} images, method=${vehicle.extraction_method}`,
      );

      const { vehicleId, isNew, fieldsUpdated, qualityScore } = await saveVehicle(supabase, vehicle);

      // Update queue entry if exists
      try {
        await supabase
          .from("import_queue")
          .update({ status: "complete", vehicle_id: vehicleId, error_message: null })
          .eq("listing_url", url);
      } catch (e) {
        console.warn(`[BJ] Queue update failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
      }

      return okJson({
        success: true,
        vehicle_id: vehicleId,
        is_new: isNew,
        quality_score: qualityScore,
        extraction_method: vehicle.extraction_method,
        fields_updated: fieldsUpdated,
        vehicle: {
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          vin: vehicle.vin,
          mileage: vehicle.mileage,
          sale_price: vehicle.sale_price,
          description: vehicle.description ? `${vehicle.description.length} chars` : null,
          images: vehicle.image_urls.length,
          auction: vehicle.auction_name,
          status: vehicle.status,
        },
      });
    }

    // ── Batch from queue ──────────────────────────────────────────────────
    if (action === "batch_from_queue") {
      const rawLimit = Number(body.limit);
      const limit = Math.min(
        Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 10,
        50,
      );

      const { data: items, error: claimErr } = await supabase
        .from("import_queue")
        .select("id, listing_url")
        .eq("status", "pending")
        .like("listing_url", "%barrett-jackson.com%")
        .order("created_at", { ascending: true })
        .limit(limit);

      if (claimErr) throw claimErr;
      if (!items?.length) {
        return okJson({ success: true, message: "No BJ items in queue", processed: 0 });
      }

      const ids = items.map((i: { id: string }) => i.id);
      await supabase
        .from("import_queue")
        .update({ status: "processing", locked_at: new Date().toISOString() })
        .in("id", ids);

      const results = {
        total: items.length,
        success: 0,
        failed: 0,
        created: 0,
        updated: 0,
        rejected: 0,
        errors: [] as string[],
      };

      for (const item of items) {
        try {
          const vehicle = await fetchAndParse(item.listing_url);

          if (!vehicle.year && !vehicle.make) {
            await supabase
              .from("import_queue")
              .update({ status: "failed", error_message: "Could not parse vehicle data", attempts: 1 })
              .eq("id", item.id);
            results.failed++;
            continue;
          }

          const { vehicleId, isNew } = await saveVehicle(supabase, vehicle);

          await supabase
            .from("import_queue")
            .update({ status: "complete", vehicle_id: vehicleId, error_message: null })
            .eq("id", item.id);

          results.success++;
          if (isNew) results.created++;
          else results.updated++;

          // Delay between Firecrawl calls to avoid rate limiting
          await new Promise((r) => setTimeout(r, 1000));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const isRejected = msg.includes("Quality gate rejected");
          const isRemoved = msg === "PAGE_NOT_FOUND";

          if (isRejected) results.rejected++;
          else results.failed++;

          if (results.errors.length < 5) {
            results.errors.push(`${item.listing_url}: ${msg.slice(0, 120)}`);
          }

          await supabase
            .from("import_queue")
            .update({
              status: isRemoved ? "skipped" : "failed",
              error_message: (isRemoved ? "Page removed/404" : msg).slice(0, 500),
            })
            .eq("id", item.id);
        }
      }

      return okJson({ success: true, ...results });
    }

    // ── Re-enrich existing vehicles (concurrent) ──────────────────────────
    if (action === "re_enrich") {
      const rawLimit = Number(body.limit);
      const limit = Math.min(
        Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 15,
        100,
      );
      const concurrency = Math.min(Number(body.concurrency) || 3, 10);

      // Find BJ vehicles missing key fields (skip non-vehicle items like stagecoaches, buggies)
      const { data: candidates, error: candErr } = await supabase
        .from("vehicles")
        .select("id, discovery_url")
        .eq("discovery_source", "barrett-jackson")
        .or("description.is.null,sale_price.is.null")
        .not("discovery_url", "is", null)
        .gte("year", 1885)
        .order("updated_at", { ascending: true })
        .limit(limit);

      if (candErr) throw new Error(`Query error: ${candErr.message}`);
      if (!candidates?.length) {
        return okJson({ success: true, message: "No BJ candidates to enrich", processed: 0 });
      }

      const results = {
        total: candidates.length,
        success: 0,
        failed: 0,
        fields_added: 0,
        field_counts: {} as Record<string, number>,
        errors: [] as string[],
      };

      async function processOne(cand: { id: string; discovery_url: string }) {
        try {
          const vehicle = await fetchAndParse(cand.discovery_url);

          if (!vehicle.year && !vehicle.make) {
            results.failed++;
            return;
          }

          // Pass candidate ID to update the correct vehicle (avoids duplicate URL mismatch)
          const { fieldsUpdated } = await saveVehicle(supabase, vehicle, cand.id);

          results.success++;
          results.fields_added += fieldsUpdated.length;
          for (const f of fieldsUpdated) {
            results.field_counts[f] = (results.field_counts[f] || 0) + 1;
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          results.failed++;
          if (results.errors.length < 5) results.errors.push(`${cand.discovery_url}: ${msg.slice(0, 100)}`);
        }
      }

      for (let i = 0; i < candidates.length; i += concurrency) {
        const chunk = candidates.slice(i, i + concurrency);
        await Promise.all(chunk.map(processOne));
      }

      return okJson({ success: true, ...results });
    }

    // ── Stats ─────────────────────────────────────────────────────────────
    if (action === "stats") {
      const { data: stats } = await supabase.rpc("execute_sql", {
        query: `
          SELECT
            count(*) FILTER (WHERE status = 'pending') as pending,
            count(*) FILTER (WHERE status = 'complete') as complete,
            count(*) FILTER (WHERE status = 'failed') as failed,
            count(*) FILTER (WHERE status = 'processing') as processing,
            count(*) FILTER (WHERE status = 'skipped') as skipped
          FROM import_queue
          WHERE listing_url LIKE '%barrett-jackson.com%'
        `,
      });

      // Also get vehicle data quality stats
      const { data: quality } = await supabase.rpc("execute_sql", {
        query: `
          SELECT
            count(*) as total_vehicles,
            count(description) as with_description,
            count(sale_price) as with_price,
            count(mileage) as with_mileage,
            count(vin) as with_vin,
            round(100.0 * count(description) / NULLIF(count(*), 0), 1) as desc_pct,
            round(100.0 * count(sale_price) / NULLIF(count(*), 0), 1) as price_pct
          FROM vehicles
          WHERE discovery_source = 'barrett-jackson'
        `,
      });

      return okJson({
        success: true,
        extractor_version: EXTRACTOR_VERSION,
        queue: Array.isArray(stats) ? stats[0] : {},
        quality: Array.isArray(quality) ? quality[0] : {},
      });
    }

    return okJson(
      { success: false, error: "Provide url or action (extract, batch_from_queue, re_enrich, stats)" },
      400,
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : (typeof e === "object" && e !== null ? JSON.stringify(e) : String(e));
    console.error("[BJ] Error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
