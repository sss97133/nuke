// Landing Cars & Bids lots from source_targets, spending Firecrawl credits sparingly (direct fetch is 403).
//   discover_targets    reads C&B's auctions sitemap (1 credit), adds auction ids not held as vehicle_events or targets,
//                       newest sitemap entries first so they get the lowest target ids
//   batch_from_targets  walks cars-and-bids targets in id order; one Firecrawl scrape per lot (html+markdown, no actions,
//                       1 credit measured 2026-10-15), then the single-lot path in index.ts archives and parses it
// Each target tried gets an import_queue row (extractor_version TARGETS_TAG, raw_data.target_id): that row is the cursor.
// Hard cap: max_total lots landed by this tag (default 5000) so the monthly credit pool is never drained.

import { firecrawlScrape } from "../_shared/firecrawl.ts";

export const TARGETS_TAG = "carsandbids-targets:1";
const SITEMAP = "https://carsandbids.com/cab-sitemap/auctions.xml";
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
      raw_data: { target_id: t.id }, locked_at: new Date().toISOString(),
    }).select("id").single();
    if (claimErr || !row) continue; // claimed by the other cron job before any credit was spent
    claimed++;
    const finish = (status: string, error?: string, vehicleId?: string) =>
      supabase.from("import_queue").update({ status, error_message: error?.slice(0, 500) ?? null, vehicle_id: vehicleId ?? null, processed_at: new Date().toISOString() }).eq("id", row.id);
    try {
      const fc = await firecrawlScrape(
        {
          url: t.listing_url, formats: ["html", "markdown"], onlyMainContent: false, waitFor: 2500,
          // Same 1 credit as a bare scrape (measured 2026-10-15): comments filtered to Newest show the whole thread, and
          // "All Photos" opens the full gallery. Without these a sold page shows 19 of 51 comments and 9 of 75 photos.
          actions: [
            { type: "click", selector: ".cnb-details-comments .dropdown-toggle" }, { type: "wait", milliseconds: 500 },
            { type: "click", selector: "button[data-ga=newest]" }, { type: "wait", milliseconds: 2500 },
            { type: "click", selector: ".gallery-preview .all" }, { type: "wait", milliseconds: 2500 },
          ],
        },
        { apiKey: firecrawlApiKey, timeoutMs: 45_000, maxAttempts: 1 },
      );
      results.credits += Number(fc.raw?.data?.metadata?.creditsUsed ?? 1);
      if (fc.httpStatus === 404) { await finish("skipped", "PAGE_NOT_FOUND"); streak = 0; await sleep(delayMs); continue; }
      const html = fc.data?.html ?? "";
      if (!html || html.length < 1000) throw new Error(fc.error || `insufficient html (${html.length}) status ${fc.httpStatus}`);
      const res = await fetch(`${supabaseUrl}/functions/v1/extract-cars-and-bids-core`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
        body: JSON.stringify({ url: t.listing_url, html, markdown: fc.data?.markdown ?? "" }),
        signal: AbortSignal.timeout(90_000),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.success === false) throw new Error(`extract ${res.status}: ${out.error ?? "failed"}`);
      await finish("complete", undefined, out.vehicle_id);
      if (out.completeness) await supabase.from("import_queue").update({ raw_data: { target_id: t.id, ...out.completeness } }).eq("id", row.id);
      results.landed++; streak = 0;
    } catch (err: any) {
      const msg = String(err?.message || err);
      await finish("failed", msg);
      results.failed++; streak++;
      if (results.errors.length < 5) results.errors.push(`${t.listing_url}: ${msg.slice(0, 200)}`);
      if (/\b(402|403|429)\b/.test(msg)) { results.stopped = "blocked_or_out_of_credits"; break; }
      if (streak >= 3) { results.stopped = "3_failures_in_a_row"; break; }
    }
    await sleep(delayMs);
  }
  return { success: true, cursor, ...results };
}
