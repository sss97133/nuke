// The forecast route, with no network and no environment: deno test --no-check supabase/functions/api-v1-vehicle-auction/forecast.test.ts
// The wire format (what PostgREST receives) is in wire.test.ts.
import {
  batLotKey, handleForecast, MAX_AT_AHEAD_S, normalizeListingUrlKey, parseForecastQuery, READER, resolveLot,
  type Locator, type LotRow,
} from "./forecast.ts";

const assert = (ok: unknown, message = "assertion failed") => { if (!ok) throw new Error(message); };
const same = (got: unknown, want: unknown, what = "value") => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) throw new Error(`${what}: expected ${b}, got ${a}`);
};

const NOW = new Date("2026-10-07T07:00:00Z");
const SLUG = "2004-land-rover-range-rover-38";
const URL_NOSLASH = `https://bringatrailer.com/listing/${SLUG}`;
const LOT_ID = "de6f3368-9e80-41a0-aa55-8a42f61d1838";
const VEH_ID = "49bf7c61-5885-49ed-8190-fe679a75605f";

const lotRow = (over: Partial<LotRow> = {}): LotRow => ({
  id: LOT_ID, vehicle_id: VEH_ID, source: "bat", source_url: URL_NOSLASH, outcome: "live",
  auction_end_date: "2026-10-07T15:56:00+00:00", updated_at: "2026-10-07T06:36:02.604+00:00", high_bid: "11250", total_bids: 14, ...over,
});

// ---------------------------------------------------------------------------------------------------------------------
// A stand-in for the supabase-js query builder: records each query and answers from a script.

interface Call { table: string; select: string; filters: [string, string, unknown][]; order: unknown; limit: number | null }
interface Answer { data: unknown; error: { code?: string; message: string } | null }
function fakeDb(answer: (c: Call) => Answer, reader?: (args: Record<string, unknown>) => Answer) {
  const calls: Call[] = [];
  const rpcs: { name: string; args: Record<string, unknown> }[] = [];
  return {
    calls, rpcs,
    from(table: string) {
      const c: Call = { table, select: "", filters: [], order: null, limit: null };
      const q = {
        select(cols: string) { c.select = cols; return q; },
        eq(col: string, v: unknown) { c.filters.push(["eq", col, v]); return q; },
        in(col: string, v: unknown) { c.filters.push(["in", col, v]); return q; },
        order(col: string, o: unknown) { c.order = [col, o]; return q; },
        limit(n: number) { c.limit = n; return q; },
        // deno-lint-ignore no-explicit-any
        then(ok: (a: Answer) => any, bad?: (e: unknown) => any) { calls.push(c); return Promise.resolve(answer(c)).then(ok, bad); },
      };
      return q;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcs.push({ name, args });
      return Promise.resolve(reader ? reader(args) : { data: null, error: { message: "no reader scripted" } });
    },
  };
}
const ok = (data: unknown): Answer => ({ data, error: null });

// ---------------------------------------------------------------------------------------------------------------------

Deno.test("normalizeListingUrlKey is public.normalize_listing_url_key (answers read from prod on 2026-10-07)", async () => {
  // [input, what the database function returned for it]
  const fixture: [string, string | null][] = [
    ["https://bringatrailer.com/listing/2004-land-rover-range-rover-38/", "bringatrailer.com/listing/2004-land-rover-range-rover-38"],
    ["https://bringatrailer.com/listing/2004-land-rover-range-rover-38", "bringatrailer.com/listing/2004-land-rover-range-rover-38"],
    ["http://www.BringATrailer.com/listing/2004-Land-Rover-Range-Rover-38/?utm_source=x#comments", "bringatrailer.com/listing/2004-land-rover-range-rover-38"],
    ["  https://bringatrailer.com/listing/1968-alfa-romeo-gt-1300-junior-2///  ", "bringatrailer.com/listing/1968-alfa-romeo-gt-1300-junior-2"],
    ["bringatrailer.com/listing/2017-mercedes-benz-g550-4x4%C2%B2-27/", "bringatrailer.com/listing/2017-mercedes-benz-g550-4x4%c2%b2-27"],
    ["https://bringatrailer.com/listing/2004-land-rover-range-rover-38/carfax/", "bringatrailer.com/listing/2004-land-rover-range-rover-38/carfax"],
    ["https://www.bringatrailer.com", "bringatrailer.com"],
    ["", null],
    ["https://bringatrailer.com/listing/a b/", "bringatrailer.com/listing/a b"],
    ["HTTPS://WWW.BRINGATRAILER.COM/LISTING/X-1/#a?b", "bringatrailer.com/listing/x-1"],
  ];
  for (const [input, want] of fixture) same(normalizeListingUrlKey(input), want, JSON.stringify(input));
  same(normalizeListingUrlKey(null), null);
});

