#!/usr/bin/env node

/**
 * Comprehensive Truck Scraper
 * 
 * Scrapes trucks from all known sources and ensures they're stored in the database.
 * Filters specifically for trucks (pickups, C/K series, etc.)
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// All truck sources to scrape
const TRUCK_SOURCES = [
  // Craigslist (multiple cities)
  { 
    url: 'https://craigslist.org/search/cta?query=truck&sort=date',
    type: 'classifieds',
    name: 'Craigslist - All Trucks',
    filter: 'truck'
  },
  { 
    url: 'https://craigslist.org/search/cta?query=chevrolet+c10&sort=date',
    type: 'classifieds',
    name: 'Craigslist - C10',
    filter: 'c10'
  },
  { 
    url: 'https://craigslist.org/search/cta?query=chevrolet+k10&sort=date',
    type: 'classifieds',
    name: 'Craigslist - K10',
    filter: 'k10'
  },
  { 
    url: 'https://craigslist.org/search/cta?query=ford+f150&sort=date',
    type: 'classifieds',
    name: 'Craigslist - F150',
    filter: 'f150'
  },
  { 
    url: 'https://craigslist.org/search/cta?query=ram+1500&sort=date',
    type: 'classifieds',
    name: 'Craigslist - Ram 1500',
    filter: 'ram'
  },
  
  // KSL Cars
  { 
    url: 'https://cars.ksl.com/v2/search/category/Truck',
    type: 'classifieds',
    name: 'KSL - All Trucks',
    filter: 'truck'
  },
  { 
    url: 'https://cars.ksl.com/v2/search/make/Chevrolet/category/Truck',
    type: 'classifieds',
    name: 'KSL - Chevy Trucks',
    filter: 'chevrolet'
  },
  { 
    url: 'https://cars.ksl.com/v2/search/make/Ford/category/Truck',
    type: 'classifieds',
    name: 'KSL - Ford Trucks',
    filter: 'ford'
  },
  { 
    url: 'https://cars.ksl.com/v2/search/make/Ram/category/Truck',
    type: 'classifieds',
    name: 'KSL - Ram Trucks',
    filter: 'ram'
  },
  
  // Bring a Trailer
  { 
    url: 'https://bringatrailer.com/chevrolet/c10/',
    type: 'auction',
    name: 'BaT - C10',
    filter: 'c10'
  },
  { 
    url: 'https://bringatrailer.com/chevrolet/k10/',
    type: 'auction',
    name: 'BaT - K10',
    filter: 'k10'
  },
  { 
    url: 'https://bringatrailer.com/chevrolet/c20/',
    type: 'auction',
    name: 'BaT - C20',
    filter: 'c20'
  },
  { 
    url: 'https://bringatrailer.com/chevrolet/k20/',
    type: 'auction',
    name: 'BaT - K20',
    filter: 'k20'
  },
  { 
    url: 'https://bringatrailer.com/ford/f-150/',
    type: 'auction',
    name: 'BaT - F150',
    filter: 'f150'
  },
  
  // Hemmings
  { 
    url: 'https://www.hemmings.com/classifieds/cars-for-sale/chevrolet/c10',
    type: 'marketplace',
    name: 'Hemmings - C10',
    filter: 'c10'
  },
  { 
    url: 'https://www.hemmings.com/classifieds/cars-for-sale/chevrolet/k10',
    type: 'marketplace',
    name: 'Hemmings - K10',
    filter: 'k10'
  },
  { 
    url: 'https://www.hemmings.com/classifieds/cars-for-sale/ford/f-150',
    type: 'marketplace',
    name: 'Hemmings - F150',
    filter: 'f150'
  },
  
  // ClassicCars.com
  { 
    url: 'https://classiccars.com/listings/find/all/chevrolet/c-10',
    type: 'marketplace',
    name: 'ClassicCars - C10',
    filter: 'c10'
  },
  { 
    url: 'https://classiccars.com/listings/find/all/ford/f-150',
    type: 'marketplace',
    name: 'ClassicCars - F150',
    filter: 'f150'
  },
  
  // AutoTrader Classics
  { 
    url: 'https://classics.autotrader.com/classic-cars-for-sale/chevrolet-c10-for-sale',
    type: 'marketplace',
    name: 'AT Classics - C10',
    filter: 'c10'
  },
  { 
    url: 'https://classics.autotrader.com/classic-cars-for-sale/ford-f-150-for-sale',
    type: 'marketplace',
    name: 'AT Classics - F150',
    filter: 'f150'
  },
];

/**
 * Check if a vehicle is a truck
 */
function isTruck(make, model, title, description) {
  const searchText = `${make} ${model} ${title} ${description}`.toLowerCase();
  
  const truckKeywords = [
    'truck', 'pickup', 'c10', 'c20', 'c30', 'k10', 'k20', 'k30',
    'c1500', 'c2500', 'c3500', 'k1500', 'k2500', 'k3500',
    'f150', 'f250', 'f350', 'f450', 'f550',
    'ram 1500', 'ram 2500', 'ram 3500',
    'tacoma', 'tundra', 'ranger', 'colorado', 'canyon',
    'silverado', 'sierra', 'titan', 'frontier'
  ];
  
  const bodyStyleKeywords = ['pickup', 'truck', 'crew cab', 'extended cab', 'regular cab', 'shortbed', 'longbed'];
  
  return truckKeywords.some(kw => searchText.includes(kw)) ||
         bodyStyleKeywords.some(kw => searchText.includes(kw)) ||
         /^(c|k)\d{1,4}$/i.test(model) ||
         /^(c|k)\d{4}$/i.test(model);
}

