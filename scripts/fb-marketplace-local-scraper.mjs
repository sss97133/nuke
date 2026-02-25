/**
 * FB Marketplace Local Scraper
 *
 * Runs locally (residential IP) to fetch vintage vehicle listings from FB Marketplace.
 * Uses bingbot UA + GraphQL to paginate through all vehicles listings.
 * Filters to vintage (1960-1999) by parsing title.
 * Upserts to Supabase marketplace_listings table.
 *
 * Usage:
 *   dotenvx run -- node scripts/fb-marketplace-local-scraper.mjs [--location austin] [--all] [--max-pages 5] [--dry-run]
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ALL = args.includes("--all");
const MAX_PAGES = parseInt(args[args.indexOf("--max-pages") + 1] || "10");
const SINGLE_LOCATION = args.includes("--location")
  ? args[args.indexOf("--location") + 1]
  : null;

const YEAR_MIN = 1960;
const YEAR_MAX = 1999;

// US metros: slug → {lat, lng, label}
const METRO_AREAS = {
  austin: { lat: 30.2672, lng: -97.7431, label: "Austin, TX" },
  dallas: { lat: 32.7767, lng: -96.797, label: "Dallas, TX" },
  houston: { lat: 29.7604, lng: -95.3698, label: "Houston, TX" },
  "san-antonio": { lat: 29.4241, lng: -98.4936, label: "San Antonio, TX" },
  "los-angeles": { lat: 34.0522, lng: -118.2437, label: "Los Angeles, CA" },
  chicago: { lat: 41.8781, lng: -87.6298, label: "Chicago, IL" },
  phoenix: { lat: 33.4484, lng: -112.074, label: "Phoenix, AZ" },
  philly: { lat: 39.9526, lng: -75.1652, label: "Philadelphia, PA" },
  "san-antonio": { lat: 29.4241, lng: -98.4936, label: "San Antonio, TX" },
  denver: { lat: 39.7392, lng: -104.9903, label: "Denver, CO" },
  seattle: { lat: 47.6062, lng: -122.3321, label: "Seattle, WA" },
  "las-vegas": { lat: 36.1699, lng: -115.1398, label: "Las Vegas, NV" },
  nashville: { lat: 36.1627, lng: -86.7816, label: "Nashville, TN" },
  atlanta: { lat: 33.749, lng: -84.388, label: "Atlanta, GA" },
  miami: { lat: 25.7617, lng: -80.1918, label: "Miami, FL" },
  portland: { lat: 45.5051, lng: -122.675, label: "Portland, OR" },
  "kansas-city": { lat: 39.0997, lng: -94.5786, label: "Kansas City, MO" },
  minneapolis: { lat: 44.9778, lng: -93.265, label: "Minneapolis, MN" },
  "salt-lake-city": { lat: 40.7608, lng: -111.891, label: "Salt Lake City, UT" },
  albuquerque: { lat: 35.0844, lng: -106.6504, label: "Albuquerque, NM" },
  tucson: { lat: 32.2226, lng: -110.9747, label: "Tucson, AZ" },
  fresno: { lat: 36.7378, lng: -119.7871, label: "Fresno, CA" },
  sacramento: { lat: 38.5816, lng: -121.4944, label: "Sacramento, CA" },
  "san-jose": { lat: 37.3382, lng: -121.8863, label: "San Jose, CA" },
  "san-francisco": { lat: 37.7749, lng: -122.4194, label: "San Francisco, CA" },
  memphis: { lat: 35.1495, lng: -90.0490, label: "Memphis, TN" },
  louisville: { lat: 38.2527, lng: -85.7585, label: "Louisville, KY" },
  baltimore: { lat: 39.2904, lng: -76.6122, label: "Baltimore, MD" },
  milwaukee: { lat: 43.0389, lng: -87.9065, label: "Milwaukee, WI" },
  jacksonville: { lat: 30.3322, lng: -81.6557, label: "Jacksonville, FL" },
  "oklahoma-city": { lat: 35.4676, lng: -97.5164, label: "Oklahoma City, OK" },
  "el-paso": { lat: 31.7619, lng: -106.485, label: "El Paso, TX" },
  "fort-worth": { lat: 32.7555, lng: -97.3308, label: "Fort Worth, TX" },
  columbus: { lat: 39.9612, lng: -82.9988, label: "Columbus, OH" },
  charlotte: { lat: 35.2271, lng: -80.8431, label: "Charlotte, NC" },
  indianapolis: { lat: 39.7684, lng: -86.1581, label: "Indianapolis, IN" },
  cleveland: { lat: 41.4993, lng: -81.6944, label: "Cleveland, OH" },
  detroit: { lat: 42.3314, lng: -83.0458, label: "Detroit, MI" },
  pittsburgh: { lat: 40.4406, lng: -79.9959, label: "Pittsburgh, PA" },
  cincinnati: { lat: 39.1031, lng: -84.512, label: "Cincinnati, OH" },
  "st-louis": { lat: 38.627, lng: -90.1994, label: "St. Louis, MO" },
  "new-orleans": { lat: 29.9511, lng: -90.0715, label: "New Orleans, LA" },
  richmond: { lat: 37.5407, lng: -77.436, label: "Richmond, VA" },
  raleigh: { lat: 35.7796, lng: -78.6382, label: "Raleigh, NC" },
  birmingham: { lat: 33.5186, lng: -86.8104, label: "Birmingham, AL" },
  "baton-rouge": { lat: 30.4515, lng: -91.1871, label: "Baton Rouge, LA" },
};

const CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const BINGBOT_UA = "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)";

async function fetchPageHtml(location) {
  const url = `https://www.facebook.com/marketplace/${location}/vehicles/`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": BINGBOT_UA,
      Accept: "text/html",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching page`);
  const html = await r.text();
  const lsd = html.match(/"LSD"[^}]{0,30}"token":"([^"]+)"/)?.[1] || null;
  return { html, lsd };
}

// Extract listings directly from SSR HTML (fallback when GraphQL is rate-limited)
function extractFromHtml(html) {
  const listings = [];
  const seen = new Set();
  const titleRegex = /"marketplace_listing_title":"([^"]+)"/g;
  let m;
  while ((m = titleRegex.exec(html)) !== null) {
    const title = m[1].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    const pos = m.index;
    const ctx = html.substring(Math.max(0, pos - 2000), Math.min(html.length, pos + 2000));
    const id = ctx.match(/"id":"(\d{10,})"/)?.[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const priceMatch = ctx.match(/"amount_with_offset_in_currency":"(\d+)"/);
    const offsetMatch = ctx.match(/"offset":(\d+)/);
    const offset = offsetMatch ? parseInt(offsetMatch[1]) : 100;
    const price = priceMatch ? parseInt(priceMatch[1]) / offset : null;
    const city = ctx.match(/"city":"([^"]+)"/)?.[1] || null;
    const state = ctx.match(/"state":"([^"]+)"/)?.[1] || null;
    const imageUri = ctx.match(/"uri":"(https:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/)?.[1] || null;
    listings.push({ id, marketplace_listing_title: title, listing_price: price ? { amount: String(price) } : null, location: { reverse_geocode: { city, state } }, primary_listing_photo: imageUri ? { image: { uri: imageUri } } : null });
  }
  return listings;
}

async function fetchPage(location, lat, lng, lsd, cursor = null) {
  const variables = {
    buyLocation: { latitude: lat, longitude: lng },
    categoryIDArray: [807311116002614],
    count: 24,
    cursor,
    marketplaceBrowseContext: "CATEGORY_FEED",
    numericVerticalFields: [],
    numericVerticalFieldsBetween: [],
    priceRange: [0, 214748364700],
    radius: 65000,
    scale: 2,
    stringVerticalFields: [],
    topicPageParams: { location_id: location, url: "vehicles" },
  };

  const body = new URLSearchParams({
    doc_id: "33269364996041474",
    variables: JSON.stringify(variables),
    lsd,
    __a: "1",
    __comet_req: "15",
    server_timestamps: "true",
  });

  const resp = await fetch("https://www.facebook.com/api/graphql/", {
    method: "POST",
    headers: {
      "User-Agent": CHROME_UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "*/*",
      Origin: "https://www.facebook.com",
      Referer: `https://www.facebook.com/marketplace/${location}/vehicles/`,
      "sec-fetch-site": "same-origin",
      "x-fb-lsd": lsd,
    },
    body: body.toString(),
  });

  if (!resp.ok) throw new Error(`GraphQL HTTP ${resp.status}`);
  const json = await resp.json();
  if (json?.errors) {
    throw new Error(json.errors[0]?.message || "GraphQL error");
  }

  const feed = json?.data?.viewer?.marketplace_feed_stories;
  return {
    edges: feed?.edges || [],
    nextCursor: feed?.page_info?.has_next_page ? feed?.page_info?.end_cursor : null,
  };
}

