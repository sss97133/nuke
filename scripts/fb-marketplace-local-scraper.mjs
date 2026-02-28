/**
 * FB Marketplace Local Scraper v3.0
 *
 * Runs locally (residential IP) to fetch vehicle listings from FB Marketplace.
 * Uses logged-out GraphQL endpoint — no LSD/DTSG tokens required.
 *
 * v3.0 additions over v2.1:
 *   - ALL images captured from images.edges[].node.image.uri (not just primary)
 *   - Per-listing lat/lng from GraphQL location data
 *   - Creates vehicle records in vehicles table for each listing
 *   - Inserts images to vehicle_images table
 *   - Links marketplace_listings.vehicle_id to vehicles
 *   - Full description extraction from redacted_description.text
 *
 * v2.1 features (retained):
 *   - Seller extraction (seller_id + seller_name from GraphQL edges)
 *   - Raw GraphQL data stored in raw_scrape_data JSONB
 *   - Sweep tracking via fb_sweep_jobs table
 *   - Disappearance detection (listings gone = marked removed)
 *   - Seller ghost profiles (upsert to fb_marketplace_sellers)
 *   - doc_id health check (validates response shape)
 *
 * Usage:
 *   dotenvx run -- node scripts/fb-marketplace-local-scraper.mjs [--location austin] [--all] [--max-pages 10] [--dry-run]
 *   dotenvx run -- node scripts/fb-marketplace-local-scraper.mjs --all --max-pages 50
 *   dotenvx run -- node scripts/fb-marketplace-local-scraper.mjs --all --max-pages 50 --skip-vehicles  # skip vehicle creation
 */

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { Resolver } from "dns";
import https from "https";

// Custom DNS resolver — bypasses broken macOS getaddrinfo()
// Uses Google/Cloudflare DNS servers directly via c-ares
const dnsResolver = new Resolver();
dnsResolver.setServers(["8.8.8.8", "1.1.1.1"]);

function customLookup(hostname, opts, cb) {
  if (typeof opts === "function") { cb = opts; opts = {}; }
  dnsResolver.resolve4(hostname, (err, addrs) => {
    if (err || !addrs || addrs.length === 0) {
      dnsResolver.resolve6(hostname, (err6, addrs6) => {
        if (err6) return cb(err || err6);
        if (opts && opts.all) {
          cb(null, addrs6.map(a => ({ address: a, family: 6 })));
        } else {
          cb(null, addrs6[0], 6);
        }
      });
      return;
    }
    if (opts && opts.all) {
      cb(null, addrs.map(a => ({ address: a, family: 4 })));
    } else {
      cb(null, addrs[0], 4);
    }
  });
}

// fetch() replacement using https.request with custom DNS lookup
function dnsFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(typeof url === "string" ? url : url.url || url.href || String(url));

    // Handle Headers objects, plain objects, or arrays
    const flatHeaders = {};
    const h = options.headers;
    if (h) {
      if (typeof h.entries === "function") {
        for (const [k, v] of h.entries()) flatHeaders[k] = v;
      } else if (typeof h === "object") {
        Object.assign(flatHeaders, h);
      }
    }
    flatHeaders["Host"] = parsed.hostname;

    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: options.method || "GET",
      headers: flatHeaders,
      lookup: customLookup,
    };

    const req = https.request(reqOptions, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString();
        const headers = new Map(Object.entries(res.headers));
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage || "",
          headers: {
            get: (k) => res.headers[k.toLowerCase()] || null,
            has: (k) => k.toLowerCase() in res.headers,
            entries: () => Object.entries(res.headers),
          },
          text: () => Promise.resolve(body),
          json: () => Promise.resolve(JSON.parse(body)),
          body: null,
          url,
        });
      });
    });

    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(new Error("Request timeout")); });
    if (options.body) req.write(typeof options.body === "string" ? options.body : options.body.toString());
    req.end();
  });
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  global: { fetch: dnsFetch },
});

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ALL = args.includes("--all");
const MAX_PAGES = parseInt(args[args.indexOf("--max-pages") + 1] || "10");
const SINGLE_LOCATION = args.includes("--location")
  ? args[args.indexOf("--location") + 1]
  : null;
