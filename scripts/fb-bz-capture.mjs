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

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  viewport: { width: 1440, height: 900 },
});
await context.addCookies(cookies);
const page = await context.newPage();

const capturedBz = [];
const capturedGraphql = [];

// Use CDP to get full request/response bodies
const client = await context.newCDPSession(page);
await client.send('Network.enable');

const pendingRequests = new Map();

client.on('Network.requestWillBeSent', (params) => {
  const { requestId, request } = params;
  const url = request.url;
  const method = request.method;
  const postData = request.postData;

  if (method === 'POST' && (url.includes('/ajax/bz') || url.includes('/api/graphql'))) {
    pendingRequests.set(requestId, { url, postData, timestamp: Date.now() });
    console.log(`[REQ ${requestId.substring(0,8)}] POST ${url.substring(0, 100)}`);
    if (postData) console.log(`  body: ${postData.substring(0, 200)}`);
  }
});

client.on('Network.responseReceived', async (params) => {
  const { requestId, response } = params;
  const req = pendingRequests.get(requestId);
  if (!req) return;

  try {
    const bodyResp = await client.send('Network.getResponseBody', { requestId });
    const body = bodyResp.body;

    const entry = {
      url: req.url,
      postData: req.postData,
      responseBody: body,
      responseLength: body.length,
    };

    // Parse post data
    if (req.postData) {
      try {
        // Try as URL-encoded form
        const params = new URLSearchParams(req.postData);
        const docId = params.get('doc_id');
        const variables = params.get('variables');
        const fb_dtsg = params.get('fb_dtsg');
        const __a = params.get('__a');

        if (docId || variables) {
          entry.doc_id = docId;
          entry.variables = variables;
          entry.fb_dtsg = fb_dtsg;
          entry.parsed_as = 'form-encoded';
          capturedGraphql.push(entry);
          console.log(`  [GRAPHQL] doc_id=${docId}, vars=${variables?.substring(0, 100)}`);
        } else {
          // Try as JSON
          const jsonBody = JSON.parse(req.postData);
          entry.json_body = jsonBody;
          entry.parsed_as = 'json';
        }
      } catch (e) {}
    }

    // Check if response has marketplace data
    if (body.includes('marketplace_listing_title') || body.includes('MarketplaceListing')) {
      console.log(`  [HAS MARKETPLACE DATA] ${body.length} bytes`);
      entry.has_marketplace_data = true;

      // Extract listings from response
      const listings = [];
      const titleMatches = [...body.matchAll(/"marketplace_listing_title":"([^"]+)"/g)];
      const priceMatches = [...body.matchAll(/"amount":"([^"]+)","currency":"([^"]+)"/g)];

      titleMatches.forEach((m, i) => {
        listings.push({ title: m[1], price: priceMatches[i]?.[1] });
      });
      entry.extracted_listings = listings;
      console.log(`  Listings: ${JSON.stringify(listings.slice(0, 3))}`);
    }

    if (req.url.includes('/ajax/bz')) {
      capturedBz.push(entry);
    }

    pendingRequests.delete(requestId);
  } catch (e) {
    // Response body may not be available (e.g., redirect)
    pendingRequests.delete(requestId);
  }
});

console.log('Navigating...');
await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
console.log(`Title: ${await page.title()}`);

await page.waitForTimeout(3000);

// Scroll to trigger more data
console.log('\nScrolling to load more...');
for (let i = 0; i < 8; i++) {
  await page.evaluate(() => window.scrollBy(0, 1200));
  await page.waitForTimeout(1500);
  process.stdout.write('.');
}
console.log();

await page.waitForTimeout(5000);

// Save all captured data
const output = {
  capturedBz,
  capturedGraphql,
  bzCount: capturedBz.length,
  graphqlCount: capturedGraphql.length,
};

fs.writeFileSync('/Users/skylar/nuke/fb-bz-capture.json', JSON.stringify(output, null, 2));
console.log(`\nSaved: ${capturedBz.length} bz requests, ${capturedGraphql.length} graphql requests`);

// Print bz request post data
console.log('\n=== BZ REQUEST POST BODIES ===');
capturedBz.forEach((entry, i) => {
  console.log(`\n--- BZ Request ${i+1} ---`);
  console.log(`URL: ${entry.url.substring(0, 150)}`);
  console.log(`POST DATA: ${(entry.postData || '').substring(0, 1000)}`);
  if (entry.has_marketplace_data) {
    console.log('LISTINGS:', JSON.stringify(entry.extracted_listings?.slice(0, 3)));
  }
  console.log(`Response preview: ${entry.responseBody?.substring(0, 300)}`);
});

console.log('\n=== GRAPHQL REQUESTS ===');
capturedGraphql.forEach((entry, i) => {
  console.log(`\n--- GraphQL ${i+1} ---`);
  console.log(`doc_id: ${entry.doc_id}`);
  console.log(`variables: ${entry.variables}`);
  console.log(`RAW POST: ${entry.postData}`);
});

await browser.close();
