// Landing Cars & Bids lots from source_targets, spending Firecrawl credits sparingly (direct fetch is 403).
//   discover_targets    reads C&B's auctions sitemap (1 credit), adds auction ids not held as vehicle_events or targets,
//                       newest sitemap entries first so they get the lowest target ids
//   batch_from_targets  walks cars-and-bids targets in id order; one Firecrawl scrape per lot (html+markdown, no actions,
//                       1 credit measured 2026-10-15), then the single-lot path in index.ts archives and parses it
// Each target tried gets an import_queue row (extractor_version TARGETS_TAG, raw_data.target_id): that row is the cursor.
// Hard cap: max_total lots landed by this tag (default 5000) so the monthly credit pool is never drained.

import { firecrawlScrape } from "../_shared/firecrawl.ts";
import { softWrite } from "../_shared/writeResult.ts";
import { classifyFailure, recordRevision, reviseRetained } from "../_shared/revisionWorker.ts";

export const TARGETS_TAG = "carsandbids-targets:1";
const CAB_SOURCE_ID = "960d1c7f-f711-4f95-9eb5-8e57833f7e0a"; // scrape_sources "Cars and Bids"; claim_revision_items matches on its name
const SITEMAP = "https://carsandbids.com/cab-sitemap/auctions.xml";
const DEEP_ACTIONS = [
  { type: "click", selector: ".cnb-details-comments .dropdown-toggle" }, { type: "wait", milliseconds: 500 },
  { type: "click", selector: "button[data-ga=newest]" }, { type: "wait", milliseconds: 2500 },
  { type: "click", selector: ".gallery-preview .all" }, { type: "wait", milliseconds: 2500 },
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const auctionId = (url: string) => url.match(/\/auctions\/([^/?#]+)/)?.[1] ?? null;

export async function discoverTargets(supabase: any, firecrawlApiKey: string) {
  const res = await firecrawlScrape(
    { url: SITEMAP, formats: ["rawHtml"] },
    { apiKey: firecrawlApiKey, timeoutMs: 60_000, maxAttempts: 1 },
  );
  const xml: string = res.raw?.data?.rawHtml ?? "";
  // The sitemap covers the last 12 months, unordered; take it newest lastmod first so recent auctions get the low target ids.
  const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].flatMap((m) => {
    const url = m[1].match(/<loc>([^<]+\/auctions\/[^<]+)<\/loc>/)?.[1];
    return url ? [{ url, lastmod: m[1].match(/<lastmod>([^<]+)<\/lastmod>/)?.[1] ?? "" }] : [];
  });
  entries.sort((a, b) => b.lastmod.localeCompare(a.lastmod));
  const urls = entries.map((e) => e.url);
  if (!urls.length) return { success: false, error: res.error ?? "empty sitemap", status: res.httpStatus };

  const held = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("vehicle_events").select("source_url").eq("source_platform", "cars_and_bids").range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) { const id = auctionId(r.source_url); if (id) held.add(id.toLowerCase()); } // older writers lowercased ids
    if ((data?.length ?? 0) < 1000) break;
  }
  const known = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("source_targets").select("listing_url").eq("source_slug", "cars-and-bids").order("id").range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) { const id = auctionId(r.listing_url); if (id) known.add(id.toLowerCase()); }
    if ((data?.length ?? 0) < 1000) break;
  }
  const fresh = urls.filter((u) => { const id = auctionId(u)!.toLowerCase(); return !held.has(id) && !known.has(id); });
  const now = new Date().toISOString();
  let added = 0;
  for (let i = 0; i < fresh.length; i += 100) {
    const rows = fresh.slice(i, i + 100).map((u) => ({ source_slug: "cars-and-bids", listing_url: u, sitemap_file: "cab-sitemap/auctions.xml", first_discovered_at: now, last_seen_at: now }));
    const { error } = await supabase.from("source_targets").upsert(rows, { onConflict: "listing_url", ignoreDuplicates: true });
    if (error) throw error;
    added += rows.length;
  }
  return { success: true, sitemap_urls: urls.length, held_ids: held.size, known_targets: known.size, added };
}