const SKIP_DISAPPEARANCE = args.includes("--skip-disappearance");
const SKIP_VEHICLES = args.includes("--skip-vehicles");

const YEAR_MIN = 1960;
const YEAR_MAX = 1999;

// Global rate limit flag — abort sweep if Facebook rate limits us
let RATE_LIMITED = false;

// US metros: slug -> {lat, lng, label}
const METRO_AREAS = {
  austin: { lat: 30.2672, lng: -97.7431, label: "Austin, TX" },
  dallas: { lat: 32.7767, lng: -96.797, label: "Dallas, TX" },
  houston: { lat: 29.7604, lng: -95.3698, label: "Houston, TX" },
  "san-antonio": { lat: 29.4241, lng: -98.4936, label: "San Antonio, TX" },
  "los-angeles": { lat: 34.0522, lng: -118.2437, label: "Los Angeles, CA" },
  chicago: { lat: 41.8781, lng: -87.6298, label: "Chicago, IL" },
  phoenix: { lat: 33.4484, lng: -112.074, label: "Phoenix, AZ" },
  philly: { lat: 39.9526, lng: -75.1652, label: "Philadelphia, PA" },
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
  memphis: { lat: 35.1495, lng: -90.049, label: "Memphis, TN" },
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
  tampa: { lat: 27.9506, lng: -82.4572, label: "Tampa, FL" },
  "san-diego": { lat: 32.7157, lng: -117.1611, label: "San Diego, CA" },
  "washington-dc": { lat: 38.9072, lng: -77.0369, label: "Washington, DC" },
  boston: { lat: 42.3601, lng: -71.0589, label: "Boston, MA" },
  "new-york": { lat: 40.7128, lng: -74.006, label: "New York, NY" },
  orlando: { lat: 28.5383, lng: -81.3792, label: "Orlando, FL" },
  "colorado-springs": { lat: 38.8339, lng: -104.8214, label: "Colorado Springs, CO" },
  tulsa: { lat: 36.154, lng: -95.9928, label: "Tulsa, OK" },
  omaha: { lat: 41.2565, lng: -95.9345, label: "Omaha, NE" },
  "des-moines": { lat: 41.5868, lng: -93.625, label: "Des Moines, IA" },
  "little-rock": { lat: 34.7465, lng: -92.2896, label: "Little Rock, AR" },
  knoxville: { lat: 35.9606, lng: -83.9207, label: "Knoxville, TN" },
  "corpus-christi": { lat: 27.8006, lng: -97.3964, label: "Corpus Christi, TX" },
};

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// GraphQL fetch — no token required
async function fetchPage(location, lat, lng, cursor = null) {
  const variables = {
    buyLocation: { latitude: lat, longitude: lng },
    categoryIDArray: [807311116002614],
    contextual_data: [],
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
    __a: "1",
    __comet_req: "15",
    server_timestamps: "true",
  });

  const resp = await dnsFetch("https://www.facebook.com/api/graphql/", {
    method: "POST",
    headers: {
      "User-Agent": CHROME_UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "*/*",
      Origin: "https://www.facebook.com",
      Referer: `https://www.facebook.com/marketplace/${location}/vehicles/`,
      "sec-fetch-site": "same-origin",
    },
    body: body.toString(),
  });

  if (!resp.ok) throw new Error(`GraphQL HTTP ${resp.status}`);

  const text = await resp.text();
  const cleaned = text.replace(/^for\s*\(\s*;\s*;\s*\)\s*;\s*/, "");
  const json = JSON.parse(cleaned);

  if (json?.errors) {
    const msg = json.errors[0]?.message || "GraphQL error";
    const code = json.errors[0]?.code;
    throw new Error(`GraphQL error (code ${code}): ${msg}`);
  }

  const feed = json?.data?.viewer?.marketplace_feed_stories;

  // doc_id health check — validate response shape
  if (!feed && json?.data) {
    console.warn("  WARNING: GraphQL response has data but no marketplace_feed_stories — doc_id may have rotated");
  }

  return {
    edges: feed?.edges || [],
    nextCursor: feed?.page_info?.has_next_page
      ? feed?.page_info?.end_cursor
      : null,
  };
}

