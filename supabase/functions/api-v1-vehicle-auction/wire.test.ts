// The real handler and the real supabase-js client; only the network is replaced, by a stand-in for PostgREST that records
// what the route sends. What the route sends is what production receives.
//   deno test --no-check --allow-env supabase/functions/api-v1-vehicle-auction/wire.test.ts
const assert = (ok: unknown, message = "assertion failed") => { if (!ok) throw new Error(message); };
const same = (got: unknown, want: unknown, what = "value") => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) throw new Error(`${what}: expected ${b}, got ${a}`);
};

// supabase-js starts an auth refresh timer in every client, and this route builds one per request; the timer is the
// library's, so the sanitizers stand down for these tests only.
const WIRE = { sanitizeOps: false, sanitizeResources: false };
const SERVICE_KEY = "test-service-key";
const names = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const saved = names.map((n) => Deno.env.get(n));
Deno.env.set("SUPABASE_URL", "https://db.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
let handler: (request: Request) => Promise<Response>;
const realServe = Deno.serve;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (fn: typeof handler) => { handler = fn; };
await import("./index.ts");
Deno.serve = realServe;
addEventListener("unload", () => names.forEach((n, i) => saved[i] === undefined ? Deno.env.delete(n) : Deno.env.set(n, saved[i]!)));

const SLUG = "2004-land-rover-range-rover-38";
const URL_NOSLASH = `https://bringatrailer.com/listing/${SLUG}`;
const LOT_ID = "de6f3368-9e80-41a0-aa55-8a42f61d1838";
const VEH_ID = "49bf7c61-5885-49ed-8190-fe679a75605f";
const lot = {
  id: LOT_ID, vehicle_id: VEH_ID, source: "bat", source_url: URL_NOSLASH, outcome: "live",
  auction_end_date: "2026-10-07T15:56:00+00:00", updated_at: "2026-10-07T06:36:02.604+00:00", high_bid: 11250, total_bids: 14,
};
const readerResult = { status: "ok", reader: "live_lot_temperature_at", band: { n: 36, denominator: 38, low: 11250, high: 26291 } };

interface Seen { method: string; path: string; params: Record<string, string>; body: unknown }

/** Answers PostgREST the way the database does for this lot; `keyAnswer` is what check_api_key_rate_limit says. */
async function call(request: Request, opts: { keyAnswer?: unknown; vehicles?: unknown[] } = {}) {
  const seen: Seen[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    seen.push({ method, path: u.pathname, params: Object.fromEntries(u.searchParams), body });
    const json = (data: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }));
    switch (u.pathname) {
      case "/rest/v1/rpc/rate_limit_increment": return json(1);
      case "/rest/v1/rpc/check_api_key_rate_limit":
        return json(opts.keyAnswer ?? { allowed: true, remaining: 998, reset_at: "2026-10-07T08:00:00Z", user_id: "00000000-0000-0000-0000-0000000000aa", scopes: ["read"] });
      case "/rest/v1/vehicles": return json(opts.vehicles ?? [{ id: VEH_ID }]);
      case "/rest/v1/auction_events": return json([lot]);
      case "/rest/v1/rpc/live_lot_temperature_at": return json(readerResult);
      case "/rest/v1/api_usage_logs": return json(null, 201);
      default: throw new Error(`unexpected request ${method} ${u.pathname}`);
    }
  };
  try {
    const res = await handler!(request);
    return { res, body: await res.json().catch(() => null), seen };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const withKey = { Authorization: `Bearer ${SERVICE_KEY}` };
const forecastUrl = (q: string) => `https://fn.test/api-v1-vehicle-auction/forecast?${q}`;
const reads = (seen: Seen[]) => seen.filter((s) => s.path === "/rest/v1/vehicles" || s.path === "/rest/v1/auction_events" || s.path.endsWith("/live_lot_temperature_at"));

Deno.test("a url forecast: the vehicle hop, the lot read, the reader call, the usage log, in that order, in PostgREST's own terms", WIRE, async () => {
  const q = `url=${encodeURIComponent(URL_NOSLASH + "/")}&bid=11250&bidders=12&at=2026-10-07T06:59:30Z&ends_at=2026-10-07T15:56:00Z&extensions=0`;
  const { res, body, seen } = await call(new Request(forecastUrl(q), { headers: withKey }));
  same(res.status, 200);
  same(body.data.forecast, readerResult);
  same(body.data.resolution.by, "url");
  same(body.data.resolution.path, "vehicles.bat_auction_url -> auction_events.vehicle_id");
  same(body.data.resolution.key, `bringatrailer.com/listing/${SLUG}`);
  same(res.headers.get("cache-control"), "no-store");

  same(seen.map((s) => `${s.method} ${s.path}`), [
    "GET /rest/v1/vehicles",
    "GET /rest/v1/auction_events",
    "POST /rest/v1/rpc/live_lot_temperature_at",
    "POST /rest/v1/api_usage_logs",
  ]);
  // the same list shape the Stack A page already sends for source_url (nuke_frontend/src/pages/stacks/orderBookReader.ts)
  same(seen[0].params, { select: "id", bat_auction_url: `in.(${URL_NOSLASH},${URL_NOSLASH}/)`, limit: "5" });
  same(seen[1].params.vehicle_id, `in.(${VEH_ID})`);
  same(seen[1].params.source, "in.(bat,bringatrailer)");
  assert(seen[1].params.select.split(",").includes("source_url") && seen[1].params.select.split(",").includes("auction_end_date"));
  same(seen[2].body, {
    p_auction_event_id: LOT_ID, p_bid: 11250, p_bidders: 12, p_at: "2026-10-07T06:59:30.000Z",
    p_ends_at: "2026-10-07T15:56:00.000Z", p_extensions: 0,
  });
  same(seen[3].body, { user_id: "service-role", resource: "vehicle-auction", action: "forecast", resource_id: LOT_ID, timestamp: (seen[3].body as { timestamp: string }).timestamp });
});

Deno.test("a lot id skips the lookups a poller does not need", WIRE, async () => {
  const { res, seen } = await call(new Request(forecastUrl(`lot=${LOT_ID}&bid=11250`), { headers: withKey }));
  same(res.status, 200);
  same(reads(seen).map((s) => s.path), ["/rest/v1/auction_events", "/rest/v1/rpc/live_lot_temperature_at"]);
  same(seen[0].params.id, `eq.${LOT_ID}`);
  same(seen[1].body, { p_auction_event_id: LOT_ID, p_bid: 11250, p_bidders: null, p_at: (seen[1].body as { p_at: string }).p_at, p_ends_at: null, p_extensions: null });
});

Deno.test("an API key is judged by check_api_key_rate_limit, and its rate limit headers come back", WIRE, async () => {
  const { res, seen } = await call(new Request(forecastUrl(`lot=${LOT_ID}&bid=11250`), { headers: { "X-API-Key": "nk_live_testkey" } }));
  same(res.status, 200);
  same(res.headers.get("x-ratelimit-remaining"), "998");
  const check = seen.find((s) => s.path.endsWith("check_api_key_rate_limit"))!;
  same((check.body as { p_endpoint: string }).p_endpoint, "vehicle-auction");
  assert(/^sha256_[0-9a-f]{64}$/.test((check.body as { p_key_hash: string }).p_key_hash), "the key itself is never sent, its hash is");
  assert(!JSON.stringify(seen).includes("testkey"), "the raw key appears in no request body or path");
  same(seen.find((s) => s.path === "/rest/v1/api_usage_logs")!.body, {
    user_id: "00000000-0000-0000-0000-0000000000aa", resource: "vehicle-auction", action: "forecast", resource_id: LOT_ID,
    timestamp: (seen.find((s) => s.path === "/rest/v1/api_usage_logs")!.body as { timestamp: string }).timestamp,
  });
});

Deno.test("an exhausted key is 429 with its Retry-After, and nothing is read", WIRE, async () => {
  const exhausted = { allowed: false, error: "rate_limit_exceeded", retry_after: 1234, reset_at: "2026-10-07T08:00:00Z" };
  const { res, body, seen } = await call(new Request(forecastUrl(`lot=${LOT_ID}&bid=1`), { headers: { "X-API-Key": "nk_live_testkey" } }), { keyAnswer: exhausted });
  same(res.status, 429);
  same(res.headers.get("retry-after"), "1234");
  assert(String(body.error).includes("Rate limit exceeded"));
  same(reads(seen).length, 0);
});

Deno.test("an anonymous caller is 401 and reads nothing", WIRE, async () => {
  for (const path of ["forecast?bid=1", `forecast?lot=${LOT_ID}&bid=1`]) {
    const { res, seen } = await call(new Request(`https://fn.test/api-v1-vehicle-auction/${path}`));
    same(res.status, 401);
    same(reads(seen).length, 0);
    assert(!seen.some((s) => s.path === "/rest/v1/api_usage_logs"), "no usage is logged for a refusal");
  }
  // a key that is not a key
  const { res, seen } = await call(new Request(forecastUrl(`lot=${LOT_ID}&bid=1`), { headers: { "X-API-Key": "nk_live_nope" } }), { keyAnswer: { allowed: false, error: "invalid_key" } });
  same(res.status, 401);
  same(reads(seen).length, 0);
});

Deno.test("a bad request is 400 before any lookup, a miss is 404", WIRE, async () => {
  let r = await call(new Request(forecastUrl("bid=5"), { headers: withKey }));
  same(r.res.status, 400);
  same(reads(r.seen).length, 0);
  r = await call(new Request(forecastUrl(`url=${encodeURIComponent(URL_NOSLASH)}&bidders=2.5`), { headers: withKey }));
  same(r.res.status, 400);
  same(reads(r.seen).length, 0);
});

Deno.test("the VIN route is as it was, and only GET and OPTIONS are served", WIRE, async () => {
  // the existing route: the last path segment is a VIN, looked up with ilike on vehicles
  let r = await call(new Request("https://fn.test/api-v1-vehicle-auction/1HGCM82633A004352", { headers: withKey }), { vehicles: [] });
  same(r.res.status, 404);
  assert(String(r.body.error).startsWith("Vehicle not found for VIN"));
  same(r.seen.find((s) => s.path === "/rest/v1/vehicles")!.params.vin, "ilike.1HGCM82633A004352");
  assert(!r.seen.some((s) => s.path.endsWith("live_lot_temperature_at")));

  r = await call(new Request(forecastUrl(`lot=${LOT_ID}&bid=1`), { method: "POST", headers: withKey, body: "{}" }));
  same(r.res.status, 405);
  r = await call(new Request(forecastUrl(`lot=${LOT_ID}`), { method: "OPTIONS" }));
  same(r.res.status, 200);
  same(r.res.headers.get("access-control-allow-methods"), "GET, OPTIONS");
});
