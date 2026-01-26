#!/usr/bin/env node
/**
 * Fix "Unknown Unknown" vehicles by parsing make/model from BaT URL slugs
 * 
 * BaT URLs format: /listing/1969-alfa-romeo-gtv-1750-16
 *                  /listing/1981-honda-cb900c-custom-8
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

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
    const match = url.match(/\/listing\/(\d{4})-([a-z0-9-]+)\/?$/i);
    if (!match || !match[1] || !match[2]) return null;
    
    const year = parseInt(match[1], 10);
    if (!Number.isFinite(year) || year < 1885 || year > new Date().getFullYear() + 1) {
      return null;
    }
    
    const parts = match[2].split('-').filter(Boolean);
    if (parts.length < 2) return null;
    
    // Handle multi-word makes
    const multiWordMakes = {
      'alfa': 'Alfa Romeo',
      'mercedes': 'Mercedes-Benz',
      'land': 'Land Rover',
      'aston': 'Aston Martin',
    };
    
    let make = null;
    let model = null;
    
    const firstPart = parts[0].toLowerCase();
    if (multiWordMakes[firstPart] && parts.length > 1) {
      const makeParts = multiWordMakes[firstPart].split(' ');
      const secondPart = parts[1].toLowerCase();
      if (secondPart === makeParts[1]?.toLowerCase()) {
        // Two-word make (e.g., "alfa-romeo")
        make = multiWordMakes[firstPart];
        model = parts.slice(2)
          .filter(p => !/^\d+$/.test(p)) // Remove trailing numbers
          .map(titleCase)
          .join(' ')
          .trim() || null;
      } else {
        // Single-word make
        make = titleCase(parts[0]);
        model = parts.slice(1)
          .filter(p => !/^\d+$/.test(p))
          .map(titleCase)
          .join(' ')
          .trim() || null;
      }
    } else {
      // Single-word make
      make = titleCase(parts[0]);
      model = parts.slice(1)
        .filter(p => !/^\d+$/.test(p))
        .map(titleCase)
        .join(' ')
        .trim() || null;
    }
    
    // Remove trailing numbers from model (e.g., "Gtv 1750" -> "Gtv")
    if (model) {
      model = model.replace(/\s+\d+$/, '').trim();
    }
    
    return { year, make, model };
  } catch (e) {
    console.warn(`Error parsing URL ${url}:`, e.message);
    return null;
  }
}

async function fixUnknownVehicles() {
  console.log('🔍 Finding vehicles with "Unknown Unknown"...');
  
  const { data: vehicles, error: fetchError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, bat_auction_url')
    .or('make.eq.Unknown,model.eq.Unknown')
    .or('discovery_url.ilike.%bringatrailer.com/listing/%,bat_auction_url.ilike.%bringatrailer.com/listing/%');
  
  if (fetchError) {
    console.error('❌ Error fetching vehicles:', fetchError);
    return;
  }
  
  console.log(`✅ Found ${vehicles?.length || 0} vehicles to check`);
  
  let fixed = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const vehicle of vehicles || []) {
    const url = vehicle.discovery_url || vehicle.bat_auction_url;
    if (!url || (!url.includes('bringatrailer.com/listing/'))) {
      skipped++;
      continue;
    }
    
    const parsed = parseBatUrl(url);
    if (!parsed || !parsed.make || !parsed.model) {
      skipped++;
      continue;
    }
    
    // Only update if currently "Unknown Unknown"
    if (vehicle.make !== 'Unknown' && vehicle.model !== 'Unknown') {
      skipped++;
      continue;
    }
    
    const updates = {
      year: parsed.year || vehicle.year,
      make: parsed.make,
      model: parsed.model,
    };
    
    const { error: updateError } = await supabase
      .from('vehicles')
      .update(updates)
      .eq('id', vehicle.id);
    
    if (updateError) {
      console.error(`❌ Error updating vehicle ${vehicle.id}:`, updateError);
      errors++;
    } else {
      console.log(`✅ Fixed: ${updates.year} ${updates.make} ${updates.model} (${vehicle.id.slice(0, 8)}...)`);
      fixed++;
    }
  }
  
  console.log('');
  console.log('📊 Summary:');
  console.log(`  ✅ Fixed: ${fixed}`);
  console.log(`  ⏭️  Skipped: ${skipped}`);
  console.log(`  ❌ Errors: ${errors}`);
}

fixUnknownVehicles().catch(console.error);

