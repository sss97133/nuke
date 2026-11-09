// deno test -A supabase/functions/mcp-connector/advisor/instant_ingest_test.ts
// T6: a BaT lot that is not in Nuke is landed through extract-bat-core inside ~10 s, then evaluated;
// only a timeout or a failed write queues it. No network, no database: everything is stubbed.
import {
  _resetInstantIngestState,
  batLotUrl,
  instantIngestBat,
  type InvokeFunction,
} from "./instant_ingest.ts";
import { handleEvaluateListing } from "./evaluate_listing.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const VID = "0b6d3a0e-1111-4222-8333-444455556666";
const LOT = "https://bringatrailer.com/listing/2026-porsche-911-gt3-rs-77/";

Deno.test("batLotUrl: lot pages canonicalise; shortlinks and other sites do not", () => {
  assert(
    batLotUrl(
      "https://www.bringatrailer.com/listing/2026-Porsche-911-gt3-rs-77",
    ) === LOT,
    "canonical",
  );
  assert(
    batLotUrl("https://bringatrailer.com/?post_type=bat-listing&p=1") === null,
    "shortlink alone",
  );
  assert(
    batLotUrl("https://bringatrailer.com/?p=1", LOT) === LOT,
    "final url wins",
  );
  assert(
    batLotUrl("https://carsandbids.com/auctions/x/y") === null,
    "other site",
  );
  assert(batLotUrl("https://bringatrailer.com/auctions/") === null, "board");
});

Deno.test("instantIngestBat: success returns the landed vehicle", async () => {
  _resetInstantIngestState();
  let called: Record<string, unknown> | null = null;
  const invoke: InvokeFunction = (name, body) => {
    called = { name, ...body };
    return Promise.resolve({
      status: 200,
      body: {
        success: true,
        created_vehicle_ids: [VID],
        updated_vehicle_ids: [],
      },
    });
  };
  const r = await instantIngestBat(invoke, LOT);
  assert(
    r.status === "ingested" && r.vehicle_id === VID && r.created,
    JSON.stringify(r),
  );
  assert(
    called!["name"] === "extract-bat-core" && called!["url"] === LOT &&
      called!["prefer_snapshot"] === false,
    JSON.stringify(called),
  );
});

Deno.test("instantIngestBat: a slow writer times out inside the budget", async () => {
  _resetInstantIngestState();
  const invoke: InvokeFunction = () => new Promise(() => {});
  const t0 = Date.now();
  const r = await instantIngestBat(invoke, LOT, { budgetMs: 60 });
  assert(r.status === "timeout" && Date.now() - t0 < 1000, JSON.stringify(r));
});

Deno.test("instantIngestBat: writer error and success-without-id are failures", async () => {
  _resetInstantIngestState();
  const r1 = await instantIngestBat(
    () =>
      Promise.resolve({
        status: 400,
        body: { error: "Invalid BaT listing URL" },
      }),
    LOT,
  );
  assert(
    r1.status === "failed" && /Invalid/.test(r1.error),
    JSON.stringify(r1),
  );
  const r2 = await instantIngestBat(
    () => Promise.resolve({ status: 200, body: { success: true } }),
    LOT,
  );
  assert(r2.status === "failed", JSON.stringify(r2));
  const r3 = await instantIngestBat(
    () => Promise.reject(new Error("The signal has been aborted")),
    LOT,
  );
  assert(r3.status === "timeout", JSON.stringify(r3));
});

Deno.test("instantIngestBat: concurrent pastes of one lot share one write; a rate cap queues the rest", async () => {
  _resetInstantIngestState();
  let n = 0;
  const invoke: InvokeFunction = () => {
    n++;
    return new Promise((res) =>
      setTimeout(
        () =>
          res({
            status: 200,
            body: { success: true, updated_vehicle_ids: [VID] },
          }),
        20,
      )
    );
  };
  const [a, b] = await Promise.all([
    instantIngestBat(invoke, LOT),
    instantIngestBat(invoke, LOT),
  ]);
  assert(
    n === 1 && a.status === "ingested" && b.status === "ingested",
    `writes ${n}`,
  );
  _resetInstantIngestState();
  const fast: InvokeFunction = () =>
    Promise.resolve({
      status: 200,
      body: { success: true, updated_vehicle_ids: [VID] },
    });
  const out = [];
  for (let i = 0; i < 21; i++) {
    out.push(await instantIngestBat(fast, `${LOT}?i=${i}`));
  }
  assert(
    out.slice(0, 20).every((r) => r.status === "ingested") &&
      out[20]!.status === "skipped",
    "cap at 20 per 5 min",
  );
  assert(
    instantIngestBat(undefined, LOT).then((r) => r.status === "skipped"),
    "no invoker",
  );
});

// ---- evaluate_listing wiring --------------------------------------------------------------------------

