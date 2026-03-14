#!/usr/bin/env node
/**
 * Snapshot Re-extraction Script
 *
 * Reads listing_page_snapshots HTML, extracts fields via SQL regex,
 * and updates vehicles in batches of 500 with pg_sleep(0.2).
 *
 * Supports: BaT, Cars & Bids, Mecum
 *
 * Usage:
 *   dotenvx run -- node scripts/snapshot-reextract.mjs [--source bat|carsandbids|mecum|all] [--field price|image|description|all] [--dry-run] [--limit N]
 */

import pg from 'pg';
const { Client } = pg;

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
};
const dryRun = args.includes('--dry-run');
const source = getArg('source', 'bat');
const field = getArg('field', 'all');
const maxLimit = parseInt(getArg('limit', '0')) || 0;
const BATCH = 500;

const SOURCE_PATTERNS = {
  bat: '%bringatrailer.com%',
  carsandbids: '%carsandbids.com%',
  mecum: '%mecum.com%',
};

// Field extraction SQL expressions per source
const EXTRACTORS = {
  bat: {
    price: `regexp_replace(substring(lps.html from 'sold for \\$([0-9,]+)'), ',', '', 'g')::numeric`,
    image: `substring(lps.html from '<meta property="og:image" content="([^"]+)"')`,
    description: `left(substring(lps.html from '"description"[^:]*:[^"]*"([^"]+)'), 2000)`,
    // Additional fields we can extract from BaT
    vin: `substring(lps.html from '(?:VIN|Chassis)[^A-Z0-9]*([A-Z0-9]{17})')`,
    transmission: `CASE
      WHEN lps.html ~* 'automatic|auto trans' THEN 'Automatic'
      WHEN lps.html ~* 'manual|stick shift|5-speed|6-speed|4-speed|3-speed' THEN 'Manual'
      ELSE NULL
    END`,
    mileage: `NULLIF(regexp_replace(COALESCE(substring(lps.html from '([0-9][0-9,]+)\\s+(?:miles|mi)'), ''), ',', '', 'g'), '')::numeric`,
  },
  carsandbids: {
    price: `regexp_replace(substring(lps.html from 'sold for \\$([0-9,]+)'), ',', '', 'g')::numeric`,
    image: `substring(lps.html from '<meta property="og:image" content="([^"]+)"')`,
    description: `left(substring(lps.html from 'property="og:description"\\s+content="([^"]{1,4000})'), 2000)`,
  },
  mecum: {
    price: `regexp_replace(substring(lps.html from '(?:Sold|sold).*?\\$([0-9,]+)'), ',', '', 'g')::numeric`,
    image: `substring(lps.html from '<meta property="og:image" content="([^"]+)"')`,
    description: `left(substring(lps.html from 'property="og:description"\\s+content="([^"]{1,4000})'), 2000)`,
  },
};