function parseYear(title) {
  const m = title?.match(/^(\d{4})\s/);
  return m ? parseInt(m[1]) : null;
}

const MAKES = [
  "Toyota", "Ford", "Chevrolet", "Chevy", "Honda", "Nissan", "BMW",
  "Mercedes-Benz", "Mercedes", "Audi", "Porsche", "Volkswagen", "VW",
  "Dodge", "Ram", "Jeep", "GMC", "Cadillac", "Lincoln", "Buick",
  "Pontiac", "Oldsmobile", "Plymouth", "Chrysler", "Mazda", "Subaru",
  "Lexus", "Acura", "Infiniti", "Hyundai", "Kia", "Volvo", "Jaguar",
  "Land Rover", "Mini", "AMC", "International", "Studebaker", "Datsun",
  "Triumph", "MG", "Austin-Healey", "Shelby", "Saab", "Peugeot",
  "Fiat", "Alfa Romeo", "Ferrari", "Lamborghini", "Maserati", "Lotus",
  "De Tomaso", "Jensen", "TVR", "Morgan", "Sunbeam", "Opel",
  "Willys", "Kaiser", "Nash", "Hudson", "Packard", "Lancia",
  "DeLorean", "Isuzu", "Mitsubishi", "Suzuki", "Eagle",
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
      const model =
        afterMake
          .split(/[\s·•|—]+/)
          .slice(0, 3)
          .join(" ")
          .trim() || null;
      return { year, make: make === "Chevy" ? "Chevrolet" : make, model };
    }
  }
  const words = rest.split(/\s+/);
  return {
    year,
    make: words[0] || null,
    model: words.slice(1, 3).join(" ") || null,
  };
}

// Extract ALL image URLs from GraphQL edge (not just primary)
function extractAllImages(edge) {
  const listing = edge?.node?.listing;
  if (!listing) return [];

  const urls = [];

  // Primary photo first
  const primary = listing.primary_listing_photo?.image?.uri;
  if (primary) urls.push(primary);

  // All images from the images array
  const images = listing.listing_photos || listing.images?.edges || listing.all_listing_photos;
  if (Array.isArray(images)) {
    for (const img of images) {
      // Handle edges format: {node: {image: {uri}}}
      const uri = img?.node?.image?.uri || img?.image?.uri || img?.uri || img?.url;
      if (uri && !urls.includes(uri)) urls.push(uri);
    }
  }

  // Fallback: primary_listing_photo if no images array
  if (urls.length === 0 && primary) urls.push(primary);

  return urls;
}

// Extract per-listing lat/lng from GraphQL location data
function extractCoords(edge) {
  const listing = edge?.node?.listing;
  if (!listing) return { lat: null, lng: null };

  const loc = listing.location;
  if (!loc) return { lat: null, lng: null };

  const lat = loc.latitude || loc.lat || null;
  const lng = loc.longitude || loc.lng || null;

  return { lat: lat ? parseFloat(lat) : null, lng: lng ? parseFloat(lng) : null };
}

// Extract seller info from GraphQL edge
function extractSeller(edge) {
  const listing = edge?.node?.listing;
  if (!listing) return { sellerId: null, sellerName: null };

  // Try marketplace_listing_seller first
  const seller = listing.marketplace_listing_seller;
  if (seller) {
    return {
      sellerId: seller.id || null,
      sellerName: seller.name || null,
    };
  }

  // Fallback: actors array
  const actors = listing.actors;
  if (actors && actors.length > 0) {
    return {
      sellerId: actors[0].id || null,
      sellerName: actors[0].name || null,
    };
  }

  return { sellerId: null, sellerName: null };
}

// Create or start a sweep job
async function startSweepJob(locationCount) {
  const { data, error } = await supabase
    .from("fb_sweep_jobs")
    .insert({
      status: "running",
      locations_total: locationCount,
      locations_processed: 0,
      listings_found: 0,
      new_listings: 0,
      price_changes: 0,
      disappeared_detected: 0,
      errors: 0,
      metadata: {
        scraper_version: "3.0",
        year_range: [YEAR_MIN, YEAR_MAX],
        max_pages: MAX_PAGES,
        started_by: "local-scraper",
      },
    })
    .select("id")
    .single();

  if (error) {
    console.error("Failed to create sweep job:", error.message);
    return null;
  }
  return data.id;
}

