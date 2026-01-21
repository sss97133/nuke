import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function countUniqueVehicles() {
  console.log('=== COUNTING UNIQUE VEHICLES WITH COMMENTS ===\n');

  // Paginate through all comments to get unique vehicle_ids
  const vehicleIds = new Set<string>();
  let offset = 0;
  const pageSize = 10000;
  let hasMore = true;

  while (hasMore) {
    const { data } = await supabase
      .from('auction_comments')
      .select('vehicle_id')
      .not('vehicle_id', 'is', null)
      .range(offset, offset + pageSize - 1);

    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      for (const c of data) {
        if (c.vehicle_id) vehicleIds.add(c.vehicle_id);
      }
      offset += pageSize;
      process.stdout.write(`\rScanned ${offset.toLocaleString()} comments, found ${vehicleIds.size} unique vehicles...`);
    }
  }

  console.log(`\n\nTotal unique vehicles with comments: ${vehicleIds.size}`);

  // Now count comments per vehicle (top 30)
  const vehicleCounts: Record<string, number> = {};
  offset = 0;
  hasMore = true;

  while (hasMore) {
    const { data } = await supabase
      .from('auction_comments')
      .select('vehicle_id')
      .not('vehicle_id', 'is', null)
      .range(offset, offset + pageSize - 1);

    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      for (const c of data) {
        if (c.vehicle_id) {
          vehicleCounts[c.vehicle_id] = (vehicleCounts[c.vehicle_id] || 0) + 1;
        }
      }
      offset += pageSize;
    }
  }

  const sorted = Object.entries(vehicleCounts).sort((a, b) => b[1] - a[1]);

  console.log('\n=== TOP 30 VEHICLES BY COMMENT COUNT ===\n');

  for (const [vehicleId, count] of sorted.slice(0, 30)) {
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('listing_title, sale_price')
      .eq('id', vehicleId)
      .single();

    const salePrice = vehicle?.sale_price ? `$${vehicle.sale_price.toLocaleString()}` : 'N/A';
    console.log(`${count.toString().padStart(4)} comments | ${salePrice.padStart(12)} | ${vehicle?.listing_title?.slice(0, 55) || 'Unknown'}...`);
  }

  // Distribution stats
  const counts = Object.values(vehicleCounts);
  const total = counts.reduce((a, b) => a + b, 0);
  const avg = total / counts.length;
  const max = Math.max(...counts);
  const min = Math.min(...counts);

  console.log(`\n=== STATS ===`);
  console.log(`Total comments: ${total.toLocaleString()}`);
  console.log(`Vehicles with comments: ${counts.length.toLocaleString()}`);
  console.log(`Avg comments/vehicle: ${avg.toFixed(1)}`);
  console.log(`Max comments: ${max}`);
  console.log(`Min comments: ${min}`);

  // Histogram
  const buckets = [1, 5, 10, 25, 50, 100, 200, 500, 1000];
  console.log('\nComment distribution:');
  let prev = 0;
  for (const b of buckets) {
    const inBucket = counts.filter(c => c > prev && c <= b).length;
    console.log(`  ${prev + 1}-${b} comments: ${inBucket} vehicles`);
    prev = b;
  }
  const over1000 = counts.filter(c => c > 1000).length;
  console.log(`  1000+ comments: ${over1000} vehicles`);
}

countUniqueVehicles().catch(console.error);
