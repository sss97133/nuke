import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { firecrawlMap, firecrawlScrape } from "./firecrawl.ts";
import { meterAllowance } from "./firecrawlMeter.ts";

type Call = [string, Record<string, unknown>];
const stub = (answers: Record<string, { data?: unknown; error?: { message: string } | null }>, calls: Call[] = []) => ({
  rpc: (fn: string, args: Record<string, unknown>) => { calls.push([fn, args]); return Promise.resolve(answers[fn] ?? { data: null, error: { message: "no stub" } }); },
});

Deno.test("a scrape needs an allowance of at least one credit; an unreadable or unmapped one is a no", async () => {
  assertEquals((await meterAllowance("https://ksl.com/x", stub({ firecrawl_allowance_for_url: { data: "3" } }))).allowed, true);
  assertEquals((await meterAllowance("https://ksl.com/x", stub({ firecrawl_allowance_for_url: { data: 0 } }))).allowed, false);
  assertEquals((await meterAllowance("https://ksl.com/x", stub({ firecrawl_allowance_for_url: { data: 5, error: { message: "boom" } } }))).allowed, false);
  assertEquals((await meterAllowance("https://ksl.com/x", stub({}))).allowed, false);
});

Deno.test("firecrawlScrape denies at no allowance without reaching Firecrawl and records nothing", async () => {
  const calls: Call[] = [];
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (() => { fetched++; return Promise.resolve(new Response("{}")); }) as typeof fetch;
  try {
    const r = await firecrawlScrape({ url: "https://www.mecum.com/lots/1/", formats: ["html"] },
      { apiKey: "test", meterClient: stub({ firecrawl_allowance_for_url: { data: 0 } }, calls) });
    assertEquals(r.error, "firecrawl_allowance_exhausted");
    assertEquals(r.success, false);
    assertEquals(fetched, 0);
    assertEquals(calls.map((c) => c[0]), ["firecrawl_allowance_for_url"]);
  } finally { globalThis.fetch = realFetch; }
});

Deno.test("firecrawlScrape asks first and records one credit after, for a success and for a failure", async () => {
  for (const ok of [true, false]) {
    const calls: Call[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(ok
      ? new Response(JSON.stringify({ success: true, data: { html: "<html>lot</html>" } }), { status: 200 })
      : new Response("nope", { status: 400 }))) as typeof fetch;
    try {
      const r = await firecrawlScrape({ url: "https://carsandbids.com/auctions/abc/x", formats: ["html"] },
        { apiKey: "test", maxAttempts: 1, caller: "extract-test", meterClient: stub({ firecrawl_allowance_for_url: { data: 4 }, firecrawl_record_url_spend: { data: 1 } }, calls) });
      assertEquals(r.success, ok);
      assertEquals(calls.map((c) => c[0]), ["firecrawl_allowance_for_url", "firecrawl_record_url_spend"]);
      assertEquals(calls[1][1].p_credits, 1);
      assertEquals(calls[1][1].p_lane, "extract-test");
      assertEquals(calls[1][1].p_url, "https://carsandbids.com/auctions/abc/x");
    } finally { globalThis.fetch = realFetch; }
  }
});

Deno.test("firecrawlScrape records five credits for a scrape with an LLM extract", async () => {
  const calls: Call[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ success: true, data: { rawHtml: "<html>lot</html>", extract: { vin: "x" } } }), { status: 200 }))) as typeof fetch;
  try {
    const r = await firecrawlScrape({ url: "https://www.pcarmarket.com/auction/x", formats: ["rawHtml", "extract"], extract: { schema: {} } },
      { apiKey: "test", maxAttempts: 1, caller: "import-pcarmarket-listing", meterClient: stub({ firecrawl_allowance_for_url: { data: 9 }, firecrawl_record_url_spend: { data: 1 } }, calls) });
    assertEquals(r.data.html, "<html>lot</html>");
    assertEquals(calls[1][1].p_credits, 5);
    assertEquals(calls[1][1].p_lane, "import-pcarmarket-listing");
  } finally { globalThis.fetch = realFetch; }
});

Deno.test("firecrawlMap is gated and metered like a scrape", async () => {
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (() => { fetched++; return Promise.resolve(new Response(JSON.stringify({ success: true, links: ["https://carsandbids.com/a"] }), { status: 200 })); }) as typeof fetch;
  try {
    const denied: Call[] = [];
    const r0 = await firecrawlMap("https://example.org/", { apiKey: "test", meterClient: stub({ firecrawl_allowance_for_url: { data: 0 } }, denied) });
    assertEquals(r0.error, "firecrawl_allowance_exhausted");
    assertEquals(fetched, 0);
    const calls: Call[] = [];
    const r1 = await firecrawlMap("https://carsandbids.com/", { apiKey: "test", maxAttempts: 1, caller: "onboard-source",
      meterClient: stub({ firecrawl_allowance_for_url: { data: 2 }, firecrawl_record_url_spend: { data: 1 } }, calls) });
    assertEquals(r1.success, true);
    assertEquals(calls.map((c) => c[0]), ["firecrawl_allowance_for_url", "firecrawl_record_url_spend"]);
    assertEquals(calls[1][1].p_lane, "onboard-source");
  } finally { globalThis.fetch = realFetch; }
});
