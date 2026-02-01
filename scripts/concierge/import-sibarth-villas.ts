#!/usr/bin/env npx tsx
/**
 * Sibarth Villa Importer
 * Imports all villas from Sibarth's JSON API
 *
 * Usage: npx tsx scripts/concierge/import-sibarth-villas.ts [--dry-run]
 */

import { createClient } from '@supabase/supabase-js';

const SIBARTH_API = 'https://sibarth.com/wp-json/villa/list';

interface SibarthVilla {
  id: number;
  post_id: number;
  url: string;
  images: string[];
  name: string;
  tagline: string;
  lat: string;
  lon: string;
  price: string;
  region: string;
  rents_as: string;
  statuses: string[];
  special_offers: any[];
  has_special_offers: number;
  is_for_sale: number;
  sale_price: string;
}

interface SibarthResponse {
  markers: any[];
  villas: SibarthVilla[];
}

function parsePrice(priceStr: string): { low: number | null; high: number | null; currency: string } {
  if (!priceStr) return { low: null, high: null, currency: 'USD' };

  const cleaned = priceStr.replace(/[,\s]/g, '');
  let currency = 'USD';
  if (cleaned.includes('€')) currency = 'EUR';

  const numbers = cleaned.match(/[\d]+/g)?.map(n => parseInt(n)).filter(n => !isNaN(n) && n >= 100) || [];

  if (numbers.length === 0) return { low: null, high: null, currency };
  if (numbers.length === 1) return { low: numbers[0], high: numbers[0], currency };
  return { low: Math.min(...numbers), high: Math.max(...numbers), currency };
}

function parseBedrooms(bedroomStr: string): { min: number | null; max: number | null } {
  if (!bedroomStr) return { min: null, max: null };

  const numbers = bedroomStr.match(/\d+/g)?.map(n => parseInt(n)).filter(n => !isNaN(n) && n < 20) || [];

  if (numbers.length === 0) return { min: null, max: null };
  if (numbers.length === 1) return { min: numbers[0], max: numbers[0] };
  return { min: Math.min(...numbers), max: Math.max(...numbers) };
}

function toBusinessInsert(villa: SibarthVilla) {
  const price = parsePrice(villa.price);
  const bedrooms = parseBedrooms(villa.rents_as);
  const isForSale = villa.is_for_sale === 1;

  return {
    business_name: `Villa ${villa.name}`,
    business_type: 'villa_rental',
    industry_focus: ['tourisme', 'accommodation', 'luxury'],
    services_offered: isForSale ? ['villa-sale', 'real-estate'] : ['villa-rental', 'vacation-rental'],
    website: villa.url,
    city: villa.region || null,
    country: 'BL',
    latitude: villa.lat ? parseFloat(villa.lat) : null,
    longitude: villa.lon ? parseFloat(villa.lon) : null,
    discovered_via: 'sibarth.com',
    source_url: villa.url,
    metadata: {
      project: 'lofficiel-concierge',
      entity_type: 'villa',
      sibarth_id: villa.id,
      villa_name: villa.name,
      tagline: villa.tagline,
      bedrooms_min: bedrooms.min,
      bedrooms_max: bedrooms.max,
      price_low: price.low,
      price_high: price.high,
      price_currency: price.currency,
      price_period: isForSale ? 'sale' : 'week',
      listing_type: isForSale ? 'sale' : 'rental',
      images: villa.images.slice(0, 10),
      has_special_offers: villa.has_special_offers === 1,
      special_offers: villa.special_offers,
      statuses: villa.statuses,
      scraped_at: new Date().toISOString(),
    },
    search_keywords: [
      villa.name.toLowerCase(),
      'villa',
      'sibarth',
      villa.region?.toLowerCase(),
      'st barth',
      'luxury',
      isForSale ? 'for sale' : 'rental',
      villa.tagline?.toLowerCase()?.slice(0, 50),
    ].filter(Boolean) as string[],
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log('Sibarth Villa Importer');
  console.log('======================');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log('');

  // Fetch from API
  console.log('Fetching from Sibarth API...');
  const response = await fetch(SIBARTH_API, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ConciergeBot/1.0)',
      'Accept': 'application/json',
    }
  });

  if (!response.ok) {
    console.error(`API error: ${response.status}`);
    process.exit(1);
  }

  const data: SibarthResponse = await response.json();
  console.log(`Found ${data.villas.length} villas\n`);

  // Stats
  const rentals = data.villas.filter(v => v.is_for_sale !== 1);
  const forSale = data.villas.filter(v => v.is_for_sale === 1);
  const withOffers = data.villas.filter(v => v.has_special_offers === 1);

  console.log('Breakdown:');
  console.log(`  Rentals: ${rentals.length}`);
  console.log(`  For Sale: ${forSale.length}`);
  console.log(`  With Special Offers: ${withOffers.length}`);
  console.log('');

  // Regions
  const regions = new Map<string, number>();
  for (const villa of data.villas) {
    const region = villa.region || 'Unknown';
    regions.set(region, (regions.get(region) || 0) + 1);
  }
  console.log('By Region:');
  const sortedRegions = [...regions.entries()].sort((a, b) => b[1] - a[1]);
  for (const [region, count] of sortedRegions.slice(0, 10)) {
    console.log(`  ${region}: ${count}`);
  }
  console.log('');

  if (dryRun) {
    console.log('Sample villas:');
    for (const villa of data.villas.slice(0, 5)) {
      console.log(`  - ${villa.name} (${villa.region}) - ${villa.price}`);
      if (villa.tagline) console.log(`    "${villa.tagline}"`);
    }
    return;
  }

  // Insert to database
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  let inserted = 0;
  let updated = 0;
  let errors = 0;

  for (const villa of data.villas) {
    const insert = toBusinessInsert(villa);

    // Upsert by checking for existing
    const { data: existing } = await supabase
      .from('businesses')
      .select('id')
      .eq('metadata->>sibarth_id', villa.id.toString())
      .single();

    if (existing) {
      // Update existing
      const { error } = await supabase
        .from('businesses')
        .update(insert)
        .eq('id', existing.id);

      if (error) {
        console.error(`Error updating ${villa.name}: ${error.message}`);
        errors++;
      } else {
        updated++;
      }
    } else {
      // Insert new
      const { error } = await supabase.from('businesses').insert(insert);

      if (error) {
        console.error(`Error inserting ${villa.name}: ${error.message}`);
        errors++;
      } else {
        inserted++;
      }
    }
  }

  console.log('======================');
  console.log(`Inserted: ${inserted}`);
  console.log(`Updated: ${updated}`);
  console.log(`Errors: ${errors}`);
}

main().catch(console.error);
