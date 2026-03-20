/**
 * CL Discovery
 *
 * Discovers 1960-1999 vehicle listings across all 416 US Craigslist subdomains.
 * For each new listing: calls extract-craigslist (saves full page + parses JSON-LD for free + saves to DB).
 * No AI. No wrapper. Just structured data parsing.
 *
 * Usage:
 *   dotenvx run -- node scripts/cl-discovery.mjs --all
 *   dotenvx run -- node scripts/cl-discovery.mjs --region stgeorge
 *   dotenvx run -- node scripts/cl-discovery.mjs --all --group 1
 *   dotenvx run -- node scripts/cl-discovery.mjs --all --year-min 1973 --year-max 1987
 *   dotenvx run -- node scripts/cl-discovery.mjs --all --dry-run
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
const REGION = args.includes("--region")
  ? args[args.indexOf("--region") + 1]
  : null;
const GROUP = args.includes("--group")
  ? parseInt(args[args.indexOf("--group") + 1] || "0")
  : 0;
const TOTAL_GROUPS = 4;
const YEAR_MIN = args.includes("--year-min")
  ? parseInt(args[args.indexOf("--year-min") + 1])
  : 1960;
const YEAR_MAX = args.includes("--year-max")
  ? parseInt(args[args.indexOf("--year-max") + 1])
  : 1999;
const CONCURRENCY = args.includes("--concurrency")
  ? parseInt(args[args.indexOf("--concurrency") + 1])
  : 3;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// All 416 US Craigslist subdomains
const US_SUBDOMAINS = [
  "abilene","akroncanton","albany","albanyga","albuquerque","allentown","altoona",
  "amarillo","ames","anchorage","annapolis","annarbor","appleton","asheville",
  "ashtabula","athensga","athensohio","atlanta","auburn","augusta","austin",
  "bakersfield","baltimore","batonrouge","battlecreek","beaumont","bellingham",
  "bemidji","bend","bgky","bham","bigbend","billings","binghamton","bismarck",
  "blacksburg","bloomington","bn","boise","boone","boston","boulder","bozeman",
  "brainerd","brownsville","brunswick","buffalo","butte","capecod","carbondale",
  "catskills","cedarrapids","cenla","centralmich","cfl","chambana","chambersburg",
  "charleston","charlestonwv","charlotte","charlottesville","chattanooga",
  "chautauqua","chicago","chico","chillicothe","cincinnati","clarksville",
  "cleveland","clovis","cnj","collegestation","columbia","columbiamo","columbus",
  "columbusga","cookeville","corpuschristi","corvallis","cosprings","csd","dallas",
  "danville","dayton","daytona","decatur","delaware","delrio","denver","desmoines",
  "detroit","dothan","dubuque","duluth","eastco","easternshore","eastidaho",
  "eastky","eastnc","eastoregon","easttexas","eauclaire","elko","elmira","elpaso",
  "enid","erie","eugene","evansville","fairbanks","fargo","farmington","fayar",
  "fayetteville","fingerlakes","flagstaff","flint","florencesc","fortcollins",
  "fortdodge","fortmyers","fortsmith","fortwayne","frederick","fredericksburg",
  "fresno","gadsden","gainesville","galveston","glensfalls","goldcountry",
  "grandforks","grandisland","grandrapids","greatfalls","greenbay","greensboro",
  "greenville","gulfport","hanford","harrisburg","harrisonburg","hartford",
  "hattiesburg","helena","hickory","hiltonhead","holland","honolulu","houma",
  "houston","hudsonvalley","humboldt","huntington","huntsville","imperial",
  "indianapolis","inlandempire","iowacity","ithaca","jackson","jacksontn",
  "jacksonville","janesville","jerseyshore","jonesboro","joplin","juneau","jxn",
  "kalamazoo","kalispell","kansascity","kenai","keys","killeen","kirksville",
  "klamath","knoxville","kokomo","kpr","ksu","lacrosse","lafayette","lakecharles",
  "lakecity","lakeland","lancaster","lansing","laredo","lasalle","lascruces",
  "lasvegas","lawrence","lawton","lewiston","lexington","limaohio","lincoln",
  "littlerock","logan","longisland","losangeles","louisville","loz","lubbock",
  "lynchburg","macon","madison","maine","mankato","mansfield","marshall",
  "martinsburg","masoncity","mattoon","mcallen","meadville","medford","memphis",
  "mendocino","merced","meridian","miami","micronesia","milwaukee","minneapolis",
  "missoula","mobile","modesto","mohave","monroe","monroemi","montana","monterey",
  "montgomery","morgantown","moseslake","muncie","muskegon","myrtlebeach",
  "nacogdoches","nashville","natchez","nd","nesd","newhaven","newjersey",
  "newlondon","neworleans","newyork","nh","nmi","norfolk","northernwi","northmiss",
  "northplatte","nwct","nwga","nwks","ocala","odessa","ogden","okaloosa",
  "oklahomacity","olympic","omaha","oneonta","onslow","orangecounty","oregoncoast",
  "orlando","ottumwa","outerbanks","owensboro","palmsprings","panamacity",
  "parkersburg","pennstate","pensacola","peoria","philadelphia","phoenix",
  "pittsburgh","plattsburgh","poconos","porthuron","portland","potsdam","prescott",
  "providence","provo","pueblo","puertorico","pullman","quadcities","quincy",
  "racine","raleigh","rapidcity","reading","redding","reno","richmond",
  "richmondin","rmn","roanoke","rochester","rockford","rockies","roseburg",
  "roswell","sacramento","saginaw","salem","salina","saltlakecity","sanangelo",
  "sanantonio","sandiego","sandusky","sanmarcos","santabarbara","santafe",
  "santamaria","sarasota","savannah","scottsbluff","scranton","sd","seattle",
  "seks","semo","sfbay","sheboygan","shoals","showlow","shreveport","sierravista",
  "siouxcity","siouxfalls","siskiyou","skagit","slo","smd","southbend",
  "southcoast","southjersey","spacecoast","spokane","springfield","springfieldil",
  "statesboro","staugustine","stcloud","stgeorge","stillwater","stjoseph",
  "stlouis","stockton","susanville","swks","swmi","swv","swva","syracuse",
  "tallahassee","tampa","terrehaute","texarkana","texoma","thumb","tippecanoe",
  "toledo","topeka","treasure","tricities","tucson","tulsa","tuscaloosa",
  "tuscarawas","twinfalls","twintiers","up","utica","valdosta","ventura","vermont",
  "victoriatx","virgin","visalia","waco","washingtondc","waterloo","watertown",
  "wausau","wenatchee","westernmass","westky","westmd","westslope","wheeling",
  "wichita","wichitafalls","williamsport","wilmington","winchester","winstonsalem",
  "worcester","wv","wyoming","yakima","york","youngstown","yubasutter","yuma",
  "zanesville",
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function safeFetch(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: controller.signal,
    });
    clearTimeout(timer);
    return resp;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

function extractListingUrls(html) {
  const urlPattern =
    /href="(https?:\/\/[a-z0-9]+\.craigslist\.org\/[a-z]*\/?ct[ao]\/d\/[^"]+\.html)"/g;
  const urls = new Set();
  let match;
  while ((match = urlPattern.exec(html)) !== null) {
    urls.add(match[1]);
  }
  return [...urls];
}

/**
 * Call extract-craigslist edge function.
 * This saves the full page + parses JSON-LD (free) + saves to DB.
 */
async function extractListing(url) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/extract-craigslist`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, save_to_db: true }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`extract-craigslist ${resp.status}: ${text.slice(0, 200)}`);
  }

  return resp.json();
}

async function discoverRegion(subdomain, stats) {
  const searchUrl = `https://${subdomain}.craigslist.org/search/cta?min_auto_year=${YEAR_MIN}&max_auto_year=${YEAR_MAX}&sort=date`;

  let searchHtml;
  try {
    const resp = await safeFetch(searchUrl);
    if (!resp.ok) {
      console.log(`  ${subdomain}: HTTP ${resp.status}`);
      stats.errors++;
      return;
    }
    searchHtml = await resp.text();
  } catch (err) {
    console.log(`  ${subdomain}: ${err.message}`);
    stats.errors++;
    return;
  }

  const urls = extractListingUrls(searchHtml);
  if (urls.length === 0) {
    console.log(`  ${subdomain}: 0`);
    return;
  }

  stats.discovered += urls.length;

  if (DRY_RUN) {
    console.log(`  ${subdomain}: ${urls.length}`);
    return;
  }

  // Dedup against what we already have
  const { data: existing } = await supabase
    .from("import_queue")
    .select("listing_url")
    .in("listing_url", urls.slice(0, 200));

  const seen = new Set((existing || []).map((r) => r.listing_url));
  const newUrls = urls.filter((u) => !seen.has(u));
  stats.skipped += urls.length - newUrls.length;

  if (newUrls.length === 0) {
    console.log(`  ${subdomain}: ${urls.length} (all seen)`);
    return;
  }

  console.log(`  ${subdomain}: ${newUrls.length} new / ${urls.length} total`);

  // Call extract-craigslist for each new URL (with concurrency limit)
  for (let i = 0; i < newUrls.length; i += CONCURRENCY) {
    const batch = newUrls.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((url) => extractListing(url)),
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value?.success) {
        stats.extracted++;
      } else {
        const reason =
          r.status === "rejected" ? r.reason?.message : r.value?.error;
        if (reason && !reason.includes("duplicate")) {
          stats.errors++;
        }
      }
    }

    // Brief pause between batches
    if (i + CONCURRENCY < newUrls.length) {
      await sleep(500);
    }
  }
}

async function main() {
  console.log(`CL Discovery — ${YEAR_MIN}-${YEAR_MAX} | ${DRY_RUN ? "DRY RUN" : "LIVE"}`);

  let regions;
  if (REGION) {
    regions = [REGION];
  } else if (ALL) {
    regions = [...US_SUBDOMAINS];
    if (GROUP > 0 && GROUP <= TOTAL_GROUPS) {
      const groupSize = Math.ceil(regions.length / TOTAL_GROUPS);
      const start = (GROUP - 1) * groupSize;
      regions = regions.slice(start, start + groupSize);
      console.log(`Group ${GROUP}/${TOTAL_GROUPS}: ${regions.length} subdomains`);
    }
  } else {
    console.error("Specify --all, --region <name>, or --all --group <1-4>");
    process.exit(1);
  }

  console.log(`${regions.length} subdomains\n`);

  const stats = { regions: 0, discovered: 0, extracted: 0, skipped: 0, errors: 0 };

  for (const sub of regions) {
    stats.regions++;
    await discoverRegion(sub, stats);

    if (stats.regions % 20 === 0) {
      console.log(
        `\n--- ${stats.regions}/${regions.length} | found ${stats.discovered} | extracted ${stats.extracted} | skipped ${stats.skipped} | errors ${stats.errors} ---\n`,
      );
    }

    await sleep(1500);
  }

  console.log(`\n=== DONE ===`);
  console.log(`Regions: ${stats.regions} | Found: ${stats.discovered} | Extracted: ${stats.extracted} | Skipped: ${stats.skipped} | Errors: ${stats.errors}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
