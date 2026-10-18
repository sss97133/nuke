/**
 * Hybrid Page Fetcher
 *
 * Direct fetch with browser headers and UA rotation.
 * Used by archiveFetch as fallback when Firecrawl is not needed.
 */

import { isLoginPage } from "./batFetcher.ts";

export interface FetchResult {
  html: string | null;
  source: 'direct' | 'proxy' | 'cache';
  error?: string;
  statusCode?: number;
  authRequired?: boolean;
}

export interface FetchOptions {
  timeout?: number;
  retries?: number;
  /** One identified public request; source backoff handles subsequent attempts. */
  publicOnly?: boolean;
}

const DEFAULT_TIMEOUT = 15000;
const DEFAULT_RETRIES = 2;

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

function getHeaders(attempt: number, publicOnly = false): Record<string, string> {
  if (publicOnly) return {
    "User-Agent": "NukeListingCollector/1.0 (+https://nuke.ag)",
    "Accept": "text/html,application/xhtml+xml",
  };
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
  const retries = options?.publicOnly ? 0 : (options?.retries || DEFAULT_RETRIES);

  let lastError: string | undefined;
  let lastStatus: number | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      let response: Response;
      try {
        response = await fetch(url, {
          headers: getHeaders(attempt, options?.publicOnly),
          signal: controller.signal,
          redirect: 'manual',  // detect login/auth redirects before following
        });
      } finally {
        clearTimeout(timeoutId);
      }
      lastStatus = response.status;

      // Detect redirects — check for login/auth before following
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location') || '';
        if (location.includes('/login') || location.includes('/account/login') || location.includes('wp-login')) {
          console.error(`[hybridFetcher] AUTH_REQUIRED: Redirected to login (${response.status} -> ${location.slice(0, 100)})`);
          return {
            html: null,
            source: 'direct',
            error: `AUTH_REQUIRED: Redirected to login (${response.status})`,
            statusCode: response.status,
            authRequired: true,
          };
        }
        // Legitimate redirect — follow it manually (one hop)
        try {
          const redirectUrl = location.startsWith('http') ? location : new URL(location, url).href;
          if (options?.publicOnly) {
            const origin = new URL(url);
            const target = new URL(redirectUrl);
            const isCraigslist = (host: string) => host === 'craigslist.org' || host.endsWith('.craigslist.org');
            if (target.protocol !== 'https:' || (target.hostname !== origin.hostname &&
              !(isCraigslist(origin.hostname) && isCraigslist(target.hostname)))) {
              return { html: null, source: 'direct', error: 'Blocked by site: redirect outside public source', statusCode: response.status };
            }
          }
          const redirectResp = await fetch(redirectUrl, {
            headers: getHeaders(attempt, options?.publicOnly),
            signal: AbortSignal.timeout(timeout),
            redirect: 'manual',
          });
          lastStatus = redirectResp.status;
          if (redirectResp.ok) {
            const html = await redirectResp.text();
            if (isLoginPage(html)) {
              console.error(`[hybridFetcher] AUTH_REQUIRED: Redirect target is login page`);
              return {
                html: null,
                source: 'direct',
                error: 'AUTH_REQUIRED: Redirect target is a login page',
                statusCode: redirectResp.status,
                authRequired: true,
              };
            }
            if (html.length > 1000 && !html.includes('Access Denied') && !html.includes('blocked')) {
              return { html, source: 'direct', statusCode: redirectResp.status };
            }
            lastError = 'Blocked by site (after redirect)';
          } else {
            lastError = `HTTP ${redirectResp.status} (after redirect)`;
          }
        } catch (_) {
          lastError = `Redirect follow failed (${response.status} -> ${location.slice(0, 100)})`;
        }
      } else if (response.ok) {
        const html = await response.text();

        // Check for login page disguised as 200 OK
        if (isLoginPage(html)) {
          console.error(`[hybridFetcher] AUTH_REQUIRED: Got login page instead of content (${html.length} bytes)`);
          return {
            html: null,
            source: 'direct',
            error: 'AUTH_REQUIRED: Got login page instead of content',
            statusCode: response.status,
            authRequired: true,
          };
        }

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
