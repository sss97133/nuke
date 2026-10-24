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
