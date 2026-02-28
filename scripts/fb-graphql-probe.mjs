/**
 * FB Marketplace GraphQL Schema Probe
 *
 * Purpose: Map the full response schema, test pagination depth,
 * test edge cases, and document findings.
 *
 * This is a diagnostic tool, not a production scraper.
 */

const BINGBOT_UA = "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)";
const CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ==========================================
// Step 1: Fetch LSD token
// ==========================================
async function getLsdToken(location = "austin") {
  console.log(`\n=== STEP 1: Fetching LSD token for "${location}" ===`);
  const url = `https://www.facebook.com/marketplace/${location}/vehicles/`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": BINGBOT_UA,
      Accept: "text/html",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  console.log(`  HTTP status: ${r.status}`);
  console.log(`  Headers:`, Object.fromEntries([...r.headers.entries()].filter(([k]) =>
    ["content-type", "x-fb-debug", "set-cookie", "vary"].includes(k)
  )));

  const html = await r.text();
  console.log(`  HTML size: ${(html.length / 1024).toFixed(1)} KB`);

  // Extract LSD token
  const lsd = html.match(/"LSD"[^}]{0,30}"token":"([^"]+)"/)?.[1] || null;
  console.log(`  LSD token: ${lsd ? lsd.slice(0, 20) + "..." : "NOT FOUND"}`);

  // Count SSR listings for comparison
  const titleCount = (html.match(/"marketplace_listing_title"/g) || []).length;
  console.log(`  SSR listing titles in HTML: ${titleCount}`);

  // Check for other useful tokens
  const dtsg = html.match(/"DTSGInitData"[^}]*"token":"([^"]+)"/)?.[1] || null;
  console.log(`  fb_dtsg token: ${dtsg ? dtsg.slice(0, 20) + "..." : "NOT FOUND (expected for logged-out)"}`);

  // Check for other doc_ids in the HTML
  const docIds = new Set();
  const docIdRegex = /"doc_id":"(\d+)"/g;
  let m;
  while ((m = docIdRegex.exec(html)) !== null) {
    docIds.add(m[1]);
  }
  console.log(`  doc_ids found in HTML: ${docIds.size}`);
  if (docIds.size > 0) {
    for (const id of [...docIds].slice(0, 10)) {
      console.log(`    - ${id}`);
    }
  }

  return { lsd, html };
}

// ==========================================
// Step 2: Make GraphQL request and dump full schema
// ==========================================
async function probeGraphQL(location, lat, lng, lsd, cursor = null) {
  console.log(`\n=== STEP 2: GraphQL probe (cursor: ${cursor ? cursor.slice(0, 30) + "..." : "null"}) ===`);

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

  console.log(`  HTTP status: ${resp.status}`);

  const text = await resp.text();

  // FB sometimes returns for(;;); prefix
  let json;
  try {
    const cleaned = text.replace(/^for\s*\(\s*;\s*;\s*\)\s*;\s*/, "");
    json = JSON.parse(cleaned);
  } catch (e) {
    console.error(`  Failed to parse JSON. First 500 chars: ${text.slice(0, 500)}`);
    return null;
  }

  if (json?.errors) {
    console.error(`  GraphQL errors:`, JSON.stringify(json.errors, null, 2));
    return null;
  }

  return json;
}

