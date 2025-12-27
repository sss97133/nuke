#!/usr/bin/env node
/**
 * Delete ALL import_queue images from vehicle_images table in batches
 * Run: node scripts/delete-all-import-queue-images.js [batch-size]
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const BATCH_SIZE = parseInt(process.argv[2]) || 1000;

async function deleteAllImportQueueImages() {
  console.log(`🗑️  Deleting all import_queue images...\n`);
  console.log(`   Batch size: ${BATCH_SIZE}\n`);
  
  let totalDeleted = 0;
  let iterations = 0;
  
  while (true) {
    // Get a batch of import_queue image IDs
    const { data: images, error: fetchError } = await supabase
      .from('vehicle_images')
      .select('id')
      .or('storage_path.ilike.%import_queue%,image_url.ilike.%import_queue%')
      .limit(BATCH_SIZE);
    
    if (fetchError) {
      console.error(`❌ Error fetching images: ${fetchError.message}`);
      break;
    }
    
    if (!images || images.length === 0) {
      console.log('\n✅ All import_queue images deleted!');
      break;
    }
    
    const imageIds = images.map(img => img.id);
    
    // Delete the batch
    const { error: deleteError } = await supabase
      .from('vehicle_images')
      .delete()
      .in('id', imageIds);
    
    if (deleteError) {
      console.error(`❌ Error deleting batch: ${deleteError.message}`);
      break;
    }
    
    totalDeleted += imageIds.length;
    iterations++;
    
    console.log(`   Batch ${iterations}: Deleted ${imageIds.length} images (Total: ${totalDeleted})`);
    
    // Small delay to avoid overwhelming the database
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log(`\n📊 FINAL RESULTS:\n`);
  console.log(`   Total deleted: ${totalDeleted} images`);
  console.log(`   Batches processed: ${iterations}`);
}

deleteAllImportQueueImages().catch(console.error);

