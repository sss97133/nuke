/**
 * What poll-listing-feeds writes to import_queue after it hands a listing URL to `ingest`, and when it tries a URL
 * again.
 *
 * `complete` means the vehicle row holds data from the listing page: at least a price, an image or a description.
 * It never means "ingest returned created". For venues whose URL slug carries year, make and model, `ingest` creates
 * the vehicle from the slug when the page extractor fails and reports the failure in `enrichment_error` with status
 * "created". The poller used to ledger that as `complete`. Measured 2026-10-06, vehicles created in the last 14 days:
 * 646 of 850 rows from six venues hold no price, image or description (classiccars 257, mecum 135, cars-and-bids 113,
 * hagerty 78, barrett-jackson 40, pcarmarket 23), and 619 of those 646 have a `complete` ledger row.
 *
 * The vehicle row is read back once per batch of ingests (one `IN` query). A failed or empty read-back is unknown, and
 * unknown is never `complete`: the row is `failed` with category `readback_error`.
 *
 * A ledger row that did not land data is `failed`, with the extractor's error in error_message and a failure_category.
 * Each failure adds 1 to `attempts` and sets `next_attempt_at`:
 *
 *   billing          "no credits remaining", "insufficient quota", HTTP 402. A retry cannot help until someone adds
 *                    credit, so the row is final at once (attempts is set to max_attempts). Re-queue it by hand when
 *                    the credit is back.
 *   rate_limited     HTTP 429 or 503, "rate limit", "too many requests".
 *   timeout          HTTP 504 or 408, "timed out", "timeout".
 *   browser_crash    "browser has been closed", "page.goto".
 *   readback_error   the read-back failed or returned no row.
 *                    These four retry after a short backoff: 1 h after the first failure, 2 h after the second.
 *   blocked          HTTP 401, 403 or 451, "Blocked by site", "Forbidden", a captcha or Cloudflare wall.
 *   extraction_failed  anything else, including "no identity fields" and "Failed to parse".
 *   husk_relabel_2026-10-06  set by the husk relabel migration on rows that were `complete` without data; treated
 *                    like extraction_failed.
 *                    These retry once a day.
 *
 * At attempts >= max_attempts (default 3, the column default) next_attempt_at is null and the row is final: the
 * poller skips it for good.
 *
 * What the poller does with a ledger row, in order, for each URL on a feed page:
 *   complete or skipped          skip.
 *   failed, final                skip.
 *   failed, next_attempt_at ahead  skip, and the URL spends none of the 20-URL cap.
 *   failed, due                  ingest again, after every URL that is new. A retry never takes a slot from a new
 *                                listing, and the cap still applies. `ingest` finds the existing vehicle by its
 *                                listing_url and fills what is missing, so a retry that works turns the row `complete`.
 *   no ledger row                skip when vehicles.listing_url already holds the URL, otherwise ingest.
 * A ledger row decides before vehicles.listing_url does, so a husk whose URL is already on vehicles is still retried.
 * Only URLs that are on a feed page when the poll runs are retried. A URL that has scrolled off keeps its `failed`
 * row, and nothing re-queues it today: process-import-queue claims only `pending` rows, and the extraction watchdog
 * that would move failed rows back to pending is not scheduled.
 *
 * A slug-trusted venue whose page extractor failed no longer gets a vehicle at all: `ingest` returns status "rejected",
 * reason "enrichment_failed: <the extractor's error>" and writes nothing (ingest/slugStub.ts). That is ledgered
 * `failed` the same way, with no vehicle_id and the category read from the extractor's error, so it follows the same
 * schedule. It is never `skipped`, even when the error text contains a word the structural check looks for.
 *
 * Errors from `ingest` itself (HTTP failure, timeout on the poller's side) are not ledgered, as before: the next poll
 * asks again. Structural rejections (editorial, not a vehicle, implausible year, quality-gate) are `skipped`, as before.
 */

/** Columns of the vehicle row that show whether the extraction landed anything. `id` keys the batched read-back. */
export const LANDED_COLUMNS =
  "id, asking_price, price, sale_price, sold_price, high_bid, winning_bid, description, primary_image_url, image_count";

export const HUSK_RELABEL_CATEGORY = "husk_relabel_2026-10-06";
export const DEFAULT_MAX_ATTEMPTS = 3;

