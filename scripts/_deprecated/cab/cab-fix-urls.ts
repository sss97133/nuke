/**
 * C&B URL Fixer
 * Fixes lowercased URLs by searching C&B for the correct case
 */

import { chromium, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function searchCAB(page: Page, query: string): Promise<string | null> {
  try {
    await page.goto(`https://carsandbids.com/search?q=${encodeURIComponent(query)}`, {
      waitUntil: 'load',
      timeout: 30000
    });

    // Wait for Cloudflare
    for (let i = 0; i < 10; i++) {
      const title = await page.title();
      if (!title.includes('Just a moment')) break;
      await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(2000);

    // Get first auction link
    const links = await page.$$eval('a[href*="/auctions/"]', els =>
      els.map(e => e.getAttribute('href')).filter(h => h && h.match(/\/auctions\/[^/]+\/\d{4}-/))
    );

    if (links.length > 0) {
      return `https://carsandbids.com${links[0].split('?')[0]}`;
    }
    return null;
  } catch (error) {
    return null;
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║              C&B URL FIXER                               ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // Get all C&B vehicles to check/fix URLs
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, discovery_url')
    .like('discovery_url', '%carsandbids%')
    .order('created_at', { ascending: false })
    .limit(500);

  console.log(`Found ${vehicles?.length || 0} vehicles to check\n`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });
  const page = await context.newPage();

  // Warm up
  await page.goto('https://carsandbids.com', { waitUntil: 'load' });
  await page.waitForTimeout(5000);

  let fixed = 0, notFound = 0;

  for (const v of vehicles || []) {
    // Always use make/model/year - VIN search doesn't work well on C&B
    const query = `${v.year} ${v.make} ${v.model}`;
    console.log(`[${fixed + notFound + 1}/${vehicles?.length}] ${v.year} ${v.make} ${v.model}`);
    console.log(`  Searching: ${query.substring(0, 40)}...`);

    const newUrl = await searchCAB(page, query);

    if (newUrl && newUrl !== v.discovery_url) {
      console.log(`  ✅ Found: ${newUrl}`);

      // Update URL
      await supabase.from('vehicles').update({
        discovery_url: newUrl,
        updated_at: new Date().toISOString(),
      }).eq('id', v.id);

      fixed++;
    } else if (newUrl) {
      console.log(`  ⏭️ URL unchanged`);
    } else {
      console.log(`  ❌ Not found on C&B`);
      notFound++;
    }

    await page.waitForTimeout(2000);
  }

  await browser.close();

  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`  Fixed: ${fixed} | Not Found: ${notFound}`);
}

main().catch(console.error);
