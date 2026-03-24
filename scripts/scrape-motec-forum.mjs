#!/usr/bin/env node
// scrape-motec-forum.mjs — Extract all threads from MoTeC Global Forum
// Targets: M1 ECUs (f=53), PDM (f=17), Sensors/Valves/Wiring (f=24)
//
// Usage:
//   dotenvx run -- node scripts/scrape-motec-forum.mjs                    # scrape all forums
//   dotenvx run -- node scripts/scrape-motec-forum.mjs --forum 17         # PDM forum only
//   dotenvx run -- node scripts/scrape-motec-forum.mjs --forum 53 --pages 5  # first 5 pages of M1
//   dotenvx run -- node scripts/scrape-motec-forum.mjs --threads-only     # just thread list, no content

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const FORUMS = [
  { id: 53, name: 'M1 ECUs', topics: 937, postsTotal: 4686 },
  { id: 17, name: 'PDM15/16/30/32', topics: 218, postsTotal: 1088 },
  { id: 24, name: 'Sensors Valves Wiring', topics: 139, postsTotal: 691 },
];

const BASE_URL = 'https://forum.motec.com.au';
const DELAY_LISTING = 2000;  // 2s between listing pages
const DELAY_THREAD = 3000;   // 3s between thread fetches
const TOPICS_PER_PAGE = 25;  // phpBB default

const FORUM_FILTER = process.argv.find((a, i) => process.argv[i-1] === '--forum');
const MAX_PAGES = parseInt(process.argv.find((a, i) => process.argv[i-1] === '--pages') || '999');
const THREADS_ONLY = process.argv.includes('--threads-only');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Parse phpBB forum listing page for thread metadata
function parseForumPage(html) {
  const threads = [];
  // phpBB topic rows have class "row" and contain topic links
  const topicRegex = /viewtopic\.php\?f=(\d+)&amp;t=(\d+)[^"]*"[^>]*class="topictitle"[^>]*>([^<]+)/g;
  let match;
  while ((match = topicRegex.exec(html)) !== null) {
    threads.push({
      forum_id: parseInt(match[1]),
      topic_id: parseInt(match[2]),
      title: match[3].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'").trim(),
    });
  }

  // Also try alternate phpBB HTML patterns
  if (threads.length === 0) {
    const altRegex = /href="\.\/viewtopic\.php\?f=(\d+)&amp;t=(\d+)"[^>]*class="topictitle">([^<]+)/g;
    while ((match = altRegex.exec(html)) !== null) {
      threads.push({
        forum_id: parseInt(match[1]),
        topic_id: parseInt(match[2]),
        title: match[3].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'").trim(),
      });
    }
  }

  // Extract author from the same row
  const authorRegex = /topictitle[\s\S]*?username[^>]*>([^<]+)/g;
  let authorIdx = 0;
  while ((match = authorRegex.exec(html)) !== null && authorIdx < threads.length) {
    threads[authorIdx].author = match[1].trim();
    authorIdx++;
  }

  return threads;
}

// Parse thread page for individual posts
function parseThreadPage(html) {
  const posts = [];

  // Extract posts using phpBB post structure
  // Each post has a postbody div with author and content
  const postRegex = /class="postbody"[\s\S]*?class="author"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>[\s\S]*?class="content"[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>\s*)*<\/div>\s*(?:<div class="post|$)/g;
  let match;
  while ((match = postRegex.exec(html)) !== null) {
    const author = match[1].trim();
    const rawContent = match[2];
    // Strip HTML tags for clean text
    const content = rawContent
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (content.length > 10) {
      posts.push({
        author,
        content: content.slice(0, 5000), // Cap at 5000 chars per post
        is_motec_staff: author.toLowerCase().includes('motec') || author.toLowerCase() === 'admin',
      });
    }
  }

  // Simpler fallback: just grab all text within postbody/content divs
  if (posts.length === 0) {
    const simpleRegex = /class="content"[^>]*>([\s\S]*?)<\/div>/g;
    while ((match = simpleRegex.exec(html)) !== null) {
      const content = match[1]
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&[a-z]+;/gi, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (content.length > 20) {
        posts.push({ author: 'unknown', content: content.slice(0, 5000), is_motec_staff: false });
      }
    }
  }

  // Extract view count
  const viewMatch = html.match(/(\d+)\s*(?:views|Views)/);
  const viewCount = viewMatch ? parseInt(viewMatch[1]) : null;

  return { posts, viewCount };
}

async function fetchPage(url) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'NukeVehiclePlatform/1.0 (technical-reference-indexer)',
      'Accept': 'text/html',
    },
    redirect: 'follow',
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return resp.text();
}

