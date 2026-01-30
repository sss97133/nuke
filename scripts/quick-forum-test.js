#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Test forums that were accessible before
const testUrls = [
  { slug: 'pelican-parts', url: 'https://forums.pelicanparts.com/porsche-911-technical-forum/' },
  { slug: 'lateral-g', url: 'https://www.lateral-g.net/forums/showthread.php?t=1' },
  { slug: 'vwvortex', url: 'https://www.vwvortex.com/forums/volkswagen-news-blog.1/' },
  { slug: 'nastyz28', url: 'https://nastyz28.com/forums/general-discussion.61/' },
  { slug: 'ih8mud', url: 'https://forum.ih8mud.com/forums/60-series-wagons.6/' },
];

async function testForum(url) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/test-forum-fetch`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url }),
  });
  return response.json();
}

async function main() {
  console.log('Quick forum accessibility test with XenForo patterns...\n');

  for (const { slug, url } of testUrls) {
    console.log(`Testing ${slug}...`);
    const result = await testForum(url);

    const status = result.status === 403 ? '🚫 BLOCKED' :
                   result.status === 200 ? '✅ OK' : `❌ ${result.status}`;

    // Count XenForo patterns in HTML
    let xfThreads = 0;
    if (result.htmlSnippet) {
      const xfMatches = result.htmlSnippet.match(/\/threads\/[^"]*\.\d+/g);
      xfThreads = xfMatches ? xfMatches.length : 0;
    }

    console.log(`  ${status} | vB: ${result.threadsFound || 0} | XF: ${xfThreads} | HTML: ${result.htmlLength || 0}`);
  }

  // Also get current database stats
  const { count: forumCount } = await supabase.from('forum_sources').select('*', { count: 'exact', head: true });
  const { count: threadCount } = await supabase.from('build_threads').select('*', { count: 'exact', head: true });

  console.log(`\nDatabase stats:`);
  console.log(`  Forums: ${forumCount}`);
  console.log(`  Build threads discovered: ${threadCount}`);
}

main();
