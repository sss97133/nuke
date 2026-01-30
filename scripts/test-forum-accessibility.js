#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function testForum(url) {
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

async function main() {
  // Get all forums with build sections
  const { data: forums } = await supabase
    .from('forum_sources')
    .select('slug, name, dom_map')
    .not('dom_map->build_sections', 'is', null);

  console.log(`Testing ${forums?.length || 0} forums from Supabase edge function...\n`);

  const results = [];

  for (const forum of forums || []) {
    const sections = forum.dom_map?.build_sections || [];
    if (sections.length === 0) continue;

    const testUrl = sections[0].url;
    console.log(`Testing ${forum.slug}...`);

    const result = await testForum(testUrl);

    const status = {
      slug: forum.slug,
      url: testUrl,
      httpStatus: result.status,
      threadsFound: result.threadsFound || 0,
      cloudflare: result.botIndicators?.cloudflare || false,
      accessible: result.status === 200 && result.threadsFound > 0,
    };

    results.push(status);

    const icon = status.accessible ? '✅' : status.httpStatus === 403 ? '🚫' : '❓';
    console.log(`  ${icon} ${status.httpStatus} | ${status.threadsFound} threads | CF: ${status.cloudflare}`);

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  const accessible = results.filter(r => r.accessible);
  const blocked = results.filter(r => !r.accessible && r.httpStatus === 403);
  const other = results.filter(r => !r.accessible && r.httpStatus !== 403);

  console.log(`\n✅ Accessible (${accessible.length}):`);
  for (const r of accessible) {
    console.log(`   ${r.slug}: ${r.threadsFound} threads`);
  }

  console.log(`\n🚫 Blocked by Cloudflare (${blocked.length}):`);
  for (const r of blocked) {
    console.log(`   ${r.slug}`);
  }

  if (other.length > 0) {
    console.log(`\n❓ Other issues (${other.length}):`);
    for (const r of other) {
      console.log(`   ${r.slug}: HTTP ${r.httpStatus}`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(`Total: ${results.length} forums`);
  console.log(`Accessible: ${accessible.length} (${Math.round(100*accessible.length/results.length)}%)`);
  console.log(`Blocked: ${blocked.length} (${Math.round(100*blocked.length/results.length)}%)`);
}

main();