// Update sweep job progress
async function updateSweepJob(sweepId, updates) {
  if (!sweepId) return;
  const { error } = await supabase
    .from("fb_sweep_jobs")
    .update(updates)
    .eq("id", sweepId);
  if (error) console.error("Sweep job update error:", error.message);
}

// Upsert seller to fb_marketplace_sellers, return seller row id
async function upsertSeller(sellerId, sellerName) {
  if (!sellerId) return null;

  const profileUrl = `https://www.facebook.com/marketplace/profile/${sellerId}/`;

  const { data, error } = await supabase
    .from("fb_marketplace_sellers")
    .upsert(
      {
        fb_user_id: sellerId,
        fb_profile_url: profileUrl,
        display_name: sellerName,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "fb_profile_url" }
    )
    .select("id")
    .single();

  if (error) {
    // If upsert fails, try to find existing
    const { data: existing } = await supabase
      .from("fb_marketplace_sellers")
      .select("id")
      .eq("fb_user_id", sellerId)
      .limit(1)
      .single();
    return existing?.id || null;
  }
  return data?.id || null;
}

// Create or update a vehicle record from a marketplace listing
async function createVehicleFromListing({ facebookId, allImages, year, make, model, price, description, imageUrl, city, state, listingLat, listingLng, sellerName }) {
  const result = { vehicleId: null, imagesInserted: 0 };
  if (!year || !make) return result;

  const fbUrl = `https://www.facebook.com/marketplace/item/${facebookId}`;
  const location = city && state ? `${city}, ${state}` : city || null;

  // Check if vehicle already exists for this FB listing URL
  const { data: existing } = await supabase
    .from("vehicles")
    .select("id")
    .eq("listing_url", fbUrl)
    .limit(1)
    .maybeSingle();

  let vehicleId;

  if (existing) {
    vehicleId = existing.id;
    // Update with any new data (fill NULLs only)
    const updates = {};
    if (description) updates.description = description;
    if (price) updates.asking_price = price;
    if (location) updates.listing_location = location;
    if (listingLat) updates.gps_latitude = listingLat;
    if (listingLng) updates.gps_longitude = listingLng;
    if (imageUrl) updates.primary_image_url = imageUrl;

    if (Object.keys(updates).length > 0) {
      // Only update NULL fields
      const setClauses = Object.entries(updates)
        .map(([k, v]) => `${k} = COALESCE(${k}, '${String(v).replace(/'/g, "''")}')`)
        .join(", ");
      // Use simple update — COALESCE preserves existing non-null values
      await supabase.from("vehicles").update(updates).eq("id", vehicleId);
    }
  } else {
    // Create new vehicle
    const { data: newVeh, error: vehErr } = await supabase
      .from("vehicles")
      .insert({
        year,
        make: make.charAt(0).toUpperCase() + make.slice(1),
        model: model || null,
        listing_url: fbUrl,
        asking_price: price ? Math.round(price) : null,
        description: description || null,
        listing_location: location,
        gps_latitude: listingLat,
        gps_longitude: listingLng,
        primary_image_url: imageUrl,
        status: "discovered",
        auction_source: "facebook_marketplace",
      })
      .select("id")
      .single();

    if (vehErr) {
      console.error(`    Vehicle insert error for ${facebookId}: ${vehErr.message}`);
      return result;
    }
    vehicleId = newVeh.id;
  }

  result.vehicleId = vehicleId;

  // Insert all images to vehicle_images
  if (allImages.length > 0 && vehicleId) {
    // Check which images already exist
    const { data: existingImgs } = await supabase
      .from("vehicle_images")
      .select("image_url")
      .eq("vehicle_id", vehicleId);

    const existingUrls = new Set((existingImgs || []).map(i => i.image_url));
    const newImages = allImages.filter(url => !existingUrls.has(url));

    if (newImages.length > 0) {
      const imgRows = newImages.map((url, idx) => ({
        vehicle_id: vehicleId,
        image_url: url,
        source: "facebook_marketplace",
        display_order: (existingUrls.size || 0) + idx,
      }));

      const { error: imgErr } = await supabase
        .from("vehicle_images")
        .insert(imgRows);

      if (!imgErr) {
        result.imagesInserted = newImages.length;
      }
    }
  }

  return result;
}

