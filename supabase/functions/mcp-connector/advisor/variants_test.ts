// deno test --allow-read supabase/functions/mcp-connector/advisor/variants_test.ts
import {
  canonicalListingUrl,
  cleanListingUrl,
  detectGeneration,
  detectTurboDisplacement,
  detectVariant,
  identityFromListingUrl,
  isGenerationMismatch,
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

Deno.test("911 generation: 993 Turbo subject drops 964 Turbo 3.6 comps", () => {
  const subject = { make: "Porsche", model: "911 Turbo", year: 1995, text: "https://carsandbids.com/auctions/KD60OD28/1995-porsche-911-turbo-coupe" };
  assert(detectGeneration(subject) === "993", "1995 turbo is 993");
  const c964 = { make: "Porsche", model: "911 Turbo 3.6", year: 1994, text: "1994 Porsche 964 Turbo 3.6" };
  assert(detectGeneration(c964) === "964", "964 turbo 3.6");
  assert(isGenerationMismatch(subject, c964), "993 vs 964 mismatch");
  const c993 = { make: "Porsche", model: "911 Turbo", year: 1997, text: "https://bringatrailer.com/listing/1997-porsche-911-turbo-12/" };
  assert(!isGenerationMismatch(subject, c993), "993 vs 993 keep");
  // Explicit code beats year: a 1995 listing text that says 964 is a 964.
  assert(detectGeneration({ make: "Porsche", model: "911", year: 1995, text: "964 Carrera RS" }) === "964", "text code wins");
});

Deno.test("911 generation: 930 vs 964 Turbo, 3.3 vs 3.6 Turbo, and overlap years", () => {
  assert(detectGeneration({ make: "Porsche", model: "911 Turbo", year: 1987 }) === "930", "930");
  assert(detectGeneration({ make: "Porsche", model: "911 Turbo", year: 1991 }) === "964", "964 turbo 3.3 era");
  assert(isGenerationMismatch({ make: "Porsche", model: "911 Turbo", year: 1987 }, { make: "Porsche", model: "911 Turbo", year: 1992 }), "930 vs 964");
  assert(detectTurboDisplacement("1994 Porsche 911 Turbo 3.6") === "3.6", "3.6");
  assert(isGenerationMismatch(
    { make: "Porsche", model: "911 Turbo 3.3", year: 1992 },
    { make: "Porsche", model: "911 Turbo 3.6", year: 1994 },
  ), "3.3 vs 3.6 mismatch");
  // Changeover years without a code are unknown and never exclude.
  assert(detectGeneration({ make: "Porsche", model: "911 Carrera", year: 2005 }) === null, "2005 overlap");
  assert(!isGenerationMismatch({ make: "Porsche", model: "911 Carrera", year: 2005 }, { make: "Porsche", model: "911 Carrera", year: 2007 }), "unknown keeps");
  // Mileage numbers are not generation codes.
  assert(detectGeneration({ make: "Porsche", model: "911 Turbo", year: 1996, text: "964 miles" }) === "993", "964 miles ignored");
});

Deno.test("generation check only applies to Porsche 911s", () => {
  assert(detectGeneration({ make: "Mazda", model: "MX-5 Miata", year: 1994 }) === null, "miata");
  assert(detectGeneration({ make: "Porsche", model: "944 Turbo", year: 1987 }) === null, "944 turbo is not a 911");
  assert(!isGenerationMismatch({ make: "BMW", model: "M3", year: 1995 }, { make: "BMW", model: "M3", year: 1990 }), "bmw untouched");
});
