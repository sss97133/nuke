#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Forums we know are Cloudflare-blocked from testing
const CLOUDFLARE_BLOCKED = [
  'rennlist', 'corvetteforum', 'ls1tech', 'honda-tech', 's2ki', 'thirdgen',
  'bimmerforums', 'rx7club', 'broncozone', '5thgenrams', '6speedonline',
  'aaca', 'audiforums', 'audiworld', 'audizine', 'automotiveforums',
  'bobistheoilguy', 'buickforums', 'carforum', 'civicforums', 'civicxi',
  'classicmotorsports', 'classicoldsmobile', 'classiczcars', 'clubcivic',
  'clublexus', 'defender2', 'driftworks', 'dsmtuners', 'f150forum',
  'f150-forums', 'f150online', 'ferrarichat', 'fitfreak', 'fordf150net',
  'ford-trucks', 'germancarforum', 'gmt400', 'gm-trucks', 'grassrootsmotorsports',
  'gtplanet', 'hondacivicforum', 'infinitiforum', 'jalopyjournal',
  'jeepgladiatorforum', 'jlwranglerforums', 'm3cutters', 'mbworld',
  'mercedesforum', 'mgexperience', 'miatanet', 'miataturbo', 'nasioc',
  'nicoclub', 'offroadpassport', 'performancetrucks', 'pontiaczone',
  'tacoma4g', 'thesubaruforums', 'thetruckstop', 'wranglertjforum',
  '67-72chevytrucks',
];

async function main() {
  console.log('Labeling forums as untapped sources...\n');

  // Update Cloudflare-blocked forums
  for (const slug of CLOUDFLARE_BLOCKED) {
    await supabase
      .from('forum_sources')
      .update({ inspection_status: 'untapped_cloudflare' })
      .eq('slug', slug);
  }
  console.log(`Marked ${CLOUDFLARE_BLOCKED.length} forums as untapped_cloudflare`);

  // Mark remaining pending as untapped_needs_work
  const { data: pending } = await supabase
    .from('forum_sources')
    .update({ inspection_status: 'untapped_needs_work' })
    .eq('inspection_status', 'pending')
    .select('id');

  console.log(`Marked ${pending?.length || 0} forums as untapped_needs_work`);

  // Get final summary
  const { data: forums } = await supabase
    .from('forum_sources')
    .select('inspection_status, estimated_build_count');

  const counts = {};
  const estimates = {};
  for (const f of forums || []) {
    const s = f.inspection_status || 'unknown';
    counts[s] = (counts[s] || 0) + 1;
    estimates[s] = (estimates[s] || 0) + (f.estimated_build_count || 0);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('📦 FORUM INVENTORY - READY FOR FUTURE EXPANSION');
  console.log('═'.repeat(60));

  const order = ['active', 'mapped', 'inspected', 'untapped_cloudflare', 'untapped_needs_work'];
  const labels = {
    active: '🟢 Active (extracting)',
    mapped: '📍 Mapped (ready)',
    inspected: '👁️ Inspected',
    untapped_cloudflare: '🔒 Untapped - Cloudflare (needs Firecrawl $)',
    untapped_needs_work: '🔧 Untapped - Needs work (selectors/URLs)',
  };

  for (const status of order) {
    if (counts[status]) {
      const label = labels[status] || status;
      const threads = estimates[status] || 0;
      console.log(`\n  ${label}`);
      console.log(`     ${counts[status]} forums | ~${threads.toLocaleString()} est. threads`);
    }
  }

  // Show any other statuses
  for (const [status, count] of Object.entries(counts)) {
    if (!order.includes(status)) {
      console.log(`\n  ${status}: ${count} forums`);
    }
  }

  const total = forums?.length || 0;
  const totalThreads = Object.values(estimates).reduce((a, b) => a + b, 0);
  const untappedCount = (counts['untapped_cloudflare'] || 0) + (counts['untapped_needs_work'] || 0);

  console.log('\n' + '─'.repeat(60));
  console.log(`  TOTAL: ${total} forums | ~${totalThreads.toLocaleString()} potential threads`);
  console.log(`  UNTAPPED: ${untappedCount} forums waiting for expansion`);
  console.log('═'.repeat(60));
}

main();
