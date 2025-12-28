#!/usr/bin/env node
/**
 * Re-extract a vehicle from its platform URL to get fresh images
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });
dotenv.config({ path: join(__dirname, '../.env.local') });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const vehicleId = process.argv[2] || '69f35ba1-00d3-4b63-8406-731d226c45e1';

async function reExtractVehicle() {
  try {
    console.log(`Re-extracting vehicle: ${vehicleId}\n`);

    // Get vehicle's platform URL
    const vehicleResponse = await fetch(`${SUPABASE_URL}/rest/v1/vehicles?id=eq.${vehicleId}&select=platform_url,discovery_url`, {
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

    const vehicleData = await vehicleResponse.json();
    if (!vehicleData || vehicleData.length === 0) {
      throw new Error('Vehicle not found');
    }

    const listingUrl = vehicleData[0].platform_url || vehicleData[0].discovery_url;
    if (!listingUrl) {
      throw new Error('No platform URL found for vehicle');
    }

    console.log(`Listing URL: ${listingUrl}\n`);
    console.log('Calling extract-premium-auction function...\n');

    // Call the extraction function
    const extractResponse = await fetch(`${SUPABASE_URL}/functions/v1/extract-premium-auction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        url: listingUrl,
        max_vehicles: 1,
        download_images: true, // Enable slow downloads
      }),
    });

    const result = await extractResponse.json();

    if (!extractResponse.ok) {
      throw new Error(result.error || 'Extraction failed');
    }

    console.log('✅ Extraction complete!');
    console.log(`   Vehicles extracted: ${result.extracted || 0}`);
    console.log(`   Images inserted: ${result.images_inserted || 'N/A'}`);
    if (result.issues && result.issues.length > 0) {
      console.log(`\n⚠️  Issues (${result.issues.length}):`);
      result.issues.slice(0, 5).forEach((issue, i) => {
        console.log(`   ${i + 1}. ${issue}`);
      });
    }

    return result;
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

reExtractVehicle();