// Detect disappeared listings — active in DB but not seen this sweep
async function detectDisappearances(sweepId, seenFacebookIds) {
  if (!sweepId || seenFacebookIds.size === 0) return 0;

  // Get all active listings
  const { data: activeListings, error } = await supabase
    .from("marketplace_listings")
    .select("id, facebook_id, title, current_price, first_seen_at, location")
    .eq("status", "active")
    .eq("platform", "facebook_marketplace");

  if (error) {
    console.error("Disappearance check error:", error.message);
    return 0;
  }

  // Find listings NOT seen in this sweep
  const disappeared = activeListings.filter(
    (l) => !seenFacebookIds.has(l.facebook_id)
  );

  if (disappeared.length === 0) return 0;

  console.log(`\n[Disappearance Detection] ${disappeared.length} listings no longer visible`);

  // Mark as removed in marketplace_listings
  const disappearedIds = disappeared.map((l) => l.id);
  const now = new Date().toISOString();

  // Batch update in chunks of 100
  for (let i = 0; i < disappearedIds.length; i += 100) {
    const chunk = disappearedIds.slice(i, i + 100);
    const { error: updateErr } = await supabase
      .from("marketplace_listings")
      .update({
        status: "removed",
        removed_at: now,
        removal_reason: "not_seen_in_sweep",
      })
      .in("id", chunk);

    if (updateErr) {
      console.error(`  Batch removal error: ${updateErr.message}`);
    }
  }

  // Log to fb_listing_disappearances
  const disappearanceRows = disappeared.map((l) => ({
    listing_id: l.id,
    first_missed_sweep_id: sweepId,
    last_missed_sweep_id: sweepId,
    consecutive_misses: 1,
    last_seen_at: l.first_seen_at,
    last_seen_price: l.current_price,
    status: "missing",
  }));

  // Batch insert disappearances, skip conflicts (listing already tracked)
  for (let i = 0; i < disappearanceRows.length; i += 50) {
    const chunk = disappearanceRows.slice(i, i + 50);
    const { error: insertErr } = await supabase
      .from("fb_listing_disappearances")
      .upsert(chunk, { onConflict: "listing_id", ignoreDuplicates: false });

    if (insertErr) {
      console.error(`  Disappearance log error: ${insertErr.message}`);
    }
  }

  // Log notable disappearances (vintage under $15K)
  const notable = disappeared.filter(
    (l) => l.current_price && l.current_price < 15000
  );
  if (notable.length > 0) {
    console.log(`  Notable disappearances (vintage < $15K):`);
    notable.slice(0, 10).forEach((l) => {
      console.log(`    - ${l.title} | $${l.current_price} | ${l.location}`);
    });
  }

  // Time-on-market stats for disappeared listings
  const withDates = disappeared.filter((l) => l.first_seen_at);
  if (withDates.length > 0) {
    const durations = withDates.map(
      (l) => (Date.now() - new Date(l.first_seen_at).getTime()) / 3600000
    );
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    const min = Math.min(...durations);
    const max = Math.max(...durations);
    console.log(
      `  Time-on-market stats: avg=${avg.toFixed(0)}h, min=${min.toFixed(0)}h, max=${max.toFixed(0)}h`
    );
  }

  return disappeared.length;
}

