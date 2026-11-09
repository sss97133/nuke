import { normalizeListingUrlKey } from "../_shared/listingUrl.ts";
import { clocksLocked } from "../_shared/vehicleEventWrite.ts";

/** Keep provider failures useful without echoing huge filters or source payloads. */
export function episodeFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message
    : error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
  return message.replace(/https?:\/\/\S+/gi, "[request URL omitted]").slice(0, 300);
}

export type BatBoardLot = { url: string; current_bid: number | null; bid_count: number | null;
  auction_end_date: string | null; raw_data: Record<string, unknown> };

/** archiveFetch dedup can return no id. Recover only the exact retained response. */
export async function batBoardReceipt(db: any, html: string, snapshotId: string | null) {
  let query = db.from("listing_page_snapshots").select("id,fetched_at,html_sha256")
    .eq("platform", "bat").eq("listing_url", "https://bringatrailer.com/auctions")
    .eq("success", true).eq("http_status", 200);
  if (snapshotId) query = query.eq("id", snapshotId);
  else {
    const bytes = new TextEncoder().encode(html.replace(/\0/g, ""));
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map(v => v.toString(16).padStart(2, "0")).join("");
    query = query.eq("html_sha256", hash);
  }
  const result = await query.order("fetched_at", { ascending: false }).limit(1).maybeSingle();
  if (result.error || !result.data?.id || !Number.isFinite(Date.parse(result.data.fetched_at)))
    throw Error("BaT board receipt unavailable; episode projection deferred");
  return result.data as { id: string; fetched_at: string; html_sha256: string };
}

export function batEpisodePatch(event: any, lot: BatBoardLot) {
  if (event.source_platform !== "bat" || event.event_status !== "active" || event.event_type !== "auction" || event.sold_at
    || normalizeListingUrlKey(event.source_url) !== normalizeListingUrlKey(lot.url)
    || event.metadata?.live_stream) return null;
  const clock = String(lot.raw_data.source_read_at ?? ""), observed = Date.parse(clock);
  if (!lot.raw_data.source_snapshot_id || !Number.isFinite(observed)) throw Error("BaT board receipt unavailable");
  const prior = Date.parse(event.metadata?.source_observed_at ?? "");
  if (observed > Date.now() || (Number.isFinite(prior) && prior >= observed)) return null;
  const patch: Record<string, unknown> = {};
  // Never roll back an admitted higher bid or a soft-close extension from a stale CDN response.
  if (typeof lot.current_bid === "number" && Number.isFinite(lot.current_bid) && lot.current_bid > 0
    && (event.current_price == null || lot.current_bid > Number(event.current_price))) {
    patch.current_price = lot.current_bid;
    if (event.bid_count === 0 && lot.bid_count == null) patch.bid_count = null;
  }
  const end = Date.parse(lot.auction_end_date ?? "");
  if (!clocksLocked(event.metadata) && Number.isFinite(end) && end > observed
    && (!event.ended_at || end > Date.parse(event.ended_at))) patch.ended_at = lot.auction_end_date;
  if (Object.keys(patch).length === 0) return null;
  patch.metadata = { ...(event.metadata ?? {}), source_observed_at: clock,
    bat_inventory_snapshot: { snapshot_id: lot.raw_data.source_snapshot_id, source_read_at: clock,
      source_url: lot.url, current_bid: lot.current_bid, bid_count: lot.bid_count,
      auction_end_date: lot.auction_end_date, capture_kind: "inventory_state_snapshot", individual_bid: false } };
  return patch;
}

/** Existing episode writer, with bounded reads/writes and explicit remaining work. */
export async function updateVehicleEvents(db: any, auctions: BatBoardLot[], maxUpdates = 64, deadline = Date.now() + 20_000) {
  const byUrl = new Map(auctions.map(a => [normalizeListingUrlKey(a.url), a]));
  const result = { updated: 0, deferred: 0, scanned: 0, read_limit_reached: false, errors: [] as string[] };
  // Oldest state first: successful changed rows move behind the unresolved backlog.
  // Read every page before writing so updated_at ordering cannot move rows between pages.
  const events: any[] = [];
  for (let offset = 0; offset < 3000; offset += 500) {
    if (Date.now() >= deadline) { result.read_limit_reached = true; break; }
    const read = await db.from("vehicle_events")
      .select("id,source_platform,event_status,event_type,source_url,current_price,bid_count,ended_at,sold_at,metadata,updated_at,vehicle_event_metadata_digest")
      .eq("source_platform", "bat").eq("event_status", "active").eq("event_type", "auction")
      .order("updated_at", { ascending: true, nullsFirst: true }).order("id", { ascending: true })
      .range(offset, offset + 499);
    if (read.error) throw Error(`BaT episode read failed: ${episodeFailureMessage(read.error)}`);
    events.push(...(read.data ?? []));
    if ((read.data ?? []).length < 500) break;
    if (offset === 2500) result.read_limit_reached = true;
  }
  result.scanned = events.length;
  // Resolve an explicit bid missing from a profile before refreshing existing quotes.
  events.sort((a, b) => Number(a.current_price != null) - Number(b.current_price != null));
  for (const event of events) {
    const lot = byUrl.get(normalizeListingUrlKey(event.source_url));
    if (!lot) continue;
    const patch = batEpisodePatch(event, lot);
    if (!patch) continue;
    if (Date.now() >= deadline || result.updated + result.errors.length >= maxUpdates) { result.deferred++; continue; }
    // The live table has no universal updated_at trigger. A server-computed
    // full metadata digest protects even a gallery edit that leaves that clock alone.
    if (!/^[0-9a-f]{64}$/.test(event.vehicle_event_metadata_digest ?? "")) {
      result.errors.push("episode metadata digest unavailable; retry after schema refresh");
      continue;
    }
    // Compare source/state clocks so a native event or terminal transition wins a race.
    let write = db.from("vehicle_events").update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", event.id).eq("source_platform", "bat").eq("event_status", "active").eq("event_type", "auction").is("sold_at", null);
    write = event.updated_at == null ? write.is("updated_at", null) : write.eq("updated_at", event.updated_at);
    write = write.eq("vehicle_event_metadata_digest", event.vehicle_event_metadata_digest);
    const saved = await write.select("id");
    if (saved.error || saved.data?.length !== 1) result.errors.push(saved.error ? episodeFailureMessage(saved.error) : "episode changed concurrently; retry");
    else result.updated++;
  }
  return result;
}
