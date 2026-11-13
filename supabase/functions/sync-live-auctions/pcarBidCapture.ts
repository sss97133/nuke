import { projectSecretKey } from "../_shared/supabaseKeys.ts";
import { admissionConfirmed, type AuctionDispatchBudget } from "./postObservations.ts";
import { archiveFetch, stripNul, type ArchiveFetchResult } from "../_shared/archiveFetch.ts";
import { sha256Hex } from "../_shared/batAuctionRecord.ts";
import { parsePcarBids, type PcarBid } from "./boards.ts";

export type PcarBidCapture = { snapshot_id: string; html_sha256: string; fetched_at: string; received_at: string; url: string };

/** A hash collision/deduplicated archive response has no new snapshot ID. Read
 * and verify that exact retained body; never substitute the newest unrelated page. */
export async function pcarBidCapture(db: any, fetched: ArchiveFetchResult, receivedAt: string): Promise<PcarBidCapture> {
  const html = stripNul(fetched.html);
  const u = new URL(fetched.url);
  if (fetched.platform !== "pcarmarket" || fetched.error || fetched.archiveError || fetched.statusCode !== 200
    || !html || new TextEncoder().encode(html).byteLength > 2_097_152 || u.protocol !== "https:"
    || !["pcarmarket.com", "www.pcarmarket.com"].includes(u.hostname) || !/^\/auction\/[^/?#]+\/?$/.test(u.pathname)
    || u.search || u.hash || !Number.isFinite(Date.parse(receivedAt)) || Date.parse(receivedAt)>Date.now())
    throw Error("PCar bid capture unavailable; retained source required");
  const url = u.origin + u.pathname.replace(/\/$/, "");
  const hash = await sha256Hex(html);
  let query = db.from("listing_page_snapshots")
    .select("id,platform,listing_url,success,http_status,html,html_storage_path,html_sha256,fetched_at")
    .eq("platform", "pcarmarket").eq("listing_url", url).eq("success", true).eq("http_status", 200)
    .eq("html_sha256", hash).lte("fetched_at", receivedAt);
  if (fetched.snapshotId) query = query.eq("id", fetched.snapshotId);
  const result = await query.order("fetched_at", { ascending: false }).limit(2);
  if (result.error || !Array.isArray(result.data) || result.data.length !== 1)
    throw Error("PCar bid exact capture missing or ambiguous");
  const row = result.data[0];
  if (!/^[0-9a-f-]{36}$/i.test(row.id ?? "") || (fetched.snapshotId && row.id !== fetched.snapshotId)
    || row.platform !== "pcarmarket" || row.listing_url !== url || row.success !== true || row.http_status !== 200
    || row.html_sha256 !== hash || !Number.isFinite(Date.parse(row.fetched_at)) || Date.parse(row.fetched_at)>Date.parse(receivedAt))
    throw Error("PCar bid capture attribution or clock mismatch");
  let body = row.html;
  if (!body && row.html_storage_path) {
    const path = row.html_storage_path;
    if (typeof path !== "string" || path.startsWith("/") || /[:\\\x00-\x1f]/.test(path)
      || path.split("/").some((p:string)=>p==="." || p==="..")) throw Error("PCar bid storage locator invalid");
    const stored = await db.storage.from("listing-snapshots").download(path);
    if (stored.error || !stored.data || stored.data.size>2_097_152) throw Error("PCar bid retained body unavailable");
    body = await stored.data.text();
  }
  if (typeof body !== "string" || !body || new TextEncoder().encode(body).byteLength>2_097_152 || await sha256Hex(body)!==hash)
    throw Error("PCar bid retained body hash mismatch");
  return { snapshot_id: row.id, html_sha256: hash, fetched_at: row.fetched_at, received_at: receivedAt, url };
}

/** Source placement time stays observed_at; retention and current receipt clocks
 * are separate. Bidder/max-bid details remain out of the public tape whitelist. */
export function pcarBidObservation(b: PcarBid, lot: { url: string; vehicle_id: string }, capture: PcarBidCapture) {
  const source = new URL(lot.url), retained = new URL(capture.url);
  if (source.protocol !== "https:" || source.hostname.replace(/^www\./, "")!=="pcarmarket.com"
    || source.pathname.replace(/\/$/, "")!==retained.pathname || source.search || source.hash)
    throw Error("PCar bid lot/capture mismatch");
  return { source_slug: "pcarmarket", kind: "bid", observed_at: b.at,
    source_url: lot.url, source_identifier: `pcarmarket-bid:${b.id}`,
    content_text: `Bid $${b.amount.toLocaleString("en-US")}`,
    // Keep the original source-content hash grammar stable across retry/capture
    // clocks. Capture provenance is not a new native bid occurrence.
    structured_data: { bid_id: b.id, amount: b.amount, currency: "USD", bidder: b.bidder, bid_status: b.status,
      clock: "source_event_time" },
    vehicle_id: lot.vehicle_id, extraction_method: "pcarmarket_ssr_bids_v1",
    raw_source_ref: `listing_page_snapshots:${capture.snapshot_id}`,
    extraction_metadata: { producer: "sync-live-auctions", source_capture_at: capture.fetched_at,
      received_at: capture.received_at, received_at_basis: "producer_received_archived_response", source_capture_sha256: capture.html_sha256,
      source_capture: { snapshot_id: capture.snapshot_id, html_sha256: capture.html_sha256,
        fetched_at: capture.fetched_at, source_url: capture.url, representation: "utf8_text_nul_removed_if_present" } }, defer_analysis: true };
}

/**
 * Bids of PCarMarket lots whose retained history trails the board count, from the lot page's own bid history (Basta id, time, amount,
 * bidder), admitted through ingest-observation as kind 'bid' with observed_at = the bid's own time. A bid already
 * held for the vehicle is not posted again.
 */
export async function ingestPcarBids(
  supabase: any,
  moved: { url: string; vehicle_id: string | null }[],
  maxLots: number,
  deadline: number,
  budget: AuctionDispatchBudget,
  fetchPage: typeof archiveFetch = archiveFetch,
): Promise<{ lots: number; posted: number; attempted: number; deferred: boolean; errors: string[] }> {
  const out = { lots: 0, posted: 0, attempted: 0, deferred: false, errors: [] as string[] };
  const base = Deno.env.get("SUPABASE_URL") ?? "";
  const key = projectSecretKey() ?? "";
  const linked = moved.flatMap((m) => (m.vehicle_id ? [{ url: m.url, vehicle_id: m.vehicle_id }] : []));
  out.deferred = linked.length > maxLots;
  for (const lot of linked.slice(0, maxLots)) {
    if (Date.now() >= deadline || !budget.remaining("pcar")) { out.deferred = true; break; }
    const fetched = await fetchPage(lot.url.replace("https://pcarmarket.com/", "https://www.pcarmarket.com/"), {
      platform: "pcarmarket", skipCache: true, useFirecrawl: false, callerName: "sync-live-auctions",
    });
    const receivedAt = new Date().toISOString();
    const { html, error } = fetched;
    if (error || !html) { out.errors.push(`${lot.url}: ${error ?? "no HTML"}`); continue; }
    out.lots++;
    const bids = parsePcarBids(html);
    if (!bids.length) { out.errors.push(`${lot.url}: no bid history parsed; capture remains pending`); continue; }
    const ids = bids.map((b) => `pcarmarket-bid:${b.id}`);
    const { data: held, error: heldError } = await supabase.from("vehicle_observations").select("source_identifier")
      .eq("vehicle_id", lot.vehicle_id).eq("kind", "bid").not("is_superseded", "is", true).in("source_identifier", ids);
    if (heldError) { out.errors.push(`held check: ${heldError.message}`); continue; }
    const have = new Set((held ?? []).map((r: { source_identifier: string }) => r.source_identifier));
    if (bids.every(b => have.has(`pcarmarket-bid:${b.id}`))) continue;
    let capture;
    try { capture = await pcarBidCapture(supabase, fetched, receivedAt); }
    catch (error) { out.errors.push(`${lot.url}: ${error instanceof Error ? error.message : String(error)}`); continue; }
    for (const b of bids) {
      const sid = `pcarmarket-bid:${b.id}`;
      if (have.has(sid)) continue;
      if (Date.now() >= deadline || !budget.remaining("pcar")) { out.deferred = true; break; }
      if (!budget.take("pcar")) { out.deferred = true; break; }
      out.attempted++;
      try {
        const res = await fetch(`${base}/functions/v1/ingest-observation`, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(pcarBidObservation(b, lot, capture)),
        });
        const admitted = await res.json().catch(() => null);
        if (admissionConfirmed(res.ok, admitted)) out.posted++;
        else {
          out.errors.push(`${sid}: admission not confirmed (HTTP ${res.status})`);
          if (res.ok || res.status === 429 || res.status >= 500) { out.deferred = true; return out; }
        }
      } catch (error) {
        out.errors.push(`${sid}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200));
        out.deferred = true; return out;
      }
    }
  }
  return out;
}
