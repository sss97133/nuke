#!/usr/bin/env node
/**
 * import-epa-fuel-economy.mjs
 *
 * Downloads EPA fuel economy CSV from fueleconomy.gov and inserts into oem_vehicle_specs.
 * Source: https://www.fueleconomy.gov/feg/epadata/vehicles.csv.zip
 * Trust level: 90 (US Government, authoritative)
 * Coverage: 1984-present, all US-market vehicles (~48K rows)
 *
 * Usage:
 *   dotenvx run -- node scripts/import-epa-fuel-economy.mjs [--dry-run] [--min-year 1984] [--max-year 2000]
 */

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const DRY_RUN = process.argv.includes('--dry-run');
const MIN_YEAR = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--min-year') || '1984');
const MAX_YEAR = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--max-year') || '2026');
const BATCH_SIZE = 500;

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const EPA_URL = 'https://www.fueleconomy.gov/feg/epadata/vehicles.csv.zip';
const TMP_DIR = '/tmp/epa-import';
const ZIP_PATH = path.join(TMP_DIR, 'vehicles.csv.zip');
const CSV_PATH = path.join(TMP_DIR, 'vehicles.csv');

// EPA drive values → our canonical drivetrain values
const DRIVE_MAP = {
  'Rear-Wheel Drive': 'RWD',
  'Front-Wheel Drive': 'FWD',
  'All-Wheel Drive': 'AWD',
  '4-Wheel Drive': '4WD',
  '4-Wheel or All-Wheel Drive': '4WD',
  'Part-time 4-Wheel Drive': '4WD',
  '2-Wheel Drive': 'RWD',
};

// EPA fuel types → our canonical
const FUEL_MAP = {
  'Regular': 'Gasoline',
  'Premium': 'Premium Gasoline',
  'Midgrade': 'Midgrade Gasoline',
  'Diesel': 'Diesel',
  'Electricity': 'Electric',
  'Natural Gas': 'Natural Gas',
  'Regular Gas and Electricity': 'Hybrid',
  'Premium and Electricity': 'Hybrid',
  'Premium Gas or Electricity': 'Hybrid',
  'Regular Gas or Electricity': 'Hybrid',
  'Midgrade Gas or Electricity': 'Hybrid',
  'Gasoline or E85': 'Flex Fuel',
  'Gasoline or natural gas': 'Bi-Fuel',
  'Gasoline or propane': 'Bi-Fuel',
};

