/**
 * Batch Re-extraction Script for BaT Vehicles with Missing Data
 * Processes vehicles with missing_score >= 5 (missing 5+ key fields)
 * Uses Firecrawl via extract-premium-auction Edge Function
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
const supabaseFunctionsUrl = `${supabaseUrl}/functions/v1/extract-premium-auction`;

// Configuration
const BATCH_SIZE = 3;  // Process 3 at a time to avoid rate limits
const DELAY_BETWEEN_BATCHES = 5000;  // 5 seconds between batches
const MAX_VEHICLES = parseInt(process.argv[2]) || 0;  // 0 = process all

async function getVehiclesWithMissingData() {
  console.log('Fetching BaT vehicles with missing data (score >= 5)...');
  
  const { data, error } = await supabase.rpc('get_bat_vehicles_missing_data');
  
  if (error) {
    // Fallback to direct query if RPC doesn't exist
    console.log('RPC not available, using direct query...');
    
    const { data: vehicles, error: queryError } = await supabase
      .from('vehicles')
      .select('id, discovery_url, vin, mileage, color, transmission, engine_size, drivetrain, description, location, high_bid, sale_price')
      .like('discovery_url', '%bringatrailer%')
      .not('discovery_url', 'like', '%#comment%')
      .not('discovery_url', 'like', '%#identifier%');
    
    if (queryError) {
      console.error('Query error:', queryError);
      return [];
    }
    
    // Score each vehicle
    return vehicles
      .map(v => {
        let score = 0;
        if (!v.vin) score++;
        if (!v.mileage) score++;
        if (!v.color) score++;
        if (!v.transmission) score++;
        if (!v.engine_size) score++;
        if (!v.drivetrain) score++;
        if (!v.description) score++;
        if (!v.location) score++;
        if (!v.high_bid && !v.sale_price) score++;
        return { ...v, missing_score: score };
      })
      .filter(v => v.missing_score >= 5)
      .sort((a, b) => b.missing_score - a.missing_score);
  }
  
  return data || [];
}

async function extractVehicle(vehicle) {
  try {
    const response = await fetch(supabaseFunctionsUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseServiceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: vehicle.discovery_url,
        debug: false,
        force_re_extract: true
      }),
    });

    const responseText = await response.text();
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    try {
      const data = JSON.parse(responseText);
      return { 
        success: data.success !== false, 
        images: data.vehicles_created?.[0]?.images_inserted || 0,
        error: data.error
      };
    } catch {
      return { success: false, error: 'Invalid JSON response' };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log('BaT Vehicle Re-Extraction Script');
  console.log('='.repeat(50));
  console.log('');
  
  const vehicles = await getVehiclesWithMissingData();
  
  if (vehicles.length === 0) {
    console.log('No vehicles with missing data found.');
    return;
  }
  
  let toProcess = MAX_VEHICLES > 0 ? vehicles.slice(0, MAX_VEHICLES) : vehicles;
  
  console.log(`Found ${vehicles.length} vehicles with missing data`);
  console.log(`Processing: ${toProcess.length}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Delay: ${DELAY_BETWEEN_BATCHES}ms between batches`);
  console.log('');
  
  let successCount = 0;
  let failCount = 0;
  let totalImages = 0;
  
  const startTime = Date.now();
  
  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(toProcess.length / BATCH_SIZE);
    
    console.log(`\nBatch ${batchNum}/${totalBatches}`);
    
    const results = await Promise.all(batch.map(async (v) => {
      const result = await extractVehicle(v);
      const slug = v.discovery_url.split('/').filter(Boolean).pop();
      
      if (result.success) {
        successCount++;
        totalImages += result.images || 0;
        console.log(`  ✓ ${slug} (score: ${v.missing_score})`);
      } else {
        failCount++;
        console.log(`  ✗ ${slug}: ${result.error}`);
      }
      return result;
    }));
    
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    const rate = (successCount / (Date.now() - startTime) * 60000).toFixed(1);
    console.log(`  Progress: ${Math.min(i + BATCH_SIZE, toProcess.length)}/${toProcess.length} | ` +
                `Success: ${successCount} | Failed: ${failCount} | ` +
                `Time: ${elapsed}min | Rate: ${rate}/min`);
    
    // Wait between batches
    if (i + BATCH_SIZE < toProcess.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    }
  }
  
  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  
  console.log('\n' + '='.repeat(50));
  console.log('FINAL SUMMARY');
  console.log('='.repeat(50));
  console.log(`Total processed: ${toProcess.length}`);
  console.log(`Successful: ${successCount} (${(successCount / toProcess.length * 100).toFixed(1)}%)`);
  console.log(`Failed: ${failCount}`);
  console.log(`Total time: ${totalTime} minutes`);
}

main().catch(console.error);

