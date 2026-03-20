#!/usr/bin/env node
/**
 * backfill-fb-saved-observations.mjs
 *
 * Backfills vehicle_observations + field_evidence for 485 FB Saved vehicles.
 * Creates:
 *   - 1 listing observation per vehicle (with structured_data from vehicle fields)
 *   - N media observations per vehicle image (from vehicle_images)
 *   - field_evidence rows for each non-null spec field (mileage, transmission, color, etc.)
 *
 * Usage: dotenvx run -- node scripts/backfill-fb-saved-observations.mjs [--dry-run]
 */

import pg from 'pg';
import crypto from 'crypto';

const { Pool } = pg;

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 50;
const SOURCE_SLUG = 'facebook-saved';
const SOURCE_TYPE = 'fb_marketplace_listing';
const SOURCE_CONFIDENCE = 55; // 0-100 scale for field_evidence

const pool = new Pool({
  host: 'aws-0-us-west-1.pooler.supabase.com',
  port: 6543,
  user: `postgres.${process.env.SUPABASE_PROJECT_ID || 'qkgaybvrernstplzjaam'}`,
  password: process.env.SUPABASE_DB_PASSWORD || 'RbzKq32A0uhqvJMQ',
  database: 'postgres',
  max: 3,
  statement_timeout: 60000,
});

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

async function getSourceId(client) {
  const { rows } = await client.query(
    `SELECT id FROM observation_sources WHERE slug = $1`,
    [SOURCE_SLUG]
  );
  if (!rows.length) throw new Error(`Source '${SOURCE_SLUG}' not found`);
  return rows[0].id;
}

async function getFBVehicles(client) {
  const { rows } = await client.query(`
    SELECT
      v.id, v.year, v.make, v.model, v.asking_price, v.sale_price,
      v.mileage, v.transmission, v.color, v.interior_color,
      v.city, v.state, v.listing_location,
      v.seller_name, v.discovery_url, v.status, v.is_for_sale,
      v.created_at, v.vin
    FROM vehicles v
    WHERE v.source = 'facebook-saved'
    ORDER BY v.created_at
  `);
  return rows;
}

async function getVehicleImages(client, vehicleIds) {
  const { rows } = await client.query(`
    SELECT id, vehicle_id, image_url, is_primary, source, created_at
    FROM vehicle_images
    WHERE vehicle_id = ANY($1)
    ORDER BY vehicle_id, is_primary DESC, created_at
  `, [vehicleIds]);
  // Group by vehicle_id
  const map = new Map();
  for (const img of rows) {
    if (!map.has(img.vehicle_id)) map.set(img.vehicle_id, []);
    map.get(img.vehicle_id).push(img);
  }
  return map;
}

function buildListingStructuredData(v) {
  const data = {};
  if (v.asking_price) data.price = v.asking_price;
  if (v.sale_price) data.sale_price = v.sale_price;
  if (v.year) data.year = v.year;
  if (v.make) data.make = v.make;
  if (v.model) data.model = v.model;
  if (v.mileage) data.mileage = v.mileage;
  if (v.transmission) data.transmission = v.transmission;
  if (v.color) data.color = v.color;
  if (v.interior_color) data.interior_color = v.interior_color;
  if (v.city) data.city = v.city;
  if (v.state) data.state = v.state;
  if (v.listing_location) data.location = v.listing_location;
  if (v.seller_name) data.seller_name = v.seller_name;
  if (v.vin) data.vin = v.vin;
  data.sold = v.status === 'sold';
  data.is_for_sale = v.is_for_sale;
  return data;
}

function buildContentText(v) {
  const parts = [v.year, v.make, v.model].filter(Boolean);
  if (v.asking_price) parts.push(`$${v.asking_price.toLocaleString()}`);
  if (v.listing_location) parts.push(v.listing_location);
  else if (v.city && v.state) parts.push(`${v.city}, ${v.state}`);
  if (v.status === 'sold') parts.push('[SOLD]');
  return parts.join(' ');
}