/**
 * Add listing to import queue
 */
async function addToImportQueue(listingUrl, sourceId, listingData) {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  
  // Check if already in queue
  const { data: existing } = await supabase
    .from('import_queue')
    .select('id')
    .eq('listing_url', listingUrl)
    .single();
  
  if (existing) {
    console.log(`  ⏭️  Already in queue: ${listingUrl}`);
    return;
  }
  
  // Check if vehicle already exists
  const { data: existingVehicle } = await supabase
    .from('vehicles')
    .select('id')
    .eq('discovery_url', listingUrl)
    .single();
  
  if (existingVehicle) {
    console.log(`  ⏭️  Vehicle already exists: ${listingUrl}`);
    return;
  }
  
  // Add to queue
  const { error } = await supabase
    .from('import_queue')
    .insert({
      source_id: sourceId,
      listing_url: listingUrl,
      listing_title: listingData.title || '',
      listing_price: listingData.price || null,
      listing_year: listingData.year || null,
      listing_make: listingData.make || null,
      listing_model: listingData.model || null,
      thumbnail_url: listingData.thumbnail || null,
      raw_data: listingData,
      status: 'pending',
      priority: 1
    });
  
  if (error) {
    console.error(`  ❌ Failed to add to queue: ${error.message}`);
  } else {
    console.log(`  ✅ Added to queue: ${listingUrl}`);
  }
}

/**
 * Scrape a source and filter for trucks
 */
async function scrapeSource(source) {
  console.log(`\n🔍 Scraping: ${source.name}`);
  console.log(`   URL: ${source.url}`);
  
  try {
    // Call the intelligent crawler or scraper
    const response = await fetch(`${SUPABASE_URL}/functions/v1/intelligent-crawler`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({
        search_url: source.url,
        source_type: source.type,
        max_results: 50,
        filter_trucks: true // Tell crawler to filter for trucks
      })
    });
    
    if (!response.ok) {
      throw new Error(`Scraper returned ${response.status}`);
    }
    
    const result = await response.json();
    
    if (result.listings && result.listings.length > 0) {
      console.log(`   Found ${result.listings.length} listings`);
      
      // Get or create source record
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      
      const { data: sourceRecord } = await supabase
        .from('scrape_sources')
        .select('id')
        .eq('name', source.name)
        .single();
      
      let sourceId = sourceRecord?.id;
      
      if (!sourceId) {
        const { data: newSource, error } = await supabase
          .from('scrape_sources')
          .insert({
            name: source.name,
            source_type: source.type,
            base_url: source.url,
            is_active: true
          })
          .select('id')
          .single();
        
        if (error) {
          console.error(`   ❌ Failed to create source: ${error.message}`);
          return;
        }
        
        sourceId = newSource.id;
      }
      
      // Filter listings for trucks and add to queue
      let truckCount = 0;
      for (const listing of result.listings) {
        const listingText = `${listing.title || ''} ${listing.description || ''} ${listing.make || ''} ${listing.model || ''}`.toLowerCase();
        
        // Check if it's a truck
        if (isTruck(listing.make, listing.model, listing.title, listing.description)) {
          await addToImportQueue(listing.url, sourceId, listing);
          truckCount++;
        }
      }
      
      console.log(`   ✅ Added ${truckCount} trucks to import queue`);
    } else {
      console.log(`   ⚠️  No listings found`);
    }
    
  } catch (error) {
    console.error(`   ❌ Error scraping ${source.name}:`, error.message);
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('🚛 Starting comprehensive truck scraping...\n');
  console.log(`📊 Total sources: ${TRUCK_SOURCES.length}\n`);
  
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  
  for (const source of TRUCK_SOURCES) {
    try {
      await scrapeSource(source);
      succeeded++;
    } catch (error) {
      console.error(`❌ Failed to process ${source.name}:`, error.message);
      failed++;
    }
    
    processed++;
    
    // Rate limiting - wait between sources
    if (processed < TRUCK_SOURCES.length) {
      console.log('   ⏳ Waiting 2 seconds before next source...\n');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('📊 Scraping Summary:');
  console.log(`   Processed: ${processed}`);
  console.log(`   Succeeded: ${succeeded}`);
  console.log(`   Failed: ${failed}`);
  console.log('='.repeat(50));
  
  // Trigger processing of import queue
  console.log('\n🔄 Triggering import queue processing...');
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/process-import-queue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({
        batch_size: 20,
        priority_only: false
      })
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log(`✅ Queue processing started: ${result.processed || 0} items`);
    } else {
      console.error(`❌ Failed to trigger queue processing: ${response.status}`);
    }
  } catch (error) {
    console.error(`❌ Error triggering queue: ${error.message}`);
  }
  
  console.log('\n✅ Truck scraping complete!');
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { main, scrapeSource, isTruck };

