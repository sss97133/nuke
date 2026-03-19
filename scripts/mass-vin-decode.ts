#!/usr/bin/env npx tsx
/**
 * Mass VIN Decoder — Phase 1 of Vehicle Taxonomy Normalization
 *
 * Decodes all 17-char VINs in the vehicles table via NHTSA batch API.
 * NHTSA batch endpoint accepts 50 VINs per request, ~5 req/s.
 * 118K VINs / 50 per batch = 2,360 requests at 5/s = ~8 minutes.
 *
 * Usage:
 *   dotenvx run -- npx tsx scripts/mass-vin-decode.ts
 *   dotenvx run -- npx tsx scripts/mass-vin-decode.ts --dry-run
 *   dotenvx run -- npx tsx scripts/mass-vin-decode.ts --limit 1000
 *   dotenvx run -- npx tsx scripts/mass-vin-decode.ts --offset 5000
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitArg = args.find((_, i) => args[i - 1] === '--limit');
const offsetArg = args.find((_, i) => args[i - 1] === '--offset');
const queryLimit = limitArg ? parseInt(limitArg) : 0;
const queryOffset = offsetArg ? parseInt(offsetArg) : 0;

const NHTSA_BATCH_URL = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVINValuesBatch/';
const VINS_PER_BATCH = 50;
const REQUESTS_PER_SECOND = 5;
const DELAY_MS = Math.ceil(1000 / REQUESTS_PER_SECOND);

// Stats
const stats = {
  totalVins: 0,
  batchesSent: 0,
  decoded: 0,
  errors: 0,
  skipped: 0,
  startTime: Date.now(),
};

const DB_HOST = 'aws-0-us-west-1.pooler.supabase.com';
const DB_PORT = '6543';
const DB_USER = 'postgres.qkgaybvrernstplzjaam';
const DB_PASS = 'RbzKq32A0uhqvJMQ';

async function executeSql(query: string): Promise<string[]> {
  const { execSync } = await import('child_process');
  const env = { ...process.env, PGPASSWORD: DB_PASS };
  // Collapse multiline SQL to single line for psql -c
  const singleLine = query.replace(/\s+/g, ' ').trim();
  try {
    const result = execSync(
      `psql -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -d postgres -t -A -c ${JSON.stringify(singleLine)}`,
      { env, timeout: 120000, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
    );
    return result.trim().split('\n').filter(Boolean);
  } catch (err: any) {
    if (err.stdout) return err.stdout.trim().split('\n').filter(Boolean);
    throw err;
  }
}

async function supabaseUpsert(table: string, rows: any[]): Promise<void> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upsert ${table}: ${res.status} ${text.slice(0, 200)}`);
  }
}

/**
 * Get all VINs that need decoding via direct psql (no PostgREST row limit)
 */
async function getVinsToProcess(): Promise<string[]> {
  const limitClause = queryLimit ? `LIMIT ${queryLimit}` : '';
  const offsetClause = queryOffset ? `OFFSET ${queryOffset}` : '';

  const rows = await executeSql(`
    SELECT DISTINCT upper(v.vin) as vin
    FROM vehicles v
    LEFT JOIN vin_decoded_data vd ON upper(v.vin) = upper(vd.vin)
    WHERE v.deleted_at IS NULL
      AND v.vin IS NOT NULL
      AND length(trim(v.vin)) = 17
      AND vd.vin IS NULL
    ORDER BY vin
    ${limitClause} ${offsetClause}
  `);

  const vins = rows.filter(v => v.length === 17);
  console.log(`  VINs to decode (from psql): ${vins.length}`);
  return vins;
}

function mapDrivetrain(nhtsa: string): string | null {
  if (!nhtsa) return null;
  const lower = nhtsa.toLowerCase();
  if (lower.includes('4x4') || lower.includes('4wd') || lower.includes('four wheel')) return '4WD';
  if (lower.includes('awd') || lower.includes('all wheel')) return 'AWD';
  if (lower.includes('rwd') || lower.includes('rear wheel')) return 'RWD';
  if (lower.includes('fwd') || lower.includes('front wheel')) return 'FWD';
  if (lower.includes('2wd') || lower.includes('two wheel')) return '2WD';
  return nhtsa;
}

function calculateConfidence(results: Record<string, string>): number {
  const critical = ['Make', 'Model', 'ModelYear'];
  const important = ['BodyClass', 'DriveType', 'EngineCylinders', 'TransmissionStyle'];
  let score = 0;
  critical.forEach(f => { if (results[f]) score += 20; });
  important.forEach(f => { if (results[f]) score += 10; });
  return Math.min(100, score);
}

