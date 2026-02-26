import { chromium } from 'playwright';
import fs from 'fs';

const COOKIES_FILE = '/Users/skylar/nuke/fb-session-1/fb-cookies.json';
const TARGET_URL = 'https://www.facebook.com/marketplace/austin/vehicles/?minYear=1960&maxYear=1999';
const GRAPHQL_ENDPOINT = 'https://www.facebook.com/api/graphql/';

const rawCookies = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));

const cookies = rawCookies.map(c => ({
  name: c.name,
  value: c.value,
  domain: c.domain,
  path: c.path,
  expires: c.expires ? Math.floor(c.expires) : -1,
  httpOnly: c.httpOnly,
  secure: c.secure,
  sameSite: c.sameSite === 'None' ? 'None' : c.sameSite === 'Lax' ? 'Lax' : c.sameSite === 'Strict' ? 'Strict' : 'None',
}));

console.log(`Loaded ${cookies.length} cookies`);

const intercepted = [];
const allRequests = [];

const browser = await chromium.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-blink-features=AutomationControlled',
  ],
});

const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  viewport: { width: 1440, height: 900 },
  locale: 'en-US',
});

await context.addCookies(cookies);

const page = await context.newPage();

// Intercept at the route level to capture ALL requests before they go out
await page.route('**/*', async (route) => {
  const request = route.request();
  const url = request.url();
  const method = request.method();

  // Track all requests
  allRequests.push({ url: url.substring(0, 120), method });

  if (url.includes('/api/graphql') && method === 'POST') {
    const postData = request.postData();
    if (postData) {
      const params = new URLSearchParams(postData);
      const docId = params.get('doc_id');
      const variablesRaw = params.get('variables');
      let variables = null;
      try {
        variables = JSON.parse(variablesRaw || '{}');
      } catch (e) {
        variables = variablesRaw;
      }

      const entry = {
        index: intercepted.length + 1,
        doc_id: docId,
        variables,
        variables_raw: variablesRaw,
        post_data_raw: postData,
      };

      intercepted.push(entry);
      console.log(`\n=== GraphQL Request #${entry.index} ===`);
      console.log(`doc_id: ${docId}`);
      console.log(`variables keys: ${Object.keys(variables || {}).join(', ')}`);

      // Continue the request and capture response
      try {
        const response = await route.fetch();
        let responseBody = null;
        try {
          const text = await response.text();
          responseBody = JSON.parse(text);

          // Look for listing data
          const listings = extractListings(responseBody);
          if (listings.length > 0) {
            entry.extracted_listings = listings.slice(0, 5);
            console.log(`  -> Found ${listings.length} listing nodes`);
            listings.slice(0, 2).forEach((l, i) => console.log(`     ${i+1}. ${JSON.stringify(l)}`));
          }
          entry.response_preview = JSON.stringify(responseBody).substring(0, 500);
        } catch (e) {
          entry.response_error = e.message;
        }
        entry.response = responseBody;
        await route.fulfill({ response });
        return;
      } catch (e) {
        console.log(`  Route fetch error: ${e.message}`);
      }
    }
  }

  await route.continue();
});

function extractListings(obj, depth = 0, results = []) {
  if (depth > 20 || !obj || typeof obj !== 'object') return results;

  if (obj.marketplace_listing_title || (obj.__typename && obj.__typename.includes('Marketplace') && obj.listing_price)) {
    results.push({
      __typename: obj.__typename,
      title: obj.marketplace_listing_title || obj.name,
      price: obj.listing_price?.amount,
      currency: obj.listing_price?.currency,
      id: obj.id,
      location: obj.location?.reverse_geocode?.city,
    });
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

console.log('Navigating to FB Marketplace Austin vehicles (1960-1999)...');

try {
  await page.goto(TARGET_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  console.log('Page title:', await page.title());
  console.log('Current URL:', page.url());
} catch (e) {
  console.log(`Navigation: ${e.message}`);
}

// Wait for network to settle
console.log('Waiting for network activity...');
await page.waitForTimeout(8000);

// Try scrolling to trigger lazy loads
try {
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.waitForTimeout(3000);
} catch (e) {}

console.log(`\nTotal requests captured: ${allRequests.length}`);
console.log(`GraphQL POST requests: ${intercepted.length}`);

// Show all unique domains hit
const domains = [...new Set(allRequests.map(r => {
  try { return new URL(r.url).hostname; } catch { return 'unknown'; }
}))];
console.log(`Domains: ${domains.join(', ')}`);

// Save results
const outputPath = '/Users/skylar/nuke/fb-graphql-results2.json';
fs.writeFileSync(outputPath, JSON.stringify({
  intercepted,
  allRequests: allRequests.slice(0, 50),
}, null, 2));
console.log(`\nSaved to: ${outputPath}`);

// Print details
intercepted.forEach((entry) => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`GraphQL Request #${entry.index}`);
  console.log(`doc_id: ${entry.doc_id}`);
  console.log(`variables:\n${JSON.stringify(entry.variables, null, 2)}`);
  if (entry.extracted_listings?.length) {
    console.log(`\nExtracted Listings:`);
    entry.extracted_listings.forEach((l, i) => console.log(`  ${i+1}. ${JSON.stringify(l)}`));
  }
  console.log(`\nRAW POST BODY (first 3000 chars):\n${(entry.post_data_raw || '').substring(0, 3000)}`);
});

await browser.close();
console.log('\nDone.');
