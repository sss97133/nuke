#!/usr/bin/env node
import { chromium } from 'playwright';
import fs from 'fs';

const url = 'https://collectingcars.com/for-sale';

async function captureTypesense() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  });

  const page = await context.newPage();

  let typesenseRequest = null;
  let typesenseResponse = null;

  page.on('request', request => {
    const url = request.url();
    if (url.includes('dora.production.collecting.com/multi_search')) {
      typesenseRequest = {
        url: url,
        method: request.method(),
        headers: request.headers(),
        postData: request.postData()
      };
    }
  });

  page.on('response', async response => {
    const url = response.url();
    if (url.includes('dora.production.collecting.com/multi_search')) {
      try {
        const body = await response.json();
        typesenseResponse = body;
      } catch (e) {
        console.log('Could not parse JSON response');
      }
    }
  });

  console.log('Loading Collecting Cars listings page...');
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);

  if (typesenseRequest) {
    console.log('\n=== TYPESENSE REQUEST ===');
    console.log('URL:', typesenseRequest.url);
    console.log('Method:', typesenseRequest.method);
    console.log('\nPOST Data:');
    const postData = JSON.parse(typesenseRequest.postData);
    console.log(JSON.stringify(postData, null, 2));

    // Save to file for analysis
    fs.writeFileSync('/Users/skylar/nuke/.claude/typesense-request.json', JSON.stringify(postData, null, 2));
  }

  if (typesenseResponse) {
    console.log('\n=== TYPESENSE RESPONSE ===');
    console.log('Results count:', typesenseResponse.results?.[0]?.found || 0);
    console.log('Hits count:', typesenseResponse.results?.[0]?.hits?.length || 0);

    // Save full response
    fs.writeFileSync('/Users/skylar/nuke/.claude/typesense-response.json', JSON.stringify(typesenseResponse, null, 2));

    // Show first listing
    if (typesenseResponse.results?.[0]?.hits?.[0]) {
      const firstHit = typesenseResponse.results[0].hits[0];
      console.log('\n=== FIRST LISTING SAMPLE ===');
      console.log(JSON.stringify(firstHit.document, null, 2));
    }

    console.log('\n✅ Full data saved to:');
    console.log('  - /Users/skylar/nuke/.claude/typesense-request.json');
    console.log('  - /Users/skylar/nuke/.claude/typesense-response.json');
  }

  await browser.close();
}

captureTypesense().catch(console.error);
