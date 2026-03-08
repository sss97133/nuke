/**
 * SCRAPE ALL VIVA BaT LISTINGS
 * Scrapes https://bringatrailer.com/member/vivalasvegasautos/
 * Creates/updates vehicle profiles for all 55+ listings
 */

import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '../.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_KEY');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

const VIVA_ORG_ID = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf';
const VIVA_USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4'; // Skylar
const BAT_MEMBER_URL = 'https://bringatrailer.com/member/vivalasvegasautos/';

console.log('🔍 SCRAPING ALL VIVA BaT LISTINGS...\n');

async function scrapeBATMemberPage() {
  console.log(`📡 Fetching BaT member page: ${BAT_MEMBER_URL}`);

  const response = await fetch(BAT_MEMBER_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status}`);
  }

  const html = await response.text();

  // Extract all listing URLs
  // BaT member pages have links like: /listing/1972-chevrolet-k10-pickup-6/
  const listingPattern = /href="(\/listing\/[^"]+)"/gi;
  const matches = [...html.matchAll(listingPattern)];
  const listingPaths = [...new Set(matches.map(m => m[1]))];

  console.log(`✅ Found ${listingPaths.length} listings\n`);

  return listingPaths.map(path => `https://bringatrailer.com${path}`);
}

async function importBATListing(url) {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/import-bat-listing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`
      },
      body: JSON.stringify({ 
        listing_url: url,
        organization_id: VIVA_ORG_ID,
        user_id: VIVA_USER_ID
      })
    });

    const result = await response.json();
    
    if (result.error) {
      throw new Error(result.error);
    }

    return result;
  } catch (error) {
    console.error(`Error importing ${url}:`, error.message);
    return null;
  }
}

// Removed - using edge function for all processing

// Main execution
const listingURLs = await scrapeBATMemberPage();

let created = 0;
let updated = 0;
let errors = 0;

console.log(`🔄 Processing ${listingURLs.length} listings...\n`);

for (let i = 0; i < listingURLs.length; i++) {
  const url = listingURLs[i];
  const progress = `[${i + 1}/${listingURLs.length}]`;

  process.stdout.write(`${progress} ${url.split('/').pop()}... `);

  try {
    // Import listing via edge function
    const result = await importBATListing(url);

    if (!result) {
      console.log('❌ import failed');
      errors++;
      continue;
    }

    if (result.created) {
      created++;
      console.log(`✅ CREATED (${result.vehicle_id})`);
    } else if (result.updated) {
      updated++;
      console.log(`✅ UPDATED (${result.vehicle_id})`);
    } else {
      console.log(`⚠️  SKIPPED (${result.message})`);
    }

    // Rate limit: 3 seconds between listings
    await new Promise(resolve => setTimeout(resolve, 3000));

  } catch (error) {
    console.log(`❌ ${error.message}`);
    errors++;
  }
}

console.log(`\n\n🎯 FINAL RESULTS:`);
console.log(`─────────────────────────────────────`);
console.log(`Total listings processed: ${listingURLs.length}`);
console.log(`Vehicles created: ${created}`);
console.log(`Vehicles updated: ${updated}`);
console.log(`Errors: ${errors}`);
console.log(`\n✅ All Viva BaT listings imported!`);

