#!/usr/bin/env node

/**
 * Queue incomplete vehicles for re-extraction
 * Prioritizes vehicles with URLs that can be re-scraped
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env vars
let SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
let SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

const envLocalPath = path.join(__dirname, '../nuke_frontend/.env.local');
if (!SUPABASE_SERVICE_KEY && fs.existsSync(envLocalPath)) {
  const envContent = fs.readFileSync(envLocalPath, 'utf8');
  const lines = envContent.split('\n');
  for (const line of lines) {
    if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=') || line.startsWith('SERVICE_ROLE_KEY=')) {
      SUPABASE_SERVICE_KEY = line.split('=')[1]?.trim().replace(/^["']|["']$/g, '');
      break;
    }
  }
}

if (!SUPABASE_SERVICE_KEY) {
  console.log('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function queueReExtractions() {
  console.log('='.repeat(70));
  console.log('🔄 QUEUEING RE-EXTRACTIONS');
  console.log('='.repeat(70));
  console.log('');

  const { batch_size = 100 } = process.argv[2] ? { batch_size: parseInt(process.argv[2]) } : {};

  // Find incomplete vehicles with URLs
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, color, mileage, discovery_source, discovery_url, bat_auction_url')
    .eq('status', 'active')
    .or('vin.is.null,color.is.null,mileage.is.null,transmission.is.null,drivetrain.is.null,engine_size.is.null')
    .or('discovery_url.not.is.null,bat_auction_url.not.is.null')
    .limit(batch_size);

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  console.log(`Found ${vehicles?.length || 0} incomplete vehicles with URLs\n`);

  const results = {
    queued_bat: 0,
    queued_import: 0,
    already_queued: 0,
    errors: []
  };

  for (const vehicle of vehicles || []) {
    try {
      const isBat = !!(vehicle.bat_auction_url || 
        vehicle.discovery_source === 'bat' || 
        vehicle.discovery_source === 'bat_listing' || 
        vehicle.discovery_source === 'bat_profile_extraction');
      
      const url = vehicle.bat_auction_url || vehicle.discovery_url;
      
      if (isBat && vehicle.bat_auction_url) {
        // Check if already in BaT queue
        const { data: existing } = await supabase
          .from('bat_extraction_queue')
          .select('id')
          .eq('vehicle_id', vehicle.id)
          .eq('status', 'pending')
          .limit(1);
        
        if (existing && existing.length > 0) {
          results.already_queued++;
          continue;
        }
        
        // Queue BaT extraction
        const { error: queueError } = await supabase
          .from('bat_extraction_queue')
          .insert({
            vehicle_id: vehicle.id,
            bat_auction_url: vehicle.bat_auction_url,
            status: 'pending',
            priority: 1,
            extraction_type: 'comprehensive'
          });
        
        if (queueError) {
          if (!queueError.message.includes('duplicate') && !queueError.message.includes('unique')) {
            results.errors.push(`BaT ${vehicle.id}: ${queueError.message}`);
          } else {
            results.already_queued++;
          }
        } else {
          results.queued_bat++;
          console.log(`✅ Queued BaT: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
        }
      } else if (url) {
        // Check if already in import queue
        const { data: existing } = await supabase
          .from('import_queue')
          .select('id')
          .eq('listing_url', url)
          .in('status', ['pending', 'processing'])
          .limit(1);
        
        if (existing && existing.length > 0) {
          results.already_queued++;
          continue;
        }
        
        // Queue import re-processing
        const { error: queueError } = await supabase
          .from('import_queue')
          .insert({
            listing_url: url,
            source_id: null,
            status: 'pending',
            priority: 1,
            vehicle_id: vehicle.id
          });
        
        if (queueError) {
          if (!queueError.message.includes('duplicate') && !queueError.message.includes('unique')) {
            results.errors.push(`Import ${vehicle.id}: ${queueError.message}`);
          } else {
            results.already_queued++;
          }
        } else {
          results.queued_import++;
          console.log(`✅ Queued import: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
        }
      }
    } catch (error) {
      results.errors.push(`${vehicle.id}: ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('📊 RESULTS:');
  console.log('='.repeat(70));
  console.log(`   Queued BaT: ${results.queued_bat}`);
  console.log(`   Queued Import: ${results.queued_import}`);
  console.log(`   Already queued: ${results.already_queued}`);
  console.log(`   Errors: ${results.errors.length}`);
  
  if (results.errors.length > 0) {
    console.log('\n   First 5 errors:');
    results.errors.slice(0, 5).forEach(err => console.log(`     - ${err}`));
  }
  
  console.log('');
}

queueReExtractions().then(() => {
  console.log('✅ Queueing complete');
  process.exit(0);
}).catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});