const HOUR_MS = 3_600_000;
const SHORT_BACKOFF_CATEGORIES = new Set(["rate_limited", "timeout", "browser_crash", "readback_error"]);

export interface VehicleLandedRow {
  id?: string;
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
  reason?: string | null;
  error?: string | null;
}

export interface Landed {
  price: boolean;
  images: boolean;
  description: boolean;
}

/** What the batched read-back says about one vehicle. An error covers a failed query and a missing row. */
export type Readback = { kind: "row"; row: VehicleLandedRow } | { kind: "error"; message: string };

export interface LandedBatch {
  rows: Map<string, VehicleLandedRow>;
  error: string | null;
}

/** A ledger row as the known-URL lookup returns it. */
export interface LedgerKnown {
  status: string;
  attempts?: number | null;
  max_attempts?: number | null;
  next_attempt_at?: string | null;
  failure_category?: string | null;
}

export type LedgerOutcome =
  | { status: "complete"; landed: Landed }
  | { status: "failed"; message: string; failure_category: string; landed: Landed | null };

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

/** Statuses written where a status belongs: "HTTP 500", "status 429", "error: 429 -" (a provider's own wording). */
function statusCodes(message: string): number[] {
  const out: number[] = [];
  const re = /\b(?:http(?:\s+status)?|status(?:\s+code)?|error)\s*[:=]?\s*(\d{3})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(message)) !== null) out.push(Number(m[1]));
  return out;
}

/**
 * The failure_category vocabulary of process-import-queue (timeout, rate_limited, blocked, extraction_failed) plus
 * billing. Statuses count only where a status is written, never as a bare number: a lot number such as 1182504 or a
 * price must not read as an HTTP 504. Call it on the full message, before any truncation.
 */
export function failureCategoryFor(message: string): string {
  const m = message.toLowerCase();
  const codes = statusCodes(message);
  if (
    /no credits remaining|insufficient[_ ]credits?|insufficient[_ ]quota|exceeded your current quota|payment required/.test(m) ||
    codes.includes(402)
  ) return "billing";
  if (/timed out|timeout|aborterror|deadline exceeded/.test(m) || codes.some((c) => c === 504 || c === 408)) return "timeout";
  if (/browser has been closed|page\.goto/.test(m)) return "browser_crash";
  if (/rate limit|too many requests/.test(m) || codes.some((c) => c === 429 || c === 503)) return "rate_limited";
  if (
    /blocked by site|forbidden|access denied|captcha|cloudflare/.test(m) ||
    codes.some((c) => c === 401 || c === 403 || c === 451)
  ) return "blocked";
  return "extraction_failed";
}

/**
 * When to try a failed URL again, as an ISO time, or null when the row is final.
 * `attemptsAfter` counts the failure being recorded.
 */
export function nextAttemptAfter(category: string, attemptsAfter: number, maxAttempts: number, now: Date): string | null {
  if (category === "billing") return null;
  if (attemptsAfter >= maxAttempts) return null;
  const wait = SHORT_BACKOFF_CATEGORIES.has(category) ? HOUR_MS * 2 ** Math.max(0, attemptsAfter - 1) : 24 * HOUR_MS;
  return new Date(now.getTime() + wait).toISOString();
}

const maxAttemptsOf = (row: LedgerKnown | null | undefined): number =>
  row?.max_attempts && Number(row.max_attempts) > 0 ? Number(row.max_attempts) : DEFAULT_MAX_ATTEMPTS;

/**
 * What a ledger row says about its URL. "none" means the ledger has no say (no row, or a status the poller does not
 * write), so vehicles.listing_url decides.
 */
export function ledgerDecision(
  row: LedgerKnown | null | undefined,
  now: Date,
): "none" | "settled" | "retry" | "backoff" {
  if (!row) return "none";
  if (row.status === "complete" || row.status === "skipped") return "settled";
  if (row.status !== "failed") return "none";
  if (Number(row.attempts ?? 0) >= maxAttemptsOf(row)) return "settled";
  const next = row.next_attempt_at ? Date.parse(row.next_attempt_at) : NaN;
  if (Number.isFinite(next) && next > now.getTime()) return "backoff";
  return "retry";
}

export interface IngestPlan {
  /** New URLs first, then due retries, cut at the cap. */
  toIngest: string[];
  fresh: number;
  retries: number;
  /** Skipped for good: complete, skipped, final failed, or already on vehicles with no ledger say. */
  settled: number;
  /** Skipped for now: failed with next_attempt_at ahead. They spend none of the cap. */
  backoff: number;
}

/** Which of a feed page's URLs to hand to `ingest` this poll. */
export function planIngests(
  urls: string[],
  onVehicles: Set<string>,
  ledger: Map<string, LedgerKnown>,
  now: Date,
  cap: number,
): IngestPlan {
  const fresh: string[] = [];
  const retries: string[] = [];
  let settled = 0;
  let backoff = 0;
  for (const url of urls) {
    const d = ledgerDecision(ledger.get(url), now);
    if (d === "settled") settled++;
    else if (d === "backoff") backoff++;
    else if (d === "retry") retries.push(url);
    else if (onVehicles.has(url)) settled++;
    else fresh.push(url);
  }
  return {
    toIngest: [...fresh, ...retries].slice(0, cap),
    fresh: fresh.length,
    retries: retries.length,
    settled,
    backoff,
  };
}

/** One `IN` query for the vehicle rows behind a batch of ingests. Never throws; a failure comes back as `error`. */
export async function readLandedBatch(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  ids: string[],
): Promise<LandedBatch> {
  const rows = new Map<string, VehicleLandedRow>();
  if (ids.length === 0) return { rows, error: null };
  try {
    const { data, error } = await supabase.from("vehicles").select(LANDED_COLUMNS).in("id", ids);
    if (error) return { rows, error: String(error.message ?? error) };
    for (const row of (data ?? []) as VehicleLandedRow[]) if (row.id) rows.set(row.id, row);
    return { rows, error: null };
  } catch (e) {
    return { rows, error: e instanceof Error ? e.message : String(e) };
  }
}

export function readbackFor(vehicleId: string | null | undefined, batch: LandedBatch): Readback {
  if (!vehicleId) return { kind: "error", message: "ingest returned no vehicle id" };
  if (batch.error) return { kind: "error", message: batch.error };
  const row = batch.rows.get(vehicleId);
  if (!row) return { kind: "error", message: `vehicle ${vehicleId} is not in the read-back` };
  return { kind: "row", row };
}

/**
 * The outcome for an ingest result that created, matched or found a vehicle, or null for any other status.
 * `complete` needs a price, an image or a description on the vehicle row. An unreadable row is never complete.
 */
export function ledgerOutcomeForIngest(ingest: IngestOutcome, readback: Readback): LedgerOutcome | null {
  if (!["created", "matched", "duplicate"].includes(ingest.status ?? "")) return null;

  const enrichmentError = (ingest.enrichment_error ?? "").trim();
  if (readback.kind === "error") {
    const message = `read-back failed: ${readback.message}${enrichmentError ? ` | ingest: ${enrichmentError}` : ""}`;
    return { status: "failed", message, failure_category: "readback_error", landed: null };
  }

  const landed = landedFields(readback.row)!;
  if (landed.price || landed.images || landed.description) return { status: "complete", landed };

  const message = enrichmentError || NO_DATA_MESSAGE;
  return { status: "failed", message, failure_category: failureCategoryFor(message), landed };
}

/**
 * The rejection `ingest` returns when a slug-trusted venue's page extractor failed and it wrote no vehicle
 * (ingest/slugStub.ts). It is retried on a schedule, so it is `failed`, not `skipped`.
 */
export function isEnrichmentFailedReject(ingest: IngestOutcome): boolean {
  return ingest.status === "rejected" && /^enrichment_failed\b/.test(String(ingest.reason ?? ""));
}

/** Rejections that will not change on a retry; the poller ledgers them `skipped`. */
export function isStructuralReject(ingest: IngestOutcome): boolean {
  return (
    ingest.status === "rejected" &&
    !isEnrichmentFailedReject(ingest) &&
    /editorial|not_a_vehicle|not a vehicle|implausible|quality_gate_reject/i.test(String(ingest.reason || ingest.error || ""))
  );
}

/** Whether this ingest result gets a ledger row at all. Errors do not: the next poll retries them. */
export function shouldLedger(ingest: IngestOutcome): boolean {
  return (
    ["created", "matched", "duplicate"].includes(ingest.status ?? "") ||
    isStructuralReject(ingest) ||
    isEnrichmentFailedReject(ingest)
  );
}

export interface LedgerWrite {
  status: "complete" | "failed" | "skipped";
  landed: Landed | null;
  /** The import_queue row to upsert on listing_url. */
  row: Record<string, unknown>;
}

/**
 * The import_queue row for one ingested URL, or null when it gets none.
 * `batch` is the read-back of the vehicle rows behind the ingests that were flushed together.
 * `prev` is the ledger row the known-URL lookup returned for this URL, if any: its attempts carry forward.
 */
export function ledgerWriteFor(input: {
  url: string;
  feedId: string;
  ingest: IngestOutcome;
  batch: LandedBatch;
  prev?: LedgerKnown | null;
  now: Date;
}): LedgerWrite | null {
  const { url, feedId, ingest, batch, prev, now } = input;
  if (!shouldLedger(ingest)) return null;

  // A rejection has no vehicle to read back. Every other ledgered result has one, and must be read.
  let outcome: LedgerOutcome | null;
  if (isEnrichmentFailedReject(ingest)) {
    const extractorError = String(ingest.enrichment_error ?? "").trim();
    const message = String(ingest.reason);
    outcome = { status: "failed", message, failure_category: failureCategoryFor(extractorError || message), landed: null };
  } else if (isStructuralReject(ingest)) {
    outcome = null;
  } else {
    outcome = ledgerOutcomeForIngest(ingest, readbackFor(ingest.vehicle_id, batch));
  }
  const status = outcome ? outcome.status : "skipped";
  const landed = outcome ? outcome.landed : null;

  const row: Record<string, unknown> = {
    listing_url: url,
    status,
    vehicle_id: ingest.vehicle_id ?? null,
    processed_at: now.toISOString(),
    raw_data: {
      feed_id: feedId,
      ingested_via: "poll_firecrawl_html",
      ingest_status: ingest.status,
      ...(landed ? { landed } : {}),
      ...(ingest.enrichment_error ? { enrichment_error: String(ingest.enrichment_error).slice(0, 200) } : {}),
      ...(ingest.reason ? { reject_reason: String(ingest.reason).slice(0, 200) } : {}),
    },
  };

  if (outcome?.status === "complete") {
    Object.assign(row, { error_message: null, failure_category: null, next_attempt_at: null });
  } else if (outcome?.status === "failed") {
    const max = maxAttemptsOf(prev);
    const before = Number(prev?.attempts ?? 0);
    const attempts = outcome.failure_category === "billing" ? Math.max(before + 1, max) : before + 1;
    Object.assign(row, {
      error_message: outcome.message.slice(0, 500),
      failure_category: outcome.failure_category,
      attempts,
      next_attempt_at: nextAttemptAfter(outcome.failure_category, attempts, max, now),
      last_attempt_at: now.toISOString(),
    });
  }
  return { status, landed, row };
}

/** Shared invocation throttle. Source/feed switches do not alter testimony. */
export interface IntakeThrottle {
  enabled: boolean;
  max_feeds: number;
  max_ingests: number;
  sources: Record<string, { enabled?: boolean; max_ingests?: number }>;
}

export function intakeThrottle(raw: unknown = {}): IntakeThrottle {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid intake throttle");
  const value = raw as Record<string, unknown>;
  const limit = (v: unknown, fallback: number, max: number) => {
    if (v === undefined) return fallback;
    if (!Number.isInteger(v) || Number(v) < 0 || Number(v) > max) throw new Error("invalid intake limit");
    return Number(v);
  };
  const sources = value.sources ?? {};
  if (typeof sources !== "object" || sources === null || Array.isArray(sources)) throw new Error("invalid source throttles");
  const normalized: IntakeThrottle["sources"] = Object.create(null);
  for (const [slug, item] of Object.entries(sources)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("invalid source throttle");
    const config = item as Record<string, unknown>;
    if (config.enabled !== undefined && typeof config.enabled !== "boolean") throw new Error("invalid source switch");
    normalized[slug] = { enabled: config.enabled !== false, max_ingests: limit(config.max_ingests, 20, 100) };
  }
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") throw new Error("invalid intake switch");
  return { enabled: value.enabled !== false, max_feeds: limit(value.max_feeds, 40, 100),
    max_ingests: limit(value.max_ingests, 20, 100), sources: normalized };
}

