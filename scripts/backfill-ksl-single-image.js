#!/usr/bin/env node
/**
 * Backfill a single image for KSL vehicle
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

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const vehicleId = 'a609454a-8f30-4fbf-af10-e8cd915964e8';

// Extract actual image URL from Next.js proxy URL
const thumbnailUrl = 'https://cars.ksl.com/v2/_next/image?url=https%3A%2F%2Fimage.ksldigital.com%2Fa57ca4b5-a668-4740-8593-2520d156b786.jpg&w=3840&q=60';
const urlObj = new URL(thumbnailUrl);
const urlParam = urlObj.searchParams.get('url');
const actualImageUrl = urlParam ? decodeURIComponent(urlParam) : thumbnailUrl;

console.log(`📸 Backfilling image for vehicle ${vehicleId}`);
console.log(`   Image URL: ${actualImageUrl}\n`);

const { data, error } = await supabase.functions.invoke('backfill-images', {
  body: {
    vehicle_id: vehicleId,
    image_urls: [actualImageUrl],
    source: 'ksl_import',
    run_analysis: false
  },
  timeout: 60000
});

if (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}

console.log('✅ Result:');
console.log(`   Uploaded: ${data?.uploaded || 0}`);
console.log(`   Skipped: ${data?.skipped || 0}`);
console.log(`   Failed: ${data?.failed || 0}`);

