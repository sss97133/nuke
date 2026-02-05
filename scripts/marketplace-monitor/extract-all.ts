#!/usr/bin/env npx tsx

/**
 * Extract full details from all FB Marketplace listings before they disappear
 */

import { chromium, BrowserContext, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function extractListing(page: Page, url: string): Promise<any> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Get the full page content
    const content = await page.content();

    // Extract from meta tags (more reliable)
    const title = await page.$eval('meta[property="og:title"]', el => el.getAttribute('content')).catch(() => null);
    const description = await page.$eval('meta[property="og:description"]', el => el.getAttribute('content')).catch(() => null);
    const image = await page.$eval('meta[property="og:image"]', el => el.getAttribute('content')).catch(() => null);

    // Try to get price from page
    const priceText = await page.$eval('[data-testid="marketplace_pdp_price"]', el => el.textContent).catch(() => null);

    // Get all images
    const images = await page.$$eval('img[src*="fbcdn"]', imgs =>
      imgs.map(img => img.src).filter(src => src.includes('marketplace'))
    ).catch(() => []);

    // Get seller info
    const sellerName = await page.$eval('[data-testid="marketplace_pdp_seller_name"]', el => el.textContent).catch(() => null);

    return {
      title,
      description,
      image,
      images,
      priceText,
      sellerName,
      extracted: true,
      extractedAt: new Date().toISOString(),
    };
  } catch (e: any) {
    return { error: e.message, extracted: false };
  }
}

async function main() {
  console.log('🚀 Starting bulk extraction...');

  // Get unextracted listings
  const { data: listings, error } = await supabase
    .from('marketplace_listings')
    .select('id, url, title')
    .is('description', null)
    .limit(200);

  if (error || !listings?.length) {
    console.log('No listings to extract or error:', error);
    return;
  }

  console.log(`📋 Found ${listings.length} listings to extract`);

  // Launch browser with separate session
  const context = await chromium.launchPersistentContext('./fb-session-extractor', {
    headless: true,
    viewport: { width: 1280, height: 800 },
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });

  const page = await context.newPage();
  let extracted = 0;

  for (const listing of listings) {
    console.log(`⏳ Extracting: ${listing.title?.slice(0, 50)}...`);

    const data = await extractListing(page, listing.url);

    if (data.extracted) {
      await supabase
        .from('marketplace_listings')
        .update({
          description: data.description,
          seller_name: data.sellerName,
          // Store additional data in a jsonb column if available
        })
        .eq('id', listing.id);

      extracted++;
      console.log(`✅ Extracted (${extracted}/${listings.length})`);
    } else {
      console.log(`❌ Failed: ${data.error}`);
    }

    // Human-like delay
    await page.waitForTimeout(1000 + Math.random() * 2000);
  }

  await context.close();
  console.log(`\n🎉 Done! Extracted ${extracted}/${listings.length} listings`);
}

main().catch(console.error);
