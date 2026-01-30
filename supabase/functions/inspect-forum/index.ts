/**
 * INSPECT-FORUM
 *
 * Crawls a forum URL to:
 * 1. Detect platform type (vBulletin, XenForo, phpBB, Discourse, etc.)
 * 2. Map DOM structure for build sections, thread lists, posts
 * 3. Identify build/garage sections
 * 4. Store DOM map in forum_sources table
 *
 * Usage:
 *   POST /functions/v1/inspect-forum
 *   { "forum_url": "https://rennlist.com/forums", "forum_id": "uuid" }
 *
 * Returns:
 *   { success: true, platform_type, build_sections, dom_map, ... }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';
import { corsHeaders } from '../_shared/cors.ts';
import {
  detectPlatform,
  DEFAULT_SELECTORS,
  BUILD_SECTION_KEYWORDS,
  type ForumDomMap,
  type BuildSection,
  type ForumPlatformType,
  normalizeForumUrl,
  extractForumDomain,
} from '../_shared/forumDomMap.ts';

// User agents for rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  maxRetries = 3
): Promise<{ html: string; status: number; finalUrl: string }> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Random delay to be polite
      const delay = Math.random() * 2000 + 500;
      await new Promise((r) => setTimeout(r, delay));

      const response = await fetch(url, {
        ...options,
        headers: {
          'User-Agent': getRandomUserAgent(),
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          Connection: 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          Referer: 'https://www.google.com/',
          ...options.headers,
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok && response.status !== 403 && response.status !== 429) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();

      if (!html || html.length < 500) {
        throw new Error(`Insufficient HTML content (${html?.length || 0} chars)`);
      }

      return {
        html,
        status: response.status,
        finalUrl: response.url,
      };
    } catch (e: any) {
      lastError = e;
      console.warn(`[inspect-forum] Attempt ${attempt} failed: ${e.message}`);

      if (attempt < maxRetries) {
        // Exponential backoff
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    }
  }

  throw lastError || new Error('Failed to fetch forum after retries');
}

/**
 * Find build-related sections by scanning forum HTML
 */
function findBuildSections(doc: any, baseUrl: string): BuildSection[] {
  const sections: BuildSection[] = [];
  const seen = new Set<string>();

  // Common selectors for forum section links
  const sectionSelectors = [
    'a[href*="forum"]',
    'a[href*="garage"]',
    'a[href*="build"]',
    'a[href*="project"]',
    'a[href*="journal"]',
    'a[href*="showcase"]',
    'a[href*="registry"]',
    '.forum-link a',
    '.forumtitle a',
    '.nodeTitle a',
    '.forum-title a',
    '.categoryForumTitle a',
    'h3 a',
    'h4 a',
    '.subforum a',
  ];

  for (const selector of sectionSelectors) {
    try {
      const links = doc.querySelectorAll(selector);
      for (const link of links) {
        const href = link.getAttribute('href');
        const text = link.textContent?.trim() || '';

        if (!href || !text) continue;

        // Build full URL
        let fullUrl: string;
        try {
          fullUrl = new URL(href, baseUrl).toString();
        } catch {
          continue;
        }

        // Skip if already seen
        const normalized = normalizeForumUrl(fullUrl);
        if (seen.has(normalized)) continue;
        seen.add(normalized);

        // Check if this looks like a build section
        const combined = `${text} ${href}`.toLowerCase();
        const isBuildSection = BUILD_SECTION_KEYWORDS.some((kw) =>
          combined.includes(kw.toLowerCase())
        );

        if (isBuildSection) {
          sections.push({
            name: text,
            url: fullUrl,
            path: new URL(fullUrl).pathname,
          });
        }
      }
    } catch {
      // Selector might not work, continue
    }
  }

  return sections;
}

/**
 * Test selectors against actual HTML to verify they work
 */
function verifySelectors(
  doc: any,
  selectors: any,
  type: 'thread_list' | 'post'
): { working: string[]; missing: string[] } {
  const working: string[] = [];
  const missing: string[] = [];

  const selectorMap = type === 'thread_list' ? selectors : selectors;

  for (const [key, selector] of Object.entries(selectorMap)) {
    if (typeof selector !== 'string' || !selector) continue;

    try {
      const el = doc.querySelector(selector);
      if (el) {
        working.push(key);
      } else {
        missing.push(key);
      }
    } catch {
      missing.push(key);
    }
  }

  return { working, missing };
}

