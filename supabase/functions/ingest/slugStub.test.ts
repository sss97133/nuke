// Run: deno test supabase/functions/ingest/slugStub.test.ts
// The decision that stops `ingest` writing a vehicle from a URL slug when the page extractor failed.
import { SLUG_STUB_BLOCKED, slugStubRejection } from "./slugStub.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const FAILED = {
  identityIsSlugGuess: true,
  enrichmentSucceeded: false,
  enrichmentError: "extract-vehicle-data-ai HTTP 500: OpenAI API error: 429 - You have no credits remaining",
};

const TEN = [
  "classiccars", "mecum", "barrett_jackson", "hagerty", "cars_and_bids",
  "pcarmarket", "vanguard_motors", "allcollectorcars", "autohunter", "carandclassic",
];

Deno.test("the set is exactly the ten venues registered for slug trust", () => {
  equal([...SLUG_STUB_BLOCKED].sort(), [...TEN].sort());
});

for (const platform of TEN) {
  Deno.test(`${platform}: a failed extractor on a slug-only identity is a rejection that carries the error`, () => {
    const r = slugStubRejection({ platform, ...FAILED });
    equal(r, { reason: `enrichment_failed: ${FAILED.enrichmentError}`, enrichment_error: FAILED.enrichmentError });
  });
}

Deno.test("a successful extraction goes on to create the vehicle", () => {
  equal(slugStubRejection({ platform: "classiccars", ...FAILED, enrichmentSucceeded: true, enrichmentError: null }), null);
});

Deno.test("no extractor ran (enrich false, or a description supplied): nothing failed, so nothing is rejected", () => {
  equal(slugStubRejection({ platform: "classiccars", ...FAILED, enrichmentError: null }), null);
});

Deno.test("an identity the caller supplied is the caller's word, not a slug guess", () => {
  equal(slugStubRejection({ platform: "mecum", ...FAILED, identityIsSlugGuess: false }), null);
});

Deno.test("BaT, Craigslist, eBay, Facebook and unrecognised URLs are not in the set", () => {
  for (const platform of ["bring_a_trailer", "craigslist", "ebay_motors", "facebook_marketplace", "facebook-saved", "unknown", "manual"]) {
    equal([platform, slugStubRejection({ platform, ...FAILED })], [platform, null]);
  }
});
