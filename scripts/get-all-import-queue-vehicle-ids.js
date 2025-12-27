#!/usr/bin/env node
/**
 * Get all unique vehicle IDs with import_queue images
 * Outputs JSON array to stdout
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

async function getAllVehicleIds() {
  // Use RPC to execute SQL directly (more reliable than pagination)
  const { data, error } = await supabase.rpc('exec_sql', {
    query: `
      SELECT DISTINCT vehicle_id
      FROM vehicle_images
      WHERE storage_path ILIKE '%import_queue%' OR image_url ILIKE '%import_queue%'
      ORDER BY vehicle_id
    `
  }).catch(async () => {
    // Fallback: Use pagination with larger chunks
    const seenIds = new Set();
    let offset = 0;
    const chunkSize = 5000;
    
    while (true) {
      const { data: chunk, error: chunkError } = await supabase
        .from('vehicle_images')
        .select('vehicle_id')
        .or('storage_path.ilike.%import_queue%,image_url.ilike.%import_queue%')
        .range(offset, offset + chunkSize - 1)
        .limit(chunkSize);
      
      if (chunkError) {
        throw chunkError;
      }
      
      if (!chunk || chunk.length === 0) break;
      
      chunk.forEach(v => {
        if (v && v.vehicle_id) seenIds.add(v.vehicle_id);
      });
      
      if (chunk.length < chunkSize) break;
      offset += chunkSize;
    }
    
    return { data: Array.from(seenIds).map(id => ({ vehicle_id: id })), error: null };
  });
  
  if (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
  
  const vehicleIds = (data || []).map(row => row.vehicle_id).filter(Boolean);
  console.log(JSON.stringify(vehicleIds));
}

getAllVehicleIds().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});

