#!/usr/bin/env node
/**
 * Apply BaT data fix and count profiles initiated from BaT listings
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Try multiple .env locations
dotenv.config({ path: '../.env' });
dotenv.config({ path: '.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('❌ Error: SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY not found in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('🔧 Applying BaT data fix for 1988 Jeep Wrangler...\n');

  // Apply the fix
  const { data: updateData, error: updateError } = await supabase
    .from('vehicles')
    .update({
      sale_price: 11000,
      bat_sold_price: 11000,
      bat_sale_date: '2024-04-15',
      bat_listing_title: 'No Reserve: 1988 Jeep Wrangler Sahara'
    })
    .eq('id', 'f7a10a48-4cd8-4ff9-9166-702367d1c859')
    .select();

  if (updateError) {
    console.error('❌ Error updating vehicle:', updateError);
  } else {
    console.log('✅ Updated vehicle:', updateData?.[0]?.id || 'success');
  }

  // Add field sources
  const fieldSources = [
    {
      vehicle_id: 'f7a10a48-4cd8-4ff9-9166-702367d1c859',
      field_name: 'sale_price',
      field_value: '11000',
      source_type: 'ai_scraped',
      source_url: 'https://bringatrailer.com/listing/1988-jeep-wrangler-32/',
      extraction_method: 'url_scraping',
      confidence_score: 100,
      metadata: {
        source: 'BaT_listing',
        extracted_at: '2025-02-05',
        lot_number: '143328',
        verified: true
      }
    },
    {
      vehicle_id: 'f7a10a48-4cd8-4ff9-9166-702367d1c859',
      field_name: 'bat_sold_price',
      field_value: '11000',
      source_type: 'ai_scraped',
      source_url: 'https://bringatrailer.com/listing/1988-jeep-wrangler-32/',
      extraction_method: 'url_scraping',
      confidence_score: 100,
      metadata: {
        source: 'BaT_listing',
        extracted_at: '2025-02-05',
        lot_number: '143328',
        verified: true
      }
    },
    {
      vehicle_id: 'f7a10a48-4cd8-4ff9-9166-702367d1c859',
      field_name: 'bat_sale_date',
      field_value: '2024-04-15',
      source_type: 'ai_scraped',
      source_url: 'https://bringatrailer.com/listing/1988-jeep-wrangler-32/',
      extraction_method: 'url_scraping',
      confidence_score: 100,
      metadata: {
        source: 'BaT_listing',
        extracted_at: '2025-02-05',
        lot_number: '143328',
        verified: true
      }
    }
  ];

  for (const source of fieldSources) {
    const { error } = await supabase
      .from('vehicle_field_sources')
      .upsert(source, { onConflict: 'vehicle_id,field_name' });
    
    if (error) {
      console.warn('⚠️  Warning inserting field source:', error.message);
    }
  }

  console.log('\n📊 Counting BaT-initiated profiles...\n');

  // Count vehicles with BaT data
  const { data: batVehicles, error: batError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, bat_auction_url, bat_listing_title, bat_seller, bat_buyer, bat_sold_price, bat_sale_date, uploaded_by, created_at, discovery_source')
    .or('bat_auction_url.not.is.null,bat_listing_title.not.is.null,bat_seller.not.is.null,bat_buyer.not.is.null,discovery_source.eq.bat_extension');

  if (batError) {
    console.error('❌ Error querying vehicles:', batError);
    return;
  }

  console.log(`📈 Total vehicles with BaT data: ${batVehicles?.length || 0}`);

  // Count by discovery source
  const byDiscoverySource = batVehicles?.filter(v => v.discovery_source === 'bat_extension').length || 0;
  console.log(`   - Created via BaT extension: ${byDiscoverySource}`);
  console.log(`   - Created via other methods: ${(batVehicles?.length || 0) - byDiscoverySource}`);

  // Count vehicles with BaT images
  const { count: batImageCount, error: imageError } = await supabase
    .from('vehicle_images')
    .select('vehicle_id', { count: 'exact', head: true })
    .eq('source', 'bat_listing');

  if (!imageError) {
    console.log(`\n🖼️  Vehicles with BaT-sourced images: ${batImageCount || 0}`);
  }

  // Count timeline events from BaT
  const { count: batEventCount, error: eventError } = await supabase
    .from('timeline_events')
    .select('vehicle_id', { count: 'exact', head: true })
    .or("metadata->>'source'.eq.bat_import,metadata->>'bat_url'.not.is.null");

  if (!eventError) {
    console.log(`📅 Vehicles with BaT timeline events: ${batEventCount || 0}`);
  }

  // Count unique users who created BaT vehicles
  const uniqueUsers = new Set(batVehicles?.map(v => v.uploaded_by).filter(Boolean) || []);
  console.log(`\n👥 Unique users who created BaT vehicles: ${uniqueUsers.size}`);

  // Show breakdown by BaT data completeness
  const withUrl = batVehicles?.filter(v => v.bat_auction_url).length || 0;
  const withPrice = batVehicles?.filter(v => v.bat_sold_price).length || 0;
  const withDate = batVehicles?.filter(v => v.bat_sale_date).length || 0;
  const withSeller = batVehicles?.filter(v => v.bat_seller).length || 0;
  const withBuyer = batVehicles?.filter(v => v.bat_buyer).length || 0;

  console.log('\n📋 BaT Data Completeness:');
  console.log(`   - With BaT URL: ${withUrl}`);
  console.log(`   - With sale price: ${withPrice}`);
  console.log(`   - With sale date: ${withDate}`);
  console.log(`   - With seller: ${withSeller}`);
  console.log(`   - With buyer: ${withBuyer}`);

  // Show recent BaT vehicles
  const recent = batVehicles
    ?.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 10) || [];

  if (recent.length > 0) {
    console.log('\n🆕 BaT vehicles (most recent first):');
    recent.forEach((v, i) => {
      const price = v.bat_sold_price ? `$${v.bat_sold_price.toLocaleString()}` : 'no price';
      const date = v.bat_sale_date || 'no date';
      const seller = v.bat_seller || 'no seller';
      console.log(`   ${i + 1}. ${v.year} ${v.make} ${v.model}`);
      console.log(`      URL: ${v.bat_auction_url || 'none'}`);
      console.log(`      Price: ${price}, Date: ${date}, Seller: ${seller}`);
      console.log(`      Created: ${new Date(v.created_at).toLocaleDateString()}`);
    });
  }

  // Check for vehicles created via import-bat-listing function
  const { data: importVehicles, error: importError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, created_at, uploaded_by')
    .not('bat_auction_url', 'is', null)
    .order('created_at', { ascending: false });

  console.log(`\n📥 Vehicles imported via import-bat-listing function: ${importVehicles?.length || 0}`);

  // Check for vehicles with BaT images but no BaT URL
  const { data: vehiclesWithBatImages, error: imageVehiclesError } = await supabase
    .from('vehicle_images')
    .select('vehicle_id, vehicles!inner(id, year, make, model, bat_auction_url)')
    .eq('source', 'bat_listing')
    .limit(100);

  const vehiclesWithImagesOnly = vehiclesWithBatImages
    ?.filter(vi => !vi.vehicles?.bat_auction_url)
    .map(vi => vi.vehicles?.id)
    .filter((v, i, arr) => arr.indexOf(v) === i) || [];

  console.log(`📸 Vehicles with BaT images but no BaT URL: ${vehiclesWithImagesOnly.length}`);

  console.log('\n✅ Analysis complete!');
}

main().catch(console.error);

