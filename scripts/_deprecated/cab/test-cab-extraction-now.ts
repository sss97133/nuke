/**
 * Test C&B extraction on a real URL - trace what happens
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function main() {
  // Use one of the URLs we know has no data
  const testUrl = 'https://carsandbids.com/auctions/3vn76ggj/2013-bmw-x5-xdrive50i';

  console.log('=== TESTING C&B EXTRACTION ===\n');
  console.log('URL:', testUrl);
  console.log('');

  // First check what we have before
  console.log('--- BEFORE EXTRACTION ---');
  const { data: beforeVehicle } = await supabase
    .from('vehicles')
    .select('id, vin, mileage, description, color, engine_type, transmission')
    .ilike('discovery_url', '%3vn76ggj%')
    .single();

  if (beforeVehicle) {
    console.log('Vehicle ID:', beforeVehicle.id);
    console.log('VIN:', beforeVehicle.vin || 'MISSING');
    console.log('Mileage:', beforeVehicle.mileage || 'MISSING');
    console.log('Description:', beforeVehicle.description ? 'Present' : 'MISSING');
    console.log('Color:', beforeVehicle.color || 'MISSING');
    console.log('Engine:', beforeVehicle.engine_type || 'MISSING');
    console.log('Transmission:', beforeVehicle.transmission || 'MISSING');
  } else {
    console.log('No vehicle found');
  }

  // Call the extraction function
  console.log('\n--- CALLING EXTRACTION FUNCTION ---\n');

  const functionUrl = `${SUPABASE_URL}/functions/v1/extract-cars-and-bids-core`;
  console.log('Function URL:', functionUrl);

  try {
    const startTime = Date.now();
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: testUrl,
        vehicle_id: beforeVehicle?.id,
      }),
    });

    const elapsed = Date.now() - startTime;
    console.log(`Response status: ${response.status} (${elapsed}ms)`);

    const result = await response.json();
    console.log('\nFunction response:');
    console.log(JSON.stringify(result, null, 2));

    if (result.success) {
      console.log('\n--- AFTER EXTRACTION ---');

      // Check what we have now
      const vehicleId = result.vehicle_id || beforeVehicle?.id;
      if (vehicleId) {
        const { data: afterVehicle } = await supabase
          .from('vehicles')
          .select('id, vin, mileage, description, color, engine_type, transmission')
          .eq('id', vehicleId)
          .single();

        if (afterVehicle) {
          console.log('VIN:', afterVehicle.vin || 'STILL MISSING');
          console.log('Mileage:', afterVehicle.mileage || 'STILL MISSING');
          console.log('Description:', afterVehicle.description ? `Present (${afterVehicle.description.length} chars)` : 'STILL MISSING');
          console.log('Color:', afterVehicle.color || 'STILL MISSING');
          console.log('Engine:', afterVehicle.engine_type || 'STILL MISSING');
          console.log('Transmission:', afterVehicle.transmission || 'STILL MISSING');
        }

        // Check images
        const { count: imgCount } = await supabase
          .from('vehicle_images')
          .select('*', { count: 'exact', head: true })
          .eq('vehicle_id', vehicleId);
        console.log('Images:', imgCount || 0);

        // Check external listing
        const { data: listing } = await supabase
          .from('external_listings')
          .select('id, current_bid, metadata')
          .eq('vehicle_id', vehicleId)
          .maybeSingle();

        if (listing) {
          console.log('External listing: Present');
          console.log('Metadata keys:', Object.keys(listing.metadata || {}).join(', ') || 'NONE');
        } else {
          console.log('External listing: STILL MISSING');
        }
      }
    }

  } catch (error: any) {
    console.log('Error calling function:', error.message);
  }
}

main();
