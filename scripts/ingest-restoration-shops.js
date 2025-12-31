#!/usr/bin/env node

/**
 * Ingest Premium Restoration Shops
 * 
 * Simple, direct approach:
 * 1. Extract organizations
 * 2. Discover vehicle URLs for each org
 * 3. Create vehicles directly (no queue)
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const SHOPS = [
  { url: 'https://www.velocityrestorations.com/', name: 'Velocity Restorations' },
  { url: 'https://kindredmotorworks.com/', name: 'Kindred Motorworks' },
  { url: 'https://www.bespoke4x4.com/', name: 'Bespoke 4x4' },
  { url: 'https://www.brabus.com/', name: 'BRABUS' },
  { url: 'https://www.the-landrovers.com/', name: 'The Land Rovers' },
  { url: 'https://www.helderburg.com/', name: 'Helderburg' }
];

/**
 * Extract organization from website
 */
async function extractOrganization(shop) {
  console.log(`\n🏢 Extracting organization: ${shop.name}`);
  console.log(`   URL: ${shop.url}`);

  try {
    const { data, error } = await supabase.functions.invoke('extract-organization-from-seller', {
      body: {
        website: shop.url,
        source_url: shop.url
      },
      timeout: 60000
    });

    if (error) {
      console.error(`   ❌ Error: ${error.message}`);
      return null;
    }

    const orgId = data?.organization_id || data?.data?.organization_id;
    if (orgId) {
      console.log(`   ✅ Organization ID: ${orgId}`);
      return orgId;
    }

    console.warn(`   ⚠️  No organization ID returned`);
    return null;
  } catch (err) {
    console.error(`   ❌ Exception: ${err.message}`);
    return null;
  }
}

/**
 * Discover vehicle URLs from organization website
 */
async function discoverVehicleUrls(orgId, shop) {
  console.log(`\n🔍 Discovering vehicles for: ${shop.name}`);

  // Try common inventory URL patterns
  const inventoryUrls = [
    `${shop.url}inventory`,
    `${shop.url}vehicles`,
    `${shop.url}models`,
    `${shop.url}available`,
    `${shop.url}`
  ];

  for (const inventoryUrl of inventoryUrls) {
    console.log(`   Trying: ${inventoryUrl}`);

    try {
      const { data, error } = await supabase.functions.invoke('scrape-multi-source', {
        body: {
          source_url: inventoryUrl,
          source_type: 'dealer_website',
          organization_id: orgId,
          extract_listings: true,
          extract_dealer_info: false,
          max_listings: 1000
        },
        timeout: 120000
      });

      if (error) {
        console.warn(`   ⚠️  Error: ${error.message}`);
        continue;
      }

      const listings = data?.listings || data?.data?.listings || [];
      if (listings.length > 0) {
        console.log(`   ✅ Found ${listings.length} vehicle URLs`);
        return listings.map(l => l.url || l.listing_url).filter(Boolean);
      }
    } catch (err) {
      console.warn(`   ⚠️  Exception: ${err.message}`);
      continue;
    }
  }

  console.warn(`   ⚠️  No vehicles found`);
  return [];
}

/**
 * Create vehicle from URL (direct, no queue)
 */