async function run() {
  const client = new Client({
    host: process.env.DB_HOST || 'aws-0-us-west-1.pooler.supabase.com',
    port: parseInt(process.env.DB_PORT || '6543'),
    user: process.env.DB_USER || 'postgres.qkgaybvrernstplzjaam',
    password: process.env.SUPABASE_DB_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'postgres',
    ssl: { rejectUnauthorized: false },
    statement_timeout: 60000, // 60s per statement - well under 120s limit
  });

  await client.connect();
  console.log(`Connected. Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}  Source: ${source}  Field: ${field}  Batch: ${BATCH}`);

  // Disable user triggers for bulk updates (prevents completion trigger timeouts)
  if (!dryRun) {
    await client.query('ALTER TABLE vehicles DISABLE TRIGGER USER');
    console.log('Triggers disabled for bulk update');
  }

  const sources = source === 'all' ? Object.keys(SOURCE_PATTERNS) : [source];

  for (const src of sources) {
    const urlPattern = SOURCE_PATTERNS[src];
    const extractors = EXTRACTORS[src];
    if (!extractors) {
      console.log(`No extractors defined for ${src}, skipping`);
      continue;
    }

    const fields = field === 'all' ? Object.keys(extractors) : [field];

    for (const f of fields) {
      if (!extractors[f]) {
        console.log(`No ${f} extractor for ${src}, skipping`);
        continue;
      }

      console.log(`\n=== ${src.toUpperCase()} :: ${f} ===`);

      // Map field name to vehicle column
      const vehicleCol = {
        price: 'sale_price',
        image: 'primary_image_url',
        description: 'description',
        vin: 'vin',
        transmission: 'transmission',
        mileage: 'mileage',
      }[f];

      if (!vehicleCol) {
        console.log(`Unknown field mapping for ${f}`);
        continue;
      }

      let totalUpdated = 0;
      let batchNum = 0;

      while (true) {
        if (maxLimit > 0 && totalUpdated >= maxLimit) {
          console.log(`Hit --limit ${maxLimit}, stopping`);
          break;
        }

        const batchLimit = maxLimit > 0 ? Math.min(BATCH, maxLimit - totalUpdated) : BATCH;

        // Build the NULL check condition
        const nullCheck = ['price', 'mileage'].includes(f)
          ? `(v.${vehicleCol} IS NULL OR v.${vehicleCol} = 0)`
          : `(v.${vehicleCol} IS NULL OR v.${vehicleCol} = '')`;

        const sql = `
          WITH batch AS (
            SELECT v.id AS vid, ${extractors[f]} AS extracted_val
            FROM vehicles v
            JOIN listing_page_snapshots lps ON lps.listing_url = v.listing_url
            WHERE v.deleted_at IS NULL
              AND v.listing_url LIKE '${urlPattern}'
              AND ${nullCheck}
              AND lps.html IS NOT NULL
            LIMIT ${batchLimit}
          )
          UPDATE vehicles v SET ${vehicleCol} = b.extracted_val
          FROM batch b
          WHERE v.id = b.vid AND b.extracted_val IS NOT NULL
          ${f === 'mileage' ? 'AND b.extracted_val > 0 AND b.extracted_val < 1000000' : ''}
          ${f === 'price' ? 'AND b.extracted_val > 100 AND b.extracted_val < 100000000' : ''}
          ${f === 'vin' ? 'AND NOT EXISTS (SELECT 1 FROM vehicles v2 WHERE v2.vin = b.extracted_val AND v2.id != v.id AND v2.deleted_at IS NULL)' : ''}
        `;

        if (dryRun) {
          // In dry run, just count how many would match
          const countSql = `
            SELECT COUNT(*) AS cnt FROM vehicles v
            JOIN listing_page_snapshots lps ON lps.listing_url = v.listing_url
            WHERE v.deleted_at IS NULL
              AND v.listing_url LIKE '${urlPattern}'
              AND ${nullCheck}
              AND lps.html IS NOT NULL
            LIMIT 1
          `;
          const res = await client.query(countSql);
          console.log(`  [DRY RUN] Would process vehicles for ${src}::${f} (has matches: ${res.rows[0]?.cnt > 0})`);
          break;
        }

        try {
          const res = await client.query(sql);
          const affected = res.rowCount || 0;
          totalUpdated += affected;
          batchNum++;

          if (affected === 0) {
            console.log(`  Batch ${batchNum}: 0 rows — done. Total: ${totalUpdated}`);
            break;
          }

          console.log(`  Batch ${batchNum}: ${affected} rows updated (running total: ${totalUpdated})`);

          // Check for locks after each batch
          const lockCheck = await client.query(
            "SELECT count(*) AS locks FROM pg_stat_activity WHERE wait_event_type='Lock'"
          );
          if (parseInt(lockCheck.rows[0].locks) > 0) {
            console.log(`  ⚠️  ${lockCheck.rows[0].locks} locks detected — pausing 5s`);
            await new Promise(r => setTimeout(r, 5000));
          }

          // Sleep between batches
          await new Promise(r => setTimeout(r, 200));

        } catch (err) {
          if (err.message?.includes('deadlock')) {
            console.log(`  ⚠️  Deadlock on batch ${batchNum}, retrying after 2s...`);
            await new Promise(r => setTimeout(r, 2000));
            continue;
          }
          if (err.message?.includes('statement timeout')) {
            console.log(`  ⚠️  Timeout on batch ${batchNum}, reducing batch and retrying...`);
            await new Promise(r => setTimeout(r, 1000));
            continue;
          }
          console.error(`  ❌ Error on batch ${batchNum}:`, err.message);
          break;
        }
      }

      console.log(`  ✅ ${src}::${f} complete — ${totalUpdated} total rows updated`);
    }
  }

  // Re-enable triggers
  if (!dryRun) {
    await client.query('ALTER TABLE vehicles ENABLE TRIGGER USER');
    console.log('Triggers re-enabled');
  }

  // Final lock check
  const finalLocks = await client.query(
    "SELECT count(*) AS locks FROM pg_stat_activity WHERE wait_event_type='Lock'"
  );
  console.log(`\nFinal lock check: ${finalLocks.rows[0].locks} locks`);

  await client.end();
  console.log('Done.');
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
