#!/usr/bin/env npx tsx
/**
 * Scrape ALL square body trucks by clicking through pagination
 */

import { chromium, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const CATEGORIES = [
  { name: 'Chevrolet C/K 1973-1991', url: 'https://bringatrailer.com/chevrolet/ck-1973-1991/', pages: 28 },
  { name: 'GMC C/K 1973-1991', url: 'https://bringatrailer.com/gmc/ck-1973-1991/', pages: 7 },
];

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function extractUrls(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const urls: string[] = [];
    document.querySelectorAll('a[href*="/listing/"]').forEach(a => {
      const href = (a as HTMLAnchorElement).href.replace(/\/$/, '');
      if (href.includes('bringatrailer.com/listing/') && !urls.includes(href)) {
        urls.push(href);
      }
    });
    return urls;
  });
}

async function scrapeCategory(page: Page, cat: typeof CATEGORIES[0]): Promise<string[]> {
  console.log(`\n📦 ${cat.name} (${cat.pages} pages)`);

  await page.goto(cat.url, { waitUntil: 'networkidle', timeout: 60000 });
  await sleep(2000);

  const allUrls = new Set<string>();

  // Get page 1
  let urls = await extractUrls(page);
  urls.forEach(u => allUrls.add(u));
  console.log(`  Page 1: ${urls.length} URLs (total: ${allUrls.size})`);

  // Click through pagination
  for (let pageNum = 2; pageNum <= cat.pages; pageNum++) {
    try {
      // Look for page number link or next button
      const pageLink = await page.$(`a[data-page="${pageNum}"], [data-page="${pageNum}"]`);
      const nextButton = await page.$('a:has-text("Next"), button:has-text("Next"), .pagination-next');

      const clickTarget = pageLink || nextButton;

      if (clickTarget) {
        await clickTarget.click();
        await sleep(1500);

        urls = await extractUrls(page);
        const before = allUrls.size;
        urls.forEach(u => allUrls.add(u));

        console.log(`  Page ${pageNum}: ${urls.length} URLs, ${allUrls.size - before} new (total: ${allUrls.size})`);
      } else {
        // Try clicking in the pagination area
        const pagination = await page.$('.auctions-completed-toolbar, .pagination');
        if (pagination) {
          // Find and click page numbers
          const pageNums = await page.$$('.auctions-completed-toolbar a, .pagination a');
          for (const pn of pageNums) {
            const text = await pn.textContent();
            if (text && text.trim() === String(pageNum)) {
              await pn.click();
              await sleep(1500);

              urls = await extractUrls(page);
              urls.forEach(u => allUrls.add(u));
              console.log(`  Page ${pageNum}: ${allUrls.size} total`);
              break;
            }
          }
        }
      }
    } catch (err: any) {
      console.log(`  Page ${pageNum} error: ${err.message}`);
    }
  }

  console.log(`  Total: ${allUrls.size} URLs`);
  return Array.from(allUrls);
}

async function main() {
  console.log('🚛 BAT PAGINATION SCRAPER');
  console.log('=========================');
  console.log('Target: 651 Chevy + 162 GMC = 813\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  const allUrls: string[] = [];

  try {
    for (const cat of CATEGORIES) {
      const urls = await scrapeCategory(page, cat);
      allUrls.push(...urls);
    }
  } finally {
    await browser.close();
  }

  const unique = [...new Set(allUrls)];
  console.log(`\n📊 TOTAL: ${unique.length} unique URLs`);

  // Queue to database
  console.log('\nQueuing to database...');

  const { data: existing } = await supabase
    .from('import_queue')
    .select('listing_url')
    .ilike('listing_url', '%bringatrailer%');

  const existingSet = new Set((existing || []).map(e => e.listing_url?.replace(/\/$/, '')));

  const newUrls = unique.filter(u => !existingSet.has(u));
  console.log(`New URLs: ${newUrls.length}`);

  if (newUrls.length > 0) {
    const records = newUrls.map(url => ({
      listing_url: url,
      status: 'pending',
      priority: 30,
      raw_data: { source: 'bat_paginate_scraper', discovered_at: new Date().toISOString() },
    }));

    const batchSize = 100;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const { error } = await supabase
        .from('import_queue')
        .upsert(batch, { onConflict: 'listing_url', ignoreDuplicates: true });

      if (!error) {
        console.log(`  Queued batch ${Math.floor(i/batchSize)+1}: ${batch.length}`);
      }
    }
  }

  console.log('\n🏁 Done!');
}

main().catch(console.error);
