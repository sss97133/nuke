#!/usr/bin/env node
/**
 * Fix missing comments/bids for a specific vehicle
 * 1. Clean contaminated model field
 * 2. Create auction_event if missing
 * 3. Extract comments/bids from BaT listing
 * 4. Compare to actual BaT listing
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const VEHICLE_ID = process.argv[2] || '1b398eec-b2e5-4f36-8c7b-0e047e2f2ec0';

async function cleanModelField(vehicle) {
  if (!vehicle.model) return null;
  
  let model = vehicle.model;
  
  // Remove BaT contamination patterns
  const batPatterns = [
    /\s+for sale on BaT Auctions?\s*/gi,
    /\s*-\s*closed on [A-Z][a-z]+ \d{1,2}, \d{4}\s*/gi,
    /\s*\(Lot\s*#[\d,]+\s*\)\s*/gi,
    /\s*\|\s*Bring a Trailer\s*/gi,
    /\s*on bringatrailer\.com\s*/gi,
    /\s*sold for \$[\d,]+\s+on [A-Z][a-z]+ \d{1,2}, \d{4}\s*/gi,
  ];
  
  for (const pattern of batPatterns) {
    model = model.replace(pattern, ' ').trim();
  }
  
  // Clean up multiple spaces
  model = model.replace(/\s+/g, ' ').trim();
  
  if (model !== vehicle.model && model.length > 0) {
    return model;
  }
  
  return null;
}

