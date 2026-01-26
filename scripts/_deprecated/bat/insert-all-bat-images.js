#!/usr/bin/env node
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const vehicleId = '1dd2b43f-9f5a-45dd-b7f9-88c6fdf64e3e';

// Load URLs from JSON file
const urlsJson = fs.readFileSync('/tmp/bat_images.json', 'utf-8');
const allUrls = JSON.parse(urlsJson);

console.log(`Found ${allUrls.length} total URLs from BaT gallery`);

// Get existing image URLs
const { data: existingImages, error: fetchError } = await supabase
  .from('vehicle_images')
  .select('image_url')
  .eq('vehicle_id', vehicleId)
  .not('is_document', 'is', true);

if (fetchError) {
  console.error('Error fetching existing images:', fetchError);
  process.exit(1);
}

const existingUrls = new Set((existingImages || []).map(img => img.image_url));
console.log(`Found ${existingUrls.size} existing images in database`);

// Filter out existing URLs
const newUrls = allUrls.filter(url => !existingUrls.has(url));
console.log(`Will insert ${newUrls.length} new images`);

if (newUrls.length === 0) {
  console.log('No new images to insert');
  process.exit(0);
}

// Get current max position
const { data: maxPosData } = await supabase
  .from('vehicle_images')
  .select('position')
  .eq('vehicle_id', vehicleId)
  .not('position', 'is', null)
  .order('position', { ascending: false })
  .limit(1);

const startPosition = maxPosData && maxPosData.length > 0 ? maxPosData[0].position + 1 : existingUrls.size;

// Insert in batches to avoid timeouts
const BATCH_SIZE = 50;
let inserted = 0;

for (let i = 0; i < newUrls.length; i += BATCH_SIZE) {
  const batch = newUrls.slice(i, i + BATCH_SIZE);
  const imagesToInsert = batch.map((url, idx) => ({
    vehicle_id: vehicleId,
    image_url: url,
    source: 'bat_import',
    is_primary: false, // Keep existing primary
    position: startPosition + i + idx,
    is_document: false,
  }));

  const { data, error } = await supabase
    .from('vehicle_images')
    .insert(imagesToInsert)
    .select();

  if (error) {
    console.error(`Error inserting batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error);
  } else {
    inserted += data?.length || 0;
    console.log(`Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${data?.length || 0} images (${inserted}/${newUrls.length} total)`);
  }
}

console.log(`\n✅ Successfully inserted ${inserted} new images`);
console.log(`Total images now: ${existingUrls.size + inserted}`);

