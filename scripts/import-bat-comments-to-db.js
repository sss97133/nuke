#!/usr/bin/env node
/**
 * Import BaT comments from scraped JSON into database
 * Creates bat_users, bat_listings, and bat_comments records
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Error: SUPABASE key not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const INPUT_FILE = path.join(process.cwd(), 'viva-bat-listings.json');

async function importBatData() {
  console.log('🚀 Importing BaT data to database...\n');
  
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`❌ File not found: ${INPUT_FILE}`);
    console.log('   Run scrape-viva-bat-listings.js first to generate the data file');
    process.exit(1);
  }
  
  const listings = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
  console.log(`📋 Found ${listings.length} listings to import\n`);
  
  let importedListings = 0;
  let importedComments = 0;
  let importedUsers = 0;
  
  for (const listing of listings) {
    try {
      // 1. Get or create BaT users for seller and buyer
      let sellerBatUserId = null;
      let buyerBatUserId = null;
      
      if (listing.seller) {
        const { data: sellerUser } = await supabase.rpc('get_or_create_bat_user', {
          p_username: listing.seller,
          p_profile_url: null,
          p_display_name: listing.seller
        });
        sellerBatUserId = sellerUser;
        if (sellerUser) importedUsers++;
      }
      
      if (listing.buyer) {
        const { data: buyerUser } = await supabase.rpc('get_or_create_bat_user', {
          p_username: listing.buyer,
          p_profile_url: null,
          p_display_name: listing.buyer
        });
        buyerBatUserId = buyerUser;
        if (buyerUser) importedUsers++;
      }
      
      // 2. Find or create vehicle by URL or title
      let vehicleId = null;
      if (listing.url) {
        // Try to find existing vehicle with this BaT URL
        const { data: existingVehicle } = await supabase
          .from('vehicles')
          .select('id')
          .eq('bat_listing_url', listing.url)
          .single();
        
        if (existingVehicle) {
          vehicleId = existingVehicle.id;
        } else {
          // Try to match by title/year/make/model
          if (listing.year && listing.make && listing.model) {
            const { data: matchedVehicle } = await supabase
              .from('vehicles')
              .select('id')
              .eq('year', listing.year)
              .ilike('make', `%${listing.make}%`)
              .ilike('model', `%${listing.model}%`)
              .limit(1)
              .single();
            
            if (matchedVehicle) {
              vehicleId = matchedVehicle.id;
            }
          }
        }
      }
      
      // 3. Find organization (Viva Las Vegas Autos)
      let organizationId = null;
      const { data: org } = await supabase
        .from('businesses')
        .select('id')
        .ilike('business_name', '%Viva%Las%Vegas%')
        .limit(1)
        .single();
      
      if (org) {
        organizationId = org.id;
      }
      
      // 4. Create or update bat_listing
      const listingData = {
        bat_listing_url: listing.url,
        bat_lot_number: listing.lot_number,
        bat_listing_title: listing.title,
        vehicle_id: vehicleId,
        organization_id: organizationId,
        auction_start_date: listing.auction_start_date,
        auction_end_date: listing.auction_end_date || listing.sale_date,
        sale_date: listing.sale_date || listing.auction_end_date,
        sale_price: listing.sale_price,
        seller_username: listing.seller,
        buyer_username: listing.buyer,
        seller_bat_user_id: sellerBatUserId,
        buyer_bat_user_id: buyerBatUserId,
        listing_status: listing.sale_price ? 'sold' : 'ended',
        raw_data: listing,
        scraped_at: listing.scraped_at || new Date().toISOString()
      };
      
      const { data: batListing, error: listingError } = await supabase
        .from('bat_listings')
        .upsert(listingData, {
          onConflict: 'bat_listing_url',
          ignoreDuplicates: false
        })
        .select()
        .single();
      
      if (listingError) {
        console.error(`   ❌ Error creating listing: ${listingError.message}`);
        continue;
      }
      
      if (batListing) {
        importedListings++;
        console.log(`   ✅ Listing: ${listing.title}`);
      }
      
      // 5. Import comments
      if (listing.comments && Array.isArray(listing.comments) && listing.comments.length > 0) {
        for (const comment of listing.comments) {
          if (!comment.username || !comment.text || comment.text.length < 10) {
            continue; // Skip invalid comments
          }
          
          // Get or create BaT user for commenter
          const { data: commenterUserId } = await supabase.rpc('get_or_create_bat_user', {
            p_username: comment.username,
            p_profile_url: comment.user_url || null,
            p_display_name: comment.username
          });
          
          if (commenterUserId) importedUsers++;
          
          // Parse timestamp
          let commentTimestamp = new Date().toISOString();
          if (comment.timestamp) {
            try {
              const parsed = new Date(comment.timestamp);
              if (!isNaN(parsed.getTime())) {
                commentTimestamp = parsed.toISOString();
              }
            } catch {}
          }
          
          // Create comment record
          const commentData = {
            bat_listing_id: batListing.id,
            vehicle_id: vehicleId,
            bat_user_id: commenterUserId,
            bat_username: comment.username,
            comment_text: comment.text,
            comment_timestamp: commentTimestamp,
            bat_comment_id: comment.id,
            comment_url: comment.user_url ? `${comment.user_url}#comment-${comment.id}` : null,
            is_seller_comment: comment.username === listing.seller,
            metadata: {
              scraped_at: listing.scraped_at,
              index: comment.index
            }
          };
          
          const { error: commentError } = await supabase
            .from('bat_comments')
            .insert(commentData);
          
          if (commentError) {
            console.error(`     ⚠️  Comment error: ${commentError.message}`);
          } else {
            importedComments++;
          }
        }
        
        if (listing.comments.length > 0) {
          console.log(`     💬 ${listing.comments.length} comments imported`);
        }
      }
      
    } catch (error) {
      console.error(`   ❌ Error processing ${listing.title}:`, error.message);
    }
  }
  
  console.log(`\n✅ Import complete!`);
  console.log(`   - Listings: ${importedListings}`);
  console.log(`   - Comments: ${importedComments}`);
  console.log(`   - BaT Users: ${importedUsers}`);
}

importBatData().catch(console.error);

