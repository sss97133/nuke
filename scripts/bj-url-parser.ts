#!/usr/bin/env npx tsx
/**
 * Barrett-Jackson URL Parser
 *
 * Extracts year/make/model from URL slugs WITHOUT visiting the pages.
 * Cloudflare blocks all browser access, so we parse what we can from URLs.
 *
 * URL pattern: /barrett-jackson.com/{event}/docket/vehicle/{year}-{make}-{model}-...-{bj_id}
 *
 * Usage:
 *   dotenvx run -- npx tsx scripts/bj-url-parser.ts
 *   dotenvx run -- npx tsx scripts/bj-url-parser.ts --batch-size 500 --dry-run
 */

import pg from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD!;
const DATABASE_URL = `postgresql://postgres.qkgaybvrernstplzjaam:${DB_PASSWORD}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`;

const args = process.argv.slice(2);
function getArg(name: string, defaultVal: number): number {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return parseInt(args[idx + 1], 10);
  return defaultVal;
}
const DRY_RUN = args.includes('--dry-run');
const BATCH_SIZE = getArg('batch-size', 500);

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] [BJ-URL] ${msg}`);
}

// Comprehensive make dictionary — longest match first
const KNOWN_MAKES: [string, string][] = [
  // Multi-word makes (must check first)
  ['alfa-romeo', 'Alfa Romeo'],
  ['aston-martin', 'Aston Martin'],
  ['austin-healey', 'Austin-Healey'],
  ['de-tomaso', 'De Tomaso'],
  ['de-dion-bouton', 'De Dion-Bouton'],
  ['facel-vega', 'Facel Vega'],
  ['gordon-keeble', 'Gordon-Keeble'],
  ['hispano-suiza', 'Hispano-Suiza'],
  ['iso-grifo', 'Iso'],
  ['iso-rivolta', 'Iso'],
  ['jensen-healey', 'Jensen-Healey'],
  ['land-rover', 'Land Rover'],
  ['mercedes-benz', 'Mercedes-Benz'],
  ['mg-td', 'MG'],
  ['mg-tc', 'MG'],
  ['mg-tf', 'MG'],
  ['mg-ta', 'MG'],
  ['mg-tb', 'MG'],
  ['mg-a', 'MG'],
  ['mg-b', 'MG'],
  ['mg-midget', 'MG'],
  ['pierce-arrow', 'Pierce-Arrow'],
  ['rolls-royce', 'Rolls-Royce'],
  ['shelby-cobra', 'Shelby'],
  ['brough-superior', 'Brough Superior'],
  ['harley-davidson', 'Harley-Davidson'],
  ['indian-motorcycle', 'Indian'],
  ['mv-agusta', 'MV Agusta'],
  ['am-general', 'AM General'],
  ['checker-marathon', 'Checker'],
  ['avanti-ii', 'Avanti'],
  ['range-rover', 'Land Rover'],
  ['can-am', 'Can-Am'],
  ['sea-doo', 'Sea-Doo'],

  // Single-word makes
  ['ac', 'AC'],
  ['acura', 'Acura'],
  ['alfa', 'Alfa Romeo'],
  ['allard', 'Allard'],
  ['amc', 'AMC'],
  ['amphicar', 'Amphicar'],
  ['ariel', 'Ariel'],
  ['auburn', 'Auburn'],
  ['audi', 'Audi'],
  ['austin', 'Austin'],
  ['autobianchi', 'Autobianchi'],
  ['avanti', 'Avanti'],
  ['bentley', 'Bentley'],
  ['bizzarrini', 'Bizzarrini'],
  ['bmw', 'BMW'],
  ['bricklin', 'Bricklin'],
  ['buick', 'Buick'],
  ['bugatti', 'Bugatti'],
  ['cadillac', 'Cadillac'],
  ['chevrolet', 'Chevrolet'],
  ['chevy', 'Chevrolet'],
  ['chrysler', 'Chrysler'],
  ['citroen', 'Citroen'],
  ['cobra', 'Shelby'],
  ['cord', 'Cord'],
  ['corvette', 'Chevrolet'],
  ['datsun', 'Datsun'],
  ['delage', 'Delage'],
  ['delahaye', 'Delahaye'],
  ['delorean', 'DeLorean'],
  ['desoto', 'DeSoto'],
  ['dodge', 'Dodge'],
  ['ducati', 'Ducati'],
  ['duesenberg', 'Duesenberg'],
  ['edsel', 'Edsel'],
  ['excalibur', 'Excalibur'],
  ['ferrari', 'Ferrari'],
  ['fiat', 'Fiat'],
  ['ford', 'Ford'],
  ['franklin', 'Franklin'],
  ['gmc', 'GMC'],
  ['honda', 'Honda'],
  ['hudson', 'Hudson'],
  ['hummer', 'Hummer'],
  ['imperial', 'Imperial'],
  ['infiniti', 'Infiniti'],
  ['international', 'International'],
  ['iso', 'Iso'],
  ['jaguar', 'Jaguar'],
  ['jeep', 'Jeep'],
  ['jensen', 'Jensen'],
  ['kaiser', 'Kaiser'],
  ['kawasaki', 'Kawasaki'],
  ['lamborghini', 'Lamborghini'],
  ['lancia', 'Lancia'],
  ['lexus', 'Lexus'],
  ['lincoln', 'Lincoln'],
  ['lotus', 'Lotus'],
  ['maserati', 'Maserati'],
  ['mazda', 'Mazda'],
  ['mclaren', 'McLaren'],
  ['mercury', 'Mercury'],
  ['mg', 'MG'],
  ['mini', 'Mini'],
  ['mitsubishi', 'Mitsubishi'],
  ['morgan', 'Morgan'],
  ['morris', 'Morris'],
  ['nash', 'Nash'],
  ['nissan', 'Nissan'],
  ['norton', 'Norton'],
  ['oldsmobile', 'Oldsmobile'],
  ['opel', 'Opel'],
  ['packard', 'Packard'],
  ['pantera', 'De Tomaso'],
  ['panoz', 'Panoz'],
  ['peugeot', 'Peugeot'],
  ['plymouth', 'Plymouth'],
  ['pontiac', 'Pontiac'],
  ['porsche', 'Porsche'],
  ['ram', 'Ram'],
  ['renault', 'Renault'],
  ['rover', 'Rover'],
  ['saab', 'Saab'],
  ['saturn', 'Saturn'],
  ['scion', 'Scion'],
  ['shelby', 'Shelby'],
  ['studebaker', 'Studebaker'],
  ['stutz', 'Stutz'],
  ['subaru', 'Subaru'],
  ['sunbeam', 'Sunbeam'],
  ['suzuki', 'Suzuki'],
  ['tesla', 'Tesla'],
  ['toyota', 'Toyota'],
  ['triumph', 'Triumph'],
  ['tucker', 'Tucker'],
  ['tvr', 'TVR'],
  ['volkswagen', 'Volkswagen'],
  ['volvo', 'Volvo'],
  ['willys', 'Willys'],
  ['yamaha', 'Yamaha'],
];

// Sort by slug length descending so multi-word makes match first
KNOWN_MAKES.sort((a, b) => b[0].length - a[0].length);

interface ParsedBJUrl {
  year: number | null;
  make: string | null;
  model: string | null;
  event: string;
  bjId: string | null;
  title: string;
}

function parseBJUrl(url: string): ParsedBJUrl | null {
  const match = url.match(/barrett-jackson\.com\/([^/]+)\/docket\/vehicle\/(.+)$/);
  if (!match) return null;

  const event = match[1];
  const slug = match[2];

  // Extract BJ numeric ID from end of slug
  const idMatch = slug.match(/-(\d{4,})$/);
  const bjId = idMatch ? idMatch[1] : null;

  // Remove the BJ ID from slug for parsing
  const cleanSlug = bjId ? slug.replace(/-\d{4,}$/, '') : slug;

  // Try to extract year (4-digit number at or near start)
  let year: number | null = null;
  let remainder = cleanSlug;

  // Pattern 1: slug starts with year
  const yearStartMatch = cleanSlug.match(/^(\d{4})-(.+)/);
  if (yearStartMatch) {
    const y = parseInt(yearStartMatch[1]);
    if (y >= 1880 && y <= 2030) {
      year = y;
      remainder = yearStartMatch[2];
    }
  }

  // Pattern 2: celebrity/prefix before year (e.g., "wayne-newtons-1999-...")
  if (!year) {
    const yearMidMatch = cleanSlug.match(/^(.+?)-(\d{4})-(.+)/);
    if (yearMidMatch) {
      const y = parseInt(yearMidMatch[2]);
      if (y >= 1880 && y <= 2030) {
        year = y;
        remainder = yearMidMatch[3];
      }
    }
  }

  // Pattern 3: "0-" prefix for items without year
  if (cleanSlug.startsWith('0-')) {
    year = null;
    remainder = cleanSlug.slice(2);
  }

  // Parse make from remainder
  let make: string | null = null;
  let model: string | null = null;

  for (const [slugMake, displayMake] of KNOWN_MAKES) {
    if (remainder.startsWith(slugMake + '-') || remainder === slugMake) {
      make = displayMake;
      remainder = remainder.slice(slugMake.length).replace(/^-/, '');
      break;
    }
  }

  // If no known make matched, take the first word
  if (!make && remainder) {
    const firstDash = remainder.indexOf('-');
    if (firstDash > 0) {
      make = remainder.slice(0, firstDash);
      make = make.charAt(0).toUpperCase() + make.slice(1);
      remainder = remainder.slice(firstDash + 1);
    } else {
      make = remainder.charAt(0).toUpperCase() + remainder.slice(1);
      remainder = '';
    }
  }

  // Model is the rest, cleaned up
  if (remainder) {
    model = remainder
      .replace(/-/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  }

  // Construct a title
  const parts = [year, make, model].filter(Boolean);
  const title = parts.join(' ') || slug;

  return { year, make, model, event, bjId, title };
}

function parseEventInfo(event: string): { location: string | null; auctionYear: number | null } {
  // Pattern: "{location}-{year}" or "{location}-{season}-{year}"
  const yearMatch = event.match(/-(\d{4})$/);
  const auctionYear = yearMatch ? parseInt(yearMatch[1]) : null;
  const location = event.replace(/-\d{4}$/, '').replace(/-/g, ' ');
  return { location: location || null, auctionYear };
}

async function main() {
  console.log('='.repeat(50));
  console.log('  BARRETT-JACKSON URL PARSER');
  console.log(`  Batch: ${BATCH_SIZE} | Dry run: ${DRY_RUN}`);
  console.log('='.repeat(50));

  const client = await pool.connect();

  // Count pending items
  const countRes = await client.query(
    `SELECT COUNT(*) FROM import_queue WHERE status='pending' AND source_id='23b5bd94-bbe3-441e-8688-3ab1aec30680'`
  );
  const pendingCount = parseInt(countRes.rows[0].count);
  log(`Pending BJ URLs: ${pendingCount}`);

  if (pendingCount === 0) {
    log('Nothing to do');
    client.release();
    await pool.end();
    return;
  }

  let totalProcessed = 0;
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  while (true) {
    // Claim a batch
    const batchRes = await client.query(`
      WITH candidates AS (
        SELECT id, listing_url FROM import_queue
        WHERE status = 'pending'
          AND source_id = '23b5bd94-bbe3-441e-8688-3ab1aec30680'
        ORDER BY created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      ),
      claimed AS (
        UPDATE import_queue iq
        SET status = 'processing',
            attempts = COALESCE(iq.attempts, 0) + 1,
            locked_at = NOW(),
            locked_by = 'bj-url-parser'
        FROM candidates c
        WHERE iq.id = c.id
        RETURNING iq.id, iq.listing_url
      )
      SELECT * FROM claimed
    `, [BATCH_SIZE]);

    if (batchRes.rows.length === 0) {
      log('No more pending items');
      break;
    }

    log(`Claimed ${batchRes.rows.length} items`);

    if (DRY_RUN) {
      for (const item of batchRes.rows) {
        const parsed = parseBJUrl(item.listing_url);
        if (parsed) {
          log(`  DRY: ${parsed.year || '?'} ${parsed.make || '?'} ${parsed.model?.slice(0, 40) || '?'} [${parsed.event}]`);
        }
        totalProcessed++;
      }
      continue;
    }

    // Parse all URLs in this batch
    const parsedItems: { id: string; url: string; parsed: ParsedBJUrl }[] = [];
    const skipIds: string[] = [];

    for (const item of batchRes.rows) {
      const parsed = parseBJUrl(item.listing_url);
      if (!parsed || (!parsed.year && !parsed.make)) {
        skipIds.push(item.id);
        totalSkipped++;
      } else {
        parsedItems.push({ id: item.id, url: item.listing_url, parsed });
      }
    }

    // Mark skipped items
    if (skipIds.length > 0) {
      await client.query(
        `UPDATE import_queue SET status='skipped', error_message='Unparseable URL slug' WHERE id = ANY($1)`,
        [skipIds]
      );
    }

    if (parsedItems.length === 0) {
      totalProcessed += batchRes.rows.length;
      continue;
    }

    // Check which URLs already have vehicles
    const urls = parsedItems.map(p => p.url);
    const existingRes = await client.query(
      `SELECT id, discovery_url FROM vehicles WHERE discovery_url = ANY($1)`,
      [urls]
    );
    const existingMap = new Map<string, string>();
    for (const row of existingRes.rows) {
      existingMap.set(row.discovery_url, row.id);
    }

    // Batch insert new vehicles
    const newItems = parsedItems.filter(p => !existingMap.has(p.url));
    const updateItems = parsedItems.filter(p => existingMap.has(p.url));

    if (newItems.length > 0) {
      // Build batch INSERT with VALUES
      const values: any[] = [];
      const placeholders: string[] = [];
      for (let i = 0; i < newItems.length; i++) {
        const p = newItems[i].parsed;
        const { location, auctionYear } = parseEventInfo(p.event);
        const offset = i * 9;
        placeholders.push(`($${offset+1},$${offset+2},$${offset+3},$${offset+4},$${offset+5},$${offset+6},$${offset+7},$${offset+8},$${offset+9})`);
        values.push(
          p.title.slice(0, 200),
          p.year,
          p.make,
          p.model?.slice(0, 100) || null,
          'barrett-jackson',
          newItems[i].url,
          'active',
          true,
          JSON.stringify({
            source: 'bj_url_parser',
            bj_lot_id: p.bjId,
            event: p.event,
            event_location: location,
            event_year: auctionYear,
            imported_at: new Date().toISOString(),
          }),
        );
      }

      try {
        const insertRes = await client.query(
          `INSERT INTO vehicles (title, year, make, model, discovery_source, discovery_url, status, is_public, origin_metadata)
           VALUES ${placeholders.join(',')}
           RETURNING id, discovery_url`,
          values
        );

        // Map inserted vehicles back to queue items
        const insertedMap = new Map<string, string>();
        for (const row of insertRes.rows) {
          insertedMap.set(row.discovery_url, row.id);
        }

        // Mark queue items complete
        const completeIds: string[] = [];
        const completeVehicleIds: string[] = [];
        for (const item of newItems) {
          const vehicleId = insertedMap.get(item.url);
          if (vehicleId) {
            completeIds.push(item.id);
            completeVehicleIds.push(vehicleId);
            totalCreated++;
          } else {
            // ON CONFLICT hit — already existed
            totalUpdated++;
            completeIds.push(item.id);
            completeVehicleIds.push(''); // Will need to look up
          }
        }

        // Batch update queue items
        if (completeIds.length > 0) {
          await client.query(
            `UPDATE import_queue SET status='complete', processed_at=NOW(), locked_at=NULL, locked_by=NULL WHERE id = ANY($1)`,
            [completeIds]
          );
        }
      } catch (err: any) {
        totalFailed += newItems.length;
        log(`  BATCH INSERT FAIL: ${err.message?.slice(0, 120)}`);
        // Mark all as failed
        await client.query(
          `UPDATE import_queue SET status='failed', error_message=$1, locked_at=NULL, locked_by=NULL WHERE id = ANY($2)`,
          [err.message?.slice(0, 500) || 'batch insert error', newItems.map(i => i.id)]
        ).catch(() => {});
      }
    }

    // Handle updates for existing vehicles
    if (updateItems.length > 0) {
      // Just mark queue items complete — vehicles already exist
      const updateQueueIds = updateItems.map(i => i.id);
      await client.query(
        `UPDATE import_queue SET status='complete', processed_at=NOW(), locked_at=NULL, locked_by=NULL WHERE id = ANY($1)`,
        [updateQueueIds]
      );
      totalUpdated += updateItems.length;
    }

    totalProcessed += batchRes.rows.length;
    log(`Progress: ${totalProcessed}/${pendingCount} (created=${totalCreated} updated=${totalUpdated} skipped=${totalSkipped} failed=${totalFailed})`);
  }

  client.release();
  await pool.end();

  console.log('\n' + '='.repeat(50));
  console.log('  BJ URL PARSER COMPLETE');
  console.log('='.repeat(50));
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`  Created:  ${totalCreated}`);
  console.log(`  Updated:  ${totalUpdated}`);
  console.log(`  Skipped:  ${totalSkipped}`);
  console.log(`  Failed:   ${totalFailed}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