Deno.test("batLotKey: every spelling of one lot URL is one key; anything else is not a lot", () => {
  const spellings = [
    URL_NOSLASH, `${URL_NOSLASH}/`, `http://www.bringatrailer.com/listing/${SLUG}/?utm_source=x#comments`,
    `bringatrailer.com/listing/${SLUG.toUpperCase()}`, `  ${URL_NOSLASH}//  `,
  ];
  for (const s of spellings) {
    const k = batLotKey(s);
    assert(k !== null, `${s} should resolve`);
    same(k!.key, `bringatrailer.com/listing/${SLUG}`, s);
    same(k!.slug, SLUG);
    same(k!.canonical, URL_NOSLASH);
    same(k!.variants, [URL_NOSLASH, `${URL_NOSLASH}/`]);
  }
  // a character that is not ASCII is stored percent-encoded in lowercase (read from prod: ...g550-4x4%c2%b2-27)
  same(batLotKey("https://bringatrailer.com/listing/2017-mercedes-benz-g550-4x4²-27/")!.slug, "2017-mercedes-benz-g550-4x4%c2%b2-27");
  same(batLotKey("https://bringatrailer.com/listing/2017-mercedes-benz-g550-4x4%C2%B2-27/")!.slug, "2017-mercedes-benz-g550-4x4%c2%b2-27");
  for (const bad of [
    "", "   ", "not a url", "https://example.com/listing/x-1/", "https://bringatrailer.com/", "https://bringatrailer.com/listing/",
    `https://bringatrailer.com/listing/${SLUG}/carfax/`, "https://bringatrailer.com/auctions/", "https://bringatrailer.com/member/someone/",
    "https://bringatrailer.com/listing/a%zz/", "https://bringatrailer.com/listing/a%2/", "https://bringatrailer.com/listing/-x/",
    `https://bringatrailer.com/listing/${"a".repeat(500)}/`,
    "https://bringatrailer.com:8443/listing/x-1/", "https://user@bringatrailer.com/listing/x-1/",
  ]) assert(batLotKey(bad) === null, `${bad.slice(0, 60)} must not resolve`);
});