function parseYear(title) {
  const m = title?.match(/^(\d{4})\s/);
  return m ? parseInt(m[1]) : null;
}

const MAKES = [
  "Toyota", "Ford", "Chevrolet", "Chevy", "Honda", "Nissan", "BMW", "Mercedes-Benz",
  "Mercedes", "Audi", "Porsche", "Volkswagen", "VW", "Dodge", "Ram", "Jeep",
  "GMC", "Cadillac", "Lincoln", "Buick", "Pontiac", "Oldsmobile", "Plymouth",
  "Chrysler", "Mazda", "Subaru", "Lexus", "Acura", "Infiniti", "Hyundai", "Kia",
  "Volvo", "Jaguar", "Land Rover", "Mini", "AMC", "International", "Studebaker",
  "Datsun", "Triumph", "MG", "Austin-Healey", "Shelby", "Saab", "Peugeot",
];

function parseTitle(title) {
  if (!title) return { year: null, make: null, model: null };
  const year = parseYear(title);
  if (!year) return { year: null, make: null, model: null };
  const rest = title.replace(/^\d{4}\s+/, "").trim();
  const lower = rest.toLowerCase();
  for (const make of MAKES) {
    if (lower.startsWith(make.toLowerCase())) {
      const afterMake = rest.slice(make.length).trim();
      const model = afterMake.split(/[\s·•|]+/).slice(0, 3).join(" ").trim() || null;
      return { year, make: make === "Chevy" ? "Chevrolet" : make, model };
    }
  }
  const words = rest.split(/\s+/);
  return { year, make: words[0] || null, model: words.slice(1, 3).join(" ") || null };
}

