import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Get a C&B item from the queue
  const { data: items } = await supabase
    .from('import_queue')
    .select('id, listing_url, status')
    .like('listing_url', '%carsandbids.com%')
    .eq('status', 'pending')
    .limit(1);

  if (!items?.length) {
    console.log('No C&B pending items found in queue');
    // Check if there are any C&B items at all
    const { data: allCab } = await supabase
      .from('import_queue')
      .select('id, listing_url, status')
      .like('listing_url', '%carsandbids.com%')
      .limit(5);
    console.log('All C&B items:', allCab);
    return;
  }

  console.log('Testing C&B item:', items[0].listing_url);

  // Call process-import-queue directly
  const { data, error } = await supabase.functions.invoke('process-import-queue', {
    body: { batch_size: 1, queue_ids: [items[0].id] }
  });

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('Result:', JSON.stringify(data, null, 2));

  // Check what was stored
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, mileage')
    .eq('discovery_url', items[0].listing_url)
    .single();

  if (vehicle) {
    console.log('\nVehicle stored:');
    console.log('  VIN:', vehicle.vin || 'MISSING');
    console.log('  Mileage:', vehicle.mileage || 'MISSING');
  }
}

main().catch(console.error);
