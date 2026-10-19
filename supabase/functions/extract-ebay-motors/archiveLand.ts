/**
 * Land an archived eBay Motors item page: the Wayback Machine capture is the retrieval, eBay is the source. Free.
 * The raw capture (…/web/<ts>id_/<original>) is retained before parsing; every clock on the observation, price log and
 * episode is the capture's time, not the read's; an ended page's outcome is written as the page states it.
 */
import { htmlToText } from "../_shared/htmlToText.ts";
import { writeVehicleEventByKey } from "../_shared/vehicleEventWrite.ts";
import { toLanding } from "./browseMap.ts";
import { landItem, PLATFORM, type Report } from "./browseSweep.ts";
import { archivedPageToItem, parseArchivedItemPage } from "./archivePage.ts";

export interface Capture { timestamp: string; original: string }

const SOLD = new Set(["winning_bid", "sold_for"]);
const hex = async (b: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b as unknown as BufferSource))).map((x) => x.toString(16).padStart(2, "0")).join("");
const tsIso = (ts: string) => `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}Z`;

export function validCaptures(raw: unknown): Capture[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((c: any) => /^\d{14}$/.test(String(c?.timestamp)) && /^https?:\/\/(cgi|motors|www)\.ebay\.com[:/]/i.test(String(c?.original)))
    .map((c: any) => ({ timestamp: String(c.timestamp), original: String(c.original) })).slice(0, 10);
}

export async function landArchived(supabase: any, cap: Capture, rep: Report, dryRun = false): Promise<Record<string, unknown>> {
  const res = await fetch(`https://web.archive.org/web/${cap.timestamp}id_/${cap.original}`, { // guardrail-allow: raw-fetch (public archive, retained below)
    redirect: "follow", signal: AbortSignal.timeout(45_000), headers: { "User-Agent": "nuke.ag archive reader (+https://nuke.ag)" },
  }).catch((e) => ({ ok: false, status: 0, url: "", text: async () => String(e) } as any));
  const actualTs = String(res.url ?? "").match(/\/web\/(\d{14})id_\//)?.[1] ?? cap.timestamp;
  if (!res.ok) return { capture: cap, error: `archive HTTP ${res.status}` };
  const html = await res.text();
  const p = parseArchivedItemPage(html, cap.original);
  if (!p.itemId) return { capture: cap, error: "no eBay item number on the archived page" };
  const observedAt = tsIso(actualTs);
  const item = archivedPageToItem(p, actualTs);
  const archive = { archive_url: `https://web.archive.org/web/${actualTs}/${cap.original}`, archive_timestamp: actualTs, original_url: cap.original };
  const outcome = { outcome: p.outcome, price_label: p.priceLabel, price_shown: p.priceShown, bids_shown: p.bids, reserve_not_met: p.reserveNotMet,
    ended_text: p.endedText, ended_at: p.endedAt, basis: "archived eBay item page (Wayback Machine capture)" };
  if (dryRun) return { capture: cap, archive, page: { ...p, description: p.description.slice(0, 800) }, landing: toLanding(item, htmlToText, "ebay-wayback") };

  const bytes = new TextEncoder().encode(html), sha = await hex(bytes), url = `https://www.ebay.com/itm/${p.itemId}`;
  const path = `${PLATFORM}/wayback/${actualTs.slice(0, 4)}/${sha}.html`;
  const up = await supabase.storage.from("listing-snapshots").upload(path, bytes, { contentType: "text/html", upsert: true });
  if (up.error) return { capture: cap, error: `snapshot storage failed: ${up.error.message}` };
  const ins = await supabase.from("listing_page_snapshots").insert({
    platform: PLATFORM, listing_url: url, fetched_at: observedAt, fetch_method: "wayback_id", http_status: 200, success: true,
    html: null, html_storage_path: path, html_sha256: sha, content_length: bytes.length, metadata: { ...archive, caller: "extract-ebay-motors archive", credits: 0 },
  }).select("id").maybeSingle();
  let snapshotId: string | null = ins.data?.id ?? null;
  if (ins.error) {
    if (String(ins.error.code) !== "23505") return { capture: cap, error: `snapshot row failed: ${ins.error.message}` };
    snapshotId = (await supabase.from("listing_page_snapshots").select("id").eq("platform", PLATFORM).eq("listing_url", url).eq("html_sha256", sha).eq("success", true).limit(1).maybeSingle()).data?.id ?? null;
    if (!snapshotId) return { capture: cap, error: "snapshot receipt missing after unique-key conflict" };
  }

  const landed = await landItem(supabase, item, rep, observedAt, { snapshotId, source: "ebay-wayback", method: "ebay_wayback_v1", extra: { archive, archived_outcome: outcome } });
  if (p.outcome === "live" || landed !== "landed") return { capture: cap, item_id: p.itemId, landed, outcome: p.outcome };

  const ev = await supabase.from("vehicle_events").select("vehicle_id").eq("source_platform", PLATFORM).eq("source_listing_id", p.itemId).limit(1).maybeSingle();
  if (ev.error || !ev.data?.vehicle_id) return { capture: cap, item_id: p.itemId, landed, outcome: p.outcome, error: "episode not found after landing" };
  const sold = SOLD.has(p.outcome);
  const w = await writeVehicleEventByKey(supabase, {
    vehicle_id: ev.data.vehicle_id, source_platform: PLATFORM, source_listing_id: p.itemId, source_url: url, event_type: "listing",
    event_status: sold ? "sold" : "ended", ...(p.endedAt ? { ended_at: p.endedAt } : {}), ...(sold && p.endedAt ? { sold_at: p.endedAt } : {}),
    ...(sold && p.priceShown != null ? { final_price: p.priceShown } : {}), ...(p.bids != null ? { bid_count: p.bids } : {}),
    metadata: { end_state: outcome, ...archive, snapshot_id: snapshotId, source_observed_at: observedAt },
  }, { sourceObservedAt: observedAt });
  if (w.action === "error") rep.errors.push(`end state ${p.itemId}: ${w.error}`);
  return { capture: cap, item_id: p.itemId, landed, outcome: p.outcome, price: p.priceShown, ended_at: p.endedAt, event: w.action };
}