// ==========================================
// Step 3: Deep schema analysis
// ==========================================
function analyzeSchema(json) {
  console.log(`\n=== STEP 3: Response schema analysis ===`);

  // Top level keys
  console.log(`\n  Top-level keys: ${Object.keys(json).join(", ")}`);

  const viewer = json?.data?.viewer;
  if (!viewer) {
    console.log(`  ERROR: No data.viewer in response`);
    console.log(`  Full response keys: ${JSON.stringify(Object.keys(json.data || {}))}`);
    return;
  }

  console.log(`  data.viewer keys: ${Object.keys(viewer).join(", ")}`);

  const feed = viewer.marketplace_feed_stories;
  if (!feed) {
    console.log(`  ERROR: No marketplace_feed_stories`);
    return;
  }

  console.log(`  Feed keys: ${Object.keys(feed).join(", ")}`);
  console.log(`  Edges count: ${feed.edges?.length || 0}`);
  console.log(`  page_info: ${JSON.stringify(feed.page_info)}`);

  if (feed.edges?.length > 0) {
    // Analyze first listing in detail
    const firstEdge = feed.edges[0];
    console.log(`\n  --- First edge structure ---`);
    console.log(`  Edge keys: ${Object.keys(firstEdge).join(", ")}`);

    const node = firstEdge.node;
    if (node) {
      console.log(`  Node keys: ${Object.keys(node).join(", ")}`);

      const listing = node.listing;
      if (listing) {
        console.log(`\n  --- Listing object (FULL SCHEMA) ---`);
        printSchemaRecursive(listing, "  ", 0);
      }

      // Check for non-listing keys on node
      for (const key of Object.keys(node)) {
        if (key !== "listing" && key !== "__typename") {
          console.log(`  Node.${key}: ${JSON.stringify(node[key]).slice(0, 200)}`);
        }
      }
    }

    // Check all listings for field presence
    console.log(`\n  --- Field presence across all ${feed.edges.length} listings ---`);
    const fieldCounts = {};
    for (const edge of feed.edges) {
      const l = edge?.node?.listing;
      if (!l) continue;
      countFields(l, "", fieldCounts);
    }

    const sorted = Object.entries(fieldCounts).sort((a, b) => b[1] - a[1]);
    for (const [field, count] of sorted) {
      const pct = ((count / feed.edges.length) * 100).toFixed(0);
      console.log(`    ${field}: ${count}/${feed.edges.length} (${pct}%)`);
    }

    // Print all listings summary
    console.log(`\n  --- All listings summary ---`);
    for (const edge of feed.edges) {
      const l = edge?.node?.listing;
      if (!l) continue;
      const title = l.marketplace_listing_title || "?";
      const price = l.listing_price?.formatted_amount || "?";
      const city = l.location?.reverse_geocode?.city || "?";
      const state = l.location?.reverse_geocode?.state || "?";
      const sold = l.is_sold ? " [SOLD]" : "";
      const pending = l.is_pending ? " [PENDING]" : "";
      console.log(`    ${l.id}: ${title} | ${price} | ${city}, ${state}${sold}${pending}`);
    }
  }
}

function printSchemaRecursive(obj, prefix, depth) {
  if (depth > 4) {
    console.log(`${prefix}  ... (max depth)`);
    return;
  }
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      console.log(`${prefix}  ${key}: null`);
    } else if (Array.isArray(value)) {
      console.log(`${prefix}  ${key}: Array[${value.length}]`);
      if (value.length > 0 && typeof value[0] === "object") {
        printSchemaRecursive(value[0], prefix + "    ", depth + 1);
      } else if (value.length > 0) {
        console.log(`${prefix}    [0]: ${JSON.stringify(value[0]).slice(0, 100)}`);
      }
    } else if (typeof value === "object") {
      console.log(`${prefix}  ${key}: {`);
      printSchemaRecursive(value, prefix + "    ", depth + 1);
      console.log(`${prefix}  }`);
    } else {
      const val = String(value);
      console.log(`${prefix}  ${key}: ${val.length > 100 ? val.slice(0, 100) + "..." : val}`);
    }
  }
}

function countFields(obj, prefix, counts) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && value !== undefined) {
      counts[path] = (counts[path] || 0) + 1;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      countFields(value, path, counts);
    }
  }
}

