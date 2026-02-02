#!/usr/bin/env node
import { chromium } from 'playwright';

const url = 'https://collectingcars.com/for-sale';

async function discoverAlgolia() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  });

  const page = await context.newPage();

  const algoliaRequests = [];
  const algoliaResponses = [];

  // Intercept network requests
  page.on('request', request => {
    const url = request.url();
    if (url.includes('algolia')) {
      console.log('\n🔍 Algolia REQUEST:', url);
      console.log('Method:', request.method());
      console.log('Headers:', JSON.stringify(request.headers(), null, 2));

      if (request.method() === 'POST') {
        try {
          const postData = request.postData();
          if (postData) {
            console.log('POST Data:', postData);
          }
        } catch (e) {
          console.log('Could not parse POST data');
        }
      }

      algoliaRequests.push({
        url: url,
        method: request.method(),
        headers: request.headers(),
        postData: request.postData()
      });
    }
  });

  page.on('response', async response => {
    const url = response.url();
    if (url.includes('algolia')) {
      console.log('\n✅ Algolia RESPONSE:', url);
      console.log('Status:', response.status());

      try {
        const body = await response.text();
        console.log('Response preview:', body.substring(0, 500));
        algoliaResponses.push({
          url: url,
          status: response.status(),
          body: body.substring(0, 2000) // First 2k chars
        });
      } catch (e) {
        console.log('Could not read response body');
      }
    }
  });

  console.log('Loading Collecting Cars listings page...');
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  console.log('\n\n=== SUMMARY ===');
  console.log(`Found ${algoliaRequests.length} Algolia requests`);

  if (algoliaRequests.length > 0) {
    console.log('\n=== REQUEST DETAILS ===');
    algoliaRequests.forEach((req, i) => {
      console.log(`\n[${i + 1}] ${req.method} ${req.url}`);

      // Extract app ID and API key from headers
      const appId = req.headers['x-algolia-application-id'] || 'not found';
      const apiKey = req.headers['x-algolia-api-key'] || 'not found';

      console.log('App ID:', appId);
      console.log('API Key:', apiKey);

      if (req.postData) {
        console.log('Query:', req.postData);
      }
    });
  }

  if (algoliaResponses.length > 0) {
    console.log('\n=== RESPONSE SAMPLES ===');
    algoliaResponses.forEach((res, i) => {
      console.log(`\n[${i + 1}] Status ${res.status} - ${res.url}`);
      console.log('Data preview:', res.body);
    });
  }

  await browser.close();
}

discoverAlgolia().catch(console.error);
