#!/usr/bin/env node
/**
 * FORUM NUKE RUN
 *
 * Aggressive extraction - we want to NUKE these forums, not prick them.
 * - More threads per forum
 * - More pages per thread
 * - All mapped forums
 * - Parallel extraction where possible
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Parse args
const args = process.argv.slice(2).reduce((acc, arg) => {
  if (arg.startsWith('--')) {
    const [key, value] = arg.slice(2).split('=');
    acc[key] = value === undefined ? true : value;
  }
  return acc;
}, {});

const HOURS = parseFloat(args.hours || '4');
const END_TIME = Date.now() + HOURS * 60 * 60 * 1000;
const MAX_PAGES_PER_THREAD = parseInt(args.pages || '50'); // Extract up to 50 pages (500+ posts per thread)
const DISCOVER_PAGES = parseInt(args.discover || '20');     // Discover from 20 pages per section

const stats = {
  startTime: new Date().toISOString(),
  threadsDiscovered: 0,
  threadsExtracted: 0,
  postsExtracted: 0,
  imagesExtracted: 0,
  errors: [],
};

function timeRemaining() {
  const ms = END_TIME - Date.now();
  if (ms <= 0) return '0:00';
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function log(msg) {
  console.log(`[${timeRemaining()} remaining] ${msg}`);
}

async function callFunction(name, payload) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  return response.json();
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// DISCOVER PHASE - Get ALL the threads
// ============================================
async function runDiscover() {
  log('=== DISCOVER PHASE ===');

  // Get ALL forums that are mapped or active
  const { data: forums } = await supabase
    .from('forum_sources')
    .select('id, slug, dom_map')
    .in('inspection_status', ['mapped', 'active'])
    .order('slug');

  if (!forums || forums.length === 0) {
    log('No forums ready for discovery');
    return;
  }

  log(`Discovering from ${forums.length} forums...`);

  for (const forum of forums) {
    if (Date.now() >= END_TIME) break;

    const sections = forum.dom_map?.build_sections || [];
    if (sections.length === 0) {
      log(`  ${forum.slug}: no build sections configured`);
      continue;
    }

    log(`Discovering from: ${forum.slug} (${sections.length} sections)`);

    try {
      const result = await callFunction('discover-build-threads', {
        forum_id: forum.id,
        max_pages: DISCOVER_PAGES,
      });

      if (result.success) {
        const discovered = result.results?.reduce((s, r) => s + (r.threads_discovered || 0), 0) || 0;
        stats.threadsDiscovered += discovered;
        log(`  → ${discovered} threads found`);
      } else {
        stats.errors.push(`discover ${forum.slug}: ${result.error}`);
        log(`  → ERROR: ${result.error?.slice(0, 50)}`);
      }
    } catch (e) {
      stats.errors.push(`discover ${forum.slug}: ${e.message}`);
    }

    await sleep(2000); // Brief pause
  }
}

// ============================================
// EXTRACT PHASE - Get ALL the posts
// ============================================
async function runExtract() {
  log('=== EXTRACT PHASE ===');

  // Get threads ready for extraction, prioritize by activity
  const { data: threads } = await supabase
    .from('build_threads')
    .select('id, thread_title, post_count, forum_sources(slug)')
    .in('extraction_status', ['discovered', 'queued'])
    .order('post_count', { ascending: false, nullsFirst: false })
    .limit(100);

  if (!threads || threads.length === 0) {
    log('No threads ready for extraction');
    return;
  }

  log(`Extracting from ${threads.length} threads...`);

  for (const thread of threads) {
    if (Date.now() >= END_TIME) break;

    const title = (thread.thread_title || 'Untitled').slice(0, 40);
    const estPosts = thread.post_count || '?';
    log(`Extracting: ${title}... (~${estPosts} posts)`);

    try {
      const result = await callFunction('extract-build-posts', {
        thread_id: thread.id,
        max_pages: MAX_PAGES_PER_THREAD,
      });

      if (result.success) {
        stats.threadsExtracted++;
        stats.postsExtracted += result.posts_extracted || 0;
        stats.imagesExtracted += result.images_extracted || 0;
        log(`  → ${result.posts_extracted} posts, ${result.images_extracted} images`);
      } else {
        stats.errors.push(`extract ${title}: ${result.error}`);
        log(`  → ERROR: ${result.error?.slice(0, 50)}`);
      }
    } catch (e) {
      stats.errors.push(`extract ${title}: ${e.message}`);
    }

    await sleep(1500); // Brief pause
  }
}

// ============================================
// MAIN LOOP
// ============================================
async function main() {
  console.log('='.repeat(70));
  console.log('FORUM NUKE RUN ☢️');
  console.log('='.repeat(70));
  console.log(`Duration: ${HOURS} hours`);
  console.log(`Max pages per thread: ${MAX_PAGES_PER_THREAD}`);
  console.log(`Discovery depth: ${DISCOVER_PAGES} pages per section`);
  console.log(`End time: ${new Date(END_TIME).toISOString()}`);
  console.log('='.repeat(70));

  let cycle = 0;

  while (Date.now() < END_TIME) {
    cycle++;
    log(`\n=== CYCLE ${cycle} ===`);

    try {
      // Discover new threads
      await runDiscover();

      if (Date.now() >= END_TIME) break;

      // Extract posts from discovered threads
      await runExtract();

    } catch (e) {
      log(`Cycle error: ${e.message}`);
      stats.errors.push(`cycle ${cycle}: ${e.message}`);
    }

    // Brief pause between cycles
    if (Date.now() < END_TIME) {
      log('Pausing before next cycle...');
      await sleep(5000);
    }
  }

  // Final report
  console.log('\n' + '='.repeat(70));
  console.log('NUKE RUN COMPLETE ☢️');
  console.log('='.repeat(70));
  console.log(`Started: ${stats.startTime}`);
  console.log(`Ended: ${new Date().toISOString()}`);
  console.log(`Cycles: ${cycle}`);
  console.log('');
  console.log('RESULTS:');
  console.log(`  Threads discovered:   ${stats.threadsDiscovered}`);
  console.log(`  Threads extracted:    ${stats.threadsExtracted}`);
  console.log(`  Posts extracted:      ${stats.postsExtracted}`);
  console.log(`  Images extracted:     ${stats.imagesExtracted}`);
  console.log(`  Errors:               ${stats.errors.length}`);

  if (stats.errors.length > 0) {
    console.log('\nERRORS (first 20):');
    for (const err of stats.errors.slice(0, 20)) {
      console.log(`  - ${err}`);
    }
    if (stats.errors.length > 20) {
      console.log(`  ... and ${stats.errors.length - 20} more`);
    }
  }

  console.log('='.repeat(70));
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