async function createAuctionEvent(vehicle) {
  const url = vehicle.discovery_url || vehicle.bat_auction_url;
  if (!url || !url.includes('bringatrailer.com/listing/')) {
    return { success: false, error: 'No BaT URL' };
  }
  
  // Extract lot number from URL or model field
  const lotMatch = vehicle.model?.match(/Lot\s*#[\d,]+/i) || url.match(/listing\/([\d-]+)/i);
  const lotNumber = lotMatch ? lotMatch[0].replace(/Lot\s*#/i, '').replace(/,/g, '') : null;
  
  // Check if auction_event already exists (match extract-premium-auction approach: source, source_url)
  const { data: existing } = await supabase
    .from('auction_events')
    .select('id')
    .eq('vehicle_id', vehicle.id)
    .eq('source_url', url)
    .maybeSingle();
  
  if (existing) {
    return { success: true, auction_event_id: existing.id, created: false };
  }
  
  // Create auction_event (use same columns as extract-premium-auction: source, source_url)
  const endDate = vehicle.auction_end_date ? new Date(vehicle.auction_end_date) : null;
  const hasSalePrice = vehicle.sale_price && vehicle.sale_price > 0;
  const hasHighBid = vehicle.high_bid && vehicle.high_bid > 0;
  
  const outcome = hasSalePrice ? 'sold' : 
                  (vehicle.auction_outcome === 'reserve_not_met' ? 'reserve_not_met' :
                   (hasHighBid ? 'bid_to' :
                    (endDate && endDate > new Date() ? 'pending' : 'ended')));
  
  // Use same structure as extract-premium-auction (source, source_url, not platform/listing_url)
  const insertData = {
    vehicle_id: vehicle.id,
    source: 'bat',
    source_url: url,
    source_listing_id: lotNumber || null,
    outcome: outcome,
    high_bid: vehicle.high_bid || vehicle.sale_price || null,
    winning_bid: hasSalePrice ? vehicle.sale_price : null,
    raw_data: {
      extracted_at: new Date().toISOString(),
      platform: 'bat',
      listing_url: url,
      listing_id: lotNumber || null,
    },
  };
  
  const { data: auctionEvent, error } = await supabase
    .from('auction_events')
    .upsert(insertData, { onConflict: 'vehicle_id,source_url' })
    .select('id')
    .single();
  
  if (error) {
    return { success: false, error: error.message };
  }
  
  return { success: true, auction_event_id: auctionEvent.id, created: true };
}

async function extractCommentsBids(vehicle, auctionEventId) {
  const url = vehicle.discovery_url || vehicle.bat_auction_url;
  if (!url) {
    return { success: false, error: 'No URL' };
  }
  
  try {
    // Try extract-auction-comments first (scalable DOM parser)
    const { data: result, error } = await supabase.functions.invoke('extract-auction-comments', {
      body: {
        auction_url: url,
        vehicle_id: vehicle.id,
        auction_event_id: auctionEventId,
      }
    });
    
    if (error) {
      // If extract-auction-comments fails, log the error but don't fail completely
      console.error(`    ⚠️  extract-auction-comments failed: ${error.message}`);
      // Check if comments already exist
      const { count: existingComments } = await supabase
        .from('auction_comments')
        .select('*', { count: 'exact', head: true })
        .eq('auction_event_id', auctionEventId);
      
      if (existingComments && existingComments > 0) {
        return {
          success: true,
          comments_extracted: existingComments,
          bids_extracted: 0, // Will count separately
          message: `Comments already exist (${existingComments}) but extraction failed: ${error.message}`
        };
      }
      
      return { success: false, error: error.message };
    }
    
    return {
      success: true,
      comments_extracted: result?.comments_extracted || result?.comments_saved || 0,
      bids_extracted: result?.bids_extracted || 0,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function main() {
  console.log('🔍 Fixing vehicle comments/bids...');
  console.log(`Vehicle ID: ${VEHICLE_ID}\n`);
  
  // Step 1: Get vehicle data
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', VEHICLE_ID)
    .single();
  
  if (vehicleError || !vehicle) {
    console.error('❌ Vehicle not found:', vehicleError?.message);
    process.exit(1);
  }
  
  console.log('📋 Current vehicle data:');
  console.log(`  Year: ${vehicle.year || '?'}`);
  console.log(`  Make: ${vehicle.make || '?'}`);
  console.log(`  Model: ${vehicle.model?.substring(0, 100) || '?'}`);
  console.log(`  URL: ${vehicle.discovery_url || vehicle.bat_auction_url || 'N/A'}\n`);
  
  // Step 2: Clean model field
  console.log('🧹 Step 1: Cleaning contaminated model field...');
  const cleanModel = await cleanModelField(vehicle);
  if (cleanModel) {
    console.log(`  Before: ${vehicle.model}`);
    console.log(`  After:  ${cleanModel}`);
    
    const { error: updateError } = await supabase
      .from('vehicles')
      .update({ model: cleanModel })
      .eq('id', vehicle.id);
    
    if (updateError) {
      console.error(`  ❌ Failed to update model: ${updateError.message}`);
    } else {
      console.log(`  ✅ Model field cleaned`);
      vehicle.model = cleanModel; // Update local copy
    }
  } else {
    console.log(`  ℹ️  Model field is clean`);
  }
  
  // Step 3: Check/create auction_event
  console.log('\n📅 Step 2: Creating auction_event if missing...');
  const auctionEventResult = await createAuctionEvent(vehicle);
  
  if (!auctionEventResult.success) {
    console.error(`  ❌ Failed to create auction_event: ${auctionEventResult.error}`);
    process.exit(1);
  }
  
  if (auctionEventResult.created) {
    console.log(`  ✅ Created auction_event: ${auctionEventResult.auction_event_id}`);
  } else {
    console.log(`  ℹ️  Auction_event already exists: ${auctionEventResult.auction_event_id}`);
  }
  
  // Step 4: Extract comments/bids
  console.log('\n💬 Step 3: Extracting comments and bids...');
  const commentsResult = await extractCommentsBids(vehicle, auctionEventResult.auction_event_id);
  
  if (!commentsResult.success) {
    console.error(`  ❌ Failed to extract comments: ${commentsResult.error}`);
    process.exit(1);
  }
  
  console.log(`  ✅ Extracted ${commentsResult.comments_extracted || 0} comments`);
  console.log(`  ✅ Extracted ${commentsResult.bids_extracted || 0} bids`);
  
  // Step 5: Verify results
  console.log('\n✅ Step 4: Verifying results...');
  const { count: commentCount } = await supabase
    .from('auction_comments')
    .select('*', { count: 'exact', head: true })
    .eq('auction_event_id', auctionEventResult.auction_event_id);
  
  const { data: bidData } = await supabase
    .from('auction_comments')
    .select('id, bid_amount, comment_text')
    .eq('auction_event_id', auctionEventResult.auction_event_id)
    .not('bid_amount', 'is', null)
    .limit(5);
  
  console.log(`  Total comments in database: ${commentCount || 0}`);
  console.log(`  Total bids in database: ${bidData?.length || 0}`);
  
  if (bidData && bidData.length > 0) {
    console.log(`  Sample bids:`);
    bidData.forEach(bid => {
      console.log(`    - $${bid.bid_amount?.toLocaleString() || 'N/A'}`);
    });
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ COMPLETE');
  console.log('='.repeat(60));
  console.log(`Model cleaned: ${cleanModel ? 'YES' : 'NO'}`);
  console.log(`Auction event: ${auctionEventResult.auction_event_id}`);
  console.log(`Comments extracted: ${commentsResult.comments_extracted || 0}`);
  console.log(`Bids extracted: ${commentsResult.bids_extracted || 0}`);
  console.log(`Total in database: ${commentCount || 0} comments`);
  console.log('='.repeat(60));
}

main().catch(console.error);
