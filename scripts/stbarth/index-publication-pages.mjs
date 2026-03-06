#!/usr/bin/env node
/**
 * Index publication pages for publications that have cdn_hash and page_count.
 *
 * For each qualifying publication, generates publication_pages rows with
 * Issuu CDN image URLs. Skips publications that already have pages indexed.
 * Updates extraction_status to 'pages_indexed' after inserting pages.
 *
 * Usage:
 *   cd /Users/skylar/nuke && dotenvx run -- node scripts/stbarth/index-publication-pages.mjs
 *
 * Prerequisites:
 *   Run seed-publications.mjs first to populate publications.
 */

import { createClient } from '@supabase/supabase-js';
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

const INSERT_BATCH_SIZE = 500;

// ─── Fetch qualifying publications ──────────────────────────────────────────

async function fetchPublications() {
  console.log('Querying publications with hash_extracted status...');

  // Paginate through all qualifying publications (supabase returns max 1000)
  const allPubs = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('publications')
      .select('id, cdn_hash, page_count, title, publisher_slug')
      .eq('extraction_status', 'hash_extracted')
      .not('cdn_hash', 'is', null)
      .not('page_count', 'is', null)
      .gt('page_count', 0)
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('Error fetching publications:', error.message);
      process.exit(1);
    }

    if (!data || data.length === 0) break;
    allPubs.push(...data);

    if (data.length < pageSize) break;
    offset += pageSize;
  }

  console.log(`  Found ${allPubs.length} publications with cdn_hash + page_count.\n`);
  return allPubs;
}

// ─── Check which publications already have pages ────────────────────────────

async function getPublicationsWithPages(pubIds) {
  const existing = new Set();

  // Query in batches of 100 to avoid URL length limits
  for (let i = 0; i < pubIds.length; i += 100) {
    const batch = pubIds.slice(i, i + 100);
    const { data, error } = await supabase
      .from('publication_pages')
      .select('publication_id')
      .in('publication_id', batch);

    if (error) {
      console.error('Error checking existing pages:', error.message);
      continue;
    }

    for (const row of (data || [])) {
      existing.add(row.publication_id);
    }
  }

  return existing;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  // 1. Get qualifying publications
  const publications = await fetchPublications();
  if (publications.length === 0) {
    console.log('No publications to process. Ensure seed-publications.mjs has been run.');
    return;
  }

  // 2. Check which already have pages indexed
  const pubIds = publications.map(p => p.id);
  console.log('Checking for existing pages...');
  const existingPubs = await getPublicationsWithPages(pubIds);
  console.log(`  ${existingPubs.size} publications already have pages indexed.\n`);

  const toProcess = publications.filter(p => !existingPubs.has(p.id));
  console.log(`Processing ${toProcess.length} publications (skipping ${existingPubs.size} already indexed).\n`);

  if (toProcess.length === 0) {
    console.log('All qualifying publications already have pages. Nothing to do.');
    return;
  }

  // 3. Generate and insert pages
  let totalPagesCreated = 0;
  let totalPubsProcessed = 0;
  let totalErrors = 0;

  for (let pubIdx = 0; pubIdx < toProcess.length; pubIdx++) {
    const pub = toProcess[pubIdx];

    // Generate all page rows for this publication
    const pageRows = [];
    for (let pageNum = 1; pageNum <= pub.page_count; pageNum++) {
      pageRows.push({
        publication_id: pub.id,
        page_number: pageNum,
        image_url: `https://image.isu.pub/${pub.cdn_hash}/jpg/page_${pageNum}.jpg`,
        ai_processing_status: 'pending',
      });
    }

    // Insert in batches
    let pubPagesInserted = 0;
    let pubError = false;

    for (let i = 0; i < pageRows.length; i += INSERT_BATCH_SIZE) {
      const batch = pageRows.slice(i, i + INSERT_BATCH_SIZE);

      const { data, error } = await supabase
        .from('publication_pages')
        .insert(batch)
        .select('id');

      if (error) {
        // If it's a unique constraint violation, pages already exist (race condition)
        if (error.message.includes('duplicate') || error.message.includes('unique')) {
          console.log(`  [${pub.publisher_slug}/${pub.slug}] Pages already exist, skipping.`);
          pubError = true;
          break;
        }
        console.error(`  [${pub.publisher_slug}/${pub.slug}] Insert error: ${error.message}`);
        totalErrors++;
        pubError = true;
        break;
      }

      pubPagesInserted += data.length;
    }

    if (!pubError && pubPagesInserted > 0) {
      // Update publication status to 'pages_indexed'
      const { error: updateError } = await supabase
        .from('publications')
        .update({ extraction_status: 'pages_indexed' })
        .eq('id', pub.id);

      if (updateError) {
        console.error(`  [${pub.publisher_slug}/${pub.slug}] Status update error: ${updateError.message}`);
      }

      totalPagesCreated += pubPagesInserted;
      totalPubsProcessed++;
    }

    // Progress
    const pct = Math.round(((pubIdx + 1) / toProcess.length) * 100);
    process.stdout.write(`\r  Progress: ${pubIdx + 1}/${toProcess.length} publications (${pct}%) | ${totalPagesCreated} pages created`);
  }
  process.stdout.write('\n\n');

  // 4. Report
  console.log('=== Summary ===');
  console.log(`  Publications processed:  ${totalPubsProcessed}`);
  console.log(`  Publications skipped:    ${existingPubs.size} (already indexed)`);
  console.log(`  Publications errored:    ${totalErrors}`);
  console.log(`  Total pages created:     ${totalPagesCreated}`);

  // Verify in DB
  const { count: pubCount } = await supabase
    .from('publications')
    .select('*', { count: 'exact', head: true })
    .eq('extraction_status', 'pages_indexed');

  const { count: pageCount } = await supabase
    .from('publication_pages')
    .select('*', { count: 'exact', head: true });

  console.log(`\n  DB verification:`);
  console.log(`    publications (pages_indexed): ${pubCount}`);
  console.log(`    publication_pages total:       ${pageCount}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
