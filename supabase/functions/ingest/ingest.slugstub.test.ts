// Run: deno test --no-check --allow-env supabase/functions/ingest/ingest.slugstub.test.ts
// (--no-check: type-checking the esm.sh import graph asks for npm:@types/node, which a checkout without node_modules lacks.)
// Drives the real `ingest` handler end to end with the network stubbed: PostgREST answers "no rows" to every read
// and records every write, and the extractor functions answer whatever each test says. It proves the slug-stub rule
// where it matters: a venue whose extractor failed gets a rejection and no write at all, a venue whose extractor
// worked still lands, and BaT is untouched.
//
// The stub is installed before `index.ts` is imported, because supabase-js binds the global fetch when the module
// creates its client.
import { extractFromHtml } from "../extract-craigslist/extract.ts";

const SUPABASE_URL = "https://stub.supabase.test";
const SERVICE_KEY = "test-service-role-key";
Deno.env.set("SUPABASE_URL", SUPABASE_URL);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);

interface Seen {
  method: string;
  url: string;
  path: string;
  body: string | null;
}

let seen: Seen[] = [];
let persistedVehicle: Record<string, unknown> | null = null;
let publicPage: ((req: Request) => Response) | null = null;
let clWorld: { observationId?: string; event?: Record<string, unknown>; failEventOnce?: boolean; failObservation?: boolean; afterEventRead?: () => void } | null = null;
let cachedArchive: { id: string; fetched_at: string; html: string } | null = null;
let extractor: (name: string, body: Record<string, unknown>) => Response = () => json({ error: "no extractor stubbed" }, 500);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// deno-lint-ignore no-explicit-any
(globalThis as any).fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const req = new Request(input, init);
  const url = new URL(req.url);
  const isRead = req.method === "GET" || req.method === "HEAD";
  const body = isRead ? null : await req.clone().text();
  seen.push({ method: req.method, url: req.url, path: url.pathname, body });

  if (url.hostname === "craigslist.org" || url.hostname.endsWith(".craigslist.org")) {
    if (!publicPage) throw new Error("unexpected public source request");
    return publicPage(req);
  }
  if (url.pathname.startsWith("/functions/v1/")) {
    const name = url.pathname.slice("/functions/v1/".length);
    return extractor(name, body ? JSON.parse(body) : {});
  }
  if (url.pathname.startsWith("/auth/v1/")) return json({ code: 401, msg: "invalid JWT" }, 401);
  if (url.pathname.startsWith("/rest/v1/")) {
    const wantsObject = (req.headers.get("accept") ?? "").includes("vnd.pgrst.object");
    if (cachedArchive && isRead && url.pathname === "/rest/v1/listing_page_snapshots") {
      return json(url.searchParams.has("id") ? { id: cachedArchive.id, fetched_at: cachedArchive.fetched_at } : [cachedArchive]);
    }
    if (clWorld) {
      if (url.pathname === "/rest/v1/observation_sources" && isRead) return json({ id: "source-craigslist", base_trust_score: 0.4, supported_observations: ["listing"] });
      if (url.pathname === "/rest/v1/vehicle_observations") {
        if (isRead) return json(clWorld.observationId ? { id: clWorld.observationId } : null);
        if (clWorld.failObservation) return json({ message: "observation unavailable", code: "57014" }, 500);
        clWorld.observationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        return json({ id: clWorld.observationId }, 201);
      }
      if (url.pathname === "/rest/v1/vehicle_events") {
        if (isRead) {
          const response = json(clWorld.event ? [clWorld.event] : []);
          if (url.searchParams.get("select")?.includes("metadata")) {
            clWorld.afterEventRead?.();
            clWorld.afterEventRead = undefined;
          }
          return response;
        }
        if (req.method === "PATCH" && url.searchParams.get("metadata") !== `eq.${JSON.stringify(clWorld.event?.metadata)}`) return json([]);
        if (clWorld.failEventOnce) {
          clWorld.failEventOnce = false;
          return json({ message: "projection unavailable", code: "57014" }, 500);
        }
        clWorld.event = { ...clWorld.event, ...JSON.parse(body!), id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
        return json([{ id: clWorld.event.id }], req.method === "POST" ? 201 : 200);
      }
    }
    if (isRead) {
      if (url.pathname === "/rest/v1/vehicles" && persistedVehicle &&
        (url.searchParams.get("id") === `eq.${persistedVehicle.id}` ||
         url.searchParams.get("listing_url") === `eq.${persistedVehicle.listing_url}`)) {
        return json(wantsObject ? persistedVehicle : [persistedVehicle]);
      }
      if (wantsObject) {
        return json({ code: "PGRST116", details: "The result contains 0 rows", hint: null, message: "JSON object requested, multiple (or no) rows returned" }, 406);
      }
      return new Response(req.method === "HEAD" ? null : "[]", {
        status: 200,
        headers: { "content-type": "application/json", "content-range": "*/0" },
      });
    }
    const row = { id: crypto.randomUUID() };
    if (clWorld && url.pathname === "/rest/v1/vehicles" && req.method === "POST") persistedVehicle = { ...JSON.parse(body!), ...row };
    return json(wantsObject ? row : [row], req.method === "POST" ? 201 : 200);
  }
  throw new Error(`unexpected request ${req.method} ${req.url}`);
};

