/**
 * EXTRACT-BUILD-POSTS
 *
 * Extracts posts from a build thread, following the extract-auction-comments pattern.
 *
 * Process:
 * 1. Fetch thread HTML (with user agent rotation)
 * 2. Save HTML snapshot for audit trail
 * 3. Parse posts using DOM map selectors
 * 4. Extract per post: number, author, date, content, images, links
 * 5. Content hash for deduplication
 * 6. Upsert to build_posts table
 * 7. Upsert authors to external_identities
 * 8. Create vehicle_observations for each post
 *
 * Usage:
 *   POST /functions/v1/extract-build-posts
 *   { "thread_id": "uuid" } - extract from build_threads record
 *   { "thread_url": "...", "forum_id": "uuid" } - extract from URL
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';
import { corsHeaders } from '../_shared/cors.ts';
import {
  type ForumDomMap,
  normalizeForumUrl,
  extractVehicleHints,
} from '../_shared/forumDomMap.ts';

// User agents for rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface ExtractedPost {
  post_number: number;
  post_id_external?: string;
  post_url?: string;
  author_handle: string;
  author_profile_url?: string;
  posted_at?: string;
  content_text: string;
  content_html?: string;
  images: string[];
  video_urls: string[];
  quoted_handles: string[];
  external_links: string[];
  post_type: 'original' | 'update' | 'question' | 'answer' | 'media_only' | 'milestone' | 'completion' | 'sale';
  like_count: number;
  word_count: number;
  content_hash: string;
  org_mentions?: OrgMention[];
}

interface OrgMention {
  mention_text: string;
  mention_context: string;
  mention_type: string;
  extracted_url?: string;
}

// Known parts suppliers - high confidence matches
const KNOWN_SUPPLIERS: Array<{ name: string; type: string }> = [
  // Major parts retailers
  { name: 'summit racing', type: 'parts_supplier' },
  { name: 'jegs', type: 'parts_supplier' },
  { name: 'rockauto', type: 'parts_supplier' },
  { name: 'rock auto', type: 'parts_supplier' },
  { name: 'autozone', type: 'parts_supplier' },
  { name: 'o\'reilly', type: 'parts_supplier' },
  { name: 'advance auto', type: 'parts_supplier' },
  { name: 'napa', type: 'parts_supplier' },
  { name: 'amazon', type: 'parts_supplier' },
  { name: 'ebay', type: 'parts_supplier' },

  // Classic car parts
  { name: 'lmc truck', type: 'parts_supplier' },
  { name: 'classic industries', type: 'parts_supplier' },
  { name: 'opgi', type: 'parts_supplier' },
  { name: 'year one', type: 'parts_supplier' },
  { name: 'yearone', type: 'parts_supplier' },
  { name: 'national parts depot', type: 'parts_supplier' },
  { name: 'npd', type: 'parts_supplier' },
  { name: 'brothers trucks', type: 'parts_supplier' },
  { name: 'ecklers', type: 'parts_supplier' },
  { name: 'eckler\'s', type: 'parts_supplier' },
  { name: 'corvette central', type: 'parts_supplier' },
  { name: 'mid america motorworks', type: 'parts_supplier' },
  { name: 'paragon', type: 'parts_supplier' },
  { name: 'ground up', type: 'parts_supplier' },
  { name: 'rick\'s camaro', type: 'parts_supplier' },
  { name: 'ricks camaro', type: 'parts_supplier' },
  { name: 'dynacorn', type: 'parts_supplier' },
  { name: 'amd', type: 'parts_supplier' },
  { name: 'auto metal direct', type: 'parts_supplier' },
  { name: 'golden star', type: 'parts_supplier' },
  { name: 'goodmark', type: 'parts_supplier' },
  { name: 'original parts group', type: 'parts_supplier' },
  { name: 'inline tube', type: 'parts_supplier' },
  { name: 'right stuff detailing', type: 'parts_supplier' },
  { name: 'the right stuff', type: 'parts_supplier' },

  // European parts
  { name: 'pelican parts', type: 'parts_supplier' },
  { name: 'fcpeuro', type: 'parts_supplier' },
  { name: 'fcp euro', type: 'parts_supplier' },
  { name: 'ecs tuning', type: 'parts_supplier' },
  { name: 'turner motorsport', type: 'parts_supplier' },
  { name: 'bavauto', type: 'parts_supplier' },
  { name: 'bimmerworld', type: 'parts_supplier' },

  // Japanese parts
  { name: 'flyin miata', type: 'parts_supplier' },
  { name: 'flying miata', type: 'parts_supplier' },
  { name: 'good-win-racing', type: 'parts_supplier' },
  { name: 'goodwin racing', type: 'parts_supplier' },
  { name: 'racing beat', type: 'parts_supplier' },
  { name: 'mazdaspeed', type: 'parts_supplier' },
  { name: 'z1 motorsports', type: 'parts_supplier' },
  { name: 'conceptz', type: 'parts_supplier' },

  // Performance parts
  { name: 'holley', type: 'parts_supplier' },
  { name: 'edelbrock', type: 'parts_supplier' },
  { name: 'msd', type: 'parts_supplier' },
  { name: 'comp cams', type: 'parts_supplier' },
  { name: 'crane cams', type: 'parts_supplier' },
  { name: 'hooker headers', type: 'parts_supplier' },
  { name: 'flowmaster', type: 'parts_supplier' },
  { name: 'magnaflow', type: 'parts_supplier' },
  { name: 'borla', type: 'parts_supplier' },
  { name: 'hurst', type: 'parts_supplier' },
  { name: 'tremec', type: 'parts_supplier' },
  { name: 'tko', type: 'parts_supplier' },
  { name: 'richmond gear', type: 'parts_supplier' },
  { name: 'moog', type: 'parts_supplier' },
  { name: 'bilstein', type: 'parts_supplier' },
  { name: 'koni', type: 'parts_supplier' },
  { name: 'qs tech', type: 'parts_supplier' },
  { name: 'detroit speed', type: 'performance' },
  { name: 'hotchkis', type: 'performance' },
  { name: 'global west', type: 'performance' },
  { name: 'chris alston', type: 'performance' },
  { name: 'chassisworks', type: 'performance' },
  { name: 'art morrison', type: 'performance' },
  { name: 'roadster shop', type: 'performance' },
  { name: 'ridetech', type: 'performance' },
  { name: 'speedtech', type: 'performance' },
  { name: 'wilwood', type: 'parts_supplier' },
  { name: 'baer brakes', type: 'parts_supplier' },
  { name: 'ssbc', type: 'parts_supplier' },

  // Engine builders / machine shops (well known)
  { name: 'blueprint engines', type: 'performance' },
  { name: 'crate engines', type: 'performance' },
  { name: 'pace performance', type: 'performance' },
  { name: 'golen engine', type: 'machine_shop' },
  { name: 'shafiroff', type: 'machine_shop' },

  // Paint
  { name: 'ppg', type: 'paint' },
  { name: 'dupont', type: 'paint' },
  { name: 'sherwin williams', type: 'paint' },
  { name: 'house of kolor', type: 'paint' },
  { name: 'eastwood', type: 'parts_supplier' },

  // Upholstery
  { name: 'tmi products', type: 'upholstery' },
  { name: 'pui interiors', type: 'upholstery' },
  { name: 'distinctive industries', type: 'upholstery' },
  { name: 'acc carpet', type: 'upholstery' },
  { name: 'legendary interiors', type: 'upholstery' },
];

// Patterns to match business names with suffixes
const BUSINESS_SUFFIXES = [
  'Machine Shop', 'Machining', 'Machine Works',
  'Restoration', 'Restorations', 'Resto',
  'Customs', 'Custom', 'Kustoms',
  'Performance', 'Racing', 'Motorsports', 'Motorsport',
  'Automotive', 'Auto', 'Motors', 'Motor',
  'Paint', 'Paint & Body', 'Body Shop', 'Body Works',
  'Speed Shop', 'Speed', 'Hot Rods', 'Hot Rod',
  'Classics', 'Classic Cars',
  'Upholstery', 'Interiors', 'Interior',
  'Garage', 'Shop', 'Works',
  'Engineering', 'Fabrication', 'Fab',
  'Parts', 'Supply', 'Warehouse',
  'Inc', 'LLC', 'Ltd', 'Co',
];

// Words that indicate NOT a business name
const FALSE_POSITIVE_WORDS = [
  // Common words
  'the', 'this', 'that', 'they', 'their', 'there', 'these', 'those',
  'here', 'where', 'when', 'what', 'which', 'who', 'whom',
  'have', 'has', 'had', 'having', 'been', 'being', 'was', 'were',
  'will', 'would', 'could', 'should', 'might', 'must', 'shall',
  'and', 'but', 'for', 'with', 'from', 'into', 'onto', 'upon',
  'about', 'after', 'before', 'between', 'through', 'during',
  'just', 'only', 'also', 'very', 'really', 'actually', 'probably',
  'some', 'any', 'all', 'most', 'many', 'much', 'more', 'less',
  'new', 'old', 'good', 'bad', 'great', 'best', 'first', 'last',
  // Car-related false positives
  'my', 'your', 'his', 'her', 'our', 'its', 'one', 'two', 'three',
  'car', 'cars', 'truck', 'trucks', 'engine', 'motor', 'trans', 'transmission',
  'stock', 'original', 'oem', 'factory', 'dealer', 'local',
  'fiberglass', 'steel', 'aluminum', 'chrome', 'stainless',
  // Actions
  'ordered', 'bought', 'purchased', 'got', 'found', 'picked',
  'sent', 'took', 'brought', 'dropped', 'used', 'using',
];

/**
 * Check if a string looks like a valid business name
 */
