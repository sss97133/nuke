// What a Craigslist post's capture adds to the import_queue ledger row poll-listing-feeds writes after each settled
// ingest call. The row says "this URL was handled, and how"; for a Craigslist post the capture also keeps what the page
// stated (post id, clocks, the attribute block) and how landing it on the vehicle went, because the extractor's answer
// is otherwise gone once ingest has created or matched the vehicle.
//
// Only this is added to `raw_data`; the rest of the row (feed id, route, status, reject reason, landed data) is the
// ledger's own business.

/**
 * The keys to spread into the ledger row's raw_data: post_id, posted_at, updated_at, attributes and capture_landing.
 * Empty for every other source and for any ingest answer that carries no capture.
 */
export function captureLedgerFields(ingest: unknown): Record<string, unknown> {
  const capture = (ingest as { listing_capture?: unknown } | null | undefined)?.listing_capture;
  return capture && typeof capture === "object" && !Array.isArray(capture) ? capture as Record<string, unknown> : {};
}
