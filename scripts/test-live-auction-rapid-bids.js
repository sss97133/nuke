#!/usr/bin/env node
/**
 * Test script to simulate rapid bids on a live auction
 * Tests timer extension behavior for live_auction type listings
 * 
 * Usage:
 *   node scripts/test-live-auction-rapid-bids.js <listing_id> [options]
 * 
 * Options:
 *   --bids <count>     Number of bids to place (default: 5)
 *   --delay <ms>       Delay between bids in milliseconds (default: 2000)
 *   --user <user_id>   User ID to bid as (default: current auth user)
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  console.error('   Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local');
  process.exit(1);
}

const args = process.argv.slice(2);
const listingId = args[0];
const bidCount = parseInt(args[args.indexOf('--bids') + 1] || '5');
const delayMs = parseInt(args[args.indexOf('--delay') + 1] || '2000');
const userId = args[args.indexOf('--user') + 1];

if (!listingId) {
  console.error('❌ Missing listing_id argument');
  console.error('\nUsage: node scripts/test-live-auction-rapid-bids.js <listing_id> [options]');
  console.error('\nOptions:');
  console.error('  --bids <count>     Number of bids to place (default: 5)');
  console.error('  --delay <ms>        Delay between bids in milliseconds (default: 2000)');
  console.error('  --user <user_id>   User ID to bid as (uses service key if not provided)');
  process.exit(1);
}

// Use service key if no user specified (for testing)
const supabase = createClient(
  SUPABASE_URL,
  userId ? SUPABASE_ANON_KEY : (SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY),
  {
    auth: userId ? undefined : {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

async function getListingDetails(listingId) {
  const { data, error } = await supabase
    .from('vehicle_listings')
    .select('*, vehicles(id, year, make, model)')
    .eq('id', listingId)
    .single();

  if (error) throw error;
  return data;
}

async function placeBid(listingId, currentBid, bidderId = null) {
  const minBid = currentBid + Math.max(100, Math.floor(currentBid * 0.05)); // 5% increment or $1, whichever is higher
  const proxyMax = minBid + 1000; // Proxy bid slightly higher

  const params = {
    p_listing_id: listingId,
    p_proxy_max_bid_cents: proxyMax,
    p_ip_address: '127.0.0.1',
    p_user_agent: 'test-script/rapid-bids',
    p_bid_source: 'test'
  };

  // If using service key, we need to impersonate a user or use RPC directly
  if (bidderId) {
    // Set auth context (would need service key for this)
    const { data, error } = await supabase.rpc('place_auction_bid', params);
    return { data, error };
  } else {
    // Use service key to call RPC
    const { data, error } = await supabase.rpc('place_auction_bid', params);
    return { data, error };
  }
}

async function getTimerExtensions(listingId) {
  const { data, error } = await supabase
    .from('auction_timer_extensions')
    .select('*')
    .eq('listing_id', listingId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString('en-US', { 
    hour12: false, 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit',
    fractionalSecondDigits: 3
  });
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

async function main() {
  console.log('🧪 Live Auction Rapid Bid Test');
  console.log('='.repeat(60));
  console.log(`Listing ID: ${listingId}`);
  console.log(`Bids to place: ${bidCount}`);
  console.log(`Delay between bids: ${delayMs}ms`);
  console.log('');

  try {
    // Get initial listing state
    console.log('📋 Fetching initial listing state...');
    const initialListing = await getListingDetails(listingId);
    
    if (initialListing.sale_type !== 'live_auction') {
      console.warn(`⚠️  Warning: Listing is type '${initialListing.sale_type}', not 'live_auction'`);
      console.warn('   Timer extension behavior may differ.');
    }

    const vehicle = initialListing.vehicles;
    const vehicleName = vehicle 
      ? `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim()
      : 'Unknown Vehicle';

    console.log(`Vehicle: ${vehicleName}`);
    console.log(`Current bid: $${(initialListing.current_high_bid_cents || 0) / 100}`);
    console.log(`Bid count: ${initialListing.bid_count || 0}`);
    console.log(`End time: ${formatTime(initialListing.auction_end_time)}`);
    console.log(`Status: ${initialListing.status}`);
    console.log('');

    const startTime = new Date(initialListing.auction_end_time);
    const initialExtensions = await getTimerExtensions(listingId);
    console.log(`Existing timer extensions: ${initialExtensions.length}`);
    console.log('');

    // Place bids
    console.log('🎯 Placing bids...');
    console.log('-'.repeat(60));
    
    let currentBid = initialListing.current_high_bid_cents || 0;
    const results = [];

    for (let i = 1; i <= bidCount; i++) {
      console.log(`\nBid ${i}/${bidCount}:`);
      
      const beforeBid = await getListingDetails(listingId);
      const beforeEndTime = new Date(beforeBid.auction_end_time);
      const beforeBidAmount = beforeBid.current_high_bid_cents || 0;

      const { data, error } = await placeBid(listingId, currentBid, userId);
      
      if (error) {
        console.error(`  ❌ Error: ${error.message}`);
        results.push({ bid: i, success: false, error: error.message });
        continue;
      }

      if (!data?.success) {
        console.error(`  ❌ Failed: ${data?.error || 'Unknown error'}`);
        results.push({ bid: i, success: false, error: data?.error });
        continue;
      }

      // Wait a moment for DB to update
      await new Promise(resolve => setTimeout(resolve, 500));

      const afterBid = await getListingDetails(listingId);
      const afterEndTime = new Date(afterBid.auction_end_time);
      const afterBidAmount = afterBid.current_high_bid_cents || 0;
      const timeAdded = Math.floor((afterEndTime - beforeEndTime) / 1000);

      console.log(`  ✅ Bid placed: $${(data.displayed_bid_cents || 0) / 100}`);
      console.log(`  📊 New high bid: $${afterBidAmount / 100}`);
      console.log(`  ⏰ End time: ${formatTime(afterBid.auction_end_time)}`);
      
      if (data.auction_extended) {
        console.log(`  🔄 Timer extended: +${formatDuration(data.extension_seconds || timeAdded)}`);
        console.log(`     Old: ${formatTime(beforeBid.auction_end_time)}`);
        console.log(`     New: ${formatTime(afterBid.auction_end_time)}`);
      } else {
        console.log(`  ⚠️  Timer NOT extended (expected for live_auction type)`);
      }

      currentBid = afterBidAmount;
      results.push({ 
        bid: i, 
        success: true, 
        extended: data.auction_extended,
        extensionSeconds: data.extension_seconds || timeAdded,
        newBid: afterBidAmount
      });

      if (i < bidCount) {
        console.log(`  ⏳ Waiting ${delayMs}ms before next bid...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));

    const finalListing = await getListingDetails(listingId);
    const finalExtensions = await getTimerExtensions(listingId);
    const newExtensions = finalExtensions.slice(0, bidCount); // Most recent should match our bids

    console.log(`\nFinal state:`);
    console.log(`  High bid: $${(finalListing.current_high_bid_cents || 0) / 100}`);
    console.log(`  Bid count: ${finalListing.bid_count || 0}`);
    console.log(`  End time: ${formatTime(finalListing.auction_end_time)}`);
    console.log(`  Timer extensions logged: ${newExtensions.length}`);

    const successfulBids = results.filter(r => r.success);
    const extendedBids = results.filter(r => r.success && r.extended);
    
    console.log(`\nBid results:`);
    console.log(`  Successful: ${successfulBids.length}/${bidCount}`);
    console.log(`  Extended timer: ${extendedBids.length}/${successfulBids.length}`);

    if (extendedBids.length > 0) {
      const avgExtension = extendedBids.reduce((sum, r) => sum + (r.extensionSeconds || 0), 0) / extendedBids.length;
      console.log(`  Average extension: ${formatDuration(Math.round(avgExtension))}`);
    }

    console.log(`\nRecent timer extensions:`);
    newExtensions.slice(0, 5).forEach((ext, idx) => {
      console.log(`  ${idx + 1}. ${formatTime(ext.created_at)} - ${ext.extension_type} (+${formatDuration(ext.extension_seconds)})`);
    });

    if (successfulBids.length === bidCount && extendedBids.length === successfulBids.length) {
      console.log('\n✅ All tests passed! Timer extensions working correctly.');
    } else if (successfulBids.length < bidCount) {
      console.log('\n⚠️  Some bids failed. Check errors above.');
    } else {
      console.log('\n⚠️  Some bids did not extend timer. Check listing configuration.');
    }

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
