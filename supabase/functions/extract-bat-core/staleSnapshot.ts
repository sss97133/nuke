import { readOwnAuctionEnd, summarizeAuction } from "../_shared/batAuctionRecord.ts";

/**
 * A cached page that shows a running lot whose own end has passed is a pre-close capture, never the lot's result.
 *
 * 2026-11-25: bat-settlement-drain reads through this function with the snapshot preference on. The newest
 * listing_page_snapshots row of a closed lot was the one taken in its closing minute (closing reads retain terminal
 * pages elsewhere), so 22 of the 11-24 closes were re-read from a page with no result record: auction_events got
 * 'bid_to' or 'live', and preserve_bat_live_projection kept the old projection because the replayed clock was not
 * newer than the last stream frame. The caller then fetches the page directly.
 *
 * Returns the reason to skip the snapshot, or null to use it.
 */
export function staleClosedSnapshot(html: string, nowMs: number): string | null {
  const end = readOwnAuctionEnd(html);
  const endMs = end.endsAt ? Date.parse(end.endsAt) : NaN;
  if (!Number.isFinite(endMs) || endMs > nowMs) return null;     // running, or no end of its own on the page
  const record = summarizeAuction(html);
  if (record.sold || record.reserveNotMet) return null;         // the page already carries the result
  return `snapshot shows the lot running; its own end ${end.endsAt} has passed`;
}
