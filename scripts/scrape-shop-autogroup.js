#!/usr/bin/env node
/**
 * Scrape The Shop Auto Group inventory directly
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const ORGANIZATION_ID = '0b8219ae-9d9b-447c-978c-3a30ab37fd49'; // The Shop
const INVENTORY_URL = 'https://autogroup.theshopclubs.com/inventory/';

async function scrapeInventory() {
  console.log('🚗 Scraping The Shop Auto Group Inventory');
  console.log(`   Organization ID: ${ORGANIZATION_ID}`);
  console.log(`   Inventory URL: ${INVENTORY_URL}\n`);

  try {
    const functionUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/scrape-multi-source`;
    
    console.log(`📡 Calling scrape-multi-source...\n`);

    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({
        source_url: INVENTORY_URL,
        source_type: 'dealer_website',
        organization_id: ORGANIZATION_ID,
        max_results: 500,
        use_llm_extraction: true,
        extract_dealer_info: false,
        include_sold: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ HTTP ${response.status}: ${errorText}`);
      process.exit(1);
    }

    const result = await response.json();

    if (!result.success) {
      console.error('❌ Scraping failed:', result.error);
      process.exit(1);
    }

    console.log('✅ Scraping Complete!\n');
    console.log('Results:');
    console.log(`  - Listings Found: ${result.listings_found || 0}`);
    console.log(`  - Listings Queued: ${result.listings_queued || 0}`);
    console.log(`  - Duplicates Skipped: ${result.duplicates_skipped || 0}\n`);

    if (result.listings_queued > 0) {
      console.log('🎉 Successfully queued vehicles!');
      console.log('   Processing import queue now...\n');
      
      // Process the queue to create vehicle profiles
      await processImportQueue();
    }

    return result;
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

async function processImportQueue() {
  console.log('📦 Processing import queue...\n');
  
  try {
    const functionUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/process-import-queue`;
    
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({
        batch_size: 50,
        priority_only: false,
        skip_image_upload: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`⚠️  Queue processing failed: ${response.status} - ${errorText.substring(0, 200)}`);
      return;
    }

    const result = await response.json();
    
    if (result.success) {
      console.log('✅ Queue Processing Results:');
      console.log(`  - Processed: ${result.processed || 0}`);
      console.log(`  - Succeeded: ${result.succeeded || 0}`);
      console.log(`  - Failed: ${result.failed || 0}`);
      console.log(`  - Duplicates: ${result.duplicates || 0}`);
      
      if (result.vehicles_created && result.vehicles_created.length > 0) {
        console.log(`  - Vehicles Created: ${result.vehicles_created.length}`);
        console.log(`    First 5 IDs: ${result.vehicles_created.slice(0, 5).join(', ')}`);
      }
      console.log('');
    }
  } catch (error) {
    console.warn(`⚠️  Queue processing error: ${error.message}`);
  }
}

scrapeInventory().catch(console.error);