export async function batchFromTargets(supabase: any, supabaseUrl: string, key: string, firecrawlApiKey: string, body: Record<string, any>) {
  const limit = Math.min(Math.max(Math.floor(Number(body.limit)) || 7, 1), 12);
  const delayMs = Math.max(Math.floor(Number(body.delay_ms)) || 2000, 2000);
  const maxTotal = Math.max(Math.floor(Number(body.max_total)) || 5000, 1);
  const budgetMs = 110_000;
  const started = Date.now();

  const { count: tried } = await supabase.from("import_queue").select("id", { count: "exact", head: true }).eq("extractor_version", TARGETS_TAG);
  // Credit floor: the account is shared across lanes (FIRECRAWL-BUDGET.md). Stop when the balance is at or under min_balance.
  const minBalance = Math.floor(Number(body.min_balance)) || 0;
  if (minBalance > 0) {
    const cu = await fetch("https://api.firecrawl.dev/v1/team/credit-usage", { headers: { Authorization: `Bearer ${firecrawlApiKey}` }, signal: AbortSignal.timeout(15_000) }).then((r) => r.json()).catch(() => null); // guardrail-allow: raw-fetch
    const remaining = Number(cu?.data?.remaining_credits);
    if (!Number.isFinite(remaining)) return { success: false, stopped: "credit_balance_unreadable" };
    if (remaining <= minBalance) return { success: true, stopped: "credit_floor_reached", remaining, min_balance: minBalance };
  }
  // Year window from the slug (/auctions/<id>/<year>-...): 1964-1991 first, per the owner's tiers.
  const yearMin = Math.floor(Number(body.year_min)) || 0;
  const yearMax = Math.floor(Number(body.year_max)) || 0;
  const yearRe = yearMin && yearMax ? `/auctions/[^/]+/(${Array.from({ length: yearMax - yearMin + 1 }, (_, i) => yearMin + i).join("|")})-` : null;
  if ((tried ?? 0) >= maxTotal) return { success: true, stopped: "max_total_reached", tried, max_total: maxTotal };

  const { data: last } = await supabase.from("import_queue").select("raw_data").eq("extractor_version", TARGETS_TAG).order("created_at", { ascending: false }).limit(1).maybeSingle();
  let cursor = Number(body.after_id) || Number(last?.raw_data?.target_id) || 0;

  const picked: { id: number; listing_url: string }[] = [];
  // Candidates beyond `limit`: a lot another run already claimed (unique import_queue.listing_url) is skipped for free.
  for (let page = 0; page < 10 && picked.length < limit * 3; page++) {
    let tq = supabase.from("source_targets").select("id, listing_url").eq("source_slug", "cars-and-bids").gt("id", cursor);
    if (yearRe) tq = tq.filter("listing_url", "match", yearRe);
    const { data: targets, error } = await tq.order("id", { ascending: true }).limit(200);
    if (error) throw error;
    if (!targets?.length) break;
    cursor = targets[targets.length - 1].id;
    const urls = targets.map((t: any) => t.listing_url);
    const { data: queued } = await supabase.from("import_queue").select("listing_url").in("listing_url", urls);
    const done = new Set((queued ?? []).map((r: any) => r.listing_url));
    for (const t of targets) if (picked.length < limit * 3 && !done.has(t.listing_url)) picked.push(t);
  }

  const results = { candidates: picked.length, landed: 0, failed: 0, credits: 0, stopped: null as string | null, errors: [] as string[] };
  let streak = 0;
  let claimed = 0;
  for (const t of picked) {
    if (claimed >= limit) break;
    if (Date.now() - started > budgetMs) { results.stopped = "time_budget"; break; }
    const { data: row, error: claimErr } = await supabase.from("import_queue").insert({
      listing_url: t.listing_url, status: "processing", extractor_version: TARGETS_TAG,
      raw_data: { target_id: t.id }, locked_at: new Date().toISOString(), source_id: CAB_SOURCE_ID,
    }).select("id").single();
    if (claimErr || !row) continue; // claimed by the other cron job before any credit was spent
    claimed++;
    const finish = async (status: string, error?: string, vehicleId?: string) =>
      softWrite("import_queue update", await supabase.from("import_queue").update({ status, error_message: error?.slice(0, 500) ?? null, vehicle_id: vehicleId ?? null, processed_at: new Date().toISOString() }).eq("id", row.id), results.errors);
    try {
      const fc = await firecrawlScrape(
        {
          url: t.listing_url, formats: ["html", "markdown"], onlyMainContent: false, waitFor: 2500,
          // Same 1 credit as a bare scrape (measured 2026-10-15): comments filtered to Newest show the whole thread, and
          // "All Photos" opens the full gallery. Without these a sold page shows 19 of 51 comments and 9 of 75 photos.
          actions: DEEP_ACTIONS,
        },
        { apiKey: firecrawlApiKey, timeoutMs: 45_000, maxAttempts: 1 },
      );
      results.credits += Number(fc.raw?.data?.metadata?.creditsUsed ?? 1);
      if (fc.httpStatus === 404) { await finish("skipped", "PAGE_NOT_FOUND"); await supabase.rpc("resolve_revision_item", { p_id: row.id, p_outcome: "dead_page", p_detail: { http: 404 } }); streak = 0; await sleep(delayMs); continue; }
      const html = fc.data?.html ?? "";
      if (!html || html.length < 1000) throw new Error(fc.error || `insufficient html (${html.length}) status ${fc.httpStatus}`);
      const res = await fetch(`${supabaseUrl}/functions/v1/extract-cars-and-bids-core`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
        body: JSON.stringify({ url: t.listing_url, html, markdown: fc.data?.markdown ?? "" }),
        signal: AbortSignal.timeout(90_000),
      });
      const out = await res.json().catch(() => ({}));
      if (res.status === 410) { await finish("skipped", "page_gone"); await supabase.rpc("resolve_revision_item", { p_id: row.id, p_outcome: "dead_page", p_detail: { page: "gone" } }); streak = 0; await sleep(delayMs); continue; }
      if (!res.ok || out.success === false) throw new Error(`extract ${res.status}: ${out.error ?? "failed"}`);
      await finish("complete", undefined, out.vehicle_id);
      if (out.completeness) {
        softWrite("import_queue completeness", await supabase.from("import_queue").update({ raw_data: { target_id: t.id, ...out.completeness } }).eq("id", row.id), results.errors);
        const c = out.completeness;
        const gaps = [
          ...(c.comments_claimed != null && c.comments_landed < c.comments_claimed - 2 ? ["comments"] : []),
          ...(c.photos_claimed != null && c.photos_landed < c.photos_claimed ? ["photos"] : []),
        ];
        if (gaps.length) await recordRevision(supabase, { url: t.listing_url, missing: gaps, reason: "thin_landing", next: "refetch", raisedBy: "extract-cars-and-bids-core", vehicleId: out.vehicle_id, detail: c });
      }
      results.landed++; streak = 0;
    } catch (err: any) {
      const msg = String(err?.message || err);
      await finish("failed", msg);
      if (!/^extract 409/.test(msg)) { const k = classifyFailure(msg); await recordRevision(supabase, { url: t.listing_url, missing: ["landing"], reason: k.reason, next: k.next, raisedBy: "extract-cars-and-bids-core", detail: { error: msg.slice(0, 300) } }); } // a 409 identity refusal is recorded by the extractor itself
      results.failed++; streak++;
      if (results.errors.length < 5) results.errors.push(`${t.listing_url}: ${msg.slice(0, 200)}`);
      if (/\b(402|403|429)\b/.test(msg)) { results.stopped = "blocked_or_out_of_credits"; break; }
      if (streak >= 3) { results.stopped = "3_failures_in_a_row"; break; }
    }
    await sleep(delayMs);
  }
  return { success: true, cursor, ...results };
}

