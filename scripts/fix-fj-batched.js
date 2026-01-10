#!/usr/bin/env node
/**
 * Batched Fantasy Junction fix - 5 minute batches
 * Processes ~60 vehicles per batch (~5 seconds each)
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

const FJ_ORG_ID = '1d9122ea-1aaf-46ea-81ea-5f75cb259b69';
const VEHICLES_PER_BATCH = 60; // ~5 minutes at 5s per vehicle
const DELAY_BETWEEN = 2000; // 2 seconds between vehicles

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
  });
  return await response.text();
}

function extractBatData(html) {
  const h = String(html || '');
  const data = {};
  
  // Extract essentials section first
  const essentialsStart = h.search(/<div[^>]*class="[^"]*essentials[^"]*"[^>]*>/i);
  let essentialsText = '';
  if (essentialsStart !== -1) {
    const slice = h.substring(essentialsStart, essentialsStart + 10000);
    essentialsText = slice.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  }
  
  const searchText = essentialsText || h;
  
  // VIN - comprehensive patterns (handle "Chassis:" format)
  const vinPatterns = [
    /<li[^>]*>\s*VIN:\s*<a[^>]*>([A-HJ-NPR-Z0-9]{8,17})<\/a>\s*<\/li>/i,
    /<li[^>]*>\s*VIN:\s*([A-HJ-NPR-Z0-9]{8,17})\s*<\/li>/i,
    /<li[^>]*>\s*Chassis:\s*<a[^>]*>([A-HJ-NPR-Z0-9]{8,17})<\/a>\s*<\/li>/i,
    /<li[^>]*>\s*Chassis:\s*([A-HJ-NPR-Z0-9]{8,17})\s*<\/li>/i,
    // Match "Chassis: 1G1YY26Y565100149" in essentials text
    /Chassis:\s*([A-HJ-NPR-Z0-9]{8,17})\b/i,
    /Chassis[:\s]+([A-HJ-NPR-Z0-9]{8,17})\b/i,
    /(?:vin|vehicle\s*identification)[:\s#]*["']?([A-HJ-NPR-Z0-9]{8,17})\b/i,
    /"vin"[:\s]*"([A-HJ-NPR-Z0-9]{8,17})"/i,
  ];
  for (const pattern of vinPatterns) {
    const m = searchText.match(pattern) || h.match(pattern);
    if (m?.[1]) {
      const v = m[1].toUpperCase().trim();
      // Accept 8-17 character VINs/chassis numbers (no I, O, Q)
      if (v.length >= 8 && v.length <= 17 && !/[IOQ]/.test(v)) {
        data.vin = v;
        break;
      }
    }
  }
  
  // Mileage
  const mileagePatterns = [
    /(?:mileage|odometer)[:\s]*["']?([0-9,]+)(?:\s*miles)?/i,
    /(?:showing\s*)?([0-9,]+)\s*miles?\b/i,
    /"mileage"[:\s]*"?([0-9,]+)"?/i,
    />([0-9,]+)\s*Miles?</i,
  ];
  for (const pattern of mileagePatterns) {
    const m = searchText.match(pattern);
    if (m?.[1]) {
      const mileage = parseInt(m[1].replace(/,/g, ''), 10);
      if (mileage > 0 && mileage < 10000000) {
        data.mileage = mileage;
        break;
      }
    }
  }
  
  // Transmission
  const transPatterns = [
    /(?:transmission|gearbox)[:\s]*["']?([^<"'\n]{3,50})/i,
    /((?:five|six|four|three|seven|eight)\s*-?\s*speed\s*(?:manual|automatic|auto|sequential|dual-clutch|dct|dsg|tiptronic|pdk|smg))/i,
    /(\d-speed\s*(?:manual|automatic|auto|sequential|dual-clutch|dct|dsg|tiptronic|pdk|smg))/i,
  ];
  for (const pattern of transPatterns) {
    const m = searchText.match(pattern);
    if (m?.[1] && m[1].length > 2 && m[1].length < 80) {
      data.transmission = m[1].trim();
      break;
    }
  }
  
  // Engine
  const enginePatterns = [
    /(?:engine|motor|powertrain)[:\s]*["']?([^<"'\n]{3,80})/i,
    /(\d+(?:\.\d+)?\s*-?\s*(?:liter|L)\s*[A-Za-z0-9\s\-]+(?:engine|motor)?)/i,
    /((?:twin-turbo|turbo|supercharged|naturally\s*aspirated)?\s*\d+(?:\.\d+)?\s*(?:L|liter)\s*[VvIi]?\d*(?:\s*engine)?)/i,
  ];
  for (const pattern of enginePatterns) {
    const m = searchText.match(pattern);
    if (m?.[1] && m[1].length > 2 && m[1].length < 100) {
      data.engine_size = m[1].trim();
      break;
    }
  }
  
  // Drivetrain
  const drivePatterns = [
    /(?:drivetrain|drive\s*type)[:\s]*["']?(AWD|4WD|RWD|FWD|4x4|All-Wheel|Rear-Wheel|Front-Wheel|Four-Wheel)/i,
    /\b(AWD|4WD|RWD|FWD|4x4|All-Wheel\s*Drive|Rear-Wheel\s*Drive|Front-Wheel\s*Drive|Four-Wheel\s*Drive)\b/i,
  ];
  for (const pattern of drivePatterns) {
    const m = searchText.match(pattern);
    if (m?.[1]) {
      data.drivetrain = m[1].trim().toUpperCase();
      break;
    }
  }
  
  // Color
  const colorPatterns = [
    /(?:exterior\s*)?color[:\s]*["']?([A-Za-z][A-Za-z\s]+?(?:Metallic|Pearl|Black|White|Red|Blue|Green|Silver|Gray|Grey|Yellow|Orange|Brown|Beige|Gold|Bronze|Purple|Maroon|Burgundy)?)\b/i,
    /"color"[:\s]*"([^"]+)"/i,
  ];
  for (const pattern of colorPatterns) {
    const m = searchText.match(pattern);
    if (m?.[1] && m[1].length > 2 && m[1].length < 50 && !m[1].toLowerCase().includes('interior')) {
      data.color = m[1].trim();
      break;
    }
  }
  
  // Description
  const descMatch = h.match(/<div[^>]*class="[^"]*post-content[^"]*"[^>]*>([\s\S]{200,3000}?)<\/div>/i) ||
                    h.match(/<p[^>]*>([^<]{100,1000})<\/p>/i);
  if (descMatch) {
    let desc = descMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (desc.length > 100 && desc.length < 5000) {
      data.description = desc.substring(0, 5000);
    }
  }
  
  return data;
}

async function fixVehicle(vehicle) {
  const url = vehicle.discovery_url || vehicle.bat_auction_url;
  if (!url || !url.includes('bringatrailer.com/listing/')) {
    return { success: false, error: 'No BaT URL' };
  }
  
  try {
    const html = await fetchHtml(url);
    const extracted = extractBatData(html);
    
    const updates = {};
    
    // Check if VIN already exists on another vehicle before adding it
    if (extracted.vin && !vehicle.vin) {
      const { data: existing } = await supabase
        .from('vehicles')
        .select('id')
        .eq('vin', extracted.vin)
        .neq('id', vehicle.id)
        .maybeSingle();
      
      if (!existing) {
        updates.vin = extracted.vin;
      }
    }
    
    if (extracted.mileage && !vehicle.mileage) updates.mileage = extracted.mileage;
    if (extracted.color && !vehicle.color) updates.color = extracted.color;
    if (extracted.engine_size && !vehicle.engine_size) updates.engine_size = extracted.engine_size;
    if (extracted.transmission && !vehicle.transmission) updates.transmission = extracted.transmission;
    if (extracted.drivetrain && !vehicle.drivetrain) updates.drivetrain = extracted.drivetrain;
    if (extracted.description && (!vehicle.description || vehicle.description.length < 100)) {
      updates.description = extracted.description;
    }
    
    // Trim from model name - more comprehensive patterns
    if (!vehicle.trim && vehicle.model) {
      // Try multiple trim patterns
      const trimPatterns = [
        /\b(Z06|ZR1|GT3|GT3\s+RS|GT3\s+RS\s+Weissach|GT|GTS|GTI|GTR|RS|RSR|S|SE|LE|LX|EX|Si|R\/T|SRT|Hellcat|Trackhawk|AMG|M3|M4|M5|M6|Type\s+R|Type\s+S)\b/i,
        /\b(Coupe|Convertible|Roadster|Cabriolet|Targa|Sedan|Wagon|SUV|Hatchback|Pickup|Hardtop|Spider)\b/i,
        /\b(Super\s+Sport|SS|Turbo|Twin\s+Turbo|Supercharged|Base|Deluxe|Custom|Special|Limited|Ultimate|Premium|Sport|Racing)\b/i,
        /\b(\d+[a-z]?)\s*(Coupe|Convertible|Roadster|Sedan|Wagon)\b/i, // e.g. "911 Turbo"
      ];
      
      for (const pattern of trimPatterns) {
        const trimMatch = vehicle.model.match(pattern);
        if (trimMatch && trimMatch[1]) {
          const trim = trimMatch[1].trim();
          // Skip if it's just a number or too short
          if (trim.length >= 2 && !/^\d+$/.test(trim)) {
            updates.trim = trim;
            break;
          }
        }
      }
      
      // Also try extracting from description if available
      if (!updates.trim && extracted.description) {
        const descTrimMatch = extracted.description.match(/\b(GT|GTS|GTI|GTR|RS|RSR|S|SE|Turbo|AMG|M\d+|Z06|ZR1)\b/i);
        if (descTrimMatch) {
          updates.trim = descTrimMatch[1].trim();
        }
      }
    }
    
    // Check what's actually missing vs what we extracted
    const missingFields = [];
    if (!vehicle.vin) missingFields.push('VIN');
    if (!vehicle.trim) missingFields.push('trim');
    if (!vehicle.description || vehicle.description.length < 100) missingFields.push('description');
    
    if (Object.keys(updates).length === 0) {
      // If vehicle still needs fixes but we didn't extract anything, report what's missing
      if (missingFields.length > 0) {
        const extractedFields = [];
        if (extracted.vin) extractedFields.push('VIN');
        if (extracted.trim) extractedFields.push('trim');
        if (extracted.description) extractedFields.push('description');
        
        return { 
          success: true, 
          updated: false, 
          message: `Missing: ${missingFields.join(', ')} but couldn't extract from HTML${extractedFields.length > 0 ? ` (found: ${extractedFields.join(', ')})` : ''}` 
        };
      }
      return { success: true, updated: false, message: 'Already complete' };
    }
    
    const { error } = await supabase
      .from('vehicles')
      .update(updates)
      .eq('id', vehicle.id);
    
    if (error) {
      // Handle duplicate VIN gracefully
      if (error.message.includes('vin_unique_index')) {
        return { success: true, updated: false, message: 'VIN already exists on another vehicle' };
      }
      return { success: false, error: error.message };
    }
    
    return { success: true, updated: true, fields: Object.keys(updates) };
    
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function getAllFantasyJunctionVehiclesNeedingFixes() {
  // Get all Fantasy Junction vehicles at once
  const { data: orgVehicles } = await supabase
    .from('organization_vehicles')
    .select('vehicle_id')
    .eq('organization_id', FJ_ORG_ID)
    .limit(1000);
  
  if (!orgVehicles || orgVehicles.length === 0) return [];
  
  const vehicleIds = orgVehicles.map(ov => ov.vehicle_id);
  
  // Get ALL vehicles with BaT URLs
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, bat_auction_url, vin, trim, mileage, color, drivetrain, transmission, engine_size, description')
    .in('id', vehicleIds);
  
  if (!vehicles) return [];
  
  // Filter to vehicles that need fixes (have BaT URL AND missing critical data)
  return vehicles.filter(v => {
    const hasBatUrl = (v.discovery_url || v.bat_auction_url || '').includes('bringatrailer.com/listing/');
    if (!hasBatUrl) return false;
    
    // Need fix if missing VIN, trim, or has poor description
    const needsFix = !v.vin || !v.trim || !v.description || v.description.length < 100;
    return needsFix;
  });
}

async function processBatch(batchNum, vehicles) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`📦 BATCH ${batchNum} - Processing ${vehicles.length} vehicles`);
  console.log(`${'='.repeat(70)}\n`);
  
  const startTime = Date.now();
  let success = 0;
  let updated = 0;
  let failed = 0;
  
  for (let i = 0; i < vehicles.length; i++) {
    const vehicle = vehicles[i];
    const displayName = `${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}`.substring(0, 50);
    console.log(`[${i + 1}/${vehicles.length}] ${displayName}`);
    
    const result = await fixVehicle(vehicle);
    
    if (result.success) {
      success++;
      if (result.updated) {
        updated++;
        console.log(`   ✅ Updated: ${result.fields.join(', ')}`);
      } else {
        console.log(`   ℹ️  ${result.message || 'Already complete'}`);
      }
    } else {
      failed++;
      console.log(`   ❌ Failed: ${result.error}`);
    }
    
    if (i < vehicles.length - 1) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN));
    }
  }
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const elapsedMin = (elapsed / 60).toFixed(1);
  
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Batch ${batchNum} Complete - ${elapsedMin} minutes`);
  console.log(`✅ Success: ${success} | 🔄 Updated: ${updated} | ❌ Failed: ${failed}`);
  console.log(`${'='.repeat(70)}\n`);
  
  return { success, updated, failed, elapsed };
}

async function main() {
  console.log('🚀 Fantasy Junction Batched Fix (5-minute batches)');
  console.log('='.repeat(70));
  
  // Get total count
  const { count: totalCount } = await supabase
    .from('organization_vehicles')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', FJ_ORG_ID);
  
  console.log(`Total Fantasy Junction vehicles: ${totalCount || 381}`);
  console.log(`Batch size: ${VEHICLES_PER_BATCH} vehicles (~5 minutes each)\n`);
  
  // Get ALL vehicles needing fixes
  console.log('🔍 Fetching all Fantasy Junction vehicles needing fixes...\n');
  const allVehiclesNeedingFixes = await getAllFantasyJunctionVehiclesNeedingFixes();
  
  console.log(`✅ Found ${allVehiclesNeedingFixes.length} vehicles needing fixes\n`);
  
  if (allVehiclesNeedingFixes.length === 0) {
    console.log('🎉 No vehicles need fixing!');
    return;
  }
  
  // Process in batches
  let batchNum = 1;
  let totalSuccess = 0;
  let totalUpdated = 0;
  let totalFailed = 0;
  
  for (let i = 0; i < allVehiclesNeedingFixes.length; i += VEHICLES_PER_BATCH) {
    const batch = allVehiclesNeedingFixes.slice(i, i + VEHICLES_PER_BATCH);
    const result = await processBatch(batchNum, batch);
    
    totalSuccess += result.success;
    totalUpdated += result.updated;
    totalFailed += result.failed;
    
    // Pause between batches (except for last batch)
    if (i + VEHICLES_PER_BATCH < allVehiclesNeedingFixes.length) {
      batchNum++;
      console.log(`💤 Pausing before next batch... (Press Ctrl+C to stop)\n`);
      console.log(`📊 Progress: ${Math.min(i + VEHICLES_PER_BATCH, allVehiclesNeedingFixes.length)} / ${allVehiclesNeedingFixes.length} vehicles`);
      console.log(`   Total updated so far: ${totalUpdated} vehicles\n`);
      
      // Wait 10 seconds between batches
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('🎉 ALL BATCHES COMPLETE');
  console.log('='.repeat(70));
  console.log(`Total Processed: ${allVehiclesNeedingFixes.length} vehicles`);
  console.log(`✅ Successful: ${totalSuccess}`);
  console.log(`🔄 Total Updated: ${totalUpdated}`);
  console.log(`❌ Failed: ${totalFailed}`);
  console.log('='.repeat(70));
}

main().catch(console.error);
