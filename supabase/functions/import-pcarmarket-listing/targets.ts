// Landing the PCarMarket backlog and new auctions from source_targets, free and throttled.
//   discover_targets    reads PCarMarket's own sitemaps and adds auction slugs not yet in source_targets
//   batch_from_targets  walks source_targets in id order; each lot is fetched directly (identified UA, 2 s apart),
//                       archived to listing_page_snapshots, then handed to this function's single-lot path as {url, html}
// A target tried gets an import_queue row (extractor_version TARGETS_TAG, raw_data.target_id): that row is the cursor.
// Stops at the limit, at the time budget, after 3 failures in a row, and at once on a 403/429.

import { archiveFetch } from "../_shared/archiveFetch.ts";
import { projectSecretKey } from "../_shared/supabaseKeys.ts";

export const TARGETS_TAG = "pcarmarket-targets:1";
const SITE = "https://www.pcarmarket.com";
const UA = { "User-Agent": "NukeListingCollector/1.0 (+https://nuke.ag)", "Accept": "application/xml,text/xml" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const slugOf = (url: string) => url.replace(/^.*\/(?:auction|results)\//, "").replace(/[/?#].*$/, "");
// Old targets say /auction/marketplace-<slug>; the results sitemap drops the prefix.
const bareSlug = (s: string) => s.replace(/^marketplace-/, "");
export const eventUrlFor = (targetUrl: string) => `https://pcarmarket.com/auction/${slugOf(targetUrl)}`;

export async function discoverTargets(supabase: any) {
  const slugs = new Set<string>();
  for (const f of ["sitemap-auctions-vehicles.xml", "sitemap-results.xml"]) {
    const res = await fetch(`${SITE}/${f}`, { headers: UA, signal: AbortSignal.timeout(30_000) });
    if (res.status === 403 || res.status === 429) return { success: false, stopped: "blocked_by_source", status: res.status };
    if (!res.ok) throw new Error(`${f} HTTP ${res.status}`);
    const xml = await res.text();
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
    .from("import_queue").select("raw_data").eq("extractor_version", TARGETS_TAG)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  let cursor = Number(body.after_id) || Number(last?.raw_data?.target_id) || 0;

  const picked: { id: number; listing_url: string }[] = [];
  for (let page = 0; page < 20 && picked.length < limit; page++) {
    const { data: targets, error } = await supabase
      .from("source_targets").select("id, listing_url").eq("source_slug", "pcarmarket")
      .gt("id", cursor).order("id", { ascending: true }).limit(200);
    if (error) throw error;
    if (!targets?.length) break;
    cursor = targets[targets.length - 1].id;
    const urls = targets.map((t: any) => t.listing_url);
    const [{ data: queued }, { data: landed }] = await Promise.all([
      supabase.from("import_queue").select("listing_url").in("listing_url", urls),
      supabase.from("vehicle_events").select("source_url").eq("source_platform", "pcarmarket").in("source_url", targets.map((t: any) => eventUrlFor(t.listing_url))),
    ]);
    const done = new Set([...(queued ?? []).map((r: any) => r.listing_url), ...(landed ?? []).map((r: any) => r.source_url)]);
    for (const t of targets) {
      if (picked.length < limit && !done.has(t.listing_url) && !done.has(eventUrlFor(t.listing_url))) picked.push(t);
    }
  }

  const results = { picked: picked.length, landed: 0, not_vehicle: 0, failed: 0, stopped: null as string | null, errors: [] as string[] };
  const key = projectSecretKey()!;
  let streak = 0;
  for (const t of picked) {
    if (Date.now() - started > budgetMs) { results.stopped = "time_budget"; break; }
    const { data: row, error: claimErr } = await supabase.from("import_queue").insert({
      listing_url: t.listing_url, status: "processing", extractor_version: TARGETS_TAG,
      raw_data: { target_id: t.id }, locked_at: new Date().toISOString(),
    }).select("id").single();
    if (claimErr || !row) continue; // another run holds this target
    const finish = (status: string, error?: string, vehicleId?: string) =>
      supabase.from("import_queue").update({ status, error_message: error?.slice(0, 500) ?? null, vehicle_id: vehicleId ?? null, processed_at: new Date().toISOString() }).eq("id", row.id);
    try {
      const url = `${SITE}/auction/${slugOf(t.listing_url)}`;
      const page = await archiveFetch(url, { platform: "pcarmarket", useFirecrawl: false, callerName: "import-pcarmarket-listing", directFetchOptions: { publicOnly: true, timeout: 25_000 } });
      const status = page.statusCode ?? 0;
      if (status === 404 || status === 410) { await finish("skipped", "PAGE_NOT_FOUND"); results.not_vehicle++; streak = 0; }
      else if (status === 403 || status === 429) { await finish("failed", `HTTP ${status}`); results.failed++; results.stopped = "blocked_by_source"; break; }
      else if (!page.html) throw new Error(page.error || `no html (status ${status})`);
      else if (!page.html.includes("Car Details")) { await finish("skipped", "not_a_vehicle_page"); results.not_vehicle++; streak = 0; }
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
      results.failed++; streak++;
      if (results.errors.length < 5) results.errors.push(`${t.listing_url}: ${msg.slice(0, 200)}`);
      if (/\b(403|429)\b/.test(msg)) { results.stopped = "blocked_by_source"; break; }
      if (streak >= 3) { results.stopped = "3_failures_in_a_row"; break; }
    }
    await sleep(delayMs);
  }
  return { success: true, cursor, ...results };
}
