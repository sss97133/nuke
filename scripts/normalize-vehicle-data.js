#!/usr/bin/env node
/**
 * Vehicle Data Normalization Script
 * 
 * Fixes:
 * 1. Make names (case, abbreviations)
 * 2. Model names (locations, generic names)
 * 3. Garbage mileage (auction stats parsed as miles)
 * 4. Garbage prices (view counts parsed as prices)
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from frontend directory
config({ path: join(__dirname, '../nuke_frontend/.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Stats tracking
const stats = {
  makesFixed: 0,
  modelsFixed: 0,
  mileageNullified: 0,
  pricesNullified: 0,
  errors: 0,
};

async function normalizeMakes() {
  console.log('\n📛 NORMALIZING MAKE NAMES...\n');
  
  // Get all vehicles with their normalized makes
  const { data: vehicles, error } = await supabase
    .rpc('get_vehicles_needing_make_fix');
  
  if (error) {
    // Fallback - query directly
    const { data: allVehicles, error: err2 } = await supabase
      .from('vehicles')
      .select('id, make, year');
    
    if (err2) {
      console.error('Error fetching vehicles:', err2);
      return;
    }
    
    // Process each vehicle
    for (const v of allVehicles) {
      if (!v.make) continue;
      
      const normalized = normalizeLocalMake(v.make);
      if (normalized !== v.make) {
        console.log(`  ${v.make} → ${normalized}`);
        
        const { error: updateErr } = await supabase
          .from('vehicles')
          .update({ make: normalized })
          .eq('id', v.id);
        
        if (updateErr) {
          console.error(`  ERROR updating ${v.id}:`, updateErr.message);
          stats.errors++;
        } else {
          stats.makesFixed++;
        }
      }
    }
  }
}

async function normalizeModels() {
  console.log('\n🚗 NORMALIZING MODEL NAMES...\n');
  
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, make, model, year');
  
  if (error) {
    console.error('Error fetching vehicles:', error);
    return;
  }
  
  for (const v of vehicles) {
    if (!v.model || !v.make) continue;
    
    const normalized = normalizeLocalModel(v.make, v.model, v.year);
    if (normalized !== v.model) {
      console.log(`  ${v.year || '????'} ${v.make} "${v.model}" → "${normalized}"`);
      
      const { error: updateErr } = await supabase
        .from('vehicles')
        .update({ model: normalized })
        .eq('id', v.id);
      
      if (updateErr) {
        console.error(`  ERROR updating ${v.id}:`, updateErr.message);
        stats.errors++;
      } else {
        stats.modelsFixed++;
      }
    }
  }
}

async function fixGarbageMileage() {
  console.log('\n🔢 FIXING GARBAGE MILEAGE DATA...\n');
  
  // Find vehicles with suspicious mileage (likely auction view/bid counts)
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, mileage')
    .gt('mileage', 500000);
  
  if (error) {
    console.error('Error fetching vehicles:', error);
    return;
  }
  
  console.log(`Found ${vehicles.length} vehicles with mileage > 500,000`);
  
  for (const v of vehicles) {
    console.log(`  ${v.year || '????'} ${v.make} ${v.model}: ${v.mileage?.toLocaleString()} miles → NULL`);
    
    const { error: updateErr } = await supabase
      .from('vehicles')
      .update({ mileage: null })
      .eq('id', v.id);
    
    if (updateErr) {
      console.error(`  ERROR:`, updateErr.message);
      stats.errors++;
    } else {
      stats.mileageNullified++;
    }
  }
}

async function fixGarbagePrices() {
  console.log('\n💰 FIXING GARBAGE PRICE DATA...\n');
  
  // Find vehicles with prices that look like view counts (100000-999999 range with pattern)
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, sale_price, current_value')
    .or('sale_price.gt.100000,current_value.gt.100000');
  
  if (error) {
    console.error('Error fetching vehicles:', error);
    return;
  }
  
  // Filter to those that look like view counts
  const suspicious = vehicles.filter(v => {
    const price = v.sale_price || v.current_value;
    // View counts typically 6+ digits, often round-ish numbers
    return price > 100000 && price < 1000000;
  });
  
  console.log(`Found ${suspicious.length} vehicles with suspicious prices (100K-1M range)`);
  
  for (const v of suspicious) {
    const price = v.sale_price || v.current_value;
    console.log(`  ${v.year || '????'} ${v.make} ${v.model}: $${price?.toLocaleString()} → NULL (likely view count)`);
    
    const updates = {};
    if (v.sale_price > 100000 && v.sale_price < 1000000) updates.sale_price = null;
    if (v.current_value > 100000 && v.current_value < 1000000) updates.current_value = null;
    
    const { error: updateErr } = await supabase
      .from('vehicles')
      .update(updates)
      .eq('id', v.id);
    
    if (updateErr) {
      console.error(`  ERROR:`, updateErr.message);
      stats.errors++;
    } else {
      stats.pricesNullified++;
    }
  }
}

// Local normalization functions (mirrors SQL functions)
function normalizeLocalMake(make) {
  if (!make) return make;
  
  const aliases = {
    'CHEVROLET': ['chevrolet', 'chevy', 'chev', 'CHEVROLET', 'CHEVY', 'CHEV', 'Chevrolet', 'Chevy', 'Chev'],
    'GMC': ['gmc', 'GMC', 'Gmc', 'G.M.C.'],
    'FORD': ['ford', 'FORD', 'Ford'],
    'DODGE': ['dodge', 'DODGE', 'Dodge'],
    'JEEP': ['jeep', 'JEEP', 'Jeep'],
    'TOYOTA': ['toyota', 'TOYOTA', 'Toyota'],
    'MERCEDES-BENZ': ['mercedes-benz', 'mercedes', 'MERCEDES-BENZ', 'MERCEDES', 'Mercedes-Benz', 'Mercedes', 'MB'],
    'PORSCHE': ['porsche', 'PORSCHE', 'Porsche'],
    'BMW': ['bmw', 'BMW', 'Bmw'],
    'VOLKSWAGEN': ['volkswagen', 'vw', 'VW', 'Volkswagen', 'Vw'],
    'JAGUAR': ['jaguar', 'JAGUAR', 'Jaguar'],
    'LAND ROVER': ['land rover', 'LAND ROVER', 'Land Rover', 'landrover', 'Land'],
    'NISSAN': ['nissan', 'NISSAN', 'Nissan', 'datsun', 'Datsun'],
    'SUBARU': ['subaru', 'SUBARU', 'Subaru'],
    'HONDA': ['honda', 'HONDA', 'Honda'],
    'INTERNATIONAL': ['international', 'INTERNATIONAL', 'International', 'IH'],
    'CADILLAC': ['cadillac', 'CADILLAC', 'Cadillac'],
    'BUICK': ['buick', 'BUICK', 'Buick'],
    'OLDSMOBILE': ['oldsmobile', 'OLDSMOBILE', 'Oldsmobile', 'Olds'],
    'PONTIAC': ['pontiac', 'PONTIAC', 'Pontiac'],
    'PLYMOUTH': ['plymouth', 'PLYMOUTH', 'Plymouth'],
    'CHRYSLER': ['chrysler', 'CHRYSLER', 'Chrysler'],
  };
  
  // Check aliases
  for (const [canonical, aliasList] of Object.entries(aliases)) {
    if (aliasList.includes(make) || aliasList.map(a => a.toLowerCase()).includes(make.toLowerCase())) {
      return canonical;
    }
  }
  
  // Not found - return with proper case
  return make.charAt(0).toUpperCase() + make.slice(1).toLowerCase();
}

function normalizeLocalModel(make, model, year) {
  if (!model) return model;
  
  // Clean location from model
  let cleaned = model
    .replace(/\s+(in\s+)?[A-Z][a-z]+,?\s*[A-Z]{0,2}\s*$/gi, '')
    .replace(/\s+(Fort Worth|Commerce Twp|Lithia Springs|Minneapolis|Jackson|Michigan|California|Oregon|Illinois|Kansas|Georgia|Texas|Tx|Mi|Ga).*$/gi, '')
    .trim();
  
  // Chevrolet/GMC truck model normalization
  const normalizedMake = normalizeLocalMake(make);
  
  if (normalizedMake === 'CHEVROLET' || normalizedMake === 'GMC') {
    // "Truck" → specific model based on year
    if (cleaned.toLowerCase() === 'truck') {
      if (year && year >= 1988) {
        cleaned = 'C1500'; // Post-1988 naming
      } else {
        cleaned = 'C10'; // Pre-1988 naming
      }
    }
    
    // K5 Blazer variations
    if (/k5\s*blazer|blazer\s*k5/i.test(cleaned)) {
      cleaned = 'K5 Blazer';
    }
    
    // C/K variations
    cleaned = cleaned
      .replace(/c[\/-]?k\s*10/i, 'C10')
      .replace(/c[\/-]?k\s*20/i, 'C20')
      .replace(/c[\/-]?k\s*30/i, 'C30')
      .replace(/c[\/-]?k\s*1500/i, 'C1500')
      .replace(/c[\/-]?k\s*2500/i, 'C2500');
    
    // Remove 4x4 from model (it's drivetrain)
    cleaned = cleaned.replace(/\s*4[x×]4\s*/gi, ' ').trim();
  }
  
  // General cleanup - remove trim from model names (keep base model)
  // Examples: "Corvette L72 427/425 4-Speed" → "Corvette"
  // But be careful not to strip important model variants
  
  return cleaned;
}

async function showSummary() {
  console.log('\n' + '='.repeat(50));
  console.log('NORMALIZATION COMPLETE');
  console.log('='.repeat(50));
  console.log(`  Makes fixed:       ${stats.makesFixed}`);
  console.log(`  Models fixed:      ${stats.modelsFixed}`);
  console.log(`  Mileage nullified: ${stats.mileageNullified}`);
  console.log(`  Prices nullified:  ${stats.pricesNullified}`);
  console.log(`  Errors:            ${stats.errors}`);
  console.log('='.repeat(50) + '\n');
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }
  
  console.log('🔧 VEHICLE DATA NORMALIZATION');
  console.log('='.repeat(50));
  
  // Run normalizations
  await normalizeMakes();
  await normalizeModels();
  await fixGarbageMileage();
  await fixGarbagePrices();
  
  await showSummary();
  
  // Re-run validation to update issue counts
  console.log('🔄 Re-running validation...');
  const { data, error } = await supabase.rpc('validate_all_vehicles');
  if (error) {
    console.error('Error re-validating:', error);
  } else {
    console.log(`Validation complete: ${data?.[0]?.total_issues || 0} issues remaining\n`);
  }
}

main().catch(console.error);

