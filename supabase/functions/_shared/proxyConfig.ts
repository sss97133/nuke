/**
 * Proxy Configuration for Forum Extraction
 *
 * Supports residential proxy services for bypassing Cloudflare protection.
 * Configure via environment variables.
 */

export interface ProxyConfig {
  enabled: boolean;
  provider: 'brightdata' | 'oxylabs' | 'smartproxy' | 'custom';
  host: string;
  port: number;
  username: string;
  password: string;
  country?: string;
  session?: string;
}

/**
 * Get proxy configuration from environment
 */
export function getProxyConfig(): ProxyConfig | null {
  const provider = Deno.env.get('PROXY_PROVIDER');

  if (!provider) {
    return null;
  }

  const configs: Record<string, () => ProxyConfig> = {
    brightdata: () => ({
      enabled: true,
      provider: 'brightdata',
      host: Deno.env.get('BRIGHTDATA_HOST') || 'brd.superproxy.io',
      port: parseInt(Deno.env.get('BRIGHTDATA_PORT') || '22225'),
      username: Deno.env.get('BRIGHTDATA_USERNAME') || '',
      password: Deno.env.get('BRIGHTDATA_PASSWORD') || '',
      country: Deno.env.get('BRIGHTDATA_COUNTRY') || 'us',
    }),

    oxylabs: () => ({
      enabled: true,
      provider: 'oxylabs',
      host: Deno.env.get('OXYLABS_HOST') || 'pr.oxylabs.io',
      port: parseInt(Deno.env.get('OXYLABS_PORT') || '7777'),
      username: Deno.env.get('OXYLABS_USERNAME') || '',
      password: Deno.env.get('OXYLABS_PASSWORD') || '',
      country: Deno.env.get('OXYLABS_COUNTRY') || 'us',
    }),

    smartproxy: () => ({
      enabled: true,
      provider: 'smartproxy',
      host: Deno.env.get('SMARTPROXY_HOST') || 'gate.smartproxy.com',
      port: parseInt(Deno.env.get('SMARTPROXY_PORT') || '7000'),
      username: Deno.env.get('SMARTPROXY_USERNAME') || '',
      password: Deno.env.get('SMARTPROXY_PASSWORD') || '',
      country: Deno.env.get('SMARTPROXY_COUNTRY') || 'us',
    }),

    custom: () => ({
      enabled: true,
      provider: 'custom',
      host: Deno.env.get('PROXY_HOST') || '',
      port: parseInt(Deno.env.get('PROXY_PORT') || '0'),
      username: Deno.env.get('PROXY_USERNAME') || '',
      password: Deno.env.get('PROXY_PASSWORD') || '',
    }),
  };

  const configFn = configs[provider.toLowerCase()];
  if (!configFn) {
    console.warn(`Unknown proxy provider: ${provider}`);
    return null;
  }

  return configFn();
}

/**
 * Build proxy URL for fetch requests
 */
export function getProxyUrl(config: ProxyConfig): string {
  const { host, port, username, password, country, session } = config;

  // Build username with optional country/session for residential proxies
  let proxyUsername = username;
  if (config.provider === 'brightdata') {
    // Bright Data format: username-country-us-session-abc123
    if (country) proxyUsername += `-country-${country}`;
    if (session) proxyUsername += `-session-${session}`;
  } else if (config.provider === 'oxylabs') {
    // Oxylabs format: customer-username-cc-us-sessid-abc123
    if (country) proxyUsername += `-cc-${country}`;
    if (session) proxyUsername += `-sessid-${session}`;
  } else if (config.provider === 'smartproxy') {
    // Smartproxy format: user-username-country-us-session-abc123
    if (country) proxyUsername += `-country-${country}`;
    if (session) proxyUsername += `-session-${session}`;
  }

  return `http://${encodeURIComponent(proxyUsername)}:${encodeURIComponent(password)}@${host}:${port}`;
}

/**
 * Create a session ID for sticky sessions (same IP across requests)
 */
export function createSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Fetch with proxy support
 * Uses Deno's native fetch with proxy agent
 */
export async function fetchWithProxy(
  url: string,
  options: RequestInit = {},
  proxyConfig?: ProxyConfig | null
): Promise<Response> {
  const config = proxyConfig ?? getProxyConfig();

  if (!config?.enabled) {
    // No proxy, use direct fetch
    return fetch(url, {
      ...options,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        ...options.headers,
      },
    });
  }

  // For Supabase Edge Functions, we need to use a proxy service's API
  // or configure the environment to route through proxy
  //
  // Option 1: Use Bright Data's Web Unlocker API (recommended)
  // Option 2: Use proxy service's scraping API
  // Option 3: Deploy extraction to a server with proxy support

  // Check if using Bright Data Web Unlocker API
  const webUnlockerToken = Deno.env.get('BRIGHTDATA_WEB_UNLOCKER_TOKEN');
  if (webUnlockerToken && config.provider === 'brightdata') {
    return fetchWithBrightDataUnlocker(url, webUnlockerToken, options);
  }

  // Check if using Oxylabs Web Scraper API
  const oxylabsApiUser = Deno.env.get('OXYLABS_API_USER');
  const oxylabsApiPass = Deno.env.get('OXYLABS_API_PASS');
  if (oxylabsApiUser && oxylabsApiPass && config.provider === 'oxylabs') {
    return fetchWithOxylabsScraper(url, oxylabsApiUser, oxylabsApiPass, options);
  }

  // Fallback: Log warning and use direct fetch
  console.warn('Proxy configured but no API credentials found. Using direct fetch.');
  return fetch(url, {
    ...options,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ...options.headers,
    },
  });
}

/**
 * Fetch using Bright Data Web Unlocker API
 * This is the recommended approach for Cloudflare-protected sites
 */
async function fetchWithBrightDataUnlocker(
  url: string,
  token: string,
  options: RequestInit = {}
): Promise<Response> {
  const apiUrl = 'https://api.brightdata.com/request';

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      zone: 'web_unlocker',
      url,
      format: 'raw',
      country: 'us',
    }),
  });

  return response;
}

/**
 * Fetch using Oxylabs Web Scraper API
 */
async function fetchWithOxylabsScraper(
  url: string,
  username: string,
  password: string,
  options: RequestInit = {}
): Promise<Response> {
  const apiUrl = 'https://realtime.oxylabs.io/v1/queries';

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(`${username}:${password}`),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: 'universal',
      url,
      render: 'html',
      geo_location: 'United States',
    }),
  });

  if (!response.ok) {
    throw new Error(`Oxylabs API error: ${response.status}`);
  }

  const data = await response.json();

  // Oxylabs returns the HTML in the results array
  const html = data.results?.[0]?.content || '';

  // Create a Response-like object with the HTML
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });
}

export default {
  getProxyConfig,
  getProxyUrl,
  fetchWithProxy,
  createSessionId,
};
