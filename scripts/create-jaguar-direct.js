#!/usr/bin/env node
/**
 * Directly create Jaguar vehicle and external listing
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
const VIVA_ORG_ID = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf';
const JAGUAR_BAT_URL = 'https://bringatrailer.com/listing/1964-jaguar-xke-series-1-roadster-5/';

async function createJaguar() {
  console.log('🚗 Creating Jaguar XKE vehicle and BAT listing...\n');

  // Step 1: Create vehicle
  const { data: vehicle, error: vError } = await supabase
    .from('vehicles')
    .insert({
      year: 1964,
      make: 'jaguar',
      model: 'xke',
      trim: 'series i 3.8 roadster',
      bat_auction_url: JAGUAR_BAT_URL,
      discovery_url: JAGUAR_BAT_URL,
      discovery_source: 'bat_seller_monitor',
      profile_origin: 'bat_import',
      origin_organization_id: VIVA_ORG_ID,
      origin_metadata: {
        bat_seller: 'VivaLasVegasAutos',
        bat_listing_title: '1964 Jaguar XKE Series I 3.8 Roadster',
        discovered_via: 'manual_import',
        discovered_at: new Date().toISOString()
      },
      is_public: true,
      status: 'active'
    })
    .select('id')
    .single();

  if (vError) {
    console.error('❌ Error creating vehicle:', vError);
    throw vError;
  }

  console.log(`✅ Created vehicle: ${vehicle.id}`);

  // Step 2: Link to organization
  await supabase
    .from('organization_vehicles')
    .upsert({
      organization_id: VIVA_ORG_ID,
      vehicle_id: vehicle.id,
      relationship_type: 'consigner',
      status: 'active',
      auto_tagged: true
    }, {
      onConflict: 'organization_id,vehicle_id'
    });

  console.log('✅ Linked to Viva organization');

  // Step 3: Create external listing
  const { data: listing, error: lError } = await supabase
    .from('external_listings')
    .upsert({
      vehicle_id: vehicle.id,
      organization_id: VIVA_ORG_ID,
      platform: 'bat',
      listing_url: JAGUAR_BAT_URL,
      listing_id: '1964-jaguar-xke-series-1-roadster-5',
      listing_status: 'active',
      sync_enabled: true,
      metadata: {
        seller: 'VivaLasVegasAutos',
        title: '1964 Jaguar XKE Series I 3.8 Roadster',
        discovered_via: 'manual_import'
      }
    }, {
      onConflict: 'vehicle_id,platform,listing_id'
    })
    .select('id, listing_status, sync_enabled')
    .single();

  if (lError) {
    console.error('❌ Error creating external listing:', lError);
    throw lError;
  }

  console.log(`✅ Created external listing: ${listing.id}`);
  console.log(`   Status: ${listing.listing_status}`);
  console.log(`   Sync Enabled: ${listing.sync_enabled}`);

  // Step 4: Sync immediately to get current bid data
  console.log('\n🔄 Syncing listing to get current bid data...');
  const { data: syncData, error: syncError } = await supabase.functions.invoke('sync-bat-listing', {
    body: { externalListingId: listing.id }
  });

  if (syncError) {
    console.log('⚠️  Sync failed (this is OK, will sync automatically):', syncError.message);
  } else {
    console.log('✅ Initial sync complete');
  }

  return { vehicleId: vehicle.id, listingId: listing.id };
}

createJaguar()
  .then(({ vehicleId, listingId }) => {
    console.log(`\n✅ Jaguar XKE is now in the system!`);
    console.log(`   Vehicle ID: ${vehicleId}`);
    console.log(`   Listing ID: ${listingId}`);
    console.log(`   URL: ${JAGUAR_BAT_URL}`);
    console.log(`\n📊 Updates:`);
    console.log(`   • Sync is enabled - will receive automatic bid updates`);
    console.log(`   • Monitor function will check every 6 hours`);
    console.log(`   • Manual sync available via sync-bat-listing function`);
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });

