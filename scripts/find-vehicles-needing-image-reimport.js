#!/usr/bin/env node
/**
 * Find all vehicles that need image re-import:
 * - Vehicles with /video URLs (need URL fix + re-extract)
 * - Vehicles with < 5 images (incomplete galleries)
 * - Vehicles with low-res/thumbnail images
 * - Vehicles with document/logos as primary images
 * Run: node scripts/find-vehicles-needing-image-reimport.js
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

// Check if image URL is low-res (has size suffixes or query params)
function isLowResUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  return (
    /-\d+x\d+\.(jpg|jpeg|png|webp)$/i.test(url) ||
    /-thumb(?:nail)?\.(jpg|jpeg|png|webp)$/i.test(url) ||
    /-small\.(jpg|jpeg|png|webp)$/i.test(url) ||
    /-medium\.(jpg|jpeg|png|webp)$/i.test(url) ||
    /-scaled\.(jpg|jpeg|png|webp)$/i.test(url) ||
    url.includes('?w=') || url.includes('?h=') || url.includes('?resize=') ||
    url.includes('width=') || url.includes('height=')
  );
}

// Check if URL is a document
function isDocumentUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  return (
    lower.includes('window-sticker') || lower.includes('window_sticker') ||
    lower.includes('monroney') || lower.includes('spec-sheet') ||
    lower.includes('spec_sheet') || lower.includes('build-sheet') ||
    lower.includes('build_sheet') || lower.includes('spid') ||
    lower.includes('service-parts') || lower.includes('rpo') ||
    (lower.includes('document') && !lower.includes('photo')) ||
    (lower.includes('sticker') && !lower.includes('decal')) ||
    (lower.includes('sheet') && !lower.includes('bedsheet')) ||
    lower.includes('receipt') || lower.includes('invoice') ||
    lower.includes('title') || lower.includes('registration')
  );
}

// Check if URL is a logo
function isLogoUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  return (
    lower.includes('organization-logos/') || lower.includes('organization_logos/') ||
    lower.includes('images.classic.com/uploads/dealer/') ||
    lower.includes('/uploads/dealer/') ||
    (lower.includes('/logo') && (lower.includes('/storage/') || lower.includes('supabase.co'))) ||
    lower.includes('import_queue')
  );
}

async function findVehiclesNeedingReimport() {
  console.log('🔍 Finding vehicles needing image re-import...\n');
  
  // Get all vehicles with listing URLs (auction imports)
  const { data: allVehicles, error: allError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, platform_url, primary_image_url, profile_origin')
    .not('discovery_url', 'is', null)
    .limit(10000);
  
  if (allError) {
    console.error('❌ Error:', allError);
    return;
  }
  
  console.log(`📊 Analyzing ${allVehicles?.length || 0} vehicles with listing URLs...\n`);
  
  const issues = {
    videoUrls: [],
    fewImages: [],
    lowResImages: [],
    documentPrimary: [],
    logoPrimary: [],
    noImages: []
  };
  
  for (const vehicle of allVehicles || []) {
    const vehicleId = vehicle.id;
    const discoveryUrl = vehicle.discovery_url || vehicle.platform_url;
    
    // Check 1: /video URLs
    if (discoveryUrl && (discoveryUrl.includes('/video') || discoveryUrl.endsWith('/video'))) {
      issues.videoUrls.push({
        ...vehicle,
        issue: 'video_url',
        url: discoveryUrl
      });
      continue; // Skip other checks for video URLs
    }
    
    // Get image count and check quality
    const { data: images, error: imgError } = await supabase
      .from('vehicle_images')
      .select('id, image_url, is_primary, is_document, storage_path')
      .eq('vehicle_id', vehicleId);
    
    if (imgError) continue;
    
    const imageCount = images?.length || 0;
    const nonDocumentImages = (images || []).filter(img => !img.is_document);
    const nonDocumentCount = nonDocumentImages.length;
    
    // Check 2: No images
    if (imageCount === 0) {
      issues.noImages.push({
        ...vehicle,
        issue: 'no_images',
        url: discoveryUrl
      });
      continue;
    }
    
    // Check 3: Few images (< 5 non-document images)
    if (nonDocumentCount < 5) {
      issues.fewImages.push({
        ...vehicle,
        issue: 'few_images',
        image_count: nonDocumentCount,
        url: discoveryUrl
      });
    }
    
    // Check 4: Low-res images (check if most are thumbnails)
    const lowResCount = (images || []).filter(img => 
      !img.is_document && isLowResUrl(img.image_url)
    ).length;
    const lowResRatio = nonDocumentCount > 0 ? lowResCount / nonDocumentCount : 0;
    
    if (lowResRatio > 0.5 && nonDocumentCount > 0) {
      issues.lowResImages.push({
        ...vehicle,
        issue: 'low_res_images',
        image_count: nonDocumentCount,
        low_res_count: lowResCount,
        low_res_ratio: (lowResRatio * 100).toFixed(1) + '%',
        url: discoveryUrl
      });
    }
    
    // Check 5: Document as primary
    const primaryImage = (images || []).find(img => img.is_primary);
    if (primaryImage) {
      if (primaryImage.is_document || isDocumentUrl(primaryImage.image_url)) {
        issues.documentPrimary.push({
          ...vehicle,
          issue: 'document_primary',
          primary_url: primaryImage.image_url,
          url: discoveryUrl
        });
      } else if (isLogoUrl(primaryImage.image_url) || isLogoUrl(primaryImage.storage_path)) {
        issues.logoPrimary.push({
          ...vehicle,
          issue: 'logo_primary',
          primary_url: primaryImage.image_url,
          url: discoveryUrl
        });
      }
    }
  }
  
  // Print summary
  console.log('📋 VEHICLES NEEDING RE-IMPORT:\n');
  console.log(`❌ /video URLs: ${issues.videoUrls.length}`);
  console.log(`❌ No images: ${issues.noImages.length}`);
  console.log(`❌ < 5 images: ${issues.fewImages.length}`);
  console.log(`❌ Low-res images (>50%): ${issues.lowResImages.length}`);
  console.log(`❌ Document as primary: ${issues.documentPrimary.length}`);
  console.log(`❌ Logo as primary: ${issues.logoPrimary.length}`);
  
  const totalUnique = new Set([
    ...issues.videoUrls.map(v => v.id),
    ...issues.noImages.map(v => v.id),
    ...issues.fewImages.map(v => v.id),
    ...issues.lowResImages.map(v => v.id),
    ...issues.documentPrimary.map(v => v.id),
    ...issues.logoPrimary.map(v => v.id)
  ]).size;
  
  console.log(`\n📊 Total unique vehicles needing re-import: ${totalUnique}\n`);
  
  // Export for re-import script
  const allNeedingReimport = [
    ...issues.videoUrls,
    ...issues.noImages,
    ...issues.fewImages,
    ...issues.lowResImages,
    ...issues.documentPrimary,
    ...issues.logoPrimary
  ];
  
  // Deduplicate by vehicle ID
  const uniqueVehicles = [];
  const seenIds = new Set();
  for (const v of allNeedingReimport) {
    if (!seenIds.has(v.id)) {
      seenIds.add(v.id);
      uniqueVehicles.push(v);
    }
  }
  
  console.log('💡 Sample vehicles (first 20):\n');
  uniqueVehicles.slice(0, 20).forEach(v => {
    console.log(`   - ${v.year || '?'} ${v.make || '?'} ${v.model || '?'} [${v.issue}]`);
    console.log(`     ${v.url || 'N/A'}`);
  });
  
  return {
    summary: {
      videoUrls: issues.videoUrls.length,
      noImages: issues.noImages.length,
      fewImages: issues.fewImages.length,
      lowResImages: issues.lowResImages.length,
      documentPrimary: issues.documentPrimary.length,
      logoPrimary: issues.logoPrimary.length,
      totalUnique
    },
    vehicles: uniqueVehicles
  };
}

findVehiclesNeedingReimport().catch(console.error);


