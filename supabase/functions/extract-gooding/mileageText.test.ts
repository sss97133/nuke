import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseMileageFromText } from "./goodingText.ts";

Deno.test("Gooding: speed and economy highlights are not mileage", () => {
  assertEquals(parseMileageFromText("Bonneville Salt Flats at over 220 Miles per Hour"), null);
  assertEquals(parseMileageFromText("High Specification 300 Model 60 Miles Per Gallon"), null);
});

Deno.test("Gooding: odometer prose is kept, km converted to miles", () => {
  assertEquals(parseMileageFromText("Showing Less than 19,300 Miles"), 19300);
  assertEquals(parseMileageFromText("Displays 10,000 km from new"), 6214);
});
