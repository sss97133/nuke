#!/usr/bin/env npx tsx
/**
 * Local Playwright fetcher - bypasses Firecrawl
 * Usage: npx tsx scripts/playwright-fetch.ts <url>
 */

import { chromium } from 'playwright';

async function fetchWithPlaywright(url: string): Promise<{ html: string; title: string }> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for content to load
    await page.waitForTimeout(2000);

    const html = await page.content();
    const title = await page.title();

    return { html, title };
  } finally {
    await browser.close();
  }
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: npx tsx scripts/playwright-fetch.ts <url>');
    process.exit(1);
  }

  console.error(`Fetching: ${url}`);
  const start = Date.now();

  try {
    const { html, title } = await fetchWithPlaywright(url);
    const elapsed = Date.now() - start;

    console.error(`Title: ${title}`);
    console.error(`HTML length: ${html.length}`);
    console.error(`Time: ${elapsed}ms`);

    // Output HTML to stdout for piping
    console.log(html);
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
