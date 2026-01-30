#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Estimation constants
const ESTIMATES = {
  // Discovery phase
  pages_per_forum_section: 20,      // Average pages of thread listings per section
  sections_per_forum: 3,            // Average build sections per forum
  threads_per_page: 25,             // Threads listed per page

  // Extraction phase
  pages_per_thread_avg: 8,          // Average pages per build thread
  posts_per_page: 15,               // Posts per thread page

  // Forum size tiers (based on community size)
  large_forums: ['rennlist', 'corvetteforum', 'bimmerforums', 'vwvortex', 'honda-tech',
                 'ls1tech', 'nasioc', 'tacomaworld', 'jeepforum', 'f150forum'],
  medium_forums_multiplier: 1.0,
  large_forums_multiplier: 2.5,
};

async function main() {
  // Get all forums with their status
  const { data: forums } = await supabase
    .from('forum_sources')
    .select('slug, name, platform_type, inspection_status, estimated_build_count')
    .order('slug');

  // Get existing thread counts
  const { data: threadCounts } = await supabase
    .from('build_threads')
    .select('forum_source_id')
    .then(async (res) => {
      // Group by forum
      const counts = {};
      for (const t of res.data || []) {
        counts[t.forum_source_id] = (counts[t.forum_source_id] || 0) + 1;
      }
      return { data: counts };
    });

  // Categorize forums
  const cloudflareBlocked = forums?.filter(f =>
    f.inspection_status === 'cloudflare_blocked'
  ) || [];

  const accessible = forums?.filter(f =>
    f.inspection_status === 'inspected' || f.inspection_status === 'active'
  ) || [];

  const needsMapping = forums?.filter(f =>
    f.inspection_status === 'needs_mapping' || f.inspection_status === 'pending'
  ) || [];

  console.log('=' .repeat(80));
  console.log('FIRECRAWL CREDIT ESTIMATION');
  console.log('=' .repeat(80));

  console.log('\n📊 FORUM BREAKDOWN');
  console.log('─'.repeat(50));
  console.log(`Total forums:           ${forums?.length || 0}`);
  console.log(`Cloudflare blocked:     ${cloudflareBlocked.length} (need Firecrawl)`);
  console.log(`Accessible (direct):    ${accessible.length} (free, no Firecrawl needed)`);
  console.log(`Needs mapping/pending:  ${needsMapping.length} (may need Firecrawl)`);

  // Phase 1: Discovery - Thread listing pages
  console.log('\n\n📋 PHASE 1: THREAD DISCOVERY');
  console.log('─'.repeat(50));

  let discoveryCredits = 0;
  const discoveryDetails = [];

  // Only blocked forums need Firecrawl for discovery
  for (const forum of cloudflareBlocked) {
    const isLarge = ESTIMATES.large_forums.includes(forum.slug);
    const multiplier = isLarge ? ESTIMATES.large_forums_multiplier : ESTIMATES.medium_forums_multiplier;
    const sections = Math.ceil(ESTIMATES.sections_per_forum * multiplier);
    const pagesPerSection = Math.ceil(ESTIMATES.pages_per_forum_section * multiplier);
    const credits = sections * pagesPerSection;

    discoveryCredits += credits;
    discoveryDetails.push({ slug: forum.slug, credits, isLarge });
  }

  // Also estimate for "needs mapping" forums (assume 50% need Firecrawl)
  const needsMappingCredits = Math.ceil(needsMapping.length * 0.5 * ESTIMATES.sections_per_forum * ESTIMATES.pages_per_forum_section);
  discoveryCredits += needsMappingCredits;

  console.log(`\nBlocked forums (${cloudflareBlocked.length}):`);

  // Show top 10 largest
  const sortedDiscovery = discoveryDetails.sort((a, b) => b.credits - a.credits);
  for (const d of sortedDiscovery.slice(0, 10)) {
    console.log(`  ${d.slug.padEnd(25)} ${d.credits.toLocaleString().padStart(6)} credits ${d.isLarge ? '(large)' : ''}`);
  }
  if (sortedDiscovery.length > 10) {
    const remaining = sortedDiscovery.slice(10).reduce((s, d) => s + d.credits, 0);
    console.log(`  ... ${sortedDiscovery.length - 10} more forums: ${remaining.toLocaleString()} credits`);
  }

  console.log(`\nNeeds mapping (50% estimate): ${needsMappingCredits.toLocaleString()} credits`);
  console.log(`\n  DISCOVERY TOTAL: ${discoveryCredits.toLocaleString()} credits`);

  // Phase 2: Thread Extraction
  console.log('\n\n📄 PHASE 2: THREAD EXTRACTION');
  console.log('─'.repeat(50));

  // Estimate threads to extract
  const threadsPerLargeForum = 500;
  const threadsPerMediumForum = 150;

  let extractionCredits = 0;
  const extractionDetails = [];

  for (const forum of cloudflareBlocked) {
    const isLarge = ESTIMATES.large_forums.includes(forum.slug);
    const estThreads = isLarge ? threadsPerLargeForum : threadsPerMediumForum;
    const pagesPerThread = ESTIMATES.pages_per_thread_avg * (isLarge ? 1.5 : 1);
    const credits = Math.ceil(estThreads * pagesPerThread);

    extractionCredits += credits;
    extractionDetails.push({
      slug: forum.slug,
      threads: estThreads,
      credits,
      isLarge
    });
  }

  // Needs mapping forums (50%)
  const needsMappingExtraction = Math.ceil(needsMapping.length * 0.5 * threadsPerMediumForum * ESTIMATES.pages_per_thread_avg);
  extractionCredits += needsMappingExtraction;

  console.log(`\nBlocked forums (${cloudflareBlocked.length}):`);

  const sortedExtraction = extractionDetails.sort((a, b) => b.credits - a.credits);
  for (const d of sortedExtraction.slice(0, 10)) {
    console.log(`  ${d.slug.padEnd(25)} ~${d.threads.toLocaleString().padStart(4)} threads × ${ESTIMATES.pages_per_thread_avg} pages = ${d.credits.toLocaleString().padStart(7)} credits`);
  }
  if (sortedExtraction.length > 10) {
    const remaining = sortedExtraction.slice(10).reduce((s, d) => s + d.credits, 0);
    console.log(`  ... ${sortedExtraction.length - 10} more forums: ${remaining.toLocaleString()} credits`);
  }

  console.log(`\nNeeds mapping (50% estimate): ${needsMappingExtraction.toLocaleString()} credits`);
  console.log(`\n  EXTRACTION TOTAL: ${extractionCredits.toLocaleString()} credits`);

  // Summary
  const totalCredits = discoveryCredits + extractionCredits;
  const buffer = Math.ceil(totalCredits * 0.2); // 20% buffer for retries/errors
  const grandTotal = totalCredits + buffer;

  console.log('\n\n' + '=' .repeat(80));
  console.log('💰 CREDIT SUMMARY');
  console.log('=' .repeat(80));

  console.log(`\n  Phase 1 (Discovery):     ${discoveryCredits.toLocaleString().padStart(10)} credits`);
  console.log(`  Phase 2 (Extraction):    ${extractionCredits.toLocaleString().padStart(10)} credits`);
  console.log(`  ─────────────────────────────────────`);
  console.log(`  Subtotal:                ${totalCredits.toLocaleString().padStart(10)} credits`);
  console.log(`  Buffer (20%):            ${buffer.toLocaleString().padStart(10)} credits`);
  console.log(`  ═════════════════════════════════════`);
  console.log(`  GRAND TOTAL:             ${grandTotal.toLocaleString().padStart(10)} credits`);

  // Cost breakdown
  console.log('\n\n💵 FIRECRAWL PLAN RECOMMENDATION');
  console.log('─'.repeat(50));

  const plans = [
    { name: 'Hobby', price: 16, credits: 3000 },
    { name: 'Standard', price: 83, credits: 100000 },
    { name: 'Growth', price: 333, credits: 500000 },
  ];

  for (const plan of plans) {
    const monthsNeeded = Math.ceil(grandTotal / plan.credits);
    const totalCost = monthsNeeded * plan.price;
    const sufficient = plan.credits >= grandTotal;

    console.log(`\n  ${plan.name} ($${plan.price}/mo - ${plan.credits.toLocaleString()} credits):`);
    if (sufficient) {
      console.log(`    ✅ Covers everything in 1 month = $${plan.price}`);
    } else {
      console.log(`    ⚠️  Need ${monthsNeeded} months = $${totalCost}`);
    }
  }

  // Data value estimate
  console.log('\n\n📈 EXPECTED DATA YIELD');
  console.log('─'.repeat(50));

  const estTotalThreads = cloudflareBlocked.reduce((s, f) => {
    return s + (ESTIMATES.large_forums.includes(f.slug) ? threadsPerLargeForum : threadsPerMediumForum);
  }, 0) + Math.ceil(needsMapping.length * 0.5 * threadsPerMediumForum);

  const estTotalPosts = estTotalThreads * ESTIMATES.pages_per_thread_avg * ESTIMATES.posts_per_page;
  const estTotalImages = estTotalPosts * 2.5; // ~2.5 images per post average

  console.log(`  Build threads:     ~${estTotalThreads.toLocaleString()}`);
  console.log(`  Forum posts:       ~${estTotalPosts.toLocaleString()}`);
  console.log(`  Images:            ~${estTotalImages.toLocaleString()}`);
  console.log(`\n  User profiles:     ~${Math.ceil(estTotalThreads * 1.2).toLocaleString()} (thread authors + active commenters)`);
  console.log(`  Vehicle profiles:  ~${Math.ceil(estTotalThreads * 0.8).toLocaleString()} (threads with identifiable vehicles)`);
  console.log(`  Org mentions:      ~${Math.ceil(estTotalPosts * 0.15).toLocaleString()} (shops, parts suppliers, etc.)`);

  // Save report
  const report = {
    generated: new Date().toISOString(),
    forums: {
      total: forums?.length || 0,
      cloudflare_blocked: cloudflareBlocked.length,
      accessible: accessible.length,
      needs_mapping: needsMapping.length,
    },
    credits: {
      discovery: discoveryCredits,
      extraction: extractionCredits,
      buffer,
      total: grandTotal,
    },
    data_yield: {
      threads: estTotalThreads,
      posts: estTotalPosts,
      images: estTotalImages,
      user_profiles: Math.ceil(estTotalThreads * 1.2),
      vehicle_profiles: Math.ceil(estTotalThreads * 0.8),
      org_mentions: Math.ceil(estTotalPosts * 0.15),
    },
    plan_recommendation: 'Standard ($83/mo for 100K credits)',
  };

  const fs = await import('fs');
  fs.writeFileSync('/tmp/firecrawl-credit-estimate.json', JSON.stringify(report, null, 2));
  console.log('\n\n📁 Full report saved to /tmp/firecrawl-credit-estimate.json');
}

main();