async function scrapeLocation(slug, { lat, lng, label }, maxPages) {
  console.log(`\n[${label}] Starting scrape...`);

  let lsd = null;
  let firstPageHtml = null;
  try {
    const result = await fetchPageHtml(slug);
    lsd = result.lsd;
    firstPageHtml = result.html;
    console.log(`  lsd: ${lsd ? lsd.slice(0, 15) + "..." : "none"}`);
  } catch (e) {
    console.error(`  Failed to fetch page: ${e.message}`);
    return { found: 0, vintage: 0, inserted: 0, updated: 0, errors: 1 };
  }

  let cursor = null;
  let page = 0;
  let allListings = [];
  let stats = { found: 0, vintage: 0, inserted: 0, updated: 0, errors: 0 };
  let graphqlRateLimited = false;

  while (page < maxPages) {
    let rawListings = [];

    // Page 1: always try to use the HTML we already fetched as fallback
    if (page === 0 && (graphqlRateLimited || !lsd)) {
      rawListings = extractFromHtml(firstPageHtml);
      stats.found += rawListings.length;
      page++;
      console.log(`  Page 1 (HTML): ${rawListings.length} listings`);
    } else {
      try {
        const { edges, nextCursor } = await fetchPage(slug, lat, lng, lsd, cursor);
        page++;
        stats.found += edges.length;
        rawListings = edges.map((e) => e.node?.listing).filter(Boolean);
        console.log(`  Page ${page}: ${edges.length} listings`);
        cursor = nextCursor;
        if (!nextCursor) {
          // No more pages
          const vintage = rawListings.filter((l) => {
            const year = parseYear(l.marketplace_listing_title);
            return year && year >= YEAR_MIN && year <= YEAR_MAX;
          });
          allListings.push(...vintage);
          break;
        }
        await sleep(1500 + Math.random() * 1000);
      } catch (e) {
        if (e.message.includes("Rate limit")) {
          console.warn(`  GraphQL rate-limited — falling back to HTML for page 1`);
          graphqlRateLimited = true;
          stats.errors++;
          // Use HTML we already have for page 1 data
          rawListings = extractFromHtml(firstPageHtml);
          stats.found += rawListings.length;
          page++;
          console.log(`  Page 1 (HTML fallback): ${rawListings.length} listings`);
          // Can't paginate via HTML, stop after page 1
          const vintage = rawListings.filter((l) => {
            const year = parseYear(l.marketplace_listing_title);
            return year && year >= YEAR_MIN && year <= YEAR_MAX;
          });
          allListings.push(...vintage);
          break;
        } else {
          console.error(`  Page ${page + 1} error: ${e.message}`);
          stats.errors++;
          break;
        }
      }
    }

    const vintage = rawListings.filter((l) => {
      const year = parseYear(l.marketplace_listing_title);
      return year && year >= YEAR_MIN && year <= YEAR_MAX;
    });
    allListings.push(...vintage);

    if (graphqlRateLimited || !cursor) break;
  }

  stats.vintage = allListings.length;

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would upsert ${allListings.length} vintage listings`);
    allListings.slice(0, 5).forEach((l) =>
      console.log(`    - ${l.marketplace_listing_title} | $${l.listing_price?.amount}`)
    );
    return stats;
  }

  // Upsert to database
  for (const listing of allListings) {
    const { year, make, model } = parseTitle(listing.marketplace_listing_title);
    const price = listing.listing_price?.amount
      ? parseFloat(listing.listing_price.amount)
      : null;
    const imageUrl = listing.primary_listing_photo?.image?.uri || null;
    const city = listing.location?.reverse_geocode?.city || null;
    const state = listing.location?.reverse_geocode?.state || null;

    const { data: existing } = await supabase
      .from("marketplace_listings")
      .select("id, price, current_price")
      .eq("facebook_id", listing.id)
      .maybeSingle();

    if (!existing) {
      const { error } = await supabase.from("marketplace_listings").insert({
        facebook_id: listing.id,
        platform: "facebook_marketplace",
        url: `https://www.facebook.com/marketplace/item/${listing.id}`,
        title: listing.marketplace_listing_title,
        price: price ? Math.round(price) : null,
        current_price: price,
        image_url: imageUrl,
        location: city && state ? `${city}, ${state}` : city || null,
        parsed_year: year,
        parsed_make: make?.toLowerCase() || null,
        parsed_model: model?.toLowerCase() || null,
        status: "active",
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        scraped_at: new Date().toISOString(),
        search_query: `vintage-vehicles-${slug}`,
      });
      if (!error) stats.inserted++;
      else console.error(`    Insert error: ${error.message}`);
    } else {
      const updates = { last_seen_at: new Date().toISOString(), status: "active" };
      if (price && existing.current_price !== price) {
        updates.current_price = price;
        stats.updated++;
      }
      await supabase.from("marketplace_listings").update(updates).eq("id", existing.id);
    }
  }

  console.log(`  Done: ${stats.vintage} vintage → ${stats.inserted} new, ${stats.updated} updated`);
  return stats;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  let locationsToScrape;

  if (SINGLE_LOCATION) {
    const meta = METRO_AREAS[SINGLE_LOCATION];
    if (!meta) {
      console.error(`Unknown location: ${SINGLE_LOCATION}`);
      console.error("Available:", Object.keys(METRO_AREAS).join(", "));
      process.exit(1);
    }
    locationsToScrape = [[SINGLE_LOCATION, meta]];
  } else if (ALL) {
    locationsToScrape = Object.entries(METRO_AREAS);
  } else {
    // Default: just Austin for testing
    locationsToScrape = [["austin", METRO_AREAS.austin]];
  }

  console.log(`FB Marketplace Local Scraper`);
  console.log(`Locations: ${locationsToScrape.length}`);
  console.log(`Year range: ${YEAR_MIN}-${YEAR_MAX}`);
  console.log(`Max pages per location: ${MAX_PAGES}`);
  console.log(`Dry run: ${DRY_RUN}`);

  let totals = { found: 0, vintage: 0, inserted: 0, updated: 0, errors: 0 };

  for (const [slug, meta] of locationsToScrape) {
    const stats = await scrapeLocation(slug, meta, MAX_PAGES);
    totals.found += stats.found;
    totals.vintage += stats.vintage;
    totals.inserted += stats.inserted;
    totals.updated += stats.updated;
    totals.errors += stats.errors;

    if (locationsToScrape.length > 1) {
      await sleep(6000 + Math.random() * 4000);
    }
  }

  console.log(`\n=== TOTALS ===`);
  console.log(`Locations processed: ${locationsToScrape.length}`);
  console.log(`Total listings scanned: ${totals.found}`);
  console.log(`Vintage (${YEAR_MIN}-${YEAR_MAX}): ${totals.vintage}`);
  console.log(`New insertions: ${totals.inserted}`);
  console.log(`Price updates: ${totals.updated}`);
  console.log(`Errors: ${totals.errors}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
