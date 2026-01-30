/**
 * DISCOVER-BUILD-THREADS
 *
 * Crawls forum build sections to discover build threads.
 *
 * Process:
 * 1. Query forum_sources for forums with inspection_status = 'mapped' or 'active'
 * 2. For each forum, crawl build sections using DOM map
 * 3. Identify build threads by:
 *    - Section location (garage, build journals, project cars)
 *    - Title patterns (year + make + model + "build/project/restore")
 *    - Thread length (builds tend to have many posts)
 * 4. Extract vehicle hints from titles
 * 5. Insert into build_threads table
 *
 * Usage:
 *   POST /functions/v1/discover-build-threads
 *   { "forum_id": "uuid" } - discover for specific forum
 *   { "limit": 10 } - discover for N forums
 *   { "section_url": "...", "forum_id": "uuid" } - discover from specific section
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';
import { corsHeaders } from '../_shared/cors.ts';
import {
  isBuildThreadTitle,
  extractVehicleHints,
  normalizeForumUrl,
  isThreadUrl,
  type ForumDomMap,
  type BuildSection,
} from '../_shared/forumDomMap.ts';

// User agents for rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

interface DiscoveredThread {
  thread_url: string;
  thread_url_normalized: string;
  thread_title: string;
  author_handle?: string;
  author_profile_url?: string;
  reply_count?: number;
  view_count?: number;
  last_post_date?: string;
  is_sticky?: boolean;
  vehicle_hints: any;
  build_confidence: number;
}

async function fetchPage(url: string): Promise<string> {
  const delay = Math.random() * 2000 + 1000;
  await new Promise((r) => setTimeout(r, delay));

  const response = await fetch(url, {
    headers: {
      'User-Agent': getRandomUserAgent(),
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      Referer: 'https://www.google.com/',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.text();
}

function parseNumber(text: string | null | undefined): number | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/[,\s]/g, '').match(/\d+/);
  return cleaned ? parseInt(cleaned[0], 10) : undefined;
}

function parseDate(text: string | null | undefined): string | undefined {
  if (!text) return undefined;

  // Try common date formats
  const formats = [
    // "Jan 15, 2024"
    /(\w{3})\s+(\d{1,2}),?\s+(\d{4})/i,
    // "15 Jan 2024"
    /(\d{1,2})\s+(\w{3})\s+(\d{4})/i,
    // "01/15/2024" or "01-15-2024"
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
    // "2024-01-15"
    /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,
    // Relative dates
    /(\d+)\s*(minute|hour|day|week|month|year)s?\s*ago/i,
    // "Yesterday", "Today"
    /(yesterday|today)/i,
  ];

  for (const format of formats) {
    const match = text.match(format);
    if (match) {
      try {
        // For relative dates
        if (match[2] && /minute|hour|day|week|month|year/i.test(match[2])) {
          const amount = parseInt(match[1], 10);
          const unit = match[2].toLowerCase();
          const now = new Date();

          const unitMs: Record<string, number> = {
            minute: 60000,
            hour: 3600000,
            day: 86400000,
            week: 604800000,
            month: 2592000000,
            year: 31536000000,
          };

          const ms = unitMs[unit] || unitMs.day;
          return new Date(now.getTime() - amount * ms).toISOString();
        }

        // For "yesterday" / "today"
        if (/yesterday/i.test(match[0])) {
          const d = new Date();
          d.setDate(d.getDate() - 1);
          return d.toISOString();
        }
        if (/today/i.test(match[0])) {
          return new Date().toISOString();
        }

        // Try standard parsing
        const d = new Date(text);
        if (!isNaN(d.getTime())) {
          return d.toISOString();
        }
      } catch {
        // Continue to next format
      }
    }
  }

  return undefined;
}

function discoverThreadsFromHtml(
  html: string,
  baseUrl: string,
  domMap: ForumDomMap
): DiscoveredThread[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc) return [];

  const threads: DiscoveredThread[] = [];
  const selectors = domMap.thread_list_selectors;
  const seenUrls = new Set<string>();

  // Try row-based approach first
  const containerSelector = selectors.container || 'body';
  const container = doc.querySelector(containerSelector) || doc.body;

  const rowSelector = selectors.thread_row || '.thread';
  let rows = container?.querySelectorAll(rowSelector);

  console.log(`[discover] Found ${rows?.length || 0} thread rows with selector: ${rowSelector}`);

  // If row approach finds nothing, try direct link search as fallback
  if (!rows || rows.length === 0) {
    console.log(`[discover] Row selector failed, trying direct link search`);

    // Try common thread link patterns directly
    const directSelectors = [
      'a.PreviewTooltip',        // XenForo
      '.structItem-title a',      // XenForo 2
      'a.topictitle',            // phpBB
      '.topic-title a',          // Invision
      'h3.threadtitle a',        // vBulletin alt
      'h4 a',                    // vBulletin (rennlist style)
    ];

    // vBulletin special case: find links by ID pattern using regex on HTML
    // Use exec loop for better compatibility
    const vbPattern = /<a[^>]*href="([^"]+)"[^>]*id="thread_title_\d+"[^>]*>([^<]+)</g;
    let match;
    while ((match = vbPattern.exec(html)) !== null) {
      const href = match[1];
      const title = (match[2] || '').trim();

      if (!href || !title) continue;

      let threadUrl: string;
      try {
        threadUrl = new URL(href, baseUrl).toString();
      } catch {
        continue;
      }

      if (!isThreadUrl(threadUrl)) continue;
      if (seenUrls.has(threadUrl)) continue;
      seenUrls.add(threadUrl);

      const buildCheck = isBuildThreadTitle(title);
      const vehicleHints = extractVehicleHints(title);

      let confidence = buildCheck.confidence;
      if (vehicleHints.year) confidence += 0.15;
      if (vehicleHints.make) confidence += 0.1;
      confidence = Math.max(0, Math.min(1, confidence));

      threads.push({
        thread_url: threadUrl,
        thread_url_normalized: normalizeForumUrl(threadUrl),
        thread_title: title,
        vehicle_hints: vehicleHints,
        build_confidence: confidence,
        is_sticky: false,
      });
    }

    if (threads.length > 0) {
      console.log(`[discover] Found ${threads.length} threads via vBulletin regex`);
      return threads;
    }

    // XenForo 2.x: find threads via /threads/*.{id} URL pattern
    const xfPattern = /href="([^"]*\/threads\/([^"]*?)\.(\d+)[^"]*)"/g;
    while ((match = xfPattern.exec(html)) !== null) {
      const [, href, slug, threadId] = match;

      // Skip pagination and anchor links
      if (href.includes('/page-') || href.includes('#post-') || href.includes('/unread')) continue;

      let threadUrl: string;
      try {
        threadUrl = new URL(href.replace(/&amp;/g, '&'), baseUrl).toString();
      } catch {
        continue;
      }

      if (seenUrls.has(threadUrl)) continue;
      seenUrls.add(threadUrl);

      // Try to extract title from nearby context or use slug
      const title = slug.replace(/-/g, ' ').replace(/\.\d+$/, '');

      const buildCheck = isBuildThreadTitle(title);
      const vehicleHints = extractVehicleHints(title);

      let confidence = buildCheck.confidence;
      if (vehicleHints.year) confidence += 0.15;
      if (vehicleHints.make) confidence += 0.1;
      confidence = Math.max(0, Math.min(1, confidence));

      threads.push({
        thread_url: threadUrl,
        thread_url_normalized: normalizeForumUrl(threadUrl),
        thread_title: title,
        vehicle_hints: vehicleHints,
        build_confidence: confidence,
        is_sticky: false,
      });
    }

    if (threads.length > 0) {
      console.log(`[discover] Found ${threads.length} threads via XenForo regex`);
      return threads;
    }

    // XenForo 1.x: discussionListItem with PreviewTooltip
    const xf1Pattern = /<a[^>]*class="PreviewTooltip"[^>]*href="([^"]+)"[^>]*>([^<]+)</g;
    while ((match = xf1Pattern.exec(html)) !== null) {
      const [, href, title] = match;

      if (!href || !title) continue;

      let threadUrl: string;
      try {
        threadUrl = new URL(href.replace(/&amp;/g, '&'), baseUrl).toString();
      } catch {
        continue;
      }

      if (!isThreadUrl(threadUrl)) continue;
      if (seenUrls.has(threadUrl)) continue;
      seenUrls.add(threadUrl);

      const buildCheck = isBuildThreadTitle(title.trim());
      const vehicleHints = extractVehicleHints(title.trim());

      let confidence = buildCheck.confidence;
      if (vehicleHints.year) confidence += 0.15;
      if (vehicleHints.make) confidence += 0.1;
      confidence = Math.max(0, Math.min(1, confidence));

      threads.push({
        thread_url: threadUrl,
        thread_url_normalized: normalizeForumUrl(threadUrl),
        thread_title: title.trim(),
        vehicle_hints: vehicleHints,
        build_confidence: confidence,
        is_sticky: false,
      });
    }

    if (threads.length > 0) {
      console.log(`[discover] Found ${threads.length} threads via XenForo 1.x regex`);
      return threads;
    }

    for (const directSel of directSelectors) {
      const directLinks = doc.querySelectorAll(directSel);
      if (directLinks && directLinks.length > 0) {
        console.log(`[discover] Found ${directLinks.length} links with direct selector: ${directSel}`);

        for (const linkEl of directLinks) {
          const href = linkEl.getAttribute('href');
          const title = linkEl.textContent?.trim() || '';

          if (!href || !title) continue;

          let threadUrl: string;
          try {
            threadUrl = new URL(href, baseUrl).toString();
          } catch {
            continue;
          }

          if (!isThreadUrl(threadUrl)) continue;
          if (seenUrls.has(threadUrl)) continue;
          seenUrls.add(threadUrl);

          const buildCheck = isBuildThreadTitle(title);
          const vehicleHints = extractVehicleHints(title);

          let confidence = buildCheck.confidence;
          if (vehicleHints.year) confidence += 0.15;
          if (vehicleHints.make) confidence += 0.1;
          confidence = Math.max(0, Math.min(1, confidence));

          threads.push({
            thread_url: threadUrl,
            thread_url_normalized: normalizeForumUrl(threadUrl),
            thread_title: title,
            vehicle_hints: vehicleHints,
            build_confidence: confidence,
            is_sticky: false,
          });
        }

        if (threads.length > 0) break; // Found threads, stop trying other selectors
      }
    }

    return threads;
  }

  for (const row of rows) {
    try {
      // Get thread link and title
      const linkSelector = selectors.thread_link || selectors.thread_title || 'a';
      const linkEl = row.querySelector(linkSelector);
      if (!linkEl) continue;

      const href = linkEl.getAttribute('href');
      const title = linkEl.textContent?.trim() || '';

      if (!href || !title) continue;

      // Build full URL
      let threadUrl: string;
      try {
        threadUrl = new URL(href, baseUrl).toString();
      } catch {
        continue;
      }

      // Skip if not a thread URL
      if (!isThreadUrl(threadUrl)) continue;
      if (seenUrls.has(threadUrl)) continue;
      seenUrls.add(threadUrl);

      // Check if it looks like a build thread
      const buildCheck = isBuildThreadTitle(title);

      // Extract author
      let authorHandle: string | undefined;
      let authorProfileUrl: string | undefined;
      if (selectors.author) {
        const authorEl = row.querySelector(selectors.author);
        if (authorEl) {
          authorHandle = authorEl.textContent?.trim();
          const authorLink = authorEl.getAttribute('href') || authorEl.querySelector('a')?.getAttribute('href');
          if (authorLink) {
            try {
              authorProfileUrl = new URL(authorLink, baseUrl).toString();
            } catch {
              // Ignore invalid URL
            }
          }
        }
      }

      // Extract reply count
      let replyCount: number | undefined;
      if (selectors.reply_count) {
        const replyEl = row.querySelector(selectors.reply_count);
        replyCount = parseNumber(replyEl?.textContent);
      }

      // Extract view count
      let viewCount: number | undefined;
      if (selectors.view_count) {
        const viewEl = row.querySelector(selectors.view_count);
        viewCount = parseNumber(viewEl?.textContent);
      }

      // Extract last post date
      let lastPostDate: string | undefined;
      if (selectors.last_post_date) {
        const dateEl = row.querySelector(selectors.last_post_date);
        lastPostDate = parseDate(dateEl?.textContent || dateEl?.getAttribute('datetime'));
      }

      // Check if sticky
      let isSticky = false;
      if (selectors.is_sticky) {
        isSticky = row.querySelector(selectors.is_sticky) !== null;
      }
      // Also check common sticky indicators
      const rowClass = row.className?.toLowerCase() || '';
      const rowText = row.textContent?.toLowerCase() || '';
      if (rowClass.includes('sticky') || rowClass.includes('pinned') || rowText.includes('sticky')) {
        isSticky = true;
      }

      // Extract vehicle hints from title
      const vehicleHints = extractVehicleHints(title);

      // Calculate build confidence
      // Higher if: build keywords, has year, has make, not sticky, many replies
      let confidence = buildCheck.confidence;
      if (vehicleHints.year) confidence += 0.15;
      if (vehicleHints.make) confidence += 0.1;
      if (vehicleHints.model) confidence += 0.1;
      if (isSticky) confidence -= 0.3; // Stickies are often rules/guides, not builds
      if (replyCount && replyCount > 50) confidence += 0.1;
      if (replyCount && replyCount > 200) confidence += 0.1;

      confidence = Math.max(0, Math.min(1, confidence));

      threads.push({
        thread_url: threadUrl,
        thread_url_normalized: normalizeForumUrl(threadUrl),
        thread_title: title,
        author_handle: authorHandle,
        author_profile_url: authorProfileUrl,
        reply_count: replyCount,
        view_count: viewCount,
        last_post_date: lastPostDate,
        is_sticky: isSticky,
        vehicle_hints: vehicleHints,
        build_confidence: confidence,
      });
    } catch (e: any) {
      console.warn(`[discover] Error parsing thread row: ${e.message}`);
    }
  }

  return threads;
}

async function discoverFromSection(
  sectionUrl: string,
  domMap: ForumDomMap,
  maxPages = 5
): Promise<DiscoveredThread[]> {
  const allThreads: DiscoveredThread[] = [];
  const seenUrls = new Set<string>();
  let currentUrl = sectionUrl;

  for (let page = 1; page <= maxPages; page++) {
    console.log(`[discover] Fetching page ${page}: ${currentUrl}`);

    try {
      const html = await fetchPage(currentUrl);
      const threads = discoverThreadsFromHtml(html, currentUrl, domMap);

      for (const thread of threads) {
        if (!seenUrls.has(thread.thread_url_normalized)) {
          seenUrls.add(thread.thread_url_normalized);
          allThreads.push(thread);
        }
      }

      console.log(`[discover] Page ${page}: found ${threads.length} threads, total: ${allThreads.length}`);

      // Find next page link
      if (domMap.pagination.type === 'numbered' && domMap.pagination.next_page_selector) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const nextLink = doc?.querySelector(domMap.pagination.next_page_selector);
        const nextHref = nextLink?.getAttribute('href');

        if (nextHref) {
          try {
            currentUrl = new URL(nextHref, currentUrl).toString();
          } catch {
            break;
          }
        } else {
          break; // No more pages
        }
      } else {
        break; // Only support numbered pagination for now
      }
    } catch (e: any) {
      console.error(`[discover] Error fetching page ${page}: ${e.message}`);
      break;
    }
  }

  return allThreads;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').trim();
    const serviceRoleKey = (
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
      Deno.env.get('SERVICE_ROLE_KEY') ??
      ''
    ).trim();

    if (!supabaseUrl) throw new Error('Missing SUPABASE_URL');
    if (!serviceRoleKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const {
      forum_id,
      section_url,
      limit = 5,
      max_pages = 5,
      min_confidence = 0.3,
    } = await req.json();

    const results: any[] = [];

    // Get forums to process
    let forumsToProcess: any[] = [];

    if (forum_id) {
      const { data: forum, error } = await supabase
        .from('forum_sources')
        .select('*')
        .eq('id', forum_id)
        .single();

      if (error) throw new Error(`Forum not found: ${error.message}`);
      forumsToProcess = [forum];
    } else {
      // Get forums ready for discovery
      const { data: forums, error } = await supabase
        .from('forum_sources')
        .select('*')
        .in('inspection_status', ['mapped', 'active'])
        .order('last_crawled_at', { ascending: true, nullsFirst: true })
        .limit(limit);

      if (error) throw new Error(`Failed to fetch forums: ${error.message}`);
      forumsToProcess = forums || [];
    }

    console.log(`[discover] Processing ${forumsToProcess.length} forums`);

    for (const forum of forumsToProcess) {
      const forumResult = {
        forum_id: forum.id,
        forum_slug: forum.slug,
        sections_crawled: 0,
        threads_discovered: 0,
        threads_inserted: 0,
        errors: [] as string[],
      };

      try {
        const domMap = forum.dom_map as ForumDomMap;
        if (!domMap) {
          forumResult.errors.push('No DOM map available');
          results.push(forumResult);
          continue;
        }

        // Get sections to crawl
        let sectionsToProcess: string[] = [];

        if (section_url) {
          sectionsToProcess = [section_url];
        } else {
          // Use build_section_urls from forum or from dom_map
          const sectionUrls = forum.build_section_urls || [];
          const domMapSections = (domMap.build_sections || []).map((s: BuildSection) => s.url);
          sectionsToProcess = [...new Set([...sectionUrls, ...domMapSections])];
        }

        if (sectionsToProcess.length === 0) {
          forumResult.errors.push('No build sections found');
          results.push(forumResult);
          continue;
        }

        console.log(`[discover] Forum ${forum.slug}: ${sectionsToProcess.length} sections`);

        const allDiscoveredThreads: DiscoveredThread[] = [];

        for (const sectionUrl of sectionsToProcess) {
          try {
            forumResult.sections_crawled++;
            const threads = await discoverFromSection(sectionUrl, domMap, max_pages);
            allDiscoveredThreads.push(...threads);
          } catch (e: any) {
            forumResult.errors.push(`Section ${sectionUrl}: ${e.message}`);
          }
        }

        // Filter by confidence
        const qualifiedThreads = allDiscoveredThreads.filter(
          (t) => t.build_confidence >= min_confidence
        );

        forumResult.threads_discovered = qualifiedThreads.length;
        console.log(`[discover] Forum ${forum.slug}: ${qualifiedThreads.length} qualified threads`);

        // Upsert threads to database
        if (qualifiedThreads.length > 0) {
          const threadRows = qualifiedThreads.map((t) => ({
            forum_source_id: forum.id,
            thread_url: t.thread_url,
            thread_url_normalized: t.thread_url_normalized,
            thread_title: t.thread_title,
            author_handle: t.author_handle,
            author_profile_url: t.author_profile_url,
            vehicle_hints: t.vehicle_hints,
            vehicle_match_confidence: t.build_confidence,
            reply_count: t.reply_count,
            view_count: t.view_count,
            last_activity_date: t.last_post_date,
            extraction_status: 'discovered',
            metadata: {
              is_sticky: t.is_sticky,
              discovery_confidence: t.build_confidence,
              discovered_at: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
          }));

          const { data: inserted, error: insertError } = await supabase
            .from('build_threads')
            .upsert(threadRows, { onConflict: 'thread_url' })
            .select('id');

          if (insertError) {
            forumResult.errors.push(`Insert error: ${insertError.message}`);
          } else {
            forumResult.threads_inserted = inserted?.length || 0;
          }
        }

        // Update forum crawl timestamp
        await supabase
          .from('forum_sources')
          .update({
            last_crawled_at: new Date().toISOString(),
            inspection_status: forum.inspection_status === 'mapped' ? 'active' : forum.inspection_status,
            consecutive_failures: 0,
            updated_at: new Date().toISOString(),
          })
          .eq('id', forum.id);
      } catch (e: any) {
        forumResult.errors.push(e.message);

        // Update failure count
        await supabase
          .from('forum_sources')
          .update({
            last_error: e.message,
            consecutive_failures: (forum.consecutive_failures || 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', forum.id);
      }

      results.push(forumResult);
    }

    // Summary stats
    const summary = {
      forums_processed: results.length,
      total_sections_crawled: results.reduce((s, r) => s + r.sections_crawled, 0),
      total_threads_discovered: results.reduce((s, r) => s + r.threads_discovered, 0),
      total_threads_inserted: results.reduce((s, r) => s + r.threads_inserted, 0),
      forums_with_errors: results.filter((r) => r.errors.length > 0).length,
    };

    return new Response(
      JSON.stringify({
        success: true,
        summary,
        results,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const e: any = error;
    console.error('[discover-build-threads] Error:', e.message || e);

    return new Response(
      JSON.stringify({
        success: false,
        error: e.message || String(e),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
