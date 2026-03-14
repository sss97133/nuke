/**
 * Hybrid Page Fetcher
 *
 * Direct fetch with browser headers and UA rotation.
 * Used by archiveFetch as fallback when Firecrawl is not needed.
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

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

function getHeaders(attempt: number): Record<string, string> {
  const ua = USER_AGENTS[attempt % USER_AGENTS.length];
  return {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Upgrade-Insecure-Requests': '1',
  };
}

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
        if (html.length > 1000 && !html.includes('Access Denied') && !html.includes('blocked')) {
          return { html, source: 'direct', statusCode: response.status };
        }
        lastError = 'Blocked by site';
      } else {
        lastError = `HTTP ${response.status}`;
        if (response.status === 404) {
          return { html: null, source: 'direct', error: 'Not found (404)', statusCode: 404 };
        }
      }

      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    } catch (err: any) {
      lastError = err.message;
    }
  }

  return { html: null, source: 'direct', error: lastError, statusCode: lastStatus };
}

export function needsJsRendering(url: string): boolean {
  const jsRenderingSites = ['carsandbids.com', 'collectingcars.com', 'pcarmarket.com'];
  return jsRenderingSites.some(site => url.includes(site));
}
