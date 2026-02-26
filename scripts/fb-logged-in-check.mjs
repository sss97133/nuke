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

const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  viewport: { width: 1440, height: 900 },
});
await context.addCookies(cookies);
const page = await context.newPage();

const capturedGraphQL = [];
const pendingRequests = new Map();
const client = await context.newCDPSession(page);
await client.send('Network.enable');

client.on('Network.requestWillBeSent', (params) => {
  const { requestId, request } = params;
  const url = request.url;
  if (request.method === 'POST' && url.includes('/api/graphql')) {
    const postData = request.postData;
    pendingRequests.set(requestId, { url, postData });
    console.log(`\n[GRAPHQL POST] ${url}`);
    console.log(`  postData: ${(postData || '').substring(0, 500)}`);
  }
});

client.on('Network.responseReceived', async (params) => {
  const { requestId } = params;
  const req = pendingRequests.get(requestId);
  if (!req) return;
  try {
    const bodyResp = await client.send('Network.getResponseBody', { requestId });
    const body = bodyResp.body;
    const urlParams = new URLSearchParams(req.postData || '');
    const docId = urlParams.get('doc_id');
    const variablesRaw = urlParams.get('variables');
    let variables = null;
    try { variables = JSON.parse(variablesRaw || '{}'); } catch(e) { variables = variablesRaw; }

    const entry = {
      doc_id: docId,
      variables,
      variables_raw: variablesRaw,
      post_data_raw: req.postData,
      response_preview: body.substring(0, 2000),
    };
    capturedGraphQL.push(entry);
    console.log(`  doc_id: ${docId}`);
    console.log(`  vars: ${variablesRaw?.substring(0, 200)}`);
    console.log(`  response: ${body.substring(0, 300)}`);
    pendingRequests.delete(requestId);
  } catch(e) {}
});

console.log('Navigating with cookies...');
await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

// Check login state from page
const userIdInPage = await page.evaluate(() => {
  // Check if logged in
  const loginLinks = document.querySelectorAll('a[href*="login"]');
  const logoutLinks = document.querySelectorAll('a[href*="logout"]');
  return {
    loginLinkCount: loginLinks.length,
    logoutLinkCount: logoutLinks.length,
    title: document.title,
    url: location.href,
  };
});
console.log('Page state:', userIdInPage);

// Check for login upsell / banner
const hasLoginPrompt = await page.evaluate(() => {
  const text = document.body.innerText;
  return {
    hasLoginBanner: text.includes('Log in') || text.includes('Sign up'),
    hasMarketplaceListings: text.includes('$') || text.includes('mile'),
  };
});
console.log('Login/listing state:', hasLoginPrompt);

// Take a screenshot
await page.screenshot({ path: '/Users/skylar/nuke/fb-marketplace-screenshot.png', fullPage: false });
console.log('Screenshot saved');

// Try to find the "See more" button or pagination trigger
const moreButton = await page.$('text="See more"');
const loadMoreText = await page.$('[aria-label*="more"]');
console.log('See more button:', moreButton ? 'FOUND' : 'not found');
console.log('Load more:', loadMoreText ? 'FOUND' : 'not found');

// Wait for user to scroll - but since headless: false, let's do it manually
console.log('\nScrolling slowly...');
for (let i = 0; i < 15; i++) {
  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(1000);

  // Check for GraphQL calls each scroll
  if (capturedGraphQL.length > 0) {
    console.log(`GraphQL request captured after scroll ${i+1}!`);
    break;
  }
}

// Wait more
console.log('Waiting for additional requests...');
await page.waitForTimeout(8000);

// Save results
fs.writeFileSync('/Users/skylar/nuke/fb-logged-in-check.json', JSON.stringify({
  capturedGraphQL,
  pageState: userIdInPage,
  loginState: hasLoginPrompt,
}, null, 2));

console.log(`\nTotal GraphQL requests: ${capturedGraphQL.length}`);
capturedGraphQL.forEach((e, i) => {
  console.log(`\n=== GraphQL ${i+1} ===`);
  console.log(`doc_id: ${e.doc_id}`);
  console.log(`variables: ${JSON.stringify(e.variables, null, 2)}`);
  console.log(`RAW POST:\n${e.post_data_raw}`);
});

await browser.close();
