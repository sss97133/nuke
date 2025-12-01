/**
 * Backfill Missing Timeline Events for Scraped Vehicles
 * 
 * Creates timeline events for vehicles that have discovery_url but no timeline events
 */

import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
  },
});

async function createTimelineEventForVehicle(vehicle) {
  try {
    console.log(`\n📋 Creating timeline event for: ${vehicle.vehicle_name}`);
    console.log(`   Vehicle ID: ${vehicle.id}`);
    console.log(`   Discovery URL: ${vehicle.discovery_url}`);

    // Parse date from discovery_url or use created_at
    let eventDate = new Date(vehicle.created_at).toISOString().split('T')[0];
    
    // Try to extract date from URL (Craigslist URLs sometimes have dates)
    // Or scrape the listing to get the posted date
    let postedDate = null;
    if (vehicle.discovery_url.includes('craigslist.org')) {
      try {
        console.log(`   🔍 Scraping listing for posted date...`);
        const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke('scrape-vehicle', {
          body: { url: vehicle.discovery_url }
        });

        if (!scrapeError && scrapeData?.success && scrapeData?.data?.posted_date) {
          try {
            const parsedDate = new Date(scrapeData.data.posted_date);
            if (!isNaN(parsedDate.getTime())) {
              postedDate = parsedDate.toISOString().split('T')[0];
              eventDate = postedDate;
              console.log(`   ✅ Found posted date: ${eventDate}`);
            }
          } catch (e) {
            console.log(`   ⚠️  Could not parse posted date, using created_at`);
          }
        }
      } catch (e) {
        console.log(`   ⚠️  Scraping failed, using created_at date`);
      }
    }

    // Check if event already exists
    const { data: existingEvents } = await supabase
      .from('timeline_events')
      .select('id')
      .eq('vehicle_id', vehicle.id)
      .or(`title.ilike.%Listed on Craigslist%,title.ilike.%Vehicle Discovered%,title.ilike.%Listed on%`)
      .limit(1);

    if (existingEvents && existingEvents.length > 0) {
      console.log(`   ⏭️  Timeline event already exists, skipping`);
      return { success: false, reason: 'exists' };
    }

    // Determine event title and description
    let title = 'Listed on Craigslist';
    let description = `Vehicle listed for sale on Craigslist`;
    
    if (vehicle.discovery_url.includes('bringatrailer.com')) {
      title = 'Listed on Bring a Trailer';
      description = `Vehicle listed for sale on Bring a Trailer`;
    } else if (vehicle.discovery_url.includes('classiccars.com')) {
      title = 'Listed on ClassicCars.com';
      description = `Vehicle listed for sale on ClassicCars.com`;
    } else if (!vehicle.discovery_url.includes('craigslist.org')) {
      title = 'Vehicle Discovered';
      description = `Discovered on external listing`;
    }

    // Determine source value
    let source = 'external_listing';
    if (vehicle.discovery_url.includes('craigslist.org')) {
      source = 'craigslist';
    } else if (vehicle.discovery_url.includes('bringatrailer.com')) {
      source = 'bring_a_trailer';
    } else if (vehicle.discovery_url.includes('classiccars.com')) {
      source = 'classiccars';
    }

    // Create timeline event
    const eventData = {
      vehicle_id: vehicle.id,
      user_id: vehicle.uploaded_by,
      event_type: 'other', // Use 'other' which is always allowed
      source: source, // Required field
      event_date: eventDate,
      title: title,
      description: description,
      metadata: {
        listing_url: vehicle.discovery_url,
        source_type: vehicle.discovery_url.includes('craigslist.org') ? 'craigslist_listing' : 'external_listing',
        discovery: true,
        backfilled: true,
        backfilled_at: new Date().toISOString()
      }
    };

    const { error: insertError } = await supabase
      .from('timeline_events')
      .insert([eventData]);

    if (insertError) {
      console.error(`   ❌ Failed to create timeline event: ${insertError.message}`);
      return { success: false, reason: 'insert_error', error: insertError.message };
    }

    console.log(`   ✅ Created timeline event: "${title}" on ${eventDate}`);
    return { success: true, eventDate };

  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    return { success: false, reason: 'error', error: error.message };
  }
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔧 Backfilling Missing Timeline Events');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Find vehicles with discovery_url but no timeline events
  const { data: vehicles, error: vehiclesError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, created_at, uploaded_by')
    .not('discovery_url', 'is', null)
    .limit(100);

  if (vehiclesError) {
    console.error('Error fetching vehicles:', vehiclesError.message);
    process.exit(1);
  }

  if (!vehicles || vehicles.length === 0) {
    console.log('✅ No vehicles found that need timeline events');
    return;
  }

  console.log(`Found ${vehicles.length} vehicles with discovery_url\n`);

  // Check which ones are missing timeline events
  const vehiclesNeedingEvents = [];
  for (const vehicle of vehicles) {
    const { count } = await supabase
      .from('timeline_events')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', vehicle.id);

    if (count === 0) {
      vehiclesNeedingEvents.push({
        ...vehicle,
        vehicle_name: `${vehicle.year} ${vehicle.make} ${vehicle.model}`
      });
    }
  }

  if (vehiclesNeedingEvents.length === 0) {
    console.log('✅ All vehicles already have timeline events');
    return;
  }

  console.log(`📋 ${vehiclesNeedingEvents.length} vehicles need timeline events\n`);

  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  for (const vehicle of vehiclesNeedingEvents) {
    const result = await createTimelineEventForVehicle(vehicle);
    if (result.success) {
      successCount++;
    } else if (result.reason === 'exists') {
      skippedCount++;
    } else {
      errorCount++;
    }
    
    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 Results:');
  console.log(`   ✅ Created: ${successCount}`);
  console.log(`   ⏭️  Skipped: ${skippedCount}`);
  console.log(`   ❌ Errors: ${errorCount}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(console.error);