/** Extract spec fields that have evidence (non-null vehicle fields) */
function extractEvidenceFields(v) {
  const fields = [];
  if (v.asking_price) fields.push({ field_name: 'asking_price', value: String(v.asking_price), context: 'FB Marketplace listing price' });
  if (v.sale_price) fields.push({ field_name: 'sale_price', value: String(v.sale_price), context: 'FB Marketplace sold price' });
  if (v.mileage) fields.push({ field_name: 'mileage', value: String(v.mileage), context: 'Seller-reported mileage on FB listing' });
  if (v.transmission) fields.push({ field_name: 'transmission', value: v.transmission, context: 'Seller-reported transmission on FB listing' });
  if (v.color) fields.push({ field_name: 'color', value: v.color, context: 'Seller-reported exterior color on FB listing' });
  if (v.interior_color) fields.push({ field_name: 'interior_color', value: v.interior_color, context: 'Seller-reported interior color on FB listing' });
  if (v.year) fields.push({ field_name: 'year', value: String(v.year), context: 'Year from FB listing title' });
  if (v.make) fields.push({ field_name: 'make', value: v.make, context: 'Make from FB listing title' });
  if (v.model) fields.push({ field_name: 'model', value: v.model, context: 'Model from FB listing title' });
  if (v.seller_name) fields.push({ field_name: 'seller_name', value: v.seller_name, context: 'FB Marketplace seller profile name' });
  return fields;
}

async function insertListingObservations(client, vehicles, sourceId) {
  let inserted = 0;
  for (let i = 0; i < vehicles.length; i += BATCH_SIZE) {
    const batch = vehicles.slice(i, i + BATCH_SIZE);
    const values = [];
    const params = [];
    let paramIdx = 1;

    for (const v of batch) {
      const structuredData = buildListingStructuredData(v);
      const contentText = buildContentText(v);
      const contentHash = sha256(`${SOURCE_SLUG}:listing:${v.id}:${contentText}`);

      values.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
      params.push(
        v.id,                    // vehicle_id
        1.0,                     // vehicle_match_confidence (we own the match)
        v.created_at,            // observed_at
        sourceId,                // source_id
        v.discovery_url || null, // source_url
        `fb-saved-${v.id}`,     // source_identifier
        'listing',               // kind
        contentText,             // content_text
        contentHash,             // content_hash
        JSON.stringify(structuredData), // structured_data
      );
    }

    const sql = `
      INSERT INTO vehicle_observations
        (vehicle_id, vehicle_match_confidence, observed_at, source_id, source_url, source_identifier, kind, content_text, content_hash, structured_data)
      VALUES ${values.join(', ')}
      ON CONFLICT (source_id, source_identifier, kind, content_hash) DO NOTHING
    `;

    if (DRY_RUN) {
      inserted += batch.length;
    } else {
      const result = await client.query(sql, params);
      inserted += result.rowCount;
    }
    process.stdout.write(`\r  Listing observations: ${inserted}/${vehicles.length}`);
  }
  console.log();
  return inserted;
}

async function insertMediaObservations(client, imageMap, sourceId) {
  let inserted = 0;
  let total = 0;
  for (const images of imageMap.values()) total += images.length;

  let processed = 0;
  const allImages = [];
  for (const [vehicleId, images] of imageMap) {
    for (const img of images) {
      allImages.push({ ...img, vehicle_id: vehicleId });
    }
  }

  for (let i = 0; i < allImages.length; i += BATCH_SIZE) {
    const batch = allImages.slice(i, i + BATCH_SIZE);
    const values = [];
    const params = [];
    let paramIdx = 1;

    for (const img of batch) {
      const structuredData = {
        image_url: img.image_url,
        is_primary: img.is_primary,
        source: img.source || 'facebook-saved',
      };
      const contentHash = sha256(`${SOURCE_SLUG}:media:${img.id}:${img.image_url}`);

      values.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
      params.push(
        img.vehicle_id,         // vehicle_id
        1.0,                    // vehicle_match_confidence
        img.created_at,         // observed_at
        sourceId,               // source_id
        `fb-img-${img.id}`,    // source_identifier
        'media',                // kind
        contentHash,            // content_hash
        JSON.stringify(structuredData), // structured_data
      );
    }

    const sql = `
      INSERT INTO vehicle_observations
        (vehicle_id, vehicle_match_confidence, observed_at, source_id, source_identifier, kind, content_hash, structured_data)
      VALUES ${values.join(', ')}
      ON CONFLICT (source_id, source_identifier, kind, content_hash) DO NOTHING
    `;

    if (DRY_RUN) {
      inserted += batch.length;
    } else {
      const result = await client.query(sql, params);
      inserted += result.rowCount;
    }
    processed += batch.length;
    process.stdout.write(`\r  Media observations: ${inserted}/${total}`);
  }
  console.log();
  return inserted;
}

