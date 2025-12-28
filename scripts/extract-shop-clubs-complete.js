import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const ORGANIZATION_ID = '0b8219ae-9d9b-447c-978c-3a30ab37fd49';

async function extractFromBATDealerProfile() {
  // Try both dealer profile scraping and search-based extraction
  console.log('🚗 Extracting from Bring a Trailer');
  console.log(`   Organization ID: ${ORGANIZATION_ID}\n`);

  try {
    // Use scrape-multi-source which can handle dealer pages
    const functionUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/scrape-multi-source`;
    console.log(`📡 Calling scrape-multi-source for BaT dealer profile...`);

    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        source_url: 'https://bringatrailer.com/?s=TheShopClubs',
        source_type: 'dealer_website',
        organization_id: ORGANIZATION_ID,
        max_results: 100,
        use_llm_extraction: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Unknown error');
    }

    console.log('\n✅ BaT Extraction Complete!\n');
    console.log('Results:');
    console.log(`  - Listings Found: ${result.listings_found || 0}`);
    console.log(`  - Listings Queued: ${result.listings_queued || 0}`);
    console.log(`  - Duplicates Skipped: ${result.duplicates_skipped || 0}\n`);

    // Process the queue
    if (result.listings_queued > 0) {
      console.log('🔄 Processing BaT queue...');
      await processQueue(5);
    }

    return result;
  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  }
}

async function extractFromCarsAndBids() {
  const carsAndBidsUrl = 'https://carsandbids.com/user/TheShopClubs';
  
  console.log('🚗 Extracting from Cars & Bids User Page');
  console.log(`   URL: ${carsAndBidsUrl}`);
  console.log(`   Organization ID: ${ORGANIZATION_ID}\n`);

  try {
    const functionUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/scrape-multi-source`;
    console.log(`📡 Calling scrape-multi-source for Cars & Bids...`);

    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        source_url: carsAndBidsUrl,
        source_type: 'dealer_website',
        organization_id: ORGANIZATION_ID,
        max_results: 100,
        use_llm_extraction: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();

    console.log('\n✅ Cars & Bids Extraction Complete!\n');
    console.log('Results:');
    console.log(`  - Listings Found: ${result.listings_found || 0}`);
    console.log(`  - Listings Queued: ${result.listings_queued || 0}`);
    console.log(`  - Duplicates Skipped: ${result.duplicates_skipped || 0}\n`);

    // Process the queue
    if (result.listings_queued > 0) {
      console.log('🔄 Processing Cars & Bids queue...');
      await processQueue(5);
    }

    return result;
  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  }
}

async function processQueue(batches = 5) {
  const processQueueUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/process-import-queue`;
  
  for (let i = 0; i < batches; i++) {
    const response = await fetch(processQueueUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        batch_size: 20,
        priority_only: false
      })
    });

    if (response.ok) {
      const result = await response.json();
      const created = result.vehicles_created?.length || 0;
      console.log(`   Batch ${i + 1}: Processed ${result.processed || 0} items, Created ${created} vehicles`);
      
      if (created === 0 && result.processed === 0) break; // Stop if no more items to process
    } else {
      const errorText = await response.text();
      console.error(`   ❌ Batch ${i + 1} failed: ${response.status}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

async function verifyResults() {
  console.log('\n📊 Final Verification...\n');
  
  const { data: vehicles, error } = await supabase
    .from('organization_vehicles')
    .select('vehicle_id, vehicles(year, make, model, discovery_url)')
    .eq('organization_id', ORGANIZATION_ID);
  
  if (error) {
    console.error('❌ Error checking vehicles:', error);
    return;
  }
  
  console.log(`✅ TOTAL VEHICLES LINKED TO ORGANIZATION: ${vehicles?.length || 0}\n`);
  
  if (vehicles && vehicles.length > 0) {
    console.log('📋 Complete Vehicle List:');
    vehicles.forEach((v, i) => {
      const vehicle = v.vehicles;
      console.log(`   ${i + 1}. ${vehicle.year || '?'} ${vehicle.make || ''} ${vehicle.model || ''}`);
      if (vehicle.discovery_url) {
        console.log(`      → ${vehicle.discovery_url}`);
      }
    });
  }
}

async function main() {
  console.log('🚗 The Shop Auto Group - COMPLETE Inventory Extraction');
  console.log('='.repeat(60));
  console.log(`Organization ID: ${ORGANIZATION_ID}\n`);

  try {
    // Extract from BaT dealer profile (should get all their BaT listings)
    await extractFromBATDealerProfile();
    
    // Extract from Cars & Bids user page
    await extractFromCarsAndBids();
    
    // Final verification
    await verifyResults();
    
    console.log('\n✅ COMPLETE EXTRACTION FINISHED!');
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

main().catch(console.error);

