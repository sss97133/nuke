#!/usr/bin/env node
/**
 * Fix remaining "Unknown" make/model vehicles by:
 * 1. Try to extract from URL first
 * 2. If extraction fails, try to extract from title/description
 * 3. If still fails, mark for manual review (don't delete - might have other valuable data)
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
        make = multiWordMakes[firstPart];
        model = parts.slice(2)
          .filter(p => !/^\d+$/.test(p))
          .map(titleCase)
          .join(' ')
          .trim() || null;
      } else {
        make = titleCase(parts[0]);
        model = parts.slice(1)
          .filter(p => !/^\d+$/.test(p))
          .map(titleCase)
          .join(' ')
          .trim() || null;
      }
    } else {
      make = titleCase(parts[0]);
      model = parts.slice(1)
        .filter(p => !/^\d+$/.test(p))
        .map(titleCase)
        .join(' ')
        .trim() || null;
    }
    
    if (model) {
      model = model.replace(/\s+\d+$/, '').trim();
    }
    
    return { year, make, model };
  } catch (e) {
    return null;
  }
}

function extractFromTitle(title) {
  if (!title || typeof title !== 'string') return null;
  
  // Try to extract year/make/model from title (e.g., "1965 Chevrolet Corvette")
  const yearMatch = title.match(/\b(19|20)\d{2}\b/);
  if (!yearMatch) return null;
  
  const year = parseInt(yearMatch[0], 10);
  const afterYear = title.substring(title.indexOf(yearMatch[0]) + 4).trim();
  const parts = afterYear.split(/\s+/);
  
  if (parts.length < 2) return null;
  
  let make = titleCase(parts[0]);
  let model = parts.slice(1).join(' ').trim();
  
  // Handle multi-word makes
  if (parts[0].toLowerCase() === 'mercedes' && parts[1]?.toLowerCase() === 'benz') {
    make = 'Mercedes-Benz';
    model = parts.slice(2).join(' ').trim();
  } else if (parts[0].toLowerCase() === 'alfa' && parts[1]?.toLowerCase() === 'romeo') {
    make = 'Alfa Romeo';
    model = parts.slice(2).join(' ').trim();
  }
  
  return { year, make, model };
}

async function fixUnknownVehicles() {
  console.log('🔍 Finding vehicles with "Unknown" make/model...');
  
  const { data: vehicles, error: fetchError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, bat_auction_url, title, description')
    .or('make.eq.Unknown,model.eq.Unknown');
  
  if (fetchError) {
    console.error('❌ Error fetching vehicles:', fetchError);
    return;
  }
  
  console.log(`✅ Found ${vehicles?.length || 0} vehicles to fix`);
  
  let fixed = 0;
  let needsManualReview = 0;
  let errors = 0;
  
  for (const vehicle of vehicles || []) {
    const url = vehicle.discovery_url || vehicle.bat_auction_url;
    
    // Try URL extraction first
    let parsed = url ? parseBatUrl(url) : null;
    
    // If URL extraction failed, try title extraction
    if ((!parsed || !parsed.make || !parsed.model) && vehicle.title) {
      parsed = extractFromTitle(vehicle.title);
    }
    
    // If still no data, try description
    if ((!parsed || !parsed.make || !parsed.model) && vehicle.description) {
      parsed = extractFromTitle(vehicle.description.substring(0, 200));
    }
    
    if (!parsed || !parsed.make) {
      console.log(`⚠️  Cannot extract make/model for vehicle ${vehicle.id.slice(0, 8)}... - needs manual review`);
      needsManualReview++;
      continue;
    }
    
    const updates = {
      year: parsed.year || vehicle.year,
      make: parsed.make,
      model: parsed.model || vehicle.model, // model can be null if not found
    };
    
    // If model is still "Unknown" but we have a make, set model to null
    if (updates.model === 'Unknown') {
      updates.model = null;
    }
    
    const { error: updateError } = await supabase
      .from('vehicles')
      .update(updates)
      .eq('id', vehicle.id);
    
    if (updateError) {
      console.error(`❌ Error updating vehicle ${vehicle.id}:`, updateError);
      errors++;
    } else {
      console.log(`✅ Fixed: ${updates.year || '?'} ${updates.make} ${updates.model || '?'} (${vehicle.id.slice(0, 8)}...)`);
      fixed++;
    }
  }
  
  console.log('');
  console.log('📊 Summary:');
  console.log(`  ✅ Fixed: ${fixed}`);
  console.log(`  ⚠️  Needs manual review: ${needsManualReview}`);
  console.log(`  ❌ Errors: ${errors}`);
  
  if (needsManualReview > 0) {
    console.log('');
    console.log('ℹ️  Note: Vehicles that couldn\'t be fixed need manual review.');
    console.log('   They may have valuable data (images, price, etc.) even without make/model.');
    console.log('   Consider extracting from external_listings or marking for deletion.');
  }
}

fixUnknownVehicles().catch(console.error);

