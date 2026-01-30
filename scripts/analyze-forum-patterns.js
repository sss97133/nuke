#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Different thread patterns for various forum platforms
const THREAD_PATTERNS = [
  { name: 'vbulletin_thread_title', pattern: /id="thread_title_(\d+)"/g },
  { name: 'xenforo_preview_tooltip', pattern: /data-preview-url="[^"]*threads\/[^"]*"/g },
  { name: 'xenforo_structItem', pattern: /<div class="structItem[^"]*"[^>]*data-author/g },
  { name: 'href_threads', pattern: /href="[^"]*\/threads\/[^"]*"/g },
  { name: 'href_showthread', pattern: /href="[^"]*showthread\.php[^"]*"/g },
  { name: 'href_topic', pattern: /href="[^"]*\/topic\/[^"]*"/g },
  { name: 'href_viewtopic', pattern: /href="[^"]*viewtopic\.php[^"]*"/g },
  { name: 'data_thread_id', pattern: /data-thread-id="(\d+)"/g },
  { name: 'li_discussionListItem', pattern: /<li[^>]*class="[^"]*discussionListItem[^"]*"/g },
  { name: 'article_thread', pattern: /<article[^>]*class="[^"]*thread[^"]*"/g },
  { name: 'tr_thread_row', pattern: /<tr[^>]*class="[^"]*thread[^"]*"/g },
  { name: 'div_threadbit', pattern: /<div[^>]*class="[^"]*threadbit[^"]*"/g },
  { name: 'li_threadbit', pattern: /<li[^>]*class="[^"]*threadbit[^"]*"/g },
];

async function analyzeForumHTML(url) {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/test-forum-fetch`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    });
    const data = await response.json();

    if (data.status !== 200) {
      return { status: data.status, blocked: true };
    }

    // Need full HTML for pattern analysis - use direct fetch since we're testing from local
    const directResponse = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!directResponse.ok) {
      return { status: directResponse.status, blocked: true };
    }

    const html = await directResponse.text();
    const patterns = {};

    for (const { name, pattern } of THREAD_PATTERNS) {
      const matches = [...html.matchAll(pattern)];
      if (matches.length > 0) {
        patterns[name] = matches.length;
      }
    }

    return { status: 200, htmlLength: html.length, patterns };
  } catch (e) {
    return { error: e.message };
  }
}

async function main() {
  // Test a subset of the "other" forums to identify patterns
  const testForums = [
    { slug: 'chevelles', url: 'https://chevelles.com/threads/' },
    { slug: 'camaros-net', url: 'https://www.camaros.net/forums/showthread.php?t=337188' },
    { slug: 'forabodiesonly', url: 'https://www.forabodiesonly.com/mopar/forums/general-discussion.3/' },
    { slug: 'hotrodders', url: 'https://www.hotrodders.com/forum/forumdisplay.php?f=120' },
    { slug: 'vwvortex', url: 'https://www.vwvortex.com/forums/volkswagen-news-blog.1/' },
    { slug: 'ft86club', url: 'https://www.ft86club.com/forums/forumdisplay.php?f=39' },
    { slug: 'jeepforum', url: 'https://www.jeepforum.com/forums/stock-jk-tech.123/' },
    { slug: 'ih8mud', url: 'https://forum.ih8mud.com/forums/60-series-wagons.6/' },
    { slug: 'nastyz28', url: 'https://nastyz28.com/forums/general-discussion.61/' },
    { slug: 'ferrarichat', url: 'https://www.ferrarichat.com/forum/forums/technical-q-a.3/' },
  ];

  console.log('Analyzing HTML patterns from local machine (not data center)...\n');

  for (const { slug, url } of testForums) {
    console.log(`\n${slug}:`);
    console.log(`  URL: ${url}`);

    const result = await analyzeForumHTML(url);

    if (result.blocked) {
      console.log(`  ❌ Blocked (HTTP ${result.status})`);
      continue;
    }

    if (result.error) {
      console.log(`  ❌ Error: ${result.error}`);
      continue;
    }

    console.log(`  HTML: ${result.htmlLength} bytes`);

    if (Object.keys(result.patterns).length === 0) {
      console.log('  ⚠️  No known patterns found');
    } else {
      console.log('  Patterns found:');
      for (const [name, count] of Object.entries(result.patterns)) {
        console.log(`    - ${name}: ${count}`);
      }
    }

    await new Promise(r => setTimeout(r, 500));
  }
}

main();
