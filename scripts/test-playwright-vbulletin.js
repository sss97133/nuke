#!/usr/bin/env node
import { chromium } from 'playwright';

const TEST_URL = 'https://rennlist.com/forums/911-forum-56/';

async function testDirectFetch() {
  console.log('\n=== DIRECT FETCH TEST ===');
  console.log('URL:', TEST_URL);

  try {
    const response = await fetch(TEST_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    console.log('Status:', response.status);
    console.log('Content-Type:', response.headers.get('content-type'));

    const html = await response.text();
    console.log('HTML length:', html.length);

    // Count thread_title_ links using regex
    const threadPattern = /id="thread_title_(\d+)"/g;
    const matches = [...html.matchAll(threadPattern)];
    console.log('thread_title_ matches:', matches.length);

    // Check for bot detection indicators
    if (html.includes('Checking your browser')) {
      console.log('⚠️  Bot detection: "Checking your browser" found');
    }
    if (html.includes('cloudflare')) {
      console.log('⚠️  Bot detection: Cloudflare detected');
    }
    if (html.includes('captcha')) {
      console.log('⚠️  Bot detection: CAPTCHA detected');
    }

    // Show a snippet
    if (matches.length > 0) {
      console.log('Sample thread IDs:', matches.slice(0, 5).map(m => m[1]).join(', '));
    } else {
      console.log('HTML snippet (first 500 chars):', html.slice(0, 500));
    }

    return matches.length;
  } catch (error) {
    console.log('Error:', error.message);
    return 0;
  }
}

async function testPlaywright() {
  console.log('\n=== PLAYWRIGHT TEST ===');
  console.log('URL:', TEST_URL);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    const response = await page.goto(TEST_URL, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    console.log('Status:', response?.status());

    // Wait for content to load
    await page.waitForTimeout(2000);

    const html = await page.content();
    console.log('HTML length:', html.length);

    // Count thread_title_ links using regex
    const threadPattern = /id="thread_title_(\d+)"/g;
    const matches = [...html.matchAll(threadPattern)];
    console.log('thread_title_ matches:', matches.length);

    // Also try querySelector approach
    const threadLinks = await page.$$eval('a[id^="thread_title_"]', links =>
      links.map(l => ({ id: l.id, text: l.textContent?.slice(0, 50), href: l.href }))
    );
    console.log('querySelectorAll matches:', threadLinks.length);

    if (threadLinks.length > 0) {
      console.log('\nSample threads found:');
      for (const t of threadLinks.slice(0, 5)) {
        console.log(`  - ${t.text}...`);
        console.log(`    ${t.href}`);
      }
    }

    return threadLinks.length;
  } catch (error) {
    console.log('Error:', error.message);
    return 0;
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log('Testing vBulletin forum extraction: Direct Fetch vs Playwright\n');
  console.log('=' .repeat(70));

  const directCount = await testDirectFetch();
  const playwrightCount = await testPlaywright();

  console.log('\n' + '=' .repeat(70));
  console.log('\n=== RESULTS ===');
  console.log(`Direct Fetch:  ${directCount} threads found`);
  console.log(`Playwright:    ${playwrightCount} threads found`);

  if (playwrightCount > directCount) {
    console.log(`\n✅ PLAYWRIGHT WINS: Found ${playwrightCount - directCount} more threads!`);
    console.log('Playwright can bypass bot detection and render JavaScript.');
  } else if (playwrightCount === directCount && directCount > 0) {
    console.log('\n✓ Both methods work equally well for this forum.');
  } else if (playwrightCount === 0 && directCount === 0) {
    console.log('\n❌ Neither method found threads. Site may be blocking all requests.');
  }
}

main();
