#!/usr/bin/env node

/**
 * Continuous Vehicle Import Script
 * 
 * Actively scrapes and imports vehicle profiles from multiple sources.
 * Focuses on getting vehicles into the database, not just trucks.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

// Sources to scrape - ALL vehicle types
const SOURCES = [
  // Craigslist - general vehicle searches
  { 
    url: 'https://craigslist.org/search/cta?query=classic+car&sort=date',
    name: 'Craigslist - Classic Cars',
    type: 'classifieds'
  },
  { 
    url: 'https://craigslist.org/search/cta?query=vintage&sort=date',
    name: 'Craigslist - Vintage',
    type: 'classifieds'
  },
  { 
    url: 'https://craigslist.org/search/cta?query=1970&sort=date',
    name: 'Craigslist - 1970s',
    type: 'classifieds'
  },
  { 
    url: 'https://craigslist.org/search/cta?query=1980&sort=date',
    name: 'Craigslist - 1980s',
    type: 'classifieds'
  },
  
  // KSL Cars
  { 
    url: 'https://cars.ksl.com/v2/search/category/Classic',
    name: 'KSL - Classic Cars',
    type: 'classifieds'
  },
  { 
    url: 'https://cars.ksl.com/v2/search/category/Truck',
    name: 'KSL - Trucks',
    type: 'classifieds'
  },
  
  // Bring a Trailer - recent listings
  { 
    url: 'https://bringatrailer.com/auctions/',
    name: 'BaT - Recent Auctions',
    type: 'auction'
  },
  { 
    url: 'https://bringatrailer.com/chevrolet/',
    name: 'BaT - Chevrolet',
    type: 'auction'
  },
  { 
    url: 'https://bringatrailer.com/ford/',
    name: 'BaT - Ford',
    type: 'auction'
  },
  
  // Hemmings
  { 
    url: 'https://www.hemmings.com/classifieds/cars-for-sale',
    name: 'Hemmings - All Listings',
    type: 'marketplace'
  },
];

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
    .maybeSingle();
  
  if (existing) {
    return { skipped: true, reason: 'already_in_queue' };
  }
  
  // Check if vehicle already exists
  const { data: existingVehicle } = await supabase
    .from('vehicles')
    .select('id')
    .eq('discovery_url', listingUrl)
    .maybeSingle();
  
  if (existingVehicle) {
    return { skipped: true, reason: 'vehicle_exists' };
  }
  
  // Add to queue
  const { error, data } = await supabase
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
    })
    .select('id')
    .single();
  
  if (error) {
    return { error: error.message };
  }
  
  return { success: true, id: data.id };
}

/**
 * Get or create scrape source
 */
async function getOrCreateSource(sourceName, sourceType, baseUrl) {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  
  const { data: existing } = await supabase
    .from('scrape_sources')
    .select('id')
    .eq('name', sourceName)
    .maybeSingle();
  
  if (existing) {
    return existing.id;
  }
  
  const { data: newSource, error } = await supabase
    .from('scrape_sources')
    .insert({
      name: sourceName,
      source_type: sourceType,
      base_url: baseUrl,
      is_active: true
    })
    .select('id')
    .single();
  
  if (error) {
    throw new Error(`Failed to create source: ${error.message}`);
  }
  
  return newSource.id;
}

/**
 * Scrape a source using intelligent crawler
 */
async function scrapeSource(source) {
  console.log(`\n🔍 Scraping: ${source.name}`);
  
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/intelligent-crawler`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({
        search_url: source.url,
        source_type: source.type,
        max_results: 30, // Get more results
        filter_trucks: false // Import ALL vehicles
      })
    });
    
    if (!response.ok) {
      throw new Error(`Scraper returned ${response.status}`);
    }
    
    const result = await response.json();
    
    if (!result.listings || result.listings.length === 0) {
      console.log(`   ⚠️  No listings found`);
      return { added: 0, skipped: 0 };
    }
    
    console.log(`   Found ${result.listings.length} listings`);
    
    // Get or create source record
    const sourceId = await getOrCreateSource(source.name, source.type, source.url);
    
    // Add listings to queue
    let added = 0;
    let skipped = 0;
    
    for (const listing of result.listings) {
      const result = await addToImportQueue(listing.url, sourceId, listing);
      
      if (result.success) {
        added++;
      } else if (result.skipped) {
        skipped++;
      } else {
        console.warn(`   ⚠️  Failed to add ${listing.url}: ${result.error}`);
      }
    }
    
    console.log(`   ✅ Added ${added} to queue, skipped ${skipped} duplicates`);
    return { added, skipped };
    
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    return { added: 0, skipped: 0, error: error.message };
  }
}

/**
 * Process import queue
 */
async function processQueue() {
  console.log('\n🔄 Processing import queue...');
  
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
    
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Queue processor returned ${response.status}: ${text}`);
    }
    
    const result = await response.json();
    console.log(`   ✅ Processed: ${result.processed || 0}, Created: ${result.vehicles_created?.length || 0}`);
    return result;
    
  } catch (error) {
    console.error(`   ❌ Error processing queue: ${error.message}`);
    return null;
  }
}

/**
 * Main loop
 */
async function main() {
  console.log('🚗 Starting continuous vehicle import...\n');
  
  let cycle = 0;
  const maxCycles = Infinity; // Run indefinitely
  
  while (cycle < maxCycles) {
    cycle++;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 CYCLE ${cycle} - ${new Date().toLocaleString()}`);
    console.log('='.repeat(60));
    
    let totalAdded = 0;
    let totalSkipped = 0;
    
    // Scrape all sources
    for (const source of SOURCES) {
      const result = await scrapeSource(source);
      totalAdded += result.added || 0;
      totalSkipped += result.skipped || 0;
      
      // Small delay between sources
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.log(`\n📈 Cycle Summary:`);
    console.log(`   Added to queue: ${totalAdded}`);
    console.log(`   Skipped (duplicates): ${totalSkipped}`);
    
    // Process the queue
    if (totalAdded > 0) {
      await processQueue();
    } else {
      console.log('\n⏭️  No new items to process');
    }
    
    // Wait before next cycle (5 minutes)
    console.log(`\n⏳ Waiting 5 minutes before next cycle...`);
    await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { main, scrapeSource, addToImportQueue };

