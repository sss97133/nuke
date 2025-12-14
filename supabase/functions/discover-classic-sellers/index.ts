import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type DiscoverRequest = {
  filter?: "all" | "dealers" | "auction_houses";
  start_page?: number;
  max_pages?: number;
  sleep_ms?: number;
};

function toInt(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeProfileUrl(href: string): string | null {
  const s = (href || "").trim();
  if (!s) return null;
  try {
    // Handles relative "/s/..." links and absolute links.
    const u = new URL(s, "https://www.classic.com");
    if (u.hostname.replace(/^www\./, "") !== "classic.com") return null;
    const pathLower = u.pathname.toLowerCase();
    const allowedPrefixes = ["/s/", "/dealers/", "/auction-houses/"];
    if (!allowedPrefixes.some((p) => pathLower.startsWith(p))) return null;

    // Normalize: keep trailing slash.
    const path = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
    return `https://www.classic.com${path}`;
  } catch {
    return null;
  }
}

function normalizeSellerType(raw: string | null): "dealer" | "auction_house" | null {
  const s = (raw || "").toLowerCase();
  if (s.includes("auction")) return "auction_house";
  if (s.includes("dealer")) return "dealer";
  return null;
}

function inferSellerTypeFromProfileUrl(profileUrl: string): "dealer" | "auction_house" | null {
  try {
    const u = new URL(profileUrl);
    const p = u.pathname.toLowerCase();
    if (p.startsWith("/dealers/")) return "dealer";
    if (p.startsWith("/auction-houses/")) return "auction_house";
    return null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const body: DiscoverRequest = await req.json().catch(() => ({} as any));
    const filter = body.filter || "all";
    const startPage = Math.max(1, toInt(body.start_page, 1));
    const maxPages = Math.max(1, Math.min(toInt(body.max_pages, 5), 250));
    const sleepMs = Math.max(0, Math.min(toInt(body.sleep_ms, 350), 5000));

    const out = {
      success: true,
      filter,
      start_page: startPage,
      max_pages: maxPages,
      pages_fetched: 0,
      rows_seen: 0,
      sellers_upserted: 0,
      sellers_new: 0,
      sellers_existing: 0,
      sample: [] as any[],
    };

    for (let page = startPage; page < startPage + maxPages; page++) {
      const url = `https://www.classic.com/data?filter=${encodeURIComponent(filter)}&page=${page}`;
      const html = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(20000),
      }).then((r) => (r.ok ? r.text() : ""));

      if (!html) break;
      out.pages_fetched++;

      const doc = new DOMParser().parseFromString(html, "text/html");
      if (!doc) break;

      // Extract sellers from multiple possible page layouts:
      // - legacy table layout (rows with seller type in adjacent cell)
      // - modern grid layout (links to /dealers/ or /auction-houses/)
      //
      // Strategy:
      // 1) parse table rows if present
      // 2) also scan all anchors for known seller profile URL patterns

      const upserts: Array<{ profile_url: string; seller_name: string | null; seller_type: string | null }> = [];
      const seen = new Set<string>();

      const table = doc.querySelector("table");
      const rows = table ? Array.from(table.querySelectorAll("tr")) : [];
      for (const row of rows) {
        const linkEl = row.querySelector(
          'a[href^="/s/"], a[href^="/dealers/"], a[href^="/auction-houses/"], a[href^="https://www.classic.com/s/"], a[href^="https://www.classic.com/dealers/"], a[href^="https://www.classic.com/auction-houses/"]',
        ) as any;
        if (!linkEl) continue;
        const href = linkEl.getAttribute("href") || "";
        const profileUrl = normalizeProfileUrl(href);
        if (!profileUrl) continue;
        if (seen.has(profileUrl)) continue;
        seen.add(profileUrl);

        const sellerName = (linkEl.textContent || "").replace(/\s+/g, " ").trim() || null;

        // Type is usually in the second cell for the table layout.
        const cells = Array.from(row.querySelectorAll("td"));
        const typeText = (cells?.[1]?.textContent || "").replace(/\s+/g, " ").trim() || null;
        const sellerType = normalizeSellerType(typeText) || inferSellerTypeFromProfileUrl(profileUrl);

        out.rows_seen++;
        upserts.push({ profile_url: profileUrl, seller_name: sellerName, seller_type: sellerType });
        if (out.sample.length < 5) out.sample.push({ profile_url: profileUrl, seller_name: sellerName, seller_type: sellerType });
      }

      // Also scan all anchors (grid layout / future-proofing)
      const anchors = Array.from(
        doc.querySelectorAll(
          'a[href^="/s/"], a[href^="/dealers/"], a[href^="/auction-houses/"], a[href^="https://www.classic.com/s/"], a[href^="https://www.classic.com/dealers/"], a[href^="https://www.classic.com/auction-houses/"]',
        ),
      ) as any[];
      for (const a of anchors) {
        const href = a?.getAttribute?.("href") || "";
        const profileUrl = normalizeProfileUrl(href);
        if (!profileUrl) continue;
        if (seen.has(profileUrl)) continue;
        seen.add(profileUrl);

        const sellerName = (a.textContent || "").replace(/\s+/g, " ").trim() || null;
        const sellerType = inferSellerTypeFromProfileUrl(profileUrl);

        out.rows_seen++;
        upserts.push({ profile_url: profileUrl, seller_name: sellerName, seller_type: sellerType });
        if (out.sample.length < 5) out.sample.push({ profile_url: profileUrl, seller_name: sellerName, seller_type: sellerType });
      }

      const pageSellerCount = upserts.length;

      if (pageSellerCount === 0) break;

      // Upsert in chunks.
      const chunkSize = 250;
      for (let i = 0; i < upserts.length; i += chunkSize) {
        const chunk = upserts.slice(i, i + chunkSize);

        // Estimate "new vs existing" by pre-checking current rows (cheap select by URL).
        const urls = chunk.map((c) => c.profile_url);
        const { data: existing } = await supabase
          .from("classic_seller_queue")
          .select("profile_url")
          .in("profile_url", urls);
        const existingSet = new Set((existing || []).map((r: any) => r.profile_url));
        for (const c of chunk) {
          if (existingSet.has(c.profile_url)) out.sellers_existing++;
          else out.sellers_new++;
        }

        const { error } = await supabase
          .from("classic_seller_queue")
          .upsert(
            chunk.map((c) => ({
              profile_url: c.profile_url,
              seller_name: c.seller_name,
              seller_type: c.seller_type,
              status: "pending",
              updated_at: new Date().toISOString(),
            })),
            { onConflict: "profile_url" },
          );

        if (error) {
          throw new Error(`classic_seller_queue upsert failed: ${error.message}`);
        }
        out.sellers_upserted += chunk.length;
      }

      if (sleepMs) await new Promise((r) => setTimeout(r, sleepMs));
    }

    return new Response(JSON.stringify(out), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err?.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


