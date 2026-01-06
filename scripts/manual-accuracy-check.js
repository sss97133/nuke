#!/usr/bin/env node

/**
 * Manual Accuracy Check
 * Simple tool to manually compare source vs profile for known vehicles
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('❌ Missing Supabase configuration');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

async function checkKnownVehicle() {
  const testUrl = 'https://bringatrailer.com/listing/1985-bmw-m635csi-60/';

  console.log('🔍 MANUAL ACCURACY CHECK');
  console.log('='.repeat(60));
  console.log(`Testing: ${testUrl}\n`);

  // Get our current profile
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('*')
    .eq('source_url', testUrl)
    .single();

  if (!vehicle) {
    console.log('❌ Vehicle not found in database');
    return;
  }

  console.log('🚗 CURRENT PROFILE DATA');
  console.log('-'.repeat(40));
  console.log(`Identity: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`VIN: ${vehicle.vin || 'NULL'}`);
  console.log(`Engine: ${vehicle.engine || 'NULL'}`);
  console.log(`Transmission: ${vehicle.transmission || 'NULL'}`);
  console.log(`Mileage: ${vehicle.mileage || 'NULL'}`);
  console.log(`Price: ${vehicle.asking_price || vehicle.sale_price || 'NULL'}`);

  console.log('\n📋 KNOWN CORRECT DATA (from manual inspection)');
  console.log('-'.repeat(50));
  console.log('Identity: 1985 BMW M635CSI');
  console.log('VIN: WBAEE310101052137');
  console.log('Engine: 3.5-liter M88/3 inline-six');
  console.log('Transmission: Getrag five-speed manual');
  console.log('Mileage: ~85,000 miles (approximate)');
  console.log('Notable: MoTeC M84 ECU, Alpina wheels');

  console.log('\n✅ ACCURACY CHECK');
  console.log('-'.repeat(30));

  // Simple manual comparison
  const identityCorrect = vehicle.year == 1985 &&
                          vehicle.make?.toLowerCase().includes('bmw') &&
                          vehicle.model?.toLowerCase().includes('m635csi');

  const vinCorrect = vehicle.vin === 'WBAEE310101052137';

  const engineCorrect = vehicle.engine?.toLowerCase().includes('3.5') &&
                        vehicle.engine?.toLowerCase().includes('m88');

  const transmissionCorrect = vehicle.transmission?.toLowerCase().includes('getrag') &&
                             vehicle.transmission?.toLowerCase().includes('five');

  console.log(`🏷️  Identity: ${identityCorrect ? '✅' : '❌'}`);
  console.log(`🆔 VIN: ${vinCorrect ? '✅' : '❌'} ${vehicle.vin ? `(got: ${vehicle.vin})` : '(missing)'}`);
  console.log(`⚙️  Engine: ${engineCorrect ? '✅' : '❌'} ${vehicle.engine ? `(got: ${vehicle.engine})` : '(missing)'}`);
  console.log(`🔧 Transmission: ${transmissionCorrect ? '✅' : '❌'} ${vehicle.transmission ? `(got: ${vehicle.transmission})` : '(missing)'}`);

  const accuracyScore = [identityCorrect, vinCorrect, engineCorrect, transmissionCorrect].filter(x => x).length / 4;

  console.log(`\n📊 Manual Accuracy Score: ${(accuracyScore * 100).toFixed(1)}%`);

  if (accuracyScore < 0.5) {
    console.log('\n🚨 LOW ACCURACY - Extraction needs improvement');
  } else if (accuracyScore < 0.8) {
    console.log('\n⚠️  MODERATE ACCURACY - Some issues to fix');
  } else {
    console.log('\n✅ HIGH ACCURACY - Extraction working well');
  }

  console.log('\n💡 This manual check confirms what the extraction actually captured vs reality.');
  console.log('   Use this method to validate your automated accuracy audits are working correctly.');
}

async function checkBackfillProgress() {
  console.log('\n\n🔄 CHECKING BACKFILL PROGRESS');
  console.log('='.repeat(50));

  // Check a few vehicles that should have been backfilled
  const { data: recentBat } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, engine, transmission, source_url, updated_at')
    .like('source_url', '%bringatrailer.com%')
    .order('updated_at', { ascending: false })
    .limit(5);

  if (recentBat?.length) {
    console.log('📊 Recent BaT vehicles (may show backfill progress):');
    recentBat.forEach((v, i) => {
      const hasSpecs = !!(v.vin && v.engine);
      const emoji = hasSpecs ? '✅' : '❌';
      console.log(`${i + 1}. ${emoji} ${v.year} ${v.make} ${v.model}`);
      console.log(`   VIN: ${v.vin ? 'Has VIN' : 'Missing'} | Engine: ${v.engine ? 'Has Engine' : 'Missing'}`);
      console.log(`   Updated: ${new Date(v.updated_at).toLocaleString()}`);
    });
  }

  // Quick stats
  const { data: stats } = await supabase.rpc('get_bat_quality_stats');

  if (stats) {
    console.log('\n📊 Overall BaT Quality:');
    console.log(`• Vehicles with VIN: ${stats.vin_coverage}%`);
    console.log(`• Vehicles with Engine: ${stats.engine_coverage}%`);
  }
}

async function main() {
  await checkKnownVehicle();
  await checkBackfillProgress();

  console.log('\n📋 NEXT STEPS FOR TRUE ACCURACY TESTING');
  console.log('='.repeat(50));
  console.log('1. ✅ Manual spot checks (this script) - validates reality vs extracted data');
  console.log('2. 📊 Quality trends monitoring - tracks completeness over time');
  console.log('3. 🔄 Batch monitoring - automated accuracy checking');
  console.log('4. ⚡ Alert system - notifies when quality drops (site changes)');
  console.log('\nOnce accuracy is consistently high (>90%), reduce audit frequency.');
  console.log('Monitor in batches to catch when source sites change their structure.');
}

main().catch(console.error);