/**
 * Land an archived eBay Motors item page: the Wayback Machine capture is the retrieval, eBay is the source. Free.
 * The raw capture (…/web/<ts>id_/<original>) is retained before parsing; every clock on the observation, price log and
 * episode is the capture's time, not the read's; an ended page's outcome is written as the page states it.
 */
import { htmlToText } from "../_shared/htmlToText.ts";
import { writeVehicleEventByKey } from "../_shared/vehicleEventWrite.ts";
import { toLanding } from "./browseMap.ts";
import { landItem, PLATFORM, type Report } from "./browseSweep.ts";
import { archivedPageToItem, type ArchivedOutcome, archivedPhotos, parseArchivedItemPage, type PhotoProbe } from "./archivePage.ts";

export interface Capture { timestamp: string; original: string }

const SOLD = new Set(["winning_bid", "sold_for"]);
const hex = async (b: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b as unknown as BufferSource))).map((x) => x.toString(16).padStart(2, "0")).join("");
const tsIso = (ts: string) => `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}Z`;

/** An archived page is history: eBay Motors listings run at most 30 days, and every capture this lander reads is years
 *  old, so the listing has ended whatever the page showed when it was captured. A page captured while 'live' therefore
 *  ends its episode with no end time and no outcome (unknown, not unsold); a sold page is a dated historical sale. */
export function archivedEpisodeState(outcome: ArchivedOutcome, captureTs: string): { event_status: "sold" | "ended"; end_state_note: string | null } {
  if (SOLD.has(outcome)) return { event_status: "sold", end_state_note: null };
  if (outcome === "live") {
    return { event_status: "ended", end_state_note: `captured while live on ${tsIso(captureTs).slice(0, 10)}; eBay Motors listings run at most 30 days, so it has ended; end time and outcome unknown` };
  }
  return { event_status: "ended", end_state_note: null };
}

/** The vehicle row a vehicle known only from archived pages should read: never current inventory. Its 'available'
 *  default (vehicle_price_facts reads 'available' + an asking price as a live ask) becomes 'ended' unless a sale fills
 *  it; it is not public inventory (set_vehicle_visibility) until another source corroborates it. A vehicle that any
 *  other source also holds is left as that source keeps it. Pure; the caller supplies the live row and its episodes. */
export function archiveOnlyVehicleCorrections(v: { sale_status: string | null; is_public: boolean | null; source?: string | null; user_id?: string | null; owner_id?: string | null },
  episodes: { source: string | null }[], sold: boolean): { sale_status?: { value: "ended"; expected: string | null }; hide?: boolean } | null {
  if (v.source !== PLATFORM || v.user_id || v.owner_id) return null;   // created by eBay intake, held by no one
  if (!episodes.length || episodes.some((e) => e.source !== "ebay-wayback")) return null;
  const out: { sale_status?: { value: "ended"; expected: string | null }; hide?: boolean } = {};
  if (!sold && (v.sale_status === "available" || v.sale_status === null)) out.sale_status = { value: "ended", expected: v.sale_status };
  if (v.is_public === true) out.hide = true;
  return out.sale_status || out.hide ? out : null;
}