Deno.test("parseForecastQuery: one locator, typed numbers, strict instants, nothing dropped silently", () => {
  const q = (s: string) => new URLSearchParams(s);
  const parse = (s: string) => parseForecastQuery(q(s), NOW);
  const bad = (s: string, needle: string) => {
    const r = parse(s);
    assert(!r.ok, `${s} should be refused`);
    assert(!r.ok && r.error.includes(needle), `${s}: "${!r.ok && r.error}" should mention ${needle}`);
  };

  // the locator
  bad("", "exactly one");
  bad(`url=${URL_NOSLASH}&vehicle_id=${VEH_ID}`, "exactly one");
  bad(`vehicle_id=${VEH_ID}&lot=${LOT_ID}`, "exactly one");
  bad("url=https://example.com/listing/x/", "Bring a Trailer lot URL");
  bad("vehicle_id=not-a-uuid", "uuid");
  bad("lot=12345", "uuid");
  const byUrl = parse(`url=${encodeURIComponent(URL_NOSLASH + "/")}`);
  assert(byUrl.ok && byUrl.input.locator.by === "url");
  const byVehicle = parse(`vehicle_id=${VEH_ID.toUpperCase()}`);
  assert(byVehicle.ok && byVehicle.input.locator.by === "vehicle_id" && (byVehicle.input.locator as { id: string }).id === VEH_ID);
  const byLot = parse(`lot=${LOT_ID}`);
  assert(byLot.ok && byLot.input.locator.by === "lot");

  // the live state: bidders is cast to an integer, and a value that is not one is refused rather than rounded
  const full = parse(`lot=${LOT_ID}&bid=11250&bidders=12&at=2026-10-07T06:59:30Z&ends_at=2026-10-07T15:56:00Z&extensions=2`);
  assert(full.ok);
  if (full.ok) {
    same(full.input.bid, 11250);
    same(full.input.bidders, 12);
    assert(Number.isInteger(full.input.bidders));
    same(full.input.extensions, 2);
    same(full.input.at.toISOString(), "2026-10-07T06:59:30.000Z");
    same(full.input.atSource, "argument");
    same(full.input.endsAt!.toISOString(), "2026-10-07T15:56:00.000Z");
  }
  const bare = parse(`lot=${LOT_ID}`);
  assert(bare.ok);
  if (bare.ok) {
    same([bare.input.bid, bare.input.bidders, bare.input.endsAt, bare.input.extensions], [null, null, null, null]);
    same(bare.input.at.toISOString(), NOW.toISOString());
    same(bare.input.atSource, "server_now");
  }
  const blanks = parse(`lot=${LOT_ID}&bid=&bidders=%20&at=&ends_at=&extensions=`);
  assert(blanks.ok && blanks.input.bid === null && blanks.input.atSource === "server_now", "empty values are absent");
  const cents = parse(`lot=${LOT_ID}&bid=11250.50`);
  assert(cents.ok && cents.input.bid === 11250.5);
  bad(`lot=${LOT_ID}&bid=11,250`, "bid");
  bad(`lot=${LOT_ID}&bid=-5`, "bid");
  bad(`lot=${LOT_ID}&bid=abc`, "bid");
  bad(`lot=${LOT_ID}&bid=1e6`, "bid");
  bad(`lot=${LOT_ID}&bidders=12.5`, "bidders");
  bad(`lot=${LOT_ID}&bidders=-1`, "bidders");
  bad(`lot=${LOT_ID}&bidders=twelve`, "bidders");
  bad(`lot=${LOT_ID}&extensions=1.5`, "extensions");
  bad(`lot=${LOT_ID}&extensions=x`, "extensions");

  // the clocks: an instant needs an offset, and a caller whose clock is ahead of the server's is refused
  bad(`lot=${LOT_ID}&at=2026-10-07T06:59:30`, "offset");
  bad(`lot=${LOT_ID}&at=yesterday`, "ISO 8601");
  bad(`lot=${LOT_ID}&ends_at=2026-10-07`, "ISO 8601");
  bad(`lot=${LOT_ID}&ends_at=2026-13-45T25:61:00Z`, "valid instant");
  const ahead = (s: number) => new Date(NOW.getTime() + s * 1000).toISOString();
  assert(parse(`lot=${LOT_ID}&at=${encodeURIComponent(ahead(MAX_AT_AHEAD_S))}`).ok, "at exactly at the limit passes");
  bad(`lot=${LOT_ID}&at=${encodeURIComponent(ahead(MAX_AT_AHEAD_S + 60))}`, "ahead of the server's clock");
  assert(parse(`lot=${LOT_ID}&at=2026-10-06T00:00:00Z`).ok, "a replay in the past is allowed: the reader is point in time");
  const offset = parse(`lot=${LOT_ID}&at=${encodeURIComponent("2026-10-07T00:59:30-06:00")}`);
  assert(offset.ok && offset.input.at.toISOString() === "2026-10-07T06:59:30.000Z", "an offset is applied");
});

