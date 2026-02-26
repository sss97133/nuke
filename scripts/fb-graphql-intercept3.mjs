import { chromium } from 'playwright';
import fs from 'fs';

const COOKIES_FILE = '/Users/skylar/nuke/fb-session-1/fb-cookies.json';
const TARGET_URL = 'https://www.facebook.com/marketplace/austin/vehicles/?minYear=1960&maxYear=1999';

const rawCookies = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
const cookies = rawCookies.map(c => ({
  name: c.name,
  value: c.value,
  domain: c.domain,
  path: c.path,
  expires: c.expires ? Math.floor(c.expires) : -1,
  httpOnly: c.httpOnly,
  secure: c.secure,
  sameSite: c.sameSite === 'None' ? 'None' : c.sameSite === 'Lax' ? 'Lax' : 'None',
}));

console.log(`Loaded ${cookies.length} cookies`);

const intercepted = [];
const allPostRequests = [];

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  viewport: { width: 1440, height: 900 },
  locale: 'en-US',
});

await context.addCookies(cookies);
const page = await context.newPage();

// Intercept ALL POST requests for inspection
await page.route('**/api/graphql**', async (route) => {
  const request = route.request();
  const postData = request.postData();
  console.log(`\n[GRAPHQL ROUTE] ${request.method()} ${request.url()}`);

  if (postData) {
    const params = new URLSearchParams(postData);
    const docId = params.get('doc_id');
    const variablesRaw = params.get('variables');
    let variables = null;
    try { variables = JSON.parse(variablesRaw || '{}'); } catch (e) { variables = variablesRaw; }

    const entry = { index: intercepted.length + 1, doc_id: docId, variables, variables_raw: variablesRaw, post_data_raw: postData };
    intercepted.push(entry);
    console.log(`  doc_id: ${docId}`);
    console.log(`  variables: ${variablesRaw?.substring(0, 200)}`);

    try {
      const response = await route.fetch();
      const text = await response.text();
      entry.response_text_preview = text.substring(0, 1000);
      try {
        const json = JSON.parse(text);
        entry.response = json;
        const listings = extractListings(json);
        if (listings.length > 0) {
          entry.extracted_listings = listings;
          console.log(`  LISTINGS: ${JSON.stringify(listings.slice(0, 3))}`);
        }
      } catch (e) {}
      await route.fulfill({ response });
      return;
    } catch (e) {
      console.log(`  fetch error: ${e.message}`);
    }
  }
  await route.continue();
});

// Also capture bz responses (FB's batch endpoint often contains GraphQL data)
await page.route('**/ajax/bz**', async (route) => {
  const request = route.request();
  console.log(`\n[BZ] ${request.method()} ${request.url().substring(0, 120)}`);
  const postData = request.postData();
  if (postData) {
    allPostRequests.push({ url: request.url().substring(0, 200), postData: postData.substring(0, 500) });
  }
  try {
    const response = await route.fetch();
    const text = await response.text();

    // Parse as JSON - bz endpoint returns JSON with embedded data
    try {
      // FB sometimes returns multiple JSON objects
      const lines = text.split('\n').filter(l => l.trim().startsWith('{'));
      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          const jsonStr = JSON.stringify(json);
          if (jsonStr.includes('marketplace') || jsonStr.includes('MarketplaceListing')) {
            const listings = extractListings(json);
            if (listings.length > 0) {
              console.log(`  BZ LISTINGS: ${JSON.stringify(listings.slice(0, 3))}`);
              intercepted.push({ source: 'bz', url: request.url().substring(0, 150), extracted_listings: listings, response: json });
            }
          }
        } catch (e) {}
      }
    } catch (e) {}

    await route.fulfill({ response });
    return;
  } catch (e) {}
  await route.continue();
});