function isValidBusinessName(name: string): boolean {
  // Must be at least 2 words or have a business suffix
  const words = name.split(/\s+/);
  const hasBusinessSuffix = BUSINESS_SUFFIXES.some(suffix =>
    name.toLowerCase().includes(suffix.toLowerCase())
  );

  // Single word must have suffix or be known
  if (words.length === 1 && !hasBusinessSuffix) {
    return false;
  }

  // Must start with capital letter
  if (!/^[A-Z]/.test(name)) {
    return false;
  }

  // Must have at least one capital letter after the first
  if (words.length > 1 && !/[A-Z]/.test(name.slice(1))) {
    // Allow if it has a business suffix
    if (!hasBusinessSuffix) {
      return false;
    }
  }

  // No pure numbers
  if (/^\d+$/.test(name.replace(/\s/g, ''))) {
    return false;
  }

  // Check for false positive words at start
  const firstWord = words[0].toLowerCase();
  if (FALSE_POSITIVE_WORDS.includes(firstWord)) {
    return false;
  }

  // No newlines or weird characters
  if (/[\n\r\t]/.test(name)) {
    return false;
  }

  // Length check
  if (name.length < 3 || name.length > 40) {
    return false;
  }

  return true;
}

/**
 * Extract organization mentions from post content
 */
