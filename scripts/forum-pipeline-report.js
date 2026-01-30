#!/usr/bin/env node
/**
 * FORUM-PIPELINE-REPORT
 *
 * Generates a comprehensive report of forum extraction progress.
 *
 * Usage:
 *   node scripts/forum-pipeline-report.js
 *   node scripts/forum-pipeline-report.js --json   # Output as JSON
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

const outputJson = process.argv.includes('--json');

async function generateReport() {
  const report = {
    generated_at: new Date().toISOString(),
    forum_summary: {},
    build_thread_discovery: {},
    data_points: {},
    top_forums: [],
    extraction_queue: {},
    sample_builds: [],
    category_breakdown: {},
  };

  // ===========================================
  // Forum Summary
  // ===========================================
  const { data: forumStats } = await supabase
    .from('forum_sources')
    .select('inspection_status')
    .then(({ data }) => {
      const counts = {
        total: data?.length || 0,
        pending: 0,
        inspected: 0,
        mapped: 0,
        active: 0,
        failed: 0,
      };
      for (const f of data || []) {
        counts[f.inspection_status] = (counts[f.inspection_status] || 0) + 1;
      }
      return { data: counts };
    });

  report.forum_summary = {
    total_forums_registered: forumStats.total,
    forums_inspected: forumStats.inspected + forumStats.mapped + forumStats.active,
    forums_with_build_sections: forumStats.mapped + forumStats.active,
    forums_active: forumStats.active,
    forums_pending: forumStats.pending,
    forums_failed: forumStats.failed,
  };

  // ===========================================
  // Build Thread Discovery
  // ===========================================
  const { data: threadStats } = await supabase
    .from('build_threads')
    .select('extraction_status, vehicle_id')
    .then(({ data }) => {
      const counts = {
        total: data?.length || 0,
        discovered: 0,
        queued: 0,
        extracting: 0,
        complete: 0,
        failed: 0,
        with_vehicle_match: 0,
      };
      for (const t of data || []) {
        counts[t.extraction_status] = (counts[t.extraction_status] || 0) + 1;
        if (t.vehicle_id) counts.with_vehicle_match++;
      }
      return { data: counts };
    });

  report.build_thread_discovery = {
    total_threads_found: threadStats.total,
    threads_with_vehicle_match: threadStats.with_vehicle_match,
    match_percentage: threadStats.total > 0
      ? ((threadStats.with_vehicle_match / threadStats.total) * 100).toFixed(1) + '%'
      : '0%',
    threads_discovered: threadStats.discovered,
    threads_queued: threadStats.queued,
    threads_extracting: threadStats.extracting,
    threads_complete: threadStats.complete,
    threads_failed: threadStats.failed,
  };

  // ===========================================
  // Data Points
  // ===========================================
  const { count: postsExtracted } = await supabase
    .from('build_posts')
    .select('*', { count: 'exact', head: true });

  const { data: imageStats } = await supabase
    .from('build_posts')
    .select('image_count')
    .then(({ data }) => {
      let total = 0;
      for (const p of data || []) {
        total += p.image_count || 0;
      }
      return { data: { total } };
    });

  // Estimate total expected posts/images
  const { data: threadTotals } = await supabase
    .from('build_threads')
    .select('post_count, image_count_estimate')
    .then(({ data }) => {
      let posts = 0;
      let images = 0;
      for (const t of data || []) {
        posts += t.post_count || 0;
        images += t.image_count_estimate || 0;
      }
      return { data: { posts, images } };
    });

  report.data_points = {
    estimated_total_posts: threadTotals.posts,
    estimated_total_images: threadTotals.images,
    posts_extracted: postsExtracted || 0,
    posts_extraction_percentage: threadTotals.posts > 0
      ? ((postsExtracted / threadTotals.posts) * 100).toFixed(1) + '%'
      : '0%',
    images_extracted: imageStats.total,
    images_extraction_percentage: threadTotals.images > 0
      ? ((imageStats.total / threadTotals.images) * 100).toFixed(1) + '%'
      : '0%',
  };

  // ===========================================
  // Top Forums by Build Count
  // ===========================================
  const { data: topForums } = await supabase
    .from('forum_sources')
    .select(`
      slug, name,
      build_threads(id, posts_extracted, images_extracted)
    `)
    .in('inspection_status', ['mapped', 'active'])
    .limit(20);

  const forumMetrics = (topForums || []).map(f => {
    const threads = f.build_threads || [];
    const totalPosts = threads.reduce((s, t) => s + (t.posts_extracted || 0), 0);
    const totalImages = threads.reduce((s, t) => s + (t.images_extracted || 0), 0);
    return {
      slug: f.slug,
      name: f.name,
      build_count: threads.length,
      posts_extracted: totalPosts,
      images_extracted: totalImages,
    };
  }).sort((a, b) => b.build_count - a.build_count);

  report.top_forums = forumMetrics.slice(0, 10);

  // ===========================================
  // Extraction Queue Status
  // ===========================================
  const { data: queueStats } = await supabase
    .from('build_threads')
    .select('post_count, image_count_estimate')
    .in('extraction_status', ['discovered', 'queued', 'extracting'])
    .then(({ data }) => {
      let avgPosts = 0;
      let avgImages = 0;
      const count = data?.length || 0;
      if (count > 0) {
        const totalPosts = data.reduce((s, t) => s + (t.post_count || 0), 0);
        const totalImages = data.reduce((s, t) => s + (t.image_count_estimate || 0), 0);
        avgPosts = Math.round(totalPosts / count);
        avgImages = Math.round(totalImages / count);
      }
      return { data: { count, avgPosts, avgImages } };
    });

  report.extraction_queue = {
    queue_depth: queueStats.count,
    avg_posts_per_thread: queueStats.avgPosts,
    avg_images_per_thread: queueStats.avgImages,
    processing_rate: '~50 threads/hour', // Estimate
  };

  // ===========================================
  // Sample Builds
  // ===========================================
  const { data: sampleBuilds } = await supabase
    .from('build_threads')
    .select(`
      thread_title, thread_url, author_handle,
      post_count, image_count_estimate, extraction_status,
      vehicle_id, vehicle_hints,
      forum_sources(slug)
    `)
    .order('posts_extracted', { ascending: false })
    .limit(5);

  report.sample_builds = (sampleBuilds || []).map(b => ({
    title: b.thread_title,
    author: b.author_handle,
    forum: b.forum_sources?.slug,
    posts: b.post_count,
    images: b.image_count_estimate,
    status: b.extraction_status,
    vehicle_matched: !!b.vehicle_id,
    hints: b.vehicle_hints,
  }));

  // ===========================================
  // Category Breakdown
  // ===========================================
  const { data: categoryData } = await supabase
    .from('forum_sources')
    .select(`
      vehicle_categories,
      build_threads(id)
    `);

  const categories = {};
  for (const f of categoryData || []) {
    const threadCount = f.build_threads?.length || 0;
    for (const cat of f.vehicle_categories || []) {
      categories[cat] = (categories[cat] || 0) + threadCount;
    }
  }

  report.category_breakdown = Object.entries(categories)
    .sort((a, b) => b[1] - a[1])
    .reduce((acc, [k, v]) => {
      acc[k] = v;
      return acc;
    }, {});

  // ===========================================
  // Output
  // ===========================================
  if (outputJson) {
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  // Pretty print
  const hr = '='.repeat(80);
  const subhr = '-'.repeat(80);

  console.log(hr);
  console.log('FORUM EXTRACTION PIPELINE REPORT');
  console.log(`Generated: ${report.generated_at}`);
  console.log(hr);

  console.log('\nFORUM SUMMARY');
  console.log(subhr);
  console.log(`Total Forums Registered:     ${report.forum_summary.total_forums_registered}`);
  console.log(`Forums Inspected:            ${report.forum_summary.forums_inspected}`);
  console.log(`Forums with Build Sections:  ${report.forum_summary.forums_with_build_sections}`);
  console.log(`Forums Active (extracting):  ${report.forum_summary.forums_active}`);
  console.log(`Forums Pending:              ${report.forum_summary.forums_pending}`);
  console.log(`Forums Failed:               ${report.forum_summary.forums_failed}`);

  console.log('\nBUILD THREAD DISCOVERY');
  console.log(subhr);
  console.log(`Total Build Threads Found:   ${report.build_thread_discovery.total_threads_found}`);
  console.log(`Threads with Vehicle Match:  ${report.build_thread_discovery.threads_with_vehicle_match} (${report.build_thread_discovery.match_percentage})`);
  console.log(`Threads Discovered:          ${report.build_thread_discovery.threads_discovered}`);
  console.log(`Threads Queued:              ${report.build_thread_discovery.threads_queued}`);
  console.log(`Threads Extracting:          ${report.build_thread_discovery.threads_extracting}`);
  console.log(`Threads Complete:            ${report.build_thread_discovery.threads_complete}`);
  console.log(`Threads Failed:              ${report.build_thread_discovery.threads_failed}`);

  console.log('\nDATA POINTS');
  console.log(subhr);
  console.log(`Estimated Total Posts:       ${report.data_points.estimated_total_posts.toLocaleString()}`);
  console.log(`Estimated Total Images:      ${report.data_points.estimated_total_images.toLocaleString()}`);
  console.log(`Posts Extracted:             ${report.data_points.posts_extracted.toLocaleString()} (${report.data_points.posts_extraction_percentage})`);
  console.log(`Images Extracted:            ${report.data_points.images_extracted.toLocaleString()} (${report.data_points.images_extraction_percentage})`);

  console.log('\nTOP FORUMS BY BUILD COUNT');
  console.log(subhr);
  for (let i = 0; i < report.top_forums.length; i++) {
    const f = report.top_forums[i];
    const num = String(i + 1).padStart(2, ' ');
    const name = f.name.padEnd(25).slice(0, 25);
    console.log(`${num}. ${name} ${String(f.build_count).padStart(5)} builds | ${String(f.posts_extracted).padStart(6)} posts | ${String(f.images_extracted).padStart(6)} images`);
  }

  console.log('\nEXTRACTION QUEUE STATUS');
  console.log(subhr);
  console.log(`Queue Depth:                 ${report.extraction_queue.queue_depth} threads`);
  console.log(`Avg Posts/Thread:            ${report.extraction_queue.avg_posts_per_thread}`);
  console.log(`Avg Images/Thread:           ${report.extraction_queue.avg_images_per_thread}`);
  console.log(`Processing Rate:             ${report.extraction_queue.processing_rate}`);

  console.log('\nSAMPLE BUILDS DISCOVERED');
  console.log(subhr);
  for (const build of report.sample_builds) {
    const title = (build.title || 'Untitled').slice(0, 70);
    const vehicleInfo = build.hints?.year && build.hints?.make
      ? `${build.hints.year} ${build.hints.make} ${build.hints.model || ''}`
      : 'Unknown vehicle';
    console.log(`\n  ${vehicleInfo}`);
    console.log(`  "${title}"`);
    console.log(`  by @${build.author || 'unknown'} on ${build.forum}`);
    console.log(`  Posts: ${build.posts || 0} | Images: ${build.images || 0} | Status: ${build.status?.toUpperCase()}`);
  }

  console.log('\nCATEGORY BREAKDOWN');
  console.log(subhr);
  const cats = Object.entries(report.category_breakdown).slice(0, 10);
  for (const [cat, count] of cats) {
    console.log(`  ${cat.padEnd(25)} ${count} threads`);
  }

  console.log('\n' + hr);

  return report;
}

// Run if executed directly
generateReport()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('Error generating report:', e);
    process.exit(1);
  });

export { generateReport };
