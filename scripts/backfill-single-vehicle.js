#!/usr/bin/env node
/**
 * Backfill Single Vehicle
 * Quick script to audit and update a specific vehicle from its source
 * 
 * Usage:
 *   node backfill-single-vehicle.js <vehicle_id> [--dry-run] [--auto]
 * 
 * Examples:
 *   node backfill-single-vehicle.js 27cbe9de-8dba-4025-a830-af8b37d3069e --dry-run
 *   node backfill-single-vehicle.js 27cbe9de-8dba-4025-a830-af8b37d3069e --auto
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const vehicleId = process.argv[2];
const isDryRun = process.argv.includes('--dry-run');
const isAuto = process.argv.includes('--auto');

if (!vehicleId) {
  console.error('❌ Usage: node backfill-single-vehicle.js <vehicle_id> [--dry-run] [--auto]');
  process.exit(1);
}

async function auditAndBackfill() {
  console.log(`\n🔍 Auditing vehicle: ${vehicleId}\n`);
  
  // 1. GET CURRENT VEHICLE DATA
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .single();
  
  if (vehicleError || !vehicle) {
    console.error('❌ Vehicle not found:', vehicleError);
    process.exit(1);
  }
  
  console.log('📊 CURRENT DATA:');
  console.log(`  Year/Make/Model: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`  VIN: ${vehicle.vin || '❌ MISSING'}`);
  console.log(`  Mileage: ${vehicle.mileage || '❌ MISSING'}`);
  console.log(`  Transmission: ${vehicle.transmission || '❌ MISSING'}`);
  console.log(`  Engine: ${vehicle.engine || '❌ MISSING'}`);
  console.log(`  Exterior Color: ${vehicle.exterior_color || '❌ MISSING'}`);
  console.log(`  Interior Color: ${vehicle.interior_color || '❌ MISSING'}`);
  console.log(`  Drivetrain: ${vehicle.drivetrain || '❌ MISSING'}`);
  console.log(`  Seller: ${vehicle.seller_name || '❌ MISSING'}`);
  console.log(`  Source URL: ${vehicle.discovery_url || vehicle.bat_auction_url || '❌ NO SOURCE'}`);
  
  const sourceUrl = vehicle.discovery_url || vehicle.bat_auction_url;
  if (!sourceUrl) {
    console.error('\n❌ No source URL (discovery_url or bat_auction_url) - cannot backfill');
    process.exit(1);
  }
  
  // 2. CHECK QUALITY SCORE
  const { data: qualityScore } = await supabase
    .from('vehicle_quality_scores')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .single();
  
  if (qualityScore) {
    console.log(`\n📈 QUALITY SCORE: ${qualityScore.overall_score}/100`);
    if (qualityScore.issues && qualityScore.issues.length > 0) {
      console.log(`  Issues: ${qualityScore.issues.join(', ')}`);
    }
  }
  
  // 3. RE-SCRAPE FROM SOURCE
  console.log(`\n🔄 Re-scraping from source...`);
  console.log(`  ${sourceUrl}`);
  
  const { data: scrapeResult, error: scrapeError } = await supabase.functions.invoke('scrape-vehicle', {
    body: { url: sourceUrl }
  });
  
  if (scrapeError || !scrapeResult?.success) {
    console.error('❌ Scrape failed:', scrapeError || scrapeResult?.error);
    process.exit(1);
  }
  
  const newData = scrapeResult.data;
  console.log('✅ Scrape successful\n');
  
  // 4. COMPARE & SHOW DIFF
  console.log('🔍 COMPARISON (Old → New):\n');
  
  const fields = [
    { label: 'VIN', key: 'vin' },
    { label: 'Mileage', key: 'mileage' },
    { label: 'Transmission', key: 'transmission' },
    { label: 'Engine', key: 'engine' },
    { label: 'Exterior Color', key: 'exterior_color' },
    { label: 'Interior Color', key: 'interior_color' },
    { label: 'Drivetrain', key: 'drivetrain' },
    { label: 'Seller Name', key: 'seller_name' },
    { label: 'Description', key: 'description' }
  ];
  
  const updates = {};
  const additions = [];
  const modifications = [];
  
  for (const { label, key } of fields) {
    const oldVal = vehicle[key];
    const newVal = newData[key];
    
    if (!oldVal && newVal) {
      // NEW DATA FOUND
      console.log(`  ✨ ${label}: (none) → "${newVal}"`);
      updates[key] = newVal;
      additions.push(label);
    } else if (oldVal && newVal && oldVal !== newVal) {
      // DATA CHANGED
      console.log(`  🔄 ${label}: "${oldVal}" → "${newVal}"`);
      updates[key] = newVal;
      modifications.push(label);
    } else if (!oldVal && !newVal) {
      // BOTH MISSING
      console.log(`  ❌ ${label}: (none) → (none)`);
    }
  }
  
  // 5. SHOW SUMMARY
  console.log(`\n📊 SUMMARY:`);
  console.log(`  ✨ New fields: ${additions.length} (${additions.join(', ') || 'none'})`);
  console.log(`  🔄 Modified fields: ${modifications.length} (${modifications.join(', ') || 'none'})`);
  console.log(`  📝 Total updates: ${Object.keys(updates).length}`);
  
  if (Object.keys(updates).length === 0) {
    console.log('\n✅ No updates needed - data is current');
    return;
  }
  
  // 6. APPLY UPDATES (if not dry run)
  if (isDryRun) {
    console.log('\n🔍 DRY RUN - No changes applied');
    console.log('   Run without --dry-run to apply updates');
    return;
  }
  
  if (!isAuto) {
    console.log('\n❓ Apply these updates? (Press Enter to continue, Ctrl+C to cancel)');
    await waitForInput();
  }
  
  console.log('\n💾 Applying updates...');
  
  // Update vehicle
  const { error: updateError } = await supabase
    .from('vehicles')
    .update(updates)
    .eq('id', vehicleId);
  
  if (updateError) {
    console.error('❌ Update failed:', updateError);
    process.exit(1);
  }
  
  // Log extraction metadata
  for (const [field, value] of Object.entries(updates)) {
    const confidenceScore = field === 'seller_name' && String(value).split(' ').length === 1 
      ? 0.3  // Low confidence for first-name-only
      : 0.9; // High confidence
    
    await supabase.from('extraction_metadata').insert({
      vehicle_id: vehicleId,
      field_name: field,
      field_value: String(value),
      extraction_method: 'manual_backfill_script',
      scraper_version: 'manual_v1',
      source_url: sourceUrl,
      confidence_score: confidenceScore,
      validation_status: confidenceScore < 0.6 ? 'low_confidence' : 'unvalidated',
      raw_extraction_data: { manual_backfill: true, script_version: '1.0.0' }
    });
  }
  
  // Recalculate quality score
  await supabase.rpc('calculate_vehicle_quality_score', { p_vehicle_id: vehicleId });
  
  console.log('✅ Updates applied successfully!');
  console.log(`   View: https://nuke.ag/vehicle/${vehicleId}`);
  
  // Show new quality score
  const { data: newScore } = await supabase
    .from('vehicle_quality_scores')
    .select('overall_score, issues')
    .eq('vehicle_id', vehicleId)
    .single();
  
  if (newScore) {
    console.log(`\n📈 NEW QUALITY SCORE: ${newScore.overall_score}/100 (was: ${qualityScore?.overall_score || 0})`);
    if (newScore.issues && newScore.issues.length > 0) {
      console.log(`   Remaining issues: ${newScore.issues.join(', ')}`);
    } else {
      console.log(`   ✅ No issues remaining!`);
    }
  }
}

function waitForInput() {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question('', () => {
      rl.close();
      resolve();
    });
  });
}

auditAndBackfill().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});