function extractOrgMentions(text: string): OrgMention[] {
  const mentions: OrgMention[] = [];
  const seen = new Set<string>();
  const textLower = text.toLowerCase();

  // Check known suppliers first (high confidence)
  for (const supplier of KNOWN_SUPPLIERS) {
    if (textLower.includes(supplier.name.toLowerCase())) {
      const key = supplier.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!seen.has(key)) {
        seen.add(key);
        // Find context (surrounding sentence)
        const idx = textLower.indexOf(supplier.name.toLowerCase());
        const start = Math.max(0, text.lastIndexOf('.', idx) + 1);
        const end = Math.min(text.length, text.indexOf('.', idx + supplier.name.length) + 1 || text.length);
        const context = text.slice(start, end).trim();

        mentions.push({
          mention_text: supplier.name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
          mention_context: context.slice(0, 300),
          mention_type: supplier.type,
        });
      }
    }
  }

  // Pattern: "XYZ Machine Shop" / "ABC Restoration" / "Smith's Customs"
  const suffixPattern = new RegExp(
    `([A-Z][A-Za-z0-9'&.-]+(?:\\s+[A-Z][A-Za-z0-9'&.-]+)*)\\s+(${BUSINESS_SUFFIXES.join('|')})(?:\\s|[.,;!?]|$)`,
    'g'
  );

  let match;
  while ((match = suffixPattern.exec(text)) !== null) {
    const fullName = (match[1] + ' ' + match[2]).trim();
    if (!isValidBusinessName(fullName)) continue;

    const key = fullName.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seen.has(key)) continue;
    seen.add(key);

    // Determine type from suffix
    const suffix = match[2].toLowerCase();
    let type = 'shop';
    if (/machine|machining/.test(suffix)) type = 'machine_shop';
    else if (/paint|body/.test(suffix)) type = 'paint';
    else if (/upholster|interior/.test(suffix)) type = 'upholstery';
    else if (/performance|racing|speed|motorsport/.test(suffix)) type = 'performance';
    else if (/restoration|resto|classic/.test(suffix)) type = 'restoration';
    else if (/parts|supply|warehouse/.test(suffix)) type = 'parts_supplier';

    // Get context
    const idx = match.index;
    const start = Math.max(0, text.lastIndexOf('.', idx) + 1);
    const end = Math.min(text.length, text.indexOf('.', idx + match[0].length) + 1 || text.length);
    const context = text.slice(start, end).trim();

    mentions.push({
      mention_text: fullName,
      mention_context: context.slice(0, 300),
      mention_type: type,
    });
  }

  return mentions;
}

