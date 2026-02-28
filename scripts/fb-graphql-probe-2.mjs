/**
 * FB Marketplace GraphQL Probe — Part 2
 *
 * Tests:
 * 1. LSD token NOT required (confirmed in probe 1) — so test token reuse across cities
 * 2. Price range filtering
 * 3. Radius variation
 * 4. Count parameter variation (can we get more than 24?)
 * 5. Test accessing individual listing details via different doc_ids
 * 6. Multi-metro rapid sweep (3 cities, 3 pages each)
 */

const CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function graphQL(location, lat, lng, overrides = {}) {
  const variables = {
    buyLocation: { latitude: lat, longitude: lng },
    categoryIDArray: [807311116002614],
    contextual_data: [],
    count: overrides.count || 24,
    cursor: overrides.cursor || null,
    marketplaceBrowseContext: "CATEGORY_FEED",
    numericVerticalFields: [],
    numericVerticalFieldsBetween: overrides.numericVerticalFieldsBetween || [],
    priceRange: overrides.priceRange || [0, 214748364700],
    radius: overrides.radius || 65000,
    scale: 2,
    stringVerticalFields: overrides.stringVerticalFields || [],
    topicPageParams: { location_id: location, url: "vehicles" },
  };

  const body = new URLSearchParams({
    doc_id: "33269364996041474",
    variables: JSON.stringify(variables),
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
    },
    body: body.toString(),
  });

  const text = await resp.text();
  const cleaned = text.replace(/^for\s*\(\s*;\s*;\s*\)\s*;\s*/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    console.log(`  Parse error. First 300 chars: ${text.slice(0, 300)}`);
    return null;
  }
}

function getEdges(json) {
  return json?.data?.viewer?.marketplace_feed_stories?.edges || [];
}
function getPageInfo(json) {
  return json?.data?.viewer?.marketplace_feed_stories?.page_info || {};
}

// ==========================================
// Test 1: Count parameter variation
// ==========================================
async function testCountParam() {
  console.log(`\n=== TEST 1: Count parameter variation ===`);
  for (const count of [1, 5, 12, 24, 48, 100]) {
    const json = await graphQL("austin", 30.2672, -97.7431, { count });
    const edges = getEdges(json);
    const error = json?.errors?.[0]?.message;
    console.log(`  count=${count}: ${error ? `ERROR: ${error.slice(0, 80)}` : `${edges.length} listings returned`}`);
    await sleep(1500);
  }
}

// ==========================================
// Test 2: Radius variation
// ==========================================
async function testRadius() {
  console.log(`\n=== TEST 2: Radius variation ===`);
  for (const radius of [5000, 16000, 65000, 200000, 500000]) {
    const json = await graphQL("austin", 30.2672, -97.7431, { radius });
    const edges = getEdges(json);
    const cities = new Set(edges.map((e) => e?.node?.listing?.location?.reverse_geocode?.city).filter(Boolean));
    console.log(`  radius=${radius}m (~${(radius / 1609).toFixed(0)}mi): ${edges.length} listings from ${cities.size} cities — ${[...cities].slice(0, 5).join(", ")}`);
    await sleep(1500);
  }
}

