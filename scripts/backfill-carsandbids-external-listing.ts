/**
 * Backfill external_listings for a specific Cars & Bids vehicle
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function backfillCarsAndBidsListing(vehicleId: string) {
  console.log(`🔍 Backfilling external_listings for vehicle ${vehicleId}...\n`);

  // Get vehicle data
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id, discovery_url, sale_price, sale_status, auction_outcome, auction_end_date, origin_organization_id')
    .eq('id', vehicleId)
    .single();

  if (vehicleError || !vehicle) {
    console.error('❌ Error fetching vehicle:', vehicleError);
    return;
  }

  if (!vehicle.discovery_url || !vehicle.discovery_url.includes('carsandbids.com')) {
    console.error('❌ Vehicle is not a Cars & Bids vehicle');
    return;
  }

  // Extract listing ID from URL: /auctions/r4M5pvy9/... -> r4M5pvy9
  const listingIdMatch = vehicle.discovery_url.match(/\/auctions\/([^\/]+)/);
  if (!listingIdMatch || !listingIdMatch[1]) {
    console.error('❌ Could not extract listing ID from URL');
    return;
  }

  const listingId = listingIdMatch[1];

  // Get Cars & Bids organization
  const { data: org } = await supabase
    .from('businesses')
    .select('id')
    .ilike('business_name', '%cars%bid%')
    .limit(1)
    .maybeSingle();

  const orgId = org?.id || vehicle.origin_organization_id;

  if (!orgId) {
    console.error('❌ Could not find Cars & Bids organization');
    return;
  }

  // Determine listing status
  let listingStatus = 'ended';
  if (vehicle.auction_end_date) {
    const endDate = new Date(vehicle.auction_end_date);
    if (endDate > new Date()) {
      listingStatus = 'active';
    } else if (vehicle.auction_outcome === 'sold' || vehicle.sale_status === 'sold') {
      listingStatus = 'sold';
    }
  } else if (vehicle.auction_outcome === 'sold' || vehicle.sale_status === 'sold') {
    listingStatus = 'sold';
  } else if (vehicle.sale_price && vehicle.sale_price > 0 && vehicle.sale_status === 'available') {
    // High bid but not sold
    listingStatus = 'ended';
  }

  // Create external_listings record
  const { error: insertError } = await supabase
    .from('external_listings')
    .upsert({
      vehicle_id: vehicle.id,
      organization_id: orgId,
      platform: 'cars_and_bids',
      listing_url: vehicle.discovery_url,
      listing_id: listingId,
      listing_status: listingStatus,
      current_bid: vehicle.sale_price && vehicle.sale_status === 'available' ? vehicle.sale_price : null,
      final_price: vehicle.sale_status === 'sold' ? vehicle.sale_price : null,
      sold_at: vehicle.sale_status === 'sold' && vehicle.sale_price ? new Date().toISOString() : null,
      end_date: vehicle.auction_end_date ? new Date(vehicle.auction_end_date).toISOString() : null,
      metadata: {
        source: 'backfill_script',
        listing_id: listingId,
      },
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'vehicle_id,platform,listing_id',
    });

  if (insertError) {
    console.error('❌ Error creating listing:', insertError.message);
    return;
  }

  console.log('✅ External listing created successfully!');
  console.log(`   Platform: cars_and_bids`);
  console.log(`   Listing ID: ${listingId}`);
  console.log(`   Status: ${listingStatus}`);
  console.log(`   Current Bid: ${vehicle.sale_price || 'N/A'}`);
}

const vehicleId = '69f35ba1-00d3-4b63-8406-731d226c45e1';
backfillCarsAndBidsListing(vehicleId).catch(console.error);

