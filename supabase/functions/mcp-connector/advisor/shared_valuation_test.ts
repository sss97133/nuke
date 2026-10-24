// deno test --allow-read supabase/functions/mcp-connector/advisor/shared_valuation_test.ts
// evaluate_listing and value_asset must agree for the same matched car.
import { handleEvaluateListing } from "./evaluate_listing.ts";
import { makeEnvelope } from "./evidence.ts";

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const URL_ = "https://bringatrailer.com/listing/1994-mazda-mx-5-miata-146/";
const ASSET = "11111111-2222-3333-4444-555555555555";

// Chainable read-only Supabase stub: vehicles queries return the matched row, everything else empty.
function stubDb() {
  const row = { id: ASSET, year: 1994, make: "Mazda", model: "MX-5 Miata M Edition", sale_price: null };
  const chain = (table: string): unknown => {
    const result = { data: table === "vehicles" ? [row] : [], error: null };
    const p: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "ilike", "is", "not", "or", "order", "limit", "gte", "lte"]) {
      p[m] = () => p;
    }
    p.maybeSingle = () => Promise.resolve({ data: table === "vehicles" ? row : null, error: null });
    p.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
    return p;
  };
  return {
    from: (t: string) => chain(t),
    rpc: () => Promise.resolve({ data: [], error: null }),
  };
}

Deno.test("evaluate_listing uses value_asset's band and comps for a matched asset", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        `<html><head><meta property="og:title" content="1994 Mazda MX-5 Miata M Edition"></head><body>No reserve</body></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      ),
    )) as typeof fetch;
  const comps = Array.from({ length: 15 }, (_, i) => ({
    asset_id: `c${i}`,
    sale_price: 12000 + i * 400,
    sold_date: "2026-06-01",
    platform: "bat",
    listing_url: `https://bringatrailer.com/listing/1994-mazda-miata-${i}/`,
    year: 1994,
    make: "Mazda",
    model: "MX-5 Miata",
  }));
  let calledWith: string | null = null;
  try {
    const res = await handleEvaluateListing({
      sb: stubDb,
      callEdgeApi: () => Promise.resolve({ data: [] }),
      valueAsset: (id) => {
        calledWith = id;
        return Promise.resolve({
          structuredContent: makeEnvelope("value_asset", "vehicle", id, [], {
            value_low: 12400,
            value_high: 17900,
            estimated_value: 15300,
            estimate_source: "adjusted_comps",
            confidence: 0.52,
            flags: ["comps_time_channel_mileage_adjusted"],
            comps_used: comps,
            comps_summary: { count: 15, excluded: { parts: 1 } },
          }),
        });
      },
    }, { url: URL_ });
    const sc = res.structuredContent as unknown as Record<string, unknown>;
    const value = sc.value as Record<string, unknown>;
    assert(calledWith === ASSET, `value_asset called with ${calledWith}`);
    assert(value.low === 12400 && value.high === 17900, `band ${value.low}-${value.high}`);
    assert(value.n === 15, `n=${value.n}`);
    assert((sc.comps as unknown[]).length === 10, "top comps come from value_asset");
    assert(String(value.basis).startsWith("value_asset"), String(value.basis));
    assert(!/value not recorded/.test(String(sc.verdict)), String(sc.verdict));
  } finally {
    globalThis.fetch = realFetch;
  }
});
