#!/usr/bin/env node

/**
 * Get Fixed Vehicle URLs
 * Shows the direct URLs to view the vehicles we just fixed
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

async function getRecentlyFixedVehicles() {
  console.log('🔍 Getting recently fixed vehicles for UI viewing...\n');

  // Get vehicles updated in the last hour (our fixes)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, mileage, engine_size, sale_price, discovery_url, bat_auction_url, updated_at')
    .or('discovery_url.not.is.null,bat_auction_url.not.is.null')
    .gte('updated_at', oneHourAgo)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('❌ Error fetching vehicles:', error);
    return;
  }

  console.log(`📊 Found ${vehicles.length} recently fixed vehicles\n`);

  console.log('🚗 FIXED VEHICLES - VIEW IN UI:');
  console.log('='.repeat(80));

  vehicles.forEach((vehicle, i) => {
    const sourceUrl = vehicle.discovery_url || vehicle.bat_auction_url;
    const sourceType = sourceUrl?.includes('bringatrailer.com') ? 'BaT' : 'Other';

    console.log(`\n${i + 1}. ${vehicle.year} ${vehicle.make} ${vehicle.model} [${sourceType}]`);
    console.log(`   📱 UI URL: https://n-zero.dev/vehicles/${vehicle.id}`);
    console.log(`   🔗 Source: ${sourceUrl}`);
    console.log(`   💾 Fixed Data:`);
    console.log(`      VIN: ${vehicle.vin || 'null'}`);
    console.log(`      Mileage: ${vehicle.mileage ? vehicle.mileage.toLocaleString() : 'null'}`);
    console.log(`      Engine: ${vehicle.engine_size || 'null'}`);
    console.log(`      Sale Price: ${vehicle.sale_price ? '$' + vehicle.sale_price.toLocaleString() : 'null'}`);
    console.log(`   🕐 Fixed: ${new Date(vehicle.updated_at).toLocaleString()}`);
  });

  console.log('\n📱 QUICK ACCESS LINKS:');
  console.log('='.repeat(50));

  // Show first 5 as quick links
  vehicles.slice(0, 5).forEach((vehicle, i) => {
    console.log(`${i + 1}. https://n-zero.dev/vehicles/${vehicle.id}`);
  });

  if (vehicles.length > 5) {
    console.log(`... and ${vehicles.length - 5} more vehicles fixed`);
  }

  // Show comparison examples
  if (vehicles.length > 0) {
    console.log('\n🔍 BEFORE/AFTER EXAMPLES:');
    console.log('-'.repeat(40));

    const examples = [
      {
        name: '2025 Porsche Taycan',
        before: 'Mileage: 10,000',
        after: 'Mileage: 141 (corrected from source)'
      },
      {
        name: '1985 Alfa Romeo Spider',
        before: 'Mileage: 60,000, Engine: null',
        after: 'Mileage: 20, Engine: 2.0-liter DOHC'
      },
      {
        name: '1999 Chevy K2500',
        before: 'VIN: null, Engine: null',
        after: 'VIN: 1GCGK23J1XF088525, Engine: 7.4-liter V8'
      }
    ];

    examples.forEach(ex => {
      console.log(`• ${ex.name}:`);
      console.log(`  Before: ${ex.before}`);
      console.log(`  After:  ${ex.after}`);
    });
  }

  console.log('\n💡 View these URLs in your browser to see the fixed data immediately!');
}

getRecentlyFixedVehicles().catch(console.error);