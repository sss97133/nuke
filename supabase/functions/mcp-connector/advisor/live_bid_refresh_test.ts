// deno test -A supabase/functions/mcp-connector/advisor/live_bid_refresh_test.ts
// T7: when the page shows a newer live bid than Nuke's auction_events row, evaluate_listing re-reads the lot
// through extract-bat-core (the existing writer) and flags the lag. Stubbed DB and network only.
import {
  _resetBidRefreshState,
  checkStoredBid,
  storedBidBehind,
} from "./live_bid_refresh.ts";
import { handleEvaluateListing } from "./evaluate_listing.ts";
import type { InvokeFunction } from "./instant_ingest.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}
const LOT =
  "https://bringatrailer.com/listing/1995-porsche-911-carrera-cabriolet-206/";
const VID = "1152e8de-cbd6-4ae5-b2c2-ed85ad36937b";

Deno.test("storedBidBehind: page ahead, missing row, null bid are behind; equal or lower are not", () => {
  assert(
    storedBidBehind({
      id: "a",
      high_bid: 20993,
      updated_at: null,
      outcome: "live",
    }, 39993),
    "ahead",
  );
  assert(storedBidBehind(null, 1000), "no row");
  assert(
    storedBidBehind({
      id: "a",
      high_bid: null,
      updated_at: null,
      outcome: "live",
    }, 1000),
    "null bid",
  );
  assert(
    !storedBidBehind({
      id: "a",
      high_bid: 39993,
      updated_at: null,
      outcome: "live",
    }, 39993),
    "equal",
  );
  assert(
    !storedBidBehind({
      id: "a",
      high_bid: 40000,
      updated_at: null,
      outcome: "live",
    }, 39993),
    "page lower",
  );
  assert(!storedBidBehind(null, 0), "no bid yet");
});

Deno.test("checkStoredBid: dispatches one extract-bat-core re-read per lot per 10 min", async () => {
  _resetBidRefreshState();
  const calls: string[] = [];
  const invoke: InvokeFunction = (n, b) => {
    calls.push(`${n} ${b.url} ${b.prefer_snapshot}`);
    return Promise.resolve({ status: 200, body: { success: true } });
  };
  const row = {
    id: "144e3fa7",
    high_bid: 20993,
    updated_at: new Date(Date.now() - 18 * 3600_000).toISOString(),
    outcome: "live",
  };
  const a = checkStoredBid(row, 39993, LOT, invoke);
  const b = checkStoredBid(row, 39993, LOT, invoke);
  await new Promise((r) => setTimeout(r, 0));
  assert(
    a.refresh === "dispatched" && a.stored_age_hours === 18 && a.behind,
    JSON.stringify(a),
  );
  assert(b.refresh === "throttled", JSON.stringify(b));
  assert(
    calls.length === 1 && calls[0] === `extract-bat-core ${LOT} false`,
    calls.join(),
  );
  const later = checkStoredBid(row, 39993, LOT, invoke, {
    now: Date.now() + 11 * 60_000,
  });
  assert(later.refresh === "dispatched", "after spacing");
  assert(
    checkStoredBid(row, 39993, LOT, undefined).refresh === "unavailable",
    "no writer",
  );
  assert(
    checkStoredBid(row, 39993, LOT, invoke, { justIngested: true }).refresh ===
      "just_ingested",
    "just ingested",
  );
  assert(
    checkStoredBid({ ...row, high_bid: 39993 }, 39993, LOT, invoke).refresh ===
      "not_needed",
    "fresh",
  );
});

Deno.test("evaluate_listing: #206-type lot — stored $20,993 vs page $39,993 → re-read dispatched + red flag", async () => {
  _resetBidRefreshState();
  const until = Math.floor(Date.now() / 1000) + 2 * 86400;
  const html =
    `<html><head><meta property="og:title" content="1995 Porsche 911 Carrera Cabriolet 6-Speed">
<script type="application/ld+json">{"@type":"Product","name":"1995 Porsche 911 Carrera Cabriolet","offers":{"price":39993}}</script></head>
<body><h1 data-testid="listing-post-title">1995 Porsche 911 Carrera Cabriolet 6-Speed</h1>
<div class="listing-available-info">Current Bid: USD $39,993 <span class="listing-available-countdown" data-until="${until}"></span></div>Place Bid</body></html>`;
  const stale = {
    id: "144e3fa7-7d29-493e-b5d1-f0eeaa1c7236",
    high_bid: 20993,
    updated_at: new Date(Date.now() - 18 * 3600_000).toISOString(),
    outcome: "live",
  };
  const chain = (table: string): unknown => {
    const f: Array<[string, unknown]> = [];
    const p: Record<string, unknown> = {};
    for (
      const m of [
        "select",
        "ilike",
        "is",
        "not",
        "or",
        "order",
        "limit",
        "gte",
        "lte",
      ]
    ) p[m] = () => p;
    p.eq = (c: string, v: unknown) => (f.push([c, v]), p);
    p.in = (c: string, v: unknown) => (f.push([c, v]), p);
    p.maybeSingle = () => Promise.resolve({ data: null, error: null });
    p.then = (res: (v: unknown) => unknown) => {
      let data: unknown[] = [];
      if (
        table === "vehicles" &&
        f.some(([c, v]) =>
          (c === "listing_url" || c === "bat_auction_url") &&
          String(v).includes("cabriolet-206")
        )
      ) {
        data = [{
          id: VID,
          year: 1995,
          make: "Porsche",
          model: "911 Carrera Cabriolet",
          listing_url: LOT.slice(0, -1),
          mileage: 58000,
        }];
      }
      if (
        table === "auction_events" &&
        f.some(([c, v]) => c === "vehicle_id" && v === VID)
      ) data = [stale];
      return Promise.resolve({ data, error: null }).then(res);
    };
    return p;
  };
  const db = {
    from: (t: string) => chain(t),
    rpc: () => Promise.resolve({ data: [], error: null }),
  };
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch =
    ((i: RequestInfo | URL) =>
      String(i).includes("bringatrailer.com")
        ? Promise.resolve(new Response(html, { status: 200 }))
        : Promise.reject(new Error("no network"))) as typeof fetch;
  try {
    const res = await handleEvaluateListing({
      sb: () => db,
      callEdgeApi: () => Promise.resolve({ data: [] }),
      invokeFunction: (n, b) => {
        calls.push(`${n} ${b.url}`);
        return Promise.resolve({
          status: 200,
          body: { success: true, updated_vehicle_ids: [VID] },
        });
      },
    }, { url: LOT });
    const sc = res.structuredContent as unknown as Record<string, unknown>;
    const sb = sc.stored_bid as Record<string, unknown>;
    assert(
      sb?.behind === true && sb.stored_high_bid === 20993 &&
        sb.page_bid === 39993 && sb.refresh === "dispatched",
      JSON.stringify(sb),
    );
    assert(
      calls.length === 1 && calls[0] === `extract-bat-core ${LOT}`,
      calls.join(),
    );
    const flags = (sc.red_flags as string[]).join(" | ");
    assert(
      /stored bid \$20,993, 18 h old, is behind the page's \$39,993 — refresh dispatched/
        .test(flags),
      flags,
    );
  } finally {
    globalThis.fetch = real;
  }
});