Deno.test("resolveLot by lot id and by vehicle id", async () => {
  // lot id: one row; a row whose URL is not a Bring a Trailer lot is not a lot
  let db = fakeDb(() => ok([lotRow()]));
  let r = await resolveLot(db, { by: "lot", id: LOT_ID });
  assert(r.ok && r.lot.id === LOT_ID && r.resolution.path === "auction_events.id" && r.resolution.candidates === 1);
  same(db.calls.length, 1);
  same(db.calls[0].table, "auction_events");
  same(db.calls[0].filters, [["eq", "id", LOT_ID]]);

  db = fakeDb(() => ok([lotRow({ source_url: "https://mecum.com/lots/1" })]));
  r = await resolveLot(db, { by: "lot", id: LOT_ID });
  assert(!r.ok && r.status === 404, "a non-BaT row is not a lot");
  db = fakeDb(() => ok([]));
  r = await resolveLot(db, { by: "lot", id: LOT_ID });
  assert(!r.ok && r.status === 404);
  db = fakeDb(() => ({ data: null, error: { code: "57014", message: "timeout" } }));
  r = await resolveLot(db, { by: "lot", id: LOT_ID });
  assert(!r.ok && r.status === 502, "a database error is not a missing lot");

  // vehicle id: the newest close wins, and the candidates are counted
  const older = lotRow({ id: "11111111-1111-1111-1111-111111111111", source_url: "https://bringatrailer.com/listing/old-lot-1", auction_end_date: "2025-01-01T00:00:00+00:00", outcome: "sold" });
  const newest = lotRow();
  const nulled = lotRow({ id: "22222222-2222-2222-2222-222222222222", source_url: "https://bringatrailer.com/listing/no-close-3", auction_end_date: null });
  db = fakeDb(() => ok([older, nulled, newest]));
  r = await resolveLot(db, { by: "vehicle_id", id: VEH_ID });
  assert(r.ok && r.lot.id === LOT_ID && r.resolution.candidates === 3, "newest close wins; a lot with no close does not");
  same(db.calls[0].filters, [["eq", "vehicle_id", VEH_ID], ["in", "source", ["bat", "bringatrailer"]]]);
  db = fakeDb(() => ok([]));
  r = await resolveLot(db, { by: "vehicle_id", id: VEH_ID });
  assert(!r.ok && r.status === 404);
});

Deno.test("resolveLot by url: the indexed vehicle hop first, the unindexed scan only on a miss", async () => {
  const locator = (): Locator => ({ by: "url", lot: batLotKey(URL_NOSLASH)! });
  const variants = [URL_NOSLASH, `${URL_NOSLASH}/`];

  // hit through vehicles.bat_auction_url: two queries, and auction_events.source_url is never scanned
  let db = fakeDb((c) => c.table === "vehicles" ? ok([{ id: VEH_ID }]) : ok([lotRow()]));
  let r = await resolveLot(db, locator());
  assert(r.ok && r.lot.id === LOT_ID);
  assert(r.ok && r.resolution.path === "vehicles.bat_auction_url -> auction_events.vehicle_id" && r.resolution.key === `bringatrailer.com/listing/${SLUG}`);
  same(db.calls.map((c) => c.table), ["vehicles", "auction_events"]);
  same(db.calls[0].filters, [["in", "bat_auction_url", variants]]);
  same(db.calls[1].filters, [["in", "vehicle_id", [VEH_ID]], ["in", "source", ["bat", "bringatrailer"]]]);

  // no vehicle holds the URL (a relist whose vehicle keeps the older URL): the lot is found by its own source_url
  db = fakeDb((c) => c.table === "vehicles" ? ok([]) : ok([lotRow()]));
  r = await resolveLot(db, locator());
  assert(r.ok && r.resolution.path === "auction_events.source_url");
  same(db.calls.map((c) => c.table), ["vehicles", "auction_events"]);
  same(db.calls[1].filters, [["in", "source_url", variants]]);

  // the vehicle is found but none of its lots is this slug (another lot of the same vehicle): scan
  const other = lotRow({ id: "33333333-3333-3333-3333-333333333333", source_url: "https://bringatrailer.com/listing/2004-land-rover-range-rover-12" });
  db = fakeDb((c) => c.table === "vehicles" ? ok([{ id: VEH_ID }]) : c.filters[0][1] === "vehicle_id" ? ok([other]) : ok([lotRow()]));
  r = await resolveLot(db, locator());
  assert(r.ok && r.lot.id === LOT_ID && r.resolution.path === "auction_events.source_url");
  same(db.calls.map((c) => c.table), ["vehicles", "auction_events", "auction_events"]);

  // two rows carry the slug (a clean URL and a junk-suffixed one): the canonical URL wins whatever its read time
  const junk = lotRow({ id: "44444444-4444-4444-4444-444444444444", source_url: `${URL_NOSLASH}/250000`, updated_at: "2026-10-07T06:50:00+00:00" });
  db = fakeDb((c) => c.table === "vehicles" ? ok([{ id: VEH_ID }]) : ok([junk, lotRow()]));
  r = await resolveLot(db, locator());
  assert(r.ok && r.lot.id === LOT_ID && r.resolution.candidates === 2, "the canonical URL wins, and both are counted");

  // nothing anywhere: a 404 that names what was tried, in order
  db = fakeDb(() => ok([]));
  r = await resolveLot(db, locator());
  assert(!r.ok && r.status === 404);
  same(!r.ok && r.tried, ["vehicles.bat_auction_url", "auction_events.source_url"]);

  // a database error at any step is a 502, not a missing lot
  db = fakeDb((c) => c.table === "vehicles" ? { data: null, error: { message: "boom" } } : ok([]));
  r = await resolveLot(db, locator());
  assert(!r.ok && r.status === 502);
});

