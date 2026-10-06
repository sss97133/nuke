// Run: deno test supabase/functions/poll-listing-feeds/ledger.test.ts
// A listing is ledgered `complete` only when the vehicle row holds a price, an image or a description; otherwise
// `failed` with the extractor's reason, and a failed URL is retried on a schedule. The cases in
// fixtures/ingest-outcomes.json are the classiccars, hagerty, cars-and-bids and mecum husks measured 2026-10-06, and
// the rows that really are complete.
import fixture from "./fixtures/ingest-outcomes.json" with { type: "json" };
import {
  DEFAULT_MAX_ATTEMPTS,
  failureCategoryFor,
  HUSK_RELABEL_CATEGORY,
  landedFields,
  ledgerDecision,
  ledgerWriteFor,
  nextAttemptAfter,
  NO_DATA_MESSAGE,
  planIngests,
  readbackFor,
  readLandedBatch,
  type IngestOutcome,
  type LandedBatch,
  type LedgerKnown,
  type VehicleLandedRow,
} from "./ledger.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const NOW = new Date("2026-10-06T12:00:00.000Z");
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

const HUSK = fixture.husk as VehicleLandedRow;

const batchOf = (ingest: IngestOutcome, row: VehicleLandedRow | null): LandedBatch =>
  row === null || !ingest.vehicle_id
    ? { rows: new Map(), error: "canceling statement due to statement timeout" }
    : { rows: new Map([[ingest.vehicle_id, { ...row, id: ingest.vehicle_id }]]), error: null };

const write = (ingest: IngestOutcome, row: VehicleLandedRow | null, prev?: LedgerKnown) =>
  ledgerWriteFor({ url: "https://example.test/listing/1", feedId: "feed-1", ingest, batch: batchOf(ingest, row), prev, now: NOW });

// ── the ledger status, case by case ─────────────────────────────────────────

type Case = {
  name: string;
  ingest: IngestOutcome;
  vehicle: "husk" | VehicleLandedRow | null;
  expect: { status: string | null; failure_category?: string; error_message_includes?: string };
};

for (const c of fixture.cases as Case[]) {
  Deno.test(c.name, () => {
    const row = c.vehicle === "husk" ? HUSK : c.vehicle;
    const w = write(c.ingest, row);
    equal(w?.status ?? null, c.expect.status);
    if (w?.status === "failed") {
      const message = String(w.row.error_message);
      assert(message.length > 0 && message.length <= 500, "a failed row carries its reason within the column budget");
      if (c.expect.failure_category) equal(w.row.failure_category, c.expect.failure_category);
      if (c.expect.error_message_includes) {
        assert(message.includes(c.expect.error_message_includes), `reason names "${c.expect.error_message_includes}"`);
      }
    }
  });
}

Deno.test("a failed row carries the extractor's own error as its reason", () => {
  const withError = (fixture.cases as Case[]).find((c) => c.ingest.enrichment_error && c.vehicle === "husk")!;
  const w = write(withError.ingest, HUSK);
  equal(w?.row.error_message, withError.ingest.enrichment_error);
});

Deno.test("with no extractor error the reason is the generic one", () => {
  const w = write({ status: "created", vehicle_id: "v1" }, HUSK);
  equal(w?.row.error_message, NO_DATA_MESSAGE);
  equal(w?.row.failure_category, "extraction_failed");
});

Deno.test("a complete row clears any earlier error and retry time; a skipped row leaves them alone", () => {
  const complete = write({ status: "created", vehicle_id: "v1" }, { description: "Runs and drives." });
  equal(complete?.status, "complete");
  equal(complete?.row.error_message, null);
  equal(complete?.row.failure_category, null);
  equal(complete?.row.next_attempt_at, null);
  const skipped = write({ status: "rejected", reason: "not_a_vehicle: a watch" }, null);
  equal(skipped?.status, "skipped");
  assert(!("error_message" in skipped!.row) && !("attempts" in skipped!.row), "a structural skip writes no error or attempts");
});

Deno.test("the poller ledgers nothing for an ingest error or a non-structural rejection", () => {
  equal(write({ status: "error", error: "ingest HTTP 502" }, null), null);
  equal(write({ status: "rejected", reason: "insufficient identity: year=? make=? model=?" }, null), null);
});

Deno.test("landedFields reports which of price, images and description the row holds", () => {
  equal(landedFields(HUSK), { price: false, images: false, description: false });
  equal(landedFields({ ...HUSK, high_bid: 12000 }), { price: true, images: false, description: false });
  equal(landedFields({ ...HUSK, sold_price: 31000, image_count: 3 }), { price: true, images: true, description: false });
  equal(landedFields({ ...HUSK, description: "Runs and drives." }), { price: false, images: false, description: true });
  equal(landedFields(null), null);
  equal(landedFields(undefined), null);
});

