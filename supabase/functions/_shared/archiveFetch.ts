/**
 * Universal Archive Fetch — EVERY external page fetch goes through here.
 *
 * This is the ONE fetch function all extractors must use. It:
 * 1. Checks if we already have this URL cached (returns cache if fresh enough)
 * 2. Fetches the URL (direct or Firecrawl depending on site)
 * 3. Archives the raw HTML + markdown to listing_page_snapshots
 * 4. Returns the content to the caller
 *
 * After this exists, there is NO reason to ever re-crawl a URL we've seen.
 * Future extraction passes just read from listing_page_snapshots.
 *
 * AGENTS: Do NOT use raw fetch() for external URLs. Use archiveFetch().
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { fetchBatPage, type FetchOptions as BatFetchOptions, type FetchResult as BatFetchResult, logFetchCost, isLoginPage } from "./batFetcher.ts";
import { fetchPage } from "./hybridFetcher.ts";
import { firecrawlScrape, type FirecrawlScrapeResult } from "./firecrawl.ts";

export interface ArchiveFetchResult {
  html: string | null;
  markdown: string | null;
  source: "cache" | "direct" | "firecrawl" | "proxy";
  cached: boolean;
  snapshotId: string | null;
  url: string;
  platform: string;
  statusCode: number | null;
  error: string | null;
  costCents: number;
}

export interface ArchiveFetchOptions {
  /** Platform identifier for listing_page_snapshots: 'bat', 'carsandbids', 'hagerty', etc. */
  platform: string;
  /** Max age in seconds before we re-fetch (default: 86400 = 24h) */
  maxAgeSec?: number;
  /** Force re-fetch even if cached */
  forceRefresh?: boolean;
  /** Skip cache lookup (e.g. for live auction polling where freshness matters) */
  skipCache?: boolean;
  /** Use Firecrawl (for JS-rendered sites like C&B) */
  useFirecrawl?: boolean;
  /** Firecrawl waitFor in ms */
  waitForJs?: number;
  /** Request markdown from Firecrawl in addition to HTML */
  includeMarkdown?: boolean;
  /** Extra metadata to store with the snapshot */
  metadata?: Record<string, unknown>;
  /** BaT-specific fetch options */
  batOptions?: BatFetchOptions;
  /** Calling function name (for cost logging) */
  callerName?: string;
}

function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) throw new Error("SUPABASE_URL or SERVICE_ROLE_KEY not set");
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Normalize URL for consistent cache keys — lowercase host, strip fragment, remove trailing slash */
function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    // Sort query params for consistent ordering
    const params = new URLSearchParams(u.searchParams);
    const sorted = new URLSearchParams([...params.entries()].sort());
    u.search = sorted.toString() ? `?${sorted.toString()}` : "";
    // Remove trailing slash (except root)
    let path = u.pathname;
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    return `${u.protocol}//${u.hostname.toLowerCase()}${path}${u.search}`;
  } catch {
    return raw;
  }
}

/** Generate URL variants for backward-compatible cache lookup against old snapshots */
function cacheKeyVariants(normalized: string): string[] {
  const variants = [normalized];
  // Also check with trailing slash (old snapshots may have it)
  if (!normalized.endsWith("/")) variants.push(normalized + "/");
  return variants;
}

