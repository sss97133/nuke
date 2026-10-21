/**
 * Regression: Cars & Bids JS shell must not invent a cabriolet cohort valuation.
 * Run: deno test --allow-read supabase/functions/mcp-connector/advisor/evaluate_listing_regression_test.ts
 */
import { parseListingHtml } from "./listing_fetch.ts";
import { detectVariant, identityFromListingUrl, isVariantMismatch } from "./variants.ts";

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const CB_URL =
  "https://carsandbids.com/auctions/KD60OD28/1995-porsche-911-turbo-coupe";

Deno.test("C&B JS shell: URL slug yields 1995 Porsche 911 Turbo identity", () => {
  // Minimal JS shell — no og:title, no body content (what evaluate_listing saw live).
  const html = `<!DOCTYPE html><html><head><title></title></head><body><div id="app"></div></body></html>`;
  const L = parseListingHtml(CB_URL, html, 200);
  assert(L.year === 1995, `year=${L.year}`);
  assert(L.make === "Porsche", `make=${L.make}`);
  assert(/911/i.test(L.model || ""), `model=${L.model}`);
  assert(/turbo/i.test(L.model || ""), `turbo in model=${L.model}`);
  assert(detectVariant(`${L.title} ${L.model} ${L.url}`) === "turbo", "variant turbo");
  assert(!isVariantMismatch("turbo", "turbo"), "keep turbo comps");
  assert(isVariantMismatch("turbo", "base"), "exclude carrera/base");
});

Deno.test("C&B auction id extracted for matched-asset lookup", () => {
  const id = identityFromListingUrl(CB_URL);
  assert(id.auction_id === "KD60OD28", id.auction_id || "");
});

Deno.test("993 generation alone is not a conversion signal in URL identity", () => {
  const id = identityFromListingUrl(
    "https://carsandbids.com/auctions/KD60OD28/1995-porsche-911-turbo-coupe",
  );
  // Model from slug should be Turbo coupe, not a 993-body conversion project.
  assert(!/conversion/i.test(id.model || ""), id.model || "");
  assert(/turbo/i.test(id.model || ""), id.model || "");
});
