// Landing the PCarMarket backlog and new auctions from source_targets, free and throttled.
//   discover_targets    reads PCarMarket's own sitemaps and adds auction slugs not yet in source_targets
//   batch_from_targets  walks source_targets in id order; each lot is fetched directly (identified UA, 2 s apart),
//                       archived to listing_page_snapshots, then handed to this function's single-lot path as {url, html}
// A target tried gets an import_queue row (extractor_version TARGETS_TAG, raw_data.target_id): that row is the cursor.
// Stops at the limit, at the time budget, after 3 failures in a row, and at once on a 403/429.

import { archiveFetch, readArchivedPage } from "../_shared/archiveFetch.ts";
import { parseSsrPage } from "./ssrPage.ts";
import { classifyFailure, recordRevision, reviseRetained } from "../_shared/revisionWorker.ts";
import { projectSecretKey } from "../_shared/supabaseKeys.ts";

export const TARGETS_TAG = "pcarmarket-targets:1";
const PCM_SOURCE_ID = "d338952e-e559-4a2b-aa84-1aadf6a5bb71"; // scrape_sources "PCARMARKET"; claim_revision_items matches on its name
const SITE = "https://www.pcarmarket.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const slugOf = (url: string) => url.replace(/^.*\/(?:auction|results)\//, "").replace(/[/?#].*$/, "");
// Old targets say /auction/marketplace-<slug>; the results sitemap drops the prefix.
const bareSlug = (s: string) => s.replace(/^marketplace-/, "");
export const eventUrlFor = (targetUrl: string) => `https://pcarmarket.com/auction/${slugOf(targetUrl)}`;

export async function discoverTargets(supabase: any) {
  const slugs = new Set<string>();
  for (const f of ["sitemap-auctions-vehicles.xml", "sitemap-results.xml"]) {
    const res = await archiveFetch(`${SITE}/${f}`, { platform: "pcarmarket", useFirecrawl: false, skipCache: true, callerName: "import-pcarmarket-listing", directFetchOptions: { publicOnly: true, timeout: 40_000 } });
    if (res.statusCode === 403 || res.statusCode === 429) return { success: false, stopped: "blocked_by_source", status: res.statusCode };
    if (!res.html) throw new Error(`${f} ${res.error ?? `HTTP ${res.statusCode}`}`);
    const xml = res.html;
    for (const m of xml.matchAll(/<loc>[^<]*\/(?:auction|results)\/([^<\/]+)<\/loc>/g)) slugs.add(m[1]);
    await sleep(2000);
  }
  const known = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("source_targets").select("listing_url").eq("source_slug", "pcarmarket").order("id").range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) known.add(bareSlug(slugOf(r.listing_url)));
    if ((data?.length ?? 0) < 1000) break;
  }
  const fresh = [...slugs].filter((s) => !known.has(bareSlug(s)));
  const now = new Date().toISOString();
  let added = 0;
  for (let i = 0; i < fresh.length; i += 100) {
    const rows = fresh.slice(i, i + 100).map((s) => ({
      source_slug: "pcarmarket",
      listing_url: `${SITE}/auction/${s}`,
      sitemap_file: "sitemap-results.xml|sitemap-auctions-vehicles.xml",
      first_discovered_at: now,
      last_seen_at: now,
    }));
    const { error } = await supabase.from("source_targets").upsert(rows, { onConflict: "listing_url", ignoreDuplicates: true });
    if (error) throw error;
    added += rows.length;
  }
  return { success: true, sitemap_slugs: slugs.size, known_targets: known.size, added };
}