// ---------------------------------------------------------------------------------------------------------------------

const readerOk = {
  status: "ok", reader: READER, as_of: "2026-10-07T06:59:30+00:00",
  lot: { auction_event_id: LOT_ID, vehicle_id: VEH_ID, slug: SLUG, year: 2004, make: "Land Rover", model: "Range Rover HSE" },
  clock: { ends_at: "2026-10-07T15:56:00+00:00", ends_at_source: "argument", seconds_left: 32190, regime: "hours", extensions: 0, extensions_basis: "argument" },
  band: { level: 0.8, n: 36, denominator: 38, low: 11250, mid: 19059, high: 26291, method: "cohort_ratio_upper_order_statistic" },
};

async function forecast(query: string, db: ReturnType<typeof fakeDb>, extra: { headers?: Record<string, string> } = {}) {
  const logged: string[] = [];
  const res = await handleForecast(new Request(`https://x.test/api-v1-vehicle-auction/forecast?${query}`), db, {
    headers: { "Access-Control-Allow-Origin": "*", ...(extra.headers ?? {}) },
    logUsage: (id) => { logged.push(id); },
    now: () => NOW,
  });
  return { res, body: await res.json(), logged };
}

Deno.test("handleForecast: the reader's answer, untouched, beside the resolution path and the clocks", async () => {
  const db = fakeDb(() => ok([lotRow()]), () => ({ data: readerOk, error: null }));
  const { res, body, logged } = await forecast(
    `lot=${LOT_ID}&bid=11250&bidders=12&at=2026-10-07T06:59:30Z&ends_at=2026-10-07T15:56:00Z&extensions=0`, db,
    { headers: { "X-RateLimit-Remaining": "998" } },
  );
  same(res.status, 200);
  same(res.headers.get("cache-control"), "no-store");
  same(res.headers.get("x-ratelimit-remaining"), "998");
  same(res.headers.get("access-control-allow-origin"), "*");
  same(res.headers.get("content-type"), "application/json");
  same(body.data.forecast, readerOk, "the reader's jsonb is returned verbatim");
  same(body.data.resolution.auction_event_id, LOT_ID);
  same(body.data.resolution.by, "lot");
  same(body.data.reader.name, READER);
  assert(typeof body.data.reader.elapsed_ms === "number");
  same(body.data.clocks, {
    server_now: "2026-10-07T07:00:00.000Z", at: "2026-10-07T06:59:30.000Z", at_source: "argument", at_minus_server_now_s: -30,
    ends_at_argument: "2026-10-07T15:56:00.000Z", extensions_argument: 0,
    stored_close: "2026-10-07T15:56:00+00:00", stored_lot_read_at: "2026-10-07T06:36:02.604+00:00",
    stored_outcome: "live", stored_high_bid: 11250, stored_total_bids: 14,
  });
  same(logged, [LOT_ID]);

  // the reader is called by its signature's names, with bidders an integer and every instant an ISO string
  same(db.rpcs.length, 1);
  same(db.rpcs[0].name, READER);
  same(db.rpcs[0].args, {
    p_auction_event_id: LOT_ID, p_bid: 11250, p_bidders: 12, p_at: "2026-10-07T06:59:30.000Z",
    p_ends_at: "2026-10-07T15:56:00.000Z", p_extensions: 0,
  });
  assert(Number.isInteger(db.rpcs[0].args.p_bidders) && Number.isInteger(db.rpcs[0].args.p_extensions));
});

