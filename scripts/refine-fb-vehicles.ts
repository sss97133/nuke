#!/usr/bin/env npx tsx
/**
 * Batch refiner for FB Marketplace vehicles
 * Fixes corrupted titles, missing models, bad prices
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface VehicleToFix {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  asking_price: number | null;
  origin_metadata: any;
}

/**
 * Enhanced title parser
 */
function parseTitle(title: string): {
  year: number | null;
  make: string | null;
  model: string | null;
  cleanPrice: number | null;
} {
  // Extract price
  let cleanPrice: number | null = null;
  const priceMatch = title.match(/^\$?([\d,]+)/);
  if (priceMatch) {
    const priceStr = priceMatch[1].replace(/,/g, '');
    const yearAtEnd = priceStr.match(/((?:19[2-9]\d|20[0-3]\d))$/);
    if (yearAtEnd && priceStr.length > 4) {
      const priceDigits = priceStr.slice(0, -4);
      cleanPrice = priceDigits.length > 0 ? parseInt(priceDigits, 10) : null;
    } else if (priceStr.length <= 7 && !priceStr.match(/^(19|20)\d{2}$/)) {
      cleanPrice = parseInt(priceStr, 10);
    }
  }

  // Clean title
  let cleaned = title
    .replace(/^\$[\d,]+(?=\d{4})/g, '')
    .replace(/^\$[\d,]+\s*/g, '')
    .replace(/[A-Z][a-z]+,\s*[A-Z]{2}.*$/g, '')
    .replace(/\d+K miles.*$/gi, '')
    .trim();

  // Extract year
  const yearMatch = cleaned.match(/\b(19[2-9]\d|20[0-3]\d)\b/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

  if (!year) return { year: null, make: null, model: null, cleanPrice };

  // Extract make and model
  const afterYear = cleaned.split(String(year))[1]?.trim() || '';
  const words = afterYear.split(/\s+/).filter(w => w.length > 0);

  if (words.length === 0) return { year, make: null, model: null, cleanPrice };

  // Make normalization
  const makeMap: Record<string, string> = {
    'chevy': 'Chevrolet', 'chevrolet': 'Chevrolet',
    'ford': 'Ford', 'dodge': 'Dodge', 'gmc': 'GMC',
    'toyota': 'Toyota', 'honda': 'Honda', 'nissan': 'Nissan',
    'mazda': 'Mazda', 'subaru': 'Subaru', 'mitsubishi': 'Mitsubishi',
    'jeep': 'Jeep', 'ram': 'Ram', 'chrysler': 'Chrysler',
    'bmw': 'BMW', 'mercedes': 'Mercedes-Benz', 'volkswagen': 'Volkswagen',
    'vw': 'Volkswagen', 'porsche': 'Porsche', 'audi': 'Audi',
  };

  const rawMake = words[0].toLowerCase();
  const make = makeMap[rawMake] || words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();

  // Extract model
  const stopWords = ['pickup', 'truck', 'sedan', 'coupe', 'wagon', 'van'];
  const modelParts: string[] = [];
  for (let i = 1; i < Math.min(words.length, 5); i++) {
    const word = words[i];
    if (stopWords.includes(word.toLowerCase()) || /^[A-Z][a-z]+$/.test(word)) break;
    modelParts.push(word);
    if (modelParts.length >= 2) break;
  }

  const model = modelParts.length > 0 ? modelParts.join(' ') : null;

  return { year, make, model, cleanPrice };
}

async function refineBatch(batchSize: number = 100): Promise<void> {
  console.log(`\n🔧 Finding FB Marketplace vehicles needing refinement...`);

  // Find vehicles with missing or suspect data
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, asking_price, origin_metadata')
    .eq('profile_origin', 'facebook_marketplace')
    .or('model.is.null,make.is.null')
    .limit(batchSize);

  if (error) {
    console.error('Error fetching vehicles:', error);
    return;
  }

  if (!vehicles || vehicles.length === 0) {
    console.log('✅ No vehicles need refinement!');
    return;
  }

  console.log(`📋 Found ${vehicles.length} vehicles to refine\n`);

  let fixed = 0;
  let skipped = 0;

  for (const vehicle of vehicles) {
    try {
      // Get original title from marketplace_listings
      const { data: listing } = await supabase
        .from('marketplace_listings')
        .select('title, price, facebook_id')
        .eq('vehicle_id', vehicle.id)
        .single();

      if (!listing) {
        skipped++;
        continue;
      }

      // Parse the title
      const parsed = parseTitle(listing.title);

      // Build update object
      const updates: any = {};

      if (parsed.year && !vehicle.year) {
        updates.year = parsed.year;
      }

      if (parsed.make && (!vehicle.make || vehicle.make.length < 3)) {
        updates.make = parsed.make;
      }

      if (parsed.model && (!vehicle.model || vehicle.model.length < 3)) {
        updates.model = parsed.model;
      }

      if (parsed.cleanPrice && parsed.cleanPrice > 100 && parsed.cleanPrice < 1000000) {
        if (!vehicle.asking_price || vehicle.asking_price > 500000) {
          updates.asking_price = parsed.cleanPrice;
        }
      }

      // Update if we have fixes
      if (Object.keys(updates).length > 0) {
        await supabase
          .from('vehicles')
          .update(updates)
          .eq('id', vehicle.id);

        fixed++;
        console.log(`✅ Fixed: ${listing.title.slice(0, 60)}...`);
        console.log(`   Updates: ${JSON.stringify(updates)}`);
      } else {
        skipped++;
      }

    } catch (e: any) {
      console.error(`❌ Error processing vehicle ${vehicle.id}:`, e.message);
      skipped++;
    }

    // Small delay to avoid overwhelming the DB
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`\n📊 Batch complete:`);
  console.log(`   Fixed: ${fixed}`);
  console.log(`   Skipped: ${skipped}`);
}

async function main() {
  const batchSize = parseInt(process.argv[2]) || 100;
  const continuous = process.argv.includes('--continuous');

  if (continuous) {
    console.log('🔄 Running in continuous mode (Ctrl+C to stop)\n');

    while (true) {
      await refineBatch(batchSize);

      // Check if there are more to process
      const { count } = await supabase
        .from('vehicles')
        .select('id', { count: 'exact', head: true })
        .eq('profile_origin', 'facebook_marketplace')
        .or('model.is.null,make.is.null');

      if (!count || count === 0) {
        console.log('\n✅ All vehicles refined!');
        break;
      }

      console.log(`\n⏳ ${count} vehicles remaining. Continuing in 5 seconds...\n`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  } else {
    await refineBatch(batchSize);
  }
}

main().catch(console.error);
