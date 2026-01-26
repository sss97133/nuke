/**
 * Backfill external_listings records for existing Mecum vehicles
 * Extracts lot number from URL and creates external_listings records
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function backfillMecumListings() {
  console.log('🔍 Finding Mecum vehicles without external_listings...\n');

  // Get all Mecum vehicles
  const { data: vehicles, error: vehiclesError } = await supabase
    .from('vehicles')
    .select('id, discovery_url, sale_date, location, origin_organization_id')
    .or('discovery_url.ilike.%mecum.com%,discovery_source.ilike.%mecum%')
    .limit(1000);

  if (vehiclesError) {
    console.error('❌ Error fetching vehicles:', vehiclesError);
    return;
  }

  if (!vehicles || vehicles.length === 0) {
    console.log('✅ No Mecum vehicles found');
    return;
  }

  console.log(`📦 Found ${vehicles.length} Mecum vehicles\n`);

  // Get existing external_listings for these vehicles
  const vehicleIds = vehicles.map(v => v.id);
  const { data: existingListings } = await supabase
    .from('external_listings')
    .select('vehicle_id')
    .in('vehicle_id', vehicleIds)
    .eq('platform', 'mecum');

  const existingVehicleIds = new Set(existingListings?.map(l => l.vehicle_id) || []);

  // Get Mecum organization ID
  const { data: org } = await supabase
    .from('businesses')
    .select('id')
    .ilike('business_name', '%mecum%')
    .limit(1)
    .maybeSingle();

  const orgId = org?.id || vehicles[0]?.origin_organization_id;

  if (!orgId) {
    console.error('❌ Could not find Mecum organization');
    return;
  }

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const vehicle of vehicles) {
    if (existingVehicleIds.has(vehicle.id)) {
      skipped++;
      continue;
    }

    if (!vehicle.discovery_url) {
      skipped++;
      continue;
    }

    // Extract lot number from URL: /lots/1154350/... -> 1154350
    const lotMatch = vehicle.discovery_url.match(/\/lots\/(\d+)/);
    if (!lotMatch || !lotMatch[1]) {
      skipped++;
      continue;
    }

    const lotNumber = lotMatch[1];
    const listingId = lotNumber;

    // Determine listing status
    let listingStatus = 'ended';
    if (vehicle.sale_date) {
      const saleDate = new Date(vehicle.sale_date);
      if (saleDate > new Date()) {
        listingStatus = 'active';
      } else {
        listingStatus = 'sold';
      }
    }

    // Create external_listings record
    const { error: insertError } = await supabase
      .from('external_listings')
      .upsert({
        vehicle_id: vehicle.id,
        organization_id: orgId,
        platform: 'mecum',
        listing_url: vehicle.discovery_url,
        listing_id: listingId,
        listing_status: listingStatus,
        sold_at: vehicle.sale_date ? new Date(vehicle.sale_date).toISOString() : null,
        metadata: {
          source: 'backfill_script',
          lot_number: lotNumber,
          location: vehicle.location || null,
          sale_date: vehicle.sale_date || null,
        },
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'vehicle_id,platform,listing_id',
      });

    if (insertError) {
      console.error(`❌ Error creating listing for vehicle ${vehicle.id}:`, insertError.message);
      errors++;
    } else {
      created++;
      if (created % 10 === 0) {
        console.log(`  ✅ Created ${created} listings...`);
      }
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Created: ${created}`);
  console.log(`   ⏭️  Skipped: ${skipped}`);
  console.log(`   ❌ Errors: ${errors}`);
  console.log(`\n✨ Done!`);
}

backfillMecumListings().catch(console.error);

