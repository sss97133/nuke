import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

type IndexVehicQuirRequest = {
  base_url?: string; // default https://vehicquir.com
  sitemap_url?: string; // optional override
  organization_id?: string | null; // optional: tag raw_data.organization_id
  source_type?: "marketplace" | "classifieds" | "dealer" | "auction"; // for scrape_sources
  max_urls?: number; // default 2000
  include_patterns?: string[]; // regex strings
  exclude_patterns?: string[]; // regex strings
  time_budget_ms?: number; // default 20000
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
    if (m[1]) locs.push(m[1]);
  }
  return locs;
}

function normalizeUrlBestEffort(raw: string): string | null {
  try {
    const u = new URL(raw);
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

async function fetchTextBestEffort(url: string): Promise<string | null> {
  // Try direct fetch first; fall back to Firecrawl if available (some sites block Supabase edge IPs).
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/xml,application/xml,text/html,*/*",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (resp.ok) return await resp.text();
  } catch {
    // ignore
  }

  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!firecrawlKey) return null;

  try {
    const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${firecrawlKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown", "html"],
        onlyMainContent: false,
        waitFor: 1200,
      }),
      signal: AbortSignal.timeout(25000),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.success) return null;
    const markdown: string = data?.data?.markdown || "";
    const html: string = data?.data?.html || "";
    const text = markdown && markdown.length > 0 ? markdown : html;
    return text || null;
  } catch {
    return null;
  }
}

function extractSitemapsFromRobots(robotsText: string): string[] {
  const out: string[] = [];
  const lines = robotsText.split("\n").map((l) => l.trim());
  for (const line of lines) {
    if (!/^sitemap:/i.test(line)) continue;
    const u = line.split(/sitemap:\s*/i)[1]?.trim();
    if (u && /^https?:\/\//i.test(u)) out.push(u);
  }
  return Array.from(new Set(out));
}

function looksLikeSitemapUrl(url: string): boolean {
  const s = url.toLowerCase();
  return s.includes("sitemap") && (s.endsWith(".xml") || s.includes(".xml?") || s.includes(".xml#"));
}

async function discoverUrlsFromSitemaps(params: {
  baseUrl: string;
  sitemapUrlOverride?: string | null;
  maxUrls: number;
  timeBudgetMs: number;
}): Promise<{ urls: string[]; sitemapsVisited: string[]; seedSitemaps: string[] }> {
  const { baseUrl, sitemapUrlOverride, maxUrls, timeBudgetMs } = params;
  const origin = new URL(baseUrl).origin;
  const start = Date.now();

  const seedSitemaps: string[] = [];
  if (sitemapUrlOverride) seedSitemaps.push(sitemapUrlOverride);

  // Discover sitemap candidates from robots.txt and common paths.
  const robotsUrl = new URL("/robots.txt", origin).toString();
  const robots = await fetchTextBestEffort(robotsUrl);
  if (robots) seedSitemaps.push(...extractSitemapsFromRobots(robots));

  seedSitemaps.push(
    new URL("/sitemap.xml", origin).toString(),
    new URL("/sitemap_index.xml", origin).toString(),
    new URL("/sitemap-index.xml", origin).toString(),
    new URL("/sitemap.xml.gz", origin).toString(),
  );

  const toVisit = Array.from(new Set(seedSitemaps)).filter((u) => /^https?:\/\//i.test(u));
  const visited = new Set<string>();
  const visitedList: string[] = [];

  const foundUrls = new Set<string>();

  while (toVisit.length > 0 && foundUrls.size < maxUrls && Date.now() - start < timeBudgetMs) {
    const sitemapUrl = toVisit.shift();
    if (!sitemapUrl) continue;
    if (visited.has(sitemapUrl)) continue;
    visited.add(sitemapUrl);
    visitedList.push(sitemapUrl);

    const txt = await fetchTextBestEffort(sitemapUrl);
    if (!txt) continue;

    // For gz sitemaps, Firecrawl sometimes returns decompressed content in markdown.
    // If it isn't valid XML, we still try to extract urls via regex below.
    const locs = extractLocsFromSitemapXml(txt);

    const candidates = locs.length > 0
      ? locs
      : (() => {
          const urls: string[] = [];
          const re = /\bhttps?:\/\/[^\s"'<>]+/gi;
          let m: RegExpExecArray | null;
          while ((m = re.exec(txt)) !== null) urls.push(m[0]);
          return urls;
        })();

    for (const raw of candidates) {
      if (foundUrls.size >= maxUrls) break;
      const normalized = normalizeUrlBestEffort(raw);
      if (!normalized) continue;
      // Only keep on-origin URLs.
      try {
        const u = new URL(normalized);
        if (u.origin !== origin) continue;
        if (looksLikeSitemapUrl(normalized) || u.pathname.toLowerCase().endsWith(".xml")) {
          if (!visited.has(normalized)) toVisit.push(normalized);
          continue;
        }
        foundUrls.add(normalized);
      } catch {
        // ignore
      }
    }
  }

  return { urls: Array.from(foundUrls), sitemapsVisited: visitedList, seedSitemaps: Array.from(new Set(seedSitemaps)) };
}

function defaultIncludePatterns(): string[] {
  // Default patterns are intentionally broad; tune via request.include_patterns for precision.
  return [
    // Common inventory detail routes
    "/(vehicle|vehicles|listing|listings|inventory|stock|car|cars|auto|autos)/[^/?#]{3,}",
    // French-ish routes (in case the site is FR/CA)
    "/(vehicule|vehicules|annonce|annonces|voiture|voitures|camion|camions)/[^/?#]{3,}",
    // SEO pattern containing year
    "/\\b(19\\d{2}|20\\d{2})\\b[^/?#]{0,120}",
  ];
}

function defaultExcludePatterns(): string[] {
  return [
    "/(blog|articles|news|press|about|contact|privacy|terms|cookies|login|signup|register)\\b",
    "/(wp-content|wp-admin)\\b",
    "\\.(png|jpg|jpeg|webp|gif|svg|pdf|css|js)(\\?|#|$)",
  ];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ success: false, error: "Server not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body: IndexVehicQuirRequest = await req.json().catch(() => ({}));
    const baseUrlRaw = safeString(body.base_url) || "https://vehicquir.com";
    const baseUrl = new URL(baseUrlRaw.startsWith("http") ? baseUrlRaw : `https://${baseUrlRaw}`).origin;

    const sitemapUrlOverride = safeString(body.sitemap_url);
    const organizationId = safeString(body.organization_id) || null;
    const sourceType = (body.source_type || "marketplace") as any;
    const maxUrls = Math.max(1, Math.min(Math.floor(body.max_urls || 0) || 2000, 10000));
    const timeBudgetMs = Math.max(3000, Math.min(Math.floor(body.time_budget_ms || 0) || 20000, 55000));

    const include = compileRegexes((body.include_patterns && body.include_patterns.length > 0) ? body.include_patterns : defaultIncludePatterns());
    const exclude = compileRegexes((body.exclude_patterns && body.exclude_patterns.length > 0) ? body.exclude_patterns : defaultExcludePatterns());

    // Ensure scrape_sources record exists (keyed by url).
    const { data: existingSource } = await supabase
      .from("scrape_sources")
      .select("id")
      .eq("url", baseUrl)
      .maybeSingle();

    let sourceId: string | null = existingSource?.id || null;
    if (!sourceId) {
      const { data: created, error: createErr } = await supabase
        .from("scrape_sources")
        .insert({
          name: new URL(baseUrl).hostname,
          url: baseUrl,
          inventory_url: baseUrl,
          source_type: sourceType,
          is_active: true,
          last_scraped_at: new Date().toISOString(),
          last_successful_scrape: new Date().toISOString(),
          total_listings_found: 0,
          squarebody_count: 0,
        })
        .select("id")
        .single();
      if (createErr) throw createErr;
      sourceId = created?.id || null;
    }

    // Discover URLs from sitemaps.
    const discovered = await discoverUrlsFromSitemaps({
      baseUrl,
      sitemapUrlOverride,
      maxUrls: maxUrls * 3, // discover more, filter down
      timeBudgetMs,
    });

    const filtered = discovered.urls
      .filter((u) => urlPasses(u, include, exclude))
      .slice(0, maxUrls);

    // Queue into import_queue (dedupe via listing_url unique constraint).
    const now = new Date().toISOString();
    const rows = filtered.map((listingUrl) => ({
      source_id: sourceId,
      listing_url: listingUrl,
      status: "pending",
      priority: 0,
      raw_data: {
        source: "vehicquir_sitemap",
        base_url: baseUrl,
        sitemap_url: sitemapUrlOverride || null,
        organization_id: organizationId,
        discovered_at: now,
      },
    }));

    let queued = 0;
    const chunkSize = 200;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error: upsertErr } = await supabase
        .from("import_queue")
        .upsert(chunk, { onConflict: "listing_url" });
      if (upsertErr) throw upsertErr;
      queued += chunk.length;
    }

    // Update scrape source stats (best-effort).
    try {
      await supabase
        .from("scrape_sources")
        .update({
          last_scraped_at: now,
          last_successful_scrape: now,
          total_listings_found: filtered.length,
          updated_at: now,
        })
        .eq("id", sourceId);
    } catch {
      // ignore
    }

    return new Response(JSON.stringify({
      success: true,
      base_url: baseUrl,
      source_id: sourceId,
      organization_id: organizationId,
      discovered_urls_total: discovered.urls.length,
      sitemaps_visited: discovered.sitemapsVisited.slice(0, 25),
      queued,
      queued_sample: filtered.slice(0, 10),
      filters: {
        include_patterns: include.map((r) => r.source),
        exclude_patterns: exclude.map((r) => r.source),
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("index-vehicquir error:", error);
    return new Response(JSON.stringify({ success: false, error: error?.message || String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