// ── 2. the read-back: one query per batch, and an error is never complete ──────

function fakeSupabase(result: { data?: unknown; error?: { message: string } | null; throws?: string }) {
  const calls: Array<{ table: string; column: string; ids: string[]; columns: string }> = [];
  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          return {
            in(column: string, ids: string[]) {
              calls.push({ table, column, ids, columns });
              if (result.throws) return Promise.reject(new Error(result.throws));
              return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

Deno.test("the read-back is one IN query for the whole batch", async () => {
  const ids = Array.from({ length: 20 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  const { client, calls } = fakeSupabase({ data: ids.map((id) => ({ ...HUSK, id })) });
  const batch = await readLandedBatch(client, ids);
  equal(calls.length, 1);
  equal(calls[0].table, "vehicles");
  equal(calls[0].column, "id");
  equal(calls[0].ids.length, 20);
  assert(calls[0].columns.startsWith("id,"), "the select carries the id that keys the map");
  equal(batch.error, null);
  equal(batch.rows.size, 20);
});

Deno.test("an empty batch asks nothing", async () => {
  const { client, calls } = fakeSupabase({ data: [] });
  const batch = await readLandedBatch(client, []);
  equal(calls.length, 0);
  equal(batch.error, null);
});

Deno.test("a read-back that fails, or throws, comes back as an error and never as an empty row", async () => {
  const failed = await readLandedBatch(fakeSupabase({ error: { message: "canceling statement due to statement timeout" } }).client, ["v1"]);
  equal(failed.error, "canceling statement due to statement timeout");
  const thrown = await readLandedBatch(fakeSupabase({ throws: "fetch failed" }).client, ["v1"]);
  equal(thrown.error, "fetch failed");
});

Deno.test("readbackFor names why it is unknown: no id, a failed query, or a row that is not there", () => {
  const ok: LandedBatch = { rows: new Map([["v1", { id: "v1", ...HUSK }]]), error: null };
  equal(readbackFor("v1", ok).kind, "row");
  equal(readbackFor(null, ok).kind, "error");
  equal(readbackFor("v2", ok).kind, "error");
  equal(readbackFor("v1", { rows: new Map(), error: "boom" }).kind, "error");
});

Deno.test("a husk whose read-back failed is failed as readback_error, not complete", () => {
  const ingest = { status: "created", vehicle_id: "v1" };
  const w = ledgerWriteFor({ url: "u", feedId: "f", ingest, batch: { rows: new Map(), error: "boom" }, now: NOW });
  equal(w?.status, "failed");
  equal(w?.row.failure_category, "readback_error");
  assert(String(w?.row.error_message).includes("boom"), "the reason names the read error");
});

Deno.test("a vehicle missing from an otherwise good read-back is also readback_error", () => {
  const w = ledgerWriteFor({
    url: "u", feedId: "f", ingest: { status: "matched", vehicle_id: "gone" },
    batch: { rows: new Map([["other", { id: "other", ...HUSK }]]), error: null }, now: NOW,
  });
  equal(w?.status, "failed");
  equal(w?.row.failure_category, "readback_error");
});

// ── 3. failure categories read the status where a status is written ────────────

Deno.test("failureCategoryFor maps the extractors' wording onto process-import-queue's vocabulary, plus billing", () => {
  const table: Array<[string, string]> = [
    ["extract-cars-and-bids-core: Signal timed out.", "timeout"],
    ["extract-hagerty-listing HTTP 500: Fetch failed: Blocked by site", "blocked"],
    ["extract-vehicle-data-ai HTTP 403: Forbidden", "blocked"],
    ["extract-vehicle-data-ai HTTP 429: slow down", "rate_limited"],
    ["extract-vehicle-data-ai HTTP 503: Service Unavailable", "rate_limited"],
    ["extract-vehicle-data-ai HTTP 504: Gateway Timeout", "timeout"],
    ["Firecrawl HTTP 402: Payment Required", "billing"],
    ["browser has been closed", "browser_crash"],
    ["extract-vehicle-data-ai returned no identity fields (year/make/vin)", "extraction_failed"],
    ["Failed to parse LLM response", "extraction_failed"],
    ["extract-cars-and-bids-core HTTP 422: Could not extract vehicle identity", "extraction_failed"],
  ];
  for (const [message, category] of table) equal([message, failureCategoryFor(message)], [message, category]);
});

Deno.test("no credits remaining is billing, whatever status the provider put on it", () => {
  const openai =
    'extract-vehicle-data-ai HTTP 500: {"success":false,"error":"OpenAI API error: 429 - {\\n "error": {\\n "message": "You have no credits remaining. Add credits to continue using the API';
  equal(failureCategoryFor(openai), "billing");
  equal(failureCategoryFor("OpenAI API error: 429 - insufficient_quota"), "billing");
  equal(failureCategoryFor("OpenAI API error: 429 - Rate limit reached for requests"), "rate_limited");
});

Deno.test("a number that is not an HTTP status never sets the category", () => {
  const messages = [
    "extract-vehicle-data-ai returned no identity fields for https://www.mecum.com/lots/1182504/1970-chevrolet-chevelle",
    "no identity fields for https://classiccars.com/listings/view/2114029/1966-ford-mustang-for-sale",
    "could not find the price $429,000 on the page",
    "listing 4031 of 5039 had no description",
    "lot 1182403 returned an empty page",
    "https://www.barrett-jackson.com/2026-las-vegas/docket/vehicle/1958-chevrolet-3100-pickup-302621 had nothing",
  ];
  for (const m of messages) equal([m, failureCategoryFor(m)], [m, "extraction_failed"]);
});

Deno.test("the category comes from the full message, then the message is cut to 500 characters", () => {
  const ingest = {
    status: "created",
    vehicle_id: "v1",
    enrichment_error: `extract-vehicle-data-ai HTTP 500: ${"x".repeat(600)} You have no credits remaining`,
  };
  const w = write(ingest, HUSK);
  equal(w?.row.failure_category, "billing");
  equal(String(w?.row.error_message).length, 500);
  assert(!String(w?.row.error_message).includes("no credits remaining"), "the phrase sits past the cut, as the test intends");
});

// ── 1. failed rows are retried on a schedule and end at max_attempts ───────────

Deno.test("backoff: a short wait for rate limits, timeouts and read errors, a day for the rest, none for billing", () => {
  equal(nextAttemptAfter("rate_limited", 1, 3, NOW), iso(1 * HOUR));
  equal(nextAttemptAfter("rate_limited", 2, 3, NOW), iso(2 * HOUR));
  equal(nextAttemptAfter("timeout", 1, 3, NOW), iso(1 * HOUR));
  equal(nextAttemptAfter("readback_error", 1, 3, NOW), iso(1 * HOUR));
  equal(nextAttemptAfter("blocked", 1, 3, NOW), iso(24 * HOUR));
  equal(nextAttemptAfter("extraction_failed", 2, 3, NOW), iso(24 * HOUR));
  equal(nextAttemptAfter(HUSK_RELABEL_CATEGORY, 1, 3, NOW), iso(24 * HOUR));
  equal(nextAttemptAfter("something_new", 1, 3, NOW), iso(24 * HOUR));
  equal(nextAttemptAfter("billing", 1, 3, NOW), null);
});

Deno.test("a husk relabelled by the migration is retried like extraction_failed", () => {
  equal(nextAttemptAfter(HUSK_RELABEL_CATEGORY, 1, 3, NOW), nextAttemptAfter("extraction_failed", 1, 3, NOW));
});

Deno.test("the row is final once attempts reach max_attempts", () => {
  equal(nextAttemptAfter("timeout", 3, 3, NOW), null);
  equal(nextAttemptAfter("blocked", 3, 3, NOW), null);
  equal(nextAttemptAfter("blocked", 4, 5, NOW), iso(24 * HOUR));
});

Deno.test("each failure adds one attempt and sets the next try; the third ends it", () => {
  const ingest = { status: "created", vehicle_id: "v1", enrichment_error: "extract-cars-and-bids-core: Signal timed out." };
  const first = write(ingest, HUSK);
  equal([first?.row.attempts, first?.row.next_attempt_at, first?.row.failure_category], [1, iso(1 * HOUR), "timeout"]);
  const second = write(ingest, HUSK, { status: "failed", attempts: 1, max_attempts: 3 });
  equal([second?.row.attempts, second?.row.next_attempt_at], [2, iso(2 * HOUR)]);
  const third = write(ingest, HUSK, { status: "failed", attempts: 2, max_attempts: 3 });
  equal([third?.row.attempts, third?.row.next_attempt_at], [3, null]);
  assert(typeof first?.row.last_attempt_at === "string", "last_attempt_at is set");
});

Deno.test("billing is final at once: attempts jump to max_attempts and there is no next try", () => {
  const w = write({ status: "created", vehicle_id: "v1", enrichment_error: "OpenAI API error: 429 - You have no credits remaining" }, HUSK);
  equal([w?.row.failure_category, w?.row.attempts, w?.row.next_attempt_at], ["billing", DEFAULT_MAX_ATTEMPTS, null]);
  const custom = write({ status: "created", vehicle_id: "v1", enrichment_error: "no credits remaining" }, HUSK, { status: "failed", attempts: 0, max_attempts: 5 });
  equal([custom?.row.attempts, custom?.row.next_attempt_at], [5, null]);
});

Deno.test("what the ledger says about a URL: settled, final, backing off, or due", () => {
  equal(ledgerDecision(undefined, NOW), "none");
  equal(ledgerDecision({ status: "complete" }, NOW), "settled");
  equal(ledgerDecision({ status: "skipped" }, NOW), "settled");
  equal(ledgerDecision({ status: "pending" }, NOW), "none");
  equal(ledgerDecision({ status: "failed", attempts: 3, max_attempts: 3, next_attempt_at: null }, NOW), "settled");
  equal(ledgerDecision({ status: "failed", attempts: 1, max_attempts: 3, next_attempt_at: iso(HOUR) }, NOW), "backoff");
  equal(ledgerDecision({ status: "failed", attempts: 1, max_attempts: 3, next_attempt_at: iso(-HOUR) }, NOW), "retry");
  equal(ledgerDecision({ status: "failed", attempts: 0, next_attempt_at: null }, NOW), "retry");
  equal(ledgerDecision({ status: "failed", attempts: 4, max_attempts: 5, next_attempt_at: null }, NOW), "retry");
  equal(ledgerDecision({ status: "failed", attempts: 7, max_attempts: null }, NOW), "settled");
});

Deno.test("a failed URL is recorded once: the next poll leaves it alone until it is due", () => {
  const url = "https://classiccars.com/listings/view/0000001/1970-chevrolet-chevelle-for-sale-in-anytown-xx-00000";
  const ingest = { status: "created", vehicle_id: "v1", enrichment_error: "extract-vehicle-data-ai HTTP 500: OpenAI API error: 429 - rate limit reached" };
  const w = ledgerWriteFor({ url, feedId: "f", ingest, batch: batchOf(ingest, HUSK), now: NOW })!;
  equal(w.status, "failed");
  const ledger = new Map<string, LedgerKnown>([[url, w.row as unknown as LedgerKnown]]);
  const onVehicles = new Set([url]);
  // an hour later the retry is due
  equal(planIngests([url], onVehicles, ledger, new Date(NOW.getTime() + 30 * 60_000), 20).toIngest, []);
  equal(planIngests([url], onVehicles, ledger, new Date(NOW.getTime() + 61 * 60_000), 20).toIngest, [url]);
});

Deno.test("planIngests: a ledger row decides before vehicles.listing_url, so a husk already on vehicles is retried", () => {
  const due: LedgerKnown = { status: "failed", attempts: 1, max_attempts: 3, next_attempt_at: iso(-HOUR) };
  const plan = planIngests(["husk", "known", "new"], new Set(["husk", "known"]), new Map([["husk", due]]), NOW, 20);
  equal(plan.toIngest, ["new", "husk"]);
  equal([plan.fresh, plan.retries, plan.settled, plan.backoff], [1, 1, 1, 0]);
});

Deno.test("planIngests: a backing-off URL spends none of the cap", () => {
  const backoff: LedgerKnown = { status: "failed", attempts: 1, max_attempts: 3, next_attempt_at: iso(HOUR) };
  const plan = planIngests(["a", "waiting", "b", "c"], new Set(), new Map([["waiting", backoff]]), NOW, 2);
  equal(plan.toIngest, ["a", "b"]);
  equal([plan.backoff, plan.settled], [1, 0]);
});

Deno.test("planIngests: a due retry never takes a slot from a new listing, and fills what is left", () => {
  const due: LedgerKnown = { status: "failed", attempts: 1, max_attempts: 3, next_attempt_at: null };
  const ledger = new Map([["retry", due]]);
  equal(planIngests(["retry", "n1", "n2"], new Set(), ledger, NOW, 2).toIngest, ["n1", "n2"]);
  equal(planIngests(["retry", "n1"], new Set(), ledger, NOW, 2).toIngest, ["n1", "retry"]);
});

Deno.test("planIngests: complete, skipped and final failed rows are settled", () => {
  const ledger = new Map<string, LedgerKnown>([
    ["c", { status: "complete" }],
    ["s", { status: "skipped" }],
    ["f", { status: "failed", attempts: 3, max_attempts: 3, next_attempt_at: null }],
  ]);
  const plan = planIngests(["c", "s", "f", "n"], new Set(), ledger, NOW, 20);
  equal(plan.toIngest, ["n"]);
  equal(plan.settled, 3);
});

// ── a slug-trusted venue whose extractor failed: ingest rejects, the poller records it once ──

const rejection = (error: string): IngestOutcome => ({
  status: "rejected",
  reason: `enrichment_failed: ${error}`,
  enrichment_error: error,
});

const REJECTED_URL = "https://www.hagerty.com/marketplace/auction/1965-Ford-Mustang/00000000-0000-4000-8000-0000000000aa";

const writeRejection = (error: string, prev?: LedgerKnown, batch: LandedBatch = { rows: new Map(), error: null }) =>
  ledgerWriteFor({ url: REJECTED_URL, feedId: "feed-1", ingest: rejection(error), batch, prev, now: NOW });

Deno.test("an enrichment_failed rejection is ledgered failed, with no vehicle, the extractor's error and its category", () => {
  const blocked = writeRejection("extract-hagerty-listing HTTP 500: Fetch failed: Blocked by site");
  equal(blocked?.status, "failed");
  equal(blocked?.row.vehicle_id, null);
  equal(blocked?.row.failure_category, "blocked");
  assert(String(blocked?.row.error_message).startsWith("enrichment_failed: extract-hagerty-listing"), "the reason keeps its prefix and the error");
  equal([blocked?.row.attempts, blocked?.row.next_attempt_at], [1, iso(24 * HOUR)]);
  const slow = writeRejection("extract-cars-and-bids-core: Signal timed out.");
  equal([slow?.row.failure_category, slow?.row.attempts, slow?.row.next_attempt_at], ["timeout", 1, iso(1 * HOUR)]);
  const billing = writeRejection("extract-vehicle-data-ai HTTP 500: OpenAI API error: 429 - You have no credits remaining");
  equal([billing?.row.failure_category, billing?.row.attempts, billing?.row.next_attempt_at], ["billing", DEFAULT_MAX_ATTEMPTS, null]);
});

Deno.test("a rejection needs no read-back: a failed batch does not turn it into readback_error", () => {
  const w = writeRejection("extract-hagerty-listing HTTP 500: Fetch failed: Blocked by site", undefined, { rows: new Map(), error: "boom" });
  equal(w?.row.failure_category, "blocked");
});

Deno.test("a rejection is never skipped, even when the extractor's text holds a structural word", () => {
  const w = writeRejection("extract-vehicle-data-ai: this page is not a vehicle listing");
  equal(w?.status, "failed");
  equal(w?.row.failure_category, "extraction_failed");
});

Deno.test("a rejection that is not enrichment_failed still follows the old rule: structural is skipped, the rest is not ledgered", () => {
  equal(ledgerWriteFor({ url: "u", feedId: "f", ingest: { status: "rejected", reason: "implausible year: 1801" }, batch: { rows: new Map(), error: null }, now: NOW })?.status, "skipped");
  equal(ledgerWriteFor({ url: "u", feedId: "f", ingest: { status: "rejected", reason: "insufficient identity: year=? make=? model=?" }, batch: { rows: new Map(), error: null }, now: NOW }), null);
});

Deno.test("the rejection is recorded once: later polls skip the URL until it is due, and a final one never returns", () => {
  const first = writeRejection("extract-hagerty-listing HTTP 500: Fetch failed: Blocked by site")!;
  const ledger = new Map<string, LedgerKnown>([[REJECTED_URL, first.row as unknown as LedgerKnown]]);
  const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
  // a day-long backoff: not at 1 h, not at 23 h, due at 25 h, and the cap is untouched meanwhile
  equal(planIngests([REJECTED_URL, "new"], new Set(), ledger, at(60), 1).toIngest, ["new"]);
  equal(planIngests([REJECTED_URL], new Set(), ledger, at(23 * 60), 20).toIngest, []);
  equal(planIngests([REJECTED_URL], new Set(), ledger, at(25 * 60), 20).toIngest, [REJECTED_URL]);
  // the third rejection is final
  const third = writeRejection("extract-hagerty-listing HTTP 500: Fetch failed: Blocked by site", { status: "failed", attempts: 2, max_attempts: 3 })!;
  equal(planIngests([REJECTED_URL], new Set(), new Map([[REJECTED_URL, third.row as unknown as LedgerKnown]]), at(30 * 24 * 60), 20).toIngest, []);
});