const PAGE =
  `<html><head><meta property="og:title" content="2026 Porsche 911 GT3 RS">
<script type="application/ld+json">{"@type":"Product","name":"2026 Porsche 911 GT3 RS","description":"PDK","offers":{"price":400000}}</script></head>
<body><h1 data-testid="listing-post-title">2026 Porsche 911 GT3 RS</h1>
<span class="listing-available-countdown" data-until="${
    Math.floor(Date.now() / 1000) + 6 * 86400
  }"></span>Place Bid</body></html>`;

function withPage<T>(
  status: number,
  finalUrl: string,
  fn: () => Promise<T>,
): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    if (String(input).includes("bringatrailer.com")) {
      const r = new Response(
        status === 200
          ? PAGE
          : "<html><head><title>Page not found</title></head></html>",
        { status },
      );
      return Promise.resolve(
        Object.defineProperty(r, "url", { value: finalUrl }),
      );
    }
    return Promise.reject(new Error("no network in test"));
  }) as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = real;
  });
}

/** A DB with no vehicle for the URL; once "landed", vehicles.id = VID reads back. Records rpc calls. */
function stubDb(opts: { landed: boolean }) {
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  const chain = (table: string): unknown => {
    const filters: Array<[string, unknown]> = [];
    const p: Record<string, unknown> = {};
    for (
      const m of [
        "select",
        "in",
        "ilike",
        "is",
        "not",
        "or",
        "order",
        "limit",
        "gte",
        "lte",
        "neq",
      ]
    ) p[m] = () => p;
    p.eq = (col: string, v: unknown) => {
      filters.push([col, v]);
      return p;
    };
    p.maybeSingle = () => Promise.resolve({ data: null, error: null });
    p.then = (res: (v: unknown) => unknown) => {
      const hit = table === "vehicles" && opts.landed &&
        filters.some(([c, v]) => c === "id" && v === VID);
      const data = hit
        ? [{
          id: VID,
          year: 2026,
          make: "Porsche",
          model: "911 GT3 RS",
          listing_url: LOT.slice(0, -1),
          mileage: 150,
        }]
        : [];
      return Promise.resolve({ data, error: null }).then(res);
    };
    return p;
  };
  return {
    rpcs,
    db: {
      from: (t: string) => chain(t),
      rpc: (name: string, args: Record<string, unknown>) => {
        rpcs.push({ name, args });
        return Promise.resolve({
          data: name === "log_listing_coverage"
            ? { success: true, queued: args.p_vehicle_id == null }
            : [],
          error: null,
        });
      },
    },
  };
}

Deno.test("evaluate_listing: a BaT miss is landed now and evaluated as a matched lot", async () => {
  _resetInstantIngestState();
  const s = stubDb({ landed: true });
  const calls: string[] = [];
  const invoke: InvokeFunction = (name, body) => {
    calls.push(`${name} ${body.url}`);
    return Promise.resolve({
      status: 200,
      body: { success: true, created_vehicle_ids: [VID] },
    });
  };
  const res = await withPage(
    200,
    LOT,
    () =>
      handleEvaluateListing({
        sb: () => s.db,
        callEdgeApi: () => Promise.resolve({ data: [] }),
        invokeFunction: invoke,
      }, { url: LOT }),
  );
  const sc = res.structuredContent as unknown as Record<string, unknown>;
  const ingest = sc.ingest as Record<string, unknown>;
  assert(
    calls.length === 1 && calls[0] === `extract-bat-core ${LOT}`,
    calls.join(),
  );
  assert(
    ingest?.status === "ingested" && ingest.vehicle_id === VID,
    JSON.stringify(ingest),
  );
  assert(sc.matched_asset_id === VID, `matched ${sc.matched_asset_id}`);
  const cov = s.rpcs.find((r) => r.name === "log_listing_coverage")!;
  assert(
    cov.args.p_vehicle_id === VID &&
      cov.args.p_match_method === "instant_ingest",
    JSON.stringify(cov.args),
  );
  assert(
    /landed now from the BaT page/.test(String(sc.markdown_summary)),
    "markdown says landed",
  );
});

Deno.test("evaluate_listing: an ingest timeout queues the canonical lot URL (old path)", async () => {
  _resetInstantIngestState();
  const s = stubDb({ landed: false });
  const res = await withPage(200, LOT, () =>
    handleEvaluateListing({
      sb: () => s.db,
      callEdgeApi: () => Promise.resolve({ data: [] }),
      invokeFunction: () => new Promise(() => {}),
      instantIngestBudgetMs: 50,
    }, { url: LOT.slice(0, -1) }));
  const sc = res.structuredContent as unknown as Record<string, unknown>;
  const ingest = sc.ingest as Record<string, unknown>;
  assert(
    ingest?.status === "timeout" && ingest.queued === true,
    JSON.stringify(ingest),
  );
  const cov = s.rpcs.find((r) => r.name === "log_listing_coverage")!;
  assert(
    cov.args.p_vehicle_id === null && cov.args.p_url === LOT,
    JSON.stringify(cov.args),
  );
  assert(sc.matched_asset_id === null, "not matched");
});