/** Ask the archive for one photo as a browser would; which capture answered is in the final URL. */
async function probeArchivedPhoto(url: string): Promise<PhotoProbe> {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "nuke.ag archive reader (+https://nuke.ag)" } }); // guardrail-allow: raw-fetch (public archive, availability check)
  await res.body?.cancel();
  return { status: res.status, servedTimestamp: String(res.url ?? "").match(/\/web\/(\d{14})im_\//)?.[1] ?? null, image: (res.headers.get("content-type") ?? "").startsWith("image/") };
}

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
  // A photo lands only when the archive serves it (it kept few: 0 of 106 stored links answered 2026-10-20); the page's full
  // photo list stays on the observation as photos.listed_urls.
  const photos = await archivedPhotos(p.photoSizes, actualTs, probeArchivedPhoto);
  const item = archivedPageToItem(p, actualTs, photos.held);
  const photoReceipt = { listed: photos.listed, checked: photos.checked, archived: photos.held.length, listed_urls: p.images, basis: "GET web.archive.org <ts>im_ per photo, cover first" };
  const archive = { archive_url: `https://web.archive.org/web/${actualTs}/${cap.original}`, archive_timestamp: actualTs, original_url: cap.original };
  const outcome = { outcome: p.outcome, price_label: p.priceLabel, price_shown: p.priceShown, bids_shown: p.bids, reserve_not_met: p.reserveNotMet,
    ended_text: p.endedText, ended_at: p.endedAt, basis: "archived eBay item page (Wayback Machine capture)" };
  if (dryRun) return { capture: cap, archive, photos: photoReceipt, page: { ...p, description: p.description.slice(0, 800) }, landing: toLanding(item, htmlToText, "ebay-wayback") };

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

  const landed = await landItem(supabase, item, rep, observedAt, { snapshotId, source: "ebay-wayback", method: "ebay_wayback_v1", extra: { archive, archived_outcome: outcome, photos: photoReceipt } });
  if (landed !== "landed") return { capture: cap, item_id: p.itemId, landed, outcome: p.outcome };

  const ev = await supabase.from("vehicle_events").select("vehicle_id").eq("source_platform", PLATFORM).eq("source_listing_id", p.itemId).limit(1).maybeSingle();
  if (ev.error || !ev.data?.vehicle_id) return { capture: cap, item_id: p.itemId, landed, outcome: p.outcome, error: "episode not found after landing" };
  const sold = SOLD.has(p.outcome);
  const state = archivedEpisodeState(p.outcome, actualTs);
  const w = await writeVehicleEventByKey(supabase, {
    vehicle_id: ev.data.vehicle_id, source_platform: PLATFORM, source_listing_id: p.itemId, source_url: url, event_type: "listing",
    event_status: state.event_status, ...(p.endedAt ? { ended_at: p.endedAt } : {}), ...(sold && p.endedAt ? { sold_at: p.endedAt } : {}),
    ...(sold && p.priceShown != null ? { final_price: p.priceShown } : {}), ...(p.bids != null ? { bid_count: p.bids } : {}),
    metadata: { end_state: { ...outcome, ...(state.end_state_note ? { ended_after_capture: state.end_state_note } : {}) }, ...archive, snapshot_id: snapshotId, source_observed_at: observedAt },
  }, { sourceObservedAt: observedAt });
  if (w.action === "error") rep.errors.push(`end state ${p.itemId}: ${w.error}`);
  const sale = sold && p.priceShown != null && p.endedAt ? await fillVehicleSale(supabase, ev.data.vehicle_id, p.itemId, p.priceShown, p.endedAt, p.priceLabel, archive.archive_url, url) : null;
  if (sale?.error) rep.errors.push(`vehicle sale ${p.itemId}: ${sale.error}`);
  const hist = await keepArchiveOnlyVehicleHistorical(supabase, ev.data.vehicle_id, sold, archive.archive_url, url);
  if (hist.error) rep.errors.push(`vehicle history ${p.itemId}: ${hist.error}`);
  return { capture: cap, item_id: p.itemId, landed, outcome: p.outcome, price: p.priceShown, ended_at: p.endedAt, event: w.action, vehicle_sale: sale?.result ?? null, vehicle_history: hist.result ?? null };
}

/** A vehicle every episode of which is an archived page is history: its sale_status leaves the 'available' default
 *  (correct_vehicle_sale_provenance_batch, compare-and-set) and it leaves public inventory (set_vehicle_visibility,
 *  which locks the flag until a cited capture of another source publishes it). Its dated sale stays on the row. */
