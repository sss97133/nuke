import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mileageFromCabTitle } from "./titleMileage.ts";

Deno.test("C&B title: odometer kept", () => {
  assertEquals(mileageFromCabTitle("2002 BMW M3 Coupe ~14,000 Miles - 6-Speed"), 14000);
  assertEquals(mileageFromCabTitle("2019 Arcimoto FUV ~70 Miles"), 70);
});

Deno.test("C&B title: speed or mpg is not mileage", () => {
  assertEquals(mileageFromCabTitle("Electric runabout, 75 miles per hour top speed"), null);
  assertEquals(mileageFromCabTitle(null), null);
});
