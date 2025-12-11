#!/usr/bin/env node
/**
 * Show what a complete successful BaT extraction contains
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Error: Supabase service role key not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function showCompleteExtraction() {
  const vehicleId = 'ddb227f5-681f-497d-a381-de79e5252d40';
  
  console.log('📋 COMPLETE BaT EXTRACTION EXAMPLE\n');
  console.log('='.repeat(80));
  
  // Get vehicle data
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .single();
  
  if (!vehicle) {
    console.error('Vehicle not found');
    return;
  }
  
  console.log('\n🚗 VEHICLE PROFILE:\n');
  console.log(`  ID: ${vehicle.id}`);
  console.log(`  Year: ${vehicle.year || 'N/A'}`);
  console.log(`  Make: ${vehicle.make || 'N/A'}`);
  console.log(`  Model: ${vehicle.model || 'N/A'}`);
  console.log(`  VIN: ${vehicle.vin || '❌ MISSING'}`);
  console.log(`  Mileage: ${vehicle.mileage ? vehicle.mileage.toLocaleString() + ' miles' : 'N/A'}`);
  console.log(`  Color: ${vehicle.color || 'N/A'}`);
  console.log(`  Interior Color: ${vehicle.interior_color || 'N/A'}`);
  console.log(`  Engine: ${vehicle.engine_size || 'N/A'}`);
  console.log(`  Transmission: ${vehicle.transmission || 'N/A'}`);
  console.log(`  Drivetrain: ${vehicle.drivetrain || 'N/A'}`);
  console.log(`  Displacement: ${vehicle.displacement || 'N/A'}`);
  
  // Get external listing
  const { data: listing } = await supabase
    .from('external_listings')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .eq('platform', 'bat')
    .maybeSingle();
  
  console.log('\n🔗 AUCTION LISTING DATA:\n');
  if (listing) {
    console.log(`  Platform: ${listing.platform}`);
    console.log(`  Listing URL: ${listing.listing_url}`);
    console.log(`  Listing ID: ${listing.listing_id || 'N/A'}`);
    console.log(`  Status: ${listing.listing_status || 'N/A'}`);
    console.log(`  Start Date: ${listing.start_date ? new Date(listing.start_date).toLocaleDateString() : 'N/A'}`);
    console.log(`  End Date: ${listing.end_date ? new Date(listing.end_date).toLocaleDateString() : 'N/A'}`);
    console.log(`  Sold At: ${listing.sold_at ? new Date(listing.sold_at).toLocaleDateString() : 'N/A'}`);
    console.log(`  Current Bid: ${listing.current_bid ? '$' + listing.current_bid.toLocaleString() : 'N/A'}`);
    console.log(`  Final Price: ${listing.final_price ? '$' + listing.final_price.toLocaleString() : 'N/A'}`);
    console.log(`  Reserve Price: ${listing.reserve_price ? '$' + listing.reserve_price.toLocaleString() : 'N/A'}`);
    console.log(`  Bid Count: ${listing.bid_count || 0}`);
    console.log(`  View Count: ${listing.view_count || 0}`);
    console.log(`  Watcher Count: ${listing.watcher_count || 0}`);
    if (listing.metadata) {
      console.log(`  Seller: ${listing.metadata.seller || 'N/A'}`);
      console.log(`  Buyer: ${listing.metadata.buyer || 'N/A'}`);
      console.log(`  Location: ${listing.metadata.location || 'N/A'}`);
      console.log(`  Lot Number: ${listing.metadata.lot_number || 'N/A'}`);
    }
  } else {
    console.log('  ⚠️  No external listing found');
  }
  
  // Get timeline events
  const { data: timelineEvents } = await supabase
    .from('timeline_events')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .in('event_type', [
      'auction_listed', 
      'auction_started', 
      'auction_bid_placed', 
      'auction_reserve_met',
      'auction_ended', 
      'auction_sold',
      'auction_reserve_not_met'
    ])
    .order('event_date', { ascending: true });
  
  console.log('\n📅 AUCTION TIMELINE EVENTS:\n');
  if (timelineEvents && timelineEvents.length > 0) {
    timelineEvents.forEach((event, i) => {
      console.log(`  ${i + 1}. ${event.event_type.toUpperCase()}`);
      console.log(`     Date: ${event.event_date}`);
      console.log(`     Title: ${event.title}`);
      console.log(`     Description: ${event.description || 'N/A'}`);
      if (event.cost_amount) {
        console.log(`     Amount: $${event.cost_amount.toLocaleString()}`);
      }
      if (event.metadata) {
        if (event.metadata.bid_amount) {
          console.log(`     Bid Amount: $${event.metadata.bid_amount.toLocaleString()}`);
        }
        if (event.metadata.bidder) {
          console.log(`     Bidder: ${event.metadata.bidder}`);
        }
        if (event.metadata.reserve_price) {
          console.log(`     Reserve: $${event.metadata.reserve_price.toLocaleString()}`);
        }
      }
      console.log('');
    });
  } else {
    console.log('  ⚠️  No timeline events found');
  }
  
  // Get data validations
  const { data: validations } = await supabase
    .from('data_validations')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .in('field_name', ['vin', 'sale_price'])
    .order('created_at', { ascending: false });
  
  console.log('\n✅ DATA VALIDATIONS:\n');
  if (validations && validations.length > 0) {
    validations.forEach((val, i) => {
      console.log(`  ${i + 1}. ${val.field_name.toUpperCase()}`);
      console.log(`     Value: ${val.field_value}`);
      console.log(`     Confidence: ${val.confidence_score}%`);
      console.log(`     Source: ${val.source || 'N/A'}`);
      console.log(`     Validated At: ${new Date(val.created_at).toLocaleString()}`);
      console.log('');
    });
  } else {
    console.log('  ⚠️  No data validations found');
  }
  
  // BaT specific fields
  console.log('\n🎯 BaT-SPECIFIC FIELDS:\n');
  console.log(`  BaT Auction URL: ${vehicle.bat_auction_url || 'N/A'}`);
  console.log(`  BaT Seller: ${vehicle.bat_seller || 'N/A'}`);
  console.log(`  BaT Location: ${vehicle.bat_location || 'N/A'}`);
  console.log(`  BaT Bids: ${vehicle.bat_bids || 0}`);
  console.log(`  BaT Views: ${vehicle.bat_views || 0}`);
  console.log(`  Sale Price: ${vehicle.sale_price ? '$' + vehicle.sale_price.toLocaleString() : 'N/A'}`);
  console.log(`  Sale Date: ${vehicle.sale_date ? new Date(vehicle.sale_date).toLocaleDateString() : 'N/A'}`);
  
  console.log('\n' + '='.repeat(80));
  console.log('\n✅ COMPLETE EXTRACTION SUMMARY:\n');
  console.log('A successful BaT extraction includes:');
  console.log('  ✓ VIN from essentials div');
  console.log('  ✓ Auction dates (start, end, sale)');
  console.log('  ✓ Sale price (prioritizing "Sold for" over "Bid to")');
  console.log('  ✓ Auction metrics (bids, views, watchers)');
  console.log('  ✓ Technical specs (engine, transmission, drivetrain, mileage, colors)');
  console.log('  ✓ Seller and buyer information');
  console.log('  ✓ Location data');
  console.log('  ✓ Timeline events (listed, started, ended, sold, bid milestones)');
  console.log('  ✓ External listing record with full metadata');
  console.log('  ✓ Data validations for VIN and sale price');
  console.log('  ✓ Bid history with timestamps (when available)');
  console.log('\n');
}

showCompleteExtraction().catch(console.error);

