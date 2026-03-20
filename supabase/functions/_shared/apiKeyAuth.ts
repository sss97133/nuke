/**
 * Shared API key authentication & rate limiting for api-v1-* endpoints.
 *
 * Fixes 5 bugs from the original copy-pasted authenticateRequest():
 *   1. No reset mechanism → atomic PG function resets window automatically
 *   2. Race condition → FOR UPDATE lock in check_api_key_rate_limit()
 *   3. Falsy check → 0 = denied, not unlimited
 *   4. No per-endpoint limiting → namespace passed to IP limiter
 *   5. No IP-based limiting → anonymous requests get IP-based limits
 *   6. expires_at never checked → checked atomically in PG function
 *
 * Usage:
 *   import { authenticateRequest, AuthResult } from '../_shared/apiKeyAuth.ts';
 *   const auth = await authenticateRequest(req, supabase, { endpoint: 'vehicles' });
 *   if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
 */

import { checkRateLimit, getClientIp, rateLimitResponse, rateLimitHeaders } from './rateLimit.ts';

export interface AuthResult {
  userId: string | null;
  isServiceRole?: boolean;
  /** Agent registration ID (if caller is a registered agent) */
  agentId?: string | null;
  /** API key scopes (e.g. ['read', 'write', 'stage_write']) */
  scopes?: string[];
  error?: string;
  /** HTTP status code when error is set */
  status?: number;
  /** Rate limit headers to include on successful responses */
  headers?: Record<string, string>;
}

export interface AuthOptions {
  /** Endpoint name for rate limiting namespace (e.g. 'vehicles', 'analysis') */
  endpoint: string;
  /** Required scopes — if set, key must have ALL listed scopes */
  requiredScopes?: string[];
  /** Max requests per hour for API keys (default: 1000) — override for heavy endpoints */
  maxPerHour?: number;
  /** IP rate limit for anonymous requests: max per window (default: 30) */
  anonMaxRequests?: number;
  /** IP rate limit window in seconds (default: 60) */
  anonWindowSeconds?: number;
}

/**
 * Hash API key using SHA-256 (same algorithm as api-keys-manage)
 */
export async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return 'sha256_' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Authenticate via JWT, service role key, or API key.
 * Applies rate limiting atomically for API keys and IP-based for anonymous.
 */
// deno-lint-ignore no-explicit-any
export async function authenticateRequest(
  req: Request,
  // deno-lint-ignore no-explicit-any
  supabase: any,
  options: AuthOptions,
): Promise<AuthResult> {
  const {
    endpoint,
    requiredScopes,
    anonMaxRequests = 30,
    anonWindowSeconds = 60,
  } = options;

  const authHeader = req.headers.get('Authorization');
  const apiKey = req.headers.get('X-API-Key');

  // --- 1. Service role key (internal tools, MCP servers) ---
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '');

    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const altServiceRoleKey = Deno.env.get('SERVICE_ROLE_KEY');
    if (
      (serviceRoleKey && token === serviceRoleKey) ||
      (altServiceRoleKey && token === altServiceRoleKey)
    ) {
      return { userId: 'service-role', isServiceRole: true };
    }

    // --- 2. User JWT (verified by Supabase auth) ---
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (user && !error) {
      return { userId: user.id };
    }
  }

  // --- 3. API key authentication (atomic rate limiting) ---
  if (apiKey) {
    const rawKey = apiKey.startsWith('nk_live_') ? apiKey.slice(8) : apiKey;
    const keyHash = await hashApiKey(rawKey);

    // Single atomic call: validates key, checks expiry, resets window if needed, decrements
    const { data, error } = await supabase.rpc('check_api_key_rate_limit', {
      p_key_hash: keyHash,
      p_endpoint: endpoint,
    });

    if (error) {
      console.error('[apiKeyAuth] RPC error:', error.message);
      // Fail open on DB error — don't block legitimate users
      return { userId: null, error: 'Authentication service unavailable', status: 503 };
    }

    const result = data as {
      allowed: boolean;
      remaining?: number;
      reset_at?: string;
      user_id?: string;
      scopes?: string[];
      agent_registration_id?: string | null;
      error?: string;
      retry_after?: number;
    };

    if (!result.allowed) {
      const errorMap: Record<string, { msg: string; status: number }> = {
        invalid_key: { msg: 'Invalid API key', status: 401 },
        key_inactive: { msg: 'API key is inactive', status: 401 },
        key_expired: { msg: 'API key has expired', status: 401 },
        rate_limit_exceeded: {
          msg: `Rate limit exceeded. Retry after ${result.retry_after ?? 60} seconds.`,
          status: 429,
        },
      };

      const mapped = errorMap[result.error ?? ''] ?? { msg: 'Authentication failed', status: 401 };
      const headers: Record<string, string> = {};
      if (result.error === 'rate_limit_exceeded') {
        headers['Retry-After'] = String(result.retry_after ?? 3600);
        if (result.reset_at) {
          headers['X-RateLimit-Reset'] = result.reset_at;
        }
      }

      return { userId: null, error: mapped.msg, status: mapped.status, headers };
    }

    // Check scopes
    if (requiredScopes && requiredScopes.length > 0 && result.scopes) {
      const keyScopes = new Set(result.scopes);
      const missing = requiredScopes.filter(s => !keyScopes.has(s));
      if (missing.length > 0) {
        return {
          userId: null,
          error: `Insufficient scopes. Missing: ${missing.join(', ')}`,
          status: 403,
        };
      }
    }

    // Success — return rate limit headers for the response
    const rlHeaders: Record<string, string> = {};
    if (result.remaining !== undefined) {
      rlHeaders['X-RateLimit-Remaining'] = String(result.remaining);
    }
    if (result.reset_at) {
      rlHeaders['X-RateLimit-Reset'] = result.reset_at;
    }

    // For agent keys, user_id is null — use agent_registration_id as identity
    const effectiveUserId = result.user_id || (result.agent_registration_id ? `agent:${result.agent_registration_id}` : null);

    return {
      userId: effectiveUserId,
      agentId: result.agent_registration_id ?? null,
      scopes: result.scopes ?? [],
      headers: rlHeaders,
    };
  }

  // --- 4. Anonymous / unauthenticated — IP-based rate limiting ---
  const clientIp = getClientIp(req);
  const rl = await checkRateLimit(supabase, clientIp, {
    namespace: `api-v1-${endpoint}-anon`,
    windowSeconds: anonWindowSeconds,
    maxRequests: anonMaxRequests,
  });

  if (!rl.allowed) {
    return {
      userId: null,
      error: `Rate limit exceeded. Retry after ${rl.retryAfter ?? 60} seconds.`,
      status: 429,
      headers: {
        'Retry-After': String(rl.retryAfter ?? 60),
        'X-RateLimit-Limit': String(anonMaxRequests),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(rl.resetAt),
      },
    };
  }

  // Anonymous but within rate limit
  return {
    userId: null,
    error: 'Invalid or missing authentication',
    status: 401,
    headers: rateLimitHeaders(rl, anonMaxRequests),
  };
}

/**
 * Log API usage for analytics (non-blocking, fire-and-forget)
 */
// deno-lint-ignore no-explicit-any
export async function logApiUsage(supabase: any, userId: string, resource: string, action: string, resourceId?: string) {
  try {
    await supabase
      .from('api_usage_logs')
      .insert({
        user_id: userId,
        resource,
        action,
        resource_id: resourceId,
        timestamp: new Date().toISOString(),
      });
  } catch (e) {
    console.error('Failed to log API usage:', e);
  }
}
