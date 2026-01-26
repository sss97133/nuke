#!/usr/bin/env node
/**
 * Setup BaT tables and import data in one script
 * Applies migration if needed, then imports scraped data
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

async function checkTablesExist() {
  const { data, error } = await supabase.rpc('exec_sql', {
    query: `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'bat_listings'
      ) as exists;
    `
  });
  
  // Try direct query instead
  const { error: checkError } = await supabase
    .from('bat_listings')
    .select('id')
    .limit(1);
  
  return !checkError || !checkError.message.includes('does not exist');
}

async function applyMigration() {
  console.log('📦 Applying BaT comment tracking migration...\n');
  
  const migrationPath = path.join(process.cwd(), 'supabase/migrations/20250205_bat_comment_tracking_system.sql');
  
  if (!fs.existsSync(migrationPath)) {
    console.error(`❌ Migration file not found: ${migrationPath}`);
    return false;
  }
  
  const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
  
  // Split by semicolons and execute in chunks
  const statements = migrationSQL
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('COMMENT'));
  
  console.log(`   Executing ${statements.length} SQL statements...`);
  
  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];
    if (statement.length < 10) continue; // Skip very short statements
    
    try {
      // Use RPC if available, otherwise try direct execution
      const { error } = await supabase.rpc('exec_sql', { query: statement + ';' });
      
      if (error) {
        // Try alternative method - some statements might fail if already exist
        if (!error.message.includes('already exists') && 
            !error.message.includes('duplicate') &&
            !error.message.includes('relation') && 
            !error.message.includes('does not exist')) {
          console.error(`   ⚠️  Statement ${i + 1} error: ${error.message.substring(0, 100)}`);
        }
      }
    } catch (e) {
      // Ignore errors for CREATE IF NOT EXISTS statements
      if (!e.message?.includes('already exists')) {
        console.error(`   ⚠️  Statement ${i + 1} error: ${e.message.substring(0, 100)}`);
      }
    }
  }
  
  console.log('   ✅ Migration applied (or tables already exist)\n');
  return true;
}

async function importData() {
  const INPUT_FILE = path.join(process.cwd(), 'viva-bat-listings.json');
  
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`❌ File not found: ${INPUT_FILE}`);
    console.log('   Run scrape-viva-bat-listings.js first to generate the data file');
    return;
  }
  
  const listings = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
  console.log(`📋 Found ${listings.length} listings to import\n`);
  
  let importedListings = 0;
  let importedComments = 0;
  let importedUsers = 0;
  let matchedVehicles = 0;
  
  for (const listing of listings) {
    try {
      // 1. Get or create BaT users
      let sellerBatUserId = null;
      let buyerBatUserId = null;
      
      if (listing.seller) {
        const { data: sellerUser, error: sellerError } = await supabase.rpc('get_or_create_bat_user', {
          p_username: listing.seller,
          p_profile_url: null,
          p_display_name: listing.seller
        });
        if (!sellerError && sellerUser) {
          sellerBatUserId = sellerUser;
          importedUsers++;
        }
      }
      
      if (listing.buyer) {
        const { data: buyerUser, error: buyerError } = await supabase.rpc('get_or_create_bat_user', {
          p_username: listing.buyer,
          p_profile_url: null,
          p_display_name: listing.buyer
        });
        if (!buyerError && buyerUser) {
          buyerBatUserId = buyerUser;
          importedUsers++;
        }
      }
      
      // 2. Find vehicle
      let vehicleId = null;
      if (listing.url) {
        const { data: existingVehicle } = await supabase
          .from('vehicles')
          .select('id')
          .eq('bat_listing_url', listing.url)
          .maybeSingle();
        
        if (existingVehicle) {
          vehicleId = existingVehicle.id;
        }
      }
      
      if (!vehicleId && listing.year && listing.make && listing.model) {
        const cleanMake = listing.make.replace(/^Lingenfelter-Modified\s+/i, '').trim();
        const actualMake = cleanMake.split(/\s+/)[0];
        
        const { data: matchedVehicles } = await supabase
          .from('vehicles')
          .select('id, make, model, year')
          .eq('year', listing.year)
          .ilike('make', `%${actualMake}%`);
        
        if (matchedVehicles && matchedVehicles.length > 0) {
          const modelMatch = matchedVehicles.find(v => 
            v.model && listing.model && 
            (v.model.toLowerCase().includes(listing.model.toLowerCase().split(' ')[0]) ||
             listing.model.toLowerCase().includes(v.model.toLowerCase().split(' ')[0]))
          );
          
          if (modelMatch) {
            vehicleId = modelMatch.id;
            matchedVehicles++;
            console.log(`   🔗 Matched: ${modelMatch.year} ${modelMatch.make} ${modelMatch.model}`);
          } else if (matchedVehicles.length === 1) {
            vehicleId = matchedVehicles[0].id;
            matchedVehicles++;
            console.log(`   🔗 Matched: ${matchedVehicles[0].year} ${matchedVehicles[0].make} ${matchedVehicles[0].model}`);
          }
        }
      }
      
      // Update vehicle with BaT data if found
      if (vehicleId && listing.url) {
        await supabase
          .from('vehicles')
          .update({ 
            bat_listing_url: listing.url,
            bat_sold_price: listing.sale_price,
            bat_sale_date: listing.sale_date || listing.auction_end_date
          })
          .eq('id', vehicleId);
      }
      
      // 3. Find organization
      let organizationId = null;
      const { data: org } = await supabase
        .from('businesses')
        .select('id')
        .ilike('business_name', '%Viva%Las%Vegas%')
        .maybeSingle();
      
      if (org) organizationId = org.id;
      
      // 4. Create bat_listing
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
          onConflict: 'bat_listing_url'
        })
        .select()
        .single();
      
      if (listingError) {
        console.error(`   ❌ Listing error: ${listingError.message}`);
        continue;
      }
      
      if (batListing) {
        importedListings++;
        console.log(`   ✅ ${listing.title.substring(0, 50)}`);
      }
      
      // 5. Import comments
      if (listing.comments && Array.isArray(listing.comments) && listing.comments.length > 0) {
        for (const comment of listing.comments) {
          if (!comment.username || !comment.text || comment.text.length < 10) continue;
          
          const { data: commenterUserId } = await supabase.rpc('get_or_create_bat_user', {
            p_username: comment.username,
            p_profile_url: comment.user_url || null,
            p_display_name: comment.username
          });
          
          if (commenterUserId) importedUsers++;
          
          let commentTimestamp = new Date().toISOString();
          if (comment.timestamp) {
            try {
              const parsed = new Date(comment.timestamp);
              if (!isNaN(parsed.getTime())) commentTimestamp = parsed.toISOString();
            } catch {}
          }
          
          const { error: commentError } = await supabase
            .from('bat_comments')
            .insert({
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
            });
          
          if (!commentError) importedComments++;
        }
        
        if (listing.comments.length > 0) {
          console.log(`     💬 ${listing.comments.length} comments`);
        }
      }
      
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`);
    }
  }
  
  console.log(`\n✅ Import complete!`);
  console.log(`   - Listings: ${importedListings}`);
  console.log(`   - Comments: ${importedComments}`);
  console.log(`   - BaT Users: ${importedUsers}`);
  console.log(`   - Vehicles Matched: ${matchedVehicles}`);
}

async function main() {
  console.log('🚀 Setting up BaT comment tracking system...\n');
  
  // Check if tables exist
  const tablesExist = await checkTablesExist();
  
  if (!tablesExist) {
    console.log('📦 Tables not found, applying migration...\n');
    await applyMigration();
  } else {
    console.log('✅ Tables already exist, skipping migration\n');
  }
  
  // Import data
  await importData();
}

main().catch(console.error);

