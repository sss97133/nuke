#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Patterns to count threads in HTML
const THREAD_PATTERNS = [
  { name: 'vbulletin', pattern: /id="thread_title_(\d+)"/g },
  { name: 'xenforo_struct', pattern: /class="structItem[^"]*"[^>]*data-author/g },
  { name: 'xenforo_preview', pattern: /data-preview-url="[^"]*threads/g },
  { name: 'href_threads', pattern: /href="[^"]*\/threads\/[^"]*\.(\d+)/g },
  { name: 'href_showthread', pattern: /href="[^"]*showthread\.php\?[^"]*t=(\d+)/g },
  { name: 'href_topic', pattern: /href="[^"]*\/topic\/[^"]*"/g },
  { name: 'discussionListItem', pattern: /class="[^"]*discussionListItem[^"]*"/g },
];

// Estimate sizes for common forum platforms
const PLATFORM_MULTIPLIERS = {
  vbulletin: { threads_per_section: 30, posts_per_thread: 45, images_per_thread: 120 },
  xenforo: { threads_per_section: 25, posts_per_thread: 35, images_per_thread: 90 },
  phpbb: { threads_per_section: 20, posts_per_thread: 25, images_per_thread: 50 },
  discourse: { threads_per_section: 30, posts_per_thread: 40, images_per_thread: 80 },
  invision: { threads_per_section: 25, posts_per_thread: 30, images_per_thread: 70 },
  custom: { threads_per_section: 20, posts_per_thread: 30, images_per_thread: 60 },
};

async function testForumAccess(url) {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/test-forum-fetch`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    });
    return await response.json();
  } catch (e) {
    return { error: e.message };
  }
}

async function countThreadsInPage(html) {
  let maxCount = 0;
  let matchedPattern = null;

  for (const { name, pattern } of THREAD_PATTERNS) {
    const matches = [...html.matchAll(pattern)];
    if (matches.length > maxCount) {
      maxCount = matches.length;
      matchedPattern = name;
    }
  }

  return { count: maxCount, pattern: matchedPattern };
}

async function main() {
  // Get all forums
  const { data: forums } = await supabase
    .from('forum_sources')
    .select('*')
    .order('name');

  console.log(`\nSizing ${forums?.length || 0} forum targets...\n`);
  console.log('Testing accessibility from Supabase edge functions...\n');

  const results = [];

  for (const forum of forums || []) {
    process.stdout.write(`Testing ${forum.slug}... `);

    const result = await testForumAccess(forum.base_url);

    let status = 'unknown';
    let threads = 0;
    let pattern = null;

    if (result.status === 403 || result.botIndicators?.cloudflare) {
      status = 'cloudflare_blocked';
    } else if (result.status === 200) {
      if (result.threadsFound > 0) {
        status = 'accessible';
        threads = result.threadsFound;
        pattern = 'vbulletin';
      } else {
        // Try other patterns
        const { count, pattern: p } = await countThreadsInPage(result.htmlSnippet || '');
        if (count > 0) {
          status = 'accessible';
          threads = count;
          pattern = p;
        } else {
          status = 'needs_mapping';
        }
      }
    } else if (result.status >= 400) {
      status = 'error_' + result.status;
    } else if (result.error) {
      status = 'fetch_error';
    }

    // Estimate data potential
    const multiplier = PLATFORM_MULTIPLIERS[forum.platform_type] || PLATFORM_MULTIPLIERS.custom;
    const estimatedSections = 5; // Conservative estimate
    const estimatedThreads = threads > 0 ? threads * 50 : estimatedSections * multiplier.threads_per_section * 20;
    const estimatedPosts = estimatedThreads * multiplier.posts_per_thread;
    const estimatedImages = estimatedThreads * multiplier.images_per_thread;

    results.push({
      slug: forum.slug,
      name: forum.name,
      platform: forum.platform_type,
      status,
      threads_sample: threads,
      pattern,
      estimated_threads: estimatedThreads,
      estimated_posts: estimatedPosts,
      estimated_images: estimatedImages,
    });

    // Update forum in database
    await supabase
      .from('forum_sources')
      .update({
        inspection_status: status === 'accessible' ? 'inspected' : status,
        estimated_build_count: estimatedThreads,
        last_inspected_at: new Date().toISOString(),
      })
      .eq('id', forum.id);

    const icon = status === 'accessible' ? '✅' :
                 status === 'cloudflare_blocked' ? '🚫' :
                 status === 'needs_mapping' ? '🔧' : '❌';
    console.log(`${icon} ${status} (${threads} threads)`);

    // Rate limit
    await new Promise(r => setTimeout(r, 300));
  }

  // Generate report
  console.log('\n' + '='.repeat(80));
  console.log('FORUM TARGET SIZING REPORT');
  console.log('='.repeat(80));

  const accessible = results.filter(r => r.status === 'accessible');
  const blocked = results.filter(r => r.status === 'cloudflare_blocked');
  const needsMapping = results.filter(r => r.status === 'needs_mapping');
  const errors = results.filter(r => r.status.startsWith('error') || r.status === 'fetch_error');

  // Summary
  console.log('\n📊 SUMMARY');
  console.log('─'.repeat(40));
  console.log(`Total Forums:        ${results.length}`);
  console.log(`✅ Accessible:       ${accessible.length} (${Math.round(100*accessible.length/results.length)}%)`);
  console.log(`🚫 Cloudflare:       ${blocked.length} (${Math.round(100*blocked.length/results.length)}%)`);
  console.log(`🔧 Needs Mapping:    ${needsMapping.length} (${Math.round(100*needsMapping.length/results.length)}%)`);
  console.log(`❌ Errors:           ${errors.length} (${Math.round(100*errors.length/results.length)}%)`);

  // Accessible forums sorted by potential
  console.log('\n✅ ACCESSIBLE FORUMS (Ready to Extract)');
  console.log('─'.repeat(70));
  const sortedAccessible = accessible.sort((a, b) => b.estimated_posts - a.estimated_posts);
  let totalAccessiblePosts = 0;
  let totalAccessibleImages = 0;
  for (const f of sortedAccessible.slice(0, 30)) {
    console.log(`${f.slug.padEnd(25)} ${f.platform?.padEnd(10) || 'unknown'.padEnd(10)} ~${f.estimated_threads.toLocaleString().padStart(7)} threads | ~${f.estimated_posts.toLocaleString().padStart(9)} posts`);
    totalAccessiblePosts += f.estimated_posts;
    totalAccessibleImages += f.estimated_images;
  }
  if (sortedAccessible.length > 30) {
    console.log(`  ... and ${sortedAccessible.length - 30} more`);
  }

  // Blocked forums (need residential proxy)
  console.log('\n🚫 CLOUDFLARE BLOCKED (Need Residential Proxy)');
  console.log('─'.repeat(70));
  const sortedBlocked = blocked.sort((a, b) => b.estimated_posts - a.estimated_posts);
  let totalBlockedPosts = 0;
  let totalBlockedImages = 0;
  for (const f of sortedBlocked) {
    console.log(`${f.slug.padEnd(25)} ${f.platform?.padEnd(10) || 'unknown'.padEnd(10)} ~${f.estimated_threads.toLocaleString().padStart(7)} threads | ~${f.estimated_posts.toLocaleString().padStart(9)} posts`);
    totalBlockedPosts += f.estimated_posts;
    totalBlockedImages += f.estimated_images;
  }

  // Needs mapping
  if (needsMapping.length > 0) {
    console.log('\n🔧 NEEDS SELECTOR MAPPING');
    console.log('─'.repeat(70));
    for (const f of needsMapping.slice(0, 20)) {
      console.log(`${f.slug.padEnd(25)} ${f.platform?.padEnd(10) || 'unknown'.padEnd(10)}`);
    }
    if (needsMapping.length > 20) {
      console.log(`  ... and ${needsMapping.length - 20} more`);
    }
  }

  // Data potential
  console.log('\n💰 DATA POTENTIAL ESTIMATE');
  console.log('─'.repeat(70));
  console.log(`\nAccessible Forums (${accessible.length}):`);
  console.log(`  Estimated Posts:  ${totalAccessiblePosts.toLocaleString()}`);
  console.log(`  Estimated Images: ${totalAccessibleImages.toLocaleString()}`);

  console.log(`\nBlocked Forums (${blocked.length}) - With Residential Proxy:`);
  console.log(`  Estimated Posts:  ${totalBlockedPosts.toLocaleString()}`);
  console.log(`  Estimated Images: ${totalBlockedImages.toLocaleString()}`);

  const totalPosts = totalAccessiblePosts + totalBlockedPosts;
  const totalImages = totalAccessibleImages + totalBlockedImages;
  console.log(`\nTOTAL POTENTIAL:`);
  console.log(`  Posts:  ${totalPosts.toLocaleString()}`);
  console.log(`  Images: ${totalImages.toLocaleString()}`);

  // ROI for residential proxy
  console.log('\n🔑 RESIDENTIAL PROXY ROI');
  console.log('─'.repeat(70));
  console.log(`Blocked forums contain ~${Math.round(100*totalBlockedPosts/totalPosts)}% of total data potential`);
  console.log(`Major blocked targets: ${blocked.slice(0, 5).map(b => b.slug).join(', ')}`);

  // Save results
  const fs = await import('fs');
  fs.writeFileSync('/tmp/forum-sizing-report.json', JSON.stringify({
    generated: new Date().toISOString(),
    summary: {
      total: results.length,
      accessible: accessible.length,
      blocked: blocked.length,
      needs_mapping: needsMapping.length,
      errors: errors.length,
    },
    data_potential: {
      accessible_posts: totalAccessiblePosts,
      accessible_images: totalAccessibleImages,
      blocked_posts: totalBlockedPosts,
      blocked_images: totalBlockedImages,
      total_posts: totalPosts,
      total_images: totalImages,
    },
    forums: results,
  }, null, 2));

  console.log('\n📁 Full report saved to /tmp/forum-sizing-report.json');
}

main();
