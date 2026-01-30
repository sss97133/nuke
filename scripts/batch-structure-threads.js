#!/usr/bin/env node
/**
 * BATCH-STRUCTURE-THREADS
 *
 * Processes all build threads to extract structured vehicle data.
 * Creates vehicle profiles and timelines.
 *
 * Usage:
 *   node scripts/batch-structure-threads.js
 *   node scripts/batch-structure-threads.js --limit=10
 *   node scripts/batch-structure-threads.js --dry-run
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '50');
const DELAY_MS = 2000; // Rate limit protection

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('═'.repeat(60));
  console.log('BATCH STRUCTURE BUILD THREADS');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'} | Limit: ${LIMIT}`);
  console.log('═'.repeat(60));

  // Get threads that are complete (have posts) and don't have a vehicle linked yet
  // These are threads that need to have vehicle profiles created
  const { data: threads, error } = await supabase
    .from('build_threads')
    .select(`
      id, thread_title, thread_url, vehicle_id, post_count, posts_extracted,
      forum:forum_sources(name, slug)
    `)
    .eq('extraction_status', 'complete')
    .is('vehicle_id', null) // Only threads without a vehicle link
    .gt('posts_extracted', 5) // Only threads with posts extracted
    .order('posts_extracted', { ascending: false })
    .limit(LIMIT);

  if (error) {
    console.error('Error fetching threads:', error.message);
    return;
  }

  console.log(`\nFound ${threads?.length || 0} threads to process\n`);

  let processed = 0;
  let vehiclesCreated = 0;
  let errors = 0;

  for (const thread of threads || []) {
    console.log('─'.repeat(60));
    console.log(`Processing: ${thread.thread_title?.slice(0, 50)}...`);
    console.log(`  Forum: ${thread.forum?.name || 'Unknown'}`);
    console.log(`  Posts: ${thread.post_count || '?'}`);
    console.log(`  URL: ${thread.thread_url}`);

    if (DRY_RUN) {
      console.log('  [DRY RUN - would call structure-build-thread]');
      processed++;
      continue;
    }

    try {
      const response = await fetch(
        `${process.env.VITE_SUPABASE_URL}/functions/v1/structure-build-thread`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            thread_id: thread.id,
            create_vehicle: !thread.vehicle_id, // Only create if none exists
          }),
        }
      );

      const result = await response.json();

      if (result.success) {
        processed++;
        if (result.vehicle_created) {
          vehiclesCreated++;
          console.log(`  ✓ Created vehicle: ${result.structured?.vehicle?.year} ${result.structured?.vehicle?.make} ${result.structured?.vehicle?.model}`);
        } else if (result.vehicle_id) {
          console.log(`  ✓ Linked to existing vehicle`);
        }

        if (result.structured?.timeline?.length) {
          console.log(`  Timeline: ${result.structured.timeline.length} events`);
        }
        if (result.structured?.parts_installed?.length) {
          console.log(`  Parts: ${result.structured.parts_installed.length} items`);
        }
        if (result.structured?.build_type) {
          console.log(`  Build type: ${result.structured.build_type}`);
        }

        // Thread will be linked to vehicle_id by structure-build-thread,
        // so subsequent runs will skip it (vehicle_id != null filter)
      } else {
        errors++;
        console.log(`  ✗ Error: ${result.error}`);
      }
    } catch (e) {
      errors++;
      console.log(`  ✗ Exception: ${e.message}`);
    }

    // Rate limiting
    await sleep(DELAY_MS);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('RESULTS');
  console.log('═'.repeat(60));
  console.log(`Threads processed:  ${processed}`);
  console.log(`Vehicles created:   ${vehiclesCreated}`);
  console.log(`Errors:             ${errors}`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN - no changes made]');
  }
}

main().catch(console.error);
