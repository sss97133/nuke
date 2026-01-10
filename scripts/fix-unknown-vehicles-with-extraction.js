#!/usr/bin/env node
/**
 * Fix "Unknown" make/model vehicles by:
 * 1. Query for vehicles with "Unknown" make or model
 * 2. Get their BaT/discovery URLs
 * 3. Run extract-premium-auction on each URL to re-extract data
 * 4. Update vehicles with properly extracted data
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

function titleCase(str) {
  if (!str) return null;
  return str
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function parseBatUrl(url) {
  if (!url || typeof url !== 'string') return null;
  
  try {
    // BaT URL patterns:
    // - With year: /listing/1969-alfa-romeo-gtv-1750-16
    // - Without year: /listing/porsche-356-replica-56
    
    // Try with year first
    const matchWithYear = url.match(/\/listing\/(\d{4})-([a-z0-9-]+)\/?$/i);
    if (matchWithYear && matchWithYear[1] && matchWithYear[2]) {
      const year = parseInt(matchWithYear[1], 10);
      if (Number.isFinite(year) && year >= 1885 && year <= new Date().getFullYear() + 1) {
        const parts = matchWithYear[2].split('-').filter(Boolean);
        if (parts.length >= 2) {
          const parsed = parseMakeModel(parts);
          return { year, ...parsed };
        }
      }
    }
    
    // Try without year: /listing/porsche-356-replica-56
    const matchNoYear = url.match(/\/listing\/([a-z0-9-]+)\/?$/i);
    if (matchNoYear && matchNoYear[1]) {
      const parts = matchNoYear[1].split('-').filter(Boolean);
      if (parts.length >= 2) {
        const parsed = parseMakeModel(parts);
        return { year: null, ...parsed };
      }
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

function parseMakeModel(parts) {
  const multiWordMakes = {
    'alfa': { full: 'Alfa Romeo', requiresSecond: 'romeo' },
    'mercedes': { full: 'Mercedes-Benz', requiresSecond: 'benz' },
    'land': { full: 'Land Rover', requiresSecond: 'rover' },
    'aston': { full: 'Aston Martin', requiresSecond: 'martin' },
    'factory': { full: 'Factory Five', requiresSecond: 'five' },
  };
  
  // Check for two-word makes (e.g., "alfa-romeo", "mercedes-benz", "factory-five")
  if (parts.length >= 2) {
    const firstPart = parts[0].toLowerCase();
    const secondPart = parts[1].toLowerCase();
    
    if (multiWordMakes[firstPart] && secondPart === multiWordMakes[firstPart].requiresSecond) {
      // Two-word make (e.g., "alfa-romeo", "mercedes-benz", "factory-five")
      const make = multiWordMakes[firstPart].full;
      // Everything after make is model (remove trailing listing numbers)
      const model = parts.slice(2)
        .filter(p => {
          // Remove trailing numbers that are clearly listing IDs (2-3 digits at end)
          // But keep model identifiers like "356b", "911", "gt350", "11" (model numbers)
          if (/^\d{2,3}$/.test(p)) {
            // If it's at the end and looks like a listing ID, remove it
            return false;
          }
          return true;
        })
        .map(p => {
          // Keep model numbers/identifiers like "356b", "911", "11", "gt350", "xke"
          if (/^\d+[a-z]?$/i.test(p) || p.length <= 3 || /^(gt|rs|rsr|s|t)$/i.test(p)) {
            return p.toUpperCase(); // "356b" -> "356B", "xke" -> "XKE", "11" -> "11"
          }
          return titleCase(p);
        })
        .join(' ')
        .replace(/\s+\d{2,3}$/, '') // Remove trailing 2-3 digit numbers (listing IDs)
        .trim() || null;
      return { make, model };
    }
  }
  
  // Handle special cases where model is a number or short identifier (e.g., "lotus-11", "ac-ace", "porsche-356b")
  if (parts.length >= 2) {
    const firstPart = parts[0].toLowerCase();
    const secondPart = parts[1].toLowerCase();
    
    // If second part looks like a model identifier (number, short code, or model name)
    // Examples: "lotus-11", "ac-ace", "porsche-356b", "bmw-m3"
    const make = titleCase(parts[0]);
    // Build model from remaining parts, handling special cases
    let modelParts = parts.slice(1);
    
    // Remove trailing listing ID numbers more aggressively
    // Examples: 
    // - "1972-lotus-elan-plus-2s" -> keep "2s" (model identifier with letter)
    // - "1963-lotus-23b-3" -> remove trailing "3" (listing ID, "23b" is model)
    // - "1973-alfa-romeo-1600-junior-zagato-6" -> remove trailing "6" (listing ID)
    // - "2006-bmw-m5-155" -> remove trailing "155" (listing ID)
    
    // Remove trailing numbers that are clearly listing IDs (standalone digits at end)
    while (modelParts.length > 0) {
      const lastPart = modelParts[modelParts.length - 1];
      // If last part is a standalone number (1-4 digits), check if it's a listing ID
      if (/^\d{1,4}$/.test(lastPart)) {
        // Check if previous part suggests this number is part of model name
        if (modelParts.length > 1) {
          const prevPart = modelParts[modelParts.length - 2].toLowerCase();
          // If previous part ends with letter (e.g., "2s", "23b"), or is a model word (e.g., "plus", "sport")
          // then trailing number might be part of model - but usually trailing standalone numbers are listing IDs
          if (/[a-z]$/.test(prevPart) || /^(plus|sport|gt|rs|rsr|t|coupe|roadster|convertible|elite|elan|junior|zagato|cheetah|race|car)$/.test(prevPart)) {
            // Previous part suggests model name, so trailing number is likely listing ID - remove it
            modelParts = modelParts.slice(0, -1);
            continue;
          }
        }
        // If we only have 2 parts total and last is a number, it might be listing ID
        // But be conservative - if previous part is clearly a model name, keep both
        if (modelParts.length === 2) {
          const firstPart = modelParts[0].toLowerCase();
          // If first part is clearly a model name and second is just digits, remove the digits
          if (/^[a-z]+$/.test(firstPart) && !/^(plus|2s|23b|1600)$/.test(firstPart)) {
            modelParts = modelParts.slice(0, -1);
            continue;
          }
        }
      }
      // Break if we can't confidently remove trailing number
      break;
    }
    
    // Also remove very long trailing numbers (4+ digits are definitely listing IDs)
    if (modelParts.length > 0 && /^\d{4,}$/.test(modelParts[modelParts.length - 1])) {
      modelParts = modelParts.slice(0, -1);
    }
    
    const model = modelParts
      .map((p, idx) => {
        // Handle model numbers/identifiers with letters
        // "2s" -> "2S", "23b" -> "23B", "m5" -> "M5"
        if (/^\d+[a-z]$/i.test(p)) {
          return p.toUpperCase(); // "2s" -> "2S", "23b" -> "23B"
        }
        // Handle model numbers without letters (keep as-is if part of model name)
        // "1600" stays "1600", "1.8" stays "1.8"
        if (/^\d+\.\d+$/i.test(p)) {
          return p; // Version numbers like "1.8"
        }
        // Handle model identifiers
        if (/^(gt|rs|rsr|s|t|xke|m\d+|plus|sport|zagato|junior|mk|cheetah|race|car)$/i.test(p)) {
          return titleCase(p);
        }
        // Regular model name words
        return titleCase(p);
      })
      .join(' ')
      .replace(/\s+/g, ' ') // Normalize spaces
      .replace(/\b(\d+)\s+(\d)\b/g, '$1.$2') // Fix version numbers: "1 8" -> "1.8", "2 0" -> "2.0"
      .replace(/\s+\d{1,4}$/, '') // Final cleanup: remove any remaining trailing 1-4 digit listing IDs
      .trim() || titleCase(parts[1]); // Fallback to second part as model
    
    return { make, model };
  }
  
  // Single-word make with no clear model (shouldn't happen with BaT URLs)
  const make = titleCase(parts[0]);
  return { make, model: parts.length > 1 ? titleCase(parts[1]) : null };
}

async function extractVehicleFromUrl(url) {
  if (!url || !url.includes('bringatrailer.com/listing/')) {
    return null;
  }
  
  // Parse directly from URL slug (fast, reliable, no API calls needed)
  if (url.includes('bringatrailer.com/listing/')) {
    const urlParsed = parseBatUrl(url);
    if (urlParsed && urlParsed.make && urlParsed.make.toLowerCase() !== 'unknown') {
      return urlParsed;
    }
  }
  
  // Try parsing KSL URLs: /listing/10198413 (numeric ID only - can't extract make/model)
  if (url.includes('cars.ksl.com/listing/')) {
    // KSL URLs don't contain make/model in slug - skip
    return null;
  }
  
  // Try parsing Mecum URLs: /lots/1120475/oak-motor-oil-double-sided-porcelain-sign
  if (url.includes('mecum.com/lots/')) {
    // Mecum URLs contain item description, not vehicle make/model
    // These are often signs/items, not vehicles - skip
    return null;
  }
  
  return null;
}

async function fixUnknownVehicles() {
  console.log('🔍 Querying for vehicles with "Unknown" make or model...');
  
  // Query for vehicles with "Unknown" make or model that have BaT URLs
  // Better targeting: vehicles with "Unknown" in make OR model, AND have BaT listing URLs
  const { data: vehicles, error: fetchError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, bat_auction_url, title, description')
    .or('make.eq.Unknown,model.eq.Unknown')
    .or('discovery_url.ilike.%bringatrailer.com/listing/%,bat_auction_url.ilike.%bringatrailer.com/listing/%')
    .limit(100);
  
  if (fetchError) {
    console.error('❌ Error fetching vehicles:', fetchError);
    return;
  }
  
  // Filter to only vehicles with "Unknown" make/model AND BaT URLs
  const badDataVehicles = (vehicles || []).filter(v => 
    (v.make === 'Unknown' || v.model === 'Unknown') &&
    ((v.discovery_url && v.discovery_url.includes('bringatrailer.com/listing/')) ||
     (v.bat_auction_url && v.bat_auction_url.includes('bringatrailer.com/listing/')))
  );
  
  if (!badDataVehicles || badDataVehicles.length === 0) {
    console.log('✅ No vehicles with "Unknown" make/model and BaT URLs found');
    return;
  }
  
  console.log(`✅ Found ${badDataVehicles.length} vehicles with "Unknown" make/model to fix\n`);
  
  let fixed = 0;
  let skipped = 0;
  let errors = 0;
  let needsManualReview = 0;
  
  for (const vehicle of badDataVehicles) {
    console.log(`\n🔧 Processing: ${vehicle.id.slice(0, 8)}...`);
    console.log(`   Current: ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}`);
    
    // Get URL to extract from
    const url = vehicle.discovery_url || vehicle.bat_auction_url;
    
    if (!url || !url.includes('bringatrailer.com/listing/')) {
      console.log(`   ⏭️  Skipped: No BaT URL found`);
      skipped++;
      continue;
    }
    
    console.log(`   🔗 URL: ${url}`);
    
    // Step 1: Try Edge Function extraction (most reliable)
    let extracted = null;
    let extractionMethod = 'none';
    
    try {
      console.log(`   🚀 Invoking extract-premium-auction Edge Function...`);
      const { data: extractResult, error: extractError } = await supabase.functions.invoke('extract-premium-auction', {
        body: {
          url: url,
          max_vehicles: 1
        }
      });
      
      if (extractError) {
        console.log(`   ⚠️  Edge Function error: ${extractError.message}`);
      } else if (extractResult && extractResult.success) {
        // Check if vehicle was updated by looking up the vehicle again
        const { data: updatedVehicle, error: lookupError } = await supabase
          .from('vehicles')
          .select('id, year, make, model')
          .eq('id', vehicle.id)
          .single();
        
        if (!lookupError && updatedVehicle) {
          const stillBad = updatedVehicle.make === 'Unknown' || updatedVehicle.model === 'Unknown';
          if (!stillBad) {
            console.log(`   ✅ Edge Function updated vehicle: ${updatedVehicle.year || '?'} ${updatedVehicle.make} ${updatedVehicle.model}`);
            fixed++;
            // Wait before next vehicle to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          } else {
            console.log(`   ⚠️  Edge Function ran but vehicle still has "Unknown": ${updatedVehicle.make} ${updatedVehicle.model}`);
          }
        }
        
        // If Edge Function didn't fix it, try URL parsing as fallback
        extractionMethod = 'edge-function-failed';
      }
    } catch (e) {
      console.log(`   ⚠️  Edge Function exception: ${e.message}`);
      extractionMethod = 'edge-function-exception';
    }
    
    // Step 2: Fallback to URL parsing if Edge Function didn't work
    if (!extracted || extractionMethod !== 'none') {
      console.log(`   🔄 Trying URL slug parsing as fallback...`);
      extracted = await extractVehicleFromUrl(url);
      
      if (extracted && extracted.make && extracted.make.toLowerCase() !== 'unknown') {
        extractionMethod = 'url-parsing';
      } else {
        console.log(`   ⚠️  URL parsing failed - needs manual review`);
        needsManualReview++;
        continue;
      }
    }
    
    // Validate extracted data - must have make at minimum (required field)
    if (!extracted || !extracted.make || extracted.make.toLowerCase() === 'unknown') {
      console.log(`   ⚠️  Extraction failed: no valid make extracted - needs manual review`);
      needsManualReview++;
      continue;
    }
    
    // Prepare update payload
    const updates = {
      year: extracted.year || vehicle.year || null,
      make: extracted.make,
      model: extracted.model || null, // model can be null, but make cannot
      trim: extracted.trim || vehicle.trim || null,
      vin: extracted.vin || vehicle.vin || null,
    };
    
    // If model is missing, try to extract from title as fallback
    if (!updates.model && vehicle.title) {
      const titleMatch = vehicle.title.match(/\b(19|20)\d{2}\s+([A-Za-z][A-Za-z\s&]+?)\s+(.+?)(?:\s+on\s+Bring|$)/i);
      if (titleMatch && titleMatch[3]) {
        updates.model = titleMatch[3].trim();
        console.log(`   📝 Extracted model from title: "${updates.model}"`);
      }
    }
    
    // If we still don't have a model, try to extract from URL slug (should already be done, but double-check)
    if (!updates.model && updates.make && url) {
      const urlParsed = parseBatUrl(url);
      if (urlParsed && urlParsed.model) {
        updates.model = urlParsed.model;
        console.log(`   📝 Extracted model from URL slug: "${updates.model}"`);
      }
    }
    
    // Schema requires model to be NOT NULL, but we can't use "Unknown"
    // If we still don't have a model, try to infer from URL slug one more time
    if (!updates.model || updates.model.trim() === '') {
      // Try extracting model from the last part of URL slug if make was found
      if (url && updates.make) {
        const slugMatch = url.match(/\/listing\/(?:[\d-]+-)?([a-z0-9-]+)\/?$/i);
        if (slugMatch && slugMatch[1]) {
          const slugParts = slugMatch[1].split('-').filter(Boolean);
          const makeParts = updates.make.toLowerCase().split(/\s+/);
          
          // Find where make ends and model begins
          let modelStartIdx = makeParts.length > 1 ? 2 : 1;
          if (modelStartIdx < slugParts.length) {
            const modelParts = slugParts.slice(modelStartIdx)
              .filter(p => !/^\d+$/.test(p) || p.length <= 2) // Keep short numbers as part of model
              .map(titleCase);
            
            if (modelParts.length > 0) {
              updates.model = modelParts.join(' ').trim();
              console.log(`   📝 Inferred model from URL slug: "${updates.model}"`);
            }
          }
        }
      }
      
      // If still no model, we can't update (schema constraint)
      if (!updates.model || updates.model.trim() === '') {
        console.log(`   ⚠️  Cannot update: model is required (schema NOT NULL) but extraction failed`);
        console.log(`   💡 URL: ${url} - needs manual review`);
        needsManualReview++;
        continue;
      }
    }
    
    console.log(`   ✅ Extracted via ${extractionMethod}: ${updates.year || '?'} ${updates.make} ${updates.model}`);
    
    // Update vehicle manually (if Edge Function didn't already update it)
    const { error: updateError } = await supabase
      .from('vehicles')
      .update(updates)
      .eq('id', vehicle.id);
    
    if (updateError) {
      console.error(`   ❌ Update failed:`, updateError.message);
      errors++;
    } else {
      console.log(`   ✅ Fixed successfully!`);
      fixed++;
    }
    
    // Small delay to avoid rate limiting (longer if we called Edge Function)
    const delay = extractionMethod === 'edge-function-failed' || extractionMethod === 'edge-function-exception' ? 2000 : 1000;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 Summary:');
  console.log(`  ✅ Fixed: ${fixed}`);
  console.log(`  ⏭️  Skipped: ${skipped}`);
  console.log(`  ⚠️  Needs manual review: ${needsManualReview}`);
  console.log(`  ❌ Errors: ${errors}`);
  console.log('='.repeat(60));
  
  if (needsManualReview > 0) {
    console.log('\nℹ️  Vehicles that need manual review:');
    console.log('   - May have invalid URLs or extraction failures');
    console.log('   - May require schema changes (model NOT NULL constraint)');
    console.log('   - Consider running: SELECT id, discovery_url, make, model FROM vehicles WHERE make = \'Unknown\' OR model = \'Unknown\';');
  }
}

fixUnknownVehicles().catch(console.error);

