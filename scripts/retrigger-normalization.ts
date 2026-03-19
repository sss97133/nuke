#!/usr/bin/env npx tsx
/**
 * Re-trigger Normalization — Phase 4 of Vehicle Taxonomy Normalization
 *
 * Two modes:
 *   --method=direct (default): Direct SQL normalization bypassing triggers.
 *     Faster, no deadlocks, safe to run while VIN decode is active.
 *   --method=trigger: Touch columns to re-fire triggers (original approach).
 *     Can deadlock with concurrent vehicle writes.
 *
 * Model normalization: exact alias match then partial (contains) match.
 * Body style normalization: uses normalize_body_style() function.
 *
 * Usage:
 *   dotenvx run -- npx tsx scripts/retrigger-normalization.ts
 *   dotenvx run -- npx tsx scripts/retrigger-normalization.ts --dry-run
 *   dotenvx run -- npx tsx scripts/retrigger-normalization.ts --target model
 *   dotenvx run -- npx tsx scripts/retrigger-normalization.ts --target body
 */

const DB_HOST = 'aws-0-us-west-1.pooler.supabase.com';
const DB_PORT = '6543';
const DB_USER = 'postgres.qkgaybvrernstplzjaam';
const DB_PASS = 'RbzKq32A0uhqvJMQ';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const targetArg = args.find((_, i) => args[i - 1] === '--target') || 'both';

const stats = {
  modelExact: 0,
  modelPartial: 0,
  modelBatches: 0,
  bodyUpdated: 0,
  bodyBatches: 0,
  startTime: Date.now(),
};

async function executeSql(query: string, retries = 2): Promise<string[]> {
  const { execSync } = await import('child_process');
  const env = { ...process.env, PGPASSWORD: DB_PASS };
  const singleLine = query.replace(/\s+/g, ' ').trim();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = execSync(
        `psql -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -d postgres -t -A -c ${JSON.stringify(singleLine)}`,
        { env, timeout: 120000, encoding: 'utf-8' }
      );
      return result.trim().split('\n').filter(Boolean);
    } catch (err: any) {
      const stderr = err.stderr || '';
      if (stderr.includes('deadlock') && attempt < retries) {
        console.log(`  Deadlock detected, retrying (${attempt + 1}/${retries})...`);
        await sleep(2000 + Math.random() * 3000);
        continue;
      }
      if (err.stdout) return err.stdout.trim().split('\n').filter(Boolean);
      throw err;
    }
  }
  return [];
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function parseUpdateCount(result: string[]): number {
  // psql returns "UPDATE N" for updates
  for (const line of result) {
    const m = line.match(/UPDATE\s+(\d+)/i);
    if (m) return parseInt(m[1]);
    // Or just a bare number
    if (/^\d+$/.test(line.trim())) return parseInt(line.trim());
  }
  return 0;
}

// ===========================
// Model Normalization (Direct SQL)
// ===========================

async function getTopMakes(): Promise<string[]> {
  const rows = await executeSql(`
    SELECT make, count(*) as cnt FROM vehicles
    WHERE normalized_model IS NULL AND model IS NOT NULL AND deleted_at IS NULL AND make IS NOT NULL
    GROUP BY make ORDER BY cnt DESC LIMIT 200
  `);
  return rows.map(r => r.split('|')[0]).filter(Boolean);
}

