// Run: deno test supabase/functions/batch-extract-snapshots/lotYear.test.ts
import { applyLotSlugYear, lotSlugYear } from "./lotYear.ts";

function equal(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

Deno.test("gooding slug year overrides an auction year the model read", () => {
  const p: Record<string, unknown> = { year: 2022, make: "Porsche" };
  equal(applyLotSlugYear(p, "gooding", "https://goodingco.com/lot/1992-porsche-964-carrera-2"), true);
  equal(p.year, 1992);
});
Deno.test("gooding slug year fills a missing year, unchanged flag false", () => {
  const p: Record<string, unknown> = {};
  equal(applyLotSlugYear(p, "gooding", "https://www.goodingco.com/lot/1979-ferrari-512-berlinetta-boxer"), false);
  equal(p.year, 1979);
});
Deno.test("no slug year: other platforms and yearless slugs untouched", () => {
  const p: Record<string, unknown> = { year: 2022 };
  equal(applyLotSlugYear(p, "bat", "https://bringatrailer.com/listing/1992-porsche-964/"), false);
  equal(lotSlugYear("gooding", "https://www.goodingco.com/lot/ferrari-250-gt"), null);
  equal(p.year, 2022);
});
