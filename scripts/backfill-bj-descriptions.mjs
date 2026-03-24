#!/usr/bin/env node
/**
 * Backfill Barrett-Jackson vehicle descriptions from archived markdown snapshots.
 *
 * Barrett-Jackson snapshots have markdown with this structure:
 *   Description
 *   ## Summary
 *   <short summary text>
 *   ## Details
 *   <full prose description>
 *   ## Summary (duplicate)
 *   ...
 *   ### Financing
 *
 * This script:
 *  1. Finds BJ vehicles missing descriptions
 *  2. Matches them to snapshots via listing_url (direct) or vehicle_events.source_url
 *  3. Extracts description prose from the markdown
 *  4. Updates vehicles.description in 1000-row batches with pg_sleep(0.2)
 *
 * Usage: dotenvx run -- node scripts/backfill-bj-descriptions.mjs [--dry-run]
 */

import pg from 'pg';
const { Pool } = pg;

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 1000;
const SLEEP_MS = 200;

const pool = new Pool({
  host: 'aws-0-us-west-1.pooler.supabase.com',
  port: 6543,
  user: 'postgres.qkgaybvrernstplzjaam',
  password: process.env.DB_PASSWORD || 'RbzKq32A0uhqvJMQ',
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
  max: 3,
  statement_timeout: 60000,
});

/**
 * Extract description from BJ markdown.
 * Looks for the Description > Summary > Details pattern.
 * Returns { summary, details } or null.
 */
