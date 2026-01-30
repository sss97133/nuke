#!/usr/bin/env npx tsx
/**
 * Inspect BaT page structure to find the correct button selector
 */

import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });
  const page = await context.newPage();

  console.log('Navigating to BaT results...');
  await page.goto('https://bringatrailer.com/auctions/results/', {
    waitUntil: 'networkidle',
    timeout: 60000,
  });

  // Wait for content
  await page.waitForTimeout(3000);

  // Find all buttons
  const buttons = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, [role="button"], a.btn, .button'));
    return btns.map(b => ({
      tag: b.tagName,
      text: b.textContent?.trim().slice(0, 50),
      classes: b.className,
      id: b.id,
    }));
  });

  console.log('\nButtons found:');
  buttons.forEach((b, i) => {
    console.log(`  ${i + 1}. <${b.tag}> "${b.text}" class="${b.classes}" id="${b.id}"`);
  });

  // Look for pagination/load more elements
  const pagination = await page.evaluate(() => {
    const selectors = [
      '.load-more', '.show-more', '.pagination', '.auctions-footer',
      '[data-action*="load"]', '[data-action*="more"]',
      'button:not([type="submit"])', '.auctions-list button',
    ];
    const results: any[] = [];
    for (const sel of selectors) {
      const els = Array.from(document.querySelectorAll(sel));
      els.forEach(el => {
        results.push({
          selector: sel,
          tag: el.tagName,
          text: el.textContent?.trim().slice(0, 100),
          classes: el.className,
        });
      });
    }
    return results;
  });

  console.log('\nPagination elements:');
  pagination.forEach((p, i) => {
    console.log(`  ${i + 1}. [${p.selector}] <${p.tag}> "${p.text?.slice(0, 40)}" class="${p.classes}"`);
  });

  // Count listings
  const listingCount = await page.evaluate(() => {
    return document.querySelectorAll('a[href*="/listing/"]').length;
  });
  console.log(`\nListings visible: ${listingCount}`);

  // Take screenshot for debugging
  await page.screenshot({ path: '/tmp/bat-results-page.png', fullPage: false });
  console.log('\nScreenshot saved to /tmp/bat-results-page.png');

  await browser.close();
}

main().catch(console.error);
