#!/usr/bin/env node
import { chromium } from 'playwright';

const url = 'https://collectingcars.com/for-sale';

async function discoverAPI() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  });

  const page = await context.newPage();

  const apiRequests = [];

  // Intercept XHR and fetch requests
  page.on('request', request => {
    const resourceType = request.resourceType();
    const url = request.url();

    // Filter for API calls (XHR, fetch, or JSON responses)
    if (resourceType === 'xhr' || resourceType === 'fetch' || url.includes('/api/')) {
      console.log(`\n📡 ${resourceType.toUpperCase()}: ${url}`);
      console.log('Method:', request.method());

      const headers = request.headers();
      if (headers['authorization']) console.log('Auth header present:', headers['authorization'].substring(0, 30) + '...');

      if (request.method() === 'POST') {
        const postData = request.postData();
        if (postData) {
          console.log('POST Data:', postData.substring(0, 300));
        }
      }

      apiRequests.push({
        url: url,
        method: request.method(),
        type: resourceType,
        headers: headers
      });
    }
  });

  page.on('response', async response => {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';

    // Check for JSON responses
    if (contentType.includes('application/json')) {
      console.log(`\n✅ JSON Response from: ${url}`);
      console.log('Status:', response.status());

      try {
        const body = await response.text();
        const preview = body.substring(0, 1000);
        console.log('Preview:', preview);

        // Try to parse and look for listing data
        if (body.includes('objectID') || body.includes('listing') || body.includes('auction')) {
          console.log('\n⭐ POTENTIAL LISTING DATA FOUND!');
          console.log('Full response length:', body.length);
        }
      } catch (e) {
        console.log('Could not read response body');
      }
    }
  });

  console.log('Loading Collecting Cars listings page...');
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  // Try scrolling to trigger lazy loading
  console.log('\nScrolling to load more content...');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2000);

  console.log('\n\n=== SUMMARY ===');
  console.log(`Total API/XHR requests: ${apiRequests.length}`);

  console.log('\n=== UNIQUE API ENDPOINTS ===');
  const uniqueUrls = [...new Set(apiRequests.map(r => {
    try {
      const u = new URL(r.url);
      return u.origin + u.pathname;
    } catch {
      return r.url;
    }
  }))];

  uniqueUrls.forEach(url => console.log(url));

  await browser.close();
}

discoverAPI().catch(console.error);
