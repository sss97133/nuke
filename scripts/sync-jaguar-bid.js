#!/usr/bin/env node
/**
 * Sync Jaguar BAT listing to get current bid
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Error: SUPABASE_SERVICE_ROLE_KEY not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const JAGUAR_LISTING_ID = 'a8675e59-682d-42fa-98e3-03d9f00ea3ee';
const JAGUAR_BAT_URL = 'https://bringatrailer.com/listing/1964-jaguar-xke-series-1-roadster-5/';

async function syncJaguarBid() {
  console.log('🔄 Syncing Jaguar XKE bid data...\n');
  console.log(`URL: ${JAGUAR_BAT_URL}\n`);

  // Fetch the BAT page
  const response = await fetch(JAGUAR_BAT_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; N-Zero/1.0)',
      'Accept': 'text/html,application/xhtml+xml'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status}`);
  }

  const html = await response.text();

  // Extract current bid - multiple patterns
  let currentBid = null;
  const bidPatterns = [
    /Current Bid[^>]*>.*?USD\s*\$?([\d,]+)/i,
    /<strong[^>]*class="info-value"[^>]*>USD\s*\$?([\d,]+)<\/strong>/i,
    /Current Bid[^>]*>.*?\$([\d,]+)/i,
    /"price":\s*(\d+)/i,  // JSON-LD schema
    /data-listing-currently[^>]*>.*?\$([\d,]+)/i
  ];
  
  for (const pattern of bidPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      currentBid = parseInt(match[1].replace(/,/g, ''));
      console.log(`✅ Found bid: $${currentBid.toLocaleString()}`);
      break;
    }
  }

  // Extract bid count
  let bidCount = 0;
  const bidCountPatterns = [
    /(\d+)\s+bids?/i,
    /number-bids-value[^>]*>(\d+)/i,
    /"bidCount":\s*(\d+)/i
  ];
  
  for (const pattern of bidCountPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      bidCount = parseInt(match[1]);
      console.log(`✅ Found bid count: ${bidCount}`);
      break;
    }
  }

  // Extract watcher count
  const watcherMatch = html.match(/(\d+)\s+watchers?/i);
  const watcherCount = watcherMatch ? parseInt(watcherMatch[1]) : null;

  // Extract view count
  const viewMatch = html.match(/([\d,]+)\s+views?/i);
  const viewCount = viewMatch ? parseInt(viewMatch[1].replace(/,/g, '')) : null;

  // Check if auction ended
  const endedMatch = html.match(/Auction Ended/i);
  const isEnded = endedMatch !== null;

  // Check if sold
  const soldMatch = html.match(/Sold (?:for|to).*?\$([\d,]+)/i);
  const finalPrice = soldMatch ? parseInt(soldMatch[1].replace(/,/g, '')) : null;

  const newStatus = finalPrice ? 'sold' : (isEnded ? 'ended' : 'active');

  // Update the listing
  const { error: updateError } = await supabase
    .from('external_listings')
    .update({
      current_bid: currentBid,
      bid_count: bidCount,
      watcher_count: watcherCount,
      view_count: viewCount,
      listing_status: newStatus,
      final_price: finalPrice,
      sold_at: finalPrice ? new Date().toISOString() : null,
      last_synced_at: new Date().toISOString()
    })
    .eq('id', JAGUAR_LISTING_ID);

  if (updateError) {
    throw updateError;
  }

  console.log(`\n✅ Updated listing in database!`);
  console.log(`   Current Bid: $${(currentBid || 0).toLocaleString()}`);
  console.log(`   Bid Count: ${bidCount}`);
  console.log(`   Watchers: ${watcherCount || 'N/A'}`);
  console.log(`   Views: ${viewCount || 'N/A'}`);
  console.log(`   Status: ${newStatus}`);
}

syncJaguarBid()
  .then(() => {
    console.log('\n✅ Sync complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });

