/**
 * No vehicle from a URL slug alone, for the venues where that is all a failed extraction leaves.
 *
 * `ingest` trusts the year, make and model in the URL of ten polled venues, so it can name a listing without fetching
 * it. That trust was meant to save an LLM call for identity. When the page extractor then fails, the row it creates
 * holds those three fields and nothing else: a husk, public, with no price, image or description, and nothing that will
 * ever fill it in. Measured 2026-10-06, vehicles created in the last 14 days from six of these venues: 646 of 850 held
 * no price, image or description (classiccars 257, mecum 135, cars-and-bids 113, hagerty 78, barrett-jackson 40,
 * pcarmarket 23). 113 of them, all cars-and-bids, were duplicates of a row the extractor had written itself.
 *
 * So when the page extractor ran and failed, `ingest` returns a rejection with reason `enrichment_failed` and the
 * extractor's error, and writes nothing. poll-listing-feeds records that once in import_queue as `failed`, with the
 * error, a failure_category and a next_attempt_at (ledger.ts), so the URL is retried on a schedule instead of on every
 * poll, and does not spend the poll's cap of 20 URLs.
 *
 * What does not change: a caller that supplies year, make and model itself (it vouches for them); a call with
 * `enrich: false` or a description (no extractor ran, so nothing failed); venues outside the set, Craigslist and BaT
 * among them (14 of 13,729 Craigslist rows held nothing in the same window).
 */

/** Platform keys as `detectSource` in index.ts names them. */
export const SLUG_STUB_BLOCKED: ReadonlySet<string> = new Set([
  "classiccars",
  "mecum",
  "barrett_jackson",
  "hagerty",
  "cars_and_bids",
  "pcarmarket",
  "vanguard_motors",
  "allcollectorcars",
  "autohunter",
  "carandclassic",
]);

export interface SlugStubInput {
  platform: string;
  /** Year, make and model came from the URL slug alone: the caller supplied none of them. */
  identityIsSlugGuess: boolean;
  enrichmentSucceeded: boolean;
  /** The extractor's error, or null when no extractor ran. */
  enrichmentError: string | null;
}

export interface SlugStubRejection {
  reason: string;
  enrichment_error: string;
}

/** The rejection for a slug-only identity whose page extractor failed, or null when `ingest` may go on. */
export function slugStubRejection(input: SlugStubInput): SlugStubRejection | null {
  if (!SLUG_STUB_BLOCKED.has(input.platform)) return null;
  if (!input.identityIsSlugGuess) return null;
  if (input.enrichmentSucceeded || input.enrichmentError === null) return null;
  return { reason: `enrichment_failed: ${input.enrichmentError}`, enrichment_error: input.enrichmentError };
}
