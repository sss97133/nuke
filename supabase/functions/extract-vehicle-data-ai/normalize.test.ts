// Run: deno test --allow-read=supabase/functions/extract-craigslist/fixtures supabase/functions/extract-vehicle-data-ai/normalize.test.ts
// normalizeExtractedData is the funnel every dedicated extractor's answer passes through on its way to ingest.
// A Craigslist capture must come out the other side; every other source must come out exactly as before.
import { normalizeExtractedData } from "./normalize.ts";
import { extractFromHtml } from "../extract-craigslist/extract.ts";

function equal(actual: unknown, expected: unknown, note = "") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${note} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
const page = (name: string) => Deno.readTextFileSync(new URL(`../extract-craigslist/fixtures/${name}`, import.meta.url));
const URL1 = "https://www.craigslist.org/view/d/sample-vehicle/FixtureToken000001";

// the keys this function returned before it learned to carry a capture
const LEGACY_KEYS = [
  "vin", "year", "make", "model", "series", "trim", "mileage", "price", "asking_price", "sold_price", "sold_date", "color",
  "exterior_color", "interior_color", "transmission", "drivetrain", "engine", "engine_size", "body_style", "body_type",
  "title_status", "description", "images", "image_urls", "location", "seller", "seller_phone", "seller_email",
  "listing_title", "listing_url", "confidence",
];

// what ingest receives is the extractor's JSON, so the test sends it through JSON too
const viaHttp = (x: unknown) => JSON.parse(JSON.stringify(x));

Deno.test("a Craigslist listing keeps its VIN and mileage through the funnel", () => {
  const out = normalizeExtractedData(viaHttp(extractFromHtml(page("classic-vin-manual-truck.html"), URL1)), URL1);
  equal([out.vin, out.mileage, out.title_status, out.transmission, out.year], ["CKY145Z123456", 96213, "clean", "manual", 1975]);
});

Deno.test("a Craigslist capture comes out of the funnel whole: attributes, post id and both clocks", () => {
  const extracted = viaHttp(extractFromHtml(page("modern-vin-17-full-block.html"), URL1));
  const out = normalizeExtractedData(extracted, URL1);
  equal(out.post_id, "7000000002");
  equal([out.posted_at, out.updated_at], ["2026-01-02T11:04:05.000Z", "2026-01-03T12:05:06.000Z"]);
  equal(out.attributes, extracted.attributes);
  equal([out.attributes.vin, out.attributes.condition, out.attributes.fuel], ["1B7KF23D3WJ123456", "like new", "diesel"]);
});

Deno.test("a Craigslist answer is the legacy keys plus the four capture keys, nothing else", () => {
  const out = normalizeExtractedData(viaHttp(extractFromHtml(page("classic-vin-manual-truck.html"), URL1)), URL1);
  equal(Object.keys(out), [...LEGACY_KEYS, "post_id", "posted_at", "updated_at", "attributes"]);
});

Deno.test("any other source comes out exactly as before: same keys, no capture", () => {
  const out = normalizeExtractedData({ vin: "WP0AB0916JS120000", year: 1988, make: "Porsche", model: "911", mileage: "45,000", price: "$85,000" }, "https://example.invalid/lot/1");
  equal(Object.keys(out), LEGACY_KEYS);
  equal([out.vin, out.year, out.mileage, out.price], ["WP0AB0916JS120000", 1988, 45000, 85000]);
});

Deno.test("another source's own posted_at is not mistaken for a capture", () => {
  const out = normalizeExtractedData({ year: 1988, make: "Porsche", posted_at: "2026-10-01T00:00:00Z", post_id: "123456789" }, "https://example.invalid/lot/1");
  equal(Object.keys(out), LEGACY_KEYS);
});

Deno.test("a malformed capture is dropped rather than carried", () => {
  const out = normalizeExtractedData({ year: 1975, make: "Chevy", attributes: { vin: "X" }, post_id: "7000000001" }, URL1);
  equal(Object.keys(out), LEGACY_KEYS);
});
