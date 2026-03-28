/**
 * Transparent Hybrid BaT Page Fetcher
 * 
 * DECISION TREE (No Magic):
 * 1. Always try direct fetch first (FREE)
 * 2. If rate limited (403/429), fall back to Firecrawl (PAID ~$0.01)
 * 3. Log all Firecrawl usage to api_usage_logs for cost tracking
 * 
 * This is NOT a black box - every decision is logged and costs are tracked.
 */

export interface FetchResult {
  html: string | null;
  source: 'direct' | 'firecrawl';
  costCents: number;  // 0 for direct, ~1 for firecrawl
  error?: string;
  statusCode?: number;
  authRequired?: boolean;  // True if redirected to login or login page detected
}

export interface FetchOptions {
  forceFirecrawl?: boolean;        // Skip direct, go straight to Firecrawl
  skipFirecrawlFallback?: boolean; // Never use Firecrawl (for cost control)
  preferFirecrawl?: boolean;       // Use Firecrawl by default (for subscribers)
  timeout?: number;                // Custom timeout in ms
  waitForJs?: number;              // Firecrawl waitFor param (ms)
}

const DIRECT_FETCH_TIMEOUT = 10000;  // 10 seconds
const FIRECRAWL_TIMEOUT = 30000;     // 30 seconds
const FIRECRAWL_COST_CENTS = 1;      // ~$0.01 per scrape

// Standard browser headers to avoid basic bot detection
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
};

/**
 * Detect if HTML content is a login page rather than actual content.
 * Shared across all fetchers to prevent caching login pages as valid content.
 */
export function isLoginPage(html: string): boolean {
  const lower = html.toLowerCase();

  // Generic login form indicators
  if (lower.includes('id="login-form"')) return true;
  if (lower.includes('action="/login"') || lower.includes('action="/account/login"')) return true;
  if (lower.includes('action="/wp-login.php"')) return true;
  if (lower.includes('name="log"') && lower.includes('name="pwd"')) return true;

  // Login page title indicators
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    const title = titleMatch[1].toLowerCase();
    if (title.includes('log in') || title.includes('login') || title.includes('sign in')) return true;
  }

  // Platform-specific: BaT login
  if (lower.includes('bringatrailer.com') && lower.includes('wp-login')) return true;

  // Platform-specific: common SSO/OAuth redirects that render as pages
  if (lower.includes('id="auth0-lock-container"')) return true;
  if (lower.includes('accounts.google.com/signin')) return true;

  // Common login page body patterns (multiple signals needed to avoid false positives)
  const loginSignals = [
    lower.includes('type="password"'),
    lower.includes('forgot password') || lower.includes('forgot your password'),
    lower.includes('sign in to') || lower.includes('log in to'),
    lower.includes('create an account') || lower.includes('register'),
  ].filter(Boolean).length;
  if (loginSignals >= 2) return true;

  return false;
}

/**
 * Transparent hybrid fetcher for BaT pages
 * Always tries free direct fetch first, falls back to Firecrawl only on rate limits
 */
