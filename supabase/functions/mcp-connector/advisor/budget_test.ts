import { assertEquals, assert } from "jsr:@std/assert";
import { allInCost, rankBudgetOptions, budgetEnvelope, type SegmentStat } from "./budget.ts";
import { assertEnvelopeShape } from "./evidence.ts";
const S = (o: Partial<SegmentStat>): SegmentStat => ({ segment: "X", make: "x", era: "1980-99", n: 100, median_price: 10000, p25: 8000, p75: 14000, make_3y_pct: 5, era_3y_pct: 3, era_vol_pct: 10, as_of: "2026-10-22", run_id: "t", ...o });
Deno.test("all-in adds capped buyer fee, transport, paperwork", () => {
  assertEquals(allInCost(17250), Math.round(17250 + 862.5 + 2400));
  assertEquals(allInCost(500000), 500000 + 7500 + 2400);
});
Deno.test("filters to budget band and min sales, ranks by score", () => {
  const stats = [S({ segment: "A", median_price: 17000 }), S({ segment: "B", median_price: 17000, make_3y_pct: -10 }),
    S({ segment: "tooCheap", median_price: 3000 }), S({ segment: "tooDear", median_price: 30000 }), S({ segment: "thin", median_price: 17000, n: 10 })];
  const r = rankBudgetOptions(25000, stats);
  assertEquals(r.map((o) => o.segment), ["A", "B"]);
  assert(r[0].why.length >= 3);
});
Deno.test("bad budget returns nothing", () => { assertEquals(rankBudgetOptions(0, [S({})]), []); assertEquals(rankBudgetOptions(NaN, [S({})]), []); });
Deno.test("envelope shape and label-only signal", () => {
  const env = budgetEnvelope(25000, rankBudgetOptions(25000, [S({ median_price: 17000 })]), { label: "heating", as_of: "2026-08", gate_passed: false });
  assertEnvelopeShape(env);
  assertEquals(env.claims.at(-1)?.value, "heating");
  const empty = budgetEnvelope(1000, [], null);
  assertEnvelopeShape(empty);
});
