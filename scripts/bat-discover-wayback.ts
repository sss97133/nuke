#!/usr/bin/env npx tsx
/**
 * Discover BaT URLs from Wayback Machine CDX API
 *
 * The CDX API returns all archived URLs matching a pattern.
 * We extract unique listing slugs and queue them.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  BaT WAYBACK MACHINE DISCOVERY');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Load existing URLs
  console.log('Loading existing URLs...');
  const existingUrls = new Set<string>();

  let page = 0;
  while (true) {
    const { data } = await supabase
      .from('vehicles')
      .select('bat_auction_url')
      .not('bat_auction_url', 'is', null)
      .range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    data.forEach(v => {
      if (v.bat_auction_url) {
        const slug = extractSlug(v.bat_auction_url);
        if (slug) existingUrls.add(slug);
      }
    });
    page++;
  }

  page = 0;
  while (true) {
    const { data } = await supabase
      .from('import_queue')
      .select('listing_url')
      .ilike('listing_url', '%bringatrailer%')
      .range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    data.forEach(q => {
      if (q.listing_url) {
        const slug = extractSlug(q.listing_url);
        if (slug) existingUrls.add(slug);
      }
    });
    page++;
  }

  console.log(`Loaded ${existingUrls.size} existing listing slugs\n`);

  // Fetch from Wayback Machine
  console.log('Fetching from Wayback Machine CDX API...');
  const discovered = new Set<string>();
  let offset = 0;
  const batchSize = 10000;

  while (true) {
    const url = `https://web.archive.org/cdx/search/cdx?url=bringatrailer.com/listing/*&output=json&limit=${batchSize}&offset=${offset}&filter=statuscode:200`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.log(`CDX API error: ${response.status}`);
        break;
      }

      const data = await response.json();
      if (!data || data.length <= 1) {
        console.log('No more results from CDX');
        break;
      }

      // First row is header
      const rows = data.slice(1);
      console.log(`Fetched ${rows.length} records (offset ${offset})...`);

      for (const row of rows) {
        const originalUrl = row[2]; // 'original' column
        const slug = extractSlug(originalUrl);
        if (slug && !existingUrls.has(slug)) {
          discovered.add(slug);
        }
      }

      offset += batchSize;

      // Small delay between requests
      await new Promise(r => setTimeout(r, 500));

      // Limit for testing
      if (offset >= 100000) {
        console.log('Reached 100k limit for this run');
        break;
      }
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      break;
    }
  }

  console.log(`\nDiscovered ${discovered.size} new unique listing slugs\n`);

  // Queue new URLs
  if (discovered.size > 0) {
    console.log('Queueing new URLs...');
    const slugs = Array.from(discovered);
    const batchSize = 500;

    for (let i = 0; i < slugs.length; i += batchSize) {
      const batch = slugs.slice(i, i + batchSize);
      const records = batch.map(slug => ({
        listing_url: `https://bringatrailer.com/listing/${slug}/`,
        status: 'pending',
        priority: 1,
        raw_data: { source: 'wayback_discovery' },
      }));

      const { error } = await supabase
        .from('import_queue')
        .upsert(records, { onConflict: 'listing_url', ignoreDuplicates: true });

      if (error) {
        console.error(`Queue error: ${error.message}`);
      } else {
        console.log(`  Queued batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(slugs.length / batchSize)} (${batch.length} URLs)`);
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  DISCOVERY COMPLETE');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`  New URLs discovered: ${discovered.size}`);
}

function extractSlug(url: string): string | null {
  if (!url) return null;
  // Match /listing/SLUG/ or /listing/SLUG
  const match = url.match(/\/listing\/([^\/\?#]+)/);
  if (match && match[1]) {
    // Filter out non-listing patterns
    const slug = match[1].toLowerCase();
    if (slug === '0' || slug.startsWith('page')) return null;
    if (slug.includes('javascript')) return null;
    if (slug.includes('..')) return null;
    return slug;
  }
  return null;
}

main().catch(console.error);