function mapNhtsaResult(vin: string, r: Record<string, string>): any {
  return {
    vin: vin.toUpperCase(),
    make: r.Make || null,
    model: r.Model || null,
    year: parseInt(r.ModelYear) || null,
    trim: r.Trim || null,
    body_type: r.BodyClass || null,
    doors: parseInt(r.Doors) || null,
    engine_size: r.EngineModel || null,
    engine_cylinders: parseInt(r.EngineCylinders) || null,
    engine_displacement_liters: r.DisplacementL || null,
    fuel_type: r.FuelTypePrimary || null,
    transmission: r.TransmissionStyle || null,
    drivetrain: mapDrivetrain(r.DriveType || ''),
    manufacturer: r.Manufacturer || null,
    plant_city: r.PlantCity || null,
    plant_country: r.PlantCountry || null,
    vehicle_type: r.VehicleType || null,
    provider: 'nhtsa',
    confidence: calculateConfidence(r),
    raw_response: r,
  };
}

/**
 * Decode a batch of VINs via NHTSA batch endpoint
 */
async function decodeBatch(vins: string[]): Promise<any[]> {
  const body = new URLSearchParams();
  body.append('format', 'json');
  body.append('data', vins.join(';'));

  const resp = await fetch(NHTSA_BATCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) throw new Error(`NHTSA API returned ${resp.status}`);

  const data = await resp.json();
  const results: any[] = [];

  for (const r of (data.Results || [])) {
    const vin = (r.VIN || '').toUpperCase();
    if (!vin || vin.length !== 17) continue;

    const errorCode = r.ErrorCode || '0';
    // ErrorCode "0" = no error, "1" = partial decode
    // Skip if all critical fields failed (ErrorCode 3, 4, 5, 11)
    const isCriticalError = ['3', '4', '5', '11'].some(e => errorCode === e);
    if (isCriticalError) {
      stats.skipped++;
      continue;
    }

    // Only store if we got at least make OR model
    if (!r.Make && !r.Model && !r.ModelYear) {
      stats.skipped++;
      continue;
    }

    results.push(mapNhtsaResult(vin, r));
  }

  return results;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log(`\n=== Mass VIN Decoder ===`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  if (queryLimit) console.log(`Limit: ${queryLimit} VINs`);
  if (queryOffset) console.log(`Offset: ${queryOffset}`);
  console.log('');

  console.log('Fetching VINs to process...');
  const vins = await getVinsToProcess();
  stats.totalVins = vins.length;

  if (stats.totalVins === 0) {
    console.log('All VINs already decoded. Nothing to do.');
    return;
  }

  const totalBatches = Math.ceil(stats.totalVins / VINS_PER_BATCH);
  const estimatedMinutes = Math.ceil(totalBatches / REQUESTS_PER_SECOND / 60);
  console.log(`\nWill send ${totalBatches} batches (~${estimatedMinutes} min at ${REQUESTS_PER_SECOND} req/s)\n`);

  if (dryRun) {
    console.log('DRY RUN — would decode these VINs. Showing first 10:');
    vins.slice(0, 10).forEach(v => console.log(`  ${v}`));
    return;
  }

  // Process in batches
  for (let i = 0; i < vins.length; i += VINS_PER_BATCH) {
    const batch = vins.slice(i, i + VINS_PER_BATCH);
    const batchNum = Math.floor(i / VINS_PER_BATCH) + 1;

    try {
      const decoded = await decodeBatch(batch);
      stats.batchesSent++;

      if (decoded.length > 0) {
        await supabaseUpsert('vin_decoded_data', decoded);
        stats.decoded += decoded.length;
      }

      // Progress every 20 batches
      if (batchNum % 20 === 0 || batchNum === totalBatches) {
        const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(0);
        const rate = (stats.decoded / (Date.now() - stats.startTime) * 1000).toFixed(1);
        const pct = ((i + batch.length) / stats.totalVins * 100).toFixed(1);
        console.log(`  [${batchNum}/${totalBatches}] ${pct}% | ${stats.decoded} decoded | ${stats.skipped} skipped | ${stats.errors} errors | ${rate}/s | ${elapsed}s`);
      }
    } catch (err: any) {
      stats.errors++;
      if (stats.errors > 50) {
        console.error(`\nToo many errors (${stats.errors}), aborting.`);
        break;
      }
      // Retry once after a pause
      console.error(`  Batch ${batchNum} error: ${err.message?.slice(0, 100)} — retrying...`);
      await sleep(2000);
      try {
        const decoded = await decodeBatch(batch);
        if (decoded.length > 0) {
          await supabaseUpsert('vin_decoded_data', decoded);
          stats.decoded += decoded.length;
        }
      } catch (retryErr: any) {
        console.error(`  Retry failed: ${retryErr.message?.slice(0, 100)}`);
      }
    }

    await sleep(DELAY_MS);
  }

  // Summary
  const totalTime = ((Date.now() - stats.startTime) / 1000).toFixed(1);
  console.log(`\n=== Summary ===`);
  console.log(`Total VINs processed: ${stats.totalVins}`);
  console.log(`Decoded:              ${stats.decoded}`);
  console.log(`Skipped (no data):    ${stats.skipped}`);
  console.log(`Errors:               ${stats.errors}`);
  console.log(`Batches sent:         ${stats.batchesSent}`);
  console.log(`Time:                 ${totalTime}s`);
  console.log(`Rate:                 ${(stats.decoded / parseFloat(totalTime)).toFixed(1)} VINs/s`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
