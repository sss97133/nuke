#!/usr/bin/env node
/**
 * FORUM-EXTRACTION-PIPELINE
 *
 * Orchestrates the full forum extraction workflow:
 * 1. SEED    - Load forum_sources table
 * 2. INSPECT - Run inspect-forum on each (parallel, rate-limited)
 * 3. ANALYZE - Run analyze-forum-structure with AI
 * 4. DISCOVER - Run discover-build-threads per forum
 * 5. EXTRACT - Queue and process build threads
 * 6. REPORT  - Generate extraction summary
 *
 * Usage:
 *   node scripts/forum-extraction-pipeline.js                    # Full pipeline
 *   node scripts/forum-extraction-pipeline.js --stage=inspect    # Single stage
 *   node scripts/forum-extraction-pipeline.js --forum=rennlist   # Single forum
 *   node scripts/forum-extraction-pipeline.js --limit=3          # Limit forums
 *   node scripts/forum-extraction-pipeline.js --dry-run          # Preview only
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Parse command line args
const args = process.argv.slice(2).reduce((acc, arg) => {
  if (arg.startsWith('--')) {
    const [key, value] = arg.slice(2).split('=');
    acc[key] = value === undefined ? true : value;
  }
  return acc;
}, {});

const CONFIG = {
  stage: args.stage || 'all',
  forum: args.forum || null,
  limit: parseInt(args.limit, 10) || 100,
  dryRun: args['dry-run'] || false,
  concurrency: parseInt(args.concurrency, 10) || 3,
  delayMs: parseInt(args.delay, 10) || 2000,
};

// Helper to call edge functions
async function callEdgeFunction(name, payload) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || `${name} failed with status ${response.status}`);
  }

  return data;
}

// Sleep helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Process items with concurrency limit
async function processWithConcurrency(items, processor, concurrency, delayMs = 0) {
  const results = [];
  const inProgress = new Set();

  for (let i = 0; i < items.length; i++) {
    // Wait if at concurrency limit
    while (inProgress.size >= concurrency) {
      await sleep(100);
    }

    const item = items[i];
    const promise = (async () => {
      try {
        const result = await processor(item, i);
        return { item, success: true, result };
      } catch (e) {
        return { item, success: false, error: e.message };
      } finally {
        inProgress.delete(promise);
        if (delayMs > 0) await sleep(delayMs);
      }
    })();

    inProgress.add(promise);
    promise.then(r => results.push(r));
  }

  // Wait for remaining
  while (inProgress.size > 0) {
    await sleep(100);
  }

  return results;
}

// ===========================================
// STAGE 1: SEED
// ===========================================
async function runSeed() {
  console.log('\n' + '='.repeat(70));
  console.log('STAGE 1: SEED FORUM SOURCES');
  console.log('='.repeat(70) + '\n');

  if (CONFIG.dryRun) {
    console.log('DRY RUN - Skipping seed');
    return { seeded: 0 };
  }

  const { seedForums } = require('./seed-forum-sources.js');
  const results = await seedForums(false);

  console.log(`Seeded ${results.inserted} forums`);
  return { seeded: results.inserted };
}

// ===========================================
// STAGE 2: INSPECT
// ===========================================
async function runInspect() {
  console.log('\n' + '='.repeat(70));
  console.log('STAGE 2: INSPECT FORUMS');
  console.log('='.repeat(70) + '\n');

  // Get forums to inspect
  let query = supabase
    .from('forum_sources')
    .select('id, slug, base_url, inspection_status')
    .in('inspection_status', ['pending', 'failed'])
    .order('created_at', { ascending: true });

  if (CONFIG.forum) {
    query = query.eq('slug', CONFIG.forum);
  }

  const { data: forums, error } = await query.limit(CONFIG.limit);

  if (error) throw new Error(`Failed to fetch forums: ${error.message}`);

  console.log(`Found ${forums.length} forums to inspect`);

  if (CONFIG.dryRun) {
    console.log('DRY RUN - Would inspect:');
    for (const f of forums) {
      console.log(`  - ${f.slug}: ${f.base_url}`);
    }
    return { inspected: 0, failed: 0 };
  }

  let inspected = 0;
  let failed = 0;

  const results = await processWithConcurrency(
    forums,
    async (forum, i) => {
      console.log(`[${i + 1}/${forums.length}] Inspecting ${forum.slug}...`);
      const result = await callEdgeFunction('inspect-forum', { forum_id: forum.id });
      console.log(`  -> ${result.platform_type} (${result.build_section_count} build sections)`);
      return result;
    },
    CONFIG.concurrency,
    CONFIG.delayMs
  );

  for (const r of results) {
    if (r.success) {
      inspected++;
    } else {
      failed++;
      console.error(`  ERROR ${r.item.slug}: ${r.error}`);
    }
  }

  console.log(`\nInspected: ${inspected}, Failed: ${failed}`);
  return { inspected, failed };
}

// ===========================================
// STAGE 3: ANALYZE
// ===========================================
async function runAnalyze() {
  console.log('\n' + '='.repeat(70));
  console.log('STAGE 3: ANALYZE FORUM STRUCTURE (AI)');
  console.log('='.repeat(70) + '\n');

  // Get forums that have been inspected but not analyzed
  let query = supabase
    .from('forum_sources')
    .select('id, slug, base_url, dom_map, extraction_config')
    .eq('inspection_status', 'inspected')
    .is('extraction_config', null)
    .order('estimated_build_count', { ascending: false, nullsFirst: false });

  if (CONFIG.forum) {
    query = supabase
      .from('forum_sources')
      .select('id, slug, base_url, dom_map, extraction_config')
      .eq('slug', CONFIG.forum);
  }

  const { data: forums, error } = await query.limit(CONFIG.limit);

  if (error) throw new Error(`Failed to fetch forums: ${error.message}`);

  console.log(`Found ${forums.length} forums to analyze`);

  if (CONFIG.dryRun) {
    console.log('DRY RUN - Would analyze:');
    for (const f of forums) {
      console.log(`  - ${f.slug}`);
    }
    return { analyzed: 0, failed: 0 };
  }

  let analyzed = 0;
  let failed = 0;

  // Run sequentially to avoid rate limits on AI API
  for (let i = 0; i < forums.length; i++) {
    const forum = forums[i];
    console.log(`[${i + 1}/${forums.length}] Analyzing ${forum.slug}...`);

    try {
      const result = await callEdgeFunction('analyze-forum-structure', { forum_id: forum.id });
      console.log(`  -> Analysis complete`);
      analyzed++;
    } catch (e) {
      console.error(`  ERROR: ${e.message}`);
      failed++;
    }

    // Rate limit
    await sleep(3000);
  }

  console.log(`\nAnalyzed: ${analyzed}, Failed: ${failed}`);
  return { analyzed, failed };
}

// ===========================================
// STAGE 4: DISCOVER
// ===========================================
async function runDiscover() {
  console.log('\n' + '='.repeat(70));
  console.log('STAGE 4: DISCOVER BUILD THREADS');
  console.log('='.repeat(70) + '\n');

  // Get forums ready for discovery
  let query = supabase
    .from('forum_sources')
    .select('id, slug, base_url, estimated_build_count')
    .in('inspection_status', ['mapped', 'active'])
    .order('last_crawled_at', { ascending: true, nullsFirst: true });

  if (CONFIG.forum) {
    query = supabase
      .from('forum_sources')
      .select('id, slug, base_url, estimated_build_count')
      .eq('slug', CONFIG.forum);
  }

  const { data: forums, error } = await query.limit(CONFIG.limit);

  if (error) throw new Error(`Failed to fetch forums: ${error.message}`);

  console.log(`Found ${forums.length} forums for discovery`);

  if (CONFIG.dryRun) {
    console.log('DRY RUN - Would discover from:');
    for (const f of forums) {
      console.log(`  - ${f.slug} (~${f.estimated_build_count || '?'} builds)`);
    }
    return { discovered: 0, inserted: 0 };
  }

  let totalDiscovered = 0;
  let totalInserted = 0;

  for (let i = 0; i < forums.length; i++) {
    const forum = forums[i];
    console.log(`[${i + 1}/${forums.length}] Discovering from ${forum.slug}...`);

    try {
      const result = await callEdgeFunction('discover-build-threads', {
        forum_id: forum.id,
        max_pages: 10,
      });

      const forumResult = result.results?.[0] || {};
      console.log(`  -> ${forumResult.threads_discovered || 0} threads, ${forumResult.threads_inserted || 0} inserted`);

      totalDiscovered += forumResult.threads_discovered || 0;
      totalInserted += forumResult.threads_inserted || 0;
    } catch (e) {
      console.error(`  ERROR: ${e.message}`);
    }

    await sleep(CONFIG.delayMs);
  }

  console.log(`\nTotal discovered: ${totalDiscovered}, Inserted: ${totalInserted}`);
  return { discovered: totalDiscovered, inserted: totalInserted };
}

// ===========================================
// STAGE 5: EXTRACT
// ===========================================
async function runExtract() {
  console.log('\n' + '='.repeat(70));
  console.log('STAGE 5: EXTRACT BUILD POSTS');
  console.log('='.repeat(70) + '\n');

  // Get threads ready for extraction
  let query = supabase
    .from('build_threads')
    .select(`
      id, thread_url, thread_title, post_count, posts_extracted,
      forum_sources(id, slug)
    `)
    .in('extraction_status', ['discovered', 'queued'])
    .order('last_activity_date', { ascending: false, nullsFirst: false });

  if (CONFIG.forum) {
    query = query.eq('forum_sources.slug', CONFIG.forum);
  }

  const { data: threads, error } = await query.limit(CONFIG.limit);

  if (error) throw new Error(`Failed to fetch threads: ${error.message}`);

  console.log(`Found ${threads.length} threads to extract`);

  if (CONFIG.dryRun) {
    console.log('DRY RUN - Would extract:');
    for (const t of threads.slice(0, 20)) {
      console.log(`  - ${t.thread_title?.slice(0, 50)}... (${t.forum_sources?.slug})`);
    }
    if (threads.length > 20) {
      console.log(`  ... and ${threads.length - 20} more`);
    }
    return { extracted: 0, posts: 0, images: 0 };
  }

  let totalExtracted = 0;
  let totalPosts = 0;
  let totalImages = 0;

  const results = await processWithConcurrency(
    threads,
    async (thread, i) => {
      console.log(`[${i + 1}/${threads.length}] Extracting ${thread.thread_title?.slice(0, 40)}...`);
      const result = await callEdgeFunction('extract-build-posts', {
        thread_id: thread.id,
        max_pages: 50,
      });
      console.log(`  -> ${result.posts_extracted} posts, ${result.images_extracted} images`);
      return result;
    },
    2, // Lower concurrency for extraction
    CONFIG.delayMs * 2
  );

  for (const r of results) {
    if (r.success) {
      totalExtracted++;
      totalPosts += r.result.posts_extracted || 0;
      totalImages += r.result.images_extracted || 0;
    } else {
      console.error(`  ERROR: ${r.error}`);
    }
  }

  console.log(`\nExtracted: ${totalExtracted} threads, ${totalPosts} posts, ${totalImages} images`);
  return { extracted: totalExtracted, posts: totalPosts, images: totalImages };
}

// ===========================================
// STAGE 6: REPORT
// ===========================================
async function runReport() {
  console.log('\n' + '='.repeat(70));
  console.log('STAGE 6: PIPELINE REPORT');
  console.log('='.repeat(70) + '\n');

  // Call the report script
  const { generateReport } = require('./forum-pipeline-report.js');
  await generateReport();
}

// ===========================================
// MAIN
// ===========================================
async function main() {
  console.log('='.repeat(70));
  console.log('FORUM EXTRACTION PIPELINE');
  console.log('='.repeat(70));
  console.log(`Stage: ${CONFIG.stage}`);
  console.log(`Forum: ${CONFIG.forum || 'all'}`);
  console.log(`Limit: ${CONFIG.limit}`);
  console.log(`Dry Run: ${CONFIG.dryRun}`);
  console.log(`Concurrency: ${CONFIG.concurrency}`);

  const startTime = Date.now();
  const stageResults = {};

  try {
    if (CONFIG.stage === 'all' || CONFIG.stage === 'seed') {
      stageResults.seed = await runSeed();
    }

    if (CONFIG.stage === 'all' || CONFIG.stage === 'inspect') {
      stageResults.inspect = await runInspect();
    }

    if (CONFIG.stage === 'all' || CONFIG.stage === 'analyze') {
      stageResults.analyze = await runAnalyze();
    }

    if (CONFIG.stage === 'all' || CONFIG.stage === 'discover') {
      stageResults.discover = await runDiscover();
    }

    if (CONFIG.stage === 'all' || CONFIG.stage === 'extract') {
      stageResults.extract = await runExtract();
    }

    if (CONFIG.stage === 'all' || CONFIG.stage === 'report') {
      await runReport();
    }
  } catch (e) {
    console.error('\nPIPELINE ERROR:', e.message);
    console.error(e.stack);
    process.exit(1);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n' + '='.repeat(70));
  console.log('PIPELINE COMPLETE');
  console.log('='.repeat(70));
  console.log(`Total time: ${elapsed}s`);
  console.log('Stage results:', JSON.stringify(stageResults, null, 2));
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
