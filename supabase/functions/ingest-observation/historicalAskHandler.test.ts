// Actual HTTP entry and Supabase client; only remote storage/DB are mocked.
import { HISTORICAL_ASK_MODE, HISTORICAL_ASK_PROFILE, historicalSha256 } from "./historicalAsks.ts";
import { HISTORICAL_ASK_METHOD } from "./historicalAskIntake.ts";
const assert = (ok: unknown, message = "assertion failed") => { if (!ok) throw new Error(message); };
const sourceId = "30000000-0000-0000-0000-000000000001";
const observationId = "30000000-0000-0000-0000-000000000002";
const TEST_CREDENTIAL = "sb_secret_synthetic_test";
const names = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const saved = names.map((name) => Deno.env.get(name));
Deno.env.set(names[0], "https://db.test");
Deno.env.set(names[1], TEST_CREDENTIAL);
let handler: (req: Request) => Promise<Response>;
const serve = Deno.serve;
(Deno as any).serve = (fn: typeof handler) => { handler = fn; };
await import("./index.ts");
Deno.serve = serve;

async function run(body: unknown, token = TEST_CREDENTIAL) {
  const calls: { path: string; method: string; writer: string | null; payload: any }[] = [];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (request, options) => {
    const url = new URL(typeof request === "string" ? request : request instanceof URL ? request.href : request.url);
    const init = options as RequestInit | undefined;
    const method = init?.method ?? "GET", headers = new Headers(init?.headers);
    const payload = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ path: url.pathname, method, writer: headers.get("x-nuke-writer"), payload });
    const respond = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
    if (url.pathname.endsWith("observation_sources")) return respond([{ id: sourceId, base_trust_score: 0.5, supported_observations: ["listing"] }]);
    if (url.pathname.endsWith("vehicle_observations")) return method === "POST"
      ? respond([{ ...payload, id: observationId, ingested_at: new Date().toISOString(), is_superseded: false }], 201) : respond([]);
    throw new Error(`Unexpected historical target ${url.pathname}`);
  };
  try {
    const response = await handler!(new Request("https://handler.test", { method: "POST",
      headers: { apikey: token, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    return { status: response.status, data: await response.json(), calls };
  } finally { globalThis.fetch = oldFetch; }
}

Deno.test("historical HTTP route refuses anonymous and generic profile spoof before DB work", async () => {
  const denied = await run({ mode: HISTORICAL_ASK_MODE, envelope: {} }, "sb_publishable_synthetic");
  assert(denied.status === 401 && denied.calls.length === 0);
  for (const body of [{ structured_data: { profile: HISTORICAL_ASK_PROFILE } }, { extraction_method: HISTORICAL_ASK_METHOD }]) {
    const r = await run(body);
    assert(r.status === 400 && r.calls.length === 0);
  }
});
Deno.test("historical HTTP route never lets caller identity reach generic resolution", async () => {
  const r = await run({ mode: HISTORICAL_ASK_MODE, vehicle_hints: { year: 1980, make: "Ford" }, envelope: {} });
  assert(r.status === 400 && r.calls.length === 0);
});
Deno.test("historical HTTP dry run reaches canonical registry without a generic vehicle query", async () => {
  // Invalid reference is intentionally rejected by canonical lineage, with no write.
  const envelope = { profile: HISTORICAL_ASK_PROFILE, record_type: "reading", capture_observation_id: observationId,
    ad_key: `autotrader-print:${await historicalSha256("synthetic-ad")}`,
    issue: { key: "synthetic", title: "Synthetic US AutoTrader", country: "US", date_start: null, date_end_exclusive: null,
      precision: "unknown", date_basis: "unknown", evidence: null },
    pass: { id: "read", method: "synthetic_test", version: "1", observed_at: "2026-01-01T00:00:00Z" },
    locator: { bbox: [0,0,10,10], printed_page: null }, fields: { raw: {}, normalized: {} }, field_assessments: {} };
  const r = await run({ mode: HISTORICAL_ASK_MODE, envelope, dry_run: true });
  assert(r.status === 409 && r.data.error === "invalid_capture_citation");
  assert(r.calls.some((c) => c.path.endsWith("observation_sources")));
  assert(r.calls.every((c) => c.method === "GET" && c.writer === "ingest-observation"));
  assert(!r.calls.some((c) => /vehicles$|analysis-engine/.test(c.path)));
});
Deno.test("restore historical handler environment", () => {
  names.forEach((name, i) => saved[i] === undefined ? Deno.env.delete(name) : Deno.env.set(name, saved[i]!));
});
