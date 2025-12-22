#!/usr/bin/env node
/**
 * Query extracted PCarMarket data
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

const vehicleId = process.argv[2] || 'e92537b2-4ee6-4a84-9c30-ebe7d2afb4f8';

async function queryData() {
  console.log(`\n📊 Querying extracted data for vehicle: ${vehicleId}\n`);
  
  // Query vehicle data
  const { data: vehicle, error } = await supabase
    .from('vehicles')
    .select(`
      id,
      year,
      make,
      model,
      trim,
      vin,
      mileage,
      sale_price,
      sale_date,
      auction_outcome,
      profile_origin,
      discovery_source,
      discovery_url,
      listing_url,
      description,
      origin_metadata,
      created_at
    `)
    .eq('id', vehicleId)
    .single();
  
  if (error || !vehicle) {
    console.error('❌ Error:', error);
    return;
  }
  
  // Query images
  const { data: images } = await supabase
    .from('vehicle_images')
    .select('id, image_url, is_primary, source')
    .eq('vehicle_id', vehicleId)
    .order('is_primary', { ascending: false });
  
  // Query organization link
  const { data: orgLink } = await supabase
    .from('organization_vehicles')
    .select(`
      relationship_type,
      listing_status,
      listing_url,
      businesses:organization_id (
        id,
        business_name,
        website
      )
    `)
    .eq('vehicle_id', vehicleId)
    .single();
  
  // Display results
  console.log('═══════════════════════════════════════════════════════════');
  console.log('VEHICLE RECORD');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`ID:              ${vehicle.id}`);
  console.log(`Year:            ${vehicle.year}`);
  console.log(`Make:            ${vehicle.make}`);
  console.log(`Model:           ${vehicle.model}`);
  console.log(`Trim:            ${vehicle.trim || 'N/A'}`);
  console.log(`VIN:             ${vehicle.vin || 'N/A'}`);
  console.log(`Mileage:         ${vehicle.mileage ? vehicle.mileage.toLocaleString() : 'N/A'}`);
  console.log(`Sale Price:      ${vehicle.sale_price ? '$' + vehicle.sale_price.toLocaleString() : 'N/A'}`);
  console.log(`Sale Date:       ${vehicle.sale_date || 'N/A'}`);
  console.log(`Auction Outcome: ${vehicle.auction_outcome || 'N/A'}`);
  console.log(`Description:     ${vehicle.description?.substring(0, 60)}...`);
  console.log('');
  console.log('Origin Tracking:');
  console.log(`  Profile Origin:    ${vehicle.profile_origin}`);
  console.log(`  Discovery Source:  ${vehicle.discovery_source}`);
  console.log(`  Discovery URL:     ${vehicle.discovery_url}`);
  console.log(`  Listing URL:       ${vehicle.listing_url}`);
  console.log('');
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log('ORIGIN METADATA (JSONB)');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(JSON.stringify(vehicle.origin_metadata, null, 2));
  console.log('');
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log('IMAGES');
  console.log('═══════════════════════════════════════════════════════════');
  if (images && images.length > 0) {
    images.forEach((img, i) => {
      console.log(`${i + 1}. ${img.is_primary ? '⭐ PRIMARY' : '  '} ${img.source}`);
      console.log(`   ${img.image_url.substring(0, 80)}...`);
    });
    console.log(`\nTotal: ${images.length} images`);
  } else {
    console.log('No images found');
  }
  console.log('');
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log('ORGANIZATION LINK');
  console.log('═══════════════════════════════════════════════════════════');
  if (orgLink) {
    const org = orgLink.businesses;
    console.log(`Organization:    ${org?.business_name || 'N/A'}`);
    console.log(`Website:         ${org?.website || 'N/A'}`);
    console.log(`Relationship:    ${orgLink.relationship_type}`);
    console.log(`Listing Status:  ${orgLink.listing_status}`);
    console.log(`Listing URL:     ${orgLink.listing_url}`);
  } else {
    console.log('No organization link found');
  }
  console.log('');
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log('SQL QUERY REPRESENTATION');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`
SELECT
  v.id,
  v.year,
  v.make,
  v.model,
  v.trim,
  v.vin,
  v.mileage,
  v.sale_price,
  v.auction_outcome,
  v.profile_origin,
  v.discovery_source,
  v.discovery_url,
  v.origin_metadata,
  (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) as image_count,
  b.business_name as organization_name
FROM vehicles v
LEFT JOIN organization_vehicles ov ON v.id = ov.vehicle_id
LEFT JOIN businesses b ON ov.organization_id = b.id
WHERE v.id = '${vehicleId}';
  `);
  
  console.log('\n✅ Query complete!\n');
}

queryData();