export function selectIntakeFeeds<T extends { source_slug: string; last_polled_at?: string | null; poll_interval_minutes?: number | null; last_error?: string | null; error_count?: number | null }>(
  feeds: T[], limit: number, throttle: IntakeThrottle, now: number, force = false,
): T[] {
  const groups = new Map<string, T[]>();
  const sourceLatest = new Map<string, number>();
  for (const feed of feeds) sourceLatest.set(feed.source_slug, Math.max(sourceLatest.get(feed.source_slug) ?? 0,
    Number.isFinite(Date.parse(feed.last_polled_at || "")) ? Date.parse(feed.last_polled_at!) : 0));
  for (const feed of feeds) {
    if (throttle.sources[feed.source_slug]?.enabled === false || throttle.sources[feed.source_slug]?.max_ingests === 0) continue;
    const last = feed.last_polled_at ? Date.parse(feed.last_polled_at) : NaN;
    const category = feed.last_error?.match(/^intake_backoff: (billing|rate_limited|blocked|timeout)$/)?.[1]
      ?? failureCategoryFor(feed.last_error || "");
    const backoffMinutes = !feed.last_error ? 0 : category === "billing" ? 360 : category === "blocked" ? 360
      : category === "rate_limited" ? 15 : 0;
    const interval = Math.max(feed.poll_interval_minutes ?? 60, backoffMinutes * Math.min(4, Math.max(1, feed.error_count ?? 1)));
    if (!force && Number.isFinite(last) && now - last < interval * 60_000) continue;
    const group = groups.get(feed.source_slug) ?? [];
    group.push(feed); groups.set(feed.source_slug, group);
  }
  // Oldest due source first, then round-robin. Hundreds of metro feeds must
  // not take every slot ahead of a single auction-house feed.
  const selected: T[] = [];
  const fairGroups = new Map([...groups].sort(([a], [b]) => (sourceLatest.get(a) ?? 0) - (sourceLatest.get(b) ?? 0)));
  while (selected.length < limit && fairGroups.size) {
    for (const [slug, group] of fairGroups) {
      selected.push(group.shift()!);
      if (!group.length) fairGroups.delete(slug);
      if (selected.length === limit) break;
    }
  }
  return selected;
}

export function createIntakeBudget(throttle: IntakeThrottle, startedAt: number, clock = Date.now) {
  let attempted = 0;
  let sourceShare = 20;
  const sources = new Map<string, { attempted: number; estimate_ms: number; hold: string | null }>();
  const state = (source: string) => {
    if (!sources.has(source)) sources.set(source, { attempted: 0, estimate_ms: 15_000, hold: null });
    return sources.get(source)!;
  };
  const remainingMs = () => Math.max(0, startedAt + 110_000 - clock());
  const refusal = (source: string) => {
    const s = state(source), config = throttle.sources[source];
    if (!throttle.enabled || config?.enabled === false) return "paused";
    if (s.hold) return s.hold;
    if (attempted >= throttle.max_ingests) return "invocation_limit";
    if (s.attempted >= (config?.max_ingests ?? sourceShare)) return "source_limit";
    if (remainingMs() < Math.min(85_000, s.estimate_ms * 1.5) + 10_000) return "worker_deadline";
    return null;
  };
  return {
    shareAcrossSources(count: number) { sourceShare = Math.max(1, Math.ceil(throttle.max_ingests / Math.max(1, count))); },
    reserve(source: string): { timeout_ms: number } | null {
      if (refusal(source)) return null;
      attempted++; state(source).attempted++;
      return { timeout_ms: Math.min(85_000, remainingMs() - 10_000) };
    },
    record(source: string, elapsedMs: number, outcome: IngestOutcome) {
      const s = state(source);
      s.estimate_ms = Math.max(1_000, elapsedMs);
      const error = [outcome.error, outcome.reason, outcome.enrichment_error].filter(Boolean).join(" ");
      const category = failureCategoryFor(error);
      if (error && ["billing", "rate_limited", "blocked", "timeout"].includes(category)) s.hold = category;
    },
    refusal,
    remainingMs,
    snapshot: () => ({ attempted, max_ingests: throttle.max_ingests, remaining_ms: remainingMs(),
      sources: Object.fromEntries(sources), limit_scope: "this_invocation", monetary_cost: "unmeasured" }),
  };
}
export type IntakeBudget = ReturnType<typeof createIntakeBudget>;
