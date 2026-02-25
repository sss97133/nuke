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

const BINGBOT_UA =
  "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)";

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
  const km = s.match(/^([\d,.]+)\s*[Kk]\s*(?:miles?)?$/);
  if (km) return Math.round(parseFloat(km[1].replace(/,/g, "")) * 1000);
  const plain = s.match(/([\d,]+)\s*miles?/i);
  if (plain) return parseInt(plain[1].replace(/,/g, ""), 10);
  return null;
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
  const priceMatch = title.match(/^\$?([\d,]+)/);
  if (priceMatch) {
    const priceStr = priceMatch[1].replace(/,/g, "");
    const yearInPrice = priceStr.match(/(19[2-9]\d|20[0-2]\d)/);
    if (yearInPrice) {
      const yearStart = priceStr.indexOf(yearInPrice[1]);
      cleanPrice = yearStart > 0 ? parseInt(priceStr.slice(0, yearStart), 10) : null;
    } else if (priceStr.length <= 7) {
      cleanPrice = parseInt(priceStr, 10);
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
    const { facebook_id, url, batch_size, debug } = body;

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
    const limit = Math.min(batch_size || 10, 25);

    const { data: listings, error: fetchError } = await supabase
      .from("marketplace_listings")
      .select("facebook_id, url, title")
      .or("description.is.null,mileage.is.null,refined_at.is.null")
      .eq("platform", "facebook_marketplace")
      .eq("status", "active")
      .order("first_seen_at", { ascending: false })
      .limit(limit);

    if (fetchError) throw fetchError;
    if (!listings || listings.length === 0) {
      return new Response(
        JSON.stringify({ message: "No listings need refinement", count: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results: { facebook_id: string; success: boolean; error?: string }[] = [];

    for (const listing of listings) {
      try {
        const refined = await extractFullListing(listing.url);

        const updates: Record<string, unknown> = {
          refined_at: new Date().toISOString(),
        };
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
        if (refined.contact_phones.length > 0 || refined.contact_emails.length > 0) {
          updates.contact_info = {
            phones: refined.contact_phones,
            emails: refined.contact_emails,
          };
        }

        await supabase
          .from("marketplace_listings")
          .update(updates)
          .eq("facebook_id", listing.facebook_id);

        results.push({ facebook_id: listing.facebook_id, success: true });
      } catch (e: any) {
        results.push({
          facebook_id: listing.facebook_id,
          success: false,
          error: e.message,
        });
      }

      // Polite delay between item-page fetches
      await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1000));
    }

    return new Response(
      JSON.stringify({
        processed: results.length,
        successful: results.filter((r) => r.success).length,
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
