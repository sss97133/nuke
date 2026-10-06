/**
 * What poll-listing-feeds writes to import_queue after it hands a listing URL to `ingest`.
 *
 * `complete` means the vehicle row holds data from the listing page: at least a price, an image or a description.
 * It never means "ingest returned created". For venues whose URL slug carries year, make and model, `ingest` creates
 * the vehicle from the slug when the page extractor fails and reports the failure in `enrichment_error` with status
 * "created". The poller used to ledger that as `complete`. Measured 2026-10-06, vehicles created in the last 14 days:
 * 646 of 850 rows from six venues hold no price, image or description (classiccars 257, mecum 135, cars-and-bids 113,
 * hagerty 78, barrett-jackson 40, pcarmarket 23), and 619 of those 646 have a `complete` ledger row.
 *
 * A ledger row that did not land data is `failed`, with the extractor's error in error_message and a
 * failure_category from the vocabulary process-import-queue already writes. The poller still treats `failed` as
 * settled (see the known-URL lookup in index.ts), so it asks the extractor once per URL, as before. Retrying belongs
 * to whoever drains import_queue, not to a poll that already spends its 20-URL cap on new listings.
 */

/** Columns of the vehicle row that show whether the extraction landed anything. */
export const LANDED_COLUMNS =
  "asking_price, price, sale_price, sold_price, high_bid, winning_bid, description, primary_image_url, image_count";

export interface VehicleLandedRow {
  asking_price?: number | string | null;
  price?: number | string | null;
  sale_price?: number | string | null;
  sold_price?: number | string | null;
  high_bid?: number | string | null;
  winning_bid?: number | string | null;
  description?: string | null;
  primary_image_url?: string | null;
  image_count?: number | string | null;
}

/** The part of the `ingest` response the ledger reads. */
export interface IngestOutcome {
  status?: string;
  vehicle_id?: string | null;
  enrichment_error?: string | null;
}

export interface Landed {
  price: boolean;
  images: boolean;
  description: boolean;
}

export type LedgerOutcome =
  | { status: "complete"; landed: Landed | null }
  | { status: "failed"; error_message: string; failure_category: string; landed: Landed | null };

export const NO_DATA_MESSAGE =
  "ingest created or matched the vehicle but no price, images or description landed";

const positive = (value: unknown): boolean =>
  value !== null && value !== undefined && value !== "" && Number(value) > 0;

const filled = (value: unknown): boolean => typeof value === "string" && value.trim().length > 0;

/** What the vehicle row holds. Null when the row could not be read. */
export function landedFields(row: VehicleLandedRow | null | undefined): Landed | null {
  if (!row) return null;
  return {
    price: [row.asking_price, row.price, row.sale_price, row.sold_price, row.high_bid, row.winning_bid].some(positive),
    images: filled(row.primary_image_url) || positive(row.image_count),
    description: filled(row.description),
  };
}

/**
 * The failure_category vocabulary of process-import-queue (timeout, rate_limited, blocked, extraction_failed),
 * matched case-insensitively because the extractors word the same fault several ways
 * ("Signal timed out", "Blocked by site", "OpenAI API error: 429 ... no credits remaining").
 */
export function failureCategoryFor(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("timeout") || m.includes("timed out") || m.includes("504")) return "timeout";
  if (m.includes("browser has been closed") || m.includes("page.goto")) return "browser_crash";
  if (m.includes("rate limit") || m.includes("429")) return "rate_limited";
  if (m.includes("403") || m.includes("blocked") || m.includes("forbidden")) return "blocked";
  return "extraction_failed";
}

/**
 * The ledger outcome for an ingest result, or null when the poller must not ledger it
 * (errors retry on the next poll; rejections are handled by the caller).
 *
 * `row` is the vehicle read back after ingest returned. When it could not be read, ingest's own signal decides:
 * an `enrichment_error` means the extractor failed, so the row is not complete.
 */
export function ledgerOutcomeForIngest(
  ingest: IngestOutcome,
  row: VehicleLandedRow | null | undefined,
): LedgerOutcome | null {
  if (!["created", "matched", "duplicate"].includes(ingest.status ?? "")) return null;

  const landed = landedFields(row);
  const enrichmentError = (ingest.enrichment_error ?? "").trim();
  const holdsData = landed ? landed.price || landed.images || landed.description : enrichmentError === "";
  if (holdsData) return { status: "complete", landed };

  const message = (enrichmentError || NO_DATA_MESSAGE).slice(0, 500);
  return { status: "failed", error_message: message, failure_category: failureCategoryFor(message), landed };
}
