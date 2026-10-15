import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { firecrawlGate } from "./firecrawlGate.ts";

const rpcStub = (answers: Record<string, { data?: unknown; error?: { message: string } | null }>, calls: Array<[string, Record<string, unknown>]> = []) => ({
  rpc: (fn: string, args: Record<string, unknown>) => { calls.push([fn, args]); return Promise.resolve(answers[fn] ?? { data: null, error: { message: "no stub" } }); },
});

Deno.test("a fetch needs at least one credit of allowance; an unreadable allowance is a no", async () => {
  assertEquals(await firecrawlGate(rpcStub({ firecrawl_allowance: { data: "3" } }), "ksl").allow(), true);
  assertEquals(await firecrawlGate(rpcStub({ firecrawl_allowance: { data: 0 } }), "ksl").allow(), false);
  assertEquals(await firecrawlGate(rpcStub({ firecrawl_allowance: { data: 2, error: { message: "boom" } } }), "ksl").allow(), false);
  assertEquals(await firecrawlGate(rpcStub({}), "ksl").allow(), false);
});

Deno.test("every paid fetch is recorded with its source, credits, lots and lane", async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  await firecrawlGate(rpcStub({ firecrawl_record_spend: { data: 1 } }, calls), "collecting-cars").record(1, 0, "extract-collecting-cars", "unusable page");
  assertEquals(calls[0], ["firecrawl_record_spend", { p_source: "collecting-cars", p_credits: 1, p_lots: 0, p_lane: "extract-collecting-cars", p_note: "unusable page" }]);
});
