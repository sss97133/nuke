#!/usr/bin/env node
/**
 * Backfill Evidence for All Vehicles
 * 
 * Retroactively builds evidence trail from existing data:
 * - VIN decodes (highest authority)
 * - Extraction metadata
 * - Source URLs (BaT, KSL, Craigslist)
 * 
 * Usage:
 *   node scripts/backfill-all-evidence.js [--limit N] [--dry-run]
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function backfillAllEvidence(limit, dryRun = false) {
  console.log('\n🔍 BACKFILLING EVIDENCE FOR ALL VEHICLES\n');
  console.log(`   Limit: ${limit || 'ALL'}`);
  console.log(`   Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);
  
  // Get all vehicles
  let query = supabase
    .from('vehicles')
    .select('id, year, make, model, vin, discovery_url, bat_auction_url')
    .order('created_at', { ascending: false });
  
  if (limit) {
    query = query.limit(limit);
  }
  
  const { data: vehicles, error } = await query;
  
  if (error) {
    console.error('❌ Error fetching vehicles:', error);
    process.exit(1);
  }
  
  console.log(`📋 Found ${vehicles.length} vehicles\n`);
  
  // Stats
  const stats = {
    total: vehicles.length,
    processed: 0,
    evidence_created: 0,
    conflicts_found: 0,
    with_vin: 0,
    with_source: 0,
    errors: 0
  };
  
  // Process each vehicle
  for (const vehicle of vehicles) {
    const vehicleLabel = `${vehicle.year} ${vehicle.make} ${vehicle.model}`.trim() || vehicle.id;
    
    try {
      if (!dryRun) {
        const { data, error } = await supabase.rpc('backfill_evidence_for_vehicle', {
          p_vehicle_id: vehicle.id
        });
        
        if (error) {
          console.error(`❌ ${vehicleLabel}: ${error.message}`);
          stats.errors++;
          continue;
        }
        
        stats.processed++;
        stats.evidence_created += data.evidence_records_created || 0;
        stats.conflicts_found += data.conflicts_found || 0;
        if (data.has_vin_authority) stats.with_vin++;
        if (data.source_url) stats.with_source++;
        
        const icon = data.conflicts_found > 0 ? '⚠️ ' : '✅';
        console.log(`${icon} ${vehicleLabel}`);
        console.log(`   Evidence: ${data.evidence_records_created} | Conflicts: ${data.conflicts_found} | VIN: ${data.has_vin_authority ? 'YES' : 'NO'}`);
        if (data.source_url) {
          console.log(`   Source: ${data.source_url.substring(0, 60)}...`);
        }
        
      } else {
        console.log(`🔍 [DRY RUN] ${vehicleLabel}`);
        console.log(`   VIN: ${vehicle.vin || 'None'}`);
        console.log(`   Source: ${vehicle.bat_auction_url || vehicle.discovery_url || 'None'}`);
        stats.processed++;
      }
      
      // Progress indicator
      if (stats.processed % 10 === 0) {
        console.log(`\n📊 Progress: ${stats.processed}/${stats.total}\n`);
      }
      
    } catch (error) {
      console.error(`❌ ${vehicleLabel}: ${error.message}`);
      stats.errors++;
    }
  }
  
  // Final stats
  console.log('\n' + '='.repeat(60));
  console.log('📊 BACKFILL COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total Vehicles:        ${stats.total}`);
  console.log(`Processed:             ${stats.processed}`);
  console.log(`Evidence Created:      ${stats.evidence_created}`);
  console.log(`Conflicts Found:       ${stats.conflicts_found}`);
  console.log(`With VIN Authority:    ${stats.with_vin}`);
  console.log(`With Source URL:       ${stats.with_source}`);
  console.log(`Errors:                ${stats.errors}`);
  console.log('='.repeat(60) + '\n');
  
  if (stats.conflicts_found > 0) {
    console.log('⚠️  CONFLICTS DETECTED - Run audit-all-vehicles.js for detailed report\n');
  }
}

// Parse args
const args = process.argv.slice(2);
const limitIndex = args.indexOf('--limit');
const limit = limitIndex !== -1 && args[limitIndex + 1] ? parseInt(args[limitIndex + 1]) : null;
const dryRun = args.includes('--dry-run');

backfillAllEvidence(limit, dryRun);

