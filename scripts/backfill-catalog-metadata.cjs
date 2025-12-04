#!/usr/bin/env node
/**
 * BACKFILL CATALOG METADATA
 * Updates existing catalog parts with category, year ranges, and model compatibility
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;


if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Category detection patterns
const CATEGORY_PATTERNS = {
  'Interior': ['interior', 'dash', 'seat', 'door panel', 'carpet', 'headliner', 'console', 'steering', 'instrument'],
  'Exterior': ['exterior', 'bumper', 'grille', 'fender', 'hood', 'door', 'bed', 'tailgate', 'trim', 'mirror', 'chrome'],
  'Engine': ['engine', 'motor', 'cylinder', 'carburetor', 'fuel pump', 'water pump', 'alternator', 'belt', 'hose'],
  'Drivetrain': ['transmission', 'transfer case', 'axle', 'driveshaft', 'differential', 'clutch'],
  'Suspension': ['suspension', 'spring', 'shock', 'control arm', 'ball joint', 'tie rod', 'bushing'],
  'Brakes': ['brake', 'rotor', 'caliper', 'master cylinder', 'brake line', 'drum'],
  'Electrical': ['electrical', 'wiring', 'switch', 'gauge', 'light', 'battery', 'ignition', 'headlight', 'taillight'],
  'Cooling': ['cooling', 'radiator', 'fan', 'thermostat', 'coolant'],
  'Exhaust': ['exhaust', 'muffler', 'pipe', 'catalytic', 'header'],
  'Body': ['body', 'panel', 'weatherstrip', 'seal', 'molding', 'gasket'],
  'Hardware': ['bolt', 'nut', 'screw', 'bracket', 'mount', 'hardware', 'kit', 'fastener'],
  'Apparel': ['shirt', 't-shirt', 'hat', 'jacket', 'sweatshirt', 'apparel', 'clothing'],
  'Decals': ['decal', 'sticker', 'emblem', 'badge', 'stripe', 'nameplate']
};

function detectCategory(name) {
  const lowerName = name.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_PATTERNS)) {
    for (const keyword of keywords) {
      if (lowerName.includes(keyword)) {
        return category;
      }
    }
  }
  return 'Other';
}

function extractYearRange(text) {
  // Match patterns like "73-87", "1973-1987"
  const patterns = [
    /(\d{4})-(\d{4})/,  // 1973-1987
    /(\d{2})-(\d{2})/,  // 73-87
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      let start = parseInt(match[1]);
      let end = parseInt(match[2]);
      
      // Convert 2-digit to 4-digit
      if (start < 100) start += 1900;
      if (end < 100) end += 1900;
      
      // Sanity check
      if (start >= 1900 && end >= 1900 && start <= end) {
        return { start, end };
      }
    }
  }
  
  // Default to common squarebody range
  return { start: 1973, end: 1987 };
}

function extractModels(text) {
  const models = [];
  const patterns = ['C10', 'C20', 'C30', 'K10', 'K20', 'K30', 'Blazer', 'Suburban', 'Jimmy'];
  
  const upperText = text.toUpperCase();
  for (const model of patterns) {
    if (upperText.includes(model)) {
      models.push(model);
    }
  }
  
  // Default to common models if none found
  return models.length > 0 ? models : ['C10', 'K10'];
}

async function main() {
  console.log('='.repeat(70));
  console.log('🔄 BACKFILLING CATALOG METADATA');
  console.log('='.repeat(70));

  // Get parts without categories
  console.log('\n📊 Fetching parts to update...');
  const { data: parts, error } = await supabase
    .from('catalog_parts')
    .select('id, part_number, name, application_data')
    .is('category', null)
    .limit(1000); // Process 1000 at a time

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  console.log(`   Found ${parts.length} parts to process\n`);

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    
    if (i % 100 === 0) {
      console.log(`\n📦 Progress: ${i}/${parts.length}`);
    }

    // Detect category from name
    const category = detectCategory(part.name);
    
    // Extract year range from name or application_data
    const textToSearch = `${part.name} ${JSON.stringify(part.application_data || {})}`;
    const yearRange = extractYearRange(textToSearch);
    
    // Extract models
    const models = extractModels(textToSearch);

    // Update the part
    const { error: updateError } = await supabase
      .from('catalog_parts')
      .update({
        category,
        year_start: yearRange.start,
        year_end: yearRange.end,
        fits_models: models
      })
      .eq('id', part.id);

    if (updateError) {
      console.log(`   ❌ Failed: ${part.part_number}`);
      failed++;
    } else {
      updated++;
      if (i % 100 === 0) {
        console.log(`   ✅ ${part.part_number}: ${category}, ${yearRange.start}-${yearRange.end}, ${models.join(', ')}`);
      }
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('📊 BACKFILL COMPLETE');
  console.log('='.repeat(70));
  console.log(`   ✅ Updated: ${updated}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📈 Success rate: ${((updated / parts.length) * 100).toFixed(1)}%`);
  console.log('='.repeat(70));
  
  if (parts.length === 1000) {
    console.log('\n💡 More parts remaining. Run this script again to continue.');
  } else {
    console.log('\n✅ All parts processed!');
  }
}

main().catch(console.error);