// ==========================================
// Step 4: Test without LSD token (pure unauthenticated)
// ==========================================
async function testWithoutLsd(location, lat, lng) {
  console.log(`\n=== STEP 4: Test WITHOUT LSD token ===`);

  const variables = {
    buyLocation: { latitude: lat, longitude: lng },
    categoryIDArray: [807311116002614],
    count: 24,
    cursor: null,
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

  try {
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

    console.log(`  HTTP status: ${resp.status}`);
    const text = await resp.text();
    const cleaned = text.replace(/^for\s*\(\s*;\s*;\s*\)\s*;\s*/, "");

    try {
      const json = JSON.parse(cleaned);
      if (json?.errors) {
        console.log(`  Result: FAILED with errors`);
        console.log(`  Error: ${JSON.stringify(json.errors[0])}`);
      } else if (json?.data?.viewer?.marketplace_feed_stories?.edges?.length > 0) {
        console.log(`  Result: SUCCESS — ${json.data.viewer.marketplace_feed_stories.edges.length} listings returned WITHOUT LSD token!`);
      } else {
        console.log(`  Result: Empty response (no listings)`);
        console.log(`  Response keys: ${JSON.stringify(Object.keys(json))}`);
      }
    } catch {
      console.log(`  Result: Non-JSON response (${text.slice(0, 200)})`);
    }
  } catch (e) {
    console.log(`  Result: Request failed — ${e.message}`);
  }
}

// ==========================================
// Step 5: Test with different User-Agent strings
// ==========================================
async function testUserAgents(location, lat, lng, lsd) {
  console.log(`\n=== STEP 5: Test different User-Agents ===`);

  const userAgents = {
    "Chrome (macOS)": CHROME_UA,
    "Bingbot": BINGBOT_UA,
    "Googlebot": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "curl": "curl/8.1.2",
    "None (empty)": "",
  };

  for (const [name, ua] of Object.entries(userAgents)) {
    const variables = {
      buyLocation: { latitude: lat, longitude: lng },
      categoryIDArray: [807311116002614],
      count: 24,
      cursor: null,
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

    const headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "*/*",
      Origin: "https://www.facebook.com",
      Referer: `https://www.facebook.com/marketplace/${location}/vehicles/`,
      "sec-fetch-site": "same-origin",
      "x-fb-lsd": lsd,
    };
    if (ua) headers["User-Agent"] = ua;

    try {
      const resp = await fetch("https://www.facebook.com/api/graphql/", {
        method: "POST",
        headers,
        body: body.toString(),
      });

      const text = await resp.text();
      const cleaned = text.replace(/^for\s*\(\s*;\s*;\s*\)\s*;\s*/, "");
      const json = JSON.parse(cleaned);

      if (json?.errors) {
        console.log(`  ${name}: FAILED — ${json.errors[0]?.message?.slice(0, 80) || "unknown error"}`);
      } else {
        const count = json?.data?.viewer?.marketplace_feed_stories?.edges?.length || 0;
        console.log(`  ${name}: ${count} listings`);
      }
    } catch (e) {
      console.log(`  ${name}: ERROR — ${e.message}`);
    }

    await sleep(1500);
  }
}

// ==========================================
// Step 6: Pagination depth test
// ==========================================
async function testPaginationDepth(location, lat, lng, lsd, maxPages = 10) {
  console.log(`\n=== STEP 6: Pagination depth test (up to ${maxPages} pages) ===`);

  let cursor = null;
  const seenIds = new Set();
  let totalListings = 0;
  let overlaps = 0;

  for (let page = 1; page <= maxPages; page++) {
    const json = await probeGraphQL(location, lat, lng, lsd, cursor);
    if (!json) {
      console.log(`  Page ${page}: FAILED`);
      break;
    }

    const feed = json?.data?.viewer?.marketplace_feed_stories;
    const edges = feed?.edges || [];
    const pageInfo = feed?.page_info;

    let pageOverlaps = 0;
    for (const edge of edges) {
      const id = edge?.node?.listing?.id;
      if (id) {
        if (seenIds.has(id)) {
          pageOverlaps++;
          overlaps++;
        }
        seenIds.add(id);
      }
    }

    totalListings += edges.length;
    console.log(`  Page ${page}: ${edges.length} listings | Total unique: ${seenIds.size} | Overlaps: ${pageOverlaps} | has_next: ${pageInfo?.has_next_page}`);

    if (!pageInfo?.has_next_page) {
      console.log(`  Pagination ended at page ${page} (no more pages)`);
      break;
    }

    cursor = pageInfo.end_cursor;
    await sleep(2000 + Math.random() * 1500);
  }

  console.log(`\n  Pagination summary:`);
  console.log(`    Total pages fetched: ${Math.min(maxPages, Math.ceil(totalListings / 24))}`);
  console.log(`    Total listings: ${totalListings}`);
  console.log(`    Unique IDs: ${seenIds.size}`);
  console.log(`    Overlapping IDs: ${overlaps}`);
  console.log(`    Overlap rate: ${totalListings > 0 ? ((overlaps / totalListings) * 100).toFixed(1) : 0}%`);
}

// ==========================================
// Step 7: Test different category IDs
// ==========================================
async function testCategories(location, lat, lng, lsd) {
  console.log(`\n=== STEP 7: Test different category IDs ===`);

  // Known FB Marketplace category IDs
  const categories = {
    "Vehicles (807311116002614)": [807311116002614],
    "Cars & Trucks only": [807311116002614], // same — vehicles is the parent
    "No category (empty array)": [],
  };

  for (const [name, catIds] of Object.entries(categories)) {
    const variables = {
      buyLocation: { latitude: lat, longitude: lng },
      categoryIDArray: catIds,
      count: 24,
      cursor: null,
      marketplaceBrowseContext: "CATEGORY_FEED",
      numericVerticalFields: [],
      numericVerticalFieldsBetween: [],
      priceRange: [0, 214748364700],
      radius: 65000,
      scale: 2,
      stringVerticalFields: [],
      topicPageParams: { location_id: location, url: catIds.length ? "vehicles" : null },
    };

    const body = new URLSearchParams({
      doc_id: "33269364996041474",
      variables: JSON.stringify(variables),
      lsd,
      __a: "1",
      __comet_req: "15",
      server_timestamps: "true",
    });

    try {
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

      const text = await resp.text();
      const cleaned = text.replace(/^for\s*\(\s*;\s*;\s*\)\s*;\s*/, "");
      const json = JSON.parse(cleaned);

      if (json?.errors) {
        console.log(`  ${name}: ERROR — ${json.errors[0]?.message?.slice(0, 80)}`);
      } else {
        const count = json?.data?.viewer?.marketplace_feed_stories?.edges?.length || 0;
        console.log(`  ${name}: ${count} listings`);
        if (count > 0) {
          const sample = json.data.viewer.marketplace_feed_stories.edges[0]?.node?.listing;
          console.log(`    Sample: ${sample?.marketplace_listing_title}`);
        }
      }
    } catch (e) {
      console.log(`  ${name}: EXCEPTION — ${e.message}`);
    }

    await sleep(1500);
  }
}

// ==========================================
// Main
// ==========================================
async function main() {
  console.log("==============================================");
  console.log("  FB Marketplace GraphQL Schema Probe");
  console.log("  " + new Date().toISOString());
  console.log("==============================================");

  const location = "austin";
  const lat = 30.2672;
  const lng = -97.7431;

  // Step 1: Get LSD token
  const { lsd, html } = await getLsdToken(location);
  if (!lsd) {
    console.error("FATAL: No LSD token found. Cannot proceed.");
    process.exit(1);
  }

  // Step 2 & 3: GraphQL probe + schema analysis
  const json = await probeGraphQL(location, lat, lng, lsd);
  if (json) {
    analyzeSchema(json);
  }

  await sleep(2000);

  // Step 4: Test without LSD token
  await testWithoutLsd(location, lat, lng);

  await sleep(2000);

  // Step 5: Test different UAs
  await testUserAgents(location, lat, lng, lsd);

  await sleep(2000);

  // Step 6: Pagination depth (5 pages)
  await testPaginationDepth(location, lat, lng, lsd, 5);

  await sleep(2000);

  // Step 7: Category tests
  await testCategories(location, lat, lng, lsd);

  console.log("\n=== PROBE COMPLETE ===");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