function normalizeMake(make) {
  // Title case, clean up common EPA formatting
  if (!make) return null;
  const overrides = {
    'MERCEDES-BENZ': 'Mercedes-Benz',
    'BMW': 'BMW',
    'GMC': 'GMC',
    'MINI': 'MINI',
    'RAM': 'Ram',
    'FIAT': 'Fiat',
    'smart': 'Smart',
    'SRT': 'SRT',
    'TVR': 'TVR',
    'AM General': 'AM General',
  };
  if (overrides[make]) return overrides[make];
  return make.split(/[\s-]+/).map(w =>
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join(w => w.includes('-') ? '-' : ' ');
}

function normalizeTransmission(trany) {
  if (!trany) return null;
  // EPA format: "Automatic 4-spd", "Manual 5-spd", "Automatic (S6)", etc.
  const auto = trany.match(/^Automatic\s*(?:\(?(\w?\d+)(?:-spd)?\)?)?/i);
  if (auto) {
    const speeds = auto[1] ? auto[1].replace(/\D/g, '') : null;
    return speeds ? `${speeds}-Speed Automatic` : 'Automatic';
  }
  const manual = trany.match(/^Manual\s*(?:\(?(\d+)(?:-spd)?\)?)?/i);
  if (manual) {
    const speeds = manual[1];
    return speeds ? `${speeds}-Speed Manual` : 'Manual';
  }
  const cvt = /CVT/i.test(trany);
  if (cvt) return 'CVT';
  return trany;
}

function parseCSV(content) {
  const lines = content.split('\n');
  const header = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCSVLine(lines[i]);
    if (values.length !== header.length) continue;
    const row = {};
    header.forEach((col, idx) => row[col] = values[idx]);
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

async function downloadEPA() {
  fs.mkdirSync(TMP_DIR, { recursive: true });

  // Check if already downloaded recently (< 1 day old)
  if (fs.existsSync(CSV_PATH)) {
    const stat = fs.statSync(CSV_PATH);
    const age = Date.now() - stat.mtimeMs;
    if (age < 86400000) {
      console.log(`Using cached EPA CSV (${(stat.size / 1e6).toFixed(1)} MB, ${(age / 3600000).toFixed(1)}h old)`);
      return;
    }
  }

  console.log('Downloading EPA fuel economy data...');
  execSync(`curl -sL "${EPA_URL}" -o "${ZIP_PATH}"`, { timeout: 60000 });
  execSync(`unzip -o "${ZIP_PATH}" -d "${TMP_DIR}"`, { timeout: 30000 });
  const stat = fs.statSync(CSV_PATH);
  console.log(`Downloaded: ${(stat.size / 1e6).toFixed(1)} MB`);
}

function deduplicateSpecs(rows) {
  // Group by year + make + model + displacement + transmission + drivetrain
  // Keep the first one (they're usually identical for same combo)
  const seen = new Map();
  const deduped = [];

  for (const row of rows) {
    const key = [
      row.year,
      row.make?.toLowerCase(),
      row.model?.toLowerCase(),
      row.displ || '',
      normalizeTransmission(row.trany) || '',
      DRIVE_MAP[row.drive] || row.drive || '',
    ].join('|');

    if (!seen.has(key)) {
      seen.set(key, true);
      deduped.push(row);
    }
  }

  return deduped;
}

function toOemSpec(row) {
  const year = parseInt(row.year);
  const cylinders = parseInt(row.cylinders) || null;
  const displacement = parseFloat(row.displ) || null;
  const city = parseInt(row.city08) || null;
  const highway = parseInt(row.highway08) || null;
  const combined = parseInt(row.comb08) || null;

  let engineConfig = null;
  if (cylinders) {
    // Guess engine layout from cylinder count (EPA doesn't specify)
    if (cylinders <= 4) engineConfig = `I${cylinders}`;
    else if (cylinders === 5) engineConfig = 'I5';
    else if (cylinders === 6) engineConfig = 'V6'; // could be I6 for BMW/etc but V6 is more common
    else if (cylinders === 8) engineConfig = 'V8';
    else if (cylinders === 10) engineConfig = 'V10';
    else if (cylinders === 12) engineConfig = 'V12';
    else if (cylinders === 16) engineConfig = 'W16';
    else engineConfig = `${cylinders}cyl`;
  }

  // Build engine_size string like "5.7L V8"
  let engineSize = null;
  if (displacement) {
    engineSize = `${displacement}L`;
    if (engineConfig) engineSize += ` ${engineConfig}`;
    if (row.tCharger === 'T') engineSize += ' Turbo';
    if (row.sCharger === 'S') engineSize += ' Supercharged';
  }

  return {
    make: row.make,
    model: row.model,
    year_start: year,
    year_end: year, // EPA data is per-year, not ranges
    engine_size: engineSize,
    engine_displacement_liters: displacement,
    engine_config: engineConfig,
    fuel_type: FUEL_MAP[row.fuelType] || row.fuelType || null,
    transmission: normalizeTransmission(row.trany),
    drivetrain: DRIVE_MAP[row.drive] || row.drive || null,
    drive_type: row.drive || null,
    mpg_city: city,
    mpg_highway: highway,
    mpg_combined: combined,
    body_style: row.VClass || null,
    source: 'EPA_fueleconomy_gov',
    confidence_score: 90,
    verification_status: 'verified',
    notes: `EPA fuel economy database. Engine: ${row.eng_dscr || 'N/A'}. Trans: ${row.trans_dscr || row.trany || 'N/A'}.`,
  };
}

async function insertBatch(specs) {
  // Use upsert with the unique index — ON CONFLICT DO NOTHING
  const { data, error } = await supabase
    .from('oem_vehicle_specs')
    .upsert(specs, {
      onConflict: 'idx_oem_specs_unique_entry',
      ignoreDuplicates: true
    });

  if (error) {
    // If upsert with named index fails, fall back to raw SQL
    if (error.message?.includes('idx_oem_specs_unique_entry') || error.code === '42P10') {
      return insertBatchSQL(specs);
    }
    throw error;
  }
  return specs.length;
}

async function insertBatchSQL(specs) {
  // Build raw SQL with ON CONFLICT DO NOTHING
  let inserted = 0;
  for (const spec of specs) {
    const { error } = await supabase.rpc('exec_sql', {
      sql: `INSERT INTO oem_vehicle_specs (
        make, model, year_start, year_end, engine_size, engine_displacement_liters,
        engine_config, fuel_type, transmission, drivetrain, drive_type,
        mpg_city, mpg_highway, mpg_combined, body_style, source, confidence_score,
        verification_status, notes
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
      ) ON CONFLICT DO NOTHING`,
      params: [
        spec.make, spec.model, spec.year_start, spec.year_end, spec.engine_size,
        spec.engine_displacement_liters, spec.engine_config, spec.fuel_type,
        spec.transmission, spec.drivetrain, spec.drive_type, spec.mpg_city,
        spec.mpg_highway, spec.mpg_combined, spec.body_style, spec.source,
        spec.confidence_score, spec.verification_status, spec.notes
      ]
    });
    if (!error) inserted++;
  }
  return inserted;
}

async function main() {
  console.log(`EPA Fuel Economy → oem_vehicle_specs`);
  console.log(`Year range: ${MIN_YEAR}-${MAX_YEAR} | Dry run: ${DRY_RUN}`);
  console.log('---');

  await downloadEPA();

  console.log('Parsing CSV...');
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCSV(raw);
  console.log(`Total rows in EPA dataset: ${rows.length}`);

  // Filter to year range
  const filtered = rows.filter(r => {
    const year = parseInt(r.year);
    return year >= MIN_YEAR && year <= MAX_YEAR;
  });
  console.log(`Rows in ${MIN_YEAR}-${MAX_YEAR}: ${filtered.length}`);

  // Deduplicate
  const deduped = deduplicateSpecs(filtered);
  console.log(`After dedup: ${deduped.length} unique specs`);

  // Convert to oem_vehicle_specs format
  const specs = deduped.map(toOemSpec);

  // Stats
  const makeCount = new Set(specs.map(s => s.make)).size;
  const yearCount = new Set(specs.map(s => s.year_start)).size;
  console.log(`${makeCount} makes across ${yearCount} years`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Sample specs:');
    specs.slice(0, 5).forEach(s => {
      console.log(`  ${s.year_start} ${s.make} ${s.model} | ${s.engine_size || '?'} | ${s.transmission || '?'} | ${s.drivetrain || '?'} | ${s.mpg_combined || '?'} mpg`);
    });
    console.log(`\nWould insert up to ${specs.length} rows into oem_vehicle_specs`);
    return;
  }

  // Batch insert
  console.log(`\nInserting ${specs.length} specs in batches of ${BATCH_SIZE}...`);
  let totalInserted = 0;
  let totalSkipped = 0;

  for (let i = 0; i < specs.length; i += BATCH_SIZE) {
    const batch = specs.slice(i, i + BATCH_SIZE);

    try {
      // Insert via PostgREST — use ON CONFLICT behavior
      const { error, count } = await supabase
        .from('oem_vehicle_specs')
        .insert(batch, { count: 'exact' })
        .select('id');

      if (error) {
        // Unique violation means some already exist — insert one by one
        if (error.code === '23505') {
          let batchInserted = 0;
          for (const spec of batch) {
            const { error: singleErr } = await supabase
              .from('oem_vehicle_specs')
              .insert(spec);
            if (!singleErr) batchInserted++;
          }
          totalInserted += batchInserted;
          totalSkipped += batch.length - batchInserted;
        } else {
          console.error(`Batch error at offset ${i}:`, error.message);
          totalSkipped += batch.length;
        }
      } else {
        totalInserted += batch.length;
      }
    } catch (e) {
      console.error(`Exception at offset ${i}:`, e.message);
      totalSkipped += batch.length;
    }

    if ((i / BATCH_SIZE) % 10 === 0) {
      process.stdout.write(`  ${i + batch.length}/${specs.length} (${totalInserted} inserted, ${totalSkipped} skipped)\r`);
    }
  }

  console.log(`\nDone! Inserted: ${totalInserted} | Skipped (dupes): ${totalSkipped}`);

  // Verify
  const { data: countData } = await supabase
    .from('oem_vehicle_specs')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'EPA_fueleconomy_gov');

  console.log(`Total EPA rows in oem_vehicle_specs: ${countData?.length || 'check manually'}`);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