async function keepArchiveOnlyVehicleHistorical(supabase: any, vehicleId: string, pageSold: boolean, archiveUrl: string, url: string) {
  const [v, eps] = await Promise.all([
    supabase.from("vehicles").select("sale_status,is_public,source,user_id,owner_id").eq("id", vehicleId).maybeSingle(),
    supabase.from("vehicle_events").select("metadata->>source").eq("vehicle_id", vehicleId).limit(50),
  ]);
  if (v.error || !v.data) return { error: v.error?.message ?? "vehicle not found" };
  if (eps.error) return { error: eps.error.message };
  const sold = pageSold || v.data.sale_status === "sold";
  const c = archiveOnlyVehicleCorrections(v.data, (eps.data ?? []).map((e: any) => ({ source: e.source ?? null })), sold);
  if (!c) return { result: "unchanged" };
  const basis = `every listing episode of this vehicle is an archived eBay Motors page (Wayback Machine); the listing has ended (eBay Motors listings run at most 30 days); episode ${url}`;
  const done: string[] = [];
  if (c.sale_status) {
    const r = await supabase.rpc("correct_vehicle_sale_provenance_batch", { p_rows: [{ vehicle_id: vehicleId,
      source: { type: "listing_url", ref: archiveUrl, basis }, corrections: { sale_status: c.sale_status } }],
      p_asserted_by: "extract-ebay-motors archive", p_reason: "archive-only vehicle: an ended archived listing is history, not current inventory; sale_status available->ended" });
    if (r.error) return { error: r.error.message };
    done.push("sale_status_ended");
  }
  if (c.hide) {
    const r = await supabase.rpc("set_vehicle_visibility", { p_rows: [{ vehicle_id: vehicleId, value: false, expected: true,
      source: { type: "listing_url", ref: archiveUrl, basis } }], p_asserted_by: "extract-ebay-motors archive",
      p_reason: "archive-only vehicle: known only from archived eBay pages, not public inventory until another source corroborates it" });
    if (r.error) return { error: r.error.message };
    done.push("hidden");
  }
  return { result: done.join(",") };
}

/** Market readers count a sale from the vehicle row (vehicle_sale_basis: sale_status 'sold'). Fill it through the sanctioned
 *  correction writer only when this archived sale is the vehicle's only sold episode and the row still reads 'available'
 *  with no sale price: every field is compare-and-set, so a later or contradicting sale is never overwritten. */
async function fillVehicleSale(supabase: any, vehicleId: string, itemId: string, price: number, endedAt: string, label: string | null, archiveUrl: string, url: string) {
  const other = await supabase.from("vehicle_events").select("id").eq("vehicle_id", vehicleId).neq("source_listing_id", itemId)
    .or("event_status.eq.sold,final_price.not.is.null").limit(1);
  if (other.error) return { error: other.error.message };
  if (other.data?.length) return { result: "skipped_other_sale" };
  const v = await supabase.from("vehicles").select("sale_status,sale_price").eq("id", vehicleId).maybeSingle();
  if (v.error || !v.data) return { error: v.error?.message ?? "vehicle not found" };
  // 'ended' is what keepArchiveOnlyVehicleHistorical writes for an archive-only vehicle; a later capture's sale fills it.
  if (v.data.sale_price != null || !["available", "ended"].includes(v.data.sale_status)) return { result: "skipped_vehicle_state" };
  const rows = [{ vehicle_id: vehicleId,
    source: { type: "listing_url", ref: archiveUrl, basis: `archived eBay Motors item page (Wayback Machine capture) states '${label}: US $${price}' and the end time; listing episode ${url}` },
    corrections: { sale_price: { value: Math.round(price), expected: null }, sale_date: { value: endedAt.slice(0, 10), expected: null }, sale_status: { value: "sold", expected: v.data.sale_status } } }];
  const r = await supabase.rpc("correct_vehicle_sale_provenance_batch", { p_rows: rows, p_asserted_by: "extract-ebay-motors archive",
    p_reason: "eBay archived item page outcome (Winning bid / Sold For); fill-only sale fields, whole-dollar sale_price (exact amount on the episode), status available->sold" });
  return r.error ? { error: r.error.message } : { result: r.data };
}