function extractListings(obj, depth = 0, results = []) {
  if (depth > 25 || !obj || typeof obj !== 'object') return results;

  if (obj.marketplace_listing_title) {
    results.push({
      title: obj.marketplace_listing_title,
      price: obj.listing_price?.amount,
      currency: obj.listing_price?.currency,
      id: obj.id,
      location: obj.location?.reverse_geocode?.city,
    });
  }
  if (obj.__typename === 'MarketplaceListing' && (obj.listing_price || obj.name)) {
    if (!results.find(r => r.id === obj.id)) {
      results.push({ __typename: obj.__typename, id: obj.id, title: obj.name, price: obj.listing_price?.amount });
    }
  }

  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item && typeof item === 'object') extractListings(item, depth + 1, results);
      }
    } else if (val && typeof val === 'object') {
      extractListings(val, depth + 1, results);
    }
  }
  return results;
}

console.log('Navigating...');

await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 60000 });
console.log(`Title: ${await page.title()}`);
console.log(`URL: ${page.url()}`);

// Get the page HTML to extract embedded data
const html = await page.content();
fs.writeFileSync('/Users/skylar/nuke/fb-page.html', html);
console.log(`\nPage HTML saved (${html.length} bytes)`);

// Extract embedded JSON from script tags
const scriptMatches = html.matchAll(/require\("ScheduledServerJS"\)\.handleWithCustomApplyEach\(require\("Bootloader"\),(.+?)\)(?=;\s*\})/gs);
let schemaDataFound = false;

// Try to extract __bbox data which contains the relay store
const bboxMatches = [...html.matchAll(/"__bbox":\{"require":\[(.+?)(?=\},"__sp")/gs)];
console.log(`Found ${bboxMatches.length} __bbox blocks`);

// Look for MarketplaceListing in the HTML
const marketplaceMatches = [...html.matchAll(/MarketplaceListing[^"]{0,200}/g)];
console.log(`Found ${marketplaceMatches.length} MarketplaceListing references`);
if (marketplaceMatches.length > 0) {
  console.log('Sample:', marketplaceMatches[0][0].substring(0, 200));
}

// Look for doc_id in page HTML
const docIdMatches = [...html.matchAll(/"doc_id":"(\d+)"/g)];
console.log(`\nFound ${docIdMatches.length} doc_id references in HTML`);
const uniqueDocIds = [...new Set(docIdMatches.map(m => m[1]))];
console.log(`Unique doc_ids: ${uniqueDocIds.join(', ')}`);

// Look for marketplace_listing_title
const titleMatches = [...html.matchAll(/"marketplace_listing_title":"([^"]+)"/g)];
console.log(`\nFound ${titleMatches.length} marketplace_listing_title in HTML`);
titleMatches.slice(0, 5).forEach(m => console.log(`  - ${m[1]}`));

// Look for listing prices
const priceMatches = [...html.matchAll(/"listing_price":\{"amount":"([^"]+)","currency":"([^"]+)"/g)];
console.log(`\nFound ${priceMatches.length} listing prices in HTML`);
priceMatches.slice(0, 5).forEach(m => console.log(`  - $${m[1]} ${m[2]}`));

// Wait for more requests
await page.waitForTimeout(5000);

// Save results
const outputPath = '/Users/skylar/nuke/fb-graphql-results3.json';
fs.writeFileSync(outputPath, JSON.stringify({ intercepted, uniqueDocIds, allPostRequests }, null, 2));
console.log(`\nSaved to: ${outputPath}`);
console.log(`\nTotal intercepted: ${intercepted.length}`);
intercepted.forEach(e => {
  console.log(`\n--- Entry ${e.index || e.source} ---`);
  console.log(`doc_id: ${e.doc_id || 'N/A'}`);
  if (e.variables) console.log(`variables: ${JSON.stringify(e.variables, null, 2)}`);
  if (e.extracted_listings?.length) {
    console.log(`Listings: ${JSON.stringify(e.extracted_listings.slice(0, 3), null, 2)}`);
  }
  if (e.post_data_raw) console.log(`\nRAW POST:\n${e.post_data_raw.substring(0, 2000)}`);
});

await browser.close();
