#!/usr/bin/env node
/**
 * FORUM AUTO-EXTRACT - Optimized for extraction
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

async function callFunction(name, payload, timeout = 50000) {
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeout),
    });
    return await resp.json();
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function getStats() {
  const [threads, posts] = await Promise.all([
    supabase.from('build_threads').select('extraction_status'),
    supabase.from('build_posts').select('id', { count: 'exact', head: true }),
  ]);
  const status = {};
  for (const t of threads.data || []) status[t.extraction_status] = (status[t.extraction_status] || 0) + 1;
  return { threads: threads.data?.length || 0, posts: posts.count || 0, ...status };
}

async function main() {
  const startTime = Date.now();
  const runFor = 2 * 60 * 60 * 1000;
  let cycle = 0, totalExtracted = 0, totalPosts = 0;
  
  log('=' .repeat(50));
  log('FORUM EXTRACTION - 2HR RUN');
  log('=' .repeat(50));
  
  const initial = await getStats();
  log(`Start: ${initial.threads} threads, ${initial.posts} posts`);
  
  while (Date.now() - startTime < runFor) {
    cycle++;
    const elapsed = Math.round((Date.now() - startTime) / 60000);
    
    // Get threads to extract
    const { data: threads } = await supabase
      .from('build_threads')
      .select('id, thread_title')
      .in('extraction_status', ['discovered', 'queued'])
      .limit(8);
    
    if (!threads?.length) {
      log(`Cycle ${cycle} (${elapsed}m): No threads to extract, waiting...`);
      await sleep(60000);
      continue;
    }
    
    log(`Cycle ${cycle} (${elapsed}m): Extracting ${threads.length} threads`);
    
    for (const thread of threads) {
      const result = await callFunction('extract-build-posts', { thread_id: thread.id, max_pages: 5 }, 60000);
      if (result.success && result.posts_count > 0) {
        totalExtracted++;
        totalPosts += result.posts_count || 0;
        log(`  ✓ ${(thread.thread_title || '').slice(0, 35)}... (${result.posts_count} posts)`);
      }
      await sleep(1500);
    }
    
    // Stats every 10 cycles
    if (cycle % 10 === 0) {
      const stats = await getStats();
      log(`>> ${stats.threads} threads | ${stats.posts} posts | ${stats.complete || 0} complete`);
    }
    
    await sleep(2000);
  }
  
  log('=' .repeat(50));
  log('COMPLETE');
  const final = await getStats();
  log(`Final: ${final.threads} threads, ${final.posts} posts, ${final.complete || 0} complete`);
  log(`Session: +${totalExtracted} threads, +${totalPosts} posts`);
  log('=' .repeat(50));
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
