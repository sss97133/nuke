/**
 * Holley URL discovery (Edge Function)
 *
 * Purpose:
 * - Use Firecrawl "map" and/or "crawl" endpoints when available to discover product URLs
 * - Fallback to Holley sitemaps if map/crawl are not available or blocked
 *
 * Notes:
 * - This function returns URL lists; it does not write to the database.
 * - Downstream: `scrape-holley-product` will scrape+upsert.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type DiscoverRequest = {
  base_url?: string; // default https://www.holley.com
  method?: "map" | "crawl" | "sitemap"; // default map (fallbacks internally)
  limit?: number; // default 5000
  include_subdomains?: boolean; // default false
  include_patterns?: string[]; // regex strings
  exclude_patterns?: string[]; // regex strings
  max_sitemaps?: number; // default 30 (guards edge runtime timeouts)
  time_budget_ms?: number; // default 20000 (guards edge runtime timeouts)
  seed_urls?: string[]; // optional: expand/discover links from specific pages
};

function safeString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

function compileRegexes(patterns: string[] | undefined): RegExp[] {
  if (!patterns || !Array.isArray(patterns)) return [];
  const out: RegExp[] = [];
  for (const p of patterns) {
    const s = safeString(p);
    if (!s) continue;
    try {
      out.push(new RegExp(s, "i"));
    } catch {
      // ignore invalid regex
    }
  }
  return out;
}

function urlPasses(url: string, include: RegExp[], exclude: RegExp[]): boolean {
  if (exclude.some((r) => r.test(url))) return false;
  if (include.length === 0) return true;
  return include.some((r) => r.test(url));
}

function extractLocsFromSitemapXml(xml: string): string[] {
  const locs: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    locs.push(m[1]);
  }
  return locs;
}

async function fetchText(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/xml,application/xml,text/html,*/*",
    },
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Fetch failed: ${resp.status} ${resp.statusText} ${txt}`.trim());
  }
  return await resp.text();
}

async function firecrawlFetchText(apiKey: string, url: string): Promise<string> {
  // Use Firecrawl scrape to bypass Cloudflare/JS and fetch raw-ish content.
  // For XML/robots.txt, Firecrawl typically returns the content in markdown and/or html.
  const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["markdown", "html"],
      onlyMainContent: false,
      waitFor: 1500,
    }),
    // Hard timeout per request so we don't blow the edge function execution window.
    signal: AbortSignal.timeout(20000),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`Firecrawl scrape failed: ${resp.status} ${JSON.stringify(data)}`);
  }
  if (!data?.success) {
    throw new Error(`Firecrawl scrape unsuccessful: ${JSON.stringify(data)}`);
  }
  const markdown: string = data.data?.markdown || "";
  const html: string = data.data?.html || "";
  // Prefer markdown for plain text/robots/sitemaps; fallback to html.
  const text = markdown && markdown.length > 0 ? markdown : html;
  if (!text) throw new Error("Firecrawl returned empty content");
  return text;
}

async function firecrawlExtractStringList(
  apiKey: string,
  url: string,
  fieldName: string,
  description: string,
): Promise<string[]> {
  // Robust way to extract structured data even if Firecrawl transforms XML into markdown.
  // Includes lightweight retries for Holley/Cloudflare flakiness.
  let lastErr: any = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url,
          formats: ["extract", "markdown", "html"],
          extract: {
            schema: {
              type: "object",
              properties: {
                [fieldName]: {
                  type: "array",
                  description,
                  items: { type: "string" },
                },
              },
            },
          },
          onlyMainContent: false,
          // Keep wait short; Holley pages can be heavy.
          waitFor: 800,
        }),
        // Give Firecrawl enough time; Holley is slow.
        signal: AbortSignal.timeout(30000),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(`Firecrawl scrape failed: ${resp.status} ${JSON.stringify(data)}`);
      }
      if (!data?.success) {
        throw new Error(`Firecrawl scrape unsuccessful: ${JSON.stringify(data)}`);
      }

      const extracted = data.data?.extract || {};
      const list = extracted?.[fieldName];
      if (Array.isArray(list)) {
        return list.map((x) => String(x)).filter(Boolean);
      }

      // Fall back to parsing raw content
      const markdown: string = data.data?.markdown || "";
      const html: string = data.data?.html || "";
      const combined = `${markdown}\n${html}`;
      const urls: string[] = [];
      const re = /\bhttps?:\/\/[^\s"'<>]+/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(combined)) !== null) urls.push(m[0]);
      return urls;
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || e);
      const retryable = msg.toLowerCase().includes("timed out") || msg.toLowerCase().includes("429") || msg.toLowerCase().includes("500");
      if (!retryable || attempt === 3) break;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }

  throw lastErr || new Error("Firecrawl extract failed");

  // unreachable
}

async function firecrawlExtractSitemapsFromRobots(apiKey: string, robotsUrl: string): Promise<string[]> {
  const list = await firecrawlExtractStringList(
    apiKey,
    robotsUrl,
    "sitemaps",
    "All sitemap URLs mentioned in robots.txt lines starting with 'Sitemap:'",
  );
  // Keep only plausible sitemap urls
  return Array.from(new Set(list)).filter((u) => u.toLowerCase().includes("sitemap"));
}

async function firecrawlExtractLocsFromSitemap(apiKey: string, sitemapUrl: string): Promise<string[]> {
  const list = await firecrawlExtractStringList(
    apiKey,
    sitemapUrl,
    "locs",
    "All URLs listed in the sitemap (values of <loc> in XML). Include both nested sitemap XML URLs and page URLs.",
  );
  // Keep only urls in the list
  return Array.from(new Set(list)).filter((u) => /^https?:\/\//i.test(u));
}

async function discoverFromSitemaps(baseUrl: string, limit: number): Promise<string[]> {
  const start = new URL(baseUrl);
  const candidates = [
    new URL("/robots.txt", start.origin).toString(),
    new URL("/sitemap.xml", start.origin).toString(),
    new URL("/sitemap_index.xml", start.origin).toString(),
    new URL("/sitemap-index.xml", start.origin).toString(),
  ];

  const visited = new Set<string>();
  const sitemapsToVisit: string[] = [];
  const urls: string[] = [];

  // Try robots.txt first to discover sitemap(s)
  try {
    const robots = await fetchText(candidates[0]);
    const lines = robots.split("\n").map((l) => l.trim());
    for (const line of lines) {
      if (/^sitemap:/i.test(line)) {
        const u = line.split(/sitemap:\s*/i)[1]?.trim();
        if (u) sitemapsToVisit.push(u);
      }
    }
  } catch {
    // ignore
  }

  // Add common sitemap candidates
  for (const u of candidates.slice(1)) sitemapsToVisit.push(u);

  while (sitemapsToVisit.length > 0 && urls.length < limit) {
    const sitemapUrl = sitemapsToVisit.shift();
    if (!sitemapUrl || visited.has(sitemapUrl)) continue;
    visited.add(sitemapUrl);

    let xml: string;
    try {
      xml = await fetchText(sitemapUrl);
    } catch {
      continue;
    }

    const locs = extractLocsFromSitemapXml(xml);
    if (locs.length === 0) continue;

    // If it's a sitemap index, it points at other xml files.
    for (const loc of locs) {
      if (urls.length >= limit) break;
      if (loc.endsWith(".xml") || loc.toLowerCase().includes("sitemap")) {
        if (!visited.has(loc) && sitemapsToVisit.length < 500) sitemapsToVisit.push(loc);
      } else {
        urls.push(loc);
      }
    }
  }

  return Array.from(new Set(urls)).slice(0, limit);
}

async function discoverFromSitemapsViaFirecrawl(
  apiKey: string,
  baseUrl: string,
  limit: number,
  maxSitemaps: number,
  timeBudgetMs: number,
): Promise<string[]> {
  const start = new URL(baseUrl);
  const robotsUrl = new URL("/robots.txt", start.origin).toString();
  const commonCandidates = [
    new URL("/sitemap.xml", start.origin).toString(),
    new URL("/sitemap_index.xml", start.origin).toString(),
    new URL("/sitemap-index.xml", start.origin).toString(),
  ];

  const startedAt = Date.now();
  const visited = new Set<string>();
  const sitemapsToVisit: string[] = [];
  const urls: string[] = [];

  // Robots.txt (via Firecrawl) to discover sitemap directives
  try {
    const robotsSitemaps = await firecrawlExtractSitemapsFromRobots(apiKey, robotsUrl);
    for (const u of robotsSitemaps) sitemapsToVisit.push(u);
  } catch {
    // ignore
  }

  for (const u of commonCandidates) sitemapsToVisit.push(u);

  while (sitemapsToVisit.length > 0 && urls.length < limit) {
    if (Date.now() - startedAt > timeBudgetMs) break;
    if (visited.size >= maxSitemaps) break;

    const sitemapUrl = sitemapsToVisit.shift();
    if (!sitemapUrl || visited.has(sitemapUrl)) continue;
    visited.add(sitemapUrl);

    let locs: string[] = [];
    try {
      locs = await firecrawlExtractLocsFromSitemap(apiKey, sitemapUrl);
    } catch {
      continue;
    }

    if (locs.length === 0) continue;

    for (const loc of locs) {
      if (urls.length >= limit) break;
      const lower = loc.toLowerCase();
      if (lower.endsWith(".xml") || lower.includes("sitemap")) {
        if (!visited.has(loc) && sitemapsToVisit.length < 1000) sitemapsToVisit.push(loc);
      } else {
        urls.push(loc);
      }
    }
  }

  return Array.from(new Set(urls)).slice(0, limit);
}

async function discoverFromHomepageLinksViaFirecrawl(apiKey: string, baseUrl: string, limit: number): Promise<string[]> {
  const start = new URL(baseUrl);
  const seedPages = [start.origin + "/", start.origin + "/products/"];
  const internal: string[] = [];

  for (const pageUrl of seedPages) {
    const links = await firecrawlExtractStringList(
      apiKey,
      pageUrl,
      "links",
      "All internal links on the page as absolute URLs.",
    );
    for (const u of links) {
      try {
        const abs = new URL(u, pageUrl).toString();
        if (abs.startsWith(start.origin)) internal.push(abs);
      } catch {
        // ignore
      }
    }
    if (internal.length >= limit) break;
  }

  return Array.from(new Set(internal)).slice(0, limit);
}

async function firecrawlMap(
  apiKey: string,
  baseUrl: string,
  includeSubdomains: boolean,
  limit: number,
): Promise<{ urls: string[]; raw: any }> {
  // Firecrawl map endpoint is not used elsewhere in this repo, so we keep this tolerant:
  // - If endpoint doesn't exist or schema differs, caller will fallback.
  const resp = await fetch("https://api.firecrawl.dev/v1/map", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: baseUrl,
      includeSubdomains,
      limit,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`Firecrawl map failed: ${resp.status} ${JSON.stringify(data)}`);
  }
  const urls: string[] =
    data?.data?.urls ||
    data?.urls ||
    data?.data ||
    [];
  return { urls: Array.isArray(urls) ? urls : [], raw: data };
}

async function firecrawlCrawl(
  apiKey: string,
  baseUrl: string,
  includeSubdomains: boolean,
  limit: number,
): Promise<{ job_id: string | null; raw: any }> {
  // Crawl is typically async job-based; we return job_id if present.
  const resp = await fetch("https://api.firecrawl.dev/v1/crawl", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: baseUrl,
      includeSubdomains,
      limit,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`Firecrawl crawl failed: ${resp.status} ${JSON.stringify(data)}`);
  }
  const jobId =
    data?.data?.id ||
    data?.data?.job_id ||
    data?.job_id ||
    data?.id ||
    null;
  return { job_id: typeof jobId === "string" ? jobId : null, raw: data };
}

async function discoverFromSeedUrlsViaFirecrawl(apiKey: string, seedUrls: string[], limit: number, timeBudgetMs: number): Promise<string[]> {
  const startedAt = Date.now();
  const out: string[] = [];
  const uniqueSeeds = Array.from(new Set(seedUrls)).slice(0, 25);

  for (const seed of uniqueSeeds) {
    if (Date.now() - startedAt > timeBudgetMs) break;
    try {
      const links = await firecrawlExtractStringList(apiKey, seed, "links", "All internal links on the page as absolute URLs.");
      for (const u of links) {
        try {
          const abs = new URL(u, seed).toString();
          out.push(abs);
          if (out.length >= limit) break;
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore individual seed failures
    }
    if (out.length >= limit) break;
  }

  return Array.from(new Set(out)).slice(0, limit);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const firecrawlApiKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!firecrawlApiKey) throw new Error("FIRECRAWL_API_KEY not configured");

    const body: DiscoverRequest = await req.json().catch(() => ({}));
    const baseUrl = safeString(body.base_url) || "https://www.holley.com/";
    const limit = Number(body.limit || 5000);
    const includeSubdomains = !!body.include_subdomains;
    const method: DiscoverRequest["method"] = body.method || "map";
    const maxSitemaps = Number(body.max_sitemaps || 30);
    const timeBudgetMs = Number(body.time_budget_ms || 20000);

    const include = compileRegexes(body.include_patterns);
    const exclude = compileRegexes(body.exclude_patterns);

    let urls: string[] = [];
    const debug: any = { method_requested: method };

    // If seed_urls provided, expand from those pages first.
    if (Array.isArray(body.seed_urls) && body.seed_urls.length > 0) {
      urls = await discoverFromSeedUrlsViaFirecrawl(firecrawlApiKey, body.seed_urls, limit, timeBudgetMs);
      debug.seed_urls = { used: true, seeds: body.seed_urls.length, url_count: urls.length };
    }

    if (urls.length === 0 && method === "map") {
      try {
        const mapped = await firecrawlMap(firecrawlApiKey, baseUrl, includeSubdomains, limit);
        urls = mapped.urls;
        debug.firecrawl_map = { success: true, url_count: urls.length };
      } catch (e: any) {
        debug.firecrawl_map = { success: false, error: e?.message || String(e) };
      }
    } else if (urls.length === 0 && method === "crawl") {
      try {
        const crawled = await firecrawlCrawl(firecrawlApiKey, baseUrl, includeSubdomains, limit);
        debug.firecrawl_crawl = { success: true, job_id: crawled.job_id };
        // Crawl results are job-based; caller should poll if desired.
        // We fallback to sitemap for immediate URL list.
      } catch (e: any) {
        debug.firecrawl_crawl = { success: false, error: e?.message || String(e) };
      }
    }

    if (urls.length === 0) {
      // Holley blocks robots/sitemaps with Cloudflare; use Firecrawl to fetch them.
      try {
        urls = await discoverFromSitemapsViaFirecrawl(firecrawlApiKey, baseUrl, limit, maxSitemaps, timeBudgetMs);
        debug.sitemap_fallback = { success: true, via: "firecrawl", url_count: urls.length };
      } catch (e: any) {
        debug.sitemap_fallback = { success: false, via: "firecrawl", error: e?.message || String(e) };
        // Last-ditch: try plain fetch (may work for other domains)
        urls = await discoverFromSitemaps(baseUrl, limit);
        debug.sitemap_fallback_plain = { success: true, url_count: urls.length };
      }
    }

    // If sitemap + map returned nothing, at least return a seed set of internal links from homepage via Firecrawl.
    if (urls.length === 0) {
      try {
        urls = await discoverFromHomepageLinksViaFirecrawl(firecrawlApiKey, baseUrl, Math.min(limit, 500));
        debug.homepage_fallback = { success: true, via: "firecrawl", url_count: urls.length };
      } catch (e: any) {
        debug.homepage_fallback = { success: false, via: "firecrawl", error: e?.message || String(e) };
      }
    }

    const filtered = urls.filter((u) => urlPasses(u, include, exclude));

    return new Response(
      JSON.stringify({
        success: true,
        base_url: baseUrl,
        discovered: urls.length,
        returned: filtered.length,
        urls: filtered.slice(0, limit),
        debug,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("holley-discover-urls error:", error);
    return new Response(JSON.stringify({ success: false, error: error?.message || String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});