// ==========================================
// Test 3: Price range filtering
// ==========================================
async function testPriceRange() {
  console.log(`\n=== TEST 3: Price range filtering ===`);
  const ranges = [
    { label: "Under $5k", range: [0, 500000] },
    { label: "$5k-$15k", range: [500000, 1500000] },
    { label: "$15k-$50k", range: [1500000, 5000000] },
    { label: "Over $50k", range: [5000000, 214748364700] },
    { label: "All prices", range: [0, 214748364700] },
  ];

  for (const { label, range } of ranges) {
    const json = await graphQL("austin", 30.2672, -97.7431, { priceRange: range });
    const edges = getEdges(json);
    const prices = edges.map((e) => parseFloat(e?.node?.listing?.listing_price?.amount || "0")).filter(Boolean);
    const avgPrice = prices.length ? (prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(0) : "N/A";
    const minPrice = prices.length ? Math.min(...prices) : "N/A";
    const maxPrice = prices.length ? Math.max(...prices) : "N/A";
    console.log(`  ${label} [${range[0]/100}-${range[1]/100}]: ${edges.length} listings | avg=$${avgPrice} | range=$${minPrice}-$${maxPrice}`);
    await sleep(1500);
  }
}

// ==========================================
// Test 4: Year filtering via numericVerticalFieldsBetween
// ==========================================
async function testYearFilter() {
  console.log(`\n=== TEST 4: Year filtering behavior ===`);
  const yearRanges = [
    { label: "1960-1979", min: 1960, max: 1979 },
    { label: "1980-1999", min: 1980, max: 1999 },
    { label: "2000-2010", min: 2000, max: 2010 },
    { label: "2020-2026", min: 2020, max: 2026 },
    { label: "No filter", min: null, max: null },
  ];

  for (const { label, min, max } of yearRanges) {
    const numericVerticalFieldsBetween = min ? [{ max, min, name: "year" }] : [];
    const json = await graphQL("austin", 30.2672, -97.7431, { numericVerticalFieldsBetween });
    const edges = getEdges(json);

    // Parse years from titles
    const years = edges.map((e) => {
      const title = e?.node?.listing?.marketplace_listing_title || "";
      const m = title.match(/^(\d{4})\s/);
      return m ? parseInt(m[1]) : null;
    }).filter(Boolean);

    const inRange = min ? years.filter((y) => y >= min && y <= max).length : years.length;
    const outOfRange = min ? years.filter((y) => y < min || y > max).length : 0;
    const yearDist = {};
    for (const y of years) {
      const decade = Math.floor(y / 10) * 10;
      yearDist[decade] = (yearDist[decade] || 0) + 1;
    }

    console.log(`  ${label}: ${edges.length} listings | years parsed: ${years.length} | in-range: ${inRange} | out-of-range: ${outOfRange}`);
    console.log(`    Decade distribution: ${Object.entries(yearDist).map(([d, c]) => `${d}s:${c}`).join(" ")}`);
    await sleep(1500);
  }
}

// ==========================================
// Test 5: stringVerticalFields — make/model filtering
// ==========================================
async function testMakeFilter() {
  console.log(`\n=== TEST 5: stringVerticalFields (make filtering) ===`);
  const makes = [
    { label: "Ford", value: "Ford" },
    { label: "Chevrolet", value: "Chevrolet" },
    { label: "Porsche", value: "Porsche" },
    { label: "No filter", value: null },
  ];

  for (const { label, value } of makes) {
    const stringVerticalFields = value ? [{ name: "make", value }] : [];
    const json = await graphQL("austin", 30.2672, -97.7431, { stringVerticalFields });
    const edges = getEdges(json);

    const titles = edges.map((e) => e?.node?.listing?.marketplace_listing_title || "?");
    const matchMake = value ? titles.filter((t) => t.toLowerCase().includes(value.toLowerCase())).length : titles.length;

    console.log(`  ${label}: ${edges.length} listings | title-matching: ${matchMake}/${edges.length}`);
    console.log(`    Samples: ${titles.slice(0, 3).join(" | ")}`);
    await sleep(1500);
  }
}

// ==========================================
// Test 6: Token reuse across cities (no LSD needed at all!)
// ==========================================
async function testCrossCityNoToken() {
  console.log(`\n=== TEST 6: Cross-city without any token ===`);
  const cities = [
    { slug: "austin", lat: 30.2672, lng: -97.7431, label: "Austin TX" },
    { slug: "chicago", lat: 41.8781, lng: -87.6298, label: "Chicago IL" },
    { slug: "losangeles", lat: 34.0522, lng: -118.2437, label: "Los Angeles CA" },
    { slug: "miami", lat: 25.7617, lng: -80.1918, label: "Miami FL" },
    { slug: "detroit", lat: 42.3314, lng: -83.0458, label: "Detroit MI" },
  ];

  for (const city of cities) {
    const json = await graphQL(city.slug, city.lat, city.lng);
    const edges = getEdges(json);
    const error = json?.errors?.[0]?.message;

    if (error) {
      console.log(`  ${city.label}: ERROR — ${error.slice(0, 80)}`);
    } else {
      const titles = edges.map((e) => e?.node?.listing?.marketplace_listing_title).filter(Boolean);
      const vintageCount = titles.filter((t) => {
        const m = t.match(/^(\d{4})\s/);
        return m && parseInt(m[1]) >= 1960 && parseInt(m[1]) <= 1999;
      }).length;

      console.log(`  ${city.label}: ${edges.length} listings | ${vintageCount} vintage (title-parsed)`);
    }
    await sleep(2000);
  }
}

// ==========================================
// Test 7: Deep pagination (10 pages) to check listing overlap
// ==========================================
async function testDeepPagination() {
  console.log(`\n=== TEST 7: Deep pagination — 10 pages, Austin ===`);
  let cursor = null;
  const seenIds = new Set();
  let total = 0;
  let vintageTotal = 0;

  for (let page = 1; page <= 10; page++) {
    const json = await graphQL("austin", 30.2672, -97.7431, { cursor });
    const edges = getEdges(json);
    const pageInfo = getPageInfo(json);

    let overlaps = 0;
    let vintageOnPage = 0;
    for (const edge of edges) {
      const listing = edge?.node?.listing;
      if (!listing) continue;
      if (seenIds.has(listing.id)) overlaps++;
      seenIds.add(listing.id);

      const title = listing.marketplace_listing_title || "";
      const yearMatch = title.match(/^(\d{4})\s/);
      if (yearMatch) {
        const year = parseInt(yearMatch[1]);
        if (year >= 1960 && year <= 1999) vintageOnPage++;
      }
    }

    total += edges.length;
    vintageTotal += vintageOnPage;
    console.log(`  Page ${page}: ${edges.length} listings | Unique total: ${seenIds.size} | Overlaps: ${overlaps} | Vintage: ${vintageOnPage} | has_next: ${pageInfo.has_next_page}`);

    if (!pageInfo.has_next_page) {
      console.log(`  Pagination ended at page ${page}`);
      break;
    }

    cursor = pageInfo.end_cursor;
    await sleep(2500);
  }

  console.log(`\n  Deep pagination summary:`);
  console.log(`    Pages fetched: ${Math.ceil(total / 24)}`);
  console.log(`    Total listings: ${total}`);
  console.log(`    Unique: ${seenIds.size}`);
  console.log(`    Vintage (1960-1999): ${vintageTotal} (${((vintageTotal / total) * 100).toFixed(1)}%)`);
}

// ==========================================
// Main
// ==========================================
async function main() {
  console.log("==============================================");
  console.log("  FB Marketplace GraphQL Probe — Part 2");
  console.log("  " + new Date().toISOString());
  console.log("==============================================");

  await testCountParam();
  await testRadius();
  await testPriceRange();
  await testYearFilter();
  await testMakeFilter();
  await testCrossCityNoToken();
  await testDeepPagination();

  console.log("\n=== PROBE 2 COMPLETE ===");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
