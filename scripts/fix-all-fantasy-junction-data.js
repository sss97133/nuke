#!/usr/bin/env node
/**
 * Comprehensive fix for ALL Fantasy Junction vehicles
 * - Fixes BaT listings (uses extract-premium-auction)
 * - Fixes website inventory (improved HTML parsing)
 * - Ensures consistent, complete data
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

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

const BATCH_SIZE = 3;
const DELAY_BETWEEN_VEHICLES = 3000;
const DELAY_BETWEEN_BATCHES = 8000;

async function fetchWithTimeout(url, timeout = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    clearTimeout(timeoutId);
    return await response.text();
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

function extractTrimFromModel(model) {
  if (!model) return null;
  
  // Common trim patterns in model names
  const trimPatterns = [
    /(GT|GTS|GTI|GTR|RS|RSR|S|SE|LE|LX|EX|TURBO|TURBO\s+S|S4|S6|S8|AMG|M3|M5|M6|Z06|ZR1|Type\s+R|Type\s+S|Si|R\/T|SRT|Hellcat|Trackhawk)/i,
    /(Coupe|Convertible|Roadster|Hardtop|Sedan|Wagon|Hatchback|SUV|Pickup|Cabriolet|Spider)/i,
    /(Super\s+Sport|SS|Base|Deluxe|Custom|Special|Limited|Ultimate|Premium|Sport|Racing)/i,
  ];
  
  for (const pattern of trimPatterns) {
    const match = model.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  return null;
}

function extractDrivetrainFromText(text) {
  if (!text) return null;
  
  const drivetrainPatterns = [
    /(AWD|All-Wheel Drive|All Wheel Drive)/i,
    /(4WD|Four-Wheel Drive|Four Wheel Drive|4x4)/i,
    /(RWD|Rear-Wheel Drive|Rear Wheel Drive)/i,
    /(FWD|Front-Wheel Drive|Front Wheel Drive)/i,
  ];
  
  for (const pattern of drivetrainPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].toUpperCase();
    }
  }
  
  return null;
}

async function extractFantasyJunctionWebsiteData(url) {
  try {
    console.log(`   📄 Fetching Fantasy Junction listing...`);
    const html = await fetchWithTimeout(url);
    
    const data = {};
    
    // Extract specs from ul.no-bullet.ruled
    const specsMatch = html.match(/<ul[^>]*class="[^"]*no-bullet[^"]*ruled[^"]*"[^>]*>([\s\S]*?)<\/ul>/i);
    if (specsMatch) {
      let specsText = specsMatch[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      // VIN
      const vinMatch = specsText.match(/VIN\s+([A-Z0-9]+)/i);
      if (vinMatch) data.vin = vinMatch[1].trim();
      
      // Exterior Color
      const extColorMatch = specsText.match(/Exterior\s+Color\s+([A-Za-z][A-Za-z\s]+?)(?:\s+Interior|$)/i);
      if (extColorMatch) data.color = extColorMatch[1].trim();
      
      // Interior Color
      const intColorMatch = specsText.match(/Interior\s+Color\s+([A-Za-z][A-Za-z\s]+?)(?:\s+Mileage|Engine|$)/i);
      if (intColorMatch) data.interior_color = intColorMatch[1].trim();
      
      // Mileage - handle "412 Kilometers (TMU)" or "5000 Miles" or "TMU"
      const mileageMatch = specsText.match(/Mileage\s+([\d,]+)\s*(?:Kilometers|Miles|km|mi)?(?:\s*\(TMU\))?/i);
      if (mileageMatch) {
        const mileage = parseInt(mileageMatch[1].replace(/,/g, ''), 10);
        data.mileage = mileage;
      }
      
      // Engine - improved pattern
      const engineMatch = specsText.match(/Engine\s+([A-Za-z0-9.\-\sL]+?)(?:\s+Engine\s+no|Transmission|Drivetrain|$)/i);
      if (engineMatch) {
        data.engine_size = engineMatch[1].trim();
      }
      
      // Transmission
      const transMatch = specsText.match(/Transmission\s+([A-Za-z0-9\-\s]+?)(?:\s+Drivetrain|Status|Stock|$)/i);
      if (transMatch) {
        data.transmission = transMatch[1].trim();
      }
      
      // Drivetrain - look for it explicitly
      const drivetrainMatch = specsText.match(/Drivetrain\s+([A-Za-z0-9\-\s]+?)(?:\s+Status|Stock|$)/i) ||
                             specsText.match(/(AWD|4WD|RWD|FWD|All-Wheel|Rear-Wheel|Front-Wheel|Four-Wheel)/i);
      if (drivetrainMatch) {
        data.drivetrain = drivetrainMatch[1].trim().toUpperCase();
      }
      
      // Extract drivetrain from full text if not found
      if (!data.drivetrain) {
        data.drivetrain = extractDrivetrainFromText(specsText);
      }
      
      // Stock Number
      const stockMatch = specsText.match(/Stock\s+([A-Z0-9]+)/i);
      if (stockMatch) {
        data.stock_number = stockMatch[1].trim();
      }
    }
    
    // Extract description
    const descSection = html.match(/<div[^>]*class="[^"]*cell[^"]*small-12[^"]*"[^>]*>([\s\S]{500,10000})<\/div>/i);
    if (descSection) {
      let description = descSection[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();
      
      description = description.replace(/^DESCRIPTION\s+/i, '').trim();
      
      // Extract trim from description if model doesn't have it
      if (!data.trim && description) {
        data.trim = extractTrimFromModel(description);
        // Also try extracting drivetrain from description
        if (!data.drivetrain) {
          data.drivetrain = extractDrivetrainFromText(description);
        }
      }
      
      if (description.length > 100) {
        if (description.length > 5000) {
          description = description.substring(0, 5000) + '...';
        }
        data.description = description;
      }
    }
    
    // Extract price
    const priceMatch = html.match(/\$([\d,]+)/);
    if (priceMatch) {
      data.asking_price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
    }
    
    return data;
    
  } catch (error) {
    console.error(`   ❌ Error extracting website data:`, error.message);
    return null;
  }
}

async function fixVehicle(vehicle) {
  const url = vehicle.discovery_url || vehicle.bat_auction_url || vehicle.listing_url;
  if (!url) {
    return { success: false, error: 'No URL found' };
  }
  
  const isBatListing = url.includes('bringatrailer.com/listing/');
  const isFJWebsite = url.includes('fantasyjunction.com/inventory');
  
  try {
    if (isBatListing) {
      // Use extract-premium-auction for BaT listings
      console.log(`   🚀 Using extract-premium-auction for BaT listing...`);
      const { data: extractResult, error: extractError } = await supabase.functions.invoke('extract-premium-auction', {
        body: {
          url: url,
          max_vehicles: 1,
          download_images: true
        }
      });
      
      if (extractError || !extractResult?.success) {
        return { success: false, error: extractError?.message || extractResult?.error || 'Extraction failed' };
      }
      
      return { success: true, method: 'bat_extraction' };
      
    } else if (isFJWebsite) {
      // Use improved HTML parsing for Fantasy Junction website
      console.log(`   📄 Using improved HTML parsing for FJ website...`);
      const extractedData = await extractFantasyJunctionWebsiteData(url);
      
      if (!extractedData) {
        return { success: false, error: 'Failed to extract data' };
      }
      
      // Calculate what's missing
      const updates = {};
      if (extractedData.vin && !vehicle.vin) updates.vin = extractedData.vin;
      if (extractedData.trim && !vehicle.trim) updates.trim = extractedData.trim;
      if (extractedData.mileage && !vehicle.mileage) updates.mileage = extractedData.mileage;
      if (extractedData.color && !vehicle.color) updates.color = extractedData.color;
      if (extractedData.transmission && !vehicle.transmission) updates.transmission = extractedData.transmission;
      if (extractedData.engine_size && !vehicle.engine_size) updates.engine_size = extractedData.engine_size;
      if (extractedData.drivetrain && !vehicle.drivetrain) updates.drivetrain = extractedData.drivetrain;
      if (extractedData.description && (!vehicle.description || vehicle.description.length < 100)) {
        updates.description = extractedData.description;
      }
      if (extractedData.asking_price && !vehicle.asking_price) updates.asking_price = extractedData.asking_price;
      
      if (Object.keys(updates).length === 0) {
        return { success: true, method: 'fj_parsing', updated: false, message: 'No missing fields to update' };
      }
      
      // Update vehicle
      const { error: updateError } = await supabase
        .from('vehicles')
        .update(updates)
        .eq('id', vehicle.id);
      
      if (updateError) {
        return { success: false, error: updateError.message };
      }
      
      return { success: true, method: 'fj_parsing', updated: true, fields_updated: Object.keys(updates) };
      
    } else {
      return { success: false, error: 'Unknown URL type' };
    }
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function getFantasyJunctionVehicles() {
  console.log('🔍 Finding all Fantasy Junction vehicles...\n');
  
  // Method 1: Direct Fantasy Junction source
  const { data: directVehicles, error: directError } = await supabase
    .from('vehicles')
    .select(`
      id,
      year,
      make,
      model,
      discovery_url,
      bat_auction_url,
      listing_url,
      vin,
      mileage,
      color,
      trim,
      transmission,
      engine_size,
      drivetrain,
      description,
      asking_price
    `)
    .or('discovery_source.ilike.%fantasy%,discovery_url.ilike.%fantasyjunction%,origin_metadata->>source.ilike.%fantasy%')
    .limit(10000);
  
  if (directError) {
    console.error('❌ Error fetching direct vehicles:', directError);
  }
  
  // Method 2: Via organization relationship (Fantasy Junction org)
  const FJ_ORG_ID = '1d9122ea-1aaf-46ea-81ea-5f75cb259b69';
  const { data: orgVehicles, error: orgError } = await supabase
    .from('organization_vehicles')
    .select('vehicle_id')
    .eq('organization_id', FJ_ORG_ID)
    .limit(10000);
  
  let orgVehicleIds = [];
  if (!orgError && orgVehicles) {
    orgVehicleIds = orgVehicles.map(ov => ov.vehicle_id);
    
    if (orgVehicleIds.length > 0) {
      const { data: orgLinkedVehicles, error: linkedError } = await supabase
        .from('vehicles')
        .select(`
          id,
          year,
          make,
          model,
          discovery_url,
          bat_auction_url,
          listing_url,
          vin,
          mileage,
          color,
          trim,
          transmission,
          engine_size,
          drivetrain,
          description,
          asking_price
        `)
        .in('id', orgVehicleIds)
        .limit(10000);
      
      if (!linkedError && orgLinkedVehicles) {
        // Merge with direct vehicles, avoiding duplicates
        const directIds = new Set((directVehicles || []).map(v => v.id));
        const uniqueOrgVehicles = orgLinkedVehicles.filter(v => !directIds.has(v.id));
        
        console.log(`   Found ${directVehicles?.length || 0} direct Fantasy Junction vehicles`);
        console.log(`   Found ${orgVehicleIds.length} vehicles via organization relationship`);
        console.log(`   Adding ${uniqueOrgVehicles.length} additional vehicles from org\n`);
        
        return [...(directVehicles || []), ...uniqueOrgVehicles];
      }
    }
  }
  
  return directVehicles || [];
}

function calculateMissingScore(vehicle) {
  let score = 0;
  const missing = [];
  
  if (!vehicle.vin) { score += 3; missing.push('VIN'); }
  if (!vehicle.description || vehicle.description.length < 100) { score += 2; missing.push('description'); }
  if (!vehicle.trim) { score += 2; missing.push('trim'); }
  if (!vehicle.mileage) { score += 1; missing.push('mileage'); }
  if (!vehicle.color) { score += 1; missing.push('color'); }
  if (!vehicle.transmission) { score += 1; missing.push('transmission'); }
  if (!vehicle.engine_size) { score += 1; missing.push('engine_size'); }
  if (!vehicle.drivetrain) { score += 2; missing.push('drivetrain'); }
  if (!vehicle.asking_price) { score += 1; missing.push('asking_price'); }
  
  return { score, missing };
}

async function main() {
  console.log('🚀 Fantasy Junction Comprehensive Data Fix');
  console.log('='.repeat(80));
  
  const vehicles = await getFantasyJunctionVehicles();
  
  if (vehicles.length === 0) {
    console.log('✅ No Fantasy Junction vehicles found');
    return;
  }
  
  console.log(`✅ Found ${vehicles.length} Fantasy Junction vehicles\n`);
  
  // Score vehicles by missing data
  const scoredVehicles = vehicles.map(v => {
    const { score, missing } = calculateMissingScore(v);
    return { ...v, missing_score: score, missing_fields: missing };
  })
  .filter(v => v.missing_score > 0)
  .sort((a, b) => b.missing_score - a.missing_score);
  
  console.log(`📊 Vehicles needing fixes: ${scoredVehicles.length} (out of ${vehicles.length} total)`);
  console.log(`   Top priority: ${scoredVehicles.slice(0, 10).length} vehicles with score ≥5\n`);
  
  const MAX_VEHICLES = parseInt(process.argv[2]) || scoredVehicles.length;
  const vehiclesToFix = scoredVehicles.slice(0, MAX_VEHICLES);
  
  console.log(`🚀 Processing ${vehiclesToFix.length} vehicles...\n`);
  
  let successCount = 0;
  let failCount = 0;
  let updatedCount = 0;
  const startTime = Date.now();
  
  for (let i = 0; i < vehiclesToFix.length; i += BATCH_SIZE) {
    const batch = vehiclesToFix.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(vehiclesToFix.length / BATCH_SIZE);
    
    console.log(`\n📦 Batch ${batchNum}/${totalBatches} (${batch.length} vehicles)`);
    console.log('-'.repeat(80));
    
    for (const vehicle of batch) {
      const missingStr = vehicle.missing_fields.join(', ');
      const urlType = vehicle.discovery_url?.includes('bringatrailer') ? 'BaT' : 'FJ Website';
      console.log(`\n🔧 [Score: ${vehicle.missing_score}] ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}`);
      console.log(`   Missing: ${missingStr}`);
      console.log(`   URL Type: ${urlType}`);
      
      const result = await fixVehicle(vehicle);
      
      if (result.success) {
        successCount++;
        if (result.updated) {
          updatedCount++;
          console.log(`   ✅ Fixed! Updated fields: ${result.fields_updated?.join(', ') || 'N/A'}`);
        } else if (result.method === 'bat_extraction') {
          console.log(`   ✅ BaT extraction completed`);
        } else {
          console.log(`   ℹ️  ${result.message || 'Already complete'}`);
        }
      } else {
        failCount++;
        console.log(`   ❌ Failed: ${result.error}`);
      }
      
      if (i + batch.length < vehiclesToFix.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_VEHICLES));
      }
    }
    
    if (i + BATCH_SIZE < vehiclesToFix.length) {
      console.log(`\n⏳ Waiting ${DELAY_BETWEEN_BATCHES / 1000}s before next batch...`);
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    }
  }
  
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total Vehicles: ${vehicles.length}`);
  console.log(`Vehicles Needing Fixes: ${scoredVehicles.length}`);
  console.log(`Vehicles Processed: ${vehiclesToFix.length}`);
  console.log(`✅ Successful: ${successCount}`);
  console.log(`🔄 Fields Updated: ${updatedCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`⏱️  Time Elapsed: ${elapsed} minutes`);
  console.log('='.repeat(80));
}

main().catch(console.error);
