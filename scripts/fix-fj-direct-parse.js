#!/usr/bin/env node
/**
 * Direct HTML parsing for Fantasy Junction BaT vehicles
 * Bypasses Edge Functions to avoid timeouts
 * Fast, simple extraction from BaT HTML
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
const MAX_VEHICLES = parseInt(process.argv[2]) || 10;
const DELAY_BETWEEN = 2000; // 2 seconds

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
  });
  return await response.text();
}

function extractBatData(html) {
  const h = String(html || '');
  const data = {};
  
  // VIN - Use comprehensive patterns from extract-premium-auction
  const vinPatterns = [
    /<li[^>]*>\s*VIN:\s*<a[^>]*>([A-HJ-NPR-Z0-9]{8,17})<\/a>\s*<\/li>/i,
    /<li[^>]*>\s*VIN:\s*([A-HJ-NPR-Z0-9]{8,17})\s*<\/li>/i,
    /<li[^>]*>\s*Chassis:\s*<a[^>]*>([A-HJ-NPR-Z0-9]{4,16})<\/a>\s*<\/li>/i,
    /<li[^>]*>\s*Chassis:\s*([A-HJ-NPR-Z0-9]{4,16})\s*<\/li>/i,
    /(?:vin|vehicle\s*identification|chassis)[:\s#]*["']?([A-HJ-NPR-Z0-9]{8,17})\b/i,
    /"vin"[:\s]*"([A-HJ-NPR-Z0-9]{8,17})"/i,
  ];
  for (const pattern of vinPatterns) {
    const m = h.match(pattern);
    if (m?.[1]) {
      const v = m[1].toUpperCase().trim();
      if (v.length >= 8 && v.length <= 17 && !/[IOQ]/.test(v)) {
        data.vin = v;
        break;
      }
    }
  }
  
  // Extract from "essentials" section (most reliable for BaT)
  const essentialsStart = h.search(/<div[^>]*class="[^"]*essentials[^"]*"[^>]*>/i);
  let essentialsText = '';
  if (essentialsStart !== -1) {
    const slice = h.substring(essentialsStart, essentialsStart + 10000);
    essentialsText = slice.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  }
  
  const searchText = essentialsText || h;
  
  // Mileage - comprehensive patterns
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
  
  // Drivetrain (avoid false positives from global HTML)
  const driveText = essentialsText || '';
  if (driveText) {
    const drivePatterns = [
      /(?:drivetrain|drive\s*type|drive\s*train)[:\s]*["']?(AWD|4WD|RWD|FWD|4x4|All-Wheel|Rear-Wheel|Front-Wheel|Four-Wheel)/i,
      /\b(AWD|4WD|RWD|FWD|4x4|All-Wheel\s*Drive|Rear-Wheel\s*Drive|Front-Wheel\s*Drive|Four-Wheel\s*Drive)\b/i,
    ];
    for (const pattern of drivePatterns) {
      const m = driveText.match(pattern);
      if (m?.[1]) {
        data.drivetrain = m[1].trim().toUpperCase();
        break;
      }
    }
  } else {
    const labeledDrive = h.match(/(?:drivetrain|drive\s*type|drive\s*train)[:\s]*["']?([A-Za-z0-9\s-]{2,40})/i);
    if (labeledDrive?.[1]) {
      data.drivetrain = labeledDrive[1].trim().toUpperCase();
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
  
  // Trim - try to extract from model name or title if not explicitly stated
  // This is often not explicitly listed, so we'll parse from model patterns
  // Many BaT listings don't have trim, so this is best-effort
  
  // Description - extract first substantial paragraph
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
    if (extracted.vin && !vehicle.vin) updates.vin = extracted.vin;
    if (extracted.mileage && !vehicle.mileage) updates.mileage = extracted.mileage;
    if (extracted.color && !vehicle.color) updates.color = extracted.color;
    if (extracted.engine_size && !vehicle.engine_size) updates.engine_size = extracted.engine_size;
    if (extracted.transmission && !vehicle.transmission) updates.transmission = extracted.transmission;
    if (extracted.drivetrain && !vehicle.drivetrain) updates.drivetrain = extracted.drivetrain;
    if (extracted.description && (!vehicle.description || vehicle.description.length < 100)) {
      updates.description = extracted.description;
    }
    
    // Trim is tricky - try to extract from model name if not found
    if (!vehicle.trim && vehicle.model) {
      const trimMatch = vehicle.model.match(/\b(GT|GTS|GTI|GTR|RS|RSR|S|SE|LE|LX|EX|TURBO|TURBO\s+S|S4|S6|S8|AMG|M3|M5|M6|Z06|ZR1|Type\s+R|Type\s+S|Si|R\/T|SRT|Hellcat|Trackhawk|Coupe|Convertible|Roadster|Sedan|Wagon|SUV)\b/i);
      if (trimMatch) {
        updates.trim = trimMatch[1].trim();
      }
    }
    
    if (Object.keys(updates).length === 0) {
      return { success: true, updated: false, message: 'No missing fields found' };
    }
    
    const { error } = await supabase
      .from('vehicles')
      .update(updates)
      .eq('id', vehicle.id);
    
    if (error) {
      return { success: false, error: error.message };
    }
    
    return { success: true, updated: true, fields: Object.keys(updates) };
    
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function main() {
  console.log('🚀 Fantasy Junction Direct Parse Fix');
  console.log('='.repeat(60));
  console.log(`Processing ${MAX_VEHICLES} vehicles (direct HTML parsing, no Edge Functions)\n`);
  
  // Get Fantasy Junction vehicles
  const { data: orgVehicles } = await supabase
    .from('organization_vehicles')
    .select('vehicle_id')
    .eq('organization_id', FJ_ORG_ID)
    .limit(MAX_VEHICLES * 2);
  
  if (!orgVehicles || orgVehicles.length === 0) {
    console.log('❌ No Fantasy Junction vehicles found');
    return;
  }
  
  const vehicleIds = orgVehicles.map(ov => ov.vehicle_id);
  
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, bat_auction_url, vin, trim, mileage, drivetrain, transmission, engine_size')
    .in('id', vehicleIds)
    .or('discovery_url.ilike.%bringatrailer.com/listing/%,bat_auction_url.ilike.%bringatrailer.com/listing/%')
    .or('vin.is.null,trim.is.null')
    .limit(MAX_VEHICLES);
  
  if (!vehicles || vehicles.length === 0) {
    console.log('✅ No vehicles need fixing');
    return;
  }
  
  console.log(`Found ${vehicles.length} vehicles to fix\n`);
  
  let success = 0;
  let updated = 0;
  let failed = 0;
  const startTime = Date.now();
  
  for (let i = 0; i < vehicles.length; i++) {
    const vehicle = vehicles[i];
    console.log(`[${i + 1}/${vehicles.length}] ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}`);
    
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
  
  console.log('\n' + '='.repeat(60));
  console.log(`✅ Success: ${success}`);
  console.log(`🔄 Updated: ${updated}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`⏱️  Time: ${elapsed}s (${(elapsed / vehicles.length).toFixed(1)}s per vehicle)`);
  console.log(`📊 Estimated time for 381 vehicles: ${((elapsed / vehicles.length) * 381 / 60).toFixed(1)} minutes`);
  console.log('='.repeat(60));
  
  if (updated > 0 && elapsed / vehicles.length < 5) {
    console.log('\n✅ Approach works! Scale up to process all vehicles.');
  } else if (updated === 0) {
    console.log('\n⚠️  No vehicles were updated - may need better extraction patterns.');
  }
}

main().catch(console.error);
