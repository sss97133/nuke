#!/usr/bin/env node

/**
 * Import all 55 BaT listings for Viva Las Vegas Autos
 * Automatically creates/updates vehicle profiles with BaT-verified data
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const VIVA_ORG_ID = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf';

// All 55 BaT listings for Viva Las Vegas Autos
// Extracted from https://bringatrailer.com/member/vivalasvegasautos/
const batListings = [
  'https://bringatrailer.com/listing/1987-gmc-suburban-13/',
  'https://bringatrailer.com/listing/1993-chevrolet-corvette-zr-1-7/',
  'https://bringatrailer.com/listing/1978-chevrolet-k20-scottsdale/',
  'https://bringatrailer.com/listing/2006-hummer-h1-alpha-open-top/',
  'https://bringatrailer.com/listing/1972-chevrolet-k10-pickup-6/',
  'https://bringatrailer.com/listing/1997-hummer-h1-wagon-8/',
  'https://bringatrailer.com/listing/1987-mercedes-benz-560sl-22/',
  'https://bringatrailer.com/listing/1969-chevrolet-c10-pickup-47/',
  'https://bringatrailer.com/listing/1989-mercedes-benz-560sl-35/',
  'https://bringatrailer.com/listing/2000-hummer-h1-wagon-6/',
  'https://bringatrailer.com/listing/1966-chevrolet-c10-pickup-45/',
  'https://bringatrailer.com/listing/1972-chevrolet-k5-blazer-17/',
  'https://bringatrailer.com/listing/2006-hummer-h1-alpha-wagon-7/',
  'https://bringatrailer.com/listing/1978-chevrolet-k10-scottsdale-2/',
  'https://bringatrailer.com/listing/1984-chevrolet-k10-silverado-4/',
  'https://bringatrailer.com/listing/1986-nissan-300zx-turbo-5-speed-3/',
  'https://bringatrailer.com/listing/1993-am-general-hmmwv-m998/',
  'https://bringatrailer.com/listing/1986-chevrolet-k10-silverado-10/',
  'https://bringatrailer.com/listing/1972-chevrolet-c10-cheyenne-super-pickup/',
  'https://bringatrailer.com/listing/1987-chevrolet-r10-silverado/',
  'https://bringatrailer.com/listing/1979-chevrolet-k5-blazer-cheyenne-4/',
  'https://bringatrailer.com/listing/1968-chevrolet-c10-pickup-39/',
  'https://bringatrailer.com/listing/1969-chevrolet-camaro-z28-5/',
  'https://bringatrailer.com/listing/1966-chevrolet-c10-pickup-43/',
  'https://bringatrailer.com/listing/1979-chevrolet-k5-blazer-cheyenne-3/',
  'https://bringatrailer.com/listing/1972-chevrolet-k5-blazer-16/',
  'https://bringatrailer.com/listing/1989-chevrolet-k5-blazer-silverado-4x4/',
  'https://bringatrailer.com/listing/1969-chevrolet-camaro-ss-16/',
  'https://bringatrailer.com/listing/1977-chevrolet-k10-4x4/',
  'https://bringatrailer.com/listing/1987-chevrolet-r10-silverado-2/',
  'https://bringatrailer.com/listing/1969-chevrolet-camaro-z28-4/',
  'https://bringatrailer.com/listing/1972-chevrolet-k5-blazer-cst/',
  'https://bringatrailer.com/listing/1978-chevrolet-c10-silverado-big-10-2/',
  'https://bringatrailer.com/listing/1967-chevrolet-camaro-rs-ss-3/',
  'https://bringatrailer.com/listing/1969-chevrolet-camaro-z28-3/',
  'https://bringatrailer.com/listing/1985-chevrolet-k10-silverado-4x4/',
  'https://bringatrailer.com/listing/1968-chevrolet-camaro-ss-15/',
  'https://bringatrailer.com/listing/1969-chevrolet-camaro-z28-2/',
  'https://bringatrailer.com/listing/1978-chevrolet-k10-scottsdale/',
  'https://bringatrailer.com/listing/1985-chevrolet-k5-blazer-silverado-4x4-2/',
  'https://bringatrailer.com/listing/1972-chevrolet-c10-cheyenne-pickup-3/',
  'https://bringatrailer.com/listing/1969-chevrolet-camaro-ss-15/',
  'https://bringatrailer.com/listing/1967-chevrolet-camaro-ss-11/',
  'https://bringatrailer.com/listing/1972-chevrolet-k5-blazer-cst-2/',
  'https://bringatrailer.com/listing/1984-chevrolet-k10-silverado-3/',
  'https://bringatrailer.com/listing/1986-chevrolet-k10-silverado-9/',
  'https://bringatrailer.com/listing/1967-chevrolet-camaro-rs-ss-2/',
  'https://bringatrailer.com/listing/1979-chevrolet-k5-blazer-cheyenne-2/',
  'https://bringatrailer.com/listing/1985-chevrolet-k5-blazer-silverado/',
  'https://bringatrailer.com/listing/1972-chevrolet-c10-cheyenne-super/',
  'https://bringatrailer.com/listing/1968-chevrolet-c10-pickup-38/',
  'https://bringatrailer.com/listing/1969-chevrolet-camaro-z28/',
  'https://bringatrailer.com/listing/1978-chevrolet-k10-big-10/',
  'https://bringatrailer.com/listing/1986-chevrolet-k10-silverado-8/',
  'https://bringatrailer.com/listing/1967-chevrolet-camaro-ss-10/'
];

async function importBaTListing(url) {
  try {
    console.log(`\nImporting: ${url}`);
    
    const { data, error } = await supabase.functions.invoke('import-bat-listing', {
      body: {
        batUrl: url,
        organizationId: VIVA_ORG_ID
      }
    });

    if (error) {
      console.error(`❌ Error: ${error.message}`);
      return { success: false, url, error: error.message };
    }

    if (data.success) {
      console.log(`✅ ${data.action === 'updated' ? 'Updated' : 'Created'} vehicle: ${data.listing.year} ${data.listing.make} ${data.listing.model}`);
      console.log(`   Sale Price: $${data.listing.salePrice.toLocaleString()}`);
      console.log(`   Sale Date: ${data.listing.saleDate}`);
      console.log(`   Vehicle ID: ${data.vehicleId}`);
      return { success: true, url, vehicleId: data.vehicleId, listing: data.listing };
    }

    return { success: false, url, error: 'Unknown error' };
  } catch (error) {
    console.error(`❌ Exception: ${error.message}`);
    return { success: false, url, error: error.message };
  }
}

async function importAllListings() {
  console.log(`🚀 Starting import of ${batListings.length} BaT listings for Viva Las Vegas Autos\n`);
  
  const results = [];
  let successCount = 0;
  let errorCount = 0;

  for (const url of batListings) {
    const result = await importBaTListing(url);
    results.push(result);
    
    if (result.success) {
      successCount++;
    } else {
      errorCount++;
    }

    // Rate limit: wait 2 seconds between requests to be nice to BaT
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(`\n\n📊 IMPORT SUMMARY`);
  console.log(`════════════════════════════════════════`);
  console.log(`✅ Successful: ${successCount}/${batListings.length}`);
  console.log(`❌ Failed: ${errorCount}/${batListings.length}`);
  
  if (errorCount > 0) {
    console.log(`\n❌ FAILED IMPORTS:`);
    results.filter(r => !r.success).forEach(r => {
      console.log(`   ${r.url}`);
      console.log(`   Error: ${r.error}\n`);
    });
  }

  console.log(`\n✨ Import complete! Check https://n-zero.dev/org/${VIVA_ORG_ID}`);
}

importAllListings().catch(console.error);