async function scrapeForumListings(forum) {
  const allThreads = [];
  const totalPages = Math.min(Math.ceil(forum.topics / TOPICS_PER_PAGE), MAX_PAGES);

  console.log(`\n=== ${forum.name} (f=${forum.id}) — ~${forum.topics} topics, ${totalPages} pages ===`);

  for (let page = 0; page < totalPages; page++) {
    const start = page * TOPICS_PER_PAGE;
    const url = `${BASE_URL}/viewforum.php?f=${forum.id}&start=${start}`;
    process.stdout.write(`  Page ${page + 1}/${totalPages} (start=${start})... `);

    try {
      const html = await fetchPage(url);
      const threads = parseForumPage(html);

      // Tag with forum info
      for (const t of threads) {
        t.forum_id = forum.id;
        t.forum_name = forum.name;
      }

      allThreads.push(...threads);
      console.log(`${threads.length} threads`);
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
    }

    await sleep(DELAY_LISTING);
  }

  return allThreads;
}

async function scrapeThread(thread) {
  const url = `${BASE_URL}/viewtopic.php?f=${thread.forum_id}&t=${thread.topic_id}`;

  try {
    const html = await fetchPage(url);
    const { posts, viewCount } = parseThreadPage(html);

    // Check for multiple pages
    let allPosts = [...posts];
    const pageLinks = html.match(/viewtopic\.php\?f=\d+&amp;t=\d+&amp;start=(\d+)/g);
    if (pageLinks) {
      const maxStart = Math.max(...pageLinks.map(l => parseInt(l.match(/start=(\d+)/)[1])));
      // Fetch up to 3 additional pages
      for (let start = 15; start <= Math.min(maxStart, 45); start += 15) {
        await sleep(DELAY_THREAD);
        try {
          const pageHtml = await fetchPage(`${url}&start=${start}`);
          const { posts: morePosts } = parseThreadPage(pageHtml);
          allPosts.push(...morePosts);
        } catch {}
      }
    }

    return { posts: allPosts, viewCount, raw_html: html.slice(0, 50000) };
  } catch (e) {
    return { posts: [], viewCount: null, raw_html: null, error: e.message };
  }
}

async function main() {
  const targetForums = FORUM_FILTER
    ? FORUMS.filter(f => f.id === parseInt(FORUM_FILTER))
    : FORUMS;

  console.log('MoTeC Forum Scraper');
  console.log(`Forums: ${targetForums.map(f => f.name).join(', ')}`);
  console.log(`Mode: ${THREADS_ONLY ? 'Thread listings only' : 'Full thread content'}`);
  console.log('');

  let totalInserted = 0;

  for (const forum of targetForums) {
    // Step 1: Get thread listings
    const threads = await scrapeForumListings(forum);
    console.log(`  Total threads found: ${threads.length}`);

    // Step 2: Check which threads we already have
    const existingTopics = new Set();
    const { data: existing } = await supabase
      .from('motec_forum_threads')
      .select('topic_id')
      .eq('forum_id', forum.id);
    if (existing) existing.forEach(e => existingTopics.add(e.topic_id));

    const newThreads = threads.filter(t => !existingTopics.has(t.topic_id));
    console.log(`  New threads to fetch: ${newThreads.length} (${existingTopics.size} already in DB)`);

    if (THREADS_ONLY) {
      // Just insert thread metadata without content
      for (const t of newThreads) {
        const { error } = await supabase.from('motec_forum_threads').upsert({
          forum_id: t.forum_id,
          forum_name: t.forum_name,
          topic_id: t.topic_id,
          title: t.title,
          author: t.author || null,
        }, { onConflict: 'topic_id' });
        if (!error) totalInserted++;
      }
      console.log(`  Inserted ${newThreads.length} thread records (metadata only)`);
      continue;
    }

    // Step 3: Fetch full thread content for new threads
    let fetched = 0;
    for (const t of newThreads) {
      fetched++;
      process.stdout.write(`  [${fetched}/${newThreads.length}] t=${t.topic_id} ${t.title.slice(0, 50).padEnd(52)}`);

      const result = await scrapeThread(t);

      const { error } = await supabase.from('motec_forum_threads').upsert({
        forum_id: t.forum_id,
        forum_name: t.forum_name,
        topic_id: t.topic_id,
        title: t.title,
        author: t.author || (result.posts[0]?.author) || null,
        post_count: result.posts.length,
        view_count: result.viewCount,
        posts: result.posts,
        raw_html: result.raw_html,
      }, { onConflict: 'topic_id' });

      if (error) {
        console.log(`ERROR: ${error.message}`);
      } else {
        totalInserted++;
        console.log(`${result.posts.length} posts`);
      }

      await sleep(DELAY_THREAD);
    }
  }

  console.log(`\nDone. Total inserted/updated: ${totalInserted}`);

  // Show summary
  const { data: summary } = await supabase
    .from('motec_forum_threads')
    .select('forum_name')
    .then(({ data }) => {
      const counts = {};
      data?.forEach(r => { counts[r.forum_name] = (counts[r.forum_name] || 0) + 1; });
      return { data: counts };
    });
  console.log('DB totals:', summary);
}

main().catch(console.error);
