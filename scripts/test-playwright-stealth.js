#!/usr/bin/env node
import { chromium } from 'playwright';

const TEST_URL = 'https://rennlist.com/forums/911-forum-56/';

async function testPlaywrightStealth() {
  console.log('=== PLAYWRIGHT STEALTH TEST ===');
  console.log('URL:', TEST_URL);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  // Override navigator properties to look less like automation
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  });

  const page = await context.newPage();

  try {
    console.log('Navigating...');
    const response = await page.goto(TEST_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    console.log('Status:', response?.status());

    // Wait for content
    await page.waitForTimeout(3000);

    const html = await page.content();
    console.log('HTML length:', html.length);

    // Check for thread links
    const threadPattern = /id="thread_title_(\d+)"/g;
    const matches = [...html.matchAll(threadPattern)];
    console.log('thread_title_ matches:', matches.length);

    if (matches.length === 0) {
      // Show what we got
      console.log('\nPage title:', await page.title());
      console.log('HTML snippet:', html.slice(0, 500));
    } else {
      const threadLinks = await page.$$eval('a[id^="thread_title_"]', links =>
        links.map(l => ({ text: l.textContent?.slice(0, 60), href: l.href }))
      );
      console.log('\nSample threads:');
      for (const t of threadLinks.slice(0, 5)) {
        console.log(`  - ${t.text}`);
      }
    }

    return matches.length;
  } catch (error) {
    console.log('Error:', error.message);
    return 0;
  } finally {
    await browser.close();
  }
}

async function testPlaywrightHeaded() {
  console.log('\n=== PLAYWRIGHT HEADED TEST ===');
  console.log('URL:', TEST_URL);

  const browser = await chromium.launch({
    headless: false,  // Visible browser
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  try {
    const response = await page.goto(TEST_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    console.log('Status:', response?.status());
    await page.waitForTimeout(3000);

    const html = await page.content();
    console.log('HTML length:', html.length);

    const threadPattern = /id="thread_title_(\d+)"/g;
    const matches = [...html.matchAll(threadPattern)];
    console.log('thread_title_ matches:', matches.length);

    if (matches.length > 0) {
      console.log('✅ Headed mode works!');
    }

    return matches.length;
  } catch (error) {
    console.log('Error:', error.message);
    return 0;
  } finally {
    await browser.close();
  }
}

async function main() {
  const stealthCount = await testPlaywrightStealth();

  if (stealthCount === 0) {
    console.log('\nStealth mode failed. Testing headed mode (visible browser)...');
    const headedCount = await testPlaywrightHeaded();

    console.log('\n=== CONCLUSION ===');
    if (headedCount > 0 && stealthCount === 0) {
      console.log('Site detects headless browsers specifically.');
      console.log('Options:');
      console.log('  1. Use direct fetch (works from non-datacenter IPs)');
      console.log('  2. Use a proxy service with residential IPs');
      console.log('  3. Use Browserless.io or similar for headless with stealth');
    }
  } else {
    console.log('\n✅ Stealth mode works! Found', stealthCount, 'threads');
  }
}

main();
