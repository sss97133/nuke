#!/usr/bin/env npx tsx
/**
 * Mecum Price Update
 *
 * Reads exported Mecum sold results and updates matching vehicles in database.
 * Efficient batch processing - queries and updates in batches.
 *
 * Usage:
 *   npx tsx scripts/mecum-price-update.ts /tmp/mecum-sold-results.json
 */

import { readFileSync } from 'fs';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

interface SoldResult {
  url: string;
  hammer_price: number;
  total_price: number;
  lot_number: string;
  auction: string;
  title: string;
}

async function getVehiclesByUrls(urls: string[]): Promise<Map<string, { id: string; sale_price: number | null }>> {
  // PostgREST doesn't support IN queries well with many values, so we do it in smaller batches
  const result = new Map<string, { id: string; sale_price: number | null }>();

  // Use OR query with URL patterns
  for (let i = 0; i < urls.length; i += 50) {
    const batch = urls.slice(i, i + 50);
    const orQuery = batch.map(url => `discovery_url.eq.${encodeURIComponent(url)}`).join(',');

    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/vehicles?or=(${orQuery})&select=id,discovery_url,sale_price`,
        {
          headers: {
            'apikey': SUPABASE_KEY!,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
          },
        }
      );

      if (res.ok) {
        const vehicles = await res.json();
        for (const v of vehicles) {
          result.set(v.discovery_url, { id: v.id, sale_price: v.sale_price });
        }
      }
    } catch (e) {
      // Ignore errors, continue
    }

    // Rate limit
    if (i % 500 === 0 && i > 0) {
      process.stdout.write('.');
    }
  }

  return result;
}

async function updateVehicle(id: string, data: {
  sale_price: number;
  hammer_price: number;
  lot_number: string;
  auction: string;
}): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/vehicles?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY!,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sale_price: data.sale_price,
      sale_status: 'sold',
      origin_metadata: {
        hammer_price: data.hammer_price,
        buyers_premium: data.sale_price - data.hammer_price,
        lot_number: data.lot_number,
        auction: data.auction,
        extracted_from: 'mecum_algolia',
        updated_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    }),
  });

  return res.ok;
}

async function main() {
  const inputFile = process.argv[2] || '/tmp/mecum-sold-results.json';

  console.log('═══════════════════════════════════════════════');
  console.log('  Mecum Price Update');
  console.log(`  Input: ${inputFile}`);
  console.log('═══════════════════════════════════════════════\n');

  // Read input file
  const data = JSON.parse(readFileSync(inputFile, 'utf-8')) as SoldResult[];
  console.log(`Loaded ${data.length.toLocaleString()} sold results\n`);

  // Build URL -> result map
  const resultsByUrl = new Map<string, SoldResult>();
  for (const r of data) {
    resultsByUrl.set(r.url, r);
  }

  // Get unique URLs
  const urls = [...resultsByUrl.keys()];
  console.log(`Unique URLs: ${urls.length.toLocaleString()}`);

  // Query database in batches
  console.log('\nQuerying database for matching vehicles...');
  const vehiclesByUrl = await getVehiclesByUrls(urls);
  console.log(`\nFound ${vehiclesByUrl.size.toLocaleString()} matching vehicles in database`);

  // Filter to vehicles without prices
  const toUpdate: { vehicle: { id: string; sale_price: number | null }; result: SoldResult }[] = [];
  for (const [url, vehicle] of vehiclesByUrl) {
    if (!vehicle.sale_price) {
      const result = resultsByUrl.get(url);
      if (result) {
        toUpdate.push({ vehicle, result });
      }
    }
  }

  console.log(`Vehicles needing price update: ${toUpdate.length.toLocaleString()}\n`);

  if (toUpdate.length === 0) {
    console.log('No vehicles to update!');
    return;
  }

  // Update vehicles
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < toUpdate.length; i++) {
    const { vehicle, result } = toUpdate[i];

    const success = await updateVehicle(vehicle.id, {
      sale_price: result.total_price,
      hammer_price: result.hammer_price,
      lot_number: result.lot_number,
      auction: result.auction,
    });

    if (success) {
      updated++;
      if (updated <= 20) {
        console.log(`  ✓ ${result.title.slice(0, 45).padEnd(45)} $${result.total_price.toLocaleString()}`);
      }
    } else {
      failed++;
    }

    // Progress
    if ((i + 1) % 100 === 0) {
      console.log(`  ... ${i + 1}/${toUpdate.length} processed (${updated} updated)`);
    }

    // Rate limit
    if (i % 10 === 0) {
      await new Promise(r => setTimeout(r, 10));
    }
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('Summary:');
  console.log(`  Total results loaded: ${data.length.toLocaleString()}`);
  console.log(`  Vehicles in database: ${vehiclesByUrl.size.toLocaleString()}`);
  console.log(`  Successfully updated: ${updated.toLocaleString()}`);
  console.log(`  Failed: ${failed}`);
  console.log('═══════════════════════════════════════════════');
}

main().catch(console.error);
