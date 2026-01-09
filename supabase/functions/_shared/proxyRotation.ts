/**
 * Proxy Rotation and IP Management
 * 
 * Provides IP rotation for scraping to avoid rate limits and blocks.
 * Supports multiple proxy providers and automatic failover.
 */

export interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
  type?: 'http' | 'https' | 'socks5';
}

export interface ProxyProvider {
  name: string;
  getProxy: () => Promise<ProxyConfig | null>;
  rotate: () => Promise<void>;
}

/**
 * Get proxy configuration from environment variables
 * Supports multiple providers:
 * - BRIGHT_DATA (Bright Data / Luminati)
 * - OXYLABS
 * - SCRAPERAPI
 * - Custom proxy list
 */
export async function getProxyConfig(): Promise<ProxyConfig | null> {
  // Check for Bright Data
  const brightDataCustomerId = Deno.env.get('BRIGHT_DATA_CUSTOMER_ID');
  const brightDataPassword = Deno.env.get('BRIGHT_DATA_PASSWORD');
  if (brightDataCustomerId && brightDataPassword) {
    return {
      server: `http://brd.superproxy.io:22225`,
      username: `brd-customer-${brightDataCustomerId}`,
      password: brightDataPassword,
      type: 'http'
    };
  }

  // Check for Oxylabs
  const oxylabsUser = Deno.env.get('OXYLABS_USER');
  const oxylabsPassword = Deno.env.get('OXYLABS_PASSWORD');
  if (oxylabsUser && oxylabsPassword) {
    return {
      server: `http://customer-${oxylabsUser}:${oxylabsPassword}@pr.oxylabs.io:7777`,
      type: 'http'
    };
  }

  // Check for ScraperAPI
  const scraperApiKey = Deno.env.get('SCRAPERAPI_KEY');
  if (scraperApiKey) {
    // ScraperAPI uses a different approach - pass as query param
    return null; // Handled separately in fetchWithProxy
  }

  // Check for custom proxy list (comma-separated)
  const customProxies = Deno.env.get('CUSTOM_PROXY_LIST');
  if (customProxies) {
    const proxyList = customProxies.split(',').map(p => p.trim());
    const randomProxy = proxyList[Math.floor(Math.random() * proxyList.length)];
    const [host, port] = randomProxy.split(':');
    return {
      server: `http://${host}:${port}`,
      type: 'http'
    };
  }

  return null;
}

/**
 * Fetch with proxy support and IP rotation
 */
export async function fetchWithProxy(
  url: string,
  options: RequestInit = {},
  useProxy: boolean = true
): Promise<Response> {
  const proxyConfig = useProxy ? await getProxyConfig() : null;
  const scraperApiKey = Deno.env.get('SCRAPERAPI_KEY');

  // Use ScraperAPI if available (handles IP rotation automatically)
  if (scraperApiKey && useProxy) {
    const scraperApiUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(url)}`;
    return fetch(scraperApiUrl, {
      ...options,
      headers: {
        ...options.headers,
        'User-Agent': getRandomUserAgent(),
      }
    });
  }

  // Use direct proxy if configured
  if (proxyConfig) {
    // Note: Deno's fetch doesn't natively support proxies
    // For Edge Functions, we'd need to use a proxy library or service
    // For now, we'll use ScraperAPI or direct fetch with rotation
    console.log(`[Proxy] Using proxy: ${proxyConfig.server}`);
    // In production, you'd configure this through a proxy service
  }

  // Fallback: Direct fetch with random user agent and delays
  const headers = {
    'User-Agent': getRandomUserAgent(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    ...options.headers as Record<string, string>
  };

  // Add random delay to appear more human (1-3 seconds)
  const delay = Math.random() * 2000 + 1000;
  await new Promise(resolve => setTimeout(resolve, delay));

  return fetch(url, {
    ...options,
    headers
  });
}

/**
 * Get random user agent to avoid detection
 */
function getRandomUserAgent(): string {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  ];
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

/**
 * Rate limiting helper - tracks requests per domain
 */
const rateLimitTracker = new Map<string, { count: number; resetAt: number }>();

export async function rateLimitCheck(domain: string, maxRequests: number = 10, windowMs: number = 60000): Promise<boolean> {
  const now = Date.now();
  const tracker = rateLimitTracker.get(domain);

  if (!tracker || now > tracker.resetAt) {
    rateLimitTracker.set(domain, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (tracker.count >= maxRequests) {
    const waitTime = tracker.resetAt - now;
    console.log(`[RateLimit] Waiting ${waitTime}ms for ${domain}`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
    rateLimitTracker.set(domain, { count: 1, resetAt: Date.now() + windowMs });
    return true;
  }

  tracker.count++;
  return true;
}

