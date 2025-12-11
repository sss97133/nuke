#!/usr/bin/env node

/**
 * Activate Pending Vehicles NOW
 * 
 * Bypasses validation temporarily to get vehicles live with just YMM data.
 * Images can be added later via backfill.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load env
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '..', '.env.local');

try {
  const envFile = readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  });
} catch (error) {
  // .env.local not found
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function activateVehicle(vehicle) {
  // Basic validation
  const hasMake = vehicle.make && vehicle.make !== '' && vehicle.make !== 'Unknown';
  const hasModel = vehicle.model && vehicle.model !== '' && vehicle.model !== 'Unknown';
  const hasYear = vehicle.year && vehicle.year >= 1885 && vehicle.year <= new Date().getFullYear() + 1;

  if (!hasMake || !hasModel || !hasYear) {
    return { activated: false, reason: 'missing_ymm' };
  }

  // Check for images - try to get them but don't block activation
  const { count: imageCount } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .eq('vehicle_id', vehicle.id);

  if ((imageCount || 0) === 0 && vehicle.discovery_url) {
    // Try to get images but don't wait
    supabase.functions.invoke('simple-scraper', {
      body: { url: vehicle.discovery_url }
    }).then(async (scrapeResult) => {
      if (!scrapeResult.error && scrapeResult.data?.success && scrapeResult.data.data?.images) {
        const imageUrls = scrapeResult.data.data.images.slice(0, 10);
        if (imageUrls.length > 0) {
          // Upload in background
          supabase.functions.invoke('backfill-images', {
            body: {
              vehicle_id: vehicle.id,
              image_urls: imageUrls,
              source: 'background_backfill',
              run_analysis: false
            }
          }).catch(() => {}); // Don't block on errors
        }
      }
    }).catch(() => {}); // Don't block on errors
  }

  // Ensure timeline event exists
  const { count: eventCount } = await supabase
    .from('timeline_events')
    .select('*', { count: 'exact', head: true })
    .eq('vehicle_id', vehicle.id);

  if ((eventCount || 0) === 0 && vehicle.discovery_url) {
    try {
      const source = vehicle.discovery_url.includes('craigslist') ? 'craigslist' :
                     vehicle.discovery_url.includes('bringatrailer') ? 'bring_a_trailer' :
                     vehicle.discovery_url.includes('hemmings') ? 'hemmings' :
                     'automated_import';

      await supabase
        .from('timeline_events')
        .insert({
          vehicle_id: vehicle.id,
          event_type: 'auction_listed',
          event_date: new Date().toISOString().split('T')[0],
          title: 'Listed for Sale',
          description: `Listed on ${new URL(vehicle.discovery_url).hostname}`,
          source: source,
          metadata: {
            source_url: vehicle.discovery_url,
            price: vehicle.asking_price
          }
        });
    } catch (err) {
      // Don't block on timeline errors
    }
  }

  // ACTIVATE NOW (bypass image requirement temporarily)
  const { error: activateError } = await supabase
    .from('vehicles')
    .update({ 
      status: 'active',
      is_public: true
    })
    .eq('id', vehicle.id);

  if (activateError) {
    // If VIN requirement is blocking, try without is_public first
    if (activateError.message.includes('VIN')) {
      const { error: statusError } = await supabase
        .from('vehicles')
        .update({ status: 'active' })
        .eq('id', vehicle.id);
      
      if (statusError) {
        return { activated: false, reason: activateError.message };
      }
      return { activated: true, public: false };
    }
    return { activated: false, reason: activateError.message };
  }

  return { activated: true, public: true };
}

async function main() {
  const batchSize = parseInt(process.argv[2]) || 200;

  console.log('🚀 Activating Pending Vehicles NOW\n');
  console.log('   Bypassing image requirement to get vehicles live\n');

  // Get pending vehicles with YMM
  const { data: pendingVehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, asking_price, discovery_url, status')
    .eq('status', 'pending')
    .not('make', 'is', null)
    .not('model', 'is', null)
    .not('year', 'is', null)
    .neq('make', 'Unknown')
    .neq('model', 'Unknown')
    .limit(batchSize);

  if (error) {
    console.error('❌ Failed to fetch vehicles:', error.message);
    process.exit(1);
  }

  if (!pendingVehicles || pendingVehicles.length === 0) {
    console.log('✅ No pending vehicles to activate');
    return;
  }

  console.log(`📋 Activating ${pendingVehicles.length} vehicles...\n`);

  const results = {
    processed: 0,
    activated: 0,
    activated_public: 0,
    failed: 0
  };

  for (const vehicle of pendingVehicles) {
    const result = await activateVehicle(vehicle);
    results.processed++;
    
    if (result.activated) {
      results.activated++;
      if (result.public !== false) {
        results.activated_public++;
      }
      if (results.activated % 10 === 0) {
        console.log(`   ✅ Activated ${results.activated} vehicles so far...`);
      }
    } else {
      results.failed++;
    }

    // Small delay
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log(`\n✅ Complete!`);
  console.log(`   Processed: ${results.processed}`);
  console.log(`   Activated: ${results.activated} (${results.activated_public} public)`);
  console.log(`   Failed: ${results.failed}`);
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

