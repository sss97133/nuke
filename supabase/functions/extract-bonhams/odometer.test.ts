// Run: deno test --allow-read supabase/functions/extract-bonhams/
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractSpecsFromContent } from "./index.ts";

Deno.test("km odometer keeps unit and stores miles", () => {
  const s = extractSpecsFromContent("Odometer: 48,000 km indicated. Red over tan.");
  assertEquals([s.mileage, s.odometer], [29826, { value: 48000, unit: "km" }]);
});
Deno.test("miles odometer passes through", () => {
  const s = extractSpecsFromContent("Showing 12,345 miles from new.");
  assertEquals([s.mileage, s.odometer], [12345, { value: 12345, unit: "mi" }]);
});

Deno.test("top speed in km/h is not mileage", () => {
  assertEquals(extractSpecsFromContent("lui assuraient une vitesse de 72 km/h.").mileage, null);
  assertEquals(extractSpecsFromContent("a top speed of 120 km/h was claimed").mileage, null);
});
Deno.test("fuel economy and distance are not mileage", () => {
  assertEquals(extractSpecsFromContent("returning 103 miles per gallon on test").mileage, null);
  assertEquals(extractSpecsFromContent("averaged 90 miles in an hour on the run").mileage, null);
  assertEquals(extractSpecsFromContent("capable of 100 mph and 30 mpg").mileage, null);
});
Deno.test("bare number+unit without odometer context is ignored", () => {
  assertEquals(extractSpecsFromContent("The car was driven 477 miles to the concours.").mileage, null);
});
Deno.test("odometer context accepted", () => {
  assertEquals(extractSpecsFromContent("The odometer reads 23,456 miles.").mileage, 23456);
  assertEquals(extractSpecsFromContent("Mileage: 61,000").odometer, { value: 61000, unit: null });
  assertEquals(extractSpecsFromContent("only 8,900 km from new").odometer, { value: 8900, unit: "km" });
  assertEquals(extractSpecsFromContent("Indicated 12,345 miles.").mileage, 12345);
});
