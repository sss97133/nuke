import { assert, assertEquals } from "jsr:@std/assert";
import { adjustedEstimate, confidenceFor, indexAt, mileageAdj, normPlatform } from "./adjust.ts";
Deno.test("adjust: index, platform, mileage, own sale", () => {
  const index = [{ month: "2020-01-01", idx: 0 }, { month: "2024-01-01", idx: 0.2 }];
  assertEquals(indexAt(index, "2025-06-01"), 0.2);
  assertEquals(normPlatform("https://bringatrailer.com/listing/x"), "bat");
  assert(mileageAdj(-3) > 0.29 && mileageAdj(2) < -0.18);
  const comps = [1, 2, 3, 4].map(() => ({ sale_price: 10000, sold_date: "2020-06-01", platform: "bat", mileage: null }));
  const r = adjustedEstimate({ comps, minComps: 4, index, asOf: "2026-10-01", subjectPlatform: "bat", subjectMileage: null })!;
  assertEquals(r.estimate, Math.round(10000 * Math.exp(0.2)));
  const o = adjustedEstimate({ comps, minComps: 4, index, asOf: "2026-10-01", subjectPlatform: "bat", subjectMileage: null, ownSale: { amount: 19000, on: "2024-08-15", platform: "bat" } })!;
  assert(o.estimate > 17000 && o.confidence === confidenceFor(4, 0, true));
});
