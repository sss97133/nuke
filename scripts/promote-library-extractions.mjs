#!/usr/bin/env node
/**
 * promote-library-extractions.mjs — Promote staged mining results to canonical library tables
 *
 * Reads comment_library_extractions staging table and promotes entries to:
 * - vintage_rpo_codes (option codes)
 * - paint_codes (paint codes)
 * - oem_trim_levels (trim packages)
 *
 * Deduplicates against existing entries. Marks promoted rows.
 *
 * Usage:
 *   dotenvx run -- node scripts/promote-library-extractions.mjs
 *   dotenvx run -- node scripts/promote-library-extractions.mjs --dry-run
 *   dotenvx run -- node scripts/promote-library-extractions.mjs --stats
 */

import pg from 'pg';

const DB_HOST = '54.177.55.191';

async function getDb() {
  const client = new pg.Client({
    host: DB_HOST, port: 6543,
    user: 'postgres.qkgaybvrernstplzjaam',
    password: process.env.SUPABASE_DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

async function showStats(db) {
  const staged = await db.query(`
    SELECT extraction_type, count(*) as total,
           count(*) FILTER (WHERE promoted = true) as promoted,
           count(*) FILTER (WHERE promoted IS NOT true) as pending
    FROM comment_library_extractions
    GROUP BY extraction_type ORDER BY total DESC
  `);
  console.log('\n=== Staging Table Stats ===\n');
  for (const r of staged.rows) {
    console.log(`  ${r.extraction_type}: ${r.total} total (${r.promoted} promoted, ${r.pending} pending)`);
  }

  const canonical = await db.query(`
    SELECT 'vintage_rpo_codes' as tbl, count(*) as cnt FROM vintage_rpo_codes
    UNION ALL
    SELECT 'paint_codes', count(*) FROM paint_codes
    UNION ALL
    SELECT 'oem_trim_levels', count(*) FROM oem_trim_levels
  `);
  console.log('\nCanonical Tables:');
  for (const r of canonical.rows) {
    console.log(`  ${r.tbl}: ${r.cnt} entries`);
  }
}

async function promoteOptionCodes(db, dryRun) {
  const { rows } = await db.query(`
    SELECT id, make, model, year_start, year_end, extracted_data, confidence
    FROM comment_library_extractions
    WHERE extraction_type = 'option_code' AND (promoted IS NOT true)
    ORDER BY confidence DESC
  `);
  if (rows.length === 0) { console.log('  No pending option codes.'); return 0; }

  let promoted = 0, skipped = 0;
  for (const row of rows) {
    const data = row.extracted_data;
    const code = data.code;
    if (!code) { skipped++; continue; }

    // vintage_rpo_codes uses: rpo_code, makes (array), first_year, last_year
    const existing = await db.query(
      `SELECT id FROM vintage_rpo_codes WHERE rpo_code = $1 AND $2 = ANY(makes) LIMIT 1`,
      [code, row.make]
    );
    if (existing.rows.length > 0) {
      if (!dryRun) await db.query(`UPDATE comment_library_extractions SET promoted = true WHERE id = $1`, [row.id]);
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`    [DRY] ${row.make} ${code}: ${data.description?.slice(0, 60)}`);
    } else {
      const safeInt = (v) => v != null ? Math.round(Number(v)) || null : null;
      const safeNum = (v) => v != null ? Number(v) || null : null;
      await db.query(`
        INSERT INTO vintage_rpo_codes
          (rpo_code, category, description, makes, first_year, last_year, rarity, price_impact,
           displacement_ci, displacement_liters, horsepower, torque, notes, manufacturer)
        VALUES ($1, $2, $3, $4::text[], $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `, [
        code, data.category, data.description, [row.make],
        safeInt(row.year_start), safeInt(row.year_end), data.rarity, data.price_impact,
        safeInt(data.specs?.displacement_ci), safeNum(data.specs?.displacement_liters),
        safeInt(data.specs?.horsepower), safeInt(data.specs?.torque),
        data.notes, row.make,
      ]);
      await db.query(`UPDATE comment_library_extractions SET promoted = true WHERE id = $1`, [row.id]);
    }
    promoted++;
  }
  console.log(`  option_codes: ${promoted} promoted, ${skipped} skipped (${rows.length} total)`);
  return promoted;
}

async function promotePaintCodes(db, dryRun) {
  const { rows } = await db.query(`
    SELECT id, make, model, year_start, year_end, extracted_data, confidence
    FROM comment_library_extractions
    WHERE extraction_type = 'paint_code' AND (promoted IS NOT true)
    ORDER BY confidence DESC
  `);
  if (rows.length === 0) { console.log('  No pending paint codes.'); return 0; }

  let promoted = 0, skipped = 0;
  for (const row of rows) {
    const data = row.extracted_data;
    const code = data.code;
    if (!code) { skipped++; continue; }

    const existing = await db.query(
      `SELECT id FROM paint_codes WHERE code = $1 AND make = $2 LIMIT 1`,
      [code, row.make]
    );
    if (existing.rows.length > 0) {
      if (!dryRun) await db.query(`UPDATE comment_library_extractions SET promoted = true WHERE id = $1`, [row.id]);
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`    [DRY] ${row.make} ${code}: ${data.name}`);
    } else {
      // paint_codes unique constraint: (make, code, year_start)
      const safeInt = (v) => v != null ? Math.round(Number(v)) || null : null;
      await db.query(`
        INSERT INTO paint_codes (code, make, name, color_family, year_start, year_end, source)
        VALUES ($1, $2, $3, $4, $5, $6, 'bat_comments')
        ON CONFLICT (make, code, year_start) DO NOTHING
      `, [code, row.make, data.name, data.color_family, safeInt(row.year_start), safeInt(row.year_end)]);
      await db.query(`UPDATE comment_library_extractions SET promoted = true WHERE id = $1`, [row.id]);
    }
    promoted++;
  }
  console.log(`  paint_codes: ${promoted} promoted, ${skipped} skipped (${rows.length} total)`);
  return promoted;
}

async function promoteTrimPackages(db, dryRun) {
  const { rows } = await db.query(`
    SELECT id, make, model, year_start, year_end, extracted_data, confidence
    FROM comment_library_extractions
    WHERE extraction_type = 'trim_package' AND (promoted IS NOT true)
    ORDER BY confidence DESC
  `);
  if (rows.length === 0) { console.log('  No pending trim packages.'); return 0; }

  let promoted = 0, skipped = 0;
  for (const row of rows) {
    const data = row.extracted_data;
    const name = data.name;
    if (!name) { skipped++; continue; }

    // oem_trim_levels uses: model_family (not model), trim_name (not name)
    // unique constraint: (make, model_family, trim_name, ...)
    const existing = await db.query(
      `SELECT id FROM oem_trim_levels WHERE trim_name = $1 AND make = $2 AND model_family = $3 LIMIT 1`,
      [name, row.make, row.model]
    );
    if (existing.rows.length > 0) {
      if (!dryRun) await db.query(`UPDATE comment_library_extractions SET promoted = true WHERE id = $1`, [row.id]);
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`    [DRY] ${row.make} ${row.model} — ${name}`);
    } else {
      const safeInt = (v) => v != null ? Math.round(Number(v)) || null : null;
      await db.query(`
        INSERT INTO oem_trim_levels (make, model_family, trim_name, trim_code, standard_features, year_start, year_end)
        VALUES ($1, $2, $3, $4, $5::text[], $6, $7)
        ON CONFLICT DO NOTHING
      `, [row.make, row.model, name, data.code, data.standard_features || [], safeInt(row.year_start), safeInt(row.year_end)]);
      await db.query(`UPDATE comment_library_extractions SET promoted = true WHERE id = $1`, [row.id]);
    }
    promoted++;
  }
  console.log(`  trim_packages: ${promoted} promoted, ${skipped} skipped (${rows.length} total)`);
  return promoted;
}

async function markNonPromotable(db, dryRun) {
  // engine_specs, transmission_specs, production_facts, known_issues stay in staging
  // but mark them as "reviewed" so we don't re-process
  if (dryRun) return 0;
  const { rowCount } = await db.query(`
    UPDATE comment_library_extractions SET promoted = true
    WHERE extraction_type IN ('engine_spec', 'transmission_spec', 'production_fact', 'known_issue')
      AND promoted IS NOT true
  `);
  console.log(`  non-promotable types: ${rowCount} marked as reviewed`);
  return rowCount;
}

// ─── Main ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const statsOnly = args.includes('--stats');

async function main() {
  const db = await getDb();

  if (statsOnly) {
    await showStats(db);
    await db.end();
    return;
  }

  console.log(`\n=== Library Promotion ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  let total = 0;
  total += await promoteOptionCodes(db, dryRun);
  total += await promotePaintCodes(db, dryRun);
  total += await promoteTrimPackages(db, dryRun);
  total += await markNonPromotable(db, dryRun);

  console.log(`\nTotal promoted: ${total}`);
  await db.end();
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
