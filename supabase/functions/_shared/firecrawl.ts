/**
 * Firecrawl v1 client wrapper for Supabase Edge Functions.
 *
 * Goals:
 * - Stop hard failures from deprecated v0 endpoints
 * - Normalize response shapes (success=false but HTML exists, etc.)
 * - Add small, bounded retry/backoff for 429/5xx/timeouts
 * - Provide helpers for /scrape and /map (URL discovery)
 */
 
export const FIRECRAWL_SCRAPE_URL = 'https://api.firecrawl.dev/v1/scrape';
export const FIRECRAWL_MAP_URL = 'https://api.firecrawl.dev/v1/map';
 
export type FirecrawlProxyMode = 'stealth' | 'auto' | 'basic' | string;
 
export interface FirecrawlScrapeRequest {
  url: string;
  formats: string[];
  onlyMainContent?: boolean;
  waitFor?: number;
  timeout?: number;
  headers?: Record<string, string>;
  includeTags?: string[];
  excludeTags?: string[];
  removeBase64Images?: boolean;
  actions?: any[];
  mobile?: boolean;
  proxy?: FirecrawlProxyMode;
  extract?: {
    schema: any;
    prompt?: string;
    systemPrompt?: string;
  };
  // Allow forward-compatible Firecrawl options
  [key: string]: any;
}
 
export interface FirecrawlScrapeResult {
  httpStatus: number;
  ok: boolean;
  success: boolean;
  data: {
    html: string | null;
    markdown: string | null;
    extract: any | null;
    metadata: any | null;
  };
  blocked: boolean;
  blockedSignals: string[];
  error: string | null;
  raw: any | null;
  attempts: number;
}
 
export interface FirecrawlMapResult {
  httpStatus: number;
  ok: boolean;
  success: boolean;
  links: string[];
  error: string | null;
  raw: any | null;
  attempts: number;
}
 
export interface FirecrawlClientOptions {
  apiKey?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
}
 
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
 
function getFirecrawlApiKey(explicit?: string): string {
  const key = (explicit ?? Deno.env.get('FIRECRAWL_API_KEY') ?? '').trim();
  if (!key) throw new Error('FIRECRAWL_API_KEY not configured');
  return key;
}
 
function safeJsonParse(text: string): any | null {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}
 
function asString(val: any): string {
  if (val == null) return '';
  if (typeof val === 'string') return val;
  try {
    return JSON.stringify(val);
  } catch {
    return String(val);
  }
}
 
function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}
 
function detectBlockSignals(html: string | null, markdown: string | null): string[] {
  const haystack = `${html || ''}\n${markdown || ''}`.toLowerCase();
  const signals: string[] = [];
 
  // KSL / PerimeterX
  if (haystack.includes('perimeterx')) signals.push('PerimeterX');
  if (haystack.includes('_pxcustomlogo')) signals.push('_pxCustomLogo');
  if (haystack.includes('blocked request notification')) signals.push('Blocked Request Notification');
  if (haystack.includes('forbiddenconnection@deseretdigital.com')) signals.push('KSL forbiddenconnection@deseretdigital.com');
  if (haystack.includes('access to this page has been denied')) signals.push('Access denied');
 
  // Common bot walls
  if (haystack.includes('attention required') && haystack.includes('cloudflare')) signals.push('Cloudflare');
  if (haystack.includes('captcha')) signals.push('CAPTCHA');
 
  return signals;
}
 
function normalizeScrapePayload(parsed: any): {
  success: boolean;
  html: string | null;
  markdown: string | null;
  extract: any | null;
  metadata: any | null;
  error: any | null;
} {
  const success = Boolean(parsed?.success);
 
  // v1 shape
  const html = typeof parsed?.data?.html === 'string' ? parsed.data.html : null;
  const markdown = typeof parsed?.data?.markdown === 'string' ? parsed.data.markdown : null;
  const extract = parsed?.data?.extract ?? null;
  const metadata = parsed?.data?.metadata ?? null;
 
  // Some older callers assumed root-level fields; keep a small compatibility shim
  const compatHtml = html ?? (typeof parsed?.html === 'string' ? parsed.html : null);
  const compatMarkdown = markdown ?? (typeof parsed?.markdown === 'string' ? parsed.markdown : null);
  const compatExtract = extract ?? parsed?.extract ?? null;
 
  return {
    success,
    html: compatHtml,
    markdown: compatMarkdown,
    extract: compatExtract,
    metadata,
    error: parsed?.error ?? null,
  };
}
 
