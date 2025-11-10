/**
 * SCAN FOR SPID SHEETS
 * Scans all vehicle images to detect GM SPID sheets
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const C10_VEHICLE_ID = '9a8aaf17-ddb1-49a2-9b0a-1352807e7a06';

async function scanImageForSPID(imageId, imageUrl) {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/detect-spid-sheet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`
      },
      body: JSON.stringify({ imageId, imageUrl })
    });

    const result = await response.json();
    return result;
  } catch (error) {
    console.error(`Error scanning image ${imageId}:`, error.message);
    return null;
  }
}

async function main() {
  console.log('🔍 SCANNING FOR SPID SHEETS...\n');

  // Get all images for the C10
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url, large_url, medium_url')
    .eq('vehicle_id', C10_VEHICLE_ID)
    .order('taken_at');

  if (error) {
    console.error('❌ Error loading images:', error);
    return;
  }

  console.log(`📸 Found ${images.length} images for 1971 C10\n`);

  let spidSheetsFound = 0;

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const imageUrl = image.large_url || image.medium_url || image.image_url;
    
    process.stdout.write(`[${i + 1}/${images.length}] Scanning image ${image.id.substring(0, 8)}... `);

    const result = await scanImageForSPID(image.id, imageUrl);

    if (result && result.is_spid_sheet) {
      console.log(`✅ SPID SHEET DETECTED! (${result.confidence}% confidence)`);
      console.log(`   VIN: ${result.extracted_data.vin || 'Not found'}`);
      console.log(`   Paint: ${result.extracted_data.paint_code_exterior || 'N/A'}`);
      console.log(`   Engine: ${result.extracted_data.engine_code || 'N/A'}`);
      console.log(`   RPO Codes: ${result.extracted_data.rpo_codes?.join(', ') || 'None'}\n`);
      spidSheetsFound++;
    } else if (result) {
      console.log(`⚪ Not a SPID sheet`);
    } else {
      console.log(`❌ Error scanning`);
    }

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(`\n✅ Scan complete! Found ${spidSheetsFound} SPID sheet(s)`);
}

main();

