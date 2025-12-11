#!/usr/bin/env node

/**
 * Quick Vehicle Import - Get vehicles into the database NOW
 * 
 * Directly imports vehicles from various sources without queue delays
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/**
 * Import a single vehicle URL directly
 */
async function importVehicleUrl(url) {
  console.log(`\n🔍 Importing: ${url}`);
  
  // Check if already exists
  const { data: existing } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .eq('discovery_url', url)
    .maybeSingle();
  
  if (existing) {
    console.log(`   ⏭️  Already exists: ${existing.year} ${existing.make} ${existing.model}`);
    return { success: true, skipped: true, vehicleId: existing.id };
  }
  
  // Use the scrape-vehicle function
  const { data: scrapedData, error: scrapeError } = await supabase.functions.invoke('scrape-vehicle', {
    body: { url },
    timeout: 60000
  });
  
  if (scrapeError || !scrapedData) {
    console.log(`   ❌ Scrape failed: ${scrapeError?.message || 'No data'}`);
    return { success: false, error: scrapeError?.message };
  }
  
  // Extract vehicle data
  const year = scrapedData.year || scrapedData.data?.year;
  const make = scrapedData.make || scrapedData.data?.make;
  const model = scrapedData.model || scrapedData.data?.model;
  
  if (!year || !make || !model) {
    console.log(`   ⚠️  Missing required fields: year=${year}, make=${make}, model=${model}`);
    return { success: false, error: 'Missing required fields' };
  }
  
  // Create vehicle directly
  const { data: newVehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .insert({
      year: parseInt(year),
      make: make.trim(),
      model: model.trim(),
      discovery_url: url,
      status: 'active',
      is_public: true,
      profile_origin: 'scraped',
      discovery_source: detectSource(url),
      origin_metadata: {
        imported_at: new Date().toISOString(),
        image_urls: scrapedData.images || scrapedData.data?.images || [],
        price: scrapedData.price || scrapedData.data?.price,
        description: scrapedData.description || scrapedData.data?.description
      },
      asking_price: scrapedData.price || scrapedData.data?.price,
      description: scrapedData.description || scrapedData.data?.description
    })
    .select('id, year, make, model')
    .single();
  
  if (vehicleError) {
    console.log(`   ❌ Create failed: ${vehicleError.message}`);
    return { success: false, error: vehicleError.message };
  }
  
  console.log(`   ✅ Created: ${newVehicle.year} ${newVehicle.make} ${newVehicle.model} (${newVehicle.id})`);
  
  // Import images if available
  const images = scrapedData.images || scrapedData.data?.images || [];
  if (images.length > 0) {
    console.log(`   📸 Importing ${images.length} images...`);
    // Images will be backfilled by the system
  }
  
  return { success: true, vehicleId: newVehicle.id, vehicle: newVehicle };
}

function detectSource(url) {
  if (url.includes('bringatrailer.com')) return 'Bring a Trailer';
  if (url.includes('hemmings.com')) return 'Hemmings';
  if (url.includes('craigslist.org')) return 'Craigslist';
  if (url.includes('facebook.com')) return 'Facebook Marketplace';
  if (url.includes('cars.ksl.com')) return 'KSL Cars';
  if (url.includes('classiccars.com')) return 'ClassicCars.com';
  return 'Unknown';
}

/**
 * Get recent listings from a source
 */
async function getRecentListings(source) {
  console.log(`\n🔍 Fetching from: ${source.name}`);
  
  try {
    // Use intelligent crawler if available
    const { data, error } = await supabase.functions.invoke('intelligent-crawler', {
      body: {
        search_url: source.url,
        source_type: source.type,
        max_results: 20
      },
      timeout: 30000
    });
    
    if (error) {
      console.log(`   ⚠️  Crawler error: ${error.message}`);
      return [];
    }
    
    return data?.listings || [];
    
  } catch (err) {
    console.log(`   ⚠️  Error: ${err.message}`);
    return [];
  }
}

/**
 * Main import function
 */
async function main() {
  console.log('🚗 Starting direct vehicle import...\n');
  
  // Test sources - get recent listings
  const sources = [
    { url: 'https://bringatrailer.com/auctions/', name: 'BaT Recent', type: 'auction' },
    { url: 'https://www.hemmings.com/classifieds/cars-for-sale', name: 'Hemmings', type: 'marketplace' },
  ];
  
  let totalImported = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  
  for (const source of sources) {
    const listings = await getRecentListings(source);
    console.log(`   Found ${listings.length} listings`);
    
    for (const listing of listings.slice(0, 10)) { // Limit to 10 per source
      const result = await importVehicleUrl(listing.url);
      
      if (result.success) {
        if (result.skipped) {
          totalSkipped++;
        } else {
          totalImported++;
        }
      } else {
        totalFailed++;
      }
      
      // Small delay between imports
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('📊 Import Summary:');
  console.log(`   ✅ Imported: ${totalImported}`);
  console.log(`   ⏭️  Skipped: ${totalSkipped}`);
  console.log(`   ❌ Failed: ${totalFailed}`);
  console.log('='.repeat(60));
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { importVehicleUrl, main };