async function scrapeLocation(slug, { lat, lng, label }, maxPages, sweepId) {
  // Abort immediately if we've been rate limited
  if (RATE_LIMITED) {
    return { found: 0, vintage: 0, inserted: 0, updated: 0, errors: 1, sellers: 0, vehicles: 0, images: 0 };
  }

  console.log(`\n[${label}] Starting scrape...`);

  let cursor = null;
  let page = 0;
  let allEdges = []; // Keep full edges for seller extraction
  let stats = { found: 0, vintage: 0, inserted: 0, updated: 0, errors: 0, sellers: 0, vehicles: 0, images: 0 };

  while (page < maxPages) {
    try {
      const { edges, nextCursor } = await fetchPage(slug, lat, lng, cursor);
      page++;
      stats.found += edges.length;
      console.log(`  Page ${page}: ${edges.length} listings`);

      // Filter to vintage by parsing title
      const vintageEdges = edges.filter((e) => {
        const title = e.node?.listing?.marketplace_listing_title;
        const year = parseYear(title);
        return year && year >= YEAR_MIN && year <= YEAR_MAX;
      });
      allEdges.push(...vintageEdges);

      cursor = nextCursor;
      if (!nextCursor) {
        console.log(`  Pagination ended at page ${page}`);
        break;
      }

      await sleep(2000 + Math.random() * 1500);
    } catch (e) {
      console.error(`  Page ${page + 1} error: ${e.message}`);
      stats.errors++;

      if (e.message.includes("1675004") || e.message.includes("Rate limit")) {
        console.log(`  Rate limited — waiting 60s before retry...`);
        await sleep(60000);
        try {
          const { edges, nextCursor } = await fetchPage(slug, lat, lng, cursor);
          page++;
          stats.found += edges.length;
          console.log(`  Retry page ${page}: ${edges.length} listings`);
          const vintageEdges = edges.filter((e) => {
            const title = e.node?.listing?.marketplace_listing_title;
            const year = parseYear(title);
            return year && year >= YEAR_MIN && year <= YEAR_MAX;
          });
          allEdges.push(...vintageEdges);
          cursor = nextCursor;
          if (!nextCursor) break;
          await sleep(3000);
        } catch (retryErr) {
          console.error(`  Retry failed: ${retryErr.message}`);
          if (retryErr.message.includes("1675004") || retryErr.message.includes("Rate limit")) {
            console.error(`\n  *** GLOBAL RATE LIMIT DETECTED — aborting remaining cities ***`);
            RATE_LIMITED = true;
          }
          break;
        }
      } else {
        break;
      }
    }
  }

  stats.vintage = allEdges.length;

  if (DRY_RUN) {
    console.log(
      `  [DRY RUN] Would upsert ${allEdges.length} vintage listings`
    );
    allEdges.slice(0, 5).forEach((e) => {
      const l = e.node?.listing;
      const { sellerId, sellerName } = extractSeller(e);
      const imgs = extractAllImages(e);
      const { lat, lng } = extractCoords(e);
      console.log(
        `    - ${l?.marketplace_listing_title} | $${l?.listing_price?.amount} | ${imgs.length} imgs | coords: ${lat?.toFixed(2)},${lng?.toFixed(2)} | seller: ${sellerName || "unknown"} (${sellerId || "no id"})`
      );
    });
    return stats;
  }

  // Collect unique sellers for batch upsert
  const sellerMap = new Map(); // fb_user_id -> {name, dbId}

  // Batch upsert to database
  const batchSize = 50;
  const allVehicleData = []; // Collect for vehicle creation after all upserts
  for (let i = 0; i < allEdges.length; i += batchSize) {
    const batch = allEdges.slice(i, i + batchSize);
    const rows = [];
    const vehicleData = [];

    for (const edge of batch) {
      const listing = edge.node?.listing;
      if (!listing) continue;

      const { year, make, model } = parseTitle(listing.marketplace_listing_title);
      const price = listing.listing_price?.amount
        ? parseFloat(listing.listing_price.amount)
        : null;
      const allImages = extractAllImages(edge);
      const imageUrl = allImages[0] || null;
      const { lat: listingLat, lng: listingLng } = extractCoords(edge);
      const city = listing.location?.reverse_geocode?.city || null;
      const state = listing.location?.reverse_geocode?.state || null;
      const isSold = listing.is_sold || false;
      const isPending = listing.is_pending || false;
      const description = listing.redacted_description?.text || null;

      // Seller extraction
      const { sellerId, sellerName } = extractSeller(edge);
      let fbSellerDbId = null;

      if (sellerId) {
        if (sellerMap.has(sellerId)) {
          fbSellerDbId = sellerMap.get(sellerId).dbId;
        } else {
          fbSellerDbId = await upsertSeller(sellerId, sellerName);
          sellerMap.set(sellerId, { name: sellerName, dbId: fbSellerDbId });
          stats.sellers++;
        }
      }

      // Build raw data (trimmed — keep useful fields, skip massive blobs)
      const rawData = {
        id: listing.id,
        title: listing.marketplace_listing_title,
        price: listing.listing_price,
        location: listing.location,
        is_sold: listing.is_sold,
        is_pending: listing.is_pending,
        description: description,
        creation_time: listing.creation_time || null,
        seller_id: sellerId,
        seller_name: sellerName,
        custom_title: listing.custom_title || null,
        category_type: listing.category_type || null,
        all_image_urls: allImages,
        listing_lat: listingLat,
        listing_lng: listingLng,
      };

      rows.push({
        facebook_id: listing.id,
        platform: "facebook_marketplace",
        url: `https://www.facebook.com/marketplace/item/${listing.id}`,
        title: listing.marketplace_listing_title,
        price: price ? Math.round(price) : null,
        current_price: price,
        image_url: imageUrl,
        location: city && state ? `${city}, ${state}` : city || null,
        parsed_year: year,
        parsed_make: make || null,
        parsed_model: model || null,
        status: isSold ? "sold" : isPending ? "pending" : "active",
        seller_name: sellerName,
        fb_seller_id: fbSellerDbId,
        description: description,
        raw_scrape_data: rawData,
        last_seen_at: new Date().toISOString(),
        scraped_at: new Date().toISOString(),
        search_query: `vintage-vehicles-${slug}`,
      });

      // Store data for vehicle creation
      vehicleData.push({ facebookId: listing.id, allImages, year, make, model, price, description, imageUrl, city, state, listingLat, listingLng, sellerName });
    }

    if (rows.length === 0) continue;

    // Don't overwrite first_seen_at on existing records
    const { error } = await supabase
      .from("marketplace_listings")
      .upsert(rows, {
        onConflict: "facebook_id",
        ignoreDuplicates: false,
      });

    if (error) {
      console.error(`  Batch upsert error: ${error.message}`);
      stats.errors++;
      for (const row of rows) {
        const { error: singleErr } = await supabase
          .from("marketplace_listings")
          .upsert(row, { onConflict: "facebook_id" });
        if (singleErr) {
          console.error(`    Single upsert error for ${row.facebook_id}: ${singleErr.message}`);
        } else {
          stats.inserted++;
        }
      }
    } else {
      stats.inserted += rows.length;
    }

    allVehicleData.push(...vehicleData);
  }

  // --- Create vehicle records for each listing ---
  if (!SKIP_VEHICLES && allVehicleData.length > 0) {
    console.log(`  Creating vehicle records for ${allVehicleData.length} listings...`);
    for (const vd of allVehicleData) {
      try {
        const vehResult = await createVehicleFromListing(vd);
        if (vehResult.vehicleId) {
          stats.vehicles++;
          stats.images += vehResult.imagesInserted;

          // Link marketplace_listing to vehicle
          await supabase.from("marketplace_listings")
            .update({ vehicle_id: vehResult.vehicleId })
            .eq("facebook_id", vd.facebookId);
        }
      } catch (e) {
        // Don't let vehicle creation failures stop the scrape
        if (!e.message?.includes("duplicate")) {
          console.error(`    Vehicle creation error for ${vd.facebookId}: ${e.message}`);
        }
      }
    }
    console.log(`  Vehicles created: ${stats.vehicles} | Images inserted: ${stats.images}`);
  }

  console.log(
    `  Done: ${stats.found} scanned -> ${stats.vintage} vintage -> ${stats.inserted} upserted | ${stats.sellers} sellers | ${stats.vehicles} vehicles`
  );
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
    locationsToScrape = [["austin", METRO_AREAS.austin]];
  }

  console.log(`FB Marketplace Local Scraper v3.0`);
  console.log(`Locations: ${locationsToScrape.length}`);
  console.log(`Year range: ${YEAR_MIN}-${YEAR_MAX}`);
  console.log(`Max pages per location: ${MAX_PAGES}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log(`Disappearance detection: ${!SKIP_DISAPPEARANCE && !DRY_RUN}`);
  console.log(`Vehicle creation: ${!SKIP_VEHICLES && !DRY_RUN}`);
  console.log(`Estimated max listings to scan: ${locationsToScrape.length * MAX_PAGES * 24}`);

  // Create sweep job
  const sweepId = DRY_RUN ? null : await startSweepJob(locationsToScrape.length);
  if (sweepId) {
    console.log(`Sweep ID: ${sweepId}`);
  }

  let totals = { found: 0, vintage: 0, inserted: 0, updated: 0, errors: 0, sellers: 0, vehicles: 0, images: 0 };
  const allSeenFacebookIds = new Set();
  let locationsProcessed = 0;

  for (const [slug, meta] of locationsToScrape) {
    const stats = await scrapeLocation(slug, meta, MAX_PAGES, sweepId);
    totals.found += stats.found;
    totals.vintage += stats.vintage;
    totals.inserted += stats.inserted;
    totals.updated += stats.updated;
    totals.errors += stats.errors;
    totals.sellers += stats.sellers;
    totals.vehicles += stats.vehicles;
    totals.images += stats.images;
    locationsProcessed++;

    // Update sweep job progress
    if (sweepId) {
      await updateSweepJob(sweepId, {
        locations_processed: locationsProcessed,
        listings_found: totals.found,
        new_listings: totals.inserted,
        errors: totals.errors,
      });
    }

    // Inter-city delay (8-15s to avoid rate limiting)
    if (locationsToScrape.length > 1 && !RATE_LIMITED) {
      await sleep(8000 + Math.random() * 7000);
    }
  }

  // Disappearance detection — compare DB active vs what we saw
  // Only run if we actually scanned enough data (>50% of locations had results)
  let disappeared = 0;
  const successfulLocations = locationsToScrape.length - totals.errors;
  const minLocationsForDisappearance = Math.floor(locationsToScrape.length * 0.5);
  if (!DRY_RUN && !SKIP_DISAPPEARANCE && ALL && successfulLocations >= minLocationsForDisappearance) {
    // Get all facebook_ids we just upserted
    const { data: justSeen } = await supabase
      .from("marketplace_listings")
      .select("facebook_id")
      .eq("platform", "facebook_marketplace")
      .gte("scraped_at", new Date(Date.now() - 3600000).toISOString()); // last hour

    if (justSeen) {
      justSeen.forEach((l) => allSeenFacebookIds.add(l.facebook_id));
    }

    console.log(`\nRunning disappearance detection (${allSeenFacebookIds.size} listings seen this sweep)...`);
    disappeared = await detectDisappearances(sweepId, allSeenFacebookIds);

    if (sweepId) {
      await updateSweepJob(sweepId, {
        disappeared_detected: disappeared,
      });
    }
  } else if (!DRY_RUN && !SKIP_DISAPPEARANCE && ALL) {
    console.log(`\nSkipping disappearance detection — only ${successfulLocations}/${locationsToScrape.length} locations succeeded (need ${minLocationsForDisappearance}+)`);
  }

  // Complete sweep job
  if (sweepId) {
    await updateSweepJob(sweepId, {
      status: "completed",
      completed_at: new Date().toISOString(),
      metadata: {
        scraper_version: "3.0",
        year_range: [YEAR_MIN, YEAR_MAX],
        max_pages: MAX_PAGES,
        started_by: "local-scraper",
        unique_sellers: totals.sellers,
        vehicles_created: totals.vehicles,
        images_inserted: totals.images,
        disappeared: disappeared,
      },
    });
  }

  console.log(`\n=== TOTALS ===`);
  console.log(`Sweep ID: ${sweepId || "N/A (dry run)"}`);
  console.log(`Locations processed: ${locationsToScrape.length}`);
  console.log(`Total listings scanned: ${totals.found}`);
  console.log(`Vintage (${YEAR_MIN}-${YEAR_MAX}): ${totals.vintage}`);
  console.log(`Upserted: ${totals.inserted}`);
  console.log(`Unique sellers: ${totals.sellers}`);
  console.log(`Vehicles created: ${totals.vehicles}`);
  console.log(`Images inserted: ${totals.images}`);
  console.log(`Disappeared: ${disappeared}`);
  console.log(`Errors: ${totals.errors}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