/** Smart TTL: completed auctions are permanent, active listings 24h, everything else 7d */
function smartMaxAge(url: string, platform: string): number {
  // Completed auction pages are static forever
  const completedPatterns: Record<string, RegExp[]> = {
    bat: [/bringatrailer\.com\/listing\//],
    mecum: [/mecum\.com\/lots\//],
    bonhams: [/bonhams\.com\/lot\//],
    rmsothebys: [/rmsothebys\.com\/.*\/lot\//],
    gooding: [/goodingco\.com\/lot\//],
    barrettjackson: [/barrett-jackson\.com\/Events\/.*\/Lots\//i],
  };
  const patterns = completedPatterns[platform];
  if (patterns?.some(p => p.test(url))) {
    return 315360000; // 10 years — effectively permanent
  }
  // Active marketplace listings: refresh after 24h
  if (["facebook", "craigslist", "ebay"].includes(platform)) return 86400;
  // Default: 7 days
  return 604800;
}

function detectPlatform(url: string): string {
  if (url.includes("bringatrailer.com")) return "bat";
  if (url.includes("carsandbids.com")) return "carsandbids";
  if (url.includes("hagerty.com")) return "hagerty";
  if (url.includes("pcarmarket.com")) return "pcarmarket";
  if (url.includes("collectingcars.com")) return "collectingcars";
  if (url.includes("rmsothebys.com")) return "rmsothebys";
  if (url.includes("mecum.com")) return "mecum";
  if (url.includes("bonhams.com")) return "bonhams";
  if (url.includes("ebay.com")) return "ebay";
  if (url.includes("craigslist.org")) return "craigslist";
  if (url.includes("facebook.com/marketplace")) return "facebook";
  try { return new URL(url).hostname.replace(/^www\./, "").split(".")[0]; } catch { return "unknown"; }
}

function needsFirecrawl(url: string): boolean {
  // Sites that are JS SPAs or aggressively block direct fetch
  const fcSites = ["carsandbids.com", "collectingcars.com", "pcarmarket.com"];
  return fcSites.some((s) => url.includes(s));
}

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Detect HTML that technically loaded but contains no useful content.
 * Examples: Cloudflare challenge pages, bare React/Next.js shells, bot walls.
 * These should be archived as success=false so cache lookups don't return garbage.
 */
function isGarbageHtml(html: string, platform: string): boolean {
  if (!html || html.length === 0) return true;

  const lower = html.toLowerCase();

  // Cloudflare challenge / bot wall
  if (lower.includes("attention required") && lower.includes("cloudflare")) return true;
  if (lower.includes("just a moment") && lower.includes("cloudflare")) return true;
  if (lower.includes("cf-browser-verification")) return true;
  if (lower.includes("cf_chl_opt")) return true;

  // Generic access denied / blocked
  if (lower.includes("access denied") && html.length < 5000) return true;
  if (lower.includes("403 forbidden") && html.length < 5000) return true;

  // Login page detection — a login page returned as 200 OK is garbage, not content
  if (isLoginPage(html)) return true;

  // React/Next.js shell with no rendered content (Bonhams, Barrett-Jackson)
  // These shells have __NEXT_DATA__ or __next but no actual lot/vehicle content
  if (platform === "bonhams") {
    // Bonhams React shell is ~120KB but has NO lot description in the HTML
    // Real Firecrawl-rendered pages have the lot title in visible text
    const hasNextShell = lower.includes("__next_data__") || lower.includes("self.__next_f.push");
    const hasLotContent = /<h[12][^>]*>[^<]*\d{4}\s+[A-Z]/i.test(html) ||
                          /class="[^"]*lot-title/i.test(html) ||
                          /property="og:title"[^>]*content="[^"]*\d{4}/i.test(html);
    if (hasNextShell && !hasLotContent && !html.includes("Footnotes")) return true;
  }

  if (platform === "barrett-jackson") {
    // BJ Cloudflare challenge returns small HTML with no vehicle data
    const hasVehicleData = /\d{4}\s*Year/i.test(html) ||
                           /"vehicle":\{/i.test(html) ||
                           /"@type"\s*:\s*"(?:Vehicle|Product|Car)"/i.test(html) ||
                           /property="og:title"[^>]*content="[^"]*\d{4}/i.test(html);
    if (!hasVehicleData && html.length < 50000) return true;
  }

  return false;
}

/**
 * Archive-aware fetch. Use this for ALL external URL fetches.
 */
export async function archiveFetch(
  url: string,
  options?: ArchiveFetchOptions,
): Promise<ArchiveFetchResult> {
  const platform = options?.platform ?? detectPlatform(url);
  const normalized = normalizeUrl(url);
  const maxAgeSec = options?.maxAgeSec ?? smartMaxAge(normalized, platform);
  const supabase = getSupabase();

  const result: ArchiveFetchResult = {
    html: null,
    markdown: null,
    source: "direct",
    cached: false,
    snapshotId: null,
    url,
    platform,
    statusCode: null,
    error: null,
    costCents: 0,
  };

  // Step 1: Check cache (unless skipped)
  if (!options?.forceRefresh && !options?.skipCache) {
    try {
      const cutoff = new Date(Date.now() - maxAgeSec * 1000).toISOString();
      const useFirecrawl = options?.useFirecrawl ?? needsFirecrawl(url);

      // Single query with URL variants (handles trailing slash / normalization mismatches)
      // Fetches up to 5 rows, then picks preferred fetch_method client-side
      const variants = cacheKeyVariants(normalized);
      const preferredMethod = useFirecrawl ? "firecrawl" : "direct";
      const { data: rows } = await supabase
        .from("listing_page_snapshots")
        .select("id, html, markdown, fetched_at, html_storage_path, markdown_storage_path, fetch_method")
        .in("listing_url", variants)
        .eq("success", true)
        .gte("fetched_at", cutoff)
        .order("fetched_at", { ascending: false })
        .limit(5);

      // Prefer matching fetch_method, fall back to any
      const cached = rows?.find(r => r.fetch_method === preferredMethod) ?? rows?.[0] ?? null;

      if (cached && (cached.html || cached.html_storage_path)) {
        let cachedHtml = cached.html ?? null;
        let cachedMarkdown = cached.markdown ?? null;

        // Fetch from storage if content was migrated out of postgres
        if (!cachedHtml && cached.html_storage_path) {
          try {
            const { data: blob } = await supabase.storage
              .from("listing-snapshots")
              .download(cached.html_storage_path);
            if (blob) cachedHtml = await blob.text();
          } catch (_) { /* storage read failed, fall through to re-fetch */ }
        }
        if (!cachedMarkdown && cached.markdown_storage_path) {
          try {
            const { data: blob } = await supabase.storage
              .from("listing-snapshots")
              .download(cached.markdown_storage_path);
            if (blob) cachedMarkdown = await blob.text();
          } catch (_) { /* non-fatal */ }
        }

        if (cachedHtml) {
          console.log(`[archiveFetch] Cache HIT for ${url} (snapshot ${cached.id}, fetched ${cached.fetched_at}, from ${cached.html_storage_path ? "storage" : "inline"})`);
          result.html = cachedHtml;
          result.markdown = cachedMarkdown;
          result.source = "cache";
          result.cached = true;
          result.snapshotId = cached.id;
          return result;
        }
      }
    } catch (e: any) {
      console.warn(`[archiveFetch] Cache check failed (non-fatal): ${e?.message}`);
    }
  }

  // Step 2: Fetch the page
  const useFirecrawl = options?.useFirecrawl ?? needsFirecrawl(url);

  if (platform === "bat" && !useFirecrawl) {
    // BaT-specific fetcher with cost tracking
    const batResult: BatFetchResult = await fetchBatPage(url, options?.batOptions);
    result.html = batResult.html;
    result.source = batResult.source;
    result.statusCode = batResult.statusCode ?? null;
    result.error = batResult.error ?? null;
    result.costCents = batResult.costCents;

    // If batFetcher detected auth required, do NOT cache as success
    if (batResult.authRequired) {
      console.error(`[archiveFetch] AUTH_REQUIRED from batFetcher for ${url} — not caching`);
      result.error = batResult.error ?? "AUTH_REQUIRED";
    }

    // Log Firecrawl costs
    if (batResult.costCents > 0) {
      await logFetchCost(supabase, options?.callerName ?? "archiveFetch", url, batResult).catch(() => {});
    }
  } else if (useFirecrawl) {
    // Firecrawl for JS-rendered sites
    const formats = ["html"];
    if (options?.includeMarkdown !== false) formats.push("markdown");

    const fcResult: FirecrawlScrapeResult = await firecrawlScrape({
      url,
      formats,
      onlyMainContent: false,
      waitFor: options?.waitForJs ?? 3000,
    });

    result.html = fcResult.data.html;
    result.markdown = fcResult.data.markdown;
    result.source = "firecrawl";
    result.statusCode = fcResult.httpStatus;
    result.error = fcResult.error;
    result.costCents = 1; // ~$0.01 per Firecrawl scrape

    // Log cost
    await logFetchCost(supabase, options?.callerName ?? "archiveFetch", url, {
      html: result.html,
      source: "firecrawl",
      costCents: 1,
      error: result.error ?? undefined,
      statusCode: result.statusCode ?? undefined,
    }).catch(() => {});
  } else {
    // Generic direct fetch with retries
    const directResult = await fetchPage(url);
    result.html = directResult.html;
    result.source = directResult.source as "direct" | "proxy";
    result.statusCode = directResult.statusCode ?? null;
    result.error = directResult.error ?? null;
  }

  // Step 3: Archive to listing_page_snapshots (non-blocking, never fail the main operation)
  try {
    const html = result.html;
    const htmlHash = html ? await sha256(html) : null;

    const payload: Record<string, unknown> = {
      platform,
      listing_url: normalized,
      fetched_at: new Date().toISOString(),
      fetch_method: result.source,
      http_status: result.statusCode,
      success: html !== null && html.length > 0 && !isGarbageHtml(html, platform),
      error_message: result.error,
      html: html,
      markdown: result.markdown,
      html_sha256: htmlHash,
      content_length: html?.length ?? 0,
      metadata: {
        ...(options?.metadata ?? {}),
        caller: options?.callerName ?? "archiveFetch",
        cost_cents: result.costCents,
      },
    };

    const { data: inserted, error: insertErr } = await supabase
      .from("listing_page_snapshots")
      .insert(payload)
      .select("id")
      .maybeSingle();

    if (insertErr) {
      // 23505 = duplicate (same platform+url+sha256) — that's fine, content hasn't changed
      if (String((insertErr as any).code || "") === "23505") {
        console.log(`[archiveFetch] Duplicate snapshot for ${url} (content unchanged)`);
      } else {
        console.warn(`[archiveFetch] Snapshot insert failed (non-fatal): ${insertErr.message}`);
      }
    } else if (inserted) {
      result.snapshotId = inserted.id;
      console.log(`[archiveFetch] Archived ${platform} snapshot ${inserted.id} (${html?.length ?? 0} bytes)`);
    }
  } catch (e: any) {
    console.warn(`[archiveFetch] Archive failed (non-fatal): ${e?.message}`);
  }

  return result;
}

/**
 * Read a previously archived page from listing_page_snapshots.
 * Use this when you need to re-extract from stored content without re-fetching.
 */
export async function readArchivedPage(
  url: string,
  options?: { platform?: string; maxAgeSec?: number },
): Promise<{ html: string | null; markdown: string | null; snapshotId: string | null; fetchedAt: string | null }> {
  const supabase = getSupabase();

  const query = supabase
    .from("listing_page_snapshots")
    .select("id, html, markdown, fetched_at, html_storage_path, markdown_storage_path")
    .eq("listing_url", url)
    .eq("success", true)
    .order("fetched_at", { ascending: false })
    .limit(1);

  if (options?.platform) query.eq("platform", options.platform);
  if (options?.maxAgeSec) {
    const cutoff = new Date(Date.now() - options.maxAgeSec * 1000).toISOString();
    query.gte("fetched_at", cutoff);
  }

  const { data } = await query.maybeSingle();
  if (!data) return { html: null, markdown: null, snapshotId: null, fetchedAt: null };

  let html = data.html ?? null;
  let markdown = data.markdown ?? null;

  // Fetch from storage if content was migrated out of postgres
  if (!html && data.html_storage_path) {
    try {
      const { data: blob } = await supabase.storage
        .from("listing-snapshots")
        .download(data.html_storage_path);
      if (blob) html = await blob.text();
    } catch (_) { /* storage read failed, return null */ }
  }
  if (!markdown && data.markdown_storage_path) {
    try {
      const { data: blob } = await supabase.storage
        .from("listing-snapshots")
        .download(data.markdown_storage_path);
      if (blob) markdown = await blob.text();
    } catch (_) { /* storage read failed, return null */ }
  }

  return {
    html,
    markdown,
    snapshotId: data.id ?? null,
    fetchedAt: data.fetched_at ?? null,
  };
}

/**
 * Read ALL archived snapshots for a URL (for change detection over time).
 */
export async function readArchivedHistory(
  url: string,
  options?: { platform?: string; limit?: number },
): Promise<Array<{ id: string; html: string | null; markdown: string | null; fetchedAt: string; htmlSha256: string | null }>> {
  const supabase = getSupabase();

  const query = supabase
    .from("listing_page_snapshots")
    .select("id, html, markdown, fetched_at, html_sha256, html_storage_path, markdown_storage_path")
    .eq("listing_url", url)
    .eq("success", true)
    .order("fetched_at", { ascending: false })
    .limit(options?.limit ?? 10);

  if (options?.platform) query.eq("platform", options.platform);

  const { data } = await query;

  const results = [];
  for (const r of data ?? []) {
    let html = r.html ?? null;
    let markdown = r.markdown ?? null;

    if (!html && r.html_storage_path) {
      try {
        const { data: blob } = await supabase.storage.from("listing-snapshots").download(r.html_storage_path);
        if (blob) html = await blob.text();
      } catch (_) {}
    }
    if (!markdown && r.markdown_storage_path) {
      try {
        const { data: blob } = await supabase.storage.from("listing-snapshots").download(r.markdown_storage_path);
        if (blob) markdown = await blob.text();
      } catch (_) {}
    }

    results.push({ id: r.id, html, markdown, fetchedAt: r.fetched_at, htmlSha256: r.html_sha256 });
  }
  return results;
}
