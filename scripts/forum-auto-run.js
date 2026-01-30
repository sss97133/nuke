#!/usr/bin/env node
/**
 * FORUM AUTO-RUN
 *
 * Runs forum extraction pipeline for a specified duration.
 * Cycles through: inspect → discover → extract
 *
 * Usage:
 *   node scripts/forum-auto-run.js                    # Default 2 hours
 *   node scripts/forum-auto-run.js --hours=4          # Custom duration
 *   node scripts/forum-auto-run.js --mode=extract     # Extract only
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

const HOURS = parseFloat(args.hours || '2');
const MODE = args.mode || 'full'; // 'full', 'inspect', 'discover', 'extract'
const END_TIME = Date.now() + HOURS * 60 * 60 * 1000;

// Stats tracking
const stats = {
  startTime: new Date().toISOString(),
  forumsInspected: 0,
  threadsDiscovered: 0,
  threadsExtracted: 0,
  postsExtracted: 0,
  imagesExtracted: 0,
  orgMentionsQueued: 0,
  authorsFound: 0,
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
// INSPECT PHASE
// ============================================
async function runInspect() {
  log('--- INSPECT PHASE ---');

  // Get pending forums
  const { data: forums } = await supabase
    .from('forum_sources')
    .select('id, slug, base_url')
    .eq('inspection_status', 'pending')
    .limit(10);

  if (!forums || forums.length === 0) {
    log('No pending forums to inspect');
    return;
  }

  for (const forum of forums) {
    if (Date.now() >= END_TIME) break;

    log(`Inspecting: ${forum.slug}`);
    try {
      const result = await callFunction('inspect-forum', { forum_id: forum.id });
      if (result.success) {
        stats.forumsInspected++;
        log(`  → ${result.platform_type}, ${result.build_section_count} sections`);
      } else {
        stats.errors.push(`inspect ${forum.slug}: ${result.error}`);
      }
    } catch (e) {
      stats.errors.push(`inspect ${forum.slug}: ${e.message}`);
    }
    await sleep(3000); // Rate limit
  }
}

// ============================================
// DISCOVER PHASE
// ============================================
async function runDiscover() {
  log('--- DISCOVER PHASE ---');

  // Get forums ready for discovery
  const { data: forums } = await supabase
    .from('forum_sources')
    .select('id, slug')
    .in('inspection_status', ['mapped', 'active'])
    .order('last_crawled_at', { ascending: true, nullsFirst: true })
    .limit(5);

  if (!forums || forums.length === 0) {
    log('No forums ready for discovery');
    return;
  }

  for (const forum of forums) {
    if (Date.now() >= END_TIME) break;

    log(`Discovering from: ${forum.slug}`);
    try {
      const result = await callFunction('discover-build-threads', {
        forum_id: forum.id,
        max_pages: 5,
      });
      if (result.success) {
        const r = result.results?.[0] || {};
        stats.threadsDiscovered += r.threads_discovered || 0;
        log(`  → ${r.threads_discovered || 0} threads found`);
      } else {
        stats.errors.push(`discover ${forum.slug}: ${result.error}`);
      }
    } catch (e) {
      stats.errors.push(`discover ${forum.slug}: ${e.message}`);
    }
    await sleep(5000); // Rate limit
  }
}

// ============================================
// EXTRACT PHASE
// ============================================
async function runExtract() {
  log('--- EXTRACT PHASE ---');

  // Get threads ready for extraction
  const { data: threads } = await supabase
    .from('build_threads')
    .select('id, thread_title, forum_sources(slug)')
    .in('extraction_status', ['discovered', 'queued'])
    .order('last_activity_date', { ascending: false, nullsFirst: false })
    .limit(20);

  if (!threads || threads.length === 0) {
    log('No threads ready for extraction');
    return;
  }

  for (const thread of threads) {
    if (Date.now() >= END_TIME) break;

    const title = (thread.thread_title || 'Untitled').slice(0, 40);
    log(`Extracting: ${title}...`);
    try {
      const result = await callFunction('extract-build-posts', {
        thread_id: thread.id,
        max_pages: 10,
      });
      if (result.success) {
        stats.threadsExtracted++;
        stats.postsExtracted += result.posts_extracted || 0;
        stats.imagesExtracted += result.images_extracted || 0;
        stats.orgMentionsQueued += result.org_mentions_queued || 0;
        stats.authorsFound += result.authors_found || 0;
        log(`  → ${result.posts_extracted} posts, ${result.images_extracted} images, ${result.org_mentions_queued || 0} orgs`);
      } else {
        stats.errors.push(`extract ${title}: ${result.error}`);
      }
    } catch (e) {
      stats.errors.push(`extract ${title}: ${e.message}`);
    }
    await sleep(3000); // Rate limit
  }
}

// ============================================
// MAIN LOOP
// ============================================
async function main() {
  console.log('='.repeat(70));
  console.log('FORUM AUTO-RUN');
  console.log('='.repeat(70));
  console.log(`Mode: ${MODE}`);
  console.log(`Duration: ${HOURS} hours`);
  console.log(`End time: ${new Date(END_TIME).toISOString()}`);
  console.log('='.repeat(70));

  let cycle = 0;

  while (Date.now() < END_TIME) {
    cycle++;
    log(`\n=== CYCLE ${cycle} ===`);

    try {
      if (MODE === 'full' || MODE === 'inspect') {
        await runInspect();
      }

      if (Date.now() >= END_TIME) break;

      if (MODE === 'full' || MODE === 'discover') {
        await runDiscover();
      }

      if (Date.now() >= END_TIME) break;

      if (MODE === 'full' || MODE === 'extract') {
        await runExtract();
      }
    } catch (e) {
      log(`Cycle error: ${e.message}`);
      stats.errors.push(`cycle ${cycle}: ${e.message}`);
    }

    // Brief pause between cycles
    if (Date.now() < END_TIME) {
      log('Pausing before next cycle...');
      await sleep(10000);
    }
  }

  // Final report
  console.log('\n' + '='.repeat(70));
  console.log('AUTO-RUN COMPLETE');
  console.log('='.repeat(70));
  console.log(`Started: ${stats.startTime}`);
  console.log(`Ended: ${new Date().toISOString()}`);
  console.log(`Cycles: ${cycle}`);
  console.log('');
  console.log('RESULTS:');
  console.log(`  Forums inspected:     ${stats.forumsInspected}`);
  console.log(`  Threads discovered:   ${stats.threadsDiscovered}`);
  console.log(`  Threads extracted:    ${stats.threadsExtracted}`);
  console.log(`  Posts extracted:      ${stats.postsExtracted}`);
  console.log(`  Images extracted:     ${stats.imagesExtracted}`);
  console.log(`  Org mentions queued:  ${stats.orgMentionsQueued}`);
  console.log(`  Authors found:        ${stats.authorsFound}`);
  console.log(`  Errors:               ${stats.errors.length}`);

  if (stats.errors.length > 0) {
    console.log('\nERRORS:');
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
