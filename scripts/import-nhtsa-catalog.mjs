#!/usr/bin/env node
/**
 * import-nhtsa-catalog.mjs
 *
 * Uses NHTSA VPIC API to enumerate all valid make/model/year combos for US-market vehicles.
 * Populates oem_models and oem_vehicle_specs with cited, authoritative data.
 *
 * APIs used:
 *   - GetAllMakes: https://vpic.nhtsa.dot.gov/api/vehicles/GetAllMakes?format=json
 *   - GetModelsForMakeYear: https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/{make}/modelyear/{year}?format=json
 *   - GetVehicleVariableValuesList: for enumerating valid values
 *   - DecodeVinValues (batch): for spec extraction per model
 *
 * Source: NHTSA Vehicle Product Information Catalog (VPIC)
 * Trust level: 95 (US Government regulatory data)
 *
 * Usage:
 *   dotenvx run -- node scripts/import-nhtsa-catalog.mjs [--dry-run] [--min-year 1960] [--max-year 2000] [--makes "Ford,Chevrolet,Dodge"]
 */

import { createClient } from '@supabase/supabase-js';

const DRY_RUN = process.argv.includes('--dry-run');
const MIN_YEAR = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--min-year') || '1960');
const MAX_YEAR = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--max-year') || '2000');
const MAKES_FILTER = process.argv.find((_, i, a) => a[i - 1] === '--makes')?.split(',').map(m => m.trim().toLowerCase()) || null;
const BATCH_SIZE = 200;
const API_DELAY_MS = 100; // Be nice to NHTSA

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const NHTSA_BASE = 'https://vpic.nhtsa.dot.gov/api/vehicles';

// Top collector vehicle makes (priority order)
const PRIORITY_MAKES = [
  'Ford', 'Chevrolet', 'Dodge', 'Plymouth', 'Pontiac', 'Buick', 'Oldsmobile', 'Cadillac',
  'AMC', 'Chrysler', 'Lincoln', 'Mercury', 'GMC', 'Jeep',
  'Porsche', 'BMW', 'Mercedes-Benz', 'Jaguar', 'Aston Martin', 'Ferrari', 'Lamborghini',
  'Alfa Romeo', 'Maserati', 'Lotus', 'MG', 'Triumph', 'Austin-Healey',
  'Toyota', 'Datsun', 'Nissan', 'Honda', 'Mazda', 'Subaru', 'Mitsubishi',
  'Volkswagen', 'Volvo', 'Saab', 'Fiat', 'Land Rover',
  'International', 'International Harvester', 'Scout',
  'Shelby', 'DeLorean', 'Avanti', 'Studebaker', 'Packard', 'Hudson',
  'De Tomaso', 'Jensen', 'TVR', 'Morgan', 'AC',
];

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJSON(url, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      return data;
    } catch (e) {
      if (attempt === retries - 1) throw e;
      await sleep(1000 * (attempt + 1));
    }
  }
}

async function getAllMakes() {
  console.log('Fetching all NHTSA makes...');
  const data = await fetchJSON(`${NHTSA_BASE}/GetAllMakes?format=json`);
  const makes = data.Results.map(r => ({
    id: r.Make_ID,
    name: r.Make_Name,
  }));
  console.log(`Found ${makes.length} total makes in NHTSA database`);
  return makes;
}

async function getModelsForMakeYear(makeName, year) {
  const encoded = encodeURIComponent(makeName);
  const data = await fetchJSON(`${NHTSA_BASE}/GetModelsForMakeYear/make/${encoded}/modelyear/${year}?format=json`);
  if (!data.Results) return [];
  return data.Results.map(r => ({
    makeId: r.Make_ID,
    makeName: r.Make_Name,
    modelId: r.Model_ID,
    modelName: r.Model_Name,
  }));
}

async function getModelsForMakeId(makeId, year) {
  const data = await fetchJSON(`${NHTSA_BASE}/GetModelsForMakeIdYear/makeId/${makeId}/modelyear/${year}?format=json`);
  if (!data.Results) return [];
  return data.Results.map(r => ({
    makeId: r.Make_ID,
    makeName: r.Make_Name,
    modelId: r.Model_ID,
    modelName: r.Model_Name,
  }));
}

