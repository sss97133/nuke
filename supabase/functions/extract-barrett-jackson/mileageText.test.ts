import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { odometerMilesFromText } from "../_shared/odometerText.ts";

// extractMileageFromText (index.ts) stores odometerMilesFromText of the description.
Deno.test("B-J prose: speeds, mpg, hp and ci are not mileage", () => {
  assertEquals(odometerMilesFromText("Built 1957 to 1960, achieving over 120 miles per hour in showroom trim."), null);
  assertEquals(odometerMilesFromText("This fun micro car example can achieve 55 miles per gallon."), null);
  assertEquals(odometerMilesFromText("496ci V8 roller engine with dyno sheet showing 601hp."), null);
  assertEquals(odometerMilesFromText("reliable low-mileage 350ci 4-bolt main engine"), null);
  assertEquals(odometerMilesFromText("It has been clocked at 180 miles per hour."), null);
});

Deno.test("B-J prose: odometer readings are kept", () => {
  assertEquals(odometerMilesFromText("Showing 23,456 actual miles."), 23456);
  assertEquals(odometerMilesFromText("Less than 900 actual miles. Garage kept."), 900);
  assertEquals(odometerMilesFromText("The odometer reads 41,250."), 41250);
});
