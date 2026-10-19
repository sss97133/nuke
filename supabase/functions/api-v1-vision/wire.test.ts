// The real index.ts, the real write guard and the real supabase-js client; only the network is replaced, by a stand-in
// that records every call (the database, the YONO sidecar, ingest-observation). Nothing leaves the process: any other
// address throws. Every key below is a disposable test string.
//   deno test --no-check --allow-env supabase/functions/api-v1-vision/wire.test.ts
// --no-check because index.ts imports _shared/getUserApiKey.ts, which does not type-check today (two TS2322 on main).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// supabase-js starts an auth refresh timer in every client, and index.ts builds one per request; the timer is the
// library's, so the sanitizers stand down for these tests only.
const WIRE = { sanitizeOps: false, sanitizeResources: false };
const SECRET = "sb_secret_test_vision_01";
const PUBLISHABLE = "sb_publishable_test_vision_01";
const ADMIN = "0b9f107a-0000-4000-8000-0000000000a1";
const MEMBER = "0b9f107a-0000-4000-8000-0000000000f9";
const VEHICLE = "0b9f107a-0000-4000-8000-0000000000c1";
const SOURCE = "0b9f107a-0000-4000-8000-0000000000d1";
const OBSERVATION = "0b9f107a-0000-4000-8000-0000000000e1";
const LISTING_URL = "https://lasvegas.craigslist.org/cto/d/example/0000000001.html";
const PHOTOS = [1, 2, 3].map((n) => ({ id: `0b9f107a-0000-4000-8000-00000000010${n}`, image_url: `https://images.example/${n}.jpg` }));

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
const signer = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const JWKS = JSON.stringify({ keys: [{ ...(await crypto.subtle.exportKey("jwk", signer.publicKey)), kid: "k1", alg: "ES256", use: "sig" }] });
async function session(sub: string, extra: Record<string, unknown> = {}): Promise<string> {
  const input = `${enc({ alg: "ES256", typ: "JWT", kid: "k1" })}.${enc({ role: "authenticated", sub, exp: Math.floor(Date.now() / 1000) + 600, ...extra })}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signer.privateKey, new TextEncoder().encode(input)));
  return `${input}.${b64url(sig)}`;
}

// The environment index.ts and the guard read; anything the developer's shell holds that would change an answer is
// cleared for this process and put back afterwards.
const testEnv: Record<string, string | undefined> = {
  SUPABASE_URL: "https://db.test",
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }),
  SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLISHABLE }),
  SUPABASE_JWKS: JWKS,
  YONO_SIDECAR_URL: "https://yono.test",
  SUPABASE_SERVICE_ROLE_KEY: undefined, SUPABASE_ANON_KEY: undefined, MODAL_SIDECAR_TOKEN: undefined,
  LISTING_ANALYSES_PER_DAY: undefined,
  GOOGLE_AI_API_KEY: undefined, GEMINI_API_KEY: undefined, GOOGLE_API_KEY: undefined, ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined,
};
const saved = Object.keys(testEnv).map((n) => [n, Deno.env.get(n)] as const);
for (const [n, v] of Object.entries(testEnv)) v === undefined ? Deno.env.delete(n) : Deno.env.set(n, v);
addEventListener("unload", () => saved.forEach(([n, v]) => (v === undefined ? Deno.env.delete(n) : Deno.env.set(n, v))));

let handler: (request: Request) => Promise<Response>;
const realServe = Deno.serve;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (fn: typeof handler) => { handler = fn; };
await import("./index.ts");
Deno.serve = realServe;

interface Seen { method: string; url: URL; body: unknown; authorization: string | null }
interface World {
  admins?: string[];
  /** listing reads already written in the window */
  used?: number;
  /** the sidecar's answer to one photo; absent: the sidecar is down (404, as last documented) */
  yono?: (imageUrl: string) => unknown;
}

const yonoAnswer = (imageUrl: string) => ({
  vehicle_zone: imageUrl.endsWith("1.jpg") ? "ext_front_driver" : "ext_rear", zone_confidence: 0.8, zone_source: "classifier",
  condition_score: imageUrl.endsWith("1.jpg") ? 2 : 3, damage_flags: imageUrl.endsWith("1.jpg") ? ["rust"] : [],
  modification_flags: [], interior_quality: null, photo_quality: 4, photo_type: "exterior_front", model: "finetuned_v2", ms: 840,
});

async function call(request: Request, world: World = {}) {
  const seen: Seen[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const raw = req.method === "GET" || req.method === "HEAD" ? "" : await req.text();
    const body = raw ? JSON.parse(raw) : undefined;
    seen.push({ method: req.method, url, body, authorization: req.headers.get("authorization") });
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (url.origin === "https://yono.test" && url.pathname === "/analyze") {
      return world.yono ? json(world.yono(body.image_url)) : new Response("Not Found", { status: 404 });
    }
    if (url.origin !== "https://db.test") throw new Error(`unexpected request ${req.method} ${url}`);
    switch (url.pathname) {
      case "/rest/v1/admin_users": {
        const id = url.searchParams.get("user_id")?.replace(/^eq\./, "") ?? "";
        return json((world.admins ?? [ADMIN]).includes(id) ? [{ user_id: id }] : []);
      }
      case "/rest/v1/observation_sources": return json([{ id: SOURCE }]);
      case "/rest/v1/vehicle_observations": return json(Array.from({ length: world.used ?? 0 }, (_, i) => ({ id: `row-${i}` })));
      case "/rest/v1/vehicles":
        return json([{ id: VEHICLE, is_public: true, deleted_at: null, listing_kind: "vehicle", listing_url: LISTING_URL, discovery_url: null }]);
      case "/rest/v1/vehicle_images": return json(PHOTOS);
      // The caller's connected providers: none.
      case "/rest/v1/rpc/has_active_api_access": return json(false);
      case "/rest/v1/user_ai_providers": return json([]);
      case "/rest/v1/rpc/rate_limit_increment": return json(1);
      case "/functions/v1/ingest-observation": return json({ success: true, observation_id: OBSERVATION, duplicate: false });
      default: throw new Error(`unexpected request ${req.method} ${url.pathname}`);
    }
  }) as typeof fetch;
  try {
    const res = await handler!(request);
    return { res, body: await res.json().catch(() => null), seen };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const listing = (headers: Record<string, string> = {}, body: unknown = { vehicle_id: VEHICLE }) =>
  new Request("https://fn.test/api-v1-vision/listing", {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  });
const to = (seen: Seen[], path: string) => seen.filter((s) => s.url.pathname === path);
const sidecar = (seen: Seen[]) => seen.filter((s) => s.url.origin === "https://yono.test");

Deno.test("no token: 401 from the write guard, and nothing is read, analyzed or written", WIRE, async () => {
  const { res, body, seen } = await call(listing());
  assertEquals(res.status, 401);
  assertEquals(body.error, "unauthorized");
  assertEquals(seen.length, 0);
});

Deno.test("the publishable key (it ships in the web bundle): 401, nothing touched", WIRE, async () => {
  const { res, seen } = await call(listing({ Authorization: `Bearer ${PUBLISHABLE}` }));
  assertEquals(res.status, 401);
  assertEquals(seen.length, 0);
});

Deno.test("a signed-in account that is not an admin: 403 after the admin lookup alone", WIRE, async () => {
  const { res, body, seen } = await call(listing({ Authorization: `Bearer ${await session(MEMBER)}` }));
  assertEquals(res.status, 403);
  assertEquals(body.reason, "admins only");
  assertEquals(seen.map((s) => s.url.pathname), ["/rest/v1/admin_users"]);
});

Deno.test("an anonymous sign-in (role authenticated, is_anonymous): 403, nothing analyzed", WIRE, async () => {
  const { res, seen } = await call(listing({ Authorization: `Bearer ${await session(MEMBER, { is_anonymous: true })}` }));
  assertEquals(res.status, 403);
  assertEquals(sidecar(seen).length + to(seen, "/functions/v1/ingest-observation").length, 0);
});

Deno.test("an admin at the day's cap: 429 before the vehicle or a photo is read, or YONO is called", WIRE, async () => {
  const { res, body, seen } = await call(listing({ Authorization: `Bearer ${await session(ADMIN)}` }), { used: 40, yono: yonoAnswer });
  assertEquals(res.status, 429);
  assertEquals(body.cap, 40);
  const count = to(seen, "/rest/v1/vehicle_observations");
  assertEquals(count.length, 1);
  // The count PostgREST runs: this source, condition rows, one day, this route's analysis kind, at most the cap.
  const q = Object.fromEntries(count[0].url.searchParams);
  assertEquals([q.source_id, q.kind, q["structured_data->>analysis_kind"], q.limit],
    [`eq.${SOURCE}`, "eq.condition", "eq.listing_photo_condition_v1", "40"]);
  assert(q.ingested_at.startsWith("gte."));
  assertEquals(to(seen, "/rest/v1/vehicles").length + to(seen, "/rest/v1/vehicle_images").length + sidecar(seen).length, 0);
});

Deno.test("an admin with YONO up: one listing read, written once through ingest-observation with the service key", WIRE, async () => {
  const { res, body, seen } = await call(listing({ Authorization: `Bearer ${await session(ADMIN)}` }), { yono: yonoAnswer });
  assertEquals(res.status, 200);
  assertEquals(body.observation_id, OBSERVATION);
  assertEquals([body.photos_analyzed, body.analyzer, body.cost_bearer, body.cost_usd, body.condition_score], [3, "yono", "nuke", 0, 3]);
  assertEquals(body.damage_flags, [{ flag: "rust", photos: 1 }]);
  assertEquals(body.zones_seen, ["ext_front_driver", "ext_rear"]);
  assertEquals(sidecar(seen).length, 3);
  // The photo read: this vehicle, documents/duplicates/superseded left out, by id, at most 12 (the default).
  const images = Object.fromEntries(to(seen, "/rest/v1/vehicle_images")[0].url.searchParams);
  assertEquals([images.vehicle_id, images.is_document, images.is_duplicate, images.is_superseded, images.order, images.limit],
    [`eq.${VEHICLE}`, "not.is.true", "not.is.true", "not.is.true", "id.asc", "12"]);
  const writes = to(seen, "/functions/v1/ingest-observation");
  assertEquals(writes.length, 1);
  assertEquals(writes[0].authorization, `Bearer ${SECRET}`);
  // deno-lint-ignore no-explicit-any
  const o = writes[0].body as Record<string, any>;
  assertEquals([o.source_slug, o.kind, o.vehicle_id, o.source_url, o.agent_inferred], ["nuke-vision", "condition", VEHICLE, LISTING_URL, true]);
  assertEquals(o.structured_data.analysis_kind, "listing_photo_condition_v1");
  assertEquals(o.observer_raw.requested_by_user_id, ADMIN);
  // The caller's providers are never looked up while YONO answers.
  assertEquals(to(seen, "/rest/v1/user_ai_providers").length, 0);
});

Deno.test("YONO down and no connected provider: 503, YONO asked once, one provider lookup, nothing written", WIRE, async () => {
  const { res, body, seen } = await call(listing({ Authorization: `Bearer ${await session(ADMIN)}` }));
  assertEquals(res.status, 503);
  assertEquals(body, { error: "no analyzer available", hint: "connect your AI subscription" });
  assertEquals(sidecar(seen).length, 1);
  // One cloudAnalyze call: one lookup for each of the three providers it knows, then no more photos.
  assertEquals(to(seen, "/rest/v1/user_ai_providers").length, 3);
  assertEquals(to(seen, "/functions/v1/ingest-observation").length, 0);
});

Deno.test("the service key: no admin lookup, YONO only (it has no provider of its own), written", WIRE, async () => {
  const { res, seen } = await call(listing({ Authorization: `Bearer ${SECRET}` }), { yono: yonoAnswer });
  assertEquals(res.status, 200);
  assertEquals(to(seen, "/rest/v1/admin_users").length, 0);
  // deno-lint-ignore no-explicit-any
  assertEquals((to(seen, "/functions/v1/ingest-observation")[0].body as Record<string, any>).observer_raw.requested_by_user_id, null);
});

Deno.test("the other routes still answer through authenticateRequest: an anonymous /classify gets its 401", WIRE, async () => {
  const { res, body, seen } = await call(new Request("https://fn.test/api-v1-vision/classify", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image_url: PHOTOS[0].image_url }),
  }));
  assertEquals(res.status, 401);
  assertEquals(body.error, "Invalid or missing authentication");
  assertEquals(seen.map((s) => s.url.pathname), ["/rest/v1/rpc/rate_limit_increment"]);
});
