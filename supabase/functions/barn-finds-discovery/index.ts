import "jsr:@supabase/functions-js/edge-runtime.d.ts";
/**
 * Barn Finds URL Discovery
 *
 * Direct fetch (no Firecrawl) - WordPress site, hella easy.
 * Crawls homepage, /page/N, /auctions/, and /category/for-sale/; queues listing URLs.
 *
 * Deploy: supabase functions deploy barn-finds-discovery --no-verify-jwt
 *
 * Usage:
 *   POST {"action": "discover", "pages": 5}  - crawl N index pages + auctions + for-sale
 *   POST {"action": "status"}                - check queue stats
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const BASE = "https://barnfinds.com";

// Paths that are NOT listing pages (exclude from queue)
const BAD_PATH_PREFIXES = [
  "/about", "/contact", "/privacy", "/terms", "/wp-login", "/membership",
  "/subscribe", "/comment-subscriptions", "/tag/", "/category/", "/genre/",
  "/origin/", "/condition/", "/page/", "/author/", "/feed", "/wp-content",
  "/wp-includes", "/auctions/about", "/auctions/contact", "/fast-finds",
  "/list-your-car", "/get-the-email", "/want-ads", "/classifieds/",
];

function isValidListingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.hostname.replace(/^www\./i, "") !== "barnfinds.com") return false;
    const path = u.pathname.replace(/\/$/, "");
    if (!path || path === "/") return false;
    // Single segment or two (e.g. /bf-auction-1953-dodge-m37) - article slug
    const segments = path.split("/").filter(Boolean);
    if (segments.length > 2) return false;
    for (const bad of BAD_PATH_PREFIXES) {
      if (path.startsWith(bad)) return false;
    }
    return /^\/[a-z0-9-]+(\/[a-z0-9-]+)?$/i.test(path);
  } catch {
    return false;
  }
}

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function scrapePage(url: string): Promise<string[]> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return [];
  const html = await res.text();
  const urls = new Set<string>();
  // Match href="https://barnfinds.com/..."
  const re = /href="(https:\/\/barnfinds\.com\/[^"#?]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].replace(/\/$/, "").split("?")[0].split("#")[0];
    if (isValidListingUrl(raw)) urls.add(raw);
  }
  return Array.from(urls);
}

async function getExistingUrls(supabase: any): Promise<Set<string>> {
  const existing = new Set<string>();
  const { data: queued } = await supabase
    .from("import_queue")
    .select("listing_url")
    .ilike("listing_url", "%barnfinds.com%");
  for (const row of queued || []) {
    if (row.listing_url) existing.add(row.listing_url.replace(/\/$/, ""));
  }
  const { data: vehicles } = await supabase
    .from("vehicles")
    .select("discovery_url")
    .ilike("discovery_url", "%barnfinds.com%");
  for (const row of vehicles || []) {
    if (row.discovery_url) existing.add(row.discovery_url.replace(/\/$/, ""));
  }
  return existing;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "discover";

    if (action === "status") {
      const { count: pending } = await supabase
        .from("import_queue")
        .select("*", { count: "exact", head: true })
        .ilike("listing_url", "%barnfinds.com%")
        .eq("status", "pending");
      const { count: complete } = await supabase
        .from("import_queue")
        .select("*", { count: "exact", head: true })
        .ilike("listing_url", "%barnfinds.com%")
        .eq("status", "complete");
      return okJson({ success: true, pending_in_queue: pending ?? 0, complete });
    }

    if (action === "discover") {
      const pages = Math.min(Number(body.pages) || 5, 20);
      const existingUrls = await getExistingUrls(supabase);

      const allUrls = new Set<string>();
      const toFetch: string[] = [BASE, `${BASE}/auctions/`, `${BASE}/category/for-sale/`];
      for (let p = 2; p <= pages; p++) toFetch.push(`${BASE}/page/${p}/`);

      for (const url of toFetch) {
        const found = await scrapePage(url);
        found.forEach((u) => allUrls.add(u));
        await new Promise((r) => setTimeout(r, 800));
      }

      const newUrls = Array.from(allUrls).filter((u) => !existingUrls.has(u));
      if (newUrls.length === 0) {
        return okJson({ success: true, urls_queued: 0, urls_new: 0, message: "No new URLs" });
      }

      const rows = newUrls.slice(0, 500).map((listing_url) => ({
        listing_url,
        status: "pending",
        listing_title: null,
      }));

      const { error } = await supabase.from("import_queue").upsert(rows, {
        onConflict: "listing_url",
        ignoreDuplicates: true,
      });

      if (error) throw error;
      return okJson({
        success: true,
        urls_found: allUrls.size,
        urls_new: newUrls.length,
        urls_queued: rows.length,
      });
    }

    return okJson({ error: "Unknown action. Use discover or status." }, 400);
  } catch (e: any) {
    console.error("[barn-finds-discovery]", e);
    return okJson({ success: false, error: e?.message ?? String(e) }, 500);
  }
});