Deno.test("handleForecast: what the caller left out is null, and the reader names what that costs", async () => {
  const db = fakeDb(() => ok([lotRow()]), () => ({ data: { ...readerOk, status: "no_bid", reason: "no current bid was given" }, error: null }));
  const { res, body } = await forecast(`lot=${LOT_ID}`, db);
  same(res.status, 200, "a reader status other than unknown_lot is an answer, not an error");
  same(body.data.forecast.status, "no_bid");
  same(db.rpcs[0].args, { p_auction_event_id: LOT_ID, p_bid: null, p_bidders: null, p_at: NOW.toISOString(), p_ends_at: null, p_extensions: null });
  same(body.data.clocks.at_source, "server_now");
  same(body.data.clocks.at_minus_server_now_s, 0);
  same(body.data.clocks.ends_at_argument, null);
});

Deno.test("handleForecast: refusals reach no database and log no usage", async () => {
  for (const [query, status] of [["", 400], ["bid=5", 400], [`lot=${LOT_ID}&bidders=2.5`, 400], [`lot=${LOT_ID}&at=2026-10-07T06:59:30`, 400]] as const) {
    const db = fakeDb(() => { throw new Error("the database must not be read"); });
    const { res, body, logged } = await forecast(query, db);
    same(res.status, status, query);
    assert(typeof body.error === "string" && body.error.length > 0);
    same(db.calls.length + db.rpcs.length, 0, `${query} read the database`);
    same(logged, []);
  }
});

Deno.test("handleForecast: an unknown lot is 404 and names what was tried", async () => {
  const db = fakeDb(() => ok([]), () => { throw new Error("the reader must not run"); });
  const { res, body, logged } = await forecast(`url=${encodeURIComponent(URL_NOSLASH)}`, db);
  same(res.status, 404);
  same(body.resolution.tried, ["vehicles.bat_auction_url", "auction_events.source_url"]);
  same(db.rpcs.length, 0);
  same(logged, []);

  // the reader itself saying unknown_lot (the row exists but is not a BaT listing it can read) is a 404 too
  const db2 = fakeDb(() => ok([lotRow()]), () => ({ data: { status: "unknown_lot", reason: "no auction_events row has this id and a Bring a Trailer listing URL" }, error: null }));
  const r2 = await forecast(`lot=${LOT_ID}&bid=100`, db2);
  same(r2.res.status, 404);
  same(r2.logged, []);
});

Deno.test("handleForecast: reader failures keep their causes apart and never leak the database's words", async () => {
  const cases: [{ code?: string; message: string }, number, string][] = [
    [{ code: "PGRST202", message: "Could not find the function public.live_lot_temperature_at(...) in the schema cache" }, 503, "not deployed"],
    [{ code: "42883", message: "function live_lot_temperature_at does not exist" }, 503, "not deployed"],
    [{ code: "57014", message: "canceling statement due to statement timeout" }, 504, "timed out"],
    [{ code: "XX000", message: "relation \"secret_table\" exploded" }, 502, "failed"],
  ];
  for (const [error, status, needle] of cases) {
    const db = fakeDb(() => ok([lotRow()]), () => ({ data: null, error }));
    const { res, body, logged } = await forecast(`lot=${LOT_ID}&bid=100`, db);
    same(res.status, status, error.code);
    assert(String(body.error).includes(needle), `${error.code}: ${body.error}`);
    assert(!JSON.stringify(body).includes("secret_table"), "the database's message stays in the log");
    same(logged, []);
  }
  const empty = fakeDb(() => ok([lotRow()]), () => ({ data: null, error: null }));
  same((await forecast(`lot=${LOT_ID}&bid=100`, empty)).res.status, 502);
});

Deno.test("handleForecast: a lot that has ended is an answer the caller can read", async () => {
  const ended = { status: "ended", as_of: NOW.toISOString(), auction_event_id: LOT_ID, ends_at: "2026-10-07T06:56:00+00:00", ends_at_source: "argument", reason: "the close time is at or before the time of the read" };
  const db = fakeDb(() => ok([lotRow()]), () => ({ data: ended, error: null }));
  const { res, body, logged } = await forecast(`lot=${LOT_ID}&bid=100&ends_at=2026-10-07T06:56:00Z`, db);
  same(res.status, 200);
  same(body.data.forecast, ended);
  same(logged, [LOT_ID]);
});
