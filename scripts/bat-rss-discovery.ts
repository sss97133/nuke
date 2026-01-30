#!/usr/bin/env npx tsx
/**
 * BaT RSS Feed Discovery
 *
 * Fetches the BaT RSS feed and queues any new listing URLs.
 * Run periodically to capture new listings as they're posted.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  BaT RSS FEED DISCOVERY');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Fetch RSS feed
  const response = await fetch('https://bringatrailer.com/feed/', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });

  if (!response.ok) {
    console.error('Failed to fetch RSS:', response.status);
    return;
  }

  const xml = await response.text();

  // Extract listing URLs
  const urlRegex = /https:\/\/bringatrailer\.com\/listing\/[^<\s"]+/g;
  const matches = xml.match(urlRegex) || [];
  const uniqueUrls = [...new Set(matches)].filter(url =>
    url.includes('/listing/') && !url.endsWith('/feed/')
  );

  console.log(`Found ${uniqueUrls.length} unique listing URLs in RSS feed\n`);

  // Check which are new
  const newUrls: string[] = [];
  for (const url of uniqueUrls) {
    const { count } = await supabase
      .from('vehicles')
      .select('id', { count: 'exact', head: true })
      .eq('bat_auction_url', url);

    const { count: queueCount } = await supabase
      .from('import_queue')
      .select('id', { count: 'exact', head: true })
      .eq('listing_url', url);

    if (count === 0 && queueCount === 0) {
      newUrls.push(url);
    }
  }

  console.log(`New URLs to queue: ${newUrls.length}\n`);

  // Queue new URLs
  if (newUrls.length > 0) {
    const records = newUrls.map(url => ({
      listing_url: url,
      status: 'pending',
      priority: 2, // Higher priority for new listings
      raw_data: { source: 'rss_feed', discovered_at: new Date().toISOString() },
    }));

    const { error } = await supabase
      .from('import_queue')
      .upsert(records, { onConflict: 'listing_url', ignoreDuplicates: true });

    if (error) {
      console.error('Queue error:', error.message);
    } else {
      console.log('Queued URLs:');
      newUrls.forEach(url => {
        console.log(`  + ${url.split('/listing/')[1]?.replace(/\/$/, '')}`);
      });
    }
  } else {
    console.log('No new URLs to queue - all already tracked.');
  }

  console.log('\n═══════════════════════════════════════════════════════════');
}

main().catch(console.error);
