// deno test --allow-read supabase/functions/mcp-connector/advisor/variants_test.ts
import {
  canonicalListingUrl,
  cleanListingUrl,
  detectVariant,
  identityFromListingUrl,
  isLikelyPartsSale,
  isVariantMismatch,
  recentSaleSanityGuard,
  scoreSimilarity,
} from "./variants.ts";

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

Deno.test("detectVariant and mismatch: Turbo subject keeps Turbo comps", () => {
  assert(detectVariant("1995 Porsche 911 Turbo Coupe") === "turbo", "subject turbo");
  assert(detectVariant("1995 Porsche 911 Carrera") === "base", "carrera base");
  assert(isVariantMismatch("turbo", "base"), "drop base from turbo subject");
  assert(!isVariantMismatch("turbo", "turbo"), "keep turbo");
  assert(isVariantMismatch("base", "turbo"), "drop turbo from base subject");
  assert(detectVariant("Gunther Werks 993") === "gunther_werks", "gunther");
});

Deno.test("canonical URL dedupes trailing slash and quotes", () => {
  const a = canonicalListingUrl("https://bringatrailer.com/listing/1995-porsche-911-11/");
  const b = canonicalListingUrl("https://bringatrailer.com/listing/1995-porsche-911-11");
  assert(a === b, `${a} vs ${b}`);
  assert(
    cleanListingUrl('"James Edition Title"https://www.jamesedition.com/foo') ===
      "https://www.jamesedition.com/foo",
    "strip glued title",
  );
});

Deno.test("parts sale flag for implausibly low 911", () => {
  const hit = isLikelyPartsSale({
    title: "1995 Porsche 911",
    url: "https://bringatrailer.com/listing/1995-porsche-911-11",
    sale_price: 4000,
    year: 1995,
  });
  assert(hit.parts, hit.reason || "expected parts");
});

Deno.test("URL slug identity for JS-rendered C&B pages", () => {
  const id = identityFromListingUrl(
    "https://carsandbids.com/auctions/KD60OD28/1995-porsche-911-turbo-coupe",
  );
  assert(id.year === 1995, `year=${id.year}`);
  assert(id.make === "Porsche", `make=${id.make}`);
  assert(/911/i.test(id.model || "") && /turbo/i.test(id.model || ""), `model=${id.model}`);
  assert(id.auction_id === "KD60OD28", `auction=${id.auction_id}`);
});

Deno.test("similarity is not a constant 0.5", () => {
  const a = scoreSimilarity({
    subject: { year: 1995, variant: "turbo", model: "911 Turbo" },
    candidate: { year: 1995, variant: "turbo", model: "911 Turbo" },
  });
  const b = scoreSimilarity({
    subject: { year: 1995, variant: "turbo", model: "911 Turbo" },
    candidate: { year: 1987, variant: "base", model: "911 Cabriolet" },
  });
  assert(a > 0.6, `close=${a}`);
  assert(b < a, `far=${b} vs close=${a}`);
  assert(a !== 0.5 && b !== 0.5, "not constant");
});

Deno.test("3x recent-sale sanity guard", () => {
  const g = recentSaleSanityGuard({
    estimate: 61000,
    saleAmount: 188000,
    saleOn: new Date(Date.now() - 4 * 86_400_000).toISOString().slice(0, 10),
  });
  assert(g.triggered, "should trigger");
  assert(g.message != null && /3×/.test(g.message), g.message || "");
});