/** reparse_retained worker: re-run the current parser on the retained capture. retained_only makes the extractor refuse to fetch. */
export async function reviseCab(supabase: any, supabaseUrl: string, key: string, body: Record<string, any>) {
  return await reviseRetained(supabase, {
    sourceName: "Cars and Bids", worker: "extract-cars-and-bids-core:revise", limit: Math.floor(Number(body.limit)) || 10,
    reparse: async (it) => {
      const res = await fetch(`${supabaseUrl}/functions/v1/extract-cars-and-bids-core`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
        body: JSON.stringify({ url: it.listing_url, retained_only: true }), signal: AbortSignal.timeout(90_000),
      });
      const out = await res.json().catch(() => ({}));
      if (res.status === 409 && out.error === "no_retained_capture") return { ok: false, noCapture: true };
      if (!res.ok || out.success === false) return { ok: false, detail: { status: res.status, error: String(out.error ?? "").slice(0, 200) } };
      const c = out.completeness ?? {};
      const whole = (c.comments_claimed == null || c.comments_landed >= c.comments_claimed - 2) && (c.photos_claimed == null || c.photos_landed >= c.photos_claimed);
      return { ok: true, whole, detail: c };
    },
  });
}

/**
 * Re-capture lots whose only snapshot was taken mid-auction. Same 1-credit deep scrape as the batch; the new capture is
 * archived as a fresh listing_page_snapshots row (recapture:true makes the extractor prefer it over the cached one), then
 * parsed. A 404 is a not_found revision item, never a result. Reports per URL: snapshot id and the outcome read from it.
 */
