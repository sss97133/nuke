#!/usr/bin/env node
/**
 * Test comprehensive BaT extraction on a specific vehicle
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

async function testExtraction() {
  const batUrl = 'https://bringatrailer.com/listing/1989-chrysler-tc-18/';
  const vehicleId = 'ddb227f5-681f-497d-a381-de79e5252d40';
  
  console.log('🧪 TESTING COMPREHENSIVE BAT EXTRACTION\n');
  console.log(`Vehicle: 1989 Chrysler TC`);
  console.log(`URL: ${batUrl}`);
  console.log(`Vehicle ID: ${vehicleId}\n`);
  console.log('='.repeat(60));
  
  try {
    const { data, error } = await supabase.functions.invoke('comprehensive-bat-extraction', {
      body: { batUrl, vehicleId }
    });
    
    if (error) {
      console.error('❌ Error:', error);
      return;
    }
    
    if (!data || !data.success) {
      console.error('❌ Extraction failed:', data);
      return;
    }
    
    console.log('\n✅ EXTRACTION RESULTS:\n');
    console.log(JSON.stringify(data.data, null, 2));
    
    // Check what was updated in the database
    console.log('\n' + '='.repeat(60));
    console.log('📊 DATABASE UPDATES:\n');
    
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('*')
      .eq('id', vehicleId)
      .single();
    
    if (vehicle) {
      console.log('Vehicle Data:');
      console.log(`  VIN: ${vehicle.vin || 'MISSING'}`);
      console.log(`  Mileage: ${vehicle.mileage || 'Not specified'}`);
      console.log(`  Color: ${vehicle.color || 'Not specified'}`);
      console.log(`  Transmission: ${vehicle.transmission || 'Not specified'}`);
      console.log(`  Engine: ${vehicle.engine_size || 'Not specified'}`);
      console.log(`  Drivetrain: ${vehicle.drivetrain || 'Not specified'}`);
      console.log(`  Sale Price: ${vehicle.sale_price ? '$' + vehicle.sale_price.toLocaleString() : 'Not specified'}`);
      console.log(`  BAT Bids: ${vehicle.bat_bids || 0}`);
      console.log(`  BAT Views: ${vehicle.bat_views || 0}`);
    }
    
    // Check timeline events
    console.log('\n' + '='.repeat(60));
    console.log('📅 TIMELINE EVENTS CREATED:\n');
    
    const { data: timelineEvents } = await supabase
      .from('timeline_events')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .in('event_type', ['auction_listed', 'auction_started', 'auction_bid_placed', 'auction_reserve_met', 'auction_ended', 'auction_sold'])
      .order('event_date', { ascending: true });
    
    if (timelineEvents && timelineEvents.length > 0) {
      console.log(`Found ${timelineEvents.length} auction timeline events:\n`);
      timelineEvents.forEach((event, i) => {
        console.log(`${i + 1}. ${event.event_type.toUpperCase()}`);
        console.log(`   Date: ${event.event_date}`);
        console.log(`   Title: ${event.title}`);
        console.log(`   Description: ${event.description}`);
        if (event.cost_amount) {
          console.log(`   Amount: $${event.cost_amount.toLocaleString()}`);
        }
        console.log('');
      });
    } else {
      console.log('⚠️  No timeline events found');
    }
    
    // Check external_listing
    console.log('='.repeat(60));
    console.log('🔗 EXTERNAL LISTING:\n');
    
    const { data: listing } = await supabase
      .from('external_listings')
      .select('*')
      .eq('listing_url', batUrl)
      .maybeSingle();
    
    if (listing) {
      console.log(`Listing Status: ${listing.listing_status}`);
      console.log(`Current Bid: ${listing.current_bid ? '$' + listing.current_bid.toLocaleString() : 'N/A'}`);
      console.log(`Final Price: ${listing.final_price ? '$' + listing.final_price.toLocaleString() : 'N/A'}`);
      console.log(`Bid Count: ${listing.bid_count || 0}`);
      console.log(`View Count: ${listing.view_count || 0}`);
      console.log(`Start Date: ${listing.start_date || 'N/A'}`);
      console.log(`End Date: ${listing.end_date || 'N/A'}`);
    } else {
      console.log('⚠️  No external listing found');
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ TEST COMPLETE');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testExtraction().catch(console.error);

