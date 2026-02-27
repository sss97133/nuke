/**
 * Rate limiting for Supabase Edge Functions.
 *
 * Strategy: fixed-window counter backed by Postgres.
 *   - Key format:  {namespace}:{ip}:{window_index}
 *   - Window index: floor(now_seconds / window_seconds)
 *   - Atomic upsert via rate_limit_increment() RPC (SECURITY DEFINER)
 *   - Fail open on any DB error — never block users due to rate-limit infra issues.
 *
 * Usage:
 *   import { checkRateLimit, rateLimitResponse, getClientIp } from '../_shared/rateLimit.ts';
 *
 *   const ip = getClientIp(req);
 *   const rl = await checkRateLimit(supabase, ip, { namespace: 'universal-search', windowSeconds: 60, maxRequests: 60 });
 *   if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);
 */

export interface RateLimitConfig {
  /** Namespace — identifies the function/endpoint */
  namespace: string;
  /** Length of the time window in seconds */
  windowSeconds: number;
  /** Maximum allowed requests per IP per window */
  maxRequests: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Requests remaining in the current window */
  remaining: number;
  /** Unix timestamp (seconds) when the current window resets */
  resetAt: number;
  /** Seconds until the client may retry (only set when !allowed) */
  retryAfter?: number;
  /** The observed count (useful for logging) */
  count: number;
}

/**
 * Extract client IP from Cloudflare / standard proxy headers.
 * Supabase Edge Functions run behind Deno Deploy + Cloudflare.
 */
export function getClientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

/**
 * Check the rate limit for the given identifier (typically an IP address).
 * Increments the counter atomically via Postgres and returns the result.
 */
export async function checkRateLimit(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  identifier: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const { namespace, windowSeconds, maxRequests } = config;
  const nowSeconds = Math.floor(Date.now() / 1000);

  // Fixed window: floor to the nearest window boundary
  const windowStart = nowSeconds - (nowSeconds % windowSeconds);
  const windowEnd = windowStart + windowSeconds;

  // Sanitize identifier to prevent key injection
  const safeId = identifier.replace(/[^a-zA-Z0-9.:_\-]/g, '_').slice(0, 64);
  const key = `${namespace}:${safeId}:${windowStart}`;

  const windowStartTs = new Date(windowStart * 1000).toISOString();
  const expiresAtTs   = new Date(windowEnd   * 1000).toISOString();

  try {
    const { data, error } = await supabase.rpc('rate_limit_increment', {
      p_key:          key,
      p_window_start: windowStartTs,
      p_expires_at:   expiresAtTs,
    });

    if (error) {
      console.warn('[rateLimit] DB error — failing open:', error.message);
      return { allowed: true, remaining: maxRequests, resetAt: windowEnd, count: 0 };
    }

    const count: number = typeof data === 'number' ? data : 1;
    const allowed = count <= maxRequests;
    const remaining = Math.max(0, maxRequests - count);

    return {
      allowed,
      remaining,
      resetAt: windowEnd,
      count,
      ...(allowed ? {} : { retryAfter: windowEnd - nowSeconds }),
    };
  } catch (err) {
    // Network / unexpected error — fail open
    console.warn('[rateLimit] Unexpected error — failing open:', err);
    return { allowed: true, remaining: maxRequests, resetAt: windowEnd, count: 0 };
  }
}

/**
 * Build a standard 429 Too Many Requests response.
 */
export function rateLimitResponse(
  result: RateLimitResult,
  corsHeaders: Record<string, string>,
  maxRequests?: number,
): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: 'Rate limit exceeded. Please slow down and try again.',
      retry_after: result.retryAfter ?? 60,
    }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Retry-After':          String(result.retryAfter ?? 60),
        'X-RateLimit-Limit':    String(maxRequests ?? 0),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset':    String(result.resetAt),
      },
    },
  );
}

/**
 * Return rate limit headers to add to successful responses so clients
 * can display remaining quota.
 */
export function rateLimitHeaders(
  result: RateLimitResult,
  maxRequests: number,
): Record<string, string> {
  return {
    'X-RateLimit-Limit':     String(maxRequests),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset':     String(result.resetAt),
  };
}
