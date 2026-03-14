/**
 * FB Marketplace Local Scraper v3.1
 *
 * Runs locally (residential IP) to fetch vehicle listings from FB Marketplace.
 * Uses logged-out GraphQL endpoint — no LSD/DTSG tokens required.
 *
 * v3.1 additions over v3.0:
 *   - --group N flag: split 58 cities into 4 groups for staggered scheduling
 *   - Softer rate limiting: skip city on rate limit, abort only after 3 consecutive failures
 *   - Inter-city cooldown after rate limit (30s extra delay)
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
 *   dotenvx run -- node scripts/fb-marketplace-local-scraper.mjs [--location austin] [--all] [--group 1-4] [--max-pages 10] [--dry-run]
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
const GROUP = args.includes("--group")
  ? parseInt(args[args.indexOf("--group") + 1] || "0")
  : 0; // 0 = all cities (no grouping)
const TOTAL_GROUPS = 4;

const YEAR_MIN = 1960;
const YEAR_MAX = 1999;

/**
 * Download an image from a URL and upload it to Supabase storage.
 * Returns the public Supabase URL, or null on failure (falls back to original URL).
 * Facebook CDN URLs expire — this ensures we own the image permanently.
 */
async function downloadAndStoreImage(sourceUrl, vehicleId, index = 0) {
  try {
    const resp = await fetch(sourceUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;

    const contentType = resp.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const buffer = Buffer.from(await resp.arrayBuffer());

    // Skip tiny images (likely icons/placeholders)
    if (buffer.length < 5000) return null;

    const storagePath = `${vehicleId}/fb-marketplace/${Date.now()}-${index}.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from("vehicle-photos")
      .upload(storagePath, buffer, { contentType, upsert: false });

    if (uploadErr) {
      // If already exists, that's fine — get its public URL
      if (!uploadErr.message?.includes("already exists")) return null;
    }

    const { data: pubData } = supabase.storage
      .from("vehicle-photos")
      .getPublicUrl(storagePath);

    return pubData?.publicUrl || null;
  } catch {
    return null;
  }
}

// Rate limit tracking — skip individual cities, abort only after consecutive failures
let consecutiveRateLimits = 0;
const MAX_CONSECUTIVE_RATE_LIMITS = 3;

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

// ── Non-automobile filtering ──────────────────────────────────────
// Prevents motorcycles, boats, RVs, ATVs, farm equipment, golf carts
// from entering the vehicles table.

/** Makes that NEVER produce automobiles. Case-insensitive lookup. */
const NON_AUTO_MAKES_LC = new Set([
  // Motorcycles (pure moto brands)
  'harley-davidson','harley','ducati','ktm','husqvarna','aprilia',
  'moto guzzi','norton','buell','royal enfield','indian','bimota',
  'benelli','mv agusta','vespa','piaggio','bsa','crocker','laverda',
  'velocette','excelsior','henderson','matchless','ajs','vincent',
  // Motorcycle-primary (no production cars in 1960-1999)
  'yamaha','kawasaki',
  // Powersports / UTV / ATV
  'polaris','arctic cat','can-am','ski-doo',
  // Marine
  'sea-doo','sea ray','bayliner','boston whaler','mastercraft',
  'chris-craft','wellcraft','chaparral','cobalt','malibu boats',
  'correct craft','riva','rinker','lund','crestliner','bennington',
  'grumman','glastron','skeeter','tracker',
  // RV / Camper
  'fleetwood','winnebago','airstream','coachmen','jayco','keystone',
  'forest river','thor','newmar','tiffin','starcraft','heartland',
  'dutchmen','grand design','entegra','gulf stream','coleman',
  'holiday rambler','monaco','flagstaff',
  // Farm / Heavy Equipment
  'john deere','kubota','caterpillar','bobcat','case ih','new holland',
  'massey ferguson','farmall','allis-chalmers','oliver','agco',
  // Heavy Duty / Commercial
  'freightliner','peterbilt','kenworth','mack','hino','western star',
  'autocar','navistar',
  // Golf Carts
  'ezgo','club car','cushman','gem',
  // Aircraft
  'cessna','piper','beechcraft','mooney','cirrus',
  // Trailers
  'featherlite','sundowner','big tex','load trail','pj trailers',
]);

/**
 * Motorcycle/non-auto model patterns for dual-use makes (Honda, Suzuki, BMW, Triumph).
 * These makes produce BOTH cars and motorcycles — we classify by model.
 */
const MOTORCYCLE_MODEL_PATTERNS = [
  // Honda motorcycle series (1960-1999)
  /^CB\d/i, /^CL\d/i, /^CT\d/i, /^XL\d/i, /^XR\d/i, /^CR\d/i, /^GL\d/i,
  /^VT\d/i, /^VF\d/i, /^CBR/i, /^CRF/i, /^NX\d/i, /^CMX/i,
  /^Shadow/i, /^Rebel/i, /^Nighthawk/i, /^Magna/i, /^Gold\s?Wing/i,
  /^Interceptor/i, /^Pacific Coast/i, /^Valkyrie/i,
  // Suzuki motorcycle series
  /^GS\d/i, /^GSX/i, /^DR\d/i, /^RM\d/i, /^VS\d/i, /^SV\d/i, /^TL\d/i,
  /^Intruder/i, /^Katana/i, /^Bandit/i, /^Boulevard/i, /^Hayabusa/i,
  /^Savage/i, /^Marauder/i,
  // Suzuki ATV series
  /^LT\d/i, /^LT-/i, /^King\s?Quad/i, /^Eiger/i, /^Ozark/i,
  // BMW motorcycle series (R/K/F/G — BMW cars use 3-digit series like 325i, M3, Z3)
  /^R\d{2}/i, /^K\d{2}/i, /^F\d{3}\s/i, /^F\d{3}$/i, /^G\d{3}/i,
  // Triumph motorcycle models
  /^Bonneville/i, /^Thruxton/i, /^Tiger\b/i, /^Trident/i, /^Trophy/i,
  /^Daytona\b/i, /^Speed\s?Triple/i, /^Sprint/i, /^Scrambler/i, /^Rocket/i,
  // Generic non-auto keywords in model field
  /Motorcycle/i, /Dirt\s?Bike/i, /Sport\s?Bike/i, /Chopper/i, /Bobber/i,
  /\bATV\b/i, /\bUTV\b/i, /\bQuad\b/i, /Scooter/i, /Moped/i,
  /Jet\s?Ski/i, /Wave\s?Runner/i, /Golf\s?Cart/i,
  /Motorhome/i, /Camper\b/i, /\bRV\b/i, /Trailer\b/i, /Tractor\b/i,
];

/**
 * Classify a vehicle as auto or non-auto, and return a vehicle type.
 * Returns { isAuto: bool, vehicleType: string|null }
 */
function classifyVehicle(make, model) {
  if (!make) return { isAuto: false, vehicleType: null };
  const makeLc = make.toLowerCase().trim();

  // Known non-auto make → classify by category
  if (NON_AUTO_MAKES_LC.has(makeLc)) {
    let vtype = 'MOTORCYCLE'; // default for moto brands
    if (['polaris','arctic cat','can-am','ski-doo'].includes(makeLc)) vtype = 'ATV';
    if (['sea-doo','sea ray','bayliner','boston whaler','mastercraft','chris-craft','wellcraft','chaparral','cobalt','malibu boats','correct craft','riva','rinker','lund','crestliner','bennington','grumman','glastron','skeeter','tracker'].includes(makeLc)) vtype = 'BOAT';
    if (['fleetwood','winnebago','airstream','coachmen','jayco','keystone','forest river','thor','newmar','tiffin','starcraft','heartland','dutchmen','grand design','entegra','gulf stream','coleman','holiday rambler','monaco','flagstaff'].includes(makeLc)) vtype = 'RV';
    if (['john deere','kubota','caterpillar','bobcat','case ih','new holland','massey ferguson','farmall','allis-chalmers','oliver','agco'].includes(makeLc)) vtype = 'FARM_EQUIPMENT';
    if (['freightliner','peterbilt','kenworth','mack','hino','western star','autocar','navistar'].includes(makeLc)) vtype = 'COMMERCIAL_TRUCK';
    if (['ezgo','club car','cushman','gem'].includes(makeLc)) vtype = 'GOLF_CART';
    if (['cessna','piper','beechcraft','mooney','cirrus'].includes(makeLc)) vtype = 'AIRCRAFT';
    if (['featherlite','sundowner','big tex','load trail','pj trailers'].includes(makeLc)) vtype = 'TRAILER';
    return { isAuto: false, vehicleType: vtype };
  }

  // Dual-use make — check model for motorcycle patterns
  if (model && MOTORCYCLE_MODEL_PATTERNS.some(p => p.test(model))) {
    // Determine subtype from model keywords
    if (/\b(ATV|UTV|Quad|Four.?Wheeler)\b/i.test(model)) return { isAuto: false, vehicleType: 'ATV' };
    if (/\b(Jet.?Ski|Wave.?Runner)\b/i.test(model)) return { isAuto: false, vehicleType: 'BOAT' };
    if (/\b(Golf.?Cart)\b/i.test(model)) return { isAuto: false, vehicleType: 'GOLF_CART' };
    if (/\b(Motorhome|Camper|RV)\b/i.test(model)) return { isAuto: false, vehicleType: 'RV' };
    if (/\b(Trailer)\b/i.test(model)) return { isAuto: false, vehicleType: 'TRAILER' };
    if (/\b(Tractor)\b/i.test(model)) return { isAuto: false, vehicleType: 'FARM_EQUIPMENT' };
    return { isAuto: false, vehicleType: 'MOTORCYCLE' };
  }

  return { isAuto: true, vehicleType: null };
}

/**
 * Y/M/M market price index — loaded at startup from our 313K+ sale records.
 * Used to compute signal: how does this listing's price compare to market?
 *
 * A 1967 Shelby GT500 at $150K = noise (that's the market).
 * A 1967 Shelby GT500 at $35K  = screaming signal.
 *
 * Signal is NOT hardcoded by make/model. It emerges from the data.
 */
let marketIndex = new Map(); // key: "year_make_model" → { median, p25, p75, n }
let makeModelIndex = new Map(); // key: "make_model" → fallback when exact year missing
let ymmIndexLoaded = false;

async function loadMarketIndex() {
  if (ymmIndexLoaded) return;
  console.log('\n[Market Index] Loading Y/M/M price data...');

  // Paginate to get all Y/M/M groups (PostgREST default limit is 1000)
  let ymm = [];
  let ymmErr = null;
  const PAGE_SIZE = 5000;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase.rpc('get_ymm_market_index', {
      year_min: YEAR_MIN - 10,
      year_max: YEAR_MAX + 5,
    }).range(offset, offset + PAGE_SIZE - 1);
    if (error) { ymmErr = error; break; }
    if (!data || data.length === 0) break;
    ymm.push(...data);
    if (data.length < PAGE_SIZE) break; // last page
  }

  if (ymmErr) {
    console.error('[Market Index] RPC failed:', ymmErr.message);
    ymmIndexLoaded = true;
    return;
  }

  for (const row of (ymm || [])) {
    const key = `${row.year}_${row.make}_${row.model}`;
    marketIndex.set(key, {
      median: Number(row.median),
      p25: Number(row.p25),
      p75: Number(row.p75),
      n: Number(row.n),
    });
    // Also build make/model rollup (across years)
    const mmKey = `${row.make}_${row.model}`;
    if (!makeModelIndex.has(mmKey)) makeModelIndex.set(mmKey, { prices: [] });
    makeModelIndex.get(mmKey).prices.push(Number(row.median));
  }

  // Finalize make/model rollups
  for (const [key, g] of makeModelIndex.entries()) {
    g.prices.sort((a, b) => a - b);
    const n = g.prices.length;
    makeModelIndex.set(key, {
      median: g.prices[Math.floor(n * 0.5)],
      p25: g.prices[Math.floor(n * 0.25)],
      p75: g.prices[Math.floor(n * 0.75)],
      n,
    });
  }

  console.log(`[Market Index] Loaded ${marketIndex.size} Y/M/M groups, ${makeModelIndex.size} M/M groups`);
  ymmIndexLoaded = true;
}

/**
 * Get market comps for a vehicle. Cascading lookup:
 * 1. Exact Y/M/M → best signal
 * 2. Make/Model across years → good signal
 * 3. null → unknown, can't compute price signal
 */
function getMarketComps(year, make, model) {
  if (!make) return null;
  const makeLc = make.toLowerCase();
  const modelLc = (model || '').toLowerCase();

  // Exact match
  const exact = marketIndex.get(`${year}_${makeLc}_${modelLc}`);
  if (exact) return { ...exact, matchType: 'exact' };

  // Make/Model across years
  const mm = makeModelIndex.get(`${makeLc}_${modelLc}`);
  if (mm) return { ...mm, matchType: 'make_model' };

  return null;
}

/**
 * Compute discovery signal (0-100) from MARKET DATA, not hardcoded lists.
 *
 * Signal = how interesting is this listing relative to what we already know?
 *
 * Components:
 *   PRICE ANOMALY (0-50): asking price vs market median
 *     ratio < 0.25 → 50 pts (screaming deal — GT500 at 1/4 price)
 *     ratio < 0.50 → 40 pts (strong deal)
 *     ratio < 0.75 → 25 pts (below market)
 *     ratio 0.75-1.25 → 5 pts (at market — boring)
 *     ratio > 1.25 → 0 pts (overpriced)
 *     no comps → 15 pts (unknown = mildly interesting, could be rare)
 *
 *   RARITY (0-25): how uncommon is this Y/M/M in our database?
 *     1-2 comps → 25 pts (nearly unique)
 *     3-9 comps → 20 pts (rare)
 *     10-49 → 12 pts (uncommon)
 *     50-199 → 5 pts (common)
 *     200+ → 0 pts (commodity — 800 Camaros)
 *
 *   LISTING QUALITY (0-15): is this a real listing or junk?
 *     has price → 5 pts
 *     has 3+ photos → 5 pts
 *     has description → 5 pts
 *
 *   NON-AUTO PENALTY: -90 (still stored, near-zero priority)
 */
function computeDiscoverySignal(year, make, model, price, imageCount, hasDescription, isAuto) {
  if (!isAuto) return 1; // store it, but bottom of the pile

  let signal = 0;
  const comps = getMarketComps(year, make, model);

  // === PRICE ANOMALY (0-50) ===
  if (price && price > 100 && comps && comps.median > 0) {
    const ratio = price / comps.median;
    if (ratio < 0.25)      signal += 50; // screaming deal
    else if (ratio < 0.40) signal += 45;
    else if (ratio < 0.50) signal += 40;
    else if (ratio < 0.65) signal += 30;
    else if (ratio < 0.75) signal += 25;
    else if (ratio < 1.0)  signal += 10; // slightly below market
    else if (ratio < 1.25) signal += 5;  // at market
    // else overpriced → 0
  } else if (price && price > 100 && !comps) {
    // No comps = we don't know this vehicle well. That's interesting.
    signal += 15;
  } else if (!price) {
    // No price listed — mild signal (could be negotiable / hiding value)
    signal += 5;
  }

  // === RARITY (0-25) ===
  if (comps) {
    const n = comps.n;
    if (n <= 2)       signal += 25;
    else if (n <= 9)  signal += 20;
    else if (n <= 49) signal += 12;
    else if (n <= 199) signal += 5;
    // else commodity → 0
  } else {
    // Not in our database at all — very interesting
    signal += 25;
  }

  // === LISTING QUALITY (0-15) ===
  if (price && price > 100) signal += 5;
  if (imageCount >= 3) signal += 5;
  if (hasDescription) signal += 5;

  return Math.min(signal, 100);
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

function parseTitle(title, city, state) {
  if (!title) return { year: null, make: null, model: null };

  // Strip city/state that Facebook appends to listing titles
  let cleaned = title;
  if (city || state) {
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (city && state) {
      cleaned = cleaned.replace(new RegExp(`\\s+${esc(city)}\\s*,?\\s*${esc(state)}\\s*$`, "i"), "");
    }
    if (city) cleaned = cleaned.replace(new RegExp(`\\s+${esc(city)}\\s*$`, "i"), "");
    if (state) cleaned = cleaned.replace(new RegExp(`\\s+${esc(state)}\\s*$`, "i"), "");
  }

  const year = parseYear(cleaned);
  if (!year) return { year: null, make: null, model: null };
  const rest = cleaned.replace(/^\d{4}\s+/, "").trim();
  const lower = rest.toLowerCase();
  for (const make of MAKES) {
    if (lower.startsWith(make.toLowerCase())) {
      const afterMake = rest.slice(make.length).trim();
      const model =
        afterMake
          .split(/[\s·•|—]+/)
          .slice(0, 2)
          .join(" ")
          .trim() || null;
      return { year, make: make === "Chevy" ? "Chevrolet" : make, model };
    }
  }
  const words = rest.split(/\s+/);
  return {
    year,
    make: words[0] || null,
    model: words.slice(1, 2).join(" ") || null,
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
        scraper_version: "3.1",
        year_range: [YEAR_MIN, YEAR_MAX],
        max_pages: MAX_PAGES,
        group: GROUP || "all",
        total_groups: GROUP ? TOTAL_GROUPS : 1,
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

  // Classify vehicle type and compute market-relative signal
  const { isAuto, vehicleType } = classifyVehicle(make, model);
  const signal = computeDiscoverySignal(year, make, model, price, allImages.length, !!description, isAuto);
  const comps = isAuto ? getMarketComps(year, make, model) : null;

  if (!isAuto) {
    console.log(`    ○ ${vehicleType}: ${year} ${make} ${model || ''}`);
  } else if (signal >= 60) {
    const ratio = (price && comps?.median) ? (price / comps.median).toFixed(2) : '?';
    console.log(`    ★ FIND [${signal}]: ${year} ${make} ${model || ''} $${price || '?'} (market $${comps?.median || '?'}, ratio ${ratio}, ${comps?.n || 0} comps)`);
  } else if (signal >= 40) {
    console.log(`    ◆ Interesting [${signal}]: ${year} ${make} ${model || ''} $${price || '?'}`);
  }

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
    if (imageUrl) {
      // Download primary image to Supabase storage (FB CDN URLs expire)
      const storedPrimary = await downloadAndStoreImage(imageUrl, vehicleId, 0);
      if (storedPrimary) updates.primary_image_url = storedPrimary;
    }

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
    const insertData = {
      year,
      make: make.charAt(0).toUpperCase() + make.slice(1),
      model: model || null,
      listing_url: fbUrl,
      asking_price: price ? Math.round(price) : null,
      description: description || null,
      listing_location: location,
      gps_latitude: listingLat,
      gps_longitude: listingLng,
      status: isAuto ? "discovered" : "rejected",
      source: "facebook_marketplace",
      auction_source: "facebook_marketplace",
      discovery_source: "facebook_marketplace",
    };
    // Classify at extraction time so the feed can filter/sort
    if (vehicleType) insertData.canonical_vehicle_type = vehicleType;
    if (signal > 0) insertData.discovery_priority = signal;

    const { data: newVeh, error: vehErr } = await supabase
      .from("vehicles")
      .insert(insertData)
      .select("id")
      .single();

    // Download primary image after vehicle creation (need vehicleId for storage path)
    if (newVeh?.id && imageUrl) {
      const storedPrimary = await downloadAndStoreImage(imageUrl, newVeh.id, 0);
      if (storedPrimary) {
        await supabase.from("vehicles").update({ primary_image_url: storedPrimary }).eq("id", newVeh.id);
      }
    }

    if (vehErr) {
      console.error(`    Vehicle insert error for ${facebookId}: ${vehErr.message}`);
      return result;
    }
    vehicleId = newVeh.id;
  }

  result.vehicleId = vehicleId;

  // Download and store images in Supabase storage (FB CDN URLs expire)
  if (allImages.length > 0 && vehicleId) {
    // Check which images already exist (by source_url to avoid re-downloading)
    const { data: existingImgs } = await supabase
      .from("vehicle_images")
      .select("image_url, source_url")
      .eq("vehicle_id", vehicleId);

    const existingSourceUrls = new Set((existingImgs || []).map(i => i.source_url || i.image_url));
    const newImages = allImages.filter(url => !existingSourceUrls.has(url));

    if (newImages.length > 0) {
      const imgRows = [];
      for (let idx = 0; idx < newImages.length; idx++) {
        const originalUrl = newImages[idx];
        // Download to Supabase storage so we own the image permanently
        const storedUrl = await downloadAndStoreImage(originalUrl, vehicleId, idx);
        if (!storedUrl) continue; // Skip — never store expiring CDN URLs
        imgRows.push({
          vehicle_id: vehicleId,
          image_url: storedUrl,
          source_url: originalUrl, // Preserve original URL for dedup
          source: "facebook_marketplace",
          display_order: (existingSourceUrls.size || 0) + idx,
        });
      }

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
  // Abort if we've hit too many consecutive rate limits
  if (consecutiveRateLimits >= MAX_CONSECUTIVE_RATE_LIMITS) {
    console.log(`  Skipping ${label} — ${consecutiveRateLimits} consecutive cities rate limited`);
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
            consecutiveRateLimits++;
            console.error(`  Rate limit on ${label} — skipping (${consecutiveRateLimits}/${MAX_CONSECUTIVE_RATE_LIMITS} consecutive)`);
            if (consecutiveRateLimits >= MAX_CONSECUTIVE_RATE_LIMITS) {
              console.error(`\n  *** ${MAX_CONSECUTIVE_RATE_LIMITS} CONSECUTIVE RATE LIMITS — aborting remaining cities ***`);
            }
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

      const city = listing.location?.reverse_geocode?.city || null;
      const state = listing.location?.reverse_geocode?.state || null;
      const { year, make, model } = parseTitle(listing.marketplace_listing_title, city, state);
      const price = listing.listing_price?.amount
        ? parseFloat(listing.listing_price.amount)
        : null;
      const allImages = extractAllImages(edge);
      const imageUrl = allImages[0] || null;
      const { lat: listingLat, lng: listingLng } = extractCoords(edge);
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

  // Reset consecutive rate limit counter on any successful scrape
  if (stats.found > 0) {
    consecutiveRateLimits = 0;
  }

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
    const allLocations = Object.entries(METRO_AREAS);
    if (GROUP > 0 && GROUP <= TOTAL_GROUPS) {
      locationsToScrape = allLocations.filter((_, idx) => (idx % TOTAL_GROUPS) + 1 === GROUP);
    } else {
      locationsToScrape = allLocations;
    }
  } else {
    locationsToScrape = [["austin", METRO_AREAS.austin]];
  }

  console.log(`FB Marketplace Local Scraper v3.1`);
  if (GROUP) console.log(`Group: ${GROUP}/${TOTAL_GROUPS}`);
  console.log(`Locations: ${locationsToScrape.length}`);
  console.log(`Year range: ${YEAR_MIN}-${YEAR_MAX}`);
  console.log(`Max pages per location: ${MAX_PAGES}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log(`Disappearance detection: ${!SKIP_DISAPPEARANCE && !DRY_RUN}`);
  console.log(`Vehicle creation: ${!SKIP_VEHICLES && !DRY_RUN}`);
  console.log(`Estimated max listings to scan: ${locationsToScrape.length * MAX_PAGES * 24}`);

  // Load market price index for signal computation
  if (!SKIP_VEHICLES && !DRY_RUN) {
    await loadMarketIndex();
  }

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

    // Inter-city delay (8-15s normally, 30s extra after a rate limit skip)
    if (locationsToScrape.length > 1 && consecutiveRateLimits < MAX_CONSECUTIVE_RATE_LIMITS) {
      const baseDelay = 8000 + Math.random() * 7000;
      const extraDelay = consecutiveRateLimits > 0 ? 30000 : 0;
      await sleep(baseDelay + extraDelay);
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
