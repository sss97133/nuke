import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { odometerMilesFromText } from "../_shared/odometerText.ts";

// scripts/bonhams-playwright-extractor.ts stores odometerMilesFromText(document.body.innerText).
Deno.test("Bonhams page text: record runs and speeds skipped, odometer kept in miles", () => {
  const body = "speed records in 1998, covering 100 kilometers at an average speed of 304 km/h. " +
    "The car currently displays 66,563 kilometres on the odometer.";
  assertEquals(odometerMilesFromText(body), Math.round(66563 * 0.621371));
  assertEquals(odometerMilesFromText("top speed of 224 miles per hour"), null);
  assertEquals(odometerMilesFromText("completed 700 miles at Brooklands in less than 700 minutes"), null);
});
