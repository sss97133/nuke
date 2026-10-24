// deno test --allow-read supabase/functions/mcp-connector/advisor/live_auction_verdict_test.ts
// A live auction's current bid is not an ask: the verdict must not say "ask below fair band".
import { handleEvaluateListing } from "./evaluate_listing.ts";

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function stubDb(comps: Array<Record<string, unknown>>) {
  const chain = (): unknown => {
    const p: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "ilike", "is", "not", "or", "order", "limit"]) p[m] = () => p;
    p.maybeSingle = () => Promise.resolve({ data: null, error: null });
    p.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
    return p;
  };
  return {
    from: () => chain(),
    rpc: (name: string) =>
      Promise.resolve({ data: name === "get_comps_combined" ? comps : [], error: null }),
  };
}

Deno.test("live BaT 911 Turbo: verdict compares current bid to fair band, no 'ask' wording", async () => {
  const until = Math.floor(Date.now() / 1000) + 9 * 86400;
  const html = `<html><head><meta property="og:title" content="1991 Porsche 911 Turbo">
<script type="application/ld+json">{"@type":"Product","name":"1991 Porsche 911 Turbo","description":"5-speed","image":["https://bringatrailer.com/wp-content/uploads/a.jpg"],"offers":{"price":120000}}</script></head>
<body><span class="listing-available-countdown" data-until="${until}"></span>Place Bid</body></html>`;
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    if (String(input).includes("bringatrailer.com/listing")) {
      return Promise.resolve(new Response(html, { status: 200 }));
    }
    return Promise.reject(new Error("no network in test"));
  }) as typeof fetch;
  const comps = [205000, 209000, 212000, 216000, 218000].map((p, i) => ({
    vehicle_id: null,
    yr: 1991,
    mk: "Porsche",
    mdl: "911 Turbo",
    sale_price: p,
    listing_url: `https://bringatrailer.com/listing/1991-porsche-911-turbo-${i + 20}/`,
    platform: "bat",
    sold_date: `2026-0${i + 1}-01`,
  }));
  try {
    const res = await handleEvaluateListing(
      { sb: () => stubDb(comps), callEdgeApi: () => Promise.resolve({ data: [] }) },
      { url: "https://bringatrailer.com/listing/1991-porsche-911-turbo-105/" },
    );
    const sc = res.structuredContent as unknown as Record<string, unknown>;
    const verdict = String(sc.verdict);
    assert(!/ask (below|above|inside) fair band/.test(verdict), verdict);
    assert(/auction live, current bid \$120,000 vs fair band/.test(verdict), verdict);
    const listing = sc.listing as Record<string, unknown>;
    assert(listing.ask === null && listing.current_bid === 120000, JSON.stringify(listing));
  } finally {
    globalThis.fetch = realFetch;
  }
});
