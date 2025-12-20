#!/usr/bin/env node

/**
 * Repair script to find BaT listing and extract all missing data for a vehicle
 * Usage: node scripts/repair-bat-vehicle.js <vehicle_id> [bat_url]
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env - try multiple paths
const envPaths = [
  join(__dirname, '..', 'nuke_frontend', '.env.local'),
  join(__dirname, '..', '.env.local'),
];

for (const envPath of envPaths) {
  try {
    const envFile = readFileSync(envPath, 'utf8');
    envFile.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    });
    break; // Successfully loaded
  } catch (error) {
    // Try next path
  }
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY not set');
  console.error('   Please set it in nuke_frontend/.env.local or as an environment variable');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function findBaTListingByVehicle(vehicle) {
  console.log(`\n🔍 Searching for BaT listing: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  
  // Search BaT member page for garagekeptmotors
  const memberUrl = 'https://bringatrailer.com/member/garagekeptmotors/';
  
  try {
    // Use simple-scraper to get the member page HTML
    const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke('simple-scraper', {
      body: { url: memberUrl },
      headers: {
        'Authorization': `Bearer ${supabaseKey}`
      }
    });

    if (scrapeError || !scrapeData?.success) {
      console.error('❌ Failed to scrape BaT member page:', scrapeError || scrapeData?.error);
      return null;
    }

    const html = scrapeData.data?.html || scrapeData.data?.content || '';
    
    // Search for listings matching this vehicle
    // Look for links like /listing/1941-willys-coupe-...
    const searchPattern = new RegExp(
      `${vehicle.year}[^<]*${vehicle.make}[^<]*${vehicle.model}`.replace(/\s+/g, '[^<]*'),
      'i'
    );
    
    // Extract all /listing/ URLs from the page
    const listingMatches = html.matchAll(/href="([^"]*\/listing\/[^"]+)"/gi);
    const listings = Array.from(listingMatches)
      .map(m => m[1])
      .filter(url => url.includes('bringatrailer.com'))
      .map(url => url.startsWith('http') ? url : `https://bringatrailer.com${url}`)
      .filter((url, idx, arr) => arr.indexOf(url) === idx); // deduplicate
    
    console.log(`   Found ${listings.length} listing URLs on member page`);
    
    // Search for the matching listing
    for (const listingUrl of listings) {
      // Extract listing data to check if it matches
      const { data: listingData, error: listingError } = await supabase.functions.invoke('simple-scraper', {
        body: { url: listingUrl },
        headers: {
          'Authorization': `Bearer ${supabaseKey}`
        }
      });
      
      if (listingError || !listingData?.success) continue;
      
      const listingHtml = listingData.data?.html || listingData.data?.content || '';
      
      // Check if title matches
      const titleMatch = listingHtml.match(/<h1[^>]*>([^<]+)<\/h1>/i);
      if (titleMatch) {
        const title = titleMatch[1].trim();
        const yearMatch = title.match(/^(\d{4})/);
        const makeMatch = title.match(/\b(Willys)\b/i);
        
        if (yearMatch && parseInt(yearMatch[1]) === vehicle.year && makeMatch) {
          console.log(`   ✅ Found matching listing: ${title}`);
          console.log(`   📄 URL: ${listingUrl}`);
          return listingUrl;
        }
      }
    }
    
    console.log('   ⚠️  No matching listing found on member page');
    return null;
    
  } catch (error) {
    console.error('❌ Error searching for BaT listing:', error.message);
    return null;
  }
}

async function extractBaTData(vehicleId, batUrl) {
  console.log(`\n📥 Extracting comprehensive BaT data...`);
  console.log(`   Vehicle ID: ${vehicleId}`);
  console.log(`   BaT URL: ${batUrl}`);
  
  try {
    const { data, error } = await supabase.functions.invoke('comprehensive-bat-extraction', {
      body: {
        batUrl,
        vehicleId
      },
      headers: {
        'Authorization': `Bearer ${supabaseKey}`
      }
    });

    if (error) {
      console.error('❌ Comprehensive extraction error:', error);
      return false;
    }

    if (data?.success) {
      console.log('✅ Comprehensive extraction completed!');
      console.log('   Extracted data:', {
        vin: data.data?.vin || 'N/A',
        mileage: data.data?.mileage || 'N/A',
        engine: data.data?.engine || 'N/A',
        transmission: data.data?.transmission || 'N/A',
        color: data.data?.color || 'N/A',
        sale_price: data.data?.sale_price || 'N/A',
        bid_count: data.data?.bid_count || 'N/A',
        comment_count: data.data?.comment_count || 'N/A',
        features: data.data?.features?.length || 0
      });
      return true;
    } else {
      console.error('❌ Comprehensive extraction failed:', data?.error);
      return false;
    }
  } catch (error) {
    console.error('❌ Error calling comprehensive extraction:', error.message);
    return false;
  }
}

async function importBaTListing(vehicleId, batUrl) {
  console.log(`\n📥 Importing BaT listing (will update existing vehicle)...`);
  
  try {
    const { data, error } = await supabase.functions.invoke('import-bat-listing', {
      body: {
        batUrl,
        vehicleId  // This will match and update the existing vehicle
      },
      headers: {
        'Authorization': `Bearer ${supabaseKey}`
      }
    });

    if (error) {
      console.error('❌ Import error:', error);
      return false;
    }

    if (data?.vehicleId) {
      console.log('✅ BaT listing imported successfully!');
      console.log('   Vehicle ID:', data.vehicleId);
      return true;
    } else {
      console.error('❌ Import failed:', data);
      return false;
    }
  } catch (error) {
    console.error('❌ Error importing BaT listing:', error.message);
    return false;
  }
}

async function main() {
  const vehicleId = process.argv[2];
  const batUrlArg = process.argv[3];

  if (!vehicleId) {
    console.error('Usage: node scripts/repair-bat-vehicle.js <vehicle_id> [bat_url]');
    process.exit(1);
  }

  console.log(`🔧 Repairing BaT vehicle data for: ${vehicleId}\n`);

  // Fetch vehicle
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .single();

  if (vehicleError || !vehicle) {
    console.error('❌ Vehicle not found:', vehicleError?.message);
    process.exit(1);
  }

  console.log(`📋 Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`   Current BaT URL: ${vehicle.bat_auction_url || 'None'}`);

  // Use provided URL or search for it
  let batUrl = batUrlArg;
  
  if (!batUrl) {
    batUrl = await findBaTListingByVehicle(vehicle);
    
    if (!batUrl) {
      console.error('\n❌ Could not find BaT listing. Please provide the BaT URL manually:');
      console.error(`   node scripts/repair-bat-vehicle.js ${vehicleId} <bat_url>`);
      process.exit(1);
    }
  }

  // Import the BaT listing (this will update the vehicle and extract all data)
  const imported = await importBaTListing(vehicleId, batUrl);
  
  if (!imported) {
    console.error('\n❌ Failed to import BaT listing');
    process.exit(1);
  }

  // Also run comprehensive extraction to ensure all data is extracted
  await extractBaTData(vehicleId, batUrl);

  // Verify the data
  console.log(`\n🔍 Verifying extracted data...`);
  const { data: updatedVehicle, error: verifyError } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .single();

  if (!verifyError && updatedVehicle) {
    console.log('\n✅ Vehicle data updated:');
    console.log(`   BaT URL: ${updatedVehicle.bat_auction_url || 'None'}`);
    console.log(`   VIN: ${updatedVehicle.vin || 'None'}`);
    console.log(`   Mileage: ${updatedVehicle.mileage || 'None'}`);
    console.log(`   Engine: ${updatedVehicle.engine_size || 'None'}`);
    console.log(`   Transmission: ${updatedVehicle.transmission || 'None'}`);
    console.log(`   Color: ${updatedVehicle.color || 'None'}`);
    console.log(`   Sale Price: ${updatedVehicle.sale_price || 'None'}`);
    console.log(`   Bid Count: ${updatedVehicle.bat_bids || 'None'}`);
    console.log(`   Comment Count: ${updatedVehicle.bat_comments || 'None'}`);
    
    // Check images
    const { count: imageCount } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', vehicleId);
    
    console.log(`   Images: ${imageCount || 0}`);
    
    // Check timeline events
    const { count: eventCount } = await supabase
      .from('timeline_events')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', vehicleId);
    
    console.log(`   Timeline Events: ${eventCount || 0}`);
  }

  console.log('\n✅ Repair complete!');
}

main().catch(console.error);

