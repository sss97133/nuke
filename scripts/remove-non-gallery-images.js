#!/usr/bin/env node
/**
 * Remove images from DB that aren't in the photo gallery canonical list (origin_metadata.image_urls)
 * Simple: if it's not in the canonical list, mark as duplicate
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: 'nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

function normalizeUrl(url) {
  return url.split('?')[0].split('#')[0].replace(/-scaled\./g, '.').trim();
}

async function removeNonGalleryImages(vehicleId) {
  const { data: vehicle } = await supabase.from('vehicles').select('origin_metadata').eq('id', vehicleId).single();
  const canonicalUrls = new Set((vehicle?.origin_metadata?.image_urls || []).map(normalizeUrl));
  
  if (canonicalUrls.size === 0) {
    console.log('No canonical URLs found, skipping');
    return;
  }
  
  const { data: dbImages } = await supabase
    .from('vehicle_images')
    .select('id, source_url, image_url, is_primary')
    .eq('vehicle_id', vehicleId)
    .not('is_duplicate', 'is', true);
  
  const toRemove = (dbImages || []).filter(img => {
    const url = normalizeUrl(img.source_url || img.image_url || '');
    return !canonicalUrls.has(url);
  });
  
  console.log(`Canonical: ${canonicalUrls.size}, DB: ${dbImages?.length || 0}, To remove: ${toRemove.length}`);
  
  for (const img of toRemove) {
    if (img.is_primary) continue;
    await supabase.from('vehicle_images').update({ is_duplicate: true }).eq('id', img.id);
  }
  
  console.log(`Marked ${toRemove.length} images as duplicate`);
}

const vehicleId = process.argv[2] || 'c49e286c-41c8-405b-b9d3-0f24f7c9edeb';
removeNonGalleryImages(vehicleId).catch(console.error);
