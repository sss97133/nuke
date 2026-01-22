import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('=== C&B Queue Status ===\n');

  // Count by status
  const { count: pending } = await supabase.from('import_queue').select('*', { count: 'exact', head: true }).like('listing_url', '%carsandbids.com%').eq('status', 'pending');
  const { count: complete } = await supabase.from('import_queue').select('*', { count: 'exact', head: true }).like('listing_url', '%carsandbids.com%').eq('status', 'complete');
  const { count: failed } = await supabase.from('import_queue').select('*', { count: 'exact', head: true }).like('listing_url', '%carsandbids.com%').eq('status', 'failed');

  console.log('C&B Queue counts:');
  console.log('  Pending:', pending);
  console.log('  Complete:', complete);
  console.log('  Failed:', failed);

  // Check completed vehicles for VIN/mileage
  const { data: completedItems } = await supabase
    .from('import_queue')
    .select('listing_url')
    .like('listing_url', '%carsandbids.com%')
    .eq('status', 'complete')
    .limit(10);

  if (completedItems?.length) {
    console.log('\n=== Checking completed C&B vehicles for VIN/mileage ===\n');

    for (const item of completedItems) {
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('year, make, model, vin, mileage')
        .eq('discovery_url', item.listing_url)
        .single();

      if (vehicle) {
        const vin = vehicle.vin || 'MISSING';
        const miles = vehicle.mileage || 'MISSING';
        console.log(vehicle.year + ' ' + vehicle.make + ' ' + vehicle.model);
        console.log('  VIN:', vin);
        console.log('  Mileage:', miles);
      } else {
        console.log('No vehicle found for:', item.listing_url);
      }
    }
  }

  // Check failed items error messages
  console.log('\n=== Failed C&B items ===\n');
  const { data: failedItems } = await supabase
    .from('import_queue')
    .select('listing_url, error_message')
    .like('listing_url', '%carsandbids.com%')
    .eq('status', 'failed')
    .limit(5);

  for (const item of failedItems || []) {
    console.log('URL:', item.listing_url);
    console.log('Error:', item.error_message || 'No error message');
    console.log('');
  }
}

main().catch(console.error);
