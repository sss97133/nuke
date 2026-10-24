import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { flagPlaceholderMileage, isPlaceholderMileage, odometerColumns, placeholderMileageStatusRow, toMiles, unitFromText } from "./odometer.ts";

Deno.test("km keeps the source figure and records the conversion", () => {
  const c = odometerColumns({ value: 38005, unit: "km" }, "t", "u");
  assertEquals([c.mileage, c.odometer_reading, c.odometer_unit, c.mileage_normalized_method], [23615, 38005, "km", "km_to_mi_x0.621371"]);
});
Deno.test("miles pass through; unknown unit is low confidence", () => {
  assertEquals(toMiles({ value: 1000, unit: "mi" }), 1000);
  assertEquals(odometerColumns({ value: 5, unit: null }, "t").mileage_normalized_confidence, "low");
  assertEquals([unitFromText("24,669 Km (Indicated)"), unitFromText("12,000 miles"), unitFromText("12,000")], ["km", "mi", null]);
});
Deno.test("placeholder sentinels are flagged, real readings are not", async () => {
  assertEquals([99999, 999999, 123456, 12345, 1234, 111111].map(isPlaceholderMileage), [true, true, true, true, true, true]);
  assertEquals([1, 123, 9999, 99998, 45000, null].map((v) => isPlaceholderMileage(v)), [false, false, false, false, false, false]);
  const r = placeholderMileageStatusRow("v1", 123456, "t", "u");
  assertEquals([r?.status, r?.reason, r?.value, r?.old_vehicle_mileage], ["suspect", "placeholder_sentinel", 123456, 123456]);
  assertEquals(placeholderMileageStatusRow("v1", 45000, "t"), null);
  const rows: unknown[] = [];
  const client = { from: (_t: string) => ({ insert: (row: unknown) => { rows.push(row); return Promise.resolve({ error: null }); } }) };
  assertEquals(await flagPlaceholderMileage(client, "v1", 99999, "t"), true);
  assertEquals(await flagPlaceholderMileage(client, "v1", 45000, "t"), false);
  assertEquals(rows.length, 1);
});