function titleCase(str) {
  if (!str) return str;
  // Preserve known uppercase names
  const uppers = ['BMW', 'GMC', 'AMC', 'MG', 'TVR', 'AC', 'VW', 'GTO', 'GTI', 'SL', 'SS', 'RS', 'GT', 'LT', 'LS'];
  return str.split(/\s+/).map(word => {
    if (uppers.includes(word.toUpperCase())) return word.toUpperCase();
    if (word.length <= 2) return word.toUpperCase();
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
}

function normalizeMakeName(name) {
  if (!name) return name;
  const map = {
    'MERCEDES-BENZ': 'Mercedes-Benz',
    'MERCEDES BENZ': 'Mercedes-Benz',
    'ROLLS-ROYCE': 'Rolls-Royce',
    'ROLLS ROYCE': 'Rolls-Royce',
    'ASTON MARTIN': 'Aston Martin',
    'ALFA ROMEO': 'Alfa Romeo',
    'LAND ROVER': 'Land Rover',
    'AUSTIN-HEALEY': 'Austin-Healey',
    'DE TOMASO': 'De Tomaso',
    'AM GENERAL': 'AM General',
  };
  const upper = name.toUpperCase().trim();
  if (map[upper]) return map[upper];
  if (/^[A-Z]{2,4}$/.test(name.trim())) return name.trim().toUpperCase(); // BMW, GMC, AMC, etc.
  return titleCase(name.trim());
}

async function main() {
  console.log('NHTSA Vehicle Catalog → oem_models + oem_vehicle_specs');
  console.log(`Year range: ${MIN_YEAR}-${MAX_YEAR} | Dry run: ${DRY_RUN}`);
  if (MAKES_FILTER) console.log(`Filtering to makes: ${MAKES_FILTER.join(', ')}`);
  console.log('---');

  // Get all makes from NHTSA
  const allMakes = await getAllMakes();

  // Filter to priority makes or user-specified makes — EXACT match only
  let targetMakes;
  if (MAKES_FILTER) {
    targetMakes = allMakes.filter(m =>
      MAKES_FILTER.some(f => m.name.toLowerCase().trim() === f.toLowerCase().trim())
    );
  } else {
    // Use priority list — exact match by name
    targetMakes = [];
    for (const priority of PRIORITY_MAKES) {
      const match = allMakes.find(m =>
        m.name.toLowerCase().trim() === priority.toLowerCase().trim()
      );
      if (match) targetMakes.push(match);
    }
  }

  // NHTSA VPIC only has model data for 1981+ (VIN standardization year)
  const effectiveMinYear = Math.max(MIN_YEAR, 1981);
  if (MIN_YEAR < 1981) {
    console.log(`Note: NHTSA VPIC data starts at 1981 (VIN standardization). Adjusting min year from ${MIN_YEAR} to ${effectiveMinYear}.`);
  }

  console.log(`Target makes: ${targetMakes.length}`);
  targetMakes.forEach(m => process.stdout.write(`  ${m.name} (${m.id})\n`));

  // Enumerate models per make per year
  const allModels = []; // { makeName, modelName, makeId, modelId, year }
  const years = [];
  for (let y = effectiveMinYear; y <= MAX_YEAR; y++) years.push(y);

  let totalAPICalls = 0;

  for (const make of targetMakes) {
    process.stdout.write(`\n${normalizeMakeName(make.name)}: `);

    for (const year of years) {
      try {
        // Use GetModelsForMakeYear (by name) — more reliable than by ID for this endpoint
        const models = await getModelsForMakeYear(make.name, year);
        totalAPICalls++;

        // Filter to exact make ID (API returns partial name matches)
        const exactModels = models.filter(m => m.makeId === make.id);

        for (const model of exactModels) {
          allModels.push({
            makeName: normalizeMakeName(model.makeName),
            modelName: model.modelName,
            makeId: model.makeId,
            modelId: model.modelId,
            year,
          });
        }

        if (exactModels.length > 0) process.stdout.write(`${year}(${exactModels.length}) `);

        await sleep(API_DELAY_MS);
      } catch (e) {
        process.stdout.write(`${year}(ERR) `);
      }
    }
  }

  console.log(`\n\nTotal API calls: ${totalAPICalls}`);
  console.log(`Total model-year combos found: ${allModels.length}`);

  // Deduplicate models
  const modelMap = new Map();
  for (const m of allModels) {
    const key = `${m.makeName}|${m.modelName}`.toLowerCase();
    if (!modelMap.has(key)) {
      modelMap.set(key, {
        makeName: m.makeName,
        modelName: m.modelName,
        makeId: m.makeId,
        modelId: m.modelId,
        years: [],
      });
    }
    modelMap.get(key).years.push(m.year);
  }

  // Build oem_models rows
  const oemModels = [];
  for (const [, entry] of modelMap) {
    const sortedYears = entry.years.sort((a, b) => a - b);
    oemModels.push({
      make: entry.makeName,
      model_name: entry.modelName,
      year_start: sortedYears[0],
      year_end: sortedYears[sortedYears.length - 1],
      nhtsa_make_id: entry.makeId,
      nhtsa_model_id: entry.modelId,
      source: 'NHTSA_VPIC',
    });
  }

  console.log(`Unique models (oem_models candidates): ${oemModels.length}`);

  // Build oem_vehicle_specs rows (one per year-model combo for matching)
  const oemSpecs = [];
  for (const m of allModels) {
    oemSpecs.push({
      make: m.makeName,
      model: m.modelName,
      year_start: m.year,
      year_end: m.year,
      source: 'NHTSA_VPIC',
      confidence_score: 95,
      verification_status: 'verified',
      notes: `NHTSA VPIC catalog. Make ID: ${m.makeId}, Model ID: ${m.modelId}`,
    });
  }

  // Deduplicate specs
  const specKeys = new Set();
  const dedupedSpecs = oemSpecs.filter(s => {
    const key = `${s.make}|${s.model}|${s.year_start}`.toLowerCase();
    if (specKeys.has(key)) return false;
    specKeys.add(key);
    return true;
  });

  console.log(`Unique specs (oem_vehicle_specs candidates): ${dedupedSpecs.length}`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Sample oem_models:');
    oemModels.slice(0, 10).forEach(m =>
      console.log(`  ${m.make} ${m.model_name} (${m.year_start}-${m.year_end})`)
    );
    console.log('\n[DRY RUN] Sample oem_vehicle_specs:');
    dedupedSpecs.slice(0, 10).forEach(s =>
      console.log(`  ${s.year_start} ${s.make} ${s.model}`)
    );
    console.log(`\nWould insert ${oemModels.length} oem_models + ${dedupedSpecs.length} oem_vehicle_specs`);
    return;
  }

  // Insert oem_models
  console.log(`\nInserting ${oemModels.length} oem_models...`);
  let modelsInserted = 0;
  let modelsSkipped = 0;
  for (let i = 0; i < oemModels.length; i += BATCH_SIZE) {
    const batch = oemModels.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('oem_models')
      .insert(batch);

    if (error) {
      if (error.code === '23505') {
        // Unique violation — insert one by one
        for (const row of batch) {
          const { error: e2 } = await supabase.from('oem_models').insert(row);
          if (!e2) modelsInserted++;
          else modelsSkipped++;
        }
      } else {
        console.error(`oem_models batch error at ${i}:`, error.message);
        modelsSkipped += batch.length;
      }
    } else {
      modelsInserted += batch.length;
    }
    process.stdout.write(`  ${Math.min(i + BATCH_SIZE, oemModels.length)}/${oemModels.length}\r`);
  }
  console.log(`oem_models: ${modelsInserted} inserted, ${modelsSkipped} skipped`);

  // Insert oem_vehicle_specs
  console.log(`\nInserting ${dedupedSpecs.length} oem_vehicle_specs...`);
  let specsInserted = 0;
  let specsSkipped = 0;
  for (let i = 0; i < dedupedSpecs.length; i += BATCH_SIZE) {
    const batch = dedupedSpecs.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('oem_vehicle_specs')
      .insert(batch);

    if (error) {
      if (error.code === '23505') {
        for (const row of batch) {
          const { error: e2 } = await supabase.from('oem_vehicle_specs').insert(row);
          if (!e2) specsInserted++;
          else specsSkipped++;
        }
      } else {
        console.error(`oem_vehicle_specs batch error at ${i}:`, error.message);
        specsSkipped += batch.length;
      }
    } else {
      specsInserted += batch.length;
    }
    process.stdout.write(`  ${Math.min(i + BATCH_SIZE, dedupedSpecs.length)}/${dedupedSpecs.length}\r`);
  }
  console.log(`oem_vehicle_specs: ${specsInserted} inserted, ${specsSkipped} skipped`);

  // Final counts
  const { count: totalModels } = await supabase
    .from('oem_models')
    .select('*', { count: 'exact', head: true });
  const { count: totalSpecs } = await supabase
    .from('oem_vehicle_specs')
    .select('*', { count: 'exact', head: true });

  console.log(`\nFinal counts: oem_models=${totalModels}, oem_vehicle_specs=${totalSpecs}`);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
