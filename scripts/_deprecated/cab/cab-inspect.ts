// SBX Cars Page Inspector - Find hidden price, VIN, comments, bids data
import { chromium } from 'playwright';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  const testUrl = process.argv[2] || 'https://sbxcars.com/listing/595/2006-ferrari-f430-f1-spider';

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });

  const page = await context.newPage();

  // Capture ALL network responses
  const apiResponses: any[] = [];
  const allRequests: string[] = [];

  page.on('request', request => {
    allRequests.push(request.url());
  });

  page.on('response', async response => {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';

    if (contentType.includes('json') || url.includes('api') || url.includes('graphql')) {
      try {
        const json = await response.json().catch(() => null);
        if (json) {
          apiResponses.push({ url, data: json });
        }
      } catch (e) {}
    }
  });

  console.log('Loading SBX listing:', testUrl);
  await page.goto(testUrl, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  // Get page HTML and look for embedded data
  const html = await page.content();

  // Look for JSON data in script tags
  const scriptData = await page.evaluate(() => {
    const scripts = document.querySelectorAll('script');
    const jsonData: any[] = [];

    scripts.forEach(script => {
      const content = script.textContent || '';
      // Look for JSON objects
      if (content.includes('{') && (
        content.includes('price') ||
        content.includes('bid') ||
        content.includes('vin') ||
        content.includes('VIN') ||
        content.includes('comment') ||
        content.includes('auction')
      )) {
        jsonData.push(content.substring(0, 2000));
      }
    });

    return jsonData;
  });

  // Look for Blazor state
  const blazorState = await page.evaluate(() => {
    // Check for Blazor state in various places
    const state: any = {};

    // Look for __BLAZOR_STATE__ or similar
    const scripts = document.querySelectorAll('script');
    scripts.forEach(script => {
      const content = script.textContent || '';
      if (content.includes('Blazor') || content.includes('blazor')) {
        state.blazorScript = content.substring(0, 500);
      }
    });

    // Check window object for data
    const windowKeys = Object.keys(window).filter(k =>
      k.toLowerCase().includes('data') ||
      k.toLowerCase().includes('state') ||
      k.toLowerCase().includes('auction')
    );
    state.windowKeys = windowKeys;

    return state;
  });

  // Search page text for key data
  const pageText = await page.evaluate(() => document.body.innerText);

  // Extract potential data patterns
  const vinMatch = pageText.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
  const priceMatches = pageText.match(/\$[\d,]+/g);
  const soldMatch = pageText.match(/sold\s*(?:for)?\s*\$?([\d,]+)/i);

  console.log('\n=== API RESPONSES ===');
  console.log('Total API responses:', apiResponses.length);
  apiResponses.forEach((r, i) => {
    console.log(`\n[${i}] ${r.url}`);
    console.log('Data:', JSON.stringify(r.data).substring(0, 1000));
  });

  console.log('\n=== SCRIPT DATA ===');
  scriptData.forEach((s, i) => {
    console.log(`\n[Script ${i}]:`);
    console.log(s);
  });

  console.log('\n=== BLAZOR STATE ===');
  console.log(JSON.stringify(blazorState, null, 2));

  console.log('\n=== EXTRACTED DATA ===');
  console.log('VIN found:', vinMatch?.[1] || 'Not found');
  console.log('Prices found:', priceMatches?.slice(0, 10) || 'None');
  console.log('Sold for:', soldMatch?.[1] || 'Not found');

  console.log('\n=== PAGE TEXT SAMPLE ===');
  console.log(pageText.substring(0, 3000));

  // Look for comments section
  const commentsSection = await page.evaluate(() => {
    const commentEls = document.querySelectorAll('[class*="comment"], [class*="Comment"], [class*="bid"], [class*="Bid"]');
    return Array.from(commentEls).map(el => ({
      class: el.className,
      text: el.textContent?.substring(0, 200),
    }));
  });

  console.log('\n=== COMMENT/BID ELEMENTS ===');
  console.log(JSON.stringify(commentsSection, null, 2));

  // Check for SignalR/WebSocket connections
  console.log('\n=== NETWORK REQUESTS ===');
  const apiUrls = allRequests.filter(u =>
    u.includes('api') ||
    u.includes('signalr') ||
    u.includes('hub') ||
    u.includes('graphql')
  );
  apiUrls.forEach(u => console.log(u));

  await browser.close();
}

main();
