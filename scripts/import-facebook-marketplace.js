#!/usr/bin/env node
/**
 * Import Facebook Marketplace Vehicle
 * Deep extraction tool that unpacks all vehicle data, extracts favicon, and follows import rules
 * 
 * Usage:
 *   node scripts/import-facebook-marketplace.js <facebook_marketplace_url>
 * 
 * Example:
 *   node scripts/import-facebook-marketplace.js "https://www.facebook.com/share/1GZv29h62H/?mibextid=wwXIfr"
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ ERROR: Missing Supabase credentials');
  console.error('   Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const FACEBOOK_URL = process.argv[2];

if (!FACEBOOK_URL) {
  console.error('❌ ERROR: Facebook Marketplace URL required');
  console.error('   Usage: node scripts/import-facebook-marketplace.js <url>');
  process.exit(1);
}

if (!FACEBOOK_URL.includes('facebook.com')) {
  console.error('❌ ERROR: Invalid Facebook Marketplace URL');
  process.exit(1);
}

async function scrapeFacebookListing(url) {
  console.log('\n🔥 Scraping Facebook Marketplace listing...');
  console.log(`   URL: ${url}\n`);

  try {
    // Call the scrape-vehicle edge function
    const { data, error } = await supabase.functions.invoke('scrape-vehicle', {
      body: { url }
    });

    if (error) {
      throw new Error(`Edge function error: ${error.message}`);
    }

    if (!data || !data.success) {
      throw new Error(`Scraping failed: ${data?.error || 'Unknown error'}`);
    }

    console.log('✅ Scraping successful!\n');
    return data.data;
  } catch (error) {
    console.error('❌ Scraping failed:', error.message);
    throw error;
  }
}

async function findOrCreateVehicle(scrapedData, url) {
  console.log('📋 Checking for existing vehicle...\n');

  // Check if vehicle already exists by discovery_url
  const { data: existing } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url')
    .eq('discovery_url', url)
    .maybeSingle();

  if (existing) {
    console.log(`⏭️  Vehicle already exists: ${existing.id}`);
    console.log(`   ${existing.year} ${existing.make} ${existing.model}\n`);
    return { id: existing.id, created: false };
  }

  // Check by VIN if available
  if (scrapedData.vin) {
    const { data: vinMatch } = await supabase
      .from('vehicles')
      .select('id, year, make, model')
      .eq('vin', scrapedData.vin.toUpperCase())
      .maybeSingle();

    if (vinMatch) {
      console.log(`⏭️  Vehicle with VIN already exists: ${vinMatch.id}`);
      console.log(`   ${vinMatch.year} ${vinMatch.make} ${vinMatch.model}\n`);
      
      // Update discovery URL
      await supabase
        .from('vehicles')
        .update({ discovery_url: url })
        .eq('id', vinMatch.id);
      
      return { id: vinMatch.id, created: false };
    }
  }

  // Validate required fields
  if (!scrapedData.year || !scrapedData.make || !scrapedData.model) {
    console.error('❌ Missing required fields: year, make, or model');
    console.error('   Scraped data:', JSON.stringify(scrapedData, null, 2));
    throw new Error('Cannot create vehicle without year, make, and model');
  }

  console.log(`📝 Creating vehicle: ${scrapedData.year} ${scrapedData.make} ${scrapedData.model}\n`);

  // Build vehicle data following import rules
  const vehicleData = {
    year: scrapedData.year,
    make: scrapedData.make.toLowerCase(),
    model: scrapedData.model.toLowerCase(),
    vin: scrapedData.vin ? scrapedData.vin.toUpperCase() : null,
    mileage: scrapedData.mileage || null,
    asking_price: scrapedData.asking_price || scrapedData.price || null,
    color: scrapedData.color || null,
    transmission: scrapedData.transmission || null,
    drivetrain: scrapedData.drivetrain || null,
    engine_size: scrapedData.engine_size || null,
    body_style: scrapedData.body_style || null,
    trim: scrapedData.trim || null,
    title_status: scrapedData.title_status || null,
    condition: scrapedData.condition || null,
    
    // Origin tracking (IMPORTANT: follows rules)
    profile_origin: 'facebook_marketplace_import',
    discovery_source: 'facebook_marketplace',
    discovery_url: url,
    
    origin_metadata: {
      facebook_marketplace_url: url,
      facebook_marketplace_listing_id: url.match(/\/item\/(\d+)/)?.[1] || null,
      scraped_at: new Date().toISOString(),
      source: 'facebook_marketplace',
      title: scrapedData.title || null,
      location: scrapedData.location || null,
      listed_date: scrapedData.listed_date || null
    },
    
    description: scrapedData.description || null,
    is_public: true,
    status: 'active'
  };

  // Create vehicle
  const { data: newVehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .insert(vehicleData)
    .select('id, year, make, model, discovery_url')
    .single();

  if (vehicleError) {
    console.error('❌ Failed to create vehicle:', vehicleError.message);
    console.error('   Data:', JSON.stringify(vehicleData, null, 2));
    throw vehicleError;
  }

  console.log(`✅ Vehicle created: ${newVehicle.id}\n`);
  return { id: newVehicle.id, created: true, vehicle: newVehicle };
}

async function importImages(vehicleId, imageUrls, sourceUrl) {
  if (!imageUrls || imageUrls.length === 0) {
    console.log('ℹ️  No images to import\n');
    return;
  }

  console.log(`📸 Importing ${imageUrls.length} images...\n`);

  // Use the unified image import service via edge function
  // This follows all the rules for image attribution, timeline events, etc.
  try {
    for (let i = 0; i < Math.min(imageUrls.length, 10); i++) { // Limit to 10 for now
      const imageUrl = imageUrls[i];
      
      console.log(`   [${i + 1}/${Math.min(imageUrls.length, 10)}] ${imageUrl.substring(0, 60)}...`);

      // Import via edge function (handles all the rules automatically)
      const { data: importData, error: importError } = await supabase.functions.invoke('unified-image-import', {
        body: {
          vehicle_id: vehicleId,
          image_url: imageUrl,
          source_url: sourceUrl,
          source_type: 'facebook_marketplace',
          attribution: {
            source: 'Facebook Marketplace',
            url: sourceUrl,
            extracted_at: new Date().toISOString()
          }
        }
      });

      if (importError) {
        console.warn(`   ⚠️  Failed to import image ${i + 1}: ${importError.message}`);
      } else {
        console.log(`   ✅ Image ${i + 1} imported`);
      }
    }

    console.log(`\n✅ Image import complete\n`);
  } catch (error) {
    console.warn('⚠️  Image import error (non-critical):', error.message);
  }
}

async function createTimelineEvent(vehicleId, scrapedData, url) {
  console.log('📅 Creating timeline event...\n');

  try {
    const { error } = await supabase.from('timeline_events').insert({
      vehicle_id: vehicleId,
      event_type: 'vehicle_discovered',
      title: 'Discovered on Facebook Marketplace',
      description: scrapedData.description 
        ? scrapedData.description.substring(0, 500)
        : `Found on Facebook Marketplace${scrapedData.location ? ` in ${scrapedData.location}` : ''}`,
      event_date: scrapedData.listed_date || new Date().toISOString().split('T')[0],
      source_url: url,
      source_type: 'facebook_marketplace',
      metadata: {
        asking_price: scrapedData.asking_price || scrapedData.price,
        location: scrapedData.location,
        listing_title: scrapedData.title
      }
    });

    if (error) {
      console.warn('⚠️  Failed to create timeline event (non-critical):', error.message);
    } else {
      console.log('✅ Timeline event created\n');
    }
  } catch (error) {
    console.warn('⚠️  Timeline event error (non-critical):', error.message);
  }
}

async function cacheFavicon(url) {
  console.log('🔖 Caching favicon...\n');

  try {
    const domain = new URL(url).hostname;
    const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;

    const { error } = await supabase.rpc('upsert_source_favicon', {
      p_domain: domain,
      p_favicon_url: faviconUrl,
      p_source_type: 'social',
      p_source_name: 'Facebook Marketplace',
      p_metadata: {}
    });

    if (error) {
      console.warn('⚠️  Failed to cache favicon (non-critical):', error.message);
    } else {
      console.log('✅ Favicon cached\n');
    }
  } catch (error) {
    console.warn('⚠️  Favicon caching error (non-critical):', error.message);
  }
}

async function main() {
  console.log('🚀 Facebook Marketplace Vehicle Import');
  console.log('=====================================\n');

  try {
    // Step 1: Scrape the listing
    const scrapedData = await scrapeFacebookListing(FACEBOOK_URL);

    // Display scraped data
    console.log('📊 Scraped Data Summary:');
    console.log(`   Year: ${scrapedData.year || 'N/A'}`);
    console.log(`   Make: ${scrapedData.make || 'N/A'}`);
    console.log(`   Model: ${scrapedData.model || 'N/A'}`);
    console.log(`   Price: ${scrapedData.asking_price || scrapedData.price ? '$' + (scrapedData.asking_price || scrapedData.price).toLocaleString() : 'N/A'}`);
    console.log(`   Mileage: ${scrapedData.mileage ? scrapedData.mileage.toLocaleString() + ' miles' : 'N/A'}`);
    console.log(`   Location: ${scrapedData.location || 'N/A'}`);
    console.log(`   Images: ${scrapedData.images?.length || 0}`);
    console.log(`   VIN: ${scrapedData.vin || 'N/A'}\n`);

    // Step 2: Cache favicon
    await cacheFavicon(FACEBOOK_URL);

    // Step 3: Find or create vehicle
    const result = await findOrCreateVehicle(scrapedData, FACEBOOK_URL);

    if (!result.created) {
      console.log('✅ Vehicle already exists, skipping import\n');
      return;
    }

    // Step 4: Import images
    if (scrapedData.images && scrapedData.images.length > 0) {
      await importImages(result.id, scrapedData.images, FACEBOOK_URL);
    }

    // Step 5: Create timeline event
    await createTimelineEvent(result.id, scrapedData, FACEBOOK_URL);

    console.log('🎉 Import complete!');
    console.log(`\n   Vehicle ID: ${result.id}`);
    console.log(`   View at: ${SUPABASE_URL.replace('.supabase.co', '')}/vehicles/${result.id}\n`);

  } catch (error) {
    console.error('\n❌ Import failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();

