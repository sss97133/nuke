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

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
});

const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  viewport: { width: 1440, height: 900 },
  locale: 'en-US',
});

await context.addCookies(cookies);
const page = await context.newPage();

// Capture ALL POST requests using CDPSession for raw request body access
const client = await context.newCDPSession(page);
await client.send('Network.enable');

client.on('Network.requestWillBeSentExtraInfo', (params) => {
  // This catches extra request headers including cookies
});

const requestBodies = new Map();

client.on('Network.requestWillBeSent', (params) => {
  const { requestId, request } = params;
  if (request.method === 'POST') {
    const url = request.url;
    const postData = request.postData;
    allPostRequests.push({ url: url.substring(0, 150), postData: postData?.substring(0, 200) });

    if (url.includes('/api/graphql') || url.includes('graphql')) {
      console.log(`\n[CDP GRAPHQL POST] ${url}`);
      if (postData) {
        console.log(`  postData: ${postData.substring(0, 300)}`);
        requestBodies.set(requestId, { url, postData });
      }
    }
  }
});

client.on('Network.responseReceived', async (params) => {
  const { requestId, response } = params;
  const reqData = requestBodies.get(requestId);
  if (reqData) {
    try {
      const responseBody = await client.send('Network.getResponseBody', { requestId });
      const body = responseBody.body;
      console.log(`[CDP RESPONSE] for ${reqData.url.substring(0, 80)}`);
      console.log(`  response: ${body.substring(0, 500)}`);

      const urlParams = new URLSearchParams(reqData.postData);
      const docId = urlParams.get('doc_id');
      const variablesRaw = urlParams.get('variables');
      let variables = null;
      try { variables = JSON.parse(variablesRaw || '{}'); } catch(e) { variables = variablesRaw; }

      let parsedResponse = null;
      try { parsedResponse = JSON.parse(body); } catch(e) {}

      intercepted.push({
        doc_id: docId,
        variables,
        variables_raw: variablesRaw,
        post_data_raw: reqData.postData,
        response: parsedResponse,
        response_raw: body.substring(0, 2000),
      });
      requestBodies.delete(requestId);
    } catch(e) {
      console.log(`  Response body error: ${e.message}`);
    }
  }
});

console.log('Navigating...');
await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
console.log(`Title: ${await page.title()}`);
console.log(`URL: ${page.url()}`);

// Wait for initial load
await page.waitForTimeout(3000);

console.log('\nScrolling to trigger pagination requests...');

// Scroll down aggressively to trigger lazy loading
for (let i = 0; i < 10; i++) {
  await page.evaluate((scrollStep) => {
    window.scrollBy(0, scrollStep);
  }, 800);
  await page.waitForTimeout(800);
  console.log(`Scrolled to step ${i+1}`);
}

// Scroll to bottom
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(3000);

// Scroll more
for (let i = 0; i < 5; i++) {
  await page.evaluate(() => window.scrollBy(0, 1000));
  await page.waitForTimeout(1000);
}

await page.waitForTimeout(5000);

console.log(`\nTotal POST requests observed: ${allPostRequests.length}`);
console.log(`GraphQL requests intercepted: ${intercepted.length}`);
console.log('\nAll POST requests:');
allPostRequests.forEach(r => console.log(`  ${r.url}`));

// Save results
const outputPath = '/Users/skylar/nuke/fb-graphql-scroll-results.json';
fs.writeFileSync(outputPath, JSON.stringify({ intercepted, allPostRequests }, null, 2));
console.log(`\nSaved to: ${outputPath}`);

intercepted.forEach((entry, i) => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Intercepted #${i+1}`);
  console.log(`doc_id: ${entry.doc_id}`);
  console.log(`variables:\n${JSON.stringify(entry.variables, null, 2)}`);
  console.log(`\nRAW POST BODY:\n${entry.post_data_raw}`);
});

await browser.close();
