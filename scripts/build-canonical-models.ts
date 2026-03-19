#!/usr/bin/env npx tsx
/**
 * Build Canonical Models — Phase 2b of Vehicle Taxonomy Normalization
 *
 * Expands canonical_models from 247 → ~3,000+ entries using:
 *   A) NHTSA GetModelsForMake API (official model catalog for top makes)
 *   B) vin_decoded_data (NHTSA canonical names for vehicles we actually have)
 *   C) ECR catalog (594 makes, 3,319 collector-car models)
 *
 * Also derives aliases by cross-referencing raw vehicle.model with decoded VIN model.
 *
 * Usage:
 *   dotenvx run -- npx tsx scripts/build-canonical-models.ts
 *   dotenvx run -- npx tsx scripts/build-canonical-models.ts --dry-run
 *   dotenvx run -- npx tsx scripts/build-canonical-models.ts --source nhtsa
 *   dotenvx run -- npx tsx scripts/build-canonical-models.ts --source ecr
 *   dotenvx run -- npx tsx scripts/build-canonical-models.ts --source vin-crossref
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const sourceFilter = args.find((_, i) => args[i - 1] === '--source') || 'all';

const stats = {
  nhtsaModels: 0,
  ecrModels: 0,
  vinCrossrefAliases: 0,
  inserted: 0,
  updated: 0,
  skipped: 0,
};

async function supabaseQuery(table: string, params: Record<string, string>): Promise<any[]> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Query ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function supabaseUpsert(table: string, rows: any[], onConflict: string): Promise<void> {
  // Batch in chunks of 200
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Upsert ${table}: ${res.status} ${text.slice(0, 200)}`);
    }
  }
}

async function supabasePatch(table: string, matchParams: Record<string, string>, body: any): Promise<void> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  for (const [k, v] of Object.entries(matchParams)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Patch ${table}: ${res.status} ${text.slice(0, 200)}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ===========================
// Source A: NHTSA GetModelsForMake
// ===========================

// Top makes by vehicle count (from our data)
const TOP_MAKES = [
  'Chevrolet', 'Ford', 'Porsche', 'BMW', 'Mercedes-Benz', 'Dodge', 'Toyota',
  'Pontiac', 'Cadillac', 'Buick', 'Oldsmobile', 'Plymouth', 'Volkswagen',
  'Audi', 'Jaguar', 'Lincoln', 'Chrysler', 'Jeep', 'GMC', 'AMC',
  'Datsun', 'Nissan', 'Honda', 'Mazda', 'Volvo', 'Aston Martin', 'Bentley',
  'Rolls-Royce', 'Ferrari', 'Lamborghini', 'Maserati', 'Alfa Romeo',
  'Lotus', 'MG', 'Triumph', 'Austin-Healey', 'Land Rover', 'Range Rover',
  'Shelby', 'DeLorean', 'Saab', 'Fiat', 'Subaru', 'Mitsubishi',
  'Lexus', 'Acura', 'Infiniti', 'McLaren', 'Bugatti', 'Studebaker',
];

async function fetchNhtsaModels(): Promise<Map<string, any[]>> {
  console.log('\n--- Source A: NHTSA GetModelsForMake ---');
  const makeModels = new Map<string, any[]>();

  for (const make of TOP_MAKES) {
    try {
      const url = `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMake/${encodeURIComponent(make)}?format=json`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        console.error(`  NHTSA error for ${make}: ${res.status}`);
        continue;
      }
      const data = await res.json();
      const models = (data.Results || [])
        .filter((r: any) => r.Model_Name)
        .map((r: any) => ({
          make: r.Make_Name || make,
          model: r.Model_Name,
          nhtsa_model_id: r.Model_ID,
        }));

      makeModels.set(make, models);
      stats.nhtsaModels += models.length;

      if (models.length > 0) {
        process.stdout.write(`  ${make}: ${models.length} models\n`);
      }

      await sleep(250); // Rate limit
    } catch (err: any) {
      console.error(`  Error fetching ${make}: ${err.message?.slice(0, 80)}`);
    }
  }

  console.log(`  Total NHTSA models: ${stats.nhtsaModels}`);
  return makeModels;
}

// ===========================
// Source B: VIN cross-reference (raw model → canonical model)
// ===========================

interface VinCrossRef {
  raw_model: string;
  canonical_model: string;
  make: string;
  count: number;
}

async function fetchVinCrossRef(): Promise<VinCrossRef[]> {
  console.log('\n--- Source B: VIN Cross-Reference ---');

  // We need to join vehicles with vin_decoded_data to find raw→canonical mappings
  // Since we can't do JOINs via REST API, we'll fetch both and join in memory
  const decodedMap = new Map<string, { make: string; model: string }>();

  // Fetch all vin_decoded_data
  let offset = 0;
  while (true) {
    const data = await supabaseQuery('vin_decoded_data', {
      'select': 'vin,make,model',
      'model': 'not.is.null',
      'limit': '5000',
      'offset': String(offset),
    });
    if (!data || data.length === 0) break;
    for (const row of data) {
      decodedMap.set(String(row.vin).toUpperCase(), {
        make: row.make,
        model: row.model,
      });
    }
    offset += 5000;
    if (data.length < 5000) break;
  }

  console.log(`  Decoded VINs with model data: ${decodedMap.size}`);
  if (decodedMap.size === 0) {
    console.log('  No decoded VINs yet — run mass-vin-decode.ts first');
    return [];
  }

  // Fetch vehicles with VINs that match decoded data
  const crossRefCounts = new Map<string, { raw: string; canonical: string; make: string; count: number }>();
  offset = 0;

  while (true) {
    const vehicles = await supabaseQuery('vehicles', {
      'select': 'vin,model,make',
      'deleted_at': 'is.null',
      'vin': 'not.is.null',
      'model': 'not.is.null',
      'limit': '5000',
      'offset': String(offset),
    });
    if (!vehicles || vehicles.length === 0) break;

    for (const v of vehicles) {
      const vin = String(v.vin).toUpperCase();
      const decoded = decodedMap.get(vin);
      if (!decoded || !decoded.model) continue;

      const rawModel = String(v.model).trim();
      const canonModel = decoded.model;

      // Skip if they're the same (case-insensitive)
      if (rawModel.toLowerCase() === canonModel.toLowerCase()) continue;

      const key = `${(v.make || decoded.make || '').toLowerCase()}|${rawModel.toLowerCase()}|${canonModel}`;
      const existing = crossRefCounts.get(key);
      if (existing) {
        existing.count++;
      } else {
        crossRefCounts.set(key, {
          raw: rawModel.toLowerCase(),
          canonical: canonModel,
          make: v.make || decoded.make || '',
          count: 1,
        });
      }
    }

    offset += 5000;
    if (vehicles.length < 5000) break;
    if (offset > 500000) break;
  }

  // Filter to mappings with 2+ occurrences (reduces noise)
  const crossRefs: VinCrossRef[] = Array.from(crossRefCounts.values())
    .filter(c => c.count >= 2)
    .sort((a, b) => b.count - a.count)
    .map(c => ({
      raw_model: c.raw,
      canonical_model: c.canonical,
      make: c.make,
      count: c.count,
    }));

  stats.vinCrossrefAliases = crossRefs.length;
  console.log(`  Cross-reference aliases (2+ occurrences): ${crossRefs.length}`);
  if (crossRefs.length > 0) {
    console.log('  Top 10:');
    crossRefs.slice(0, 10).forEach(c =>
      console.log(`    "${c.raw_model}" → "${c.canonical_model}" (${c.make}, ${c.count}x)`)
    );
  }

  return crossRefs;
}

// ===========================
// Source C: ECR catalog
// ===========================

async function fetchEcrModels(): Promise<Map<string, string[]>> {
  console.log('\n--- Source C: ECR Catalog ---');
  const makeModels = new Map<string, string[]>();
  let offset = 0;

  while (true) {
    const data = await supabaseQuery('ecr_models', {
      'select': 'ecr_make_slug,model_name',
      'is_active': 'eq.true',
      'limit': '5000',
      'offset': String(offset),
    });
    if (!data || data.length === 0) break;

    for (const row of data) {
      // ecr_make_slug is lowercase hyphenated (e.g. "aston-martin")
      // Convert to title case for matching
      const make = slugToMake(row.ecr_make_slug);
      const model = row.model_name;
      if (!make || !model) continue;

      if (!makeModels.has(make)) makeModels.set(make, []);
      makeModels.get(make)!.push(model);
    }

    offset += 5000;
    if (data.length < 5000) break;
  }

  let total = 0;
  makeModels.forEach(models => total += models.length);
  stats.ecrModels = total;
  console.log(`  ECR makes: ${makeModels.size}, models: ${total}`);

  return makeModels;
}

function slugToMake(slug: string): string {
  const overrides: Record<string, string> = {
    'bmw': 'BMW', 'mg': 'MG', 'gmc': 'GMC', 'amc': 'AMC',
    'ac': 'AC', 'tvr': 'TVR', 'asa': 'ASA', 'iso': 'Iso',
    'aston-martin': 'Aston Martin', 'alfa-romeo': 'Alfa Romeo',
    'austin-healey': 'Austin-Healey', 'de-tomaso': 'De Tomaso',
    'rolls-royce': 'Rolls-Royce', 'mercedes-benz': 'Mercedes-Benz',
    'land-rover': 'Land Rover', 'range-rover': 'Range Rover',
  };
  if (overrides[slug]) return overrides[slug];

  return slug.split('-').map(w => {
    if (w.length <= 3 && /^[a-z]+$/.test(w)) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

// ===========================
// Merge & Insert
// ===========================

interface CanonicalModelEntry {
  make: string;
  canonical_model: string;
  aliases: string[];
  canonical_series?: string;
  year_start?: number;
  year_end?: number;
  notes?: string;
}

async function loadExistingModels(): Promise<Map<string, any>> {
  const existing = new Map<string, any>();
  let offset = 0;
  while (true) {
    const data = await supabaseQuery('canonical_models', {
      'select': '*',
      'limit': '1000',
      'offset': String(offset),
    });
    if (!data || data.length === 0) break;
    for (const row of data) {
      const key = `${(row.make || '').toLowerCase()}|${(row.canonical_model || '').toLowerCase()}`;
      existing.set(key, row);
    }
    offset += 1000;
    if (data.length < 1000) break;
  }
  return existing;
}

// GM trucks where NHTSA is coarse ("C/K Pickup") — keep existing specific entries
const GM_TRUCK_MODELS = new Set([
  'c10', 'c20', 'c30', 'k10', 'k20', 'k30',
  'c/k 1500', 'c/k 2500', 'c/k 3500',
  'silverado', 'sierra',
]);

async function main() {
  console.log(`\n=== Build Canonical Models ===`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Source: ${sourceFilter}`);

  const existing = await loadExistingModels();
  console.log(`\nExisting canonical_models: ${existing.size}`);

  const toInsert: CanonicalModelEntry[] = [];
  const toUpdateAliases: { id: string; aliases: string[] }[] = [];

  // Source A: NHTSA
  if (sourceFilter === 'all' || sourceFilter === 'nhtsa') {
    const nhtsaModels = await fetchNhtsaModels();

    for (const [make, models] of nhtsaModels) {
      for (const m of models) {
        const key = `${make.toLowerCase()}|${m.model.toLowerCase()}`;
        const existingEntry = existing.get(key);

        if (existingEntry) {
          // Already exists — skip (don't overwrite curated entries)
          stats.skipped++;
          continue;
        }

        // Skip coarse GM truck names if we have specific ones
        if (['Chevrolet', 'GMC'].includes(make) && m.model.toLowerCase().includes('c/k')) {
          stats.skipped++;
          continue;
        }

        toInsert.push({
          make,
          canonical_model: m.model,
          aliases: [m.model.toLowerCase()],
          notes: `nhtsa_model_id:${m.nhtsa_model_id}`,
        });
      }
    }
  }

  // Source C: ECR
  if (sourceFilter === 'all' || sourceFilter === 'ecr') {
    const ecrModels = await fetchEcrModels();

    for (const [make, models] of ecrModels) {
      for (const model of models) {
        const key = `${make.toLowerCase()}|${model.toLowerCase()}`;
        if (existing.has(key)) {
          stats.skipped++;
          continue;
        }
        // Check if we're about to insert a duplicate from NHTSA
        if (toInsert.some(e => e.make.toLowerCase() === make.toLowerCase() && e.canonical_model.toLowerCase() === model.toLowerCase())) {
          stats.skipped++;
          continue;
        }

        toInsert.push({
          make,
          canonical_model: model,
          aliases: [model.toLowerCase()],
          notes: 'source:ecr',
        });
      }
    }
  }

  // Source B: VIN cross-reference aliases
  if (sourceFilter === 'all' || sourceFilter === 'vin-crossref') {
    const crossRefs = await fetchVinCrossRef();

    for (const cr of crossRefs) {
      // Find matching canonical model entry
      const key = `${cr.make.toLowerCase()}|${cr.canonical_model.toLowerCase()}`;
      const existingEntry = existing.get(key);

      if (existingEntry) {
        // Add raw_model as alias if not already present
        const currentAliases: string[] = existingEntry.aliases || [];
        if (!currentAliases.includes(cr.raw_model)) {
          toUpdateAliases.push({
            id: existingEntry.id,
            aliases: [...currentAliases, cr.raw_model],
          });
        }
      } else {
        // Check in toInsert
        const pending = toInsert.find(e =>
          e.make.toLowerCase() === cr.make.toLowerCase() &&
          e.canonical_model.toLowerCase() === cr.canonical_model.toLowerCase()
        );
        if (pending) {
          if (!pending.aliases.includes(cr.raw_model)) {
            pending.aliases.push(cr.raw_model);
          }
        }
        // Don't create new entry just from alias mapping
      }
    }
  }

  // Deduplicate toInsert by make+model key
  const seen = new Set<string>();
  const deduped: CanonicalModelEntry[] = [];
  for (const entry of toInsert) {
    const key = `${entry.make.toLowerCase()}|${entry.canonical_model.toLowerCase()}`;
    if (!seen.has(key) && !existing.has(key)) {
      seen.add(key);
      deduped.push(entry);
    }
  }

  console.log(`\n=== Results ===`);
  console.log(`New models to insert: ${deduped.length}`);
  console.log(`Existing models to add aliases: ${toUpdateAliases.length}`);
  console.log(`Skipped (already exist): ${stats.skipped}`);

  if (dryRun) {
    console.log('\nDRY RUN — sample of new models:');
    deduped.slice(0, 20).forEach(e =>
      console.log(`  ${e.make} | ${e.canonical_model} | aliases: [${e.aliases.join(', ')}]`)
    );
    if (toUpdateAliases.length > 0) {
      console.log('\nSample alias updates:');
      toUpdateAliases.slice(0, 10).forEach(u =>
        console.log(`  id:${u.id.slice(0, 8)}... → [${u.aliases.slice(-3).join(', ')}]`)
      );
    }
    return;
  }

  // Insert new models
  if (deduped.length > 0) {
    console.log(`\nInserting ${deduped.length} new canonical models...`);
    const rows = deduped.map(e => ({
      make: e.make,
      canonical_model: e.canonical_model,
      aliases: e.aliases,
      canonical_series: e.canonical_series || null,
      year_start: e.year_start || null,
      year_end: e.year_end || null,
      notes: e.notes || null,
    }));

    try {
      await supabaseUpsert('canonical_models', rows, 'make,canonical_model');
      stats.inserted = deduped.length;
      console.log(`  Inserted ${stats.inserted} models`);
    } catch (err: any) {
      console.error(`  Insert error: ${err.message?.slice(0, 200)}`);
      // Try smaller batches
      let inserted = 0;
      for (let i = 0; i < rows.length; i += 50) {
        const batch = rows.slice(i, i + 50);
        try {
          await supabaseUpsert('canonical_models', batch, 'make,canonical_model');
          inserted += batch.length;
        } catch (batchErr: any) {
          console.error(`  Batch ${i}-${i + 50} error: ${batchErr.message?.slice(0, 100)}`);
        }
      }
      stats.inserted = inserted;
      console.log(`  Inserted ${inserted} of ${rows.length} (some failed)`);
    }
  }

  // Update aliases
  if (toUpdateAliases.length > 0) {
    console.log(`\nUpdating aliases for ${toUpdateAliases.length} existing models...`);
    let updated = 0;
    for (const u of toUpdateAliases) {
      try {
        await supabasePatch('canonical_models', { 'id': `eq.${u.id}` }, { aliases: u.aliases });
        updated++;
      } catch (err: any) {
        console.error(`  Alias update ${u.id}: ${err.message?.slice(0, 80)}`);
      }
    }
    stats.updated = updated;
    console.log(`  Updated ${updated} models with new aliases`);
  }

  console.log(`\n=== Summary ===`);
  console.log(`NHTSA models fetched: ${stats.nhtsaModels}`);
  console.log(`ECR models fetched:   ${stats.ecrModels}`);
  console.log(`VIN cross-ref aliases: ${stats.vinCrossrefAliases}`);
  console.log(`New models inserted:  ${stats.inserted}`);
  console.log(`Models updated:       ${stats.updated}`);
  console.log(`Skipped:              ${stats.skipped}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
