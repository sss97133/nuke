import { rowVinQualifies } from "./persistence.ts";
function eq(a: unknown, b: unknown) { if (a !== b) throw new Error(`${a} !== ${b}`); }
Deno.test("full VIN needs 0.9", () => {
  eq(rowVinQualifies(" 1fafp40634f123456 ", 0.95, false, false), "1FAFP40634F123456");
  eq(rowVinQualifies("1FAFP40634F123456", 0.85, false, false), null);
});
Deno.test("classic serial accepted at 0.8", () => {
  eq(rowVinQualifies("215618", 0.8, false, null), "215618");
  eq(rowVinQualifies("215618", 0.79, false, false), null);
  eq(rowVinQualifies("ABCDE", 0.9, false, false), null); // no digit
  eq(rowVinQualifies("1234", 0.9, false, false), null);  // too short
});
Deno.test("documents and junk never file", () => {
  eq(rowVinQualifies("215618", 0.95, true, false), null);
  eq(rowVinQualifies("215618", 0.95, false, true), null);
  eq(rowVinQualifies(null, 0.95, false, false), null);
  eq(rowVinQualifies("215618", "x", false, false), null);
});