function extractDescription(markdown) {
  if (!markdown) return null;

  // Normalize: collapse runs of spaces (BJ markdown has massive trailing whitespace)
  const cleaned = markdown.replace(/[ \t]+\n/g, '\n');

  // Pattern: "Description\n\n## Summary\n\n<text>\n\n## Details\n\n<text>"
  // The Description section may appear multiple times (tab content duplication)
  // We want the first occurrence.

  const descIdx = cleaned.indexOf('Description\n');
  if (descIdx === -1) return null;

  const afterDesc = cleaned.substring(descIdx);

  // Extract Summary (first one after Description header)
  const summaryMatch = afterDesc.match(/## Summary\s*\n+([^\n#][^\n]*(?:\n[^\n#][^\n]*)*)/);
  const summary = summaryMatch ? summaryMatch[1].trim() : null;

  // Extract Details prose (first one after Description > Summary)
  const detailsMatch = afterDesc.match(/## Details\s*\n+([^\n#][^\n]*(?:\n[^\n#][^\n]*)*)/);
  const details = detailsMatch ? detailsMatch[1].trim() : null;

  if (!details && !summary) return null;

  // Some Details sections might be just structured fields (Year, Make, etc.)
  // Check if the details looks like prose (contains sentences) vs structured fields
  if (details) {
    // Structured fields look like: "1970 Year\nPLYMOUTH Make\n..."
    const looksStructured = /^\d{4}\s+Year\b/.test(details);
    if (looksStructured) {
      // No prose details, use summary only
      return summary ? { summary, details: null, combined: summary } : null;
    }
  }

  // Combine: details is the primary content, summary is the short version
  // Use details if available (it's the full prose), otherwise summary
  const combined = details || summary;
  return { summary, details, combined };
}

/**
 * Decode HTML entities commonly found in BJ markdown
 */
function decodeEntities(text) {
  if (!text) return text;
  return text
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

async function checkLockImpact() {
  const res = await pool.query(
    "SELECT count(*) as cnt FROM pg_stat_activity WHERE wait_event_type='Lock'"
  );
  const lockCount = parseInt(res.rows[0].cnt, 10);
  if (lockCount > 0) {
    console.warn(`  WARNING: ${lockCount} sessions waiting on locks. Pausing...`);
    await new Promise(r => setTimeout(r, 2000));
    return true;
  }
  return false;
}

async function getGap() {
  const res = await pool.query(`
    SELECT count(*) as cnt FROM vehicles
    WHERE source IN ('barrett-jackson','barrettjackson')
    AND (description IS NULL OR length(description) < 50)
  `);
  return parseInt(res.rows[0].cnt, 10);
}

async function getMatchCounts() {
  // Count how many we can match via each path
  const res = await pool.query(`
    SELECT
      (SELECT count(DISTINCT v.id)
       FROM vehicles v
       JOIN listing_page_snapshots lps
         ON replace(lps.listing_url, 'https://www.', 'https://') = replace(v.listing_url, 'https://www.', 'https://')
       WHERE v.source IN ('barrett-jackson','barrettjackson')
       AND lps.platform = 'barrett-jackson'
       AND lps.markdown IS NOT NULL
       AND (v.description IS NULL OR length(v.description) < 50)
      ) as direct_match,
      (SELECT count(DISTINCT v.id)
       FROM vehicles v
       JOIN vehicle_events ve ON ve.vehicle_id = v.id
       JOIN listing_page_snapshots lps
         ON replace(lps.listing_url, 'https://www.', 'https://') = replace(ve.source_url, 'https://www.', 'https://')
       WHERE v.source IN ('barrett-jackson','barrettjackson')
       AND ve.source_platform IN ('barrett-jackson','barrettjackson')
       AND lps.platform = 'barrett-jackson'
       AND lps.markdown IS NOT NULL
       AND (v.description IS NULL OR length(v.description) < 50)
      ) as events_match
  `);
  return res.rows[0];
}

async function fetchBatch(offset) {
  // Fetch vehicles + their matched snapshot markdown in one query
  // Prioritize direct listing_url match, fallback to vehicle_events match
  const res = await pool.query(`
    WITH candidates AS (
      -- Path 1: direct listing_url match
      SELECT DISTINCT ON (v.id)
        v.id as vehicle_id,
        lps.markdown,
        lps.listing_url as snapshot_url,
        'direct' as match_type
      FROM vehicles v
      JOIN listing_page_snapshots lps
        ON replace(lps.listing_url, 'https://www.', 'https://') = replace(v.listing_url, 'https://www.', 'https://')
      WHERE v.source IN ('barrett-jackson','barrettjackson')
      AND lps.platform = 'barrett-jackson'
      AND lps.markdown IS NOT NULL
      AND (v.description IS NULL OR length(v.description) < 50)
      AND v.listing_url LIKE '%barrett%'

      UNION

      -- Path 2: vehicle_events.source_url match
      SELECT DISTINCT ON (v.id)
        v.id as vehicle_id,
        lps.markdown,
        lps.listing_url as snapshot_url,
        'events' as match_type
      FROM vehicles v
      JOIN vehicle_events ve ON ve.vehicle_id = v.id
      JOIN listing_page_snapshots lps
        ON replace(lps.listing_url, 'https://www.', 'https://') = replace(ve.source_url, 'https://www.', 'https://')
      WHERE v.source IN ('barrett-jackson','barrettjackson')
      AND ve.source_platform IN ('barrett-jackson','barrettjackson')
      AND lps.platform = 'barrett-jackson'
      AND lps.markdown IS NOT NULL
      AND (v.description IS NULL OR length(v.description) < 50)
      AND (v.listing_url IS NULL OR v.listing_url NOT LIKE '%barrett%')
    )
    SELECT DISTINCT ON (vehicle_id) vehicle_id, markdown, snapshot_url, match_type
    FROM candidates
    ORDER BY vehicle_id, match_type  -- prefer 'direct' over 'events'
    LIMIT $1 OFFSET $2
  `, [BATCH_SIZE, offset]);

  return res.rows;
}

async function updateDescriptions(updates) {
  if (updates.length === 0) return 0;
  if (DRY_RUN) return updates.length;

  // Build a VALUES list for bulk update
  const values = [];
  const params = [];
  let paramIdx = 1;

  for (const { vehicleId, description } of updates) {
    values.push(`($${paramIdx}::uuid, $${paramIdx + 1}::text)`);
    params.push(vehicleId, description);
    paramIdx += 2;
  }

  const query = `
    UPDATE vehicles v
    SET description = batch.new_description,
        updated_at = now()
    FROM (VALUES ${values.join(',')}) AS batch(id, new_description)
    WHERE v.id = batch.id::uuid
  `;

  const res = await pool.query(query, params);
  return res.rowCount;
}

async function main() {
  console.log('=== Barrett-Jackson Description Backfill ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Sleep between batches: ${SLEEP_MS}ms\n`);

  const gap = await getGap();
  console.log(`BJ vehicles missing descriptions: ${gap.toLocaleString()}`);

  const counts = await getMatchCounts();
  console.log(`Matchable via listing_url: ${parseInt(counts.direct_match).toLocaleString()}`);
  console.log(`Matchable via vehicle_events: ${parseInt(counts.events_match).toLocaleString()}`);
  console.log('');

  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalNoDescription = 0;
  let batchNum = 0;
  const startTime = Date.now();

  // In live mode, updated vehicles drop out of the result set so offset=0 works.
  // In dry-run mode, use offset pagination since nothing gets updated.
  let offset = 0;
  while (true) {
    batchNum++;
    const rows = await fetchBatch(DRY_RUN ? offset : 0);

    if (rows.length === 0) {
      console.log('\nNo more matchable vehicles. Done.');
      break;
    }

    const updates = [];
    let batchSkipped = 0;
    let batchNoDesc = 0;

    for (const row of rows) {
      const extracted = extractDescription(row.markdown);
      if (!extracted || !extracted.combined || extracted.combined.length < 50) {
        batchNoDesc++;
        continue;
      }

      const description = decodeEntities(extracted.combined);

      // Sanity check: skip if it looks like boilerplate or garbage
      if (description.includes('Get Pre-Approved') ||
          description.includes('Monthly payment of') ||
          description.includes('Register to View Price')) {
        batchSkipped++;
        continue;
      }

      updates.push({ vehicleId: row.vehicle_id, description });
    }

    // Show samples on first batch
    if (batchNum === 1 && updates.length > 0) {
      console.log('\n--- Sample extracted descriptions ---');
      for (const u of updates.slice(0, 3)) {
        const preview = u.description.length > 200 ? u.description.substring(0, 200) + '...' : u.description;
        console.log(`  [${u.vehicleId.substring(0, 8)}] (${u.description.length} chars) ${preview}`);
      }
      console.log('---\n');
    }

    const updated = await updateDescriptions(updates);
    totalUpdated += updated;
    totalSkipped += batchSkipped;
    totalNoDescription += batchNoDesc;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const rate = totalUpdated > 0 ? (totalUpdated / ((Date.now() - startTime) / 1000)).toFixed(0) : '0';
    console.log(
      `Batch ${batchNum}: +${updated} updated | ${batchNoDesc} no desc | ${batchSkipped} skipped | total: ${totalUpdated.toLocaleString()} | ${elapsed}s | ~${rate}/s`
    );

    // Check for lock impact after each batch
    await checkLockImpact();

    // Advance offset for dry-run pagination
    if (DRY_RUN) offset += BATCH_SIZE;

    // Pause between batches
    if (rows.length === BATCH_SIZE) {
      await new Promise(r => setTimeout(r, SLEEP_MS));
    }

    // Safety: if we got rows but no updates in live mode, advance offset to skip un-extractable rows
    if (!DRY_RUN && updates.length === 0 && rows.length > 0) {
      console.log(`  All ${rows.length} rows in batch had no extractable description. Stopping.`);
      break;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n=== Summary ===');
  console.log(`Total updated: ${totalUpdated.toLocaleString()}`);
  console.log(`Total skipped (boilerplate): ${totalSkipped.toLocaleString()}`);
  console.log(`Total no description found: ${totalNoDescription.toLocaleString()}`);
  console.log(`Time: ${elapsed}s`);

  const finalGap = await getGap();
  console.log(`\nRemaining BJ vehicles without descriptions: ${finalGap.toLocaleString()}`);
  console.log(`Gap reduced by: ${(gap - finalGap).toLocaleString()}`);

  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  pool.end();
  process.exit(1);
});
