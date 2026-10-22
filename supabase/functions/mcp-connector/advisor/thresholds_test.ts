import { assertEquals } from "jsr:@std/assert";
import { calibratedConfidence, VALUATION_THRESHOLDS } from "./handlers.ts";
Deno.test("backtest-fitted thresholds", () => {
  assertEquals(VALUATION_THRESHOLDS, { minComps: 4, staleDays: 180, disagreement: 0.10 });
  assertEquals(calibratedConfidence(4, 0.05), 0.527);
  assertEquals(calibratedConfidence(12, 0.6), 0.31);
  assertEquals(calibratedConfidence(2, 0.05), 0.3);
});
