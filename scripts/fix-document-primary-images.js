#!/usr/bin/env node
/**
 * Fix vehicles with documents as primary images
 * Also upgrades image URLs to full resolution
 * Run: node scripts/fix-document-primary-images.js [batch-size] [start-index]
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

const BATCH_SIZE = parseInt(process.argv[2]) || 100;
const START_INDEX = parseInt(process.argv[3]) || 0;

// Upgrade image URLs to full resolution
function upgradeImageUrl(url) {
  if (!url || typeof url !== 'string') return url;
  
  let upgraded = url
    // Remove resize/width/height query parameters
    .split('?')[0]
    // Remove size suffixes (-150x150, -300x300, -thumb, -small, -medium, -scaled)
    .replace(/-\d+x\d+\.(jpg|jpeg|png|webp)$/i, '.$1')
    .replace(/-thumb(?:nail)?\.(jpg|jpeg|png|webp)$/i, '.$1')
    .replace(/-small\.(jpg|jpeg|png|webp)$/i, '.$1')
    .replace(/-medium\.(jpg|jpeg|png|webp)$/i, '.$1')
    .replace(/-scaled\.(jpg|jpeg|png|webp)$/i, '.$1')
    .trim();
  
  return upgraded;
}

// Check if URL is a document (window sticker, spec sheet, etc.)
function isDocumentUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  return (
    lower.includes('window-sticker') || lower.includes('window_sticker') ||
    lower.includes('monroney') || lower.includes('spec-sheet') ||
    lower.includes('spec_sheet') || lower.includes('build-sheet') ||
    lower.includes('build_sheet') || lower.includes('spid') ||
    lower.includes('service-parts') || lower.includes('rpo') ||
    lower.includes('document') || lower.includes('sticker') ||
    lower.includes('sheet') || lower.includes('receipt') ||
    lower.includes('invoice') || lower.includes('title')
  );
}

async function fixDocumentPrimaryImages() {
  console.log(`🔧 Fixing document primary images and upgrading resolution...\n`);
  console.log(`   Batch size: ${BATCH_SIZE}`);
  console.log(`   Starting from index: ${START_INDEX}\n`);
  
  // Step 1: Find vehicles with document primary images
  console.log('   Finding vehicles with document primary images...');
  
  const { data: vehiclesWithDocs, error: findError } = await supabase
    .from('vehicle_images')
    .select('vehicle_id')
    .eq('is_primary', true)
    .or('is_document.eq.true,image_url.ilike.%window-sticker%,image_url.ilike.%window_sticker%,image_url.ilike.%monroney%,image_url.ilike.%spec-sheet%,image_url.ilike.%spec_sheet%,image_url.ilike.%build-sheet%,image_url.ilike.%build_sheet%,image_url.ilike.%spid%,image_url.ilike.%document%,image_url.ilike.%sticker%,image_url.ilike.%sheet%')
    .limit(10000);
  
  if (findError) {
    console.error('❌ Error finding vehicles:', findError);
    return;
  }
  
  const uniqueVehicleIds = [...new Set((vehiclesWithDocs || []).map(v => v.vehicle_id))];
  console.log(`📊 Found ${uniqueVehicleIds.length} vehicles with document primary images\n`);
  
  const vehiclesToProcess = uniqueVehicleIds.slice(START_INDEX, START_INDEX + BATCH_SIZE);
  console.log(`🔄 Processing ${vehiclesToProcess.length} vehicles (${START_INDEX} to ${START_INDEX + vehiclesToProcess.length - 1})...\n`);
  
  // Step 2: Get vehicle details
  const { data: vehicles, error: vError } = await supabase
    .from('vehicles')
    .select(`
      id,
      year,
      make,
      model,
      primary_image_url
    `)
    .in('id', vehiclesToProcess);
  
  if (vError) {
    console.error('❌ Error:', vError);
    return;
  }
  
  const results = {
    processed: 0,
    fixed: 0,
    upgraded: 0,
    errors: 0,
    skipped: 0
  };
  
  for (const vehicle of vehicles || []) {
    try {
      // Get all images for this vehicle
      const { data: images, error: imgError } = await supabase
        .from('vehicle_images')
        .select('id, image_url, is_primary, is_document, storage_path, variants')
        .eq('vehicle_id', vehicle.id)
        .order('is_primary', { ascending: false })
        .order('position', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true });
      
      if (imgError) {
        results.errors++;
        continue;
      }
      
      if (!images || images.length === 0) {
        results.skipped++;
        continue;
      }
      
      // Find current primary image
      const currentPrimary = images.find(img => img.is_primary === true);
      const isPrimaryDocument = currentPrimary && (
        currentPrimary.is_document === true || 
        isDocumentUrl(currentPrimary.image_url)
      );
      
      // Find best non-document image for primary
      const bestPrimary = images.find(img => {
        if (img.is_document === true) return false;
        if (isDocumentUrl(img.image_url)) return false;
        // Prefer Supabase-hosted images
        if (img.storage_path || (img.image_url && img.image_url.includes('supabase.co/storage'))) {
          return true;
        }
        return true;
      });
      
      let fixed = false;
      let upgraded = false;
      
      // Fix primary if it's a document
      if (isPrimaryDocument && bestPrimary) {
        // Clear existing primary
        await supabase
          .from('vehicle_images')
          .update({ is_primary: false })
          .eq('vehicle_id', vehicle.id)
          .eq('is_primary', true);
        
        // Set new primary
        await supabase
          .from('vehicle_images')
          .update({ is_primary: true })
          .eq('id', bestPrimary.id);
        
        // Upgrade URL to full resolution
        const fullResUrl = upgradeImageUrl(bestPrimary.image_url);
        if (fullResUrl !== bestPrimary.image_url) {
          await supabase
            .from('vehicle_images')
            .update({ image_url: fullResUrl })
            .eq('id', bestPrimary.id);
          upgraded = true;
        }
        
        // Update vehicle primary_image_url
        await supabase
          .from('vehicles')
          .update({ primary_image_url: fullResUrl })
          .eq('id', vehicle.id);
        
        fixed = true;
        results.fixed++;
        console.log(`   ✅ ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}: Fixed document primary, set new primary${upgraded ? ', upgraded to full-res' : ''}`);
      } else if (currentPrimary) {
        // Upgrade current primary to full resolution
        const fullResUrl = upgradeImageUrl(currentPrimary.image_url);
        if (fullResUrl !== currentPrimary.image_url) {
          await supabase
            .from('vehicle_images')
            .update({ image_url: fullResUrl })
            .eq('id', currentPrimary.id);
          
          await supabase
            .from('vehicles')
            .update({ primary_image_url: fullResUrl })
            .eq('id', vehicle.id);
          
          upgraded = true;
          results.upgraded++;
          console.log(`   ✅ ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}: Upgraded to full-res`);
        } else {
          results.skipped++;
        }
      } else {
        results.skipped++;
      }
      
      results.processed++;
    } catch (e) {
      console.error(`   ❌ Error processing ${vehicle.id}: ${e.message}`);
      results.errors++;
    }
  }
  
  console.log(`\n📊 RESULTS:\n`);
  console.log(`   Processed: ${results.processed} vehicles`);
  console.log(`   Fixed document primary: ${results.fixed} vehicles`);
  console.log(`   Upgraded resolution: ${results.upgraded} vehicles`);
  console.log(`   Skipped: ${results.skipped} vehicles`);
  console.log(`   Errors: ${results.errors}`);
  
  const remaining = uniqueVehicleIds.length - (START_INDEX + vehiclesToProcess.length);
  if (remaining > 0) {
    console.log(`\n💡 ${remaining} vehicles remaining. Run again with:`);
    console.log(`   node scripts/fix-document-primary-images.js ${BATCH_SIZE} ${START_INDEX + BATCH_SIZE}`);
  } else {
    console.log(`\n✅ All vehicles processed!`);
  }
}

fixDocumentPrimaryImages().catch(console.error);