async function createVehicle(vehicleUrl, orgId) {
  // Check if already exists
  const { data: existing } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .eq('discovery_url', vehicleUrl)
    .maybeSingle();

  if (existing) {
    console.log(`   ⏭️  Already exists: ${existing.year} ${existing.make} ${existing.model}`);
    
    // Ensure org link exists
    const { data: existingLink } = await supabase
      .from('organization_vehicles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('vehicle_id', existing.id)
      .maybeSingle();

    if (!existingLink) {
      await supabase.from('organization_vehicles').insert({
        organization_id: orgId,
        vehicle_id: existing.id,
        relationship_type: 'seller',
        status: 'active'
      });
      console.log(`   🔗 Linked to organization`);
    }

    return { success: true, skipped: true, vehicleId: existing.id };
  }

  // Scrape vehicle data
  const { data: scrapedData, error: scrapeError } = await supabase.functions.invoke('scrape-vehicle', {
    body: { url: vehicleUrl },
    timeout: 60000
  });

  if (scrapeError || !scrapedData) {
    console.warn(`   ❌ Scrape failed: ${scrapeError?.message || 'No data'}`);
    return { success: false, error: scrapeError?.message };
  }

  // Extract vehicle data
  const year = scrapedData.year || scrapedData.data?.year;
  const make = scrapedData.make || scrapedData.data?.make;
  const model = scrapedData.model || scrapedData.data?.model;

  if (!year || !make || !model) {
    console.warn(`   ⚠️  Missing required fields: year=${year}, make=${make}, model=${model}`);
    return { success: false, error: 'Missing required fields' };
  }

  // Create vehicle directly
  const { data: newVehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .insert({
      year: parseInt(year),
      make: make.trim(),
      model: model.trim(),
      vin: scrapedData.vin || scrapedData.data?.vin || null,
      mileage: scrapedData.mileage || scrapedData.data?.mileage || null,
      color: scrapedData.color || scrapedData.data?.color || scrapedData.data?.exterior_color || null,
      transmission: scrapedData.transmission || scrapedData.data?.transmission || null,
      engine: scrapedData.engine || scrapedData.data?.engine || null,
      asking_price: scrapedData.asking_price || scrapedData.data?.asking_price || scrapedData.data?.price || null,
      notes: scrapedData.description || scrapedData.data?.description || null,
      discovery_url: vehicleUrl,
      status: 'active',
      is_public: true,
      profile_origin: 'scraped',
      discovery_source: 'restoration_shop',
      origin_metadata: {
        imported_at: new Date().toISOString(),
        image_urls: scrapedData.images || scrapedData.data?.images || [],
        source_url: vehicleUrl,
        organization_id: orgId
      }
    })
    .select('id, year, make, model')
    .single();

  if (vehicleError) {
    console.error(`   ❌ Create failed: ${vehicleError.message}`);
    return { success: false, error: vehicleError.message };
  }

  console.log(`   ✅ Created: ${newVehicle.year} ${newVehicle.make} ${newVehicle.model} (${newVehicle.id})`);

  // Link to organization
  await supabase.from('organization_vehicles').insert({
    organization_id: orgId,
    vehicle_id: newVehicle.id,
    relationship_type: 'seller',
    status: 'active'
  });
  console.log(`   🔗 Linked to organization`);

  return { success: true, vehicleId: newVehicle.id, vehicle: newVehicle };
}

/**
 * Main ingestion function
 */
async function main() {
  console.log('🚀 Ingesting Premium Restoration Shops');
  console.log('='.repeat(60));
  console.log(`Shops: ${SHOPS.length}\n`);

  const results = {
    orgs_extracted: 0,
    orgs_failed: 0,
    vehicles_created: 0,
    vehicles_skipped: 0,
    vehicles_failed: 0
  };

  for (const shop of SHOPS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Processing: ${shop.name}`);
    console.log('='.repeat(60));

    // Step 1: Extract organization
    const orgId = await extractOrganization(shop);
    if (!orgId) {
      results.orgs_failed++;
      continue;
    }
    results.orgs_extracted++;

    // Step 2: Discover vehicle URLs
    const vehicleUrls = await discoverVehicleUrls(orgId, shop);
    if (vehicleUrls.length === 0) {
      console.log(`   ⚠️  No vehicles found, skipping`);
      continue;
    }

    console.log(`\n📦 Processing ${vehicleUrls.length} vehicles...`);

    // Step 3: Create vehicles
    for (let i = 0; i < vehicleUrls.length; i++) {
      const url = vehicleUrls[i];
      console.log(`\n   [${i + 1}/${vehicleUrls.length}] ${url}`);

      const result = await createVehicle(url, orgId);

      if (result.success) {
        if (result.skipped) {
          results.vehicles_skipped++;
        } else {
          results.vehicles_created++;
        }
      } else {
        results.vehicles_failed++;
      }

      // Small delay between vehicles
      if (i < vehicleUrls.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('📊 INGESTION SUMMARY');
  console.log('='.repeat(60));
  console.log(`Organizations:`);
  console.log(`   ✅ Extracted: ${results.orgs_extracted}`);
  console.log(`   ❌ Failed: ${results.orgs_failed}`);
  console.log(`\nVehicles:`);
  console.log(`   ✅ Created: ${results.vehicles_created}`);
  console.log(`   ⏭️  Skipped: ${results.vehicles_skipped}`);
  console.log(`   ❌ Failed: ${results.vehicles_failed}`);
  console.log('='.repeat(60));
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { extractOrganization, discoverVehicleUrls, createVehicle, main };


