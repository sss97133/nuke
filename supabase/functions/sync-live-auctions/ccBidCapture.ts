import { retainFetchedCapture } from "../_shared/archiveFetch.ts";
import type { ObservationPost } from "./boards.ts";

export type CcNativeCapture = { document: Record<string, unknown>; receivedAt: string };

/** Retain the full selected native document, not a reconstructed bid or HTML page.
 * Called only after existing observation identity dedupe, within the old budget. */
export async function retainCcBidCapture(db: any, post: ObservationPost, native?: CcNativeCapture): Promise<ObservationPost> {
  const d = native?.document, fields = post.structured_data;
  const received = Date.parse(native?.receivedAt ?? "");
  const end = typeof d?.dtStageEndsUTC === "string" ? Date.parse(d.dtStageEndsUTC.replace(" ", "T") + "Z") : NaN;
  if (!d || post.source_slug !== "collecting-cars" || post.kind !== "bid"
    || post.extraction_method !== "cc_typesense_board_bid_v1" || fields.clock !== "board_read"
    || d.lotType !== "car" || d.stage !== "live"
    || typeof d.slug !== "string" || !/^[a-zA-Z0-9-]+$/.test(d.slug)
    || post.source_url !== `https://collectingcars.com/for-sale/${d.slug}`
    || String(d.auctionId) !== fields.auction_id || d.currentBid !== fields.amount
    || (d.noBids ?? null) !== fields.bid_count
    || (typeof d.currencyCode === "string" ? d.currencyCode.toUpperCase() : null) !== fields.currency
    || !Number.isFinite(received) || received > Date.now() || Date.parse(post.observed_at) !== received
    || (Number.isFinite(end) ? new Date(end).toISOString() : "") !== (fields.ends ?? ""))
    throw new Error("CC native document does not match the attributed board snapshot");
  const retained = await retainFetchedCapture(db, {
    platform: "collecting-cars", url: post.source_url, httpStatus: 200,
    html: JSON.stringify(d), fetchedAt: native!.receivedAt,
    metadata: { producer: "sync-live-auctions", capture_kind: "typesense_native_document",
      collection: "production_listings", api: "https://dora.production.collecting.com/multi_search",
      representation: "complete_selected_document_json_not_wire_response", source_event_time: null },
  });
  if ("reason" in retained)
    throw new Error(`CC native capture ${retained.status}: ${retained.reason}`);
  return { ...post, observed_at: retained.fetched_at,
    raw_source_ref: `listing_page_snapshots:${retained.snapshot_id}`, defer_analysis: true,
    extraction_metadata: { producer: "sync-live-auctions", capture_kind: "auction_bid_snapshot",
      source_event_time: null, received_at: native!.receivedAt,
      source_capture: { snapshot_id: retained.snapshot_id, html_sha256: retained.html_sha256,
        fetched_at: retained.fetched_at, source_url: post.source_url,
        representation: "complete_selected_document_json_not_wire_response" } },
  };
}
