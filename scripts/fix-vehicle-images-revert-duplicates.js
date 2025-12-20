#!/usr/bin/env node
/**
 * Revert duplicate flags for a specific vehicle that was incorrectly marked
 * This undoes the cleanup for vehicles where the wrong images were marked as duplicate
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Error: Supabase service role key not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const vehicleId = process.argv[2] || 'f048d072-a2da-4981-bc4c-217a7165f983';

async function revertDuplicates() {
  console.log(`🔄 Reverting duplicate flags for vehicle: ${vehicleId}\n`);
  
  // Unmark all duplicates for this vehicle
  const { data: updated, error } = await supabase
    .from('vehicle_images')
    .update({ is_duplicate: false })
    .eq('vehicle_id', vehicleId)
    .eq('is_duplicate', true)
    .select('id');
  
  if (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
  
  console.log(`✅ Reverted ${updated?.length || 0} images`);
  console.log(`   Images are no longer marked as duplicates`);
}

revertDuplicates().catch(console.error);