export async function recaptureCab(supabase: any, supabaseUrl: string, key: string, firecrawlApiKey: string, body: Record<string, any>) {
  const urls: string[] = (Array.isArray(body.urls) ? body.urls : []).filter((u: unknown) => typeof u === "string" && /^https:\/\/carsandbids\.com\/auctions\//.test(u)).slice(0, 8);
  const minBalance = Math.floor(Number(body.min_balance)) || 0;
  if (minBalance > 0) {
    const cu = await fetch("https://api.firecrawl.dev/v1/team/credit-usage", { headers: { Authorization: `Bearer ${firecrawlApiKey}` }, signal: AbortSignal.timeout(15_000) }).then((r) => r.json()).catch(() => null); // guardrail-allow: raw-fetch
    const remaining = Number(cu?.data?.remaining_credits);
    if (!Number.isFinite(remaining)) return { success: false, stopped: "credit_balance_unreadable" };
    if (remaining <= minBalance) return { success: true, stopped: "credit_floor_reached", remaining, min_balance: minBalance, results: [] };
  }
  const results: Record<string, unknown>[] = [];
  for (const url of urls) {
    let fc = await firecrawlScrape(
      { url, formats: ["html", "markdown"], onlyMainContent: false, waitFor: 2500, actions: DEEP_ACTIONS },
      { apiKey: firecrawlApiKey, timeoutMs: 45_000, maxAttempts: 1 },
    );
    // A lot with no comment filter or gallery link fails the click actions ("Element not found"): the sale facts are still on
    // the page, so take it without actions (one more credit) rather than lose the lot.
    if (/ActionError|Element not found/i.test(String(fc.error)) && !(fc.data?.html && fc.data.html.length > 1000)) {
      fc = await firecrawlScrape(
        { url, formats: ["html", "markdown"], onlyMainContent: false, waitFor: 2500 },
        { apiKey: firecrawlApiKey, timeoutMs: 45_000, maxAttempts: 1 },
      );
    }
    if (fc.httpStatus === 404) {
      await recordRevision(supabase, { url, missing: ["result"], reason: "not_found", next: "none", raisedBy: "extract-cars-and-bids-core:recapture", detail: { http: 404 } });
      results.push({ url, fetched: true, status: 404 });
    } else {
      const html = fc.data?.html ?? "";
      if (!html || html.length < 1000) {
        const k = classifyFailure(fc.error || "insufficient html");
        await recordRevision(supabase, { url, missing: ["result"], reason: k.reason, next: k.next, raisedBy: "extract-cars-and-bids-core:recapture", detail: { error: String(fc.error ?? "").slice(0, 200) } });
        results.push({ url, fetched: false, error: String(fc.error ?? "insufficient html").slice(0, 160) });
        if (/\b(402|403|429)\b/.test(String(fc.error))) break;
      } else {
        const res = await fetch(`${supabaseUrl}/functions/v1/extract-cars-and-bids-core`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
          body: JSON.stringify({ url, html, markdown: fc.data?.markdown ?? "", recapture: true }), signal: AbortSignal.timeout(90_000),
        });
        const out = await res.json().catch(() => ({}));
        if (res.status === 410) { results.push({ url, fetched: true, status: 404, gone: true, snapshot_id: out.snapshot_id ?? null }); await sleep(2000); continue; }
        results.push({ url, fetched: true, status: 200, extract_status: res.status, snapshot_id: out.snapshot_id ?? null, result: out.result ?? null, vehicle_id: out.vehicle_id ?? null, refused: out.refused ?? null });
      }
    }
    await sleep(2000);
  }
  return { success: true, results };
}