async function normalizeModelsExact() {
  console.log('\n  Phase 1: Exact alias match (per-make)...');
  let totalUpdated = 0;

  const makes = await getTopMakes();
  console.log(`    Processing ${makes.length} makes...`);

  for (const make of makes) {
    const escapedMake = make.replace(/'/g, "''");
    let makeUpdated = 0;

    while (true) {
      const result = await executeSql(`
        WITH matched AS (
          SELECT DISTINCT ON (v.id) v.id, cm.canonical_model
          FROM vehicles v
          JOIN canonical_models cm ON cm.make ILIKE '${escapedMake}'
            AND LOWER(TRIM(v.model)) = ANY(cm.aliases)
          WHERE v.normalized_model IS NULL
            AND v.model IS NOT NULL
            AND v.deleted_at IS NULL
            AND v.make ILIKE '${escapedMake}'
          ORDER BY v.id, length(cm.canonical_model) DESC
          LIMIT 1000
        )
        UPDATE vehicles v SET normalized_model = m.canonical_model
        FROM matched m WHERE v.id = m.id
      `);

      const affected = parseUpdateCount(result);
      if (affected === 0) break;

      makeUpdated += affected;
      totalUpdated += affected;
      stats.modelBatches++;
      await sleep(100);
    }

    if (makeUpdated > 0) {
      console.log(`    ${make}: ${makeUpdated} exact matches`);
    }
  }

  stats.modelExact = totalUpdated;
  console.log(`  Exact match total: ${totalUpdated} vehicles`);
}

async function normalizeModelsPartial() {
  console.log('\n  Phase 2: Partial (starts-with) match per-alias...');
  let totalUpdated = 0;

  // Get all canonical models with their aliases
  const aliasRows = await executeSql(`
    SELECT make, canonical_model, unnest(aliases) as alias
    FROM canonical_models
    WHERE aliases IS NOT NULL
    ORDER BY length(canonical_model) DESC
  `);

  // Parse into structured list, filter to meaningful aliases
  const entries: { make: string; model: string; alias: string }[] = [];
  for (const row of aliasRows) {
    const parts = row.split('|');
    if (parts.length < 3) continue;
    const [make, model, alias] = parts;
    if (alias.length < 3) continue;
    entries.push({ make, model, alias });
  }

  console.log(`    ${entries.length} aliases to process...`);

  for (const entry of entries) {
    const escapedMake = entry.make.replace(/'/g, "''");
    const escapedAlias = entry.alias.replace(/'/g, "''");
    const escapedModel = entry.model.replace(/'/g, "''");

    // Starts-with match: "corvette convertible 4-speed" starts with "corvette"
    const result = await executeSql(`
      UPDATE vehicles SET normalized_model = '${escapedModel}'
      WHERE make ILIKE '${escapedMake}'
        AND normalized_model IS NULL
        AND model IS NOT NULL
        AND deleted_at IS NULL
        AND LOWER(TRIM(model)) LIKE '${escapedAlias} %'
    `);

    const affected = parseUpdateCount(result);
    if (affected > 0) {
      totalUpdated += affected;
      stats.modelBatches++;
      if (affected >= 10) {
        console.log(`    ${entry.make} "${entry.alias}..." → ${entry.model}: ${affected} matches`);
      }
    }
  }

  stats.modelPartial = totalUpdated;
  console.log(`  Partial match total: ${totalUpdated} vehicles`);
}

async function normalizeModels() {
  console.log('\n--- Model Normalization (Direct SQL) ---');

  const countResult = await executeSql(`
    SELECT count(*) FROM vehicles
    WHERE normalized_model IS NULL AND model IS NOT NULL AND deleted_at IS NULL
  `);
  const total = parseInt(countResult[0] || '0');
  console.log(`Vehicles needing model normalization: ${total}`);

  if (total === 0) {
    console.log('All models already normalized.');
    return;
  }

  if (dryRun) {
    const sample = await executeSql(`
      SELECT make, model, count(*) as cnt
      FROM vehicles
      WHERE normalized_model IS NULL AND model IS NOT NULL AND deleted_at IS NULL
      GROUP BY make, model ORDER BY cnt DESC LIMIT 15
    `);
    console.log('Top un-normalized models:');
    sample.forEach(r => console.log(`  ${r}`));
    console.log(`\nDRY RUN — would normalize up to ${total} vehicles`);
    return;
  }

  await normalizeModelsExact();
  await normalizeModelsPartial();
}

// ===========================
// Body Style Normalization (Direct SQL)
// ===========================

async function normalizeBodyStyles() {
  console.log('\n--- Body Style Normalization (Direct SQL) ---');

  const countResult = await executeSql(`
    SELECT count(*) FROM vehicles
    WHERE canonical_body_style IS NULL AND body_style IS NOT NULL AND deleted_at IS NULL
  `);
  const total = parseInt(countResult[0] || '0');
  console.log(`Vehicles needing body style normalization: ${total}`);

  if (total === 0) {
    console.log('All body styles already normalized.');
    return;
  }

  if (dryRun) {
    const sample = await executeSql(`
      SELECT body_style, count(*) as cnt
      FROM vehicles
      WHERE canonical_body_style IS NULL AND body_style IS NOT NULL AND deleted_at IS NULL
      GROUP BY body_style ORDER BY cnt DESC LIMIT 15
    `);
    console.log('Top un-normalized body styles:');
    sample.forEach(r => console.log(`  ${r}`));
    console.log(`\nDRY RUN — would normalize up to ${total} vehicles`);
    return;
  }

  const BATCH = 1000;

  while (true) {
    // Use the existing normalize_body_style() function directly
    const result = await executeSql(`
      UPDATE vehicles SET
        canonical_body_style = normalize_body_style(body_style),
        canonical_vehicle_type = COALESCE(
          (SELECT vehicle_type FROM canonical_body_styles WHERE canonical_name = normalize_body_style(body_style) LIMIT 1),
          canonical_vehicle_type
        )
      WHERE id IN (
        SELECT id FROM vehicles
        WHERE canonical_body_style IS NULL AND body_style IS NOT NULL AND deleted_at IS NULL
          AND normalize_body_style(body_style) IS NOT NULL
        LIMIT ${BATCH}
      )
    `);

    const affected = parseUpdateCount(result);
    if (affected === 0) break;

    stats.bodyUpdated += affected;
    stats.bodyBatches++;

    if (stats.bodyBatches % 5 === 0) {
      const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(0);
      console.log(`  Body batch ${stats.bodyBatches}: ${stats.bodyUpdated} normalized (${elapsed}s)`);
    }

    await sleep(100);
  }

  console.log(`  Body style normalization: ${stats.bodyUpdated} vehicles in ${stats.bodyBatches} batches`);
}

// ===========================
// Verification
// ===========================

async function showVerification() {
  console.log('\n--- Verification ---');
  const result = await executeSql(`
    SELECT
      round(100.0 * count(normalized_model) / count(*), 1) as model_pct,
      round(100.0 * count(canonical_body_style) / count(*), 1) as body_pct,
      round(100.0 * count(trim) / count(*), 1) as trim_pct,
      count(DISTINCT normalized_model) as unique_norm_models,
      count(DISTINCT canonical_body_style) as unique_body_styles
    FROM vehicles WHERE deleted_at IS NULL
  `);
  console.log(`  ${result[0]}`);
  console.log('  (format: model_pct|body_pct|trim_pct|unique_norm_models|unique_body_styles)');
  console.log('  Target: model_pct > 90%, body_pct > 90%, trim_pct > 40%');
}

async function main() {
  console.log(`\n=== Normalization (Direct SQL) ===`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Target: ${targetArg}`);

  if (targetArg === 'model' || targetArg === 'both') {
    await normalizeModels();
  }

  if (targetArg === 'body' || targetArg === 'both') {
    await normalizeBodyStyles();
  }

  const totalTime = ((Date.now() - stats.startTime) / 1000).toFixed(1);
  console.log(`\n=== Summary ===`);
  console.log(`Model exact:   ${stats.modelExact}`);
  console.log(`Model partial: ${stats.modelPartial}`);
  console.log(`Body:          ${stats.bodyUpdated}`);
  console.log(`Total batches: ${stats.modelBatches + stats.bodyBatches}`);
  console.log(`Time:          ${totalTime}s`);

  await showVerification();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
