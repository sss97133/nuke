import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function extractActiveBatListings() {
  console.log('=== ACTIVE BAT EXTRACTION ===\n');

  // Try multiple BaT pages to find listings
  const pages = [
    'https://bringatrailer.com/',
    'https://bringatrailer.com/auctions/results/',
    'https://bringatrailer.com/porsche/',
    'https://bringatrailer.com/mercedes-benz/',
    'https://bringatrailer.com/bmw/',
  ];

  let html = '';
  for (const pageUrl of pages) {
    console.log(`Trying: ${pageUrl}`);
    const response = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      }
    });

    if (response.ok) {
      html += await response.text();
    }
  }

  // Find listing URLs
  const listingMatches = html.match(/href="(https:\/\/bringatrailer\.com\/listing\/[^"]+)"/g);
  const listingUrls = [...new Set(
    (listingMatches || [])
      .map(m => m.match(/href="([^"]+)"/)?.[1])
      .filter(Boolean)
  )] as string[];

  console.log('Found', listingUrls.length, 'listing URLs on active auctions page');

  // Check which are new
  const { data: existing } = await supabase
    .from('vehicles')
    .select('bat_auction_url')
    .in('bat_auction_url', listingUrls.slice(0, 50));

  const existingUrls = new Set((existing || []).map(e => e.bat_auction_url));
  const newUrls = listingUrls.filter(u => existingUrls.has(u) === false);

  console.log('Already have:', existingUrls.size);
  console.log('New listings:', newUrls.length);

  if (newUrls.length === 0) {
    console.log('\nAll active listings already extracted.');
    return;
  }

  console.log('\n=== EXTRACTING NEW LISTINGS ===\n');

  // Extract new listings using extract-bat-core
  let extracted = 0;
  let failed = 0;

  for (const url of newUrls.slice(0, 10)) {
    const slug = url.split('/listing/')[1]?.replace(/\/$/, '') || url;
    console.log(`Extracting: ${slug}...`);

    try {
      const { data, error } = await supabase.functions.invoke('extract-bat-core', {
        body: { url, max_vehicles: 1 }
      });

      if (error) {
        console.log(`  ✗ Error: ${error.message}`);
        failed++;
      } else {
        const created = data?.created_vehicle_ids?.length || 0;
        const updated = data?.updated_vehicle_ids?.length || 0;
        console.log(`  ✓ Created: ${created}, Updated: ${updated}`);
        if (created > 0 || updated > 0) extracted++;
      }
    } catch (err: any) {
      console.log(`  ✗ Exception: ${err?.message}`);
      failed++;
    }
  }

  console.log('\n=== EXTRACTION COMPLETE ===');
  console.log(`Extracted: ${extracted}`);
  console.log(`Failed: ${failed}`);
}

extractActiveBatListings().catch(console.error);