async function fetchPageWithRetry(
  url: string,
  maxRetries = 3
): Promise<{ html: string; status: number }> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
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

      const html = await response.text();

      if (!html || html.length < 500) {
        throw new Error(`Insufficient HTML content (${html?.length || 0} chars)`);
      }

      return { html, status: response.status };
    } catch (e: any) {
      lastError = e;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    }
  }

  throw lastError || new Error('Failed to fetch page');
}

function parseDate(text: string | null | undefined): string | undefined {
  if (!text) return undefined;

  const cleanText = text.trim();

  // Try parsing with Date constructor first
  try {
    const d = new Date(cleanText);
    if (!isNaN(d.getTime()) && d.getFullYear() > 1990) {
      return d.toISOString();
    }
  } catch {
    // Continue
  }

  // Try common date formats
  const patterns = [
    // "Jan 15, 2024 at 3:30 PM"
    /(\w{3})\s+(\d{1,2}),?\s+(\d{4})(?:\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i,
    // "15 Jan 2024"
    /(\d{1,2})\s+(\w{3})\s+(\d{4})/i,
    // "01/15/2024"
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/,
    // ISO format
    /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,
  ];

  for (const pattern of patterns) {
    const match = cleanText.match(pattern);
    if (match) {
      try {
        const d = new Date(cleanText);
        if (!isNaN(d.getTime())) {
          return d.toISOString();
        }
      } catch {
        // Continue
      }
    }
  }

  return undefined;
}

function extractImagesFromElement(el: any, baseUrl: string, selectors: any): string[] {
  const images: string[] = [];
  const seen = new Set<string>();

  const imgSelector = selectors.images || 'img';
  const imgElements = el.querySelectorAll(imgSelector);

  for (const img of imgElements) {
    // Try multiple attributes for full-size URL
    let src =
      img.getAttribute(selectors.image_full_attr || 'data-url') ||
      img.getAttribute('data-src') ||
      img.getAttribute('data-original') ||
      img.getAttribute('data-full') ||
      img.getAttribute('src');

    if (!src) continue;

    // Skip common non-content images
    const srcLower = src.toLowerCase();
    if (
      srcLower.includes('emoji') ||
      srcLower.includes('smilie') ||
      srcLower.includes('avatar') ||
      srcLower.includes('icon') ||
      srcLower.includes('badge') ||
      srcLower.includes('rank') ||
      srcLower.includes('button') ||
      srcLower.includes('logo') ||
      srcLower.includes('sprite') ||
      srcLower.includes('.gif') && srcLower.includes('smil')
    ) {
      continue;
    }

    // Build full URL
    try {
      const fullUrl = new URL(src, baseUrl).toString();
      const normalized = fullUrl.split('?')[0]; // Remove query params for dedup

      if (!seen.has(normalized)) {
        seen.add(normalized);
        images.push(fullUrl);
      }
    } catch {
      // Invalid URL, skip
    }
  }

  return images;
}

function extractLinksFromElement(el: any, baseUrl: string): { external: string[]; quoted: string[] } {
  const external: string[] = [];
  const quoted: string[] = [];
  const seen = new Set<string>();

  const links = el.querySelectorAll('a[href]');
  const baseHost = new URL(baseUrl).hostname;

  for (const link of links) {
    const href = link.getAttribute('href');
    if (!href) continue;

    try {
      const url = new URL(href, baseUrl);
      const fullUrl = url.toString();

      if (seen.has(fullUrl)) continue;
      seen.add(fullUrl);

      // Skip internal navigation links
      if (
        href.startsWith('#') ||
        href.includes('javascript:') ||
        href.includes('mailto:')
      ) {
        continue;
      }

      // Check if quote link
      if (
        href.includes('post') ||
        href.includes('quote') ||
        link.closest('blockquote, .quote, .bbCodeQuote')
      ) {
        quoted.push(fullUrl);
        continue;
      }

      // External if different host
      if (url.hostname !== baseHost) {
        external.push(fullUrl);
      }
    } catch {
      // Invalid URL, skip
    }
  }

  return { external, quoted };
}

function classifyPostType(
  postNumber: number,
  text: string,
  hasImages: boolean
): 'original' | 'update' | 'question' | 'answer' | 'media_only' | 'milestone' | 'completion' | 'sale' {
  const textLower = text.toLowerCase();

  if (postNumber === 1) return 'original';

  // Check for sale indicators
  if (
    textLower.includes('for sale') ||
    textLower.includes('sold') ||
    textLower.includes('selling') ||
    textLower.includes('asking price')
  ) {
    return 'sale';
  }

  // Check for completion indicators
  if (
    textLower.includes('finally done') ||
    textLower.includes('build complete') ||
    textLower.includes('finished') ||
    textLower.includes('project complete')
  ) {
    return 'completion';
  }

  // Check for milestones
  if (
    textLower.includes('first drive') ||
    textLower.includes('first start') ||
    textLower.includes('fired up') ||
    textLower.includes('on the road') ||
    textLower.includes('passed inspection')
  ) {
    return 'milestone';
  }

  // Check for questions
  if (text.includes('?') && text.split('?').length > 1) {
    return 'question';
  }

  // Media only (mostly images, little text)
  if (hasImages && text.split(/\s+/).length < 20) {
    return 'media_only';
  }

  return 'update';
}

async function extractPostsFromPage(
  html: string,
  pageUrl: string,
  domMap: ForumDomMap,
  startingPostNumber: number
): Promise<ExtractedPost[]> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc) return [];

  const posts: ExtractedPost[] = [];
  const selectors = domMap.post_selectors;

  // Find post container
  const containerSelector = selectors.container || 'body';
  const container = doc.querySelector(containerSelector);
  if (!container) {
    console.warn(`[extract] Post container not found: ${containerSelector}`);
    return [];
  }

  // Find all posts
  const postSelector = selectors.post_wrapper || '.post';
  const postElements = container.querySelectorAll(postSelector);

  console.log(`[extract] Found ${postElements.length} posts on page`);

  let postNumber = startingPostNumber;

  for (const postEl of postElements) {
    try {
      // Extract post ID if available
      let postIdExternal: string | undefined;
      if (selectors.post_id_attr) {
        const attrValue = postEl.getAttribute(selectors.post_id_attr);
        if (attrValue) {
          // Extract numeric ID
          const match = attrValue.match(/\d+/);
          postIdExternal = match ? match[0] : attrValue;
        }
      }

      // Extract author
      let authorHandle = 'Unknown';
      let authorProfileUrl: string | undefined;
      if (selectors.author) {
        const authorEl = postEl.querySelector(selectors.author);
        if (authorEl) {
          authorHandle = authorEl.textContent?.trim() || 'Unknown';
          const authorLink =
            authorEl.getAttribute('href') ||
            authorEl.querySelector('a')?.getAttribute('href');
          if (authorLink) {
            try {
              authorProfileUrl = new URL(authorLink, pageUrl).toString();
            } catch {
              // Invalid URL
            }
          }
        }
      }

      // Extract post date
      let postedAt: string | undefined;
      if (selectors.post_date) {
        const dateEl = postEl.querySelector(selectors.post_date);
        const dateAttr = selectors.post_date_attr
          ? dateEl?.getAttribute(selectors.post_date_attr)
          : null;
        postedAt = parseDate(dateAttr || dateEl?.textContent);
      }

      // Extract content
      let contentText = '';
      let contentHtml = '';
      if (selectors.content) {
        const contentEl = postEl.querySelector(selectors.content);
        if (contentEl) {
          contentHtml = contentEl.innerHTML || '';
          contentText = contentEl.textContent?.trim() || '';
        }
      }

      // Skip empty posts
      if (!contentText && !contentHtml) continue;

      // Extract images
      const contentEl = postEl.querySelector(selectors.content) || postEl;
      const images = extractImagesFromElement(contentEl, pageUrl, selectors);

      // Extract videos
      const videoUrls: string[] = [];
      const videoEls = postEl.querySelectorAll(
        selectors.embedded_video || 'iframe[src*="youtube"], iframe[src*="vimeo"], video source'
      );
      for (const videoEl of videoEls) {
        const src = videoEl.getAttribute('src');
        if (src) {
          try {
            videoUrls.push(new URL(src, pageUrl).toString());
          } catch {
            // Invalid URL
          }
        }
      }

      // Extract links
      const links = extractLinksFromElement(contentEl, pageUrl);

      // Extract quoted authors
      const quotedHandles: string[] = [];
      const quoteSelector = selectors.quote_author || '.quote_author, .bbCodeQuote cite';
      const quoteEls = postEl.querySelectorAll(quoteSelector);
      for (const quoteEl of quoteEls) {
        const quotedAuthor = quoteEl.textContent?.trim();
        if (quotedAuthor && quotedAuthor !== authorHandle) {
          quotedHandles.push(quotedAuthor);
        }
      }

      // Extract likes count
      let likeCount = 0;
      if (selectors.likes_count) {
        const likesEl = postEl.querySelector(selectors.likes_count);
        const likesText = likesEl?.textContent;
        if (likesText) {
          const match = likesText.match(/\d+/);
          likeCount = match ? parseInt(match[0], 10) : 0;
        }
      }

      // Calculate word count
      const wordCount = contentText.split(/\s+/).filter(Boolean).length;

      // Classify post type
      const postType = classifyPostType(postNumber, contentText, images.length > 0);

      // Generate content hash
      const contentHash = await sha256Hex(
        [pageUrl, String(postNumber), authorHandle, contentText].join('|')
      );

      // Extract org mentions from content
      const orgMentions = extractOrgMentions(contentText);

      posts.push({
        post_number: postNumber,
        post_id_external: postIdExternal,
        author_handle: authorHandle,
        author_profile_url: authorProfileUrl,
        posted_at: postedAt,
        content_text: contentText,
        content_html: contentHtml,
        images,
        video_urls: videoUrls,
        quoted_handles: [...new Set(quotedHandles)],
        external_links: links.external,
        post_type: postType,
        like_count: likeCount,
        word_count: wordCount,
        content_hash: contentHash,
        org_mentions: orgMentions,
      });

      postNumber++;
    } catch (e: any) {
      console.warn(`[extract] Error parsing post: ${e.message}`);
      postNumber++;
    }
  }

  return posts;
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
      thread_id,
      thread_url,
      forum_id,
      max_pages = 20,
      resume = true, // Resume from last extracted post
    } = await req.json();

    if (!thread_id && (!thread_url || !forum_id)) {
      throw new Error('Must provide thread_id or both thread_url and forum_id');
    }

    let threadRecord: any = null;
    let forumRecord: any = null;
    let threadUrl: string;

    if (thread_id) {
      // Fetch thread and forum
      const { data: thread, error: threadError } = await supabase
        .from('build_threads')
        .select('*, forum_sources(*)')
        .eq('id', thread_id)
        .single();

      if (threadError) throw new Error(`Thread not found: ${threadError.message}`);
      threadRecord = thread;
      forumRecord = thread.forum_sources;
      threadUrl = thread.thread_url;
    } else {
      // Fetch forum
      const { data: forum, error: forumError } = await supabase
        .from('forum_sources')
        .select('*')
        .eq('id', forum_id)
        .single();

      if (forumError) throw new Error(`Forum not found: ${forumError.message}`);
      forumRecord = forum;
      threadUrl = thread_url!;

      // Create or fetch thread record
      const { data: existingThread } = await supabase
        .from('build_threads')
        .select('*')
        .eq('thread_url', threadUrl)
        .single();

      if (existingThread) {
        threadRecord = existingThread;
      }
    }

    const domMap = forumRecord.dom_map as ForumDomMap;
    if (!domMap) {
      throw new Error('Forum has no DOM map configured');
    }

    console.log(`[extract-build-posts] Extracting from: ${threadUrl}`);

    // Update thread status
    if (threadRecord?.id) {
      await supabase
        .from('build_threads')
        .update({
          extraction_status: 'extracting',
          updated_at: new Date().toISOString(),
        })
        .eq('id', threadRecord.id);
    }

    // Determine starting post number (for resume)
    let startingPostNumber = 1;
    if (resume && threadRecord?.posts_extracted) {
      startingPostNumber = threadRecord.posts_extracted + 1;
    }

    const allPosts: ExtractedPost[] = [];
    const authorSet = new Set<string>();
    const authorProfileUrls = new Map<string, string>();
    let currentUrl = threadUrl;
    let totalPages = 0;

    // Handle pagination - start from appropriate page if resuming
    if (resume && threadRecord?.extraction_cursor) {
      currentUrl = threadRecord.extraction_cursor;
    }

    // Extract posts from all pages
    for (let page = 1; page <= max_pages; page++) {
      console.log(`[extract-build-posts] Fetching page ${page}: ${currentUrl}`);

      try {
        const { html, status } = await fetchPageWithRetry(currentUrl);
        totalPages++;

        // Save HTML snapshot
        try {
          await supabase.from('forum_page_snapshots').insert({
            forum_source_id: forumRecord.id,
            page_url: currentUrl,
            page_type: 'thread',
            fetch_method: 'direct',
            http_status: status,
            success: true,
            html,
            html_sha256: await sha256Hex(html),
            content_length: html.length,
            build_thread_id: threadRecord?.id,
            metadata: {
              extractor: 'extract-build-posts',
              page_number: page,
            },
          });
        } catch (e: any) {
          console.warn('[extract-build-posts] Failed to save snapshot (non-fatal):', e.message);
        }

        // Extract posts from this page
        const pagePosts = await extractPostsFromPage(
          html,
          currentUrl,
          domMap,
          startingPostNumber + allPosts.length
        );

        for (const post of pagePosts) {
          allPosts.push(post);
          if (post.author_handle && post.author_handle !== 'Unknown') {
            authorSet.add(post.author_handle);
            if (post.author_profile_url) {
              authorProfileUrls.set(post.author_handle, post.author_profile_url);
            }
          }
        }

        console.log(`[extract-build-posts] Page ${page}: extracted ${pagePosts.length} posts`);

        // Find next page
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
          break; // Only numbered pagination supported
        }
      } catch (e: any) {
        console.error(`[extract-build-posts] Page ${page} error: ${e.message}`);
        break;
      }
    }

    console.log(`[extract-build-posts] Total extracted: ${allPosts.length} posts from ${totalPages} pages`);

    // Upsert external identities for authors
    const handleToIdentityId = new Map<string, string>();
    if (authorSet.size > 0) {
      const nowIso = new Date().toISOString();
      const rows = Array.from(authorSet).map((handle) => ({
        platform: forumRecord.slug,
        handle,
        profile_url: authorProfileUrls.get(handle),
        last_seen_at: nowIso,
        updated_at: nowIso,
      }));

      const { data: upserted, error: upsertErr } = await supabase
        .from('external_identities')
        .upsert(rows, { onConflict: 'platform,handle' })
        .select('id, handle');

      if (upsertErr) {
        console.warn('[extract-build-posts] Failed to upsert identities (non-fatal):', upsertErr);
      } else {
        for (const row of upserted || []) {
          if (row?.handle && row?.id) {
            handleToIdentityId.set(row.handle, row.id);
          }
        }
      }
    }

    // Upsert posts
    let postsInserted = 0;
    let imagesExtracted = 0;

    if (allPosts.length > 0) {
      // Ensure thread record exists
      if (!threadRecord?.id) {
        const threadTitle = allPosts[0]?.content_text?.slice(0, 200) || threadUrl;
        const vehicleHints = extractVehicleHints(threadTitle);

        const { data: newThread, error: threadInsertErr } = await supabase
          .from('build_threads')
          .upsert(
            {
              forum_source_id: forumRecord.id,
              thread_url: threadUrl,
              thread_url_normalized: normalizeForumUrl(threadUrl),
              thread_title: threadTitle,
              author_handle: allPosts[0]?.author_handle,
              vehicle_hints: vehicleHints,
              extraction_status: 'extracting',
              first_post_date: allPosts[0]?.posted_at,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'thread_url' }
          )
          .select('id')
          .single();

        if (threadInsertErr) {
          throw new Error(`Failed to create thread: ${threadInsertErr.message}`);
        }
        threadRecord = { id: newThread.id };
      }

      // Build post rows
      const postRows = allPosts.map((p) => ({
        build_thread_id: threadRecord.id,
        post_number: p.post_number,
        post_id_external: p.post_id_external,
        author_handle: p.author_handle,
        author_profile_url: p.author_profile_url,
        external_identity_id: handleToIdentityId.get(p.author_handle) || null,
        posted_at: p.posted_at,
        content_text: p.content_text,
        content_html: p.content_html,
        images: p.images,
        image_count: p.images.length,
        has_video: p.video_urls.length > 0,
        video_urls: p.video_urls,
        quoted_handles: p.quoted_handles,
        external_links: p.external_links,
        post_type: p.post_type,
        like_count: p.like_count,
        word_count: p.word_count,
        content_hash: p.content_hash,
        org_mentions: p.org_mentions?.map(m => m.mention_text) || [],
      }));

      // Upsert in batches
      const batchSize = 50;
      for (let i = 0; i < postRows.length; i += batchSize) {
        const batch = postRows.slice(i, i + batchSize);

        const { data: inserted, error: insertErr } = await supabase
          .from('build_posts')
          .upsert(batch, { onConflict: 'content_hash' })
          .select('id, image_count');

        if (insertErr) {
          console.error('[extract-build-posts] Post insert error:', insertErr);
        } else {
          postsInserted += inserted?.length || 0;
          imagesExtracted += inserted?.reduce((s, p) => s + (p.image_count || 0), 0) || 0;
        }
      }

      // Update thread with extraction results
      const lastPost = allPosts[allPosts.length - 1];
      await supabase
        .from('build_threads')
        .update({
          extraction_status: 'complete',
          posts_extracted: (threadRecord.posts_extracted || 0) + postsInserted,
          images_extracted: (threadRecord.images_extracted || 0) + imagesExtracted,
          last_extracted_at: new Date().toISOString(),
          last_activity_date: lastPost?.posted_at || threadRecord.last_activity_date,
          extraction_cursor: currentUrl, // Save for potential resume
          post_count: (threadRecord.posts_extracted || 0) + allPosts.length,
          image_count_estimate: (threadRecord.images_extracted || 0) + imagesExtracted,
          updated_at: new Date().toISOString(),
        })
        .eq('id', threadRecord.id);

      // Queue org mentions for processing
      const orgMentionRows: any[] = [];
      for (const post of allPosts) {
        if (post.org_mentions && post.org_mentions.length > 0) {
          for (const mention of post.org_mentions) {
            orgMentionRows.push({
              source_thread_id: threadRecord.id,
              forum_source_id: forumRecord.id,
              vehicle_id: threadRecord.vehicle_id || null,
              mention_text: mention.mention_text,
              mention_context: mention.mention_context,
              mention_type: mention.mention_type,
              extracted_url: mention.extracted_url || null,
              status: 'pending',
            });
          }
        }
      }

      if (orgMentionRows.length > 0) {
        const { error: orgErr } = await supabase
          .from('org_mention_queue')
          .insert(orgMentionRows);

        if (orgErr) {
          console.warn('[extract-build-posts] Failed to queue org mentions (non-fatal):', orgErr.message);
        } else {
          console.log(`[extract-build-posts] Queued ${orgMentionRows.length} org mentions`);
        }
      }
    }

    // Update forum health
    await supabase.rpc('update_forum_health', {
      p_forum_id: forumRecord.id,
      p_success: true,
    });

    // Count org mentions
    const totalOrgMentions = allPosts.reduce((sum, p) => sum + (p.org_mentions?.length || 0), 0);

    return new Response(
      JSON.stringify({
        success: true,
        thread_id: threadRecord?.id,
        thread_url: threadUrl,
        forum_slug: forumRecord.slug,
        pages_fetched: totalPages,
        posts_extracted: allPosts.length,
        posts_inserted: postsInserted,
        images_extracted: imagesExtracted,
        authors_found: authorSet.size,
        org_mentions_queued: totalOrgMentions,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const e: any = error;
    console.error('[extract-build-posts] Error:', e.message || e);

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
