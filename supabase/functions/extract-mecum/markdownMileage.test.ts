import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mileageFromMecumMarkdown } from "./markdownMileage.ts";

Deno.test("Mecum: subtitle odometer kept", () => {
  assertEquals(mileageFromMecumMarkdown("# 2008 Porsche\n\n110 Miles, Sunroof\n"), { mileage: 110, source: "subtitle" });
});

Deno.test("Mecum: speed and mpg bullets skipped, later odometer bullet kept", () => {
  const md = "# 1960 Amphicar\n\n## HIGHLIGHTS\n\n- Model 770, 7 knots and 70 miles per hour\n- Capable of 50 miles per gallon\n- 12,400 actual miles\n";
  assertEquals(mileageFromMecumMarkdown(md), { mileage: 12400, source: "highlights" });
});

Deno.test("Mecum: only speeds gives null", () => {
  assertEquals(mileageFromMecumMarkdown("## HIGHLIGHTS\n\n- Top speed of 174 miles per hour\n"), null);
});
