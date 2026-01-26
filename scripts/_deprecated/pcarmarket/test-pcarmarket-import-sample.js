#!/usr/bin/env node
/**
 * TEST PCARMARKET IMPORT WITH SAMPLE DATA
 * Creates a test vehicle record to demonstrate the extraction mapping
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey || !supabaseUrl) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Service account user ID for imports
const SERVICE_USER_ID = process.env.SERVICE_USER_ID || '0b9f107a-d124-49de-9ded-94698f63c1c4';

async function createSampleImport() {
  console.log('\n🚀 Creating sample PCarMarket import...\n');
  
  // Sample data based on real PCarMarket listing
  const sampleData = {
    url: 'https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2',
    title: '5k-Mile 2002 Aston Martin DB7 V12 Vantage Coupe',
    year: 2002,
    make: 'aston martin',
    model: 'db7',
    trim: 'v12 vantage coupe',
    mileage: 5000,
    vin: 'SCFAC12322K100123',
    salePrice: null,
    saleDate: null,
    auctionOutcome: null,
    images: [
      // Cover/primary image
      'https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/7px6oyvwxubawlvd4cr52yopjrzs2ixg-2025-02-21-ZcnWw5gj/Cover Photo Ratio.jpg',
      // Gallery images (all from photo library)
      'https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/galleries/photos/uploads/galleries/54235-2002-aston-martin-db7-v12-vantage-gta/pics4cars.com-27.jpg',
      'https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/galleries/photos/uploads/galleries/54235-2002-aston-martin-db7-v12-vantage-gta/pics4cars.com-28.jpg',
      'https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/galleries/photos/uploads/galleries/54235-2002-aston-martin-db7-v12-vantage-gta/pics4cars.com-29.jpg',
      'https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/galleries/photos/uploads/galleries/54235-2002-aston-martin-db7-v12-vantage-gta/pics4cars.com-30.jpg',
      'https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/galleries/photos/uploads/galleries/54235-2002-aston-martin-db7-v12-vantage-gta/pics4cars.com-31.jpg',
      'https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/galleries/photos/uploads/galleries/54235-2002-aston-martin-db7-v12-vantage-gta/pics4cars.com-32.jpg',
      'https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/galleries/photos/uploads/galleries/54235-2002-aston-martin-db7-v12-vantage-gta/pics4cars.com-33.jpg',
      'https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/galleries/photos/uploads/galleries/54235-2002-aston-martin-db7-v12-vantage-gta/pics4cars.com-34.jpg',
      'https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/galleries/photos/uploads/galleries/54235-2002-aston-martin-db7-v12-vantage-gta/pics4cars.com-35.jpg',
      'https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/galleries/photos/uploads/galleries/54235-2002-aston-martin-db7-v12-vantage-gta/pics4cars.com-36.jpg'
    ],
    sellerUsername: 'elismotorcars',
    slug: '2002-aston-martin-db7-v12-vantage-2',
    auctionId: '2',
    bidCount: 12,
    viewCount: 345
  };
  
  // Find org
  const { data: org } = await supabase
    .from('businesses')
    .select('id')
    .eq('website', 'https://www.pcarmarket.com')
    .maybeSingle();
  
  const orgId = org?.id || 'f7c80592-6725-448d-9b32-2abf3e011cf8';
  
  // Check if already exists
  const { data: existing } = await supabase
    .from('vehicles')
    .select('id')
    .eq('discovery_url', sampleData.url)
    .maybeSingle();
  
  let vehicleId;
  
  if (existing) {
    vehicleId = existing.id;
    console.log(`   Found existing vehicle: ${vehicleId}`);
    console.log('   Updating with sample data...');
  } else {
    // Create vehicle
    const vehicleData = {
      year: sampleData.year,
      make: sampleData.make.toLowerCase(),
      model: sampleData.model.toLowerCase(),
      trim: sampleData.trim?.toLowerCase() || null,
      vin: sampleData.vin?.toUpperCase() || null,
      mileage: sampleData.mileage || null,
      sale_price: sampleData.salePrice || null,
      sale_date: sampleData.saleDate || null,
      auction_outcome: sampleData.auctionOutcome || null,
      description: sampleData.title,
      profile_origin: 'pcarmarket_import',
      discovery_source: 'pcarmarket',
      discovery_url: sampleData.url,
      listing_url: sampleData.url,
      origin_metadata: {
        source: 'pcarmarket_import',
        pcarmarket_url: sampleData.url,
        pcarmarket_listing_title: sampleData.title,
        pcarmarket_seller_username: sampleData.sellerUsername || null,
        pcarmarket_buyer_username: null,
        pcarmarket_auction_id: sampleData.auctionId || null,
        pcarmarket_auction_slug: sampleData.slug || null,
        bid_count: sampleData.bidCount || null,
        view_count: sampleData.viewCount || null,
        sold_status: sampleData.auctionOutcome === 'sold' ? 'sold' : 'unsold',
        imported_at: new Date().toISOString(),
        // Time parameters (example - would be extracted from page)
        auction_times: {
          auction_start_date: null, // Would be extracted
          auction_end_date: null,   // Would be extracted
          current_time: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          calculated_at: new Date().toISOString()
        }
      },
      is_public: true,
      status: 'active'
    };
    
    const { data: newVehicle, error } = await supabase
      .from('vehicles')
      .insert({
        ...vehicleData,
        uploaded_by: SERVICE_USER_ID
      })
      .select('id')
      .single();
    
    if (error) {
      console.error('❌ Error creating vehicle:', error);
      return null;
    }
    
    vehicleId = newVehicle.id;
    console.log(`   ✅ Created vehicle: ${vehicleId}`);
  }
  
  // Import images (FIXED - with user_id requirement)
  if (sampleData.images && sampleData.images.length > 0) {
    console.log(`   📸 Importing ${sampleData.images.length} images...`);
    
    // Delete existing images for this vehicle first
    await supabase
      .from('vehicle_images')
      .delete()
      .eq('vehicle_id', vehicleId)
      .eq('source', 'pcarmarket_listing');
    
    // Get user_id for images (use vehicle owner or service account)
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('user_id, uploaded_by')
      .eq('id', vehicleId)
      .single();
    
    const userId = vehicle?.user_id || vehicle?.uploaded_by || SERVICE_USER_ID || '0b9f107a-d124-49de-9ded-94698f63c1c4';
    
    const imageInserts = sampleData.images.map((url, i) => ({
      vehicle_id: vehicleId,
      image_url: url,
      user_id: userId, // Required field
      category: 'general',
      image_category: 'exterior',
      source: 'pcarmarket_listing',
      is_primary: i === 0,
      filename: `pcarmarket_${i}.jpg`
    }));
    
    const { error: imgError } = await supabase.from('vehicle_images').insert(imageInserts);
    if (imgError) {
      console.error('   ❌ Image import error:', imgError.message);
    } else {
      console.log('   ✅ Images imported');
    }
  }
  
  // Link to org (FIXED - removed listing_url, no listing_status)
  console.log('   🔗 Linking to organization...');
  const { error: orgError } = await supabase
    .from('organization_vehicles')
    .upsert({
      organization_id: orgId,
      vehicle_id: vehicleId,
      relationship_type: 'consigner',
      status: 'active',
      auto_tagged: true,
      notes: `Imported from PCarMarket: ${sampleData.url}`
    }, {
      onConflict: 'organization_id,vehicle_id,relationship_type'
    });
  
  if (orgError) {
    console.error('   ❌ Org link error:', orgError.message);
  } else {
    console.log('   ✅ Linked to organization');
  }
  
  console.log(`\n✅ Sample import complete! Vehicle ID: ${vehicleId}\n`);
  return vehicleId;
}

createSampleImport().then(vehicleId => {
  if (vehicleId) {
    console.log(`📊 Run this SQL query to see the extracted data:\n`);
    console.log(`SELECT`);
    console.log(`  v.id,`);
    console.log(`  v.year,`);
    console.log(`  v.make,`);
    console.log(`  v.model,`);
    console.log(`  v.trim,`);
    console.log(`  v.vin,`);
    console.log(`  v.mileage,`);
    console.log(`  v.sale_price,`);
    console.log(`  v.auction_outcome,`);
    console.log(`  v.profile_origin,`);
    console.log(`  v.discovery_source,`);
    console.log(`  v.discovery_url,`);
    console.log(`  v.origin_metadata,`);
    console.log(`  (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) as image_count,`);
    console.log(`  (SELECT name FROM businesses WHERE id = ov.organization_id) as organization_name`);
    console.log(`FROM vehicles v`);
    console.log(`LEFT JOIN organization_vehicles ov ON v.id = ov.vehicle_id`);
    console.log(`WHERE v.id = '${vehicleId}';`);
    console.log(``);
  }
});

