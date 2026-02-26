import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const COOKIES_FILE = '/Users/skylar/nuke/fb-session-1/fb-cookies.json';
const TARGET_URL = 'https://www.facebook.com/marketplace/austin/vehicles/?minYear=1960&maxYear=1999';
const GRAPHQL_ENDPOINT = 'https://www.facebook.com/api/graphql/';

const rawCookies = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));

// Normalize cookies for Playwright
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

const browser = await chromium.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-web-security',
  ],
});

const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  viewport: { width: 1440, height: 900 },
  locale: 'en-US',
  extraHTTPHeaders: {
    'Accept-Language': 'en-US,en;q=0.9',
  },
});

await context.addCookies(cookies);

const page = await context.newPage();

// Intercept ALL requests and capture POST bodies to graphql endpoint
page.on('request', async (request) => {
  if (request.url() === GRAPHQL_ENDPOINT && request.method() === 'POST') {
    const postData = request.postData();
    if (postData && intercepted.length < 10) {
      // Parse form-encoded post data
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
        variables: variables,
        variables_raw: variablesRaw,
        post_data_raw: postData,
        url: request.url(),
        headers: request.headers(),
      };

      intercepted.push(entry);
      console.log(`\n=== INTERCEPTED GraphQL Request #${entry.index} ===`);
      console.log(`doc_id: ${docId}`);
      console.log(`variables: ${variablesRaw}`);
    }
  }
});

// Also capture responses
page.on('response', async (response) => {
  if (response.url() === GRAPHQL_ENDPOINT && response.request().method() === 'POST') {
    // Find matching intercepted entry
    const reqPostData = response.request().postData();
    const params = new URLSearchParams(reqPostData || '');
    const docId = params.get('doc_id');

    try {
      const body = await response.json();

      // Look for marketplace listings in the response
      const bodyStr = JSON.stringify(body);
      if (bodyStr.includes('marketplace') || bodyStr.includes('listing') || bodyStr.includes('vehicle') || bodyStr.includes('price')) {
        // Find the matching entry and attach response
        const entry = intercepted.find(e => e.doc_id === docId);
        if (entry && !entry.response) {
          entry.response = body;
          console.log(`\n=== RESPONSE for doc_id ${docId} ===`);

          // Try to extract listing titles/prices
          const listings = extractListings(body);
          if (listings.length > 0) {
            console.log('LISTINGS FOUND:');
            listings.slice(0, 3).forEach((l, i) => console.log(`  ${i+1}. ${JSON.stringify(l)}`));
            entry.extracted_listings = listings;
          }
        }
      }
    } catch (e) {
      // Non-JSON response
    }
  }
});

function extractListings(obj, depth = 0) {
  if (depth > 15 || !obj || typeof obj !== 'object') return [];

  const results = [];

  // Look for listing node patterns
  if (obj.__typename === 'MarketplaceListing' || obj.__typename === 'MarketplaceListingForSale') {
    const listing = {
      id: obj.id,
      title: obj.listing_title || obj.name,
      price: obj.listing_price?.amount || obj.price?.amount,
    };
    if (listing.title || listing.price) results.push(listing);
  }

  // Check for marketplace_listing_title
  if (obj.marketplace_listing_title) {
    results.push({
      title: obj.marketplace_listing_title,
      price: obj.listing_price?.amount,
    });
  }

  for (const key of Object.keys(obj)) {
    if (Array.isArray(obj[key])) {
      for (const item of obj[key]) {
        results.push(...extractListings(item, depth + 1));
      }
    } else if (obj[key] && typeof obj[key] === 'object') {
      results.push(...extractListings(obj[key], depth + 1));
    }
  }

  return results;
}

console.log('Navigating to FB Marketplace...');
try {
  await page.goto(TARGET_URL, {
    waitUntil: 'networkidle',
    timeout: 60000,
  });
} catch (e) {
  console.log(`Navigation completed with: ${e.message}`);
}

// Wait a bit more to capture any delayed requests
await page.waitForTimeout(5000);

console.log(`\n\n========== SUMMARY: ${intercepted.length} GraphQL requests intercepted ==========`);

// Save full results to file
const outputPath = '/Users/skylar/nuke/fb-graphql-results.json';
fs.writeFileSync(outputPath, JSON.stringify(intercepted, null, 2));
console.log(`\nFull results saved to: ${outputPath}`);

// Print detailed summary
intercepted.forEach((entry, i) => {
  console.log(`\n--- Request ${entry.index} ---`);
  console.log(`doc_id: ${entry.doc_id}`);
  console.log(`variables: ${JSON.stringify(entry.variables, null, 2)}`);
  if (entry.extracted_listings?.length > 0) {
    console.log(`Listings: ${JSON.stringify(entry.extracted_listings.slice(0, 2), null, 2)}`);
  }
  if (entry.post_data_raw) {
    console.log(`\nRAW POST BODY:\n${entry.post_data_raw.substring(0, 2000)}`);
  }
});

await browser.close();
console.log('\nDone.');
