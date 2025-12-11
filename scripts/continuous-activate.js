#!/usr/bin/env node

/**
 * Continuous Activation Script
 * 
 * Continuously activates pending vehicles to keep profiles going live
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

async function activateBatch(batchSize = 100) {
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

  if (error || !pendingVehicles || pendingVehicles.length === 0) {
    return { activated: 0, total: 0 };
  }

  let activated = 0;
  for (const vehicle of pendingVehicles) {
    // Ensure timeline event
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
        // Don't block
      }
    }

    // Activate
    const { error: activateError } = await supabase
      .from('vehicles')
      .update({ 
        status: 'active',
        is_public: true
      })
      .eq('id', vehicle.id);

    if (!activateError) {
      activated++;
    }
  }

  return { activated, total: pendingVehicles.length };
}

async function main() {
  console.log('🚀 Continuous Activation Script\n');
  console.log('   Activating pending vehicles continuously\n');

  let cycle = 0;
  let totalActivated = 0;

  while (true) {
    cycle++;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 CYCLE ${cycle} - ${new Date().toLocaleString()}`);
    console.log('='.repeat(60));

    const result = await activateBatch(100);
    totalActivated += result.activated;

    console.log(`✅ Activated: ${result.activated} vehicles`);
    console.log(`📈 Total activated this session: ${totalActivated}`);

    // Wait 2 minutes before next batch
    console.log(`\n⏳ Waiting 2 minutes before next batch...`);
    await new Promise(resolve => setTimeout(resolve, 2 * 60 * 1000));
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