export async function batchFromTargets(supabase: any, supabaseUrl: string, body: Record<string, any>) {
  const limit = Math.min(Math.max(Math.floor(Number(body.limit)) || 30, 1), 40);
  const delayMs = Math.max(Math.floor(Number(body.delay_ms)) || 2000, 2000);
  const budgetMs = 110_000;
  const started = Date.now();

  const { data: last } = await supabase
    .from("import_queue").select("raw_data").eq("extractor_version", TARGETS_TAG).contains("raw_data", { lane: "backlog" })
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  let cursor = Number(body.after_id) || Number(last?.raw_data?.target_id) || 0;

  const picked: { id: number; listing_url: string; lane: string }[] = [];
  const isDone = async (targets: { listing_url: string }[]) => {
    const [{ data: queued }, { data: landed }] = await Promise.all([
      supabase.from("import_queue").select("listing_url").in("listing_url", targets.map((t) => t.listing_url)),
      supabase.from("vehicle_events").select("source_url").eq("source_platform", "pcarmarket").in("source_url", targets.map((t) => eventUrlFor(t.listing_url))),
    ]);
    return new Set([...(queued ?? []).map((r: any) => r.listing_url), ...(landed ?? []).map((r: any) => r.source_url)]);
  };
  // Newly discovered auctions first (up to half the batch), so they land while fresh; the cursor walk takes the backlog.
  const { data: fresh } = await supabase
    .from("source_targets").select("id, listing_url").eq("source_slug", "pcarmarket")
    .gte("first_discovered_at", new Date(Date.now() - 3 * 86_400_000).toISOString())
    .order("id", { ascending: false }).limit(100);
  if (fresh?.length) {
    const done = await isDone(fresh);
    for (const t of fresh) {
      if (picked.length < Math.ceil(limit / 2) && !done.has(t.listing_url) && !done.has(eventUrlFor(t.listing_url))) picked.push({ ...t, lane: "fresh" });
    }
  }
  for (let page = 0; page < 20 && picked.length < limit; page++) {
    const { data: targets, error } = await supabase
      .from("source_targets").select("id, listing_url").eq("source_slug", "pcarmarket")
      .gt("id", cursor).order("id", { ascending: true }).limit(200);
    if (error) throw error;
    if (!targets?.length) break;
    cursor = targets[targets.length - 1].id;
    const done = await isDone(targets);
    for (const t of targets) {
      if (picked.length < limit && !picked.some((p) => p.id === t.id) && !done.has(t.listing_url) && !done.has(eventUrlFor(t.listing_url))) picked.push({ ...t, lane: "backlog" });
    }
  }

  const results = { picked: picked.length, landed: 0, not_vehicle: 0, failed: 0, stopped: null as string | null, errors: [] as string[] };
  const key = projectSecretKey()!;
  let streak = 0;
  for (const t of picked) {
    if (Date.now() - started > budgetMs) { results.stopped = "time_budget"; break; }
    const { data: row, error: claimErr } = await supabase.from("import_queue").insert({
      listing_url: t.listing_url, status: "processing", extractor_version: TARGETS_TAG,
      raw_data: { target_id: t.id, lane: t.lane }, locked_at: new Date().toISOString(), source_id: PCM_SOURCE_ID,
    }).select("id").single();
    if (claimErr || !row) continue; // another run holds this target
    const finish = (status: string, error?: string, vehicleId?: string) =>
      supabase.from("import_queue").update({ status, error_message: error?.slice(0, 500) ?? null, vehicle_id: vehicleId ?? null, processed_at: new Date().toISOString() }).eq("id", row.id);
    try {
      const url = `${SITE}/auction/${slugOf(t.listing_url)}`;
      // Ended lots live at /results/<slug> (old /auction/ and /auction/marketplace- URLs redirect there in two hops,
      // which the direct fetcher does not follow); live ones stay at /auction/<slug>.
      const get = (u: string) => archiveFetch(u, { platform: "pcarmarket", useFirecrawl: false, callerName: "import-pcarmarket-listing", directFetchOptions: { publicOnly: true, timeout: 25_000 } });
      let page = await get(`${SITE}/results/${bareSlug(slugOf(t.listing_url))}`);
      if (!page.html || page.statusCode === 404) { await sleep(delayMs); page = await get(`${SITE}/auction/${bareSlug(slugOf(t.listing_url))}`); }
      const status = page.statusCode ?? 0;
      if (status === 404 || status === 410) { await finish("skipped", "PAGE_NOT_FOUND"); await supabase.rpc("resolve_revision_item", { p_id: row.id, p_outcome: "dead_page", p_detail: { http: status } }); results.not_vehicle++; streak = 0; }
      else if (status === 403 || status === 429) { await finish("failed", `HTTP ${status}`); results.failed++; results.stopped = "blocked_by_source"; break; }
      else if (!page.html) throw new Error(page.error || `no html (status ${status})`);
      else if (!page.html.includes("Car Details")) { await finish("skipped", "not_a_vehicle_page"); await supabase.rpc("resolve_revision_item", { p_id: row.id, p_outcome: "non_vehicle", p_detail: { page: "no Car Details block" } }); results.not_vehicle++; streak = 0; }
      else {
        const res = await fetch(`${supabaseUrl}/functions/v1/import-pcarmarket-listing`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
          body: JSON.stringify({ url, html: page.html }),
          signal: AbortSignal.timeout(60_000),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok || !out.success) throw new Error(`import ${res.status}: ${out.error ?? "failed"}`);
        await finish("complete", undefined, out.vehicle_id);
        results.landed++; streak = 0;
      }
    } catch (err: any) {
      const msg = String(err?.message || err);
      await finish("failed", msg);
      if (!/^import 409/.test(msg)) { const k = classifyFailure(msg); await recordRevision(supabase, { url: t.listing_url, missing: ["landing"], reason: k.reason, next: k.next, raisedBy: "import-pcarmarket-listing", detail: { error: msg.slice(0, 300) } }); } // a 409 identity refusal is recorded by the importer itself
      results.failed++; streak++;
      if (results.errors.length < 5) results.errors.push(`${t.listing_url}: ${msg.slice(0, 200)}`);
      if (/\b(403|429)\b/.test(msg)) { results.stopped = "blocked_by_source"; break; }
      if (streak >= 3) { results.stopped = "3_failures_in_a_row"; break; }
    }
    await sleep(delayMs);
  }
  return { success: true, cursor, ...results };
}

