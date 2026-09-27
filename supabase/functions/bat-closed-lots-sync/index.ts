/**
 * bat-closed-lots-sync — the daily pass for newly closed BaT lots, server-side.
 *
 * Reads BaT's own listings-filter feed (the same endpoint scripts/bat-keep-fresh.mjs pages on the
 * laptop), newest-first, and for every CLOSED lot it has not seen:
 *   1. upserts the catalog row into bat_listings (conflict key bat_listing_url; the trigger
 *      sync_bat_listing_to_vehicle gap-fills a matching vehicles row) — sold / date / final bid
 *      are BaT's own, no page needed;
 *   2. queues the lot URL in import_queue (unique listing_url) for bat-queue-worker →
 *      extract-bat-core v4, which writes the rows and links (price from the page's sale record,
 *      buyer only when sold, VIN check digit, images as CDN links, a fetch receipt — no HTML).
 *
 * Stops after `caught_up_pages` consecutive pages with nothing new, or `max_pages`. Idempotent:
 * a re-run sees the same rows and queues nothing. No comment text, no page copies.
 *
 * POST { "max_pages": 6, "per_page": 50, "caught_up_pages": 2, "dry_run": false,
 *        "minimum_year": null, "maximum_year": null }
 * Schedule (jobs-rebuild owns cron): once a day is enough — BaT closes ~150–250 lots/day and the
 * unfiltered feed pages the newest ~10,000. The worker that drains import_queue must run too.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireWriteAuth } from "../_shared/writeGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const API = "https://bringatrailer.com/wp-json/bringatrailer/1.0/data/listings-filter";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SYNC_VERSION = "bat-closed-lots-sync:1.1.0";
// import_queue.source_id for every row this sync queues. import_queue has no sources table; the value
// is a fixed name-based UUID (uuid5 of "bat-closed-lots-sync" in the DNS namespace) so a drain can be
// scoped to BaT rows alone with process-import-queue's existing source_id filter, without waking the
// dormant extractors behind the 3,600+ failed non-BaT rows of 2026-03/04.
const BAT_SETTLEMENT_SOURCE_ID = "4d3f0c9e-7a6b-5b21-9c0d-2f5e8a1b6c37";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(s: string): string {
  return (s || "")
    .replace(/&#8220;|&#8221;/g, '"').replace(/&#8216;|&#8217;/g, "'")
    .replace(/&#8211;/g, "–").replace(/&#8212;/g, "—")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
}

function canonicalLotUrl(raw: string): string | null {
  const m = String(raw || "").match(/bringatrailer\.com\/listing\/([^/?#]+)/i);
  return m ? `https://bringatrailer.com/listing/${m[1].toLowerCase()}/` : null;
}

/** Same row shape as scripts/bat-keep-fresh.mjs toRow(): BaT's catalog is the sold/date authority. */
export { BAT_SETTLEMENT_SOURCE_ID };
export function catalogRow(item: any) {
  const ts = item.sold_text_timestamp || item.timestamp_end;
  const endDate = ts ? new Date(Number(ts) * 1000).toISOString().slice(0, 10) : null;
  const sold = String(item.sold_text || "").includes("Sold for");
  const { country_flag: _flag, ...raw } = item;
  return {
    bat_listing_url: canonicalLotUrl(item.url) ?? item.url,
    bat_listing_title: decodeEntities(item.title),
    final_bid: item.current_bid || null,
    sale_price: sold ? item.current_bid || null : null,
    auction_end_date: endDate,
    sale_date: sold ? endDate : null,
    listing_status: sold ? "sold" : item.active ? "active" : "ended",
    scraped_at: new Date().toISOString(),
    raw_data: { ...raw, sync: SYNC_VERSION },
  };
}

async function fetchFeedPage(page: number, perPage: number, filter: Record<string, unknown>) {
  const waits = [5000, 20000];
  for (let attempt = 0; ; attempt++) {
    try {
      const resp = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA },
        body: JSON.stringify({ page, per_page: perPage, get_items: 1, get_stats: 0, include_s: "", sort: "td", ...filter }),
        signal: AbortSignal.timeout(30000),
      });
      if (resp.status === 429 || resp.status >= 500) throw new Error(`HTTP ${resp.status}`);
      if (!resp.ok) throw Object.assign(new Error(`HTTP ${resp.status}`), { fatal: true });
      return await resp.json();
    } catch (e: any) {
      if (e?.fatal || attempt >= waits.length) throw e;
      await sleep(waits[attempt]);
    }
  }
}

