/** A Browse read is an aggregate snapshot, never a reconstructed individual bid. */
import { projectSecretKey } from "../_shared/supabaseKeys.ts";
import { deletedLookup, handleHashes, tombstoneItem } from "./deletedMembers.ts";
import { type EbayItem, listingKey } from "./browseMap.ts";

export const AUCTION_SNAPSHOT_METHOD = "ebay_browse_auction_snapshot_v1";
export interface SnapshotReceipt { observationId: string; snapshotId: string; observedAt: string }
export interface SnapshotInput {
  vehicleId: string; url: string; summary: EbayItem; observedAt: string; previousObservationId: string | null; readMethod?: "search" | "getItem";
  sourceCapture?: { snapshot_id: string; html_sha256: string; fetched_at: string; source_url: string };
}
export type SnapshotWriter = (sb: any, input: SnapshotInput) => Promise<SnapshotReceipt>;
const hash = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, "0")).join("");

export function snapshotFields(s: EbayItem, observedAt: string) {
  const count = s.bidCount == null ? null : Number(s.bidCount);
  return {
    capture_kind: "auction_bid_snapshot", clock: "source_read", source_read_at: observedAt, source_bid_at: null,
    item_id: s.itemId ?? null, listing_id: listingKey(s),
    current_bid: s.currentBidPrice?.value ?? null, currency: s.currentBidPrice?.currency ?? s.price?.currency ?? null,
    bid_count: count != null && Number.isInteger(count) && count >= 0 ? count : null,
    current_bid_kind: count != null && count > 0 ? "high_bid" : count === 0 ? "opening_price" : "unknown",
    item_end_date: s.itemEndDate ?? null, buying_options: s.buyingOptions ?? [],
    buy_it_now: s.buyingOptions?.includes("FIXED_PRICE") ? s.price?.value ?? null : null,
  };
}

/** Store evidence, admit through the canonical door, then verify the admitted row before allowing projection. */
export const admitAuctionSnapshot: SnapshotWriter = async (sb, input) => {
  const key = projectSecretKey(), base = Deno.env.get("SUPABASE_URL");
  if (!key || !base) throw new Error("auction observation credentials unavailable");
  const raw = (await tombstoneItem(deletedLookup(sb), input.summary)).raw;
  // Previous admission distinguishes A -> B -> A. A failed projection retries the same capture and clock.
  if (input.sourceCapture && Date.parse(input.sourceCapture.fetched_at) !== Date.parse(input.observedAt))
    throw new Error("auction source page clock mismatch");
  const body = JSON.stringify({ previous_observation_id: input.previousObservationId, read_method: input.readMethod ?? "search", summary: raw,
    ...(input.sourceCapture ? { source_capture: input.sourceCapture } : {}) });
  const digest = await hash(body);
  const identifier = `auction-snapshot:${listingKey(input.summary)}:${input.vehicleId}:${digest}`;
  const find = () => sb.from("listing_page_snapshots").select("id,fetched_at")
    .eq("platform", "ebay_motors").eq("listing_url", input.url).eq("html_sha256", digest).limit(1).maybeSingle();
  let retained = await find();
  if (retained.error) throw new Error(`auction capture lookup: ${retained.error.message}`);
  if (!retained.data) {
    const handles = await handleHashes(body);
    retained = await sb.from("listing_page_snapshots").insert({ platform: "ebay_motors", listing_url: input.url,
      fetched_at: input.observedAt, fetch_method: AUCTION_SNAPSHOT_METHOD, http_status: 200, success: true,
      html: body, html_sha256: digest, content_length: new TextEncoder().encode(body).length,
      metadata: { api: input.readMethod === "getItem" ? "buy/browse/v1/item" : "buy/browse/v1/item_summary/search", capture_kind: "auction_bid_snapshot",
        member_handles_sha256: handles.member, seller_handles_sha256: handles.seller },
    }).select("id,fetched_at").maybeSingle();
    if (retained.error?.code === "23505") retained = await find();
  }
  if (retained.error || !retained.data?.id || !retained.data?.fetched_at) throw new Error(`auction capture failed: ${retained.error?.message ?? "missing receipt"}`);
  const snapshotId = retained.data.id, observedAt = retained.data.fetched_at;
  const ref = `listing_page_snapshots:${snapshotId}`;
  const fields = snapshotFields(raw, observedAt);
  const response = await fetch(`${base}/functions/v1/ingest-observation`, {
    method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({ source_slug: "ebay_motors", kind: "listing", observed_at: observedAt, source_url: input.url,
      source_identifier: identifier, vehicle_id: input.vehicleId, structured_data: fields,
      extraction_method: AUCTION_SNAPSHOT_METHOD, raw_source_ref: ref, defer_analysis: true,
      extraction_metadata: { capture_kind: "auction_bid_snapshot", snapshot_id: snapshotId, clock: "source_read",
        ...(input.sourceCapture ? { source_capture: input.sourceCapture } : {}) },
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.success !== true || !result?.observation_id) throw new Error(`auction admission failed: HTTP ${response.status}`);
  const check = await sb.from("vehicle_observations").select("id,vehicle_id,source_identifier,raw_source_ref,kind,extraction_method,source_url,structured_data,observed_at,is_superseded")
    .eq("id", result.observation_id).maybeSingle();
  const row = check.data;
  if (check.error || !row || row.vehicle_id !== input.vehicleId || row.source_identifier !== identifier || row.raw_source_ref !== ref
    || row.kind !== "listing" || row.extraction_method !== AUCTION_SNAPSHOT_METHOD || row.source_url !== input.url || row.is_superseded === true
    || Date.parse(row.observed_at) !== Date.parse(observedAt)
    || Object.entries(fields).some(([k, value]) => JSON.stringify(row.structured_data?.[k]) !== JSON.stringify(value))) throw new Error("auction admission readback mismatch");
  return { observationId: row.id, snapshotId, observedAt };
};