/** reparse_retained worker: re-run the current parser on the retained capture (no fetch). */
export async function revisePcm(supabase: any, supabaseUrl: string, body: Record<string, any>) {
  const key = projectSecretKey()!;
  return await reviseRetained(supabase, {
    sourceName: "PCARMARKET", worker: "import-pcarmarket-listing:revise", limit: Math.floor(Number(body.limit)) || 10,
    reparse: async (it) => {
      const bare = bareSlug(slugOf(it.listing_url));
      let html: string | null = null;
      for (const u of [`${SITE}/results/${bare}`, `${SITE}/auction/${bare}`]) {
        const page = await readArchivedPage(u, { platform: "pcarmarket", maxAgeSec: 10 * 365 * 86400, htmlOnly: true });
        if (page.html) { html = page.html; break; }
      }
      if (!html) return { ok: false, noCapture: true };
      if (!html.includes("Car Details")) return { ok: true, nonVehicle: true };
      const res = await fetch(`${supabaseUrl}/functions/v1/import-pcarmarket-listing`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
        body: JSON.stringify({ url: `${SITE}/auction/${slugOf(it.listing_url)}`, html }), signal: AbortSignal.timeout(60_000),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.success) return { ok: false, detail: { status: res.status, error: String(out.error ?? out.refused ?? "").slice(0, 200) } };
      return { ok: true, whole: true, detail: { vehicle_id: out.vehicle_id } };
    },
  });
}

/**
 * Read the end date and result of lots we already hold, from their /results/ page, archived through archiveFetch (the capture is
 * retained and its snapshot id returned for the citation). Writes nothing to any vehicle: a correction cites this snapshot.
 */
export async function readEnded(body: Record<string, any>) {
  const urls: string[] = (Array.isArray(body.urls) ? body.urls : []).filter((u: unknown) => typeof u === "string" && /pcarmarket\.com\/auction\//.test(u)).slice(0, 12);
  const out: Record<string, unknown>[] = [];
  for (const u of urls) {
    const bare = bareSlug(slugOf(u));
    const page = await archiveFetch(`${SITE}/results/${bare}`, { platform: "pcarmarket", useFirecrawl: false, callerName: "import-pcarmarket-listing", directFetchOptions: { publicOnly: true, timeout: 25_000 } });
    if (page.statusCode === 403 || page.statusCode === 429) { out.push({ url: u, stopped: "blocked_by_source", status: page.statusCode }); break; }
    const parsed = page.html ? parseSsrPage(page.html) : null;
    out.push({
      url: u, status: page.statusCode, snapshot_id: page.snapshotId, cached: page.cached,
      ended_at: parsed?.auctionEndDate ?? null, outcome: parsed?.auctionOutcome ?? null, price: parsed?.salePrice ?? null,
    });
    await sleep(2000);
  }
  return { success: true, results: out };
}
