#!/usr/bin/env node
/**
 * Seed publications from publications_with_hashes.json into the publications table.
 *
 * Reads the JSON, looks up organization IDs by slug, batch-upserts in chunks of 50.
 * Reports total inserted, hash_extracted count, pending_hash count.
 *
 * Usage:
 *   cd /Users/skylar/nuke && dotenvx run -- node scripts/stbarth/seed-publications.mjs
 *
 * Prerequisites:
 *   Run seed-publishers.mjs first to populate organizations.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns';

// DNS fix: bypass broken macOS system resolver
const resolver = new dns.Resolver();
resolver.setServers(['8.8.8.8', '1.1.1.1']);
const origLookup = dns.lookup.bind(dns);
dns.lookup = function(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  resolver.resolve4(hostname, (err, addresses) => {
    if (err || !addresses || addresses.length === 0) return origLookup(hostname, options, callback);
    if (options && options.all) callback(null, addresses.map(a => ({ address: a, family: 4 })));
    else callback(null, addresses[0], 4);
  });
};
const nodeFetch = (await import('node-fetch')).default;
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  global: { fetch: nodeFetch }
});

// ─── Constants ──────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, 'data', 'publications_with_hashes.json');
const BATCH_SIZE = 50;

// ─── Build organization lookup ──────────────────────────────────────────────

async function buildOrgMap() {
  console.log('Loading organization IDs by slug...');

  // Query all organizations that have an issuu_publisher_slug in metadata
  const { data, error } = await supabase
    .from('organizations')
    .select('id, slug')
    .not('slug', 'is', null);

  if (error) {
    console.error('Error loading organizations:', error.message);
    process.exit(1);
  }

  const orgMap = {};
  for (const row of data) {
    orgMap[row.slug] = row.id;
  }

  console.log(`  Loaded ${Object.keys(orgMap).length} organizations with slugs.`);
  return orgMap;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  // 1. Load JSON
  console.log(`Reading ${DATA_FILE}...`);
  const raw = readFileSync(DATA_FILE, 'utf8');
  const publications = JSON.parse(raw);
  console.log(`  Loaded ${publications.length} publications from JSON.\n`);

  // 2. Build org map
  const orgMap = await buildOrgMap();

  // 3. Build rows
  let hashExtracted = 0;
  let pendingHash = 0;
  let missingOrg = 0;

  const rows = publications.map(pub => {
    const orgId = orgMap[pub.publisher_slug] || null;
    if (!orgId) missingOrg++;

    const hasCdnHash = pub.cdn_hash != null && pub.cdn_hash !== '';
    const extractionStatus = hasCdnHash ? 'hash_extracted' : 'pending_hash';
    if (hasCdnHash) hashExtracted++;
    else pendingHash++;

    return {
      publisher_slug: pub.publisher_slug,
      organization_id: orgId,
      title: pub.title,
      slug: pub.slug,
      platform: 'issuu',
      platform_id: pub.platform_id || null,
      platform_url: pub.platform_url,
      cdn_hash: pub.cdn_hash || null,
      page_count: pub.page_count || null,
      publication_date: pub.publication_date || null,
      issue_number: pub.issue_number || null,
      language: pub.language || 'en',
      publication_type: pub.publication_type || null,
      extraction_status: extractionStatus,
      cover_image_url: hasCdnHash
        ? `https://image.isu.pub/${pub.cdn_hash}/jpg/page_1.jpg`
        : null,
    };
  });

  console.log(`Prepared ${rows.length} rows:`);
  console.log(`  hash_extracted: ${hashExtracted}`);
  console.log(`  pending_hash:   ${pendingHash}`);
  if (missingOrg > 0) {
    console.log(`  missing org:    ${missingOrg} (publisher_slug not found in organizations)`);
  }
  console.log();

  // 4. Batch upsert
  let totalUpserted = 0;
  let totalErrors = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    const { data, error } = await supabase
      .from('publications')
      .upsert(batch, { onConflict: 'publisher_slug,slug,platform', ignoreDuplicates: false })
      .select('id');

    if (error) {
      console.error(`  Batch ${Math.floor(i / BATCH_SIZE) + 1} error: ${error.message}`);
      totalErrors += batch.length;
    } else {
      totalUpserted += data.length;
    }

    // Progress
    const processed = Math.min(i + BATCH_SIZE, rows.length);
    process.stdout.write(`\r  Upserting... ${processed}/${rows.length} (${totalUpserted} ok, ${totalErrors} err)`);
  }
  process.stdout.write('\n\n');

  // 5. Report
  console.log('=== Summary ===');
  console.log(`  Total in JSON:     ${publications.length}`);
  console.log(`  Upserted:          ${totalUpserted}`);
  console.log(`  Errors:            ${totalErrors}`);
  console.log(`  hash_extracted:    ${hashExtracted}`);
  console.log(`  pending_hash:      ${pendingHash}`);

  // Verify in DB
  const { count } = await supabase
    .from('publications')
    .select('*', { count: 'exact', head: true })
    .eq('platform', 'issuu');

  console.log(`  In DB (issuu):     ${count}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