let handler: ((req: Request) => Response | Promise<Response>) | null = null;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (...args: any[]) => {
  handler = typeof args[0] === "function" ? args[0] : args[1];
  return { finished: Promise.resolve(), shutdown: () => Promise.resolve() };
};

await import("./index.ts");

// ── helpers ────────────────────────────────────────────────────────────────

async function ingest(body: Record<string, unknown>) {
  seen = [];
  const res = await handler!(new Request("https://test.local/functions/v1/ingest", {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { status: res.status, result: await res.json() };
}

const writes = () => seen.filter((r) => r.path.startsWith("/rest/v1/") && r.method !== "GET" && r.method !== "HEAD");
const vehicleInserts = () => writes().filter((r) => r.path === "/rest/v1/vehicles" && r.method === "POST");
const extractorCalls = () => seen.filter((r) => r.path.startsWith("/functions/v1/")).map((r) => r.path.slice("/functions/v1/".length));

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const OPENAI_NO_CREDITS =
  '{"success":false,"error":"OpenAI API error: 429 - {\\n \\"error\\": {\\n \\"message\\": \\"You have no credits remaining. Add credits to continue using the API';

const SLUG_VENUES: Array<{ platform: string; url: string; extractor: string }> = [
  { platform: "classiccars", url: "https://classiccars.com/listings/view/2089229/1993-chevrolet-corvette-for-sale-in-cleveland-ohio-44128", extractor: "extract-vehicle-data-ai" },
  { platform: "mecum", url: "https://www.mecum.com/lots/1177355/2005-hummer-h2", extractor: "extract-mecum" },
  { platform: "barrett_jackson", url: "https://www.barrett-jackson.com/2026-columbus/docket/vehicle/1951-plymouth-cranbrook-300183", extractor: "extract-barrett-jackson" },
  { platform: "hagerty", url: "https://www.hagerty.com/marketplace/auction/1965-Ford-Mustang/ce62f601-14d5-4090-9489-2287744182ee", extractor: "extract-hagerty-listing" },
  { platform: "cars_and_bids", url: "https://carsandbids.com/auctions/AbCd1234/2003-porsche-911-carrera-coupe", extractor: "extract-cars-and-bids-core" },
  { platform: "pcarmarket", url: "https://www.pcarmarket.com/auction/1959-porsche-356a-3", extractor: "import-pcarmarket-listing" },
  { platform: "vanguard_motors", url: "https://www.vanguardmotorsales.com/inventory/5686/1970-plymouth-gtx", extractor: "extract-vehicle-data-ai" },
  { platform: "allcollectorcars", url: "https://www.allcollectorcars.com/classic-car-auctions/vehicles/1949-chevrolet-styleline-sport-coupe", extractor: "extract-vehicle-data-ai" },
  { platform: "autohunter", url: "https://autohunter.com/Listing/Details/90844982/1966-PLYMOUTH-SATELLITE-CUSTOM-HARDTOP", extractor: "extract-vehicle-data-ai" },
  { platform: "carandclassic", url: "https://www.carandclassic.com/auctions/1972-mercedes-benz-350slc-c107-n7kb3n", extractor: "extract-vehicle-data-ai" },
];

const SUCCESS_BODY = {
  success: true,
  data: {
    year: 1993, make: "Chevrolet", model: "Corvette", price: 24500,
    description: "Two owners, recent service.", image_urls: ["https://images.example.test/listing/1/1.jpg"], vin: null,
  },
};

const SHARE_URL = "https://www.craigslist.org/view/d/fixture-1993-chevrolet-corvette/FixtureShareToken";
const SHARE_HTML = `<html><head><link href="${SHARE_URL}" rel="canonical">
<script type="application/ld+json" id="ld_posting_data">{"name":"1993 Chevrolet Corvette","offers":{"price":2345},"image":["https://images.example.test/fixture.jpg"]}</script></head><body>
<div class="attrgroup"><div class="attr important"><span class="valu year">1993</span><span class="valu makemodel">chevrolet corvette</span></div>
<div class="attr auto_transmission"><span class="labl">transmission:</span><span class="valu">manual</span></div></div>
<section id="postingbody">Fixture listing description with retained source testimony.</section>
<p class="postinginfo">post id: 1000000001</p><p class="postinginfo">posted: <time datetime="2024-01-02T03:04:05-0800">fixture date</time></p><!-- ${'fixture padding '.repeat(100)} --></body></html>`;

Deno.test({
  name: "Craigslist full canonical share keeps observed URL and native post id through existing intake",
  sanitizeOps: false, sanitizeResources: false,
  fn: async () => {
    publicPage = () => new Response(SHARE_HTML);
    extractor = (name, body) => {
      equal(name, "extract-craigslist"); equal(body.url, SHARE_URL); equal(body.save_to_db, false);
      return json({ success: true, extracted: extractFromHtml(SHARE_HTML, SHARE_URL) });
    };
    try {
      const { result } = await ingest({ url: SHARE_URL });
      equal(result.status, "created"); equal(result.external_id, "1000000001");
      equal(result.listing_capture.post_id, "1000000001");
      // The existing vehicle URL normalizer strips www; the observed share path stays intact.
      equal(JSON.parse(vehicleInserts()[0].body!).listing_url, SHARE_URL.replace("www.", ""));
      equal(extractorCalls(), ["extract-craigslist"]);
      assert(!seen.some(r => { const host = new URL(r.url).hostname; return (host === "craigslist.org" || host.endsWith(".craigslist.org")) && r.url !== SHARE_URL; }), "no manufactured regional source request");
    } finally { publicPage = null; }
  },
});

for (const [kind, html] of [
  ["missing native id", SHARE_HTML.replace('<p class="postinginfo">post id: 1000000001</p>', '')],
  ["foreign canonical", SHARE_HTML.replace(`href="${SHARE_URL}"`, 'href="https://outside.example/fixture"')],
  ["foreign canonical with nested Craigslist URL", SHARE_HTML.replace(`href="${SHARE_URL}"`, 'href="https://outside.example/?next=https://sample.craigslist.org/cto/d/fixture/1000000002.html"')],
  ["no canonical expired page with recommendation", `<h1>Posting expired</h1><a href="https://sample.craigslist.org/cto/d/fixture/1000000002.html">Recommendation</a>${' '.repeat(1200)}`],
  ["expired shell with recommendation", `<link rel="canonical" href="${SHARE_URL}"><h1>Posting expired</h1><a href="https://sample.craigslist.org/cto/d/fixture/1000000002.html">Recommendation</a>${' '.repeat(1200)}`],
] as const) {
  Deno.test({
    name: `Craigslist share ${kind} rejects before enrichment or vehicle creation`,
    sanitizeOps: false, sanitizeResources: false,
    fn: async () => {
      publicPage = () => new Response(html);
      try {
        const { result } = await ingest({ url: SHARE_URL });
        equal(result.status, "rejected"); equal(result.external_id, null);
        assert(result.enrichment_error.includes(kind.startsWith("foreign") || kind.startsWith("no canonical") ? "no canonical listing URL" : "lacks full listing evidence"), "resolver inspected the retained HTML");
        equal(extractorCalls(), []); equal(vehicleInserts(), []);
      } finally { publicPage = null; }
    },
  });
}

Deno.test({
  name: "Craigslist share disagreement between source and extracted post ids rejects before vehicle creation",
  sanitizeOps: false, sanitizeResources: false,
  fn: async () => {
    publicPage = () => new Response(SHARE_HTML);
    extractor = () => json({ success: true, extracted: { ...extractFromHtml(SHARE_HTML, SHARE_URL), post_id: "1000000009" } });
    try {
      const { result } = await ingest({ url: SHARE_URL });
      equal(result.status, "rejected"); equal(result.external_id, "1000000001");
      assert(result.enrichment_error.includes("identity mismatch"), "disagreement stays explicit");
      equal(vehicleInserts(), []);
    } finally { publicPage = null; }
  },
});

Deno.test({
  name: "Craigslist legacy regional redirect still resolves its observed numeric post id",
  sanitizeOps: false, sanitizeResources: false,
  fn: async () => {
    const canonical = "https://sample.craigslist.org/cto/d/fixture-1993-chevrolet-corvette/1000000002.html";
    publicPage = () => new Response(`<link rel="canonical" href="${canonical}">${' '.repeat(1200)}`);
    extractor = (name, body) => { equal(name, "extract-craigslist"); equal(body.url, canonical); return json({ success: true, extracted: SUCCESS_BODY.data }); };
    try {
      const { result } = await ingest({ url: SHARE_URL });
      equal(result.status, "created"); equal(result.external_id, "1000000002");
      equal(JSON.parse(vehicleInserts()[0].body!).listing_url, canonical);
    } finally { publicPage = null; }
  },
});

Deno.test({
  name: "Craigslist-looking foreign targets reject without a source request",
  sanitizeOps: false, sanitizeResources: false,
  fn: async () => {
    const { result } = await ingest({ url: `https://outside.example/?next=${SHARE_URL}` });
    equal(result.status, "rejected"); equal(result.enrichment_error, "Invalid Craigslist share URL");
    equal(extractorCalls(), []); equal(writes(), []);
    assert(!seen.some(r => new URL(r.url).hostname !== new URL(SUPABASE_URL).hostname), "no foreign or source fetch");
  },
});

Deno.test({
  name: "Craigslist preview never treats the opaque share token as a native post id or fetches",
  sanitizeOps: false, sanitizeResources: false,
  fn: async () => {
    const { result } = await ingest({ url: SHARE_URL, preview: true });
    equal(result.status, "preview"); equal(result.external_id, null); equal(extractorCalls(), []); equal(writes(), []);
    assert(!seen.some(r => { const host = new URL(r.url).hostname; return host === "craigslist.org" || host.endsWith(".craigslist.org"); }), "preview stays source-read free");
  },
});

// ── a slug-stub venue whose extractor failed is rejected, and nothing is written ──

for (const v of SLUG_VENUES) {
  Deno.test({
    name: `${v.platform}: the extractor failed, so ingest rejects with enrichment_failed and writes nothing`,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      extractor = () => new Response(OPENAI_NO_CREDITS, { status: 500, headers: { "content-type": "application/json" } });
      const { status, result } = await ingest({ url: v.url });
      equal(status, 200);
      equal(result.status, "rejected");
      assert(String(result.reason).startsWith("enrichment_failed: "), `reason names enrichment_failed, got ${result.reason}`);
      assert(String(result.enrichment_error).includes("no credits remaining"), "the extractor's own error travels with the rejection");
      equal(result.source, v.platform);
      equal(extractorCalls(), [v.extractor]);
      equal(writes().length, 0); // no vehicle, no image row, no merge proposal: no write of any kind
    },
  });
}

// ── a venue whose extractor worked still lands ────────────────────────────────

Deno.test({
  name: "classiccars: the extractor worked, so the vehicle is created with what it returned",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    extractor = () => json(SUCCESS_BODY);
    const { result } = await ingest({ url: SLUG_VENUES[0].url });
    equal(result.status, "created");
    equal(result.enrichment_error, undefined);
    equal(vehicleInserts().length, 1);
    const row = JSON.parse(vehicleInserts()[0].body!);
    equal([row.year, row.make, row.model, row.asking_price, row.status], [1993, "Chevrolet", "Corvette", 24500, "discovered"]);
    equal(row.description, "Two owners, recent service.");
  },
});

// A sanitized source case through the real ingest handler, observation writer and keyed event writer.
Deno.test({
  name: "Craigslist retained observation ACK bridges to one parent/native listing episode; partial failure retries without another observation",
  sanitizeOps: false, sanitizeResources: false,
  fn: async () => {
    const listingUrl = "https://lasvegas.craigslist.org/cto/d/1993-chevrolet-corvette/1234567890.html";
    const sourceCapture = { snapshot_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", observed_at: "2026-01-04T01:02:03.000Z" };
    const data = { ...SUCCESS_BODY.data, post_id: "1234567890", posted_at: "2026-01-02T01:02:03.000Z", updated_at: null,
      source_capture: sourceCapture, attributes: { raw: { year: "1993", makemodel: "chevrolet corvette" }, odometer: 12345 } };
    extractor = () => json({ success: true, extracted: data });
    clWorld = { failEventOnce: true };
    try {
      const first = (await ingest({ url: listingUrl, notes: "Caller notes disagree with the seller's account." })).result;
      equal(first.status, "created");
      const observation = JSON.parse(writes().find(r => r.path === "/rest/v1/vehicle_observations")!.body!);
      equal([observation.vehicle_id, observation.source_identifier, observation.source_url, observation.observed_at],
        [first.vehicle_id, data.post_id, listingUrl, sourceCapture.observed_at]);
      equal(observation.content_text, data.description);
      equal(first.listing_capture.capture_landing.observation, "written");
      equal(first.listing_capture.capture_landing.listing_event.action, "error");
      const retry = (await ingest({ url: listingUrl })).result;
      equal(retry.vehicle_id, first.vehicle_id);
      equal(retry.listing_capture.capture_landing.observation, "duplicate");
      equal(writes().filter(r => r.path === "/rest/v1/vehicle_observations").length, 0);
      equal(retry.listing_capture.capture_landing.listing_event.action, "inserted");
      equal([clWorld.event!.vehicle_id, clWorld.event!.source_platform, clWorld.event!.source_listing_id, clWorld.event!.source_url,
        clWorld.event!.event_type, clWorld.event!.event_status, clWorld.event!.current_price],
        [first.vehicle_id, "craigslist", data.post_id, listingUrl, "listing", "unknown", data.price]);
      const metadata = clWorld.event!.metadata as Record<string, unknown>;
      equal([metadata.observation_id, metadata.snapshot_id, metadata.source_observed_at],
        [clWorld.observationId, sourceCapture.snapshot_id, sourceCapture.observed_at]);
      const replay = (await ingest({ url: listingUrl })).result;
      equal(replay.listing_capture.capture_landing.listing_event.action, "updated");
      equal(writes().filter(r => r.path === "/rest/v1/vehicle_events" && r.method === "POST").length, 0);
      clWorld.event!.event_status = "sold";
      clWorld.event!.current_price = 26000;
      clWorld.event!.metadata = { ...metadata, source_observed_at: "2026-01-05T01:02:03.000Z" };
      const stale = (await ingest({ url: listingUrl })).result;
      equal(stale.listing_capture.capture_landing.listing_event, { action: "skipped", reason: "older source observation" });
      equal(writes().filter(r => r.path === "/rest/v1/vehicle_events").length, 0);
      equal([clWorld.event!.event_status, clWorld.event!.current_price], ["sold", 26000]);
      clWorld.event!.metadata = metadata;
      clWorld.afterEventRead = () => {
        clWorld!.event!.metadata = { ...metadata, source_observed_at: "2026-01-06T01:02:03.000Z", clock_locked_by_supersession: true };
        clWorld!.event!.current_price = 27000;
      };
      const raced = (await ingest({ url: listingUrl })).result;
      equal(raced.listing_capture.capture_landing.listing_event, { action: "skipped", reason: "listing changed during projection; retry" });
      equal(clWorld.event!.current_price, 27000);
      equal((clWorld.event!.metadata as Record<string, unknown>).clock_locked_by_supersession, true);
    } finally { clWorld = null; persistedVehicle = null; }
  },
});

Deno.test({
  name: "Craigslist prose without a valid snapshot and source clock is withheld while existing attributes still land",
  sanitizeOps: false, sanitizeResources: false,
  fn: async () => {
    const listingUrl = "https://lasvegas.craigslist.org/cto/d/1993-chevrolet-corvette/1234567890.html";
    for (const source_capture of [
      undefined,
      { snapshot_id: "not-a-snapshot-id", observed_at: "2026-01-04T01:02:03.000Z" },
      { snapshot_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", observed_at: "unknown" },
    ]) {
      extractor = () => json({ success: true, extracted: { ...SUCCESS_BODY.data, source_capture,
        post_id: "1234567890", attributes: { raw: { year: "1993" }, odometer: 12345 } } });
      clWorld = {};
      try {
        const { result } = await ingest({ url: listingUrl });
        equal(result.status, "created");
        const observation = JSON.parse(writes().find(r => r.path === "/rest/v1/vehicle_observations")!.body!);
        equal(observation.content_text, undefined);
        equal(observation.structured_data.mileage, 12345);
        equal(observation.extraction_metadata.raw.source_capture, undefined);
      } finally { clWorld = null; persistedVehicle = null; }
    }
  },
});

Deno.test({
  name: "Craigslist missing source prose stays unknown despite caller notes or a caller description",
  sanitizeOps: false, sanitizeResources: false,
  fn: async () => {
    const listingUrl = "https://lasvegas.craigslist.org/cto/d/1993-chevrolet-corvette/1234567890.html";
    const notes = "Caller recollection must not become the seller's testimony.";
    for (const description of [null, "   "]) {
      extractor = () => json({ success: true, extracted: { ...SUCCESS_BODY.data, description,
        post_id: "1234567890", attributes: { raw: { year: "1993" }, odometer: 12345 },
        source_capture: { snapshot_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", observed_at: "2026-01-04T01:02:03.000Z" } } });
      clWorld = {};
      try {
        const { result } = await ingest({ url: listingUrl, notes });
        equal(result.status, "created");
        const observation = JSON.parse(writes().find(r => r.path === "/rest/v1/vehicle_observations")!.body!);
        equal(observation.content_text, undefined);
      } finally { clWorld = null; persistedVehicle = null; }
    }
    clWorld = {};
    try {
      await ingest({ url: listingUrl, year: 1993, make: "Chevrolet", model: "Corvette", description: notes });
      equal(extractorCalls(), []);
      equal(writes().filter(r => r.path === "/rest/v1/vehicle_observations").length, 0);
    } finally { clWorld = null; persistedVehicle = null; }
  },
});

Deno.test({
  name: "Craigslist cannot project a listing episode without canonical observation ACK or archive clock receipt",
  sanitizeOps: false, sanitizeResources: false,
  fn: async () => {
    for (const failObservation of [true, false]) {
      const data = { ...SUCCESS_BODY.data, post_id: "1234567890", posted_at: "2026-01-02T01:02:03.000Z",
        attributes: { raw: { year: "1993" } }, ...(failObservation ? { source_capture: {
          snapshot_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", observed_at: "2026-01-04T01:02:03.000Z" } } : {}) };
      extractor = () => json({ success: true, extracted: data });
      clWorld = { failObservation };
      try {
        await ingest({ url: "https://lasvegas.craigslist.org/cto/d/1993-chevrolet-corvette/1234567890.html" });
        equal(writes().filter(r => r.path === "/rest/v1/vehicle_events").length, 0);
      } finally { clWorld = null; persistedVehicle = null; }
    }
  },
});

Deno.test({
  name: "every one of the ten venues still lands when its extractor works",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    for (const v of SLUG_VENUES) {
      extractor = () => json(SUCCESS_BODY);
      const { result } = await ingest({ url: v.url });
      equal([v.platform, result.status], [v.platform, "created"]);
      equal([v.platform, vehicleInserts().length], [v.platform, 1]);
    }
  },
});

// ── what the rule leaves alone ────────────────────────────────────────────────

Deno.test({
  name: "dedicated writers use the persisted canonical vehicle, not response summaries or a second vehicle",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    for (const platform of ["mecum", "barrett_jackson", "pcarmarket", "cars_and_bids"]) {
      const venue = SLUG_VENUES.find(v => v.platform === platform)!;
      persistedVehicle = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", year: 1993, make: "Chevrolet", model: "Corvette",
        listing_url: venue.url + "/", description: "The retained source description.", primary_image_url: "https://images.example.test/1.jpg" };
      extractor = () => json({ success: true, vehicle_id: persistedVehicle!.id,
        vehicle: { year: 1993, make: "Chevrolet", model: "Corvette", description: "600 chars", images: 42 } });
      try {
        const { result } = await ingest({ url: venue.url });
        equal(result.vehicle_id, persistedVehicle.id);
        equal(vehicleInserts().length, 0);
        equal(extractorCalls(), [venue.extractor]);
        assert(!writes().some(w => w.body?.includes("600 chars")), "a summary must never become testimony");
      } finally { persistedVehicle = null; }
    }
  },
});

Deno.test({
  name: "a writer id with no readable vehicle fails closed instead of trusting its summary",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    extractor = () => json({ success: true, vehicle_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", vehicle: SUCCESS_BODY.data });
    const { result } = await ingest({ url: SLUG_VENUES[1].url });
    equal(result.status, "rejected");
    assert(result.enrichment_error.includes("read-back failed"), "read-back failure is exposed");
    equal(writes().length, 0);
  },
});

Deno.test({
  name: "BaT is unaffected: a failed extract-bat-core still creates the vehicle, with the error recorded",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    extractor = () => json({ error: "boom" }, 500);
    const { result } = await ingest({ url: "https://bringatrailer.com/listing/1970-chevrolet-chevelle-ss/" });
    equal(result.status, "created");
    assert(String(result.enrichment_error).includes("extract-bat-core HTTP 500"), "the BaT failure is reported, not turned into a rejection");
    equal(vehicleInserts().length, 1);
  },
});

Deno.test({
  name: "an identity the caller supplied is trusted: a failed extractor does not reject it",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    extractor = () => new Response(OPENAI_NO_CREDITS, { status: 500 });
    const { result } = await ingest({ url: SLUG_VENUES[0].url, year: 1993, make: "Chevrolet", model: "Corvette" });
    equal(result.status, "created");
    equal(vehicleInserts().length, 1);
  },
});

Deno.test({
  name: "enrich false runs no extractor, so nothing failed and the slug identity still creates the vehicle",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    extractor = () => json({ error: "must not be called" }, 500);
    const { result } = await ingest({ url: SLUG_VENUES[0].url, enrich: false });
    equal(result.status, "created");
    equal(extractorCalls(), []);
    equal(vehicleInserts().length, 1);
  },
});

Deno.test({
  name: 'native auction-house hosts use their parser contracts and verified persisted ids',
  sanitizeOps: false, sanitizeResources: false,
  fn: async () => {
    for (const [host, name] of [['goodingco.com', 'extract-gooding'], ['rmsothebys.com', 'extract-rmsothebys'],
      ['cars.bonhams.com', 'extract-bonhams'], ['broadarrowauctions.com', 'extract-broad-arrow']]) {
      const url = `https://${host}/lot/1993-chevrolet-corvette/`;
      persistedVehicle = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', year: 1993, make: 'Chevrolet', model: 'Corvette',
        listing_url: url, description: 'Retained source text' };
      extractor = () => json({ success: true, _db: { vehicle_id: persistedVehicle!.id } });
      try {
        const { result } = await ingest({ url });
        equal(result.vehicle_id, persistedVehicle.id); equal(vehicleInserts().length, 0);
        equal(extractorCalls(), [name]);
        const body = JSON.parse(seen.find(r => r.path === `/functions/v1/${name}`)!.body!);
        equal(body.save_to_db, true);
        equal(body.action, name === 'extract-rmsothebys' ? 'extract' : undefined);
      } finally { persistedVehicle = null; }
    }
  },
});


for (const statusCode of [403, 429]) {
  Deno.test({
    name: `Craigslist share HTTP ${statusCode} stops after one identified fetch and never calls an extractor or creates a vehicle`,
    sanitizeOps: false, sanitizeResources: false,
    fn: async () => {
      publicPage = (req) => {
        equal(req.headers.get("user-agent"), "NukeListingCollector/1.0 (+https://nuke.ag)");
        return new Response("denied", { status: statusCode });
      };
      try {
        const { result } = await ingest({ url: "https://www.craigslist.org/view/d/car/token" });
        equal(result.status, "rejected");
        equal(result.reason, `enrichment_failed: HTTP ${statusCode}`);
        equal(result.enrichment_error, `HTTP ${statusCode}`);
        equal(seen.filter(r => {
          const host = new URL(r.url).hostname;
          return host === "craigslist.org" || host.endsWith(".craigslist.org");
        }).length, 1);
        equal(extractorCalls(), []);
        equal(vehicleInserts(), []);
        // The failed original request is archived as a failure, not a capture ACK.
        const raw = writes().filter(r => r.path === "/rest/v1/listing_page_snapshots");
        equal(raw.length, 1);
        equal(JSON.parse(raw[0].body!).success, false);
      } finally { publicPage = null; }
    },
  });
  Deno.test({
    name: `Craigslist detail HTTP ${statusCode} uses only the deterministic extractor and returns a ledgerable failure`,
    sanitizeOps: false, sanitizeResources: false,
    fn: async () => {
      extractor = (name, body) => {
        equal(body.save_to_db, false);
        equal(name, "extract-craigslist");
        return json({ success: false, error: `Failed to fetch: HTTP ${statusCode}` }, 500);
      };
      const { result } = await ingest({ url: "https://lasvegas.craigslist.org/cto/d/1969-chevrolet-camaro/1234567890.html" });
      equal(result.status, "rejected");
      assert(result.reason.startsWith("enrichment_failed:"), "failure goes to the existing ledger/backoff");
      assert(result.enrichment_error.includes(`HTTP ${statusCode}`), "access/rate disposition retained");
      equal(extractorCalls(), ["extract-craigslist"]);
      equal(writes(), []);
    },
  });
}

Deno.test({
  name: "Craigslist successful detail extraction lands through the existing deterministic path",
  sanitizeOps: false, sanitizeResources: false,
  fn: async () => {
    extractor = (name, body) => {
      equal(body.save_to_db, false);
      equal(name, "extract-craigslist");
      return json({ success: true, extracted: SUCCESS_BODY.data });
    };
    const { result } = await ingest({ url: "https://lasvegas.craigslist.org/cto/d/1993-chevrolet-corvette/1234567890.html" });
    equal(result.status, "created");
    equal(extractorCalls(), ["extract-craigslist"]);
    equal(vehicleInserts().length, 1);
  },
});

Deno.test({
  name: "the real fetching extractor carries the cached snapshot clock from a keyed receipt read without another source visit",
  sanitizeOps: false, sanitizeResources: false,
  fn: async () => {
    const ingestHandler = handler;
    cachedArchive = { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", fetched_at: "2026-01-04T01:02:03.456Z", html: SHARE_HTML };
    seen = [];
    try {
      await import("../extract-craigslist/index.ts");
      const response = await handler!(new Request("https://test.local/functions/v1/extract-craigslist", {
        method: "POST", headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url: SHARE_URL, save_to_db: false }),
      }));
      equal(response.status, 200);
      const result = await response.json();
      equal(result.extracted.source_capture, { snapshot_id: cachedArchive.id, observed_at: cachedArchive.fetched_at });
      equal(seen.length, 2);
      for (const request of seen) equal([new URL(request.url).hostname, request.path, request.method], ["stub.supabase.test", "/rest/v1/listing_page_snapshots", "GET"]);
      const receipt = new URL(seen[1].url);
      equal([receipt.searchParams.get("id"), receipt.searchParams.get("platform"), receipt.searchParams.get("success")],
        [`eq.${cachedArchive.id}`, "eq.craigslist", "eq.true"]);
    } finally { cachedArchive = null; handler = ingestHandler; }
  },
});
