/**
 * refine-fb-listing
 *
 * Fetches individual FB Marketplace item pages using bingbot UA, extracts
 * rich detail data (description, images, mileage, seller name, colors), and
 * upserts to marketplace_listings.
 *
 * Replaces the previous Playwright/Chromium approach which cannot run inside
 * Supabase Edge Functions.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// Googlebot works for FB Marketplace individual listings (bingbot blocked as of 2026-03)
const GOOGLEBOT_UA =
  "Mozilla/5.0 (compatible; Googlebot/2.0; +http://www.google.com/bot.html)";
const BINGBOT_UA = GOOGLEBOT_UA; // keep old name for backward compat

interface RefinedData {
  title: string | null;
  parsed_year: number | null;
  parsed_make: string | null;
  parsed_model: string | null;
  price: number | null;
  description: string | null;
  seller_name: string | null;
  all_images: string[];
  contact_phones: string[];
  contact_emails: string[];
  mileage: number | null;
  transmission: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  location: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function decodeUnicode(s: string): string {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16))
  );
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Pull a single-line string value for a key from a raw JSON blob in HTML.
 * Works on escaped JSON (\\u sequences, \/ etc.) that isn't valid JSON on its own.
 */
function jsonVal(html: string, key: string): string | null {
  const re = new RegExp(`"${key}":\\s*"((?:[^"\\\\]|\\\\.)*)"`, "s");
  const m = html.match(re);
  if (!m) return null;
  return decodeUnicode(m[1].replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\\//g, "/"));
}

/** Extract mileage integer from strings like "180K miles", "88,000 miles" */
function parseMileage(s: string): number | null {
  const km = s.match(/([\d,.]+)\s*[Kk]\s*(?:miles?)?/);
  if (km) return Math.round(parseFloat(km[1].replace(/,/g, "")) * 1000);
  const plain = s.match(/([\d,]+)\s*miles?/i);
  if (plain) return parseInt(plain[1].replace(/,/g, ""), 10);
  return null;
}

/** Extract structured vehicle details from seller descriptions */
function parseDescription(desc: string): {
  vin: string | null;
  engine: string | null;
  trim: string | null;
  body_style: string | null;
  title_status: string | null;
  drivetrain: string | null;
  mileage: number | null;
  transmission: string | null;
  exterior_color: string | null;
} {
  const result: ReturnType<typeof parseDescription> = {
    vin: null, engine: null, trim: null, body_style: null,
    title_status: null, drivetrain: null, mileage: null,
    transmission: null, exterior_color: null,
  };

  // VIN — 17 alphanumeric, no I/O/Q
  const vinMatch = desc.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
  if (vinMatch) result.vin = vinMatch[1];

  // Engine
  const enginePatterns = [
    /\b(\d{3})\s*(ci|cubic\s*inch|cu\.?\s*in)/i,          // "350 ci"
    /\b(small|big)\s*block\s*(\d{3})?/i,                   // "small block 350"
    /\b(\d\.\d)\s*[lL]\b/,                                 // "5.7L"
    /\b(v-?[468]|inline[- ]?[46]|flat[- ]?[46]|i[46])\b/i, // "V8", "inline 6"
    /\b(\d{3,4})\s*(v8|v6|v4)\b/i,                         // "350 V8"
    /\b(\d{3})\s*(motor|engine)\b/i,                       // "400 motor", "350 engine"
    /\b(ls\d|lt\d|sbc|bbc|hemi|flathead|windsor|cleveland|coyote|vortec|ecoboost)\b/i,
  ];
  for (const p of enginePatterns) {
    const m = desc.match(p);
    if (m) { result.engine = m[0].trim(); break; }
  }

  // Trim / package
  const trimPatterns = [
    /\b(scottsdale|cheyenne|silverado|custom\s*deluxe|sierra\s*classic|sierra\s*grande|high\s*sierra|big\s*10)\b/i,
    /\b(sport|gt|ss|rs|z28|z\/28|rt|r\/t|srt|sr5|limited|xlt|lariat|king\s*ranch|laramie|sle|slt)\b/i,
    /\b(base|standard|deluxe|special|custom)\b/i,
  ];
  for (const p of trimPatterns) {
    const m = desc.match(p);
    if (m) { result.trim = m[1].trim(); break; }
  }

  // Body style
  const bodyPatterns = [
    /\b(short\s*(?:bed|box)|long\s*(?:bed|box)|stepside|fleetside|step\s*side|fleet\s*side)\b/i,
    /\b(crew\s*cab|ext(?:ended)?\s*cab|regular\s*cab|single\s*cab|quad\s*cab|super\s*cab)\b/i,
    /\b(convertible|hardtop|fastback|hatchback|wagon|coupe|sedan|roadster)\b/i,
  ];
  for (const p of bodyPatterns) {
    const m = desc.match(p);
    if (m) { result.body_style = m[1].trim(); break; }
  }

  // Title status
  if (/\bclean\s*title\b/i.test(desc)) result.title_status = "clean";
  else if (/\bsalvage\s*title\b/i.test(desc)) result.title_status = "salvage";
  else if (/\brebuilt\s*title\b/i.test(desc)) result.title_status = "rebuilt";
  else if (/\bno\s*title\b/i.test(desc)) result.title_status = "none";

  // Drivetrain
  if (/\b4x4\b|4wd\b|four\s*wheel\s*drive\b/i.test(desc)) result.drivetrain = "4WD";
  else if (/\b2wd\b|2x4\b|two\s*wheel\s*drive\b/i.test(desc)) result.drivetrain = "2WD";
  else if (/\bawd\b|all\s*wheel\s*drive\b/i.test(desc)) result.drivetrain = "AWD";

  // Mileage
  result.mileage = parseMileage(desc);

  // Transmission
  const transMatch = desc.match(/\b(automatic|manual|standard|5[- ]?speed|4[- ]?speed|3[- ]?speed|th350|th400|turbo\s*350|turbo\s*400|muncie|t5|t56|nv3500|nv4500|700r4|4l60|4l80|powerglide)\b/i);
  if (transMatch) result.transmission = transMatch[1].trim().toLowerCase();

  // Exterior color
  const colorMatch = desc.match(/\b(black|white|red|blue|green|yellow|orange|silver|gray|grey|brown|tan|beige|gold|maroon|burgundy|cream|bronze|copper|teal|purple)\b/i);
  if (colorMatch) result.exterior_color = colorMatch[1].toLowerCase();

  return result;
}

// ---------------------------------------------------------------------------
// Title parser (kept from original)
// ---------------------------------------------------------------------------

const MAKE_MAP: Record<string, string> = {
  chevy: "Chevrolet", chevrolet: "Chevrolet",
  ford: "Ford", dodge: "Dodge", gmc: "GMC",
  toyota: "Toyota", honda: "Honda", nissan: "Nissan",
  mazda: "Mazda", subaru: "Subaru", mitsubishi: "Mitsubishi",
  jeep: "Jeep", ram: "Ram", chrysler: "Chrysler",
  plymouth: "Plymouth", pontiac: "Pontiac", buick: "Buick",
  oldsmobile: "Oldsmobile", cadillac: "Cadillac",
  "mercedes-benz": "Mercedes-Benz", mercedes: "Mercedes-Benz",
  bmw: "BMW", volkswagen: "Volkswagen", vw: "Volkswagen",
  porsche: "Porsche", audi: "Audi", volvo: "Volvo",
  "land rover": "Land Rover", jaguar: "Jaguar", mini: "Mini",
  saab: "Saab", lexus: "Lexus", acura: "Acura",
  infiniti: "Infiniti", hyundai: "Hyundai", kia: "Kia",
  amc: "AMC", international: "International", datsun: "Datsun",
  triumph: "Triumph", mg: "MG",
};

function parseTitle(title: string): {
  year: number | null;
  make: string | null;
  model: string | null;
  cleanPrice: number | null;
} {
  let cleanPrice: number | null = null;
  // Match price at start, stopping at whitespace or end-of-string
  // This prevents capturing concatenated price+year (e.g. "$800001967")
  const priceMatch = title.match(/^\$?([\d,]+)(?:\s|$)/);
  if (priceMatch) {
    const priceStr = priceMatch[1].replace(/,/g, "");
    const val = parseInt(priceStr, 10);
    // Sanity check: real vehicle prices are $100 - $50M
    if (val >= 100 && val <= 50_000_000) {
      cleanPrice = val;
    }
  }

  let cleaned = title
    .replace(/^\$[\d,]+(?=\d{4})/g, "")
    .replace(/^\$[\d,]+\s*/g, "")
    .replace(/[A-Z][a-z]+,\s*[A-Z]{2}.*$/g, "")
    .replace(/\d+[Kk]\s*miles.*$/gi, "")
    .trim();

  const yearMatch = cleaned.match(/\b(19[2-9]\d|20[0-3]\d)\b/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
  if (!year) return { year: null, make: null, model: null, cleanPrice };

  const afterYear = cleaned.split(String(year))[1]?.trim() || "";
  const words = afterYear.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return { year, make: null, model: null, cleanPrice };

  const rawMake = words[0].toLowerCase();
  const make =
    MAKE_MAP[rawMake] ||
    words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();

  const stopWords = [
    "pickup", "truck", "sedan", "coupe", "wagon", "van",
    "suv", "convertible", "hatchback", "cab", "door", "bed",
  ];
  const modelParts: string[] = [];
  for (let i = 1; i < Math.min(words.length, 5); i++) {
    const lower = words[i].toLowerCase();
    if (stopWords.includes(lower) || /^[A-Z][a-z]+$/.test(words[i])) break;
    modelParts.push(words[i]);
    if (modelParts.length >= 2) break;
  }

  return { year, make, model: modelParts.join(" ") || null, cleanPrice };
}

// ---------------------------------------------------------------------------
// Contact extraction (kept from original)
// ---------------------------------------------------------------------------

function extractContactInfo(text: string): {
  phones: string[];
  emails: string[];
} {
  const phones: string[] = [];
  const emails: string[] = [];

  // Disguised phones: "3 o 2 4 5 6 7 8 9 o"
  const disguised = text.match(
    /\b\d[\s\-\.]*\d[\s\-\.]*\d[\s\-\.]*\d[\s\-\.]*\d[\s\-\.]*\d[\s\-\.]*\d[\s\-\.]*\d[\s\-\.]*\d[\s\-\.]*\d\b/g
  );
  if (disguised) {
    for (const d of disguised) {
      const cleaned = d.replace(/[\s\-\.oO]/g, (c) =>
        c === "o" || c === "O" ? "0" : ""
      );
      if (cleaned.length === 10 && /^\d+$/.test(cleaned)) {
        const fmt = `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
        if (!phones.includes(fmt)) phones.push(fmt);
      }
    }
  }

  const patterns = [
    /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    /\b\(\d{3}\)\s?\d{3}[-.\s]?\d{4}\b/g,
    /\b\d{10}\b/g,
  ];
  for (const pattern of patterns) {
    const matches = text.match(pattern) || [];
    for (const m of matches) {
      const cleaned = m.replace(/[^\d]/g, "");
      if (cleaned.length === 10) {
        const fmt = `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
        if (!phones.includes(fmt)) phones.push(fmt);
      }
    }
  }

  const emailMatches = text.match(
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
  ) || [];
  for (const e of emailMatches) {
    const lc = e.toLowerCase();
    if (!emails.includes(lc)) emails.push(lc);
  }

  return { phones, emails };
}

// ---------------------------------------------------------------------------
// Core bingbot fetch + parse
// ---------------------------------------------------------------------------

async function extractFullListing(url: string, debug = false): Promise<RefinedData & { _debug?: Record<string, unknown> }> {
  // Normalize to www (m. returns a generic redirect for bots)
  const normalizedUrl = url
    .replace("m.facebook.com", "www.facebook.com")
    .replace(/[?#].*$/, "");

  const resp = await fetch(normalizedUrl, {
    headers: {
      "User-Agent": BINGBOT_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "identity",
      Referer: "https://www.facebook.com/marketplace/vehicles/",
    },
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} fetching ${normalizedUrl}`);
  }

  const html = await resp.text();

  // -------------------------------------------------------------------------
  // IMPORTANT: On individual listing pages, og: meta tags carry the data for
  // the *requested* listing. JSON blobs in the page body belong to related /
  // recommended listings — do NOT use them for primary field extraction.
  // -------------------------------------------------------------------------

  // --- Title (og:title is canonical for the requested listing) ---
  const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1];
  const title = ogTitle ? decodeHtmlEntities(decodeUnicode(ogTitle)) : null;

  // --- Description (og:description is full text for the requested listing) ---
  const ogDesc = html.match(/<meta property="og:description" content="([^"]+)"/)?.[1];
  const description = ogDesc ? decodeHtmlEntities(decodeUnicode(ogDesc)) : null;

  // --- Primary image ---
  // og:image is the high-res scontent URL for the requested listing.
  const ogImage = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
  const primaryImage = ogImage ? decodeHtmlEntities(ogImage) : null;

  // --- Price ---
  // Price is NOT reliably available without auth on individual pages.
  // Return null — callers should preserve the price already stored from the
  // initial scrape rather than overwriting with null.
  const price: number | null = null;

  // --- Mileage ---
  // Parse from description if seller mentioned it (common: "180k miles", "88,000 mi")
  const mileage = description ? parseMileage(description) : null;

  // --- Vehicle attributes from description text ---
  const transmission =
    description?.match(/\b(automatic|manual|standard|auto)\b/i)?.[1]?.toLowerCase() ?? null;

  // --- Location ---
  // og:url contains the item ID; location may appear in description or not at all.
  // We don't extract location here — the initial scrape already captured it.
  const location: string | null = null;

  // --- Seller ---
  // Not available without auth on item pages.
  const sellerName: string | null = null;

  // --- Images ---
  const imageSet = new Set<string>();
  if (primaryImage) imageSet.add(primaryImage);

  // Additional scontent images embedded in the page (if any)
  for (const m of html.matchAll(/"uri":"(https:\/\/scontent[^"]+)"/g)) {
    const u = decodeUnicode(m[1].replace(/\\\//g, "/"));
    if (!u.includes("emoji") && !u.includes("_s.") && !u.includes("_t.")) {
      imageSet.add(u);
    }
  }

  const all_images = [...imageSet].slice(0, 20);

  // --- Contact info from description ---
  const { phones, emails } = extractContactInfo(description ?? "");

  // --- Parse title for year/make/model ---
  const parsed = title
    ? parseTitle(title)
    : { year: null, make: null, model: null, cleanPrice: null };

  const result: RefinedData & { _debug?: Record<string, unknown> } = {
    title,
    parsed_year: parsed.year,
    parsed_make: parsed.make,
    parsed_model: parsed.model,
    price, // null — preserve existing price in caller
    description,
    seller_name: sellerName,
    all_images,
    contact_phones: phones,
    contact_emails: emails,
    mileage,
    transmission,
    exterior_color: null,
    interior_color: null,
    location, // null — preserve existing location in caller
  };

  if (debug) {
    result._debug = {
      http_status: resp.status,
      html_size: html.length,
      og_title: ogTitle ?? null,
      og_desc: ogDesc?.slice(0, 200) ?? null,
      og_image: ogImage?.slice(0, 100) ?? null,
      html_snippet: html.slice(0, 500),
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Edge function handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));
    const { facebook_id, url, batch_size, debug, action } = body;

    // ---- Fetch descriptions for listings that have none ----
    // This is the key enrichment action: picks listings with URLs but no
    // description, fetches each page via bingbot, extracts description +
    // structured fields, writes to marketplace_listings AND vehicles.
    if (action === "fetch_descriptions") {
      const limit = Math.min(batch_size || 10, 25); // conservative: bingbot fetches are slow

      // Get listings that have a URL and no description (vehicle_id not required —
      // saved items arrive without vehicles and need enrichment before import)
      const { data: candidates, error: findErr } = await supabase
        .from("marketplace_listings")
        .select("facebook_id, url, title, vehicle_id, price, mileage, transmission, exterior_color")
        .is("description", null)
        .eq("status", "active")
        .not("facebook_id", "is", null)
        .order("first_seen_at", { ascending: false })
        .limit(limit);

      if (findErr) throw findErr;
      if (!candidates || candidates.length === 0) {
        return new Response(
          JSON.stringify({ action: "fetch_descriptions", message: "No listings need description fetch", count: 0 }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const results: { facebook_id: string; success: boolean; got_description: boolean; fields_extracted: number; error?: string }[] = [];
      let totalDescriptions = 0;
      let totalFields = 0;

      for (const listing of candidates) {
        try {
          const listingUrl = listing.url || `https://www.facebook.com/marketplace/item/${listing.facebook_id}/`;

          // Fetch via bingbot
          const refined = await extractFullListing(listingUrl, false);

          // Update marketplace_listings with whatever we got
          const listingUpdates: Record<string, unknown> = {
            refined_at: new Date().toISOString(),
          };
          if (refined.description) listingUpdates.description = refined.description;
          if (refined.title && !listing.title) listingUpdates.title = refined.title;
          if (refined.mileage && !listing.mileage) listingUpdates.mileage = refined.mileage;
          if (refined.transmission && !listing.transmission) listingUpdates.transmission = refined.transmission;
          if (refined.all_images.length > 0) listingUpdates.all_images = refined.all_images;
          if (refined.contact_phones.length > 0 || refined.contact_emails.length > 0) {
            listingUpdates.contact_info = { phones: refined.contact_phones, emails: refined.contact_emails };
          }

          await supabase
            .from("marketplace_listings")
            .update(listingUpdates)
            .eq("facebook_id", listing.facebook_id);

          // Propagate to vehicle record
          let fieldsExtracted = 0;
          if (listing.vehicle_id) {
            const vehicleUpdates: Record<string, unknown> = {};

            if (refined.description) {
              vehicleUpdates.description = refined.description;
              fieldsExtracted++;
              totalDescriptions++;

              // Parse structured data from the description
              const parsed = parseDescription(refined.description);
              if (parsed.vin) { vehicleUpdates.vin = parsed.vin; fieldsExtracted++; }
              if (parsed.trim) { vehicleUpdates.trim = parsed.trim; fieldsExtracted++; }
              if (parsed.drivetrain) { vehicleUpdates.drivetrain = parsed.drivetrain; fieldsExtracted++; }
              if (parsed.mileage) { vehicleUpdates.mileage = parsed.mileage; fieldsExtracted++; }
              if (parsed.transmission) { vehicleUpdates.transmission = parsed.transmission; fieldsExtracted++; }
              if (parsed.exterior_color) { vehicleUpdates.color = parsed.exterior_color; fieldsExtracted++; }
              if (parsed.engine) { vehicleUpdates.engine_type = parsed.engine; fieldsExtracted++; }
              if (parsed.body_style) { vehicleUpdates.body_style = parsed.body_style; fieldsExtracted++; }
            }

            if (refined.mileage && !vehicleUpdates.mileage) { vehicleUpdates.mileage = refined.mileage; fieldsExtracted++; }
            if (refined.transmission && !vehicleUpdates.transmission) { vehicleUpdates.transmission = refined.transmission; fieldsExtracted++; }

            // Enrich origin_metadata
            const { data: existing } = await supabase
              .from("vehicles")
              .select("origin_metadata")
              .eq("id", listing.vehicle_id)
              .maybeSingle();
            const meta = (existing?.origin_metadata as Record<string, unknown>) || {};
            const parsed = refined.description ? parseDescription(refined.description) : null;
            if (parsed?.engine) meta.engine = parsed.engine;
            if (parsed?.body_style) meta.body_style = parsed.body_style;
            if (parsed?.title_status) meta.title_status = parsed.title_status;
            if (refined.contact_phones.length > 0) meta.contact_phones = refined.contact_phones;
            if (refined.contact_emails.length > 0) meta.contact_emails = refined.contact_emails;
            meta.fetched_via_bingbot_at = new Date().toISOString();
            vehicleUpdates.origin_metadata = meta;

            if (Object.keys(vehicleUpdates).length > 0) {
              await supabase
                .from("vehicles")
                .update(vehicleUpdates)
                .eq("id", listing.vehicle_id);
            }
          }

          totalFields += fieldsExtracted;
          results.push({
            facebook_id: listing.facebook_id,
            success: true,
            got_description: !!refined.description,
            fields_extracted: fieldsExtracted,
          });
        } catch (e: any) {
          results.push({
            facebook_id: listing.facebook_id,
            success: false,
            got_description: false,
            fields_extracted: 0,
            error: e.message,
          });
        }
      }

      return new Response(
        JSON.stringify({
          action: "fetch_descriptions",
          candidates_found: candidates.length,
          processed: results.length,
          descriptions_fetched: totalDescriptions,
          total_fields_extracted: totalFields,
          success_rate: `${results.filter(r => r.success).length}/${results.length}`,
          description_rate: `${totalDescriptions}/${results.length}`,
          results,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Backfill images from raw_scrape_data ----
    if (action === "backfill_images") {
      const limit = Math.min(batch_size || 500, 500);

      // Find listings with raw_scrape_data containing image arrays but no all_images
      const { data: candidates, error: findErr } = await supabase
        .from("marketplace_listings")
        .select("id, raw_scrape_data, vehicle_id")
        .not("raw_scrape_data", "is", null)
        .or("all_images.is.null,all_images.eq.{}")
        .limit(limit);

      if (findErr) throw findErr;
      if (!candidates || candidates.length === 0) {
        return new Response(
          JSON.stringify({ message: "No listings need image backfill", count: 0 }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let backfilled = 0;
      let vehiclesPropagated = 0;
      const errors: string[] = [];

      for (const listing of candidates) {
        try {
          const raw = listing.raw_scrape_data as Record<string, any>;
          // Try common field names for image arrays in raw scrape data
          const imageArray =
            raw?.all_image_urls ||
            raw?.image_urls ||
            raw?.images ||
            raw?.listing_images ||
            raw?.photo_urls;

          if (!Array.isArray(imageArray) || imageArray.length === 0) continue;

          // Filter to valid URL strings
          const validImages = imageArray
            .filter((u: any) => typeof u === "string" && u.startsWith("http"))
            .slice(0, 20); // Cap at 20 images per listing

          if (validImages.length === 0) continue;

          // Update marketplace_listings.all_images
          const { error: updateErr } = await supabase
            .from("marketplace_listings")
            .update({
              all_images: validImages,
              image_url: validImages[0], // Set primary image too
            })
            .eq("id", listing.id);

          if (updateErr) {
            errors.push(`listing ${listing.id}: ${updateErr.message}`);
            continue;
          }
          backfilled++;

          // Propagate to vehicle_images for linked vehicles that lack images
          if (listing.vehicle_id) {
            const { count: existingCount } = await supabase
              .from("vehicle_images")
              .select("*", { count: "exact", head: true })
              .eq("vehicle_id", listing.vehicle_id);

            if (!existingCount || existingCount === 0) {
              const imageRows = validImages.map((imgUrl: string, i: number) => ({
                vehicle_id: listing.vehicle_id,
                image_url: imgUrl,
                is_primary: i === 0,
                source: "fb_marketplace_backfill",
              }));
              await supabase.from("vehicle_images").insert(imageRows);

              // Also set primary_image_url on the vehicle
              await supabase
                .from("vehicles")
                .update({ primary_image_url: validImages[0] })
                .eq("id", listing.vehicle_id);

              vehiclesPropagated++;
            }
          }
        } catch (e: any) {
          errors.push(`listing ${listing.id}: ${e.message}`);
        }
      }

      return new Response(
        JSON.stringify({
          action: "backfill_images",
          candidates_found: candidates.length,
          backfilled,
          vehicles_propagated: vehiclesPropagated,
          errors: errors.length > 0 ? errors : undefined,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Single listing ----
    if (facebook_id || url) {
      const listingUrl =
        url || `https://www.facebook.com/marketplace/item/${facebook_id}/`;

      const refined = await extractFullListing(listingUrl, !!debug);

      if (facebook_id) {
        const updates: Record<string, unknown> = {
          refined_at: new Date().toISOString(),
        };
        // Only write non-null values to avoid clobbering existing scraped data
        if (refined.title) updates.title = refined.title;
        if (refined.parsed_year) {
          updates.parsed_year = refined.parsed_year;
          updates.extracted_year = refined.parsed_year;
        }
        if (refined.parsed_make) {
          updates.parsed_make = refined.parsed_make.toLowerCase();
          updates.extracted_make = refined.parsed_make.toLowerCase();
        }
        if (refined.parsed_model) {
          updates.parsed_model = refined.parsed_model.toLowerCase();
          updates.extracted_model = refined.parsed_model.toLowerCase();
        }
        if (refined.description) updates.description = refined.description;
        if (refined.mileage) {
          updates.mileage = refined.mileage;
          updates.extracted_mileage = refined.mileage;
        }
        if (refined.transmission) updates.transmission = refined.transmission;
        if (refined.all_images.length > 0) updates.all_images = refined.all_images;
        // Pack phones/emails into contact_info JSONB (existing column)
        if (refined.contact_phones.length > 0 || refined.contact_emails.length > 0) {
          updates.contact_info = {
            phones: refined.contact_phones,
            emails: refined.contact_emails,
          };
        }

        const { error: updateError } = await supabase
          .from("marketplace_listings")
          .update(updates)
          .eq("facebook_id", facebook_id);

        if (updateError) {
          console.error("DB update error:", updateError.message);
        }
      }

      return new Response(JSON.stringify({ success: true, refined }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- Batch refinement ----
    // Phase 1: Parse descriptions we already have from the GraphQL scrape
    //          and propagate structured data to the vehicle record.
    //          No external fetching needed — we're the expert, we just
    //          need to read what sellers already told us.
    const limit = Math.min(batch_size || 50, 200);

    // Prioritize listings that have descriptions (more to extract from)
    // NOTE: vehicle_id filter removed — saved items arrive without vehicles
    // and need refinement before import can create vehicle records.
    const { data: listings, error: fetchError } = await supabase
      .from("marketplace_listings")
      .select("facebook_id, url, title, vehicle_id, description, mileage, transmission, exterior_color, all_images, price")
      .is("refined_at", null)
      .eq("status", "active")
      .not("description", "is", null)
      .order("first_seen_at", { ascending: false })
      .limit(limit);

    if (fetchError) throw fetchError;
    if (!listings || listings.length === 0) {
      // Phase 1 complete — all listings with descriptions are refined.
      // Phase 2: parse titles and raw_scrape_data for listings WITHOUT descriptions.
      // NOTE: Fetching individual FB listing pages from cloud IPs doesn't work
      // (Facebook redirects to login). Description fetching must happen from
      // residential IPs via the local fb-enrich-all.ts / enrich-fb-ollama.mjs scripts.
      // Here we extract what we CAN from the title + raw_scrape_data we already have.
      const fetchLimit = Math.min(limit, 100);

      const { data: noDescListings, error: noDescErr } = await supabase
        .from("marketplace_listings")
        .select("facebook_id, title, vehicle_id, price, raw_scrape_data")
        .is("description", null)
        .is("refined_at", null)
        .eq("status", "active")
        .not("title", "is", null)
        .order("first_seen_at", { ascending: false })
        .limit(fetchLimit);

      if (noDescErr) throw noDescErr;
      if (!noDescListings || noDescListings.length === 0) {
        return new Response(
          JSON.stringify({ message: "No listings need refinement or title parsing", count: 0 }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Parse titles and raw_scrape_data for year/make/model/price/location
      const titleResults: { facebook_id: string; success: boolean; fields_extracted: number }[] = [];
      let totalFieldsFromTitles = 0;

      for (const listing of noDescListings) {
        try {
          const parsed = listing.title ? parseTitle(listing.title) : { year: null, make: null, model: null, cleanPrice: null };
          const raw = listing.raw_scrape_data as Record<string, unknown> | null;
          let fields = 0;

          // Mark listing as refined (title-only)
          const listingPatch: Record<string, unknown> = { refined_at: new Date().toISOString() };
          await supabase.from("marketplace_listings").update(listingPatch).eq("facebook_id", listing.facebook_id);

          // Build vehicle updates from title + raw data
          if (listing.vehicle_id) {
            const vehicleUpdates: Record<string, unknown> = {};

            // Year/Make/Model from title (only if vehicle is missing them)
            const { data: vehicle } = await supabase
              .from("vehicles")
              .select("year, make, model, listing_location, asking_price")
              .eq("id", listing.vehicle_id)
              .maybeSingle();

            if (vehicle) {
              if (!vehicle.year && parsed.year) { vehicleUpdates.year = parsed.year; fields++; }
              if (!vehicle.make && parsed.make) { vehicleUpdates.make = parsed.make; fields++; }
              if (!vehicle.model && parsed.model) { vehicleUpdates.model = parsed.model; fields++; }

              // Location from raw_scrape_data — propagate city, state, listing_location, GPS
              if (raw) {
                const loc = raw.location as Record<string, unknown> | null;
                const geo = loc?.reverse_geocode as Record<string, unknown> | null;
                if (geo?.city && geo?.state) {
                  const cityStr = geo.city as string;
                  const stateStr = geo.state as string;
                  if (!vehicle.listing_location) {
                    vehicleUpdates.listing_location = `${cityStr}, ${stateStr}`;
                    fields++;
                  }
                  // Also set city/state if missing
                  const { data: fullVehicle } = await supabase
                    .from("vehicles")
                    .select("city, state, gps_latitude")
                    .eq("id", listing.vehicle_id)
                    .maybeSingle();
                  if (fullVehicle && !fullVehicle.city) vehicleUpdates.city = cityStr;
                  if (fullVehicle && !fullVehicle.state) vehicleUpdates.state = stateStr;
                  // Geocode from city_geocode_lookup if no GPS
                  if (fullVehicle && !fullVehicle.gps_latitude) {
                    const { data: geo2 } = await supabase
                      .from("city_geocode_lookup")
                      .select("latitude, longitude")
                      .eq("city", cityStr)
                      .eq("state", stateStr)
                      .limit(1)
                      .maybeSingle();
                    if (geo2) {
                      vehicleUpdates.gps_latitude = geo2.latitude;
                      vehicleUpdates.gps_longitude = geo2.longitude;
                      vehicleUpdates.listing_location_source = 'city_geocode_lookup';
                      vehicleUpdates.listing_location_confidence = 0.7;
                      fields++;
                    }
                  }
                }
              }

              // Price from raw_scrape_data
              if (!vehicle.asking_price && raw) {
                const price = raw.price as Record<string, unknown> | null;
                const amount = price?.amount ? parseFloat(price.amount as string) : null;
                if (amount && amount > 0) {
                  vehicleUpdates.asking_price = amount;
                  fields++;
                }
              }

              // Price from title
              if (!vehicle.asking_price && !vehicleUpdates.asking_price && parsed.cleanPrice) {
                vehicleUpdates.asking_price = parsed.cleanPrice;
                fields++;
              }

              if (Object.keys(vehicleUpdates).length > 0) {
                await supabase.from("vehicles").update(vehicleUpdates).eq("id", listing.vehicle_id);
              }
            }
          }

          totalFieldsFromTitles += fields;
          titleResults.push({ facebook_id: listing.facebook_id, success: true, fields_extracted: fields });
        } catch (e: any) {
          await supabase.from("marketplace_listings").update({ refined_at: new Date().toISOString() }).eq("facebook_id", listing.facebook_id);
          titleResults.push({ facebook_id: listing.facebook_id, success: false, fields_extracted: 0 });
        }
      }

      return new Response(
        JSON.stringify({
          phase: "title_parse",
          message: "Phase 1 (parse descriptions) complete. Phase 2: extracting from titles + raw data.",
          processed: titleResults.length,
          total_fields: totalFieldsFromTitles,
          note: "Description fetching requires residential IP. Run fb-enrich-all.ts or enrich-fb-ollama.mjs locally.",
          results: titleResults,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results: { facebook_id: string; success: boolean; fields_extracted?: number; error?: string }[] = [];

    for (const listing of listings) {
      try {
        const desc = listing.description || "";
        const titleParsed = listing.title ? parseTitle(listing.title) : { year: null, make: null, model: null, cleanPrice: null };

        // Parse structured data from description
        const parsed = desc ? parseDescription(desc) : null;

        // Contact info from description
        const { phones, emails } = extractContactInfo(desc);

        // ─── Update the listing record ──────────────────────────
        const listingUpdates: Record<string, unknown> = {
          refined_at: new Date().toISOString(),
        };
        if (parsed?.mileage && !listing.mileage) listingUpdates.mileage = parsed.mileage;
        if (parsed?.transmission && !listing.transmission) listingUpdates.transmission = parsed.transmission;
        if (parsed?.exterior_color && !listing.exterior_color) listingUpdates.exterior_color = parsed.exterior_color;
        if (phones.length > 0 || emails.length > 0) {
          listingUpdates.contact_info = { phones, emails };
        }

        await supabase
          .from("marketplace_listings")
          .update(listingUpdates)
          .eq("facebook_id", listing.facebook_id);

        // ─── Propagate enrichments to the linked vehicle ─────────
        let fieldsExtracted = 0;
        if (listing.vehicle_id) {
          const vehicleUpdates: Record<string, unknown> = {};

          if (parsed?.vin) { vehicleUpdates.vin = parsed.vin; fieldsExtracted++; }
          if (parsed?.trim) { vehicleUpdates.trim = parsed.trim; fieldsExtracted++; }
          if (parsed?.drivetrain) { vehicleUpdates.drivetrain = parsed.drivetrain; fieldsExtracted++; }
          if (parsed?.mileage) { vehicleUpdates.mileage = parsed.mileage; fieldsExtracted++; }
          if (parsed?.transmission) { vehicleUpdates.transmission = parsed.transmission; fieldsExtracted++; }
          if (parsed?.exterior_color) { vehicleUpdates.color = parsed.exterior_color; fieldsExtracted++; }
          if (desc) { vehicleUpdates.description = desc; fieldsExtracted++; }

          // Enrich origin_metadata with engine, body style, title status, contact info
          const { data: existing } = await supabase
            .from("vehicles")
            .select("origin_metadata")
            .eq("id", listing.vehicle_id)
            .maybeSingle();
          const meta = (existing?.origin_metadata as Record<string, unknown>) || {};
          if (parsed?.engine) { meta.engine = parsed.engine; fieldsExtracted++; }
          if (parsed?.body_style) { meta.body_style = parsed.body_style; fieldsExtracted++; }
          if (parsed?.title_status) { meta.title_status = parsed.title_status; fieldsExtracted++; }
          if (phones.length > 0) meta.contact_phones = phones;
          if (emails.length > 0) meta.contact_emails = emails;
          meta.refined_at = new Date().toISOString();
          vehicleUpdates.origin_metadata = meta;

          if (Object.keys(vehicleUpdates).length > 0) {
            await supabase
              .from("vehicles")
              .update(vehicleUpdates)
              .eq("id", listing.vehicle_id);
          }
        }

        results.push({ facebook_id: listing.facebook_id, success: true, fields_extracted: fieldsExtracted });
      } catch (e: any) {
        results.push({
          facebook_id: listing.facebook_id,
          success: false,
          error: e.message,
        });
      }
    }

    const totalFields = results.reduce((sum, r) => sum + (r.fields_extracted || 0), 0);

    return new Response(
      JSON.stringify({
        processed: results.length,
        successful: results.filter((r) => r.success).length,
        total_fields_extracted: totalFields,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
