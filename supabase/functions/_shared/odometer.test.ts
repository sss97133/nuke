import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { odometerColumns, toMiles, unitFromText } from "./odometer.ts";

Deno.test("km keeps the source figure and records the conversion", () => {
  const c = odometerColumns({ value: 38005, unit: "km" }, "t", "u");
  assertEquals([c.mileage, c.odometer_reading, c.odometer_unit, c.mileage_normalized_method], [23615, 38005, "km", "km_to_mi_x0.621371"]);
});
Deno.test("miles pass through; unknown unit is low confidence", () => {
  assertEquals(toMiles({ value: 1000, unit: "mi" }), 1000);
  assertEquals(odometerColumns({ value: 5, unit: null }, "t").mileage_normalized_confidence, "low");
  assertEquals([unitFromText("24,669 Km (Indicated)"), unitFromText("12,000 miles"), unitFromText("12,000")], ["km", "mi", null]);
});
