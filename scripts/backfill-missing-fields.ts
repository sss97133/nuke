#!/usr/bin/env npx tsx
/**
 * Universal Backfill Script for Missing Fields
 *
 * Usage:
 *   npx tsx scripts/backfill-missing-fields.ts --source="Craigslist" --field=location --limit=100
 *   npx tsx scripts/backfill-missing-fields.ts --source="Bring a Trailer" --field=vin --limit=50
 *   npx tsx scripts/backfill-missing-fields.ts --source="Cars & Bids" --field=mileage --limit=100
 *   npx tsx scripts/backfill-missing-fields.ts --dry-run  # Preview what would be processed
 *
 * Options:
 *   --source=NAME     Filter by auction_source (e.g., "Craigslist", "Bring a Trailer", "Cars & Bids")
 *   --field=FIELD     Target field: vin, mileage, location, images, make, model, price
 *   --limit=N         Max vehicles to process (default: 100)
 *   --batch=N         Batch size (default: 5)
 *   --delay=MS        Delay between vehicles in ms (default: 2000)
 *   --dry-run         Show what would be processed without making changes
 *   --verbose         Show detailed logs
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

// Parse CLI arguments
function parseArgs() {
  const args: Record<string, string | boolean> = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      args[key] = value ?? true;
    }
  }
  return args;
}

const args = parseArgs();
const SOURCE_FILTER = args.source as string || null;
const FIELD_FILTER = args.field as string || null;
const LIMIT = parseInt(args.limit as string) || 100;
const BATCH_SIZE = parseInt(args.batch as string) || 5;
const DELAY_MS = parseInt(args.delay as string) || 2000;
const DRY_RUN = !!args['dry-run'];
const VERBOSE = !!args.verbose;

// Map sources to their extractor functions
const SOURCE_EXTRACTORS: Record<string, string> = {
  'Bring a Trailer': 'extract-bat-core',
  'bat': 'extract-bat-core',
  'Cars & Bids': 'extract-cars-and-bids-core',
  'Craigslist': 'process-import-queue',
  'Mecum': 'extract-premium-auction',
  'PCarMarket': 'import-pcarmarket-listing',
  'Collecting Cars': 'extract-collecting-cars',
  'Barrett-Jackson': 'extract-premium-auction',
};

// Field to SQL column mapping
const FIELD_COLUMNS: Record<string, string> = {
  vin: 'vin',
  mileage: 'mileage',
  location: 'location',
  make: 'make',
  model: 'model',
  price: 'sale_price',
  description: 'description',
  images: 'id', // Special case - check vehicle_images table
};

interface VehicleToBackfill {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  discovery_url: string | null;
  listing_url: string | null;
  auction_source: string | null;
  [key: string]: any;
}

async function getVehiclesMissingField(field: string, source: string | null, limit: number): Promise<VehicleToBackfill[]> {
  const column = FIELD_COLUMNS[field];
  if (!column) {
    console.error(`❌ Unknown field: ${field}. Valid fields: ${Object.keys(FIELD_COLUMNS).join(', ')}`);
    process.exit(1);
  }

  let query = supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, listing_url, auction_source')
    .eq('listing_kind', 'vehicle');

  // Filter by source if specified
  if (source) {
    query = query.eq('auction_source', source);
  }

  // Filter by missing field (except images - handled separately)
  if (field !== 'images') {
    query = query.is(column, null);
  }

  query = query.limit(limit * 2); // Get extra in case some are filtered

  const { data, error } = await query;

  if (error) {
    console.error('❌ Query error:', error.message);
    return [];
  }

  let vehicles = data || [];

  // For images, check vehicle_images table
  if (field === 'images' && vehicles.length > 0) {
    const vehicleIds = vehicles.map(v => v.id);
    const { data: imageData } = await supabase
      .from('vehicle_images')
      .select('vehicle_id')
      .in('vehicle_id', vehicleIds);

    const vehiclesWithImages = new Set((imageData || []).map(i => i.vehicle_id));
    vehicles = vehicles.filter(v => !vehiclesWithImages.has(v.id));
  }

  return vehicles.slice(0, limit);
}

async function reExtractVehicle(vehicle: VehicleToBackfill): Promise<{ success: boolean; error?: string; updated?: boolean }> {
  const url = vehicle.discovery_url || vehicle.listing_url;
  if (!url) {
    return { success: false, error: 'No URL found' };
  }

  const source = vehicle.auction_source || 'Unknown';
  const extractorFn = SOURCE_EXTRACTORS[source];

  if (!extractorFn) {
    return { success: false, error: `No extractor for source: ${source}` };
  }

  try {
    // For Craigslist, we need to queue through import_queue
    if (source === 'Craigslist') {
      // Update import_queue to re-process
      const { error: queueError } = await supabase
        .from('import_queue')
        .upsert({
          listing_url: url,
          source: 'craigslist',
          status: 'pending',
          vehicle_id: vehicle.id,
        }, {
          onConflict: 'listing_url'
        });

      if (queueError) {
        return { success: false, error: `Queue error: ${queueError.message}` };
      }

      // Trigger processing
      const { error: fnError } = await supabase.functions.invoke('process-import-queue', {
        body: { batch_size: 1 }
      });

      return { success: !fnError, error: fnError?.message, updated: true };
    }

    // For other sources, call extractor directly
    const { data, error } = await supabase.functions.invoke(extractorFn, {
      body: { url, vehicle_id: vehicle.id }
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: data?.success !== false,
      error: data?.error,
      updated: data?.updated || data?.vehicles_updated > 0
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

async function main() {
  console.log('🔄 Universal Backfill Script');
  console.log('='.repeat(60));
  console.log(`Source:    ${SOURCE_FILTER || 'ALL'}`);
  console.log(`Field:     ${FIELD_FILTER || 'ALL missing'}`);
  console.log(`Limit:     ${LIMIT}`);
  console.log(`Batch:     ${BATCH_SIZE}`);
  console.log(`Delay:     ${DELAY_MS}ms`);
  console.log(`Dry Run:   ${DRY_RUN}`);
  console.log('='.repeat(60));

  if (!FIELD_FILTER) {
    console.error('\n❌ Please specify a --field to backfill');
    console.log('   Valid fields:', Object.keys(FIELD_COLUMNS).join(', '));
    process.exit(1);
  }

  // Get vehicles needing backfill
  console.log(`\n🔍 Finding vehicles missing ${FIELD_FILTER}...`);
  const vehicles = await getVehiclesMissingField(FIELD_FILTER, SOURCE_FILTER, LIMIT);

  if (vehicles.length === 0) {
    console.log('✅ No vehicles found needing backfill!');
    return;
  }

  console.log(`   Found ${vehicles.length} vehicles\n`);

  if (DRY_RUN) {
    console.log('📋 DRY RUN - Would process these vehicles:\n');
    for (const v of vehicles.slice(0, 20)) {
      console.log(`   ${v.year || '?'} ${v.make || '?'} ${v.model || '?'} [${v.auction_source}]`);
      if (VERBOSE) {
        console.log(`      URL: ${v.discovery_url || v.listing_url || 'N/A'}`);
      }
    }
    if (vehicles.length > 20) {
      console.log(`   ... and ${vehicles.length - 20} more`);
    }
    return;
  }

  // Process vehicles
  let successCount = 0;
  let failCount = 0;
  const startTime = Date.now();

  for (let i = 0; i < vehicles.length; i += BATCH_SIZE) {
    const batch = vehicles.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(vehicles.length / BATCH_SIZE);

    console.log(`\n📦 Batch ${batchNum}/${totalBatches}`);
    console.log('-'.repeat(60));

    for (const vehicle of batch) {
      const displayName = `${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}`;
      console.log(`\n🔧 ${displayName} [${vehicle.auction_source}]`);

      if (VERBOSE) {
        console.log(`   URL: ${vehicle.discovery_url || vehicle.listing_url || 'N/A'}`);
      }

      const result = await reExtractVehicle(vehicle);

      if (result.success) {
        console.log(`   ✅ Success${result.updated ? ' - Updated' : ''}`);
        successCount++;
      } else {
        console.log(`   ❌ Failed: ${result.error}`);
        failCount++;
      }

      // Delay between vehicles
      if (i + batch.indexOf(vehicle) + 1 < vehicles.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Processed: ${vehicles.length}`);
  console.log(`✅ Successful:   ${successCount}`);
  console.log(`❌ Failed:       ${failCount}`);
  console.log(`⏱️  Time:         ${elapsed} minutes`);
  console.log('='.repeat(60));
}

main().catch(console.error);
