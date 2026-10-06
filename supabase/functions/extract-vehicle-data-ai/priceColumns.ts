/**
 * Which vehicles price column a generic AI extraction fills.
 *
 * This extractor reads an arbitrary page with a language model. A price on such a page is an ask. It goes
 * to vehicles.asking_price and nowhere else. This extractor never writes vehicles.sale_price: a sale is a
 * status proven by a source-specific path (the BaT, Mecum and Cars & Bids extractors, ingest-observation),
 * and a sold_price that a model reads off an arbitrary page is not that proof. The database holds the
 * same line: guard_vehicle_sale_price (migration 20260927170000) refuses a positive sale_price unless
 * sale_status or auction_outcome says sold. sold_price stays in the extraction and in its observation
 * for a later sale writer. It is accepted here only so the rule can say it is ignored.
 *
 * Coercion is strict. A price is a finite number above zero. Zero and negatives become null, because
 * zero is a missing price and not a free car. A string such as '28,500' is rejected to null, never
 * parsed. The extraction normalizer has already turned the model's prices into numbers, so a string
 * here means something upstream changed.
 */
export function listingPriceColumns(
  extraction: { price?: unknown; sold_price?: unknown },
): { asking_price: number | null; sale_price: null } {
  return { asking_price: askingPrice(extraction.price), sale_price: null };
}

function askingPrice(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
