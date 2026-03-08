/**
 * EXTRACT KSL LISTING
 *
 * Extracts vehicle data from a KSL Cars listing page.
 * KSL is a Next.js app — all data is in the server-rendered HTML.
 * No AI needed, pure HTML parsing.
 *
 * Fields extracted:
 * - year, make, model (from title)
 * - price (from aria-label)
 * - mileage (from bold label)
 * - location (from title/page)
 * - images (ksldigital.com URLs)
 * - description (tabs section)
 * - options/features (comma-separated list)
 * - listing metadata (listing number, posted date, views, favorites)
 * - seller type (dealer vs private)
 *
 * Deploy: supabase functions deploy extract-ksl-listing --no-verify-jwt
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// ─── HTML Parsing Helpers ───────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/<!--.*?-->/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBetween(html: string, startPattern: RegExp, endPattern: RegExp): string | null {
  const startMatch = startPattern.exec(html);
  if (!startMatch) return null;
  const rest = html.slice(startMatch.index + startMatch[0].length);
  const endMatch = endPattern.exec(rest);
  if (!endMatch) return rest.slice(0, 5000);
  return rest.slice(0, endMatch.index);
}

const MULTI_WORD_MAKES = [
  "Land Rover", "Aston Martin", "Alfa Romeo", "Mercedes-Benz",
  "AM General", "De Tomaso", "Rolls-Royce", "Austin-Healey",
];

function parseYearMakeModel(titleStr: string): { year: number | null; make: string | null; model: string | null } {
  // Title format: "2024 Ram 2500 Tradesman in Salt Lake City, UT | KSL Cars"
  const cleaned = titleStr.replace(/\s*\|.*$/, "").replace(/\s+in\s+.+$/, "").trim();
  const m = cleaned.match(/^(\d{4})\s+(.+)/);
  if (!m) return { year: null, make: null, model: null };

  const year = parseInt(m[1], 10);
  if (year < 1900 || year > 2030) return { year: null, make: null, model: null };

  const remainder = m[2].trim();

  for (const mwm of MULTI_WORD_MAKES) {
    if (remainder.toLowerCase().startsWith(mwm.toLowerCase())) {
      return { year, make: mwm, model: remainder.slice(mwm.length).trim() || null };
    }
  }

  const parts = remainder.split(/\s+/);
  return { year, make: parts[0] || null, model: parts.slice(1).join(" ") || null };
}

// ─── Main Extraction ─────────────────────────────────────────────

interface KSLExtraction {
  url: string;
  ksl_listing_id: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  price: number | null;
  mileage: number | null;
  location: string | null;
  description: string | null;
  options: string[];
  image_urls: string[];
  seller_type: string | null;
  listing_number: string | null;
  posted_date: string | null;
  expiration_date: string | null;
  page_views: number | null;
  favorited: number | null;
}

function extractFromHtml(html: string, url: string): KSLExtraction {
  const listingIdMatch = url.match(/listing\/(\d+)/);
  const kslListingId = listingIdMatch ? listingIdMatch[1] : "";

  // Title from <title> tag
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const rawTitle = titleMatch ? titleMatch[1].replace(/&amp;/g, "&").replace(/&#x27;/g, "'") : null;
  const { year, make, model } = parseYearMakeModel(rawTitle || "");

  // Price from aria-label
  const priceMatch = html.match(/aria-label="Price\s*\$([0-9,]+)"/);
  const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ""), 10) : null;

  // Mileage from bold label
  const mileageMatch = html.match(/Mileage:\s*(?:<!--\s*-->)?\s*([\d,]+)/);
  const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, ""), 10) : null;

  // Location from title ("in City, ST | KSL Cars")
  const locationMatch = rawTitle?.match(/in\s+(.+?)\s*\|/);
  const location = locationMatch ? locationMatch[1].trim() : null;

  // Images — unique ksldigital.com URLs
  const imageRegex = /https:\/\/image\.ksldigital\.com\/[a-f0-9-]+\.jpg/g;
  const imageSet = new Set<string>();
  let imgMatch;
  while ((imgMatch = imageRegex.exec(html)) !== null) {
    imageSet.add(imgMatch[0]);
  }
  const imageUrls = [...imageSet];

  // Description — extract from description-tabs-section
  let description: string | null = null;
  const descSection = extractBetween(
    html,
    /description-tabs-section/,
    /contact-card|Payment Calculator|Page Stats/
  );
  if (descSection) {
    // Get text between "Description" tab content and "Options:" or "Map"/"Specifications"
    const descContent = extractBetween(
      descSection,
      /(?:>Description<\/[^>]+>){2}/,  // Second "Description" is the tab content header
      /Options:|Map|Specifications|Payment/
    );
    if (descContent) {
      description = stripHtml(descContent).trim();
      if (description.length < 10) description = null;
    }
    if (!description) {
      // Fallback: grab all text from section
      const fullText = stripHtml(descSection);
      // Remove known non-description text
      const cleaned = fullText
        .replace(/Description|Map|Specifications|Payment Calculator.*$/s, "")
        .trim();
      if (cleaned.length > 20) description = cleaned.slice(0, 2000);
    }
  }

  // Options — comma-separated list after "Options:"
  const optionsMatch = html.match(/Options:\s*<\/[^>]+>\s*<[^>]+>([^<]+)/);
  let options: string[] = [];
  if (optionsMatch) {
    const optText = optionsMatch[1].replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
    options = optText.split(",").map((o) => o.trim()).filter((o) => o.length > 1);
  }

  // Seller type
  const isDealer = /Trusted Dealer|dealer/i.test(html);
  const sellerType = isDealer ? "dealer" : "private";

  // Listing metadata
  const listingNumMatch = html.match(/Listing Number\s*<\/[^>]+>\s*<[^>]+>(\d+)/);
  const listingNumber = listingNumMatch ? listingNumMatch[1] : kslListingId;

  const postedMatch = html.match(/Posted\s*<\/[^>]+>\s*<[^>]+>([^<]+)/);
  const postedDate = postedMatch ? postedMatch[1].trim() : null;

  const expirationMatch = html.match(/Expiration Date\s*<\/[^>]+>\s*<[^>]+>([^<]+)/);
  const expirationDate = expirationMatch ? expirationMatch[1].trim() : null;

  const viewsMatch = html.match(/Page Views\s*<\/[^>]+>\s*<[^>]+>([\d,]+)/);
  const pageViews = viewsMatch ? parseInt(viewsMatch[1].replace(/,/g, ""), 10) : null;

  const favMatch = html.match(/Favorited\s*<\/[^>]+>\s*<[^>]+>([\d,]+)/);
  const favorited = favMatch ? parseInt(favMatch[1].replace(/,/g, ""), 10) : null;

  return {
    url,
    ksl_listing_id: kslListingId,
    title: rawTitle?.replace(/\s*\|.*$/, "").trim() || null,
    year,
    make,
    model,
    price,
    mileage,
    location,
    description,
    options,
    image_urls: imageUrls,
    seller_type: sellerType,
    listing_number: listingNumber,
    posted_date: postedDate,
    expiration_date: expirationDate,
    page_views: pageViews,
    favorited: favorited,
  };
}

// ─── Handler ──────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const url: string = body.url || body.listing_url || "";
    const importQueueId: string | null = body.import_queue_id || null;

    if (!url || !url.includes("ksl.com")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid KSL URL" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[ksl-extract] Fetching: ${url}`);

    // Fetch the listing page
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
    });

    if (!res.ok) {
      const errorMsg = `HTTP ${res.status} fetching ${url}`;
      console.error(`[ksl-extract] ${errorMsg}`);
      return new Response(
        JSON.stringify({ error: errorMsg, status: res.status }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const html = await res.text();
    console.log(`[ksl-extract] Got ${html.length} bytes`);

    // Check for soft blocks / captcha
    if (html.length < 5000 || html.includes("captcha") || html.includes("blocked")) {
      console.warn(`[ksl-extract] Possible block: ${html.length} bytes`);
    }

    // Extract data
    const extraction = extractFromHtml(html, url);
    console.log(
      `[ksl-extract] ${extraction.year} ${extraction.make} ${extraction.model} — $${extraction.price} — ${extraction.image_urls.length} images`,
    );

    // Archive the HTML to listing_page_snapshots
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    await supabase.from("listing_page_snapshots").upsert(
      {
        url,
        html,
        markdown: null,
        platform: "ksl",
        fetched_at: new Date().toISOString(),
        fetch_method: "direct",
        http_status: res.status,
        content_length: html.length,
      },
      { onConflict: "url" },
    ).then(() => {}, (e: any) => console.warn("[ksl-extract] Archive error:", e));

    // Update import_queue if provided
    if (importQueueId) {
      await supabase
        .from("import_queue")
        .update({
          status: "completed",
          listing_title: extraction.title,
          listing_year: extraction.year,
          listing_make: extraction.make,
          listing_model: extraction.model,
          listing_price: extraction.price,
          thumbnail_url: extraction.image_urls[0] || null,
          processed_at: new Date().toISOString(),
          extractor_version: "extract-ksl-listing@1.0",
          raw_data: {
            ...body.raw_data,
            extraction: {
              mileage: extraction.mileage,
              location: extraction.location,
              seller_type: extraction.seller_type,
              image_count: extraction.image_urls.length,
              options_count: extraction.options.length,
              page_views: extraction.page_views,
              favorited: extraction.favorited,
              posted_date: extraction.posted_date,
            },
          },
        })
        .eq("id", importQueueId);
    }

    return new Response(JSON.stringify(extraction), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[ksl-extract] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
