#!/usr/bin/env node
/**
 * Backfill comments from origin_metadata to auction_comments table
 * For vehicle: 69f35ba1-00d3-4b63-8406-731d226c45e1
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });
dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const vehicleId = '69f35ba1-00d3-4b63-8406-731d226c45e1';

async function backfillComments() {
  try {
    console.log(`\n🔧 Backfilling comments for vehicle: ${vehicleId}\n`);

    // Step 1: Get vehicle data
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('id, discovery_url, origin_metadata, sale_price, winning_bid')
      .eq('id', vehicleId)
      .single();

    if (vehicleError) throw vehicleError;
    if (!vehicle) {
      console.error('❌ Vehicle not found');
      process.exit(1);
    }

    const listingUrl = vehicle.discovery_url;
    if (!listingUrl) {
      console.error('❌ No discovery_url found');
      process.exit(1);
    }

    // Step 2: Extract comments from origin_metadata
    const comments = vehicle.origin_metadata?.comments || [];
    if (!Array.isArray(comments) || comments.length === 0) {
      console.log('⚠️  No comments found in origin_metadata');
      process.exit(0);
    }

    console.log(`📝 Found ${comments.length} comments in origin_metadata`);

    // Step 3: Create or get auction_event
    const platform = listingUrl.includes('carsandbids.com') ? 'carsandbids' : 
                     listingUrl.includes('bringatrailer.com') ? 'bat' : 'unknown';
    
    const { data: existingEvent } = await supabase
      .from('auction_events')
      .select('id')
      .eq('source', platform)
      .eq('source_url', listingUrl)
      .maybeSingle();

    let auctionEventId;
    if (existingEvent?.id) {
      auctionEventId = existingEvent.id;
      console.log(`✅ Found existing auction_event: ${auctionEventId}`);
    } else {
      // Create new auction_event
      const { data: externalListing } = await supabase
        .from('external_listings')
        .select('final_price, current_bid, listing_status, end_date')
        .eq('vehicle_id', vehicleId)
        .maybeSingle();

      const outcome = vehicle.sale_price ? 'sold' : 
                     (externalListing?.listing_status === 'ended' ? 'ended' : 'active');

      const eventData = {
        source: platform,
        source_url: listingUrl,
        vehicle_id: vehicleId,
        outcome: outcome,
        high_bid: vehicle.winning_bid || externalListing?.current_bid || null,
        reserve_price: null,
        comments_count: comments.length,
      };

      // Only add date fields if they exist
      if (externalListing?.end_date) {
        eventData.auction_end_date = externalListing.end_date;
      }

      // Try to find existing event first
      const { data: existing } = await supabase
        .from('auction_events')
        .select('id')
        .eq('source', platform)
        .eq('source_url', listingUrl)
        .maybeSingle();

      let newEvent;
      if (existing?.id) {
        newEvent = existing;
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from('auction_events')
          .insert(eventData)
          .select('id')
          .single();
        
        if (insertError) {
          console.error(`❌ Failed to create auction_event: ${insertError.message}`);
          process.exit(1);
        }
        newEvent = inserted;
      }

      if (eventError) {
        console.error(`❌ Failed to create auction_event: ${eventError.message}`);
        process.exit(1);
      }

      auctionEventId = newEvent.id;
      console.log(`✅ Created auction_event: ${auctionEventId}`);
    }

    // Step 4: Store comments in auction_comments table
    const commentsToInsert = comments
      .filter((c) => c.text && c.text.trim().length > 10) // Filter out junk
      .map((c, idx) => ({
        auction_event_id: auctionEventId,
        vehicle_id: vehicleId,
        platform: platform,
        source_url: listingUrl,
        sequence_number: idx + 1,
        posted_at: c.timestamp ? new Date(c.timestamp).toISOString() : new Date().toISOString(),
        author_username: c.author || 'Unknown',
        is_seller: c.is_seller || false,
        comment_type: c.is_bid ? 'bid' : (c.is_seller ? 'seller_response' : 'observation'),
        comment_text: c.text || '',
        word_count: (c.text || '').split(/\s+/).length,
        bid_amount: c.bid_amount || (c.is_bid && c.text ? parseFloat(c.text.match(/\$([0-9,]+)/)?.[1]?.replace(/,/g, '') || '0') : null),
        has_question: (c.text || '').includes('?'),
      }));

    if (commentsToInsert.length === 0) {
      console.log('⚠️  No valid comments to insert');
      process.exit(0);
    }

    console.log(`💾 Inserting ${commentsToInsert.length} comments...`);

    // Insert in batches
    const batchSize = 20;
    let inserted = 0;
    for (let i = 0; i < commentsToInsert.length; i += batchSize) {
      const batch = commentsToInsert.slice(i, i + batchSize);
      // Use insert with ignore duplicates instead of upsert
      const { error: commentError } = await supabase
        .from('auction_comments')
        .insert(batch);

      if (commentError) {
        console.error(`❌ Failed to insert comment batch ${i / batchSize + 1}: ${commentError.message}`);
      } else {
        inserted += batch.length;
        console.log(`   ✅ Inserted batch ${i / batchSize + 1} (${batch.length} comments)`);
      }
    }

    console.log(`\n✨ Successfully backfilled ${inserted} comments!\n`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

backfillComments();