export async function firecrawlScrape(
  request: FirecrawlScrapeRequest,
  options: FirecrawlClientOptions = {}
): Promise<FirecrawlScrapeResult> {
  const apiKey = getFirecrawlApiKey(options.apiKey);
  const timeoutMs = options.timeoutMs ?? 45000;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const backoffBaseMs = options.backoffBaseMs ?? 800;
  const backoffMaxMs = options.backoffMaxMs ?? 8000;
 
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
 
      const response = await fetch(FIRECRAWL_SCRAPE_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
 
      clearTimeout(timeoutId);
 
      const text = await response.text().catch(() => '');
      const parsed = safeJsonParse(text);
      const normalized = parsed ? normalizeScrapePayload(parsed) : null;
      const html = normalized?.html ?? null;
      const markdown = normalized?.markdown ?? null;
      const extract = normalized?.extract ?? null;
      const metadata = normalized?.metadata ?? null;
      const blockedSignals = detectBlockSignals(html, markdown);
 
      const result: FirecrawlScrapeResult = {
        httpStatus: response.status,
        ok: response.ok,
        success: Boolean(response.ok && normalized?.success),
        data: { html, markdown, extract, metadata },
        blocked: blockedSignals.length > 0,
        blockedSignals,
        error: null,
        raw: parsed,
        attempts: attempt,
      };
 
      // Error text normalization (keep short)
      if (!response.ok) {
        const maybeError = normalized?.error ?? null;
        result.error = `Firecrawl HTTP ${response.status}${maybeError ? `: ${asString(maybeError).slice(0, 250)}` : text ? `: ${text.slice(0, 250)}` : ''}`;
      } else if (normalized && !normalized.success) {
        // success=false but HTTP 200
        result.error = `Firecrawl success=false${normalized.error ? `: ${asString(normalized.error).slice(0, 250)}` : ''}`;
      } else if (!normalized) {
        result.error = 'Firecrawl returned non-JSON response';
      }
 
      // If Firecrawl returned useful payload (html/markdown/extract), return it even if success=false.
      if (result.data.html || result.data.markdown || result.data.extract) {
        return result;
      }
 
      // Retry on retryable HTTP statuses only (bounded)
      if (attempt < maxAttempts && isRetryableHttpStatus(response.status)) {
        const backoff = Math.min(backoffMaxMs, backoffBaseMs * Math.pow(2, attempt - 1));
        const jitter = Math.floor(Math.random() * 250);
        await sleep(backoff + jitter);
        continue;
      }
 
      return result;
    } catch (err: any) {
      const isAbort = err?.name === 'AbortError';
      const result: FirecrawlScrapeResult = {
        httpStatus: 0,
        ok: false,
        success: false,
        data: { html: null, markdown: null, extract: null, metadata: null },
        blocked: false,
        blockedSignals: [],
        error: isAbort ? 'Firecrawl request timeout' : (err?.message || String(err)),
        raw: null,
        attempts: attempt,
      };
 
      if (attempt < maxAttempts) {
        const backoff = Math.min(backoffMaxMs, backoffBaseMs * Math.pow(2, attempt - 1));
        const jitter = Math.floor(Math.random() * 250);
        await sleep(backoff + jitter);
        continue;
      }
 
      return result;
    }
  }
 
  // Should be unreachable
  return {
    httpStatus: 0,
    ok: false,
    success: false,
    data: { html: null, markdown: null, extract: null, metadata: null },
    blocked: false,
    blockedSignals: [],
    error: 'Unknown Firecrawl error',
    raw: null,
    attempts: maxAttempts,
  };
}
 
export async function firecrawlMap(
  url: string,
  options: FirecrawlClientOptions & {
    limit?: number;
    search?: string;
    ignoreSitemap?: boolean;
    sitemapOnly?: boolean;
    includeSubdomains?: boolean;
    timeout?: number;
    location?: any;
  } = {}
): Promise<FirecrawlMapResult> {
  const apiKey = getFirecrawlApiKey(options.apiKey);
  const timeoutMs = options.timeoutMs ?? 45000;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const backoffBaseMs = options.backoffBaseMs ?? 800;
  const backoffMaxMs = options.backoffMaxMs ?? 8000;
 
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
 
      const response = await fetch(FIRECRAWL_MAP_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          limit: options.limit,
          search: options.search,
          ignoreSitemap: options.ignoreSitemap,
          sitemapOnly: options.sitemapOnly,
          includeSubdomains: options.includeSubdomains,
          timeout: options.timeout,
          location: options.location,
        }),
        signal: controller.signal,
      });
 
      clearTimeout(timeoutId);
 
      const text = await response.text().catch(() => '');
      const parsed = safeJsonParse(text);
      const links = Array.isArray(parsed?.links) ? parsed.links.filter((l: any) => typeof l === 'string') : [];
 
      const result: FirecrawlMapResult = {
        httpStatus: response.status,
        ok: response.ok,
        success: Boolean(response.ok && parsed?.success),
        links,
        error: null,
        raw: parsed,
        attempts: attempt,
      };
 
      if (!response.ok) {
        result.error = `Firecrawl map HTTP ${response.status}${text ? `: ${text.slice(0, 250)}` : ''}`;
      } else if (!parsed?.success) {
        result.error = `Firecrawl map success=false${parsed?.error ? `: ${asString(parsed.error).slice(0, 250)}` : ''}`;
      }
 
      // Return even if success=false; caller can decide.
      if (result.links.length > 0 || !isRetryableHttpStatus(response.status) || attempt === maxAttempts) {
        return result;
      }
 
      const backoff = Math.min(backoffMaxMs, backoffBaseMs * Math.pow(2, attempt - 1));
      const jitter = Math.floor(Math.random() * 250);
      await sleep(backoff + jitter);
    } catch (err: any) {
      const isAbort = err?.name === 'AbortError';
      const result: FirecrawlMapResult = {
        httpStatus: 0,
        ok: false,
        success: false,
        links: [],
        error: isAbort ? 'Firecrawl map timeout' : (err?.message || String(err)),
        raw: null,
        attempts: attempt,
      };
 
      if (attempt < maxAttempts) {
        const backoff = Math.min(backoffMaxMs, backoffBaseMs * Math.pow(2, attempt - 1));
        const jitter = Math.floor(Math.random() * 250);
        await sleep(backoff + jitter);
        continue;
      }
 
      return result;
    }
  }
 
  return {
    httpStatus: 0,
    ok: false,
    success: false,
    links: [],
    error: 'Unknown Firecrawl map error',
    raw: null,
    attempts: Math.max(1, options.maxAttempts ?? 3),
  };
}