async function insertFieldEvidence(client, vehicles) {
  let inserted = 0;
  let totalFields = 0;

  const allEvidence = [];
  for (const v of vehicles) {
    const fields = extractEvidenceFields(v);
    for (const f of fields) {
      allEvidence.push({ vehicle_id: v.id, ...f });
    }
  }
  totalFields = allEvidence.length;

  for (let i = 0; i < allEvidence.length; i += BATCH_SIZE) {
    const batch = allEvidence.slice(i, i + BATCH_SIZE);
    const values = [];
    const params = [];
    let paramIdx = 1;

    for (const ev of batch) {
      values.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
      params.push(
        ev.vehicle_id,        // vehicle_id
        ev.field_name,        // field_name
        ev.value,             // proposed_value
        SOURCE_TYPE,          // source_type
        SOURCE_CONFIDENCE,    // source_confidence
        ev.context,           // extraction_context
        'accepted',           // status
      );
    }

    const sql = `
      INSERT INTO field_evidence
        (vehicle_id, field_name, proposed_value, source_type, source_confidence, extraction_context, status)
      VALUES ${values.join(', ')}
      ON CONFLICT (vehicle_id, field_name, source_type, proposed_value) DO NOTHING
    `;

    if (DRY_RUN) {
      inserted += batch.length;
    } else {
      const result = await client.query(sql, params);
      inserted += result.rowCount;
    }
    process.stdout.write(`\r  Field evidence: ${inserted}/${totalFields}`);
  }
  console.log();
  return inserted;
}

async function main() {
  console.log(`\n=== Backfill FB Saved Observations ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);

  const client = await pool.connect();
  try {
    // 1. Get source ID
    const sourceId = await getSourceId(client);
    console.log(`Source: ${SOURCE_SLUG} (${sourceId})`);

    // 2. Get all FB saved vehicles
    const vehicles = await getFBVehicles(client);
    console.log(`Vehicles: ${vehicles.length}`);

    // 3. Get all images for those vehicles
    const vehicleIds = vehicles.map(v => v.id);
    const imageMap = await getVehicleImages(client, vehicleIds);
    const totalImages = [...imageMap.values()].reduce((sum, imgs) => sum + imgs.length, 0);
    console.log(`Images: ${totalImages} across ${imageMap.size} vehicles\n`);

    // 4. Insert listing observations
    const listingCount = await insertListingObservations(client, vehicles, sourceId);
    console.log(`  -> ${listingCount} listing observations inserted`);

    // 5. Insert media observations
    const mediaCount = await insertMediaObservations(client, imageMap, sourceId);
    console.log(`  -> ${mediaCount} media observations inserted`);

    // 6. Insert field evidence
    const evidenceCount = await insertFieldEvidence(client, vehicles);
    console.log(`  -> ${evidenceCount} field_evidence rows inserted`);

    // 7. Check lock impact
    const { rows: locks } = await client.query(
      `SELECT count(*) as cnt FROM pg_stat_activity WHERE wait_event_type='Lock'`
    );
    console.log(`\nLock check: ${locks[0].cnt} waiting`);

    console.log(`\n=== Summary ===`);
    console.log(`Listing observations: ${listingCount}`);
    console.log(`Media observations:   ${mediaCount}`);
    console.log(`Field evidence:       ${evidenceCount}`);
    console.log(`Total:                ${listingCount + mediaCount + evidenceCount}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