Deno.serve(async (req) => {
  // Writes are never anonymous: service key, signed-in user, or nothing (P0.2, 2026-09-27).
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  try {
    const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim();
    const serviceRoleKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const maxPages = Math.max(1, Math.min(Number(body?.max_pages) || 6, 40));
    const perPage = Math.max(10, Math.min(Number(body?.per_page) || 50, 50));
    const caughtUpPages = Math.max(1, Math.min(Number(body?.caught_up_pages) || 2, 10));
    const dryRun = body?.dry_run === true;
    const filter: Record<string, unknown> = {};
    if (body?.minimum_year) filter.minimum_year = Number(body.minimum_year);
    if (body?.maximum_year) filter.maximum_year = Number(body.maximum_year);

    const stats = { pages: 0, items: 0, closed: 0, already_known: 0, listings_upserted: 0, queued: 0, queue_dupes: 0, errors: [] as string[] };
    let cleanPages = 0;

    for (let page = 1; page <= maxPages; page++) {
      const data = await fetchFeedPage(page, perPage, filter);
      const items: any[] = Array.isArray(data?.items) ? data.items : [];
      stats.pages++;
      stats.items += items.length;
      if (items.length === 0) break;

      const closed = items.filter((it) => !it?.active && canonicalLotUrl(it?.url));
      stats.closed += closed.length;
      if (closed.length === 0) { cleanPages++; if (cleanPages >= caughtUpPages) break; await sleep(750); continue; }

      const urls = closed.map((it) => canonicalLotUrl(it.url)!);
      const { data: known, error: knownErr } = await supabase
        .from("bat_listings")
        .select("bat_listing_url, listing_status, sale_price, final_bid")
        .in("bat_listing_url", urls);
      if (knownErr) throw new Error(`bat_listings read failed: ${knownErr.message}`);
      const knownByUrl = new Map<string, any>((known || []).map((r: any) => [r.bat_listing_url, r]));

      const rows = closed.map(catalogRow);
      const fresh = rows.filter((r) => {
        const k = knownByUrl.get(r.bat_listing_url);
        if (!k) return true;
        return k.listing_status !== r.listing_status || Number(k.sale_price ?? 0) !== Number(r.sale_price ?? 0) || Number(k.final_bid ?? 0) !== Number(r.final_bid ?? 0);
      });
      stats.already_known += rows.length - fresh.length;

      if (fresh.length === 0) {
        cleanPages++;
        if (cleanPages >= caughtUpPages) break;
        await sleep(750);
        continue;
      }
      cleanPages = 0;

      if (!dryRun) {
        const { error: upErr } = await supabase.from("bat_listings").upsert(fresh, { onConflict: "bat_listing_url" });
        if (upErr) { stats.errors.push(`bat_listings upsert p${page}: ${upErr.message}`); }
        else stats.listings_upserted += fresh.length;

        // queue the lot pages for the reader; import_queue.listing_url is unique → duplicates are no-ops
        const queueRows = fresh.map((r) => ({
          listing_url: r.bat_listing_url,
          source_id: BAT_SETTLEMENT_SOURCE_ID,
          listing_title: r.bat_listing_title,
          listing_price: r.sale_price ?? r.final_bid ?? null,
          status: "pending",
          priority: 10,
          raw_data: { source: SYNC_VERSION, listing_status: r.listing_status, auction_end_date: r.auction_end_date },
        }));
        const { data: queued, error: qErr } = await supabase
          .from("import_queue")
          .upsert(queueRows, { onConflict: "listing_url", ignoreDuplicates: true })
          .select("id");
        if (qErr) stats.errors.push(`import_queue p${page}: ${qErr.message}`);
        else {
          stats.queued += (queued || []).length;
          stats.queue_dupes += queueRows.length - (queued || []).length;
        }
      } else {
        stats.listings_upserted += fresh.length;
        stats.queued += fresh.length;
      }

      await sleep(750);
    }

    return new Response(JSON.stringify({ success: true, dry_run: dryRun, version: SYNC_VERSION, ms: Date.now() - startedAt, ...stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const msg = e?.message ? String(e.message) : String(e);
    console.error("bat-closed-lots-sync error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg, ms: Date.now() - startedAt }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
