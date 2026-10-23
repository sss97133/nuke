import { assert, assertEquals } from "jsr:@std/assert";
import { detectVariant, isVariantMismatch } from "./variants.ts";
Deno.test("spelling-key comps keep trim hard blockers", () => {
  assert(isVariantMismatch(detectVariant("911 Carrera"), detectVariant("911 Turbo")));
  assert(isVariantMismatch(detectVariant("911 Turbo"), detectVariant("911 Carrera 4S")));
  assert(isVariantMismatch(detectVariant("911 Carrera"), detectVariant("911 GT3")));
  assertEquals(isVariantMismatch(detectVariant("911 Turbo"), detectVariant("911 Turbo S")), false);
  assertEquals(isVariantMismatch(detectVariant("MX-5 Miata 5-Speed"), detectVariant("MX5 Miata")), false);
});