/**
 * Detect login wall indicators
 */
function detectLoginWall(html: string, doc: any): { requiresLogin: boolean; indicator?: string } {
  const loginIndicators = [
    'you must be logged in',
    'please log in',
    'login required',
    'sign in to view',
    'register to view',
    'members only',
    'you are not logged in',
    'please register',
    'you must register',
  ];

  const htmlLower = html.toLowerCase();

  for (const indicator of loginIndicators) {
    if (htmlLower.includes(indicator)) {
      return { requiresLogin: true, indicator };
    }
  }

  // Check for login form prominence
  const loginForm = doc.querySelector('form[action*="login"], form#login, .login-form');
  const contentArea = doc.querySelector(
    '.thread-content, .post-content, .message-body, .postbody'
  );

  if (loginForm && !contentArea) {
    return { requiresLogin: true, indicator: 'login_form_prominent' };
  }

  return { requiresLogin: false };
}

/**
 * Count threads in a section by fetching and parsing
 */
async function estimateThreadCount(
  sectionUrl: string,
  threadSelectors: any
): Promise<number | null> {
  try {
    const { html } = await fetchWithRetry(sectionUrl);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (!doc) return null;

    // Try to find thread count from page text
    const countPatterns = [
      /(\d{1,3}(?:,\d{3})*)\s*(?:threads?|topics?)/i,
      /(?:threads?|topics?)\s*:\s*(\d{1,3}(?:,\d{3})*)/i,
      /showing\s+\d+\s*-\s*\d+\s+of\s+(\d{1,3}(?:,\d{3})*)/i,
    ];

    const bodyText = doc.body?.textContent || '';
    for (const pattern of countPatterns) {
      const match = bodyText.match(pattern);
      if (match?.[1]) {
        return parseInt(match[1].replace(/,/g, ''), 10);
      }
    }

    // Count visible threads
    const threadRows = doc.querySelectorAll(
      threadSelectors.thread_row || '.thread, .threadbit, .structItem--thread'
    );
    if (threadRows.length > 0) {
      return threadRows.length;
    }

    return null;
  } catch {
    return null;
  }
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

    const { forum_url, forum_id, save = true } = await req.json();

    if (!forum_url && !forum_id) {
      throw new Error('Missing forum_url or forum_id');
    }

    let forumUrl = forum_url;
    let forumRecord: any = null;

    // If forum_id provided, fetch the record
    if (forum_id) {
      const { data, error } = await supabase
        .from('forum_sources')
        .select('*')
        .eq('id', forum_id)
        .single();

      if (error) throw new Error(`Forum not found: ${error.message}`);
      forumRecord = data;
      forumUrl = data.base_url;
    }

    console.log(`[inspect-forum] Inspecting: ${forumUrl}`);

    // Fetch the forum homepage
    const { html, status, finalUrl } = await fetchWithRetry(forumUrl);
    console.log(`[inspect-forum] Fetched ${html.length} chars, status ${status}`);

    // Parse HTML
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (!doc) throw new Error('Failed to parse HTML');

    // Detect platform
    const platform = detectPlatform(html);
    console.log(
      `[inspect-forum] Detected platform: ${platform.platform} (v${platform.version || 'unknown'}, confidence: ${platform.confidence})`
    );

    // Get default selectors for this platform
    const defaultSelectors = DEFAULT_SELECTORS[platform.platform] || DEFAULT_SELECTORS.custom;

    // Find build sections
    const buildSections = findBuildSections(doc, finalUrl);
    console.log(`[inspect-forum] Found ${buildSections.length} build sections`);

    // Verify selectors work
    const threadListVerify = verifySelectors(
      doc,
      defaultSelectors.thread_list_selectors,
      'thread_list'
    );
    const postVerify = verifySelectors(doc, defaultSelectors.post_selectors, 'post');

    // Detect login requirements
    const loginCheck = detectLoginWall(html, doc);

    // Try to estimate thread counts for build sections
    for (const section of buildSections.slice(0, 3)) {
      // Limit to 3 to avoid rate limiting
      const count = await estimateThreadCount(
        section.url,
        defaultSelectors.thread_list_selectors || {}
      );
      if (count !== null) {
        section.thread_count_estimate = count;
      }
    }

    // Calculate total estimated build count
    const estimatedBuildCount = buildSections.reduce(
      (sum, s) => sum + (s.thread_count_estimate || 0),
      0
    );

    // Build the DOM map
    const domMap: ForumDomMap = {
      platform_type: platform.platform,
      platform_version: platform.version,
      platform_signals: platform.signals,
      build_sections: buildSections,
      thread_list_selectors: defaultSelectors.thread_list_selectors!,
      post_selectors: defaultSelectors.post_selectors!,
      pagination: defaultSelectors.pagination!,
      auth: {
        requires_login: loginCheck.requiresLogin,
        login_wall_indicators: loginCheck.indicator ? [loginCheck.indicator] : [],
      },
    };

    // Determine inspection status
    let inspectionStatus: string;
    if (buildSections.length > 0 && platform.confidence >= 0.3) {
      inspectionStatus = 'mapped';
    } else if (platform.platform !== 'custom') {
      inspectionStatus = 'inspected';
    } else {
      inspectionStatus = 'inspected'; // Still inspected, just custom platform
    }

    // Save to database if requested
    if (save) {
      const updatePayload = {
        platform_type: platform.platform,
        platform_version: platform.version,
        dom_map: domMap,
        build_section_urls: buildSections.map((s) => s.url),
        estimated_build_count: estimatedBuildCount > 0 ? estimatedBuildCount : null,
        requires_login: loginCheck.requiresLogin,
        login_wall_indicator: loginCheck.indicator || null,
        inspection_status: inspectionStatus,
        last_inspected_at: new Date().toISOString(),
        consecutive_failures: 0,
        last_error: null,
        updated_at: new Date().toISOString(),
      };

      if (forumRecord?.id) {
        // Update existing record
        const { error: updateError } = await supabase
          .from('forum_sources')
          .update(updatePayload)
          .eq('id', forumRecord.id);

        if (updateError) {
          console.error('[inspect-forum] Failed to update forum_sources:', updateError);
        } else {
          console.log(`[inspect-forum] Updated forum_sources record ${forumRecord.id}`);
        }
      } else {
        // Insert new record
        const domain = extractForumDomain(forumUrl);
        const slug = domain.replace(/\.(com|net|org|io|co\.uk|forums?)$/g, '').replace(/[^a-z0-9]/g, '-');

        const insertPayload = {
          slug,
          name: doc.querySelector('title')?.textContent?.trim() || domain,
          base_url: forumUrl,
          ...updatePayload,
        };

        const { data: inserted, error: insertError } = await supabase
          .from('forum_sources')
          .upsert(insertPayload, { onConflict: 'slug' })
          .select('id')
          .single();

        if (insertError) {
          console.error('[inspect-forum] Failed to insert forum_sources:', insertError);
        } else {
          console.log(`[inspect-forum] Inserted/updated forum_sources record ${inserted?.id}`);
        }
      }

      // Save HTML snapshot for audit
      try {
        await supabase.from('forum_page_snapshots').insert({
          forum_source_id: forumRecord?.id || null,
          page_url: finalUrl,
          page_type: 'homepage',
          fetch_method: 'direct',
          http_status: status,
          success: true,
          html,
          html_sha256: await sha256Hex(html),
          content_length: html.length,
          metadata: {
            extractor: 'inspect-forum',
            platform_detected: platform.platform,
          },
        });
      } catch (e: any) {
        console.warn('[inspect-forum] Failed to save snapshot (non-fatal):', e.message);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        forum_url: finalUrl,
        platform_type: platform.platform,
        platform_version: platform.version,
        platform_confidence: platform.confidence,
        platform_signals: platform.signals,
        build_sections: buildSections,
        build_section_count: buildSections.length,
        estimated_build_count: estimatedBuildCount,
        requires_login: loginCheck.requiresLogin,
        inspection_status: inspectionStatus,
        selector_verification: {
          thread_list: threadListVerify,
          post: postVerify,
        },
        dom_map: domMap,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const e: any = error;
    console.error('[inspect-forum] Error:', e.message || e);

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

// SHA256 helper
async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}
