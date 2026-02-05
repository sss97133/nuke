/**
 * Hybrid Page Fetcher
 *
 * Tries multiple methods to fetch a page without relying on Firecrawl:
 * 1. Direct fetch with browser headers
 * 2. Direct fetch with different User-Agent rotation
 * 3. Returns failure if all methods fail (caller can retry or skip)
 *
 * NO FIRECRAWL - Firecrawl credits are exhausted
 */

export interface FetchResult {
  html: string | null;
  source: 'direct' | 'proxy' | 'cache';
  error?: string;
  statusCode?: number;
}

export interface FetchOptions {
  timeout?: number;
  retries?: number;
}

const DEFAULT_TIMEOUT = 15000;
const DEFAULT_RETRIES = 2;

// Rotate through different User-Agents
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

function getHeaders(attempt: number): Record<string, string> {
  const ua = USER_AGENTS[attempt % USER_AGENTS.length];
  return {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };
}

/**
 * Fetch page without Firecrawl
 */
export async function fetchPage(
  url: string,
  options?: FetchOptions
): Promise<FetchResult> {
  const timeout = options?.timeout || DEFAULT_TIMEOUT;
  const retries = options?.retries || DEFAULT_RETRIES;

  let lastError: string | undefined;
  let lastStatus: number | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        headers: getHeaders(attempt),
        signal: controller.signal,
        redirect: 'follow',
      });

      clearTimeout(timeoutId);
      lastStatus = response.status;

      if (response.ok) {
        const html = await response.text();

        // Check if we got actual content (not a block page)
        if (html.length > 1000 && !html.includes('Access Denied') && !html.includes('blocked')) {
          console.log(`[hybridFetcher] Direct fetch SUCCESS (attempt ${attempt + 1}) - ${html.length} bytes`);
          return { html, source: 'direct', statusCode: response.status };
        } else {
          console.log(`[hybridFetcher] Got blocked response (attempt ${attempt + 1})`);
          lastError = 'Blocked by site';
        }
      } else {
        console.log(`[hybridFetcher] HTTP ${response.status} (attempt ${attempt + 1})`);
        lastError = `HTTP ${response.status}`;

        // Don't retry on 404 - page doesn't exist
        if (response.status === 404) {
          return { html: null, source: 'direct', error: 'Not found (404)', statusCode: 404 };
        }
      }

      // Wait before retry
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    } catch (err: any) {
      console.log(`[hybridFetcher] Error (attempt ${attempt + 1}): ${err.message}`);
      lastError = err.message;
    }
  }

  return { html: null, source: 'direct', error: lastError, statusCode: lastStatus };
}

/**
 * Check if a URL is likely to need JS rendering (React SPAs, etc.)
 */
export function needsJsRendering(url: string): boolean {
  const jsRenderingSites = [
    'carsandbids.com',
    'collectingcars.com',
    'pcarmarket.com',
  ];
  return jsRenderingSites.some(site => url.includes(site));
}
