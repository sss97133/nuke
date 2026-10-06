// Run: deno test supabase/functions/poll-listing-feeds/ledger.test.ts
// A listing is ledgered `complete` only when the vehicle row holds a price, an image or a description; otherwise
// `failed` with the extractor's reason. The cases are in fixtures/ingest-outcomes.json: the classiccars, hagerty,
// cars-and-bids and mecum husks measured 2026-10-06, and the rows that really are complete.
import fixture from "./fixtures/ingest-outcomes.json" with { type: "json" };
import {
  failureCategoryFor,
  landedFields,
  ledgerOutcomeForIngest,
  NO_DATA_MESSAGE,
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

const HUSK = fixture.husk as VehicleLandedRow;

type Case = {
  name: string;
  ingest: { status?: string; vehicle_id?: string | null; enrichment_error?: string | null };
  vehicle: "husk" | VehicleLandedRow | null;
  expect: { status: string | null; failure_category?: string; error_message_includes?: string };
};

for (const c of fixture.cases as Case[]) {
  Deno.test(c.name, () => {
    const row = c.vehicle === "husk" ? HUSK : c.vehicle;
    const outcome = ledgerOutcomeForIngest(c.ingest, row);
    equal(outcome?.status ?? null, c.expect.status);
    if (outcome?.status === "failed") {
      assert(outcome.error_message.length > 0, "a failed row carries its reason");
      assert(outcome.error_message.length <= 500, "the reason fits the column budget");
      if (c.expect.failure_category) equal(outcome.failure_category, c.expect.failure_category);
      if (c.expect.error_message_includes) {
        assert(outcome.error_message.includes(c.expect.error_message_includes), `reason names "${c.expect.error_message_includes}"`);
      }
    }
  });
}

Deno.test("a failed row carries the extractor's own error as its reason", () => {
  const withError = (fixture.cases as Case[]).find((c) => c.ingest.enrichment_error && c.vehicle === "husk")!;
  const outcome = ledgerOutcomeForIngest(withError.ingest, HUSK);
  assert(outcome?.status === "failed", "failed");
  if (outcome?.status === "failed") equal(outcome.error_message, withError.ingest.enrichment_error);
});

Deno.test("with no extractor error the reason is the generic one", () => {
  const outcome = ledgerOutcomeForIngest({ status: "created", vehicle_id: "x" }, HUSK);
  if (outcome?.status !== "failed") throw new Error("expected failed");
  equal(outcome.error_message, NO_DATA_MESSAGE);
});

Deno.test("an over-long extractor error is cut to 500 characters", () => {
  const outcome = ledgerOutcomeForIngest({ status: "created", enrichment_error: "x".repeat(4000) }, HUSK);
  if (outcome?.status !== "failed") throw new Error("expected failed");
  equal(outcome.error_message.length, 500);
});

Deno.test("landedFields reports which of price, images and description the row holds", () => {
  equal(landedFields(HUSK), { price: false, images: false, description: false });
  equal(landedFields({ ...HUSK, high_bid: 12000 }), { price: true, images: false, description: false });
  equal(landedFields({ ...HUSK, sold_price: 31000, image_count: 3 }), { price: true, images: true, description: false });
  equal(landedFields({ ...HUSK, description: "Runs and drives." }), { price: false, images: false, description: true });
  equal(landedFields(null), null);
  equal(landedFields(undefined), null);
});

Deno.test("failureCategoryFor maps the extractors' wording onto process-import-queue's vocabulary", () => {
  equal(failureCategoryFor("extract-cars-and-bids-core: Signal timed out."), "timeout");
  equal(failureCategoryFor("extract-hagerty-listing HTTP 500: Fetch failed: Blocked by site"), "blocked");
  equal(failureCategoryFor("OpenAI API error: 429 - You have no credits remaining"), "rate_limited");
  equal(failureCategoryFor("extract-vehicle-data-ai HTTP 403: Forbidden"), "blocked");
  equal(failureCategoryFor("browser has been closed"), "browser_crash");
  equal(failureCategoryFor("extract-vehicle-data-ai returned no identity fields (year/make/vin)"), "extraction_failed");
  equal(failureCategoryFor("Failed to parse LLM response"), "extraction_failed");
});
