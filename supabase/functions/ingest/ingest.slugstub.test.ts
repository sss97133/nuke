// Run: deno test --no-check --allow-env supabase/functions/ingest/ingest.slugstub.test.ts
// (--no-check: type-checking the esm.sh import graph asks for npm:@types/node, which a checkout without node_modules lacks.)
// Drives the real `ingest` handler end to end with the network stubbed: PostgREST answers "no rows" to every read
// and records every write, and the extractor functions answer whatever each test says. It proves the slug-stub rule
// where it matters: a venue whose extractor failed gets a rejection and no write at all, a venue whose extractor
// worked still lands, and BaT is untouched.
//
// The stub is installed before `index.ts` is imported, because supabase-js binds the global fetch when the module
// creates its client.

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

  if (url.pathname.startsWith("/functions/v1/")) {
    const name = url.pathname.slice("/functions/v1/".length);
    return extractor(name, body ? JSON.parse(body) : {});
  }
  if (url.pathname.startsWith("/auth/v1/")) return json({ code: 401, msg: "invalid JWT" }, 401);
  if (url.pathname.startsWith("/rest/v1/")) {
    const wantsObject = (req.headers.get("accept") ?? "").includes("vnd.pgrst.object");
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