Deno.test("evaluate_listing: a ?p= shortlink is landed under the lot URL it redirects to", async () => {
  _resetInstantIngestState();
  const s = stubDb({ landed: true });
  const seen: string[] = [];
  const res = await withPage(200, LOT, () =>
    handleEvaluateListing({
      sb: () => s.db,
      callEdgeApi: () => Promise.resolve({ data: [] }),
      invokeFunction: (_n, b) => {
        seen.push(String(b.url));
        return Promise.resolve({
          status: 200,
          body: { success: true, updated_vehicle_ids: [VID] },
        });
      },
    }, { url: "https://bringatrailer.com/?post_type=bat-listing&p=1234567" }));
  assert(seen[0] === LOT, seen.join());
  assert(
    (res.structuredContent as unknown as Record<string, unknown>)
      .matched_asset_id === VID,
    "matched",
  );
});

Deno.test("evaluate_listing: a BaT 404 (the Nov 5 shortlink case) is an error, never ingested or queued", async () => {
  _resetInstantIngestState();
  const s = stubDb({ landed: false });
  let invoked = 0;
  const res = await withPage(
    404,
    "https://bringatrailer.com/?p=126086136",
    () =>
      handleEvaluateListing({
        sb: () => s.db,
        callEdgeApi: () => Promise.resolve({ data: [] }),
        invokeFunction: () => {
          invoked++;
          return Promise.resolve({ status: 200, body: {} });
        },
      }, {
        url: "https://bringatrailer.com/?post_type=bat-listing&p=126086136",
      }),
  );
  assert(res.isError === true, "error");
  assert(
    invoked === 0 && !s.rpcs.some((r) => r.name === "log_listing_coverage"),
    "no ingest, no queue",
  );
});

Deno.test("evaluate_listing: without an invoker (tests, harness) a miss only queues, as before", async () => {
  _resetInstantIngestState();
  const s = stubDb({ landed: false });
  const res = await withPage(
    200,
    LOT,
    () =>
      handleEvaluateListing({
        sb: () => s.db,
        callEdgeApi: () => Promise.resolve({ data: [] }),
      }, { url: LOT }),
  );
  const sc = res.structuredContent as unknown as Record<string, unknown>;
  assert(
    sc.ingest === null || sc.ingest === undefined,
    JSON.stringify(sc.ingest),
  );
  const cov = s.rpcs.find((r) => r.name === "log_listing_coverage")!;
  assert(cov.args.p_vehicle_id === null, "queued");
});

Deno.test("a just-listed lot with no bids reads 'no bids yet', not 'current bid $0 — below'", async () => {
  _resetInstantIngestState();
  const until = Math.floor(Date.now() / 1000) + 7 * 86400;
  const html =
    `<html><head><meta property="og:title" content="1991 Porsche 911 Turbo">
<script type="application/ld+json">{"@type":"Product","name":"1991 Porsche 911 Turbo","offers":{"price":0}}</script></head>
<body><span class="listing-available-countdown" data-until="${until}"></span>Bidding Open Place Bid</body></html>`;
  const comps = [205000, 209000, 212000, 216000, 218000].map((p, i) => ({
    vehicle_id: null,
    yr: 1991,
    mk: "Porsche",
    mdl: "911 Turbo",
    sale_price: p,
    listing_url: `https://bringatrailer.com/listing/1991-porsche-911-turbo-${
      i + 20
    }/`,
    platform: "bat",
    sold_date: `2026-0${i + 1}-01`,
  }));
  const chain = (): unknown => {
    const p: Record<string, unknown> = {};
    for (
      const m of [
        "select",
        "eq",
        "in",
        "ilike",
        "is",
        "not",
        "or",
        "order",
        "limit",
      ]
    ) p[m] = () => p;
    p.maybeSingle = () => Promise.resolve({ data: null, error: null });
    p.then = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(res);
    return p;
  };
  const db = {
    from: () => chain(),
    rpc: (n: string) =>
      Promise.resolve({
        data: n === "get_comps_combined" ? comps : [],
        error: null,
      }),
  };
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
    }, {
      url: "https://bringatrailer.com/listing/1991-porsche-911-turbo-106/",
    });
    const v = String(
      (res.structuredContent as unknown as Record<string, unknown>).verdict,
    );
    assert(/auction live, no bids yet/.test(v) && !/\$0/.test(v), v);
  } finally {
    globalThis.fetch = real;
  }
});
