#!/usr/bin/env node
/**
 * Assess the scope of forum data - what we have vs what exists
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function main() {
  console.log('='.repeat(70));
  console.log('FORUM EXTRACTION SCOPE ASSESSMENT');
  console.log('='.repeat(70));

  // Get all forums
  const { data: forums, error: forumErr } = await supabase
    .from('forum_sources')
    .select('*')
    .order('slug');

  if (forumErr) {
    console.error('Error fetching forums:', forumErr);
    return;
  }

  // Group by status
  const byStatus = {};
  for (const f of forums || []) {
    const status = f.inspection_status || 'unknown';
    byStatus[status] = byStatus[status] || [];
    byStatus[status].push(f);
  }

  console.log('\nFORUM STATUS:');
  console.log('-'.repeat(70));
  for (const [status, list] of Object.entries(byStatus)) {
    console.log(`\n${status.toUpperCase()} (${list.length}):`);
    for (const f of list) {
      const platform = f.platform_type || '?';
      const sections = f.dom_map?.build_sections?.length || 0;
      console.log(`  ${f.slug} [${platform}] - ${sections} sections`);
      if (status === 'pending' || status === 'failed' || f.health_score < 0.5) {
        console.log(`    URL: ${f.base_url}`);
        if (f.last_error) console.log(`    Error: ${f.last_error.slice(0, 60)}...`);
      }
    }
  }

  // Get thread stats
  const { data: threads } = await supabase
    .from('build_threads')
    .select('id, thread_title, post_count, posts_extracted, extraction_status, forum_source_id');

  const threadsByForum = {};
  let totalPostCount = 0;
  let totalExtracted = 0;

  for (const t of threads || []) {
    threadsByForum[t.forum_source_id] = threadsByForum[t.forum_source_id] || { threads: 0, posts: 0, extracted: 0 };
    threadsByForum[t.forum_source_id].threads++;
    threadsByForum[t.forum_source_id].posts += t.post_count || 0;
    threadsByForum[t.forum_source_id].extracted += t.posts_extracted || 0;
    totalPostCount += t.post_count || 0;
    totalExtracted += t.posts_extracted || 0;
  }

  console.log('\n' + '='.repeat(70));
  console.log('THREAD DISCOVERY BY FORUM:');
  console.log('-'.repeat(70));

  for (const f of forums || []) {
    const stats = threadsByForum[f.id];
    if (stats) {
      console.log(`${f.slug}: ${stats.threads} threads, ${stats.posts} posts found, ${stats.extracted} extracted`);
    }
  }

  // Get external identities (users)
  const { count: userCount } = await supabase
    .from('external_identities')
    .select('*', { count: 'exact', head: true });

  // Get actual posts
  const { count: postCount } = await supabase
    .from('build_posts')
    .select('*', { count: 'exact', head: true });

  // Get unique authors from posts
  const { data: authors } = await supabase
    .from('build_posts')
    .select('author_handle')
    .limit(10000);

  const uniqueAuthors = new Set((authors || []).map(a => a.author_handle));

  console.log('\n' + '='.repeat(70));
  console.log('DATA EXTRACTED:');
  console.log('-'.repeat(70));
  console.log(`Forums registered:     ${forums?.length || 0}`);
  console.log(`Forums working:        ${(byStatus.mapped?.length || 0) + (byStatus.active?.length || 0)}`);
  console.log(`Threads discovered:    ${threads?.length || 0}`);
  console.log(`Posts in DB:           ${postCount}`);
  console.log(`Unique authors:        ${uniqueAuthors.size}`);
  console.log(`External identities:   ${userCount}`);

  console.log('\n' + '='.repeat(70));
  console.log('SCOPE ESTIMATE (what exists vs what we have):');
  console.log('-'.repeat(70));

  // Rough estimates based on typical forum sizes
  const workingForums = (byStatus.mapped?.length || 0) + (byStatus.active?.length || 0);
  const avgThreadsPerForum = 500; // conservative - big forums have 10k+
  const avgPostsPerThread = 50;   // build threads often have 100-500+ posts

  const estTotalThreads = forums.length * avgThreadsPerForum;
  const estTotalPosts = estTotalThreads * avgPostsPerThread;

  console.log(`Estimated threads available:  ${estTotalThreads.toLocaleString()} (${avgThreadsPerForum}/forum × ${forums.length} forums)`);
  console.log(`Estimated posts available:    ${estTotalPosts.toLocaleString()}`);
  console.log(`Threads we found:             ${threads?.length || 0} (${((threads?.length || 0) / estTotalThreads * 100).toFixed(2)}%)`);
  console.log(`Posts we extracted:           ${postCount?.toLocaleString()} (${(postCount / estTotalPosts * 100).toFixed(4)}%)`);

  console.log('\n' + '='.repeat(70));
  console.log('VERDICT: ' + (postCount < estTotalPosts * 0.001 ? 'PRICKED IT 📍' :
                            postCount < estTotalPosts * 0.01 ? 'DENT 🔨' :
                            postCount < estTotalPosts * 0.1 ? 'HOLE 🕳️' :
                            postCount < estTotalPosts * 0.5 ? 'CHASM 🏔️' : 'NUKED ☢️'));
  console.log('='.repeat(70));
}

main();
