/**
 * Batch Re-extraction Script for Cars & Bids Vehicles
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

const BATCH_SIZE = 2;
const DELAY_BETWEEN_BATCHES = 8000;

async function main() {
  const limit = parseInt(process.argv[2]) || 50;
  
  console.log('Cars & Bids Vehicle Re-Extraction Script');
  console.log('==================================================\n');
  
  // Get C&B vehicles with missing data
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, discovery_url, year, make, model, mileage, color, transmission')
    .like('discovery_url', '%carsandbids%')
    .or('mileage.is.null,color.is.null,transmission.is.null')
    .limit(limit);
  
  if (error) {
    console.error('Failed to fetch vehicles:', error);
    process.exit(1);
  }
  
  console.log(`Found ${vehicles?.length || 0} C&B vehicles with missing data`);
  console.log(`Processing: ${Math.min(limit, vehicles?.length || 0)}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log('\n');
  
  if (!vehicles || vehicles.length === 0) {
    console.log('No vehicles to process');
    return;
  }
  
  const toProcess = vehicles.slice(0, limit);
  let success = 0;
  let failed = 0;
  const startTime = Date.now();
  
  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(toProcess.length / BATCH_SIZE);
    
    console.log(`Batch ${batchNum}/${totalBatches}`);
    
    await Promise.all(batch.map(async (v) => {
      const url = v.discovery_url;
      const slug = url?.split('/').filter(Boolean).pop() || v.id;
      
      try {
        const response = await fetch(supabaseFunctionsUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceRoleKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            url, 
            debug: true, 
            force_re_extract: true 
          }),
        });
        
        if (!response.ok) {
          console.log(`  ✗ ${slug}: HTTP ${response.status}`);
          failed++;
          return;
        }
        
        const data = await response.json();
        if (data.vehicles_updated > 0 || data.vehicles_created > 0) {
          console.log(`  ✓ ${slug}`);
          success++;
        } else {
          console.log(`  ✗ ${slug}: ${data.issues?.[0] || 'no update'}`);
          failed++;
        }
      } catch (e) {
        console.log(`  ✗ ${slug}: ${e.message}`);
        failed++;
      }
    }));
    
    const elapsed = (Date.now() - startTime) / 60000;
    const rate = (i + batch.length) / elapsed;
    console.log(`  Progress: ${i + batch.length}/${toProcess.length} | Success: ${success} | Failed: ${failed} | Rate: ${rate.toFixed(1)}/min\n`);
    
    if (i + BATCH_SIZE < toProcess.length) {
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));
    }
  }
  
  console.log('==================================================');
  console.log('FINAL SUMMARY');
  console.log('==================================================');
  console.log(`Total processed: ${toProcess.length}`);
  console.log(`Successful: ${success} (${((success / toProcess.length) * 100).toFixed(1)}%)`);
  console.log(`Failed: ${failed}`);
}

main().catch(console.error);