export async function fetchBatPage(
  url: string,
  options?: FetchOptions
): Promise<FetchResult> {
  const {
    forceFirecrawl = false,
    skipFirecrawlFallback = false,
    timeout = DIRECT_FETCH_TIMEOUT,
    waitForJs = 3000,
  } = options || {};

  // STEP 1: Try direct fetch (FREE) with redirect: "manual" to detect login redirects
  if (!forceFirecrawl) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        headers: BROWSER_HEADERS,
        signal: controller.signal,
        redirect: 'manual',  // CRITICAL: detect login/auth redirects instead of silently following
      });

      clearTimeout(timeoutId);

      // Detect redirects — usually means rate limit or auth required
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location') || '';
        if (location.includes('/account/login') || location.includes('/login') || location.includes('wp-login')) {
          console.error(`[batFetcher] AUTH_REQUIRED: Redirected to login (${response.status} -> ${location.slice(0, 100)})`);
          return {
            html: null,
            source: 'direct',
            costCents: 0,
            statusCode: response.status,
            error: `AUTH_REQUIRED: Redirected to login (${response.status})`,
            authRequired: true,
          };
        }
        if (location.includes('cloudflare') || location.includes('challenge')) {
          console.error(`[batFetcher] BLOCKED: Cloudflare challenge redirect (${response.status})`);
          // Fall through to Firecrawl which may bypass Cloudflare
        } else {
          // Legitimate redirect (www -> non-www, http -> https, etc.) — follow it manually
          console.log(`[batFetcher] Following redirect ${response.status} -> ${location.slice(0, 100)}`);
          try {
            const redirectResp = await fetch(location || url, {
              headers: BROWSER_HEADERS,
              signal: AbortSignal.timeout(timeout),
              redirect: 'manual',
            });
            if (redirectResp.ok) {
              const html = await redirectResp.text();
              if (isLoginPage(html)) {
                console.error(`[batFetcher] AUTH_REQUIRED: Redirect target is a login page`);
                return {
                  html: null,
                  source: 'direct',
                  costCents: 0,
                  statusCode: redirectResp.status,
                  error: 'AUTH_REQUIRED: Redirect target is a login page',
                  authRequired: true,
                };
              }
              console.log(`[batFetcher] Direct fetch SUCCESS (after redirect) for ${url} (${html.length} bytes)`);
              return { html, source: 'direct', costCents: 0, statusCode: redirectResp.status };
            }
          } catch (_) {
            // Redirect follow failed — fall through to Firecrawl
          }
        }
      } else if (response.ok) {
        const html = await response.text();

        // Check if we got a login page disguised as 200 OK
        if (isLoginPage(html)) {
          console.error(`[batFetcher] AUTH_REQUIRED: Got login page instead of content (${html.length} bytes)`);
          return {
            html: null,
            source: 'direct',
            costCents: 0,
            statusCode: response.status,
            error: 'AUTH_REQUIRED: Got login page instead of listing',
            authRequired: true,
          };
        }

        console.log(`[batFetcher] Direct fetch SUCCESS for ${url} (${html.length} bytes)`);
        return { html, source: 'direct', costCents: 0, statusCode: response.status };
      } else if (response.status === 403 || response.status === 429) {
        // Rate limited - Firecrawl can help
        console.log(`[batFetcher] Rate limited (HTTP ${response.status}), will try Firecrawl...`);
        // Fall through to Firecrawl
      } else {
        // Other HTTP error - don't waste Firecrawl credits on 404, 500, etc.
        console.error(`[batFetcher] HTTP ${response.status} for ${url} - not retrying with Firecrawl`);
        return {
          html: null,
          source: 'direct',
          costCents: 0,
          statusCode: response.status,
          error: `HTTP ${response.status}`,
        };
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log(`[batFetcher] Direct fetch timeout for ${url}`);
      } else {
        console.log(`[batFetcher] Direct fetch failed: ${err.message}`);
      }
      // Network error / timeout - might work with Firecrawl (different IP/proxy)
    }
  }

  // STEP 2: Firecrawl fallback (PAID)
  if (skipFirecrawlFallback) {
    console.log(`[batFetcher] Firecrawl fallback disabled, returning null`);
    return {
      html: null,
      source: 'direct',
      costCents: 0,
      error: 'Direct fetch failed, Firecrawl fallback disabled',
    };
  }

  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!firecrawlKey) {
    console.error(`[batFetcher] FIRECRAWL_API_KEY not set, cannot fall back`);
    return {
      html: null,
      source: 'direct',
      costCents: 0,
      error: 'FIRECRAWL_API_KEY not configured',
    };
  }

  try {
    console.log(`[batFetcher] Using Firecrawl for ${url}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FIRECRAWL_TIMEOUT);

    const fcResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${firecrawlKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ['html'],  // Only request HTML (cheaper than extract)
        onlyMainContent: false,
        waitFor: waitForJs,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!fcResponse.ok) {
      const errorText = await fcResponse.text().catch(() => '');
      console.error(`[batFetcher] Firecrawl API error: HTTP ${fcResponse.status} - ${errorText.slice(0, 200)}`);
      return {
        html: null,
        source: 'firecrawl',
        costCents: FIRECRAWL_COST_CENTS,
        statusCode: fcResponse.status,
        error: `Firecrawl HTTP ${fcResponse.status}`,
      };
    }

    const result = await fcResponse.json();

    if (result.success && result.data?.html) {
      // Even Firecrawl can return a login page (e.g. if the site has a hard auth wall)
      if (isLoginPage(result.data.html)) {
        console.error(`[batFetcher] AUTH_REQUIRED: Firecrawl returned login page for ${url}`);
        return {
          html: null,
          source: 'firecrawl',
          costCents: FIRECRAWL_COST_CENTS,
          error: 'AUTH_REQUIRED: Firecrawl returned login page',
          authRequired: true,
        };
      }
      console.log(`[batFetcher] Firecrawl SUCCESS for ${url} (${result.data.html.length} bytes)`);
      return {
        html: result.data.html,
        source: 'firecrawl',
        costCents: FIRECRAWL_COST_CENTS,
      };
    }

    console.error(`[batFetcher] Firecrawl returned no HTML: ${JSON.stringify(result.error || {}).slice(0, 200)}`);
    return {
      html: null,
      source: 'firecrawl',
      costCents: FIRECRAWL_COST_CENTS,
      error: result.error || 'No HTML returned from Firecrawl',
    };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.error(`[batFetcher] Firecrawl timeout for ${url}`);
      return {
        html: null,
        source: 'firecrawl',
        costCents: FIRECRAWL_COST_CENTS,
        error: 'Firecrawl request timeout',
      };
    }
    console.error(`[batFetcher] Firecrawl error: ${err.message}`);
    return {
      html: null,
      source: 'firecrawl',
      costCents: FIRECRAWL_COST_CENTS,
      error: err.message,
    };
  }
}

/**
 * Log Firecrawl usage to api_usage_logs for cost tracking
 * Only logs when Firecrawl was used (costCents > 0)
 */
export async function logFetchCost(
  supabase: any,
  functionName: string,
  url: string,
  result: FetchResult
): Promise<void> {
  // Only log paid requests
  if (result.costCents === 0) return;

  try {
    await supabase.from('api_usage_logs').insert({
      user_id: null,  // System scraping, no user context
      provider: 'firecrawl',
      function_name: functionName,
      cost_cents: result.costCents,
      success: result.html !== null,
      error_message: result.error || null,
      metadata: {
        url,
        source: result.source,
        status_code: result.statusCode,
      },
    });
    console.log(`[batFetcher] Logged Firecrawl cost: ${result.costCents} cents for ${functionName}`);
  } catch (err: any) {
    // Don't fail the main operation if logging fails
    console.error(`[batFetcher] Failed to log cost: ${err.message}`);
  }
}

/**
 * Helper: Check if we should use Firecrawl based on auction urgency
 * Use for live polling cost optimization
 */
export function shouldUseFirecrawlForLivePolling(
  auctionEndDate: Date | string | null,
  directFetchFailed: boolean
): boolean {
  if (!directFetchFailed) return false;  // Direct worked, no need for Firecrawl
  if (!auctionEndDate) return false;     // Unknown end date, don't spend money

  const endDate = typeof auctionEndDate === 'string' ? new Date(auctionEndDate) : auctionEndDate;
  const minutesToEnd = (endDate.getTime() - Date.now()) / (1000 * 60);

  // Only worth paying for Firecrawl in final 10 minutes
  if (minutesToEnd > 0 && minutesToEnd <= 10) {
    console.log(`[batFetcher] Auction ends in ${minutesToEnd.toFixed(1)} min - Firecrawl justified`);
    return true;
  }

  console.log(`[batFetcher] Auction ends in ${minutesToEnd.toFixed(1)} min - not worth Firecrawl cost`);
  return false;
}

