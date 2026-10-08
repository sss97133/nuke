// Real handler + Supabase HTTP client, with only network/server boundaries mocked.
// deno test --allow-env handler.test.ts (no network/serve permissions)
const assert = (ok: unknown, message = "assertion failed") => { if (!ok) throw new Error(message); };
const UUID = "10000000-0000-0000-0000-000000000001";
const envNames = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const saved = envNames.map(name => Deno.env.get(name));
Deno.env.set(envNames[0], "https://db.test");
Deno.env.set(envNames[1], "test-key");
let handler: (request: Request) => Promise<Response>;
const originalServe = Deno.serve;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (fn: typeof handler) => { handler = fn; };
await import("./index.ts");
Deno.serve = originalServe;

const input = {
  source_slug: "photo_pipeline", kind: "condition", observed_at: "2026-10-01T00:00:00Z",
  vehicle_id: UUID, property_key: "image_visible_rust_severity", agent_inferred: true,
  defer_analysis: true, agent_cost_cents: 0,
  structured_data: { image_id: UUID, image_visible_rust_severity: "surface" },
};

async function run(body: unknown, scenario: string, token = "test-key") {
  const calls: { path: string; method: string; writer: string | null; body?: Record<string, unknown> }[] = [];
  const originalFetch = globalThis.fetch;
  let observationReads = 0;
  globalThis.fetch = async (request, options) => {
    const init = options as { method?: string; body?: unknown; headers?: HeadersInit } | undefined;
    const url = new URL(typeof request === "string" ? request : request instanceof URL ? request.href : request.url);
    const method = init?.method || "GET";
    const payload = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const headers = new Headers(init?.headers ?? (request instanceof Request ? request.headers : undefined));
    calls.push({ path: url.pathname, method, writer: headers.get("x-nuke-writer"), body: payload });
    const response = (data: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(data), {
      status, headers: { "Content-Type": "application/json" },
    }));
    if (url.pathname.endsWith("observation_sources")) return response([{ id: UUID, base_trust_score: .85,
      supported_observations: url.searchParams.get("slug") === "eq.bat" ? ["comment"] : ["condition"] }]);
    if (url.pathname.endsWith("observation_properties")) {
      if (scenario === "registry_error") return response({ message: "unavailable" }, 503);
      return response(scenario === "unknown_property" ? [] : [{ id: UUID, namespace: "core", deprecated_at: null, applies_to_kinds: ["condition"] }]);
    }
    if (url.pathname.endsWith("vehicle_observations")) {
      if (method === "POST") {
        if (scenario === "race") return response({ code: "23505", message: "duplicate" }, 409);
        if (scenario === "witness_failed") return response({ code: "23514", message: "image mismatch" }, 400);
        if (scenario === "comment_source_failed") return response({ code: "23503", message: "source comment missing" }, 400);
        return response([{ id: UUID }], 201);
      }
      observationReads++;
      return response(scenario === "duplicate" || (scenario === "race" && observationReads === 2) ? [{ id: UUID }] : []);
    }
    if (url.pathname.endsWith("analysis-engine-coordinator")) return response({ success: true });
    throw new Error(`unexpected request ${url.pathname}`);
  };
  try {
    const response = await handler!(new Request("https://handler.test", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
    return { status: response.status, data: await response.json(), calls };
  } finally { globalThis.fetch = originalFetch; }
}

Deno.test("property insert binds FK, caps inference, retains zero cost, defers inference", async () => {
  const r = await run(input, "success");
  assert(r.status === 200 && r.data.success === true);
  const insert = r.calls.find(call => call.method === "POST" && call.path.endsWith("vehicle_observations"));
  assert(insert?.body?.property_id === UUID);
  assert(insert?.body?.confidence_score === .6);
  assert(insert?.body?.agent_cost_cents === 0);
  assert(insert?.writer === "ingest-observation", "the actual log HTTP request must declare its receipt writer");
  assert(!r.calls.some(call => call.path.endsWith("analysis-engine-coordinator")));
});
Deno.test("normal intake retains downstream coordinator behavior", async () => {
  const r = await run({ ...input, defer_analysis: false }, "success");
  assert(r.status === 200);
  assert(r.calls.some(call => call.path.endsWith("analysis-engine-coordinator")));
});
Deno.test("unknown property and unavailable registry never insert", async () => {
  for (const [scenario, status] of [["unknown_property", 400], ["registry_error", 503]] as const) {
    const r = await run(input, scenario);
    assert(r.status === status);
    assert(!r.calls.some(call => call.method === "POST"));
  }
});
Deno.test("replay and concurrent hash winner return same observation without downstream work", async () => {
  for (const scenario of ["duplicate", "race"]) {
    const r = await run(input, scenario);
    assert(r.status === 200 && r.data.duplicate === true && r.data.observation_id === UUID);
    assert(!r.calls.some(call => call.path.endsWith("analysis-engine-coordinator")));
  }
});
Deno.test("witness constraint failure cannot report successful intake", async () => {
  const r = await run(input, "witness_failed");
  assert(r.status === 500 && r.data.success !== true);
  assert(!r.calls.some(call => call.path.endsWith("analysis-engine-coordinator")));
});
Deno.test("unauthenticated projection never reaches database", async () => {
  const r = await run(input, "success", "invalid-token");
  assert(r.status === 401 && r.calls.length === 0);
});
Deno.test("invalid defer flag fails before database mutation", async () => {
  const r = await run({ ...input, defer_analysis: "true" }, "success");
  assert(r.status === 400 && r.calls.length === 0);
});
Deno.test("signed-in user cannot select the service-only deferred mode", async () => {
  const old = Deno.env.get("JWT_SIGNING_SECRET");
  Deno.env.set("JWT_SIGNING_SECRET", "test-secret");
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role: "authenticated", sub: UUID, exp: Math.floor(Date.now() / 1000) + 60 })}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("test-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(unsigned)));
  const token = `${unsigned}.${btoa(String.fromCharCode(...signature)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
  try {
    const r = await run(input, "success", token);
    assert(r.status === 403 && r.calls.length === 0);
  } finally {
    if (old === undefined) Deno.env.delete("JWT_SIGNING_SECRET"); else Deno.env.set("JWT_SIGNING_SECRET", old);
  }
});

const COMMENT_ID = "20000000-0000-4000-8000-000000000001";
const OTHER_COMMENT_ID = "20000000-0000-4000-8000-000000000002";
const commentInput = {
  source_slug: "bat", kind: "comment", vehicle_id: UUID,
  observed_at: "2026-01-02T03:04:05Z",
  source_comment_id: COMMENT_ID,
  source_url: "https://bringatrailer.com/listing/synthetic-vehicle/",
  source_identifier: "synthetic-comment-atom",
  content_text: "The engine runs well.",
  agent_inferred: true, defer_analysis: true,
  extraction_method: "comment_refinery_atom", agent_cost_cents: 0,
  structured_data: { analysis_kind: "comment_atom", is_inferred: true,
    statement_kind: "assertion", subject_scope: "vehicle", qualification: "candidate",
    claim_type: "mechanical_condition", proposed_value: "runs well", confidence: .4 },
};

Deno.test("inferred comment insert retains its typed source link, qualification and source clock", async () => {
  const r = await run(commentInput, "success");
  assert(r.status === 200 && r.data.success === true);
  const insert = r.calls.find(call => call.method === "POST" && call.path.endsWith("vehicle_observations"));
  assert(insert?.body?.source_comment_id === COMMENT_ID);
  assert(insert?.body?.vehicle_id === UUID && insert?.body?.kind === "comment");
  assert(insert?.body?.observed_at === commentInput.observed_at);
  assert(insert?.body?.source_url === commentInput.source_url);
  assert(insert?.body?.content_text === commentInput.content_text);
  assert(insert?.body?.confidence_score === .6);
  const data = insert?.body?.structured_data as Record<string, unknown>;
  assert(data?.is_inferred === true && data?.qualification === "candidate");
  assert(data?.confidence === .4);
  assert(!r.calls.some(call => call.path.endsWith("analysis-engine-coordinator")));
});

Deno.test("identical comment atoms from different source comments retain distinct content hashes", async () => {
  const inserted: Record<string, unknown>[] = [];
  for (const source_comment_id of [COMMENT_ID, OTHER_COMMENT_ID, COMMENT_ID]) {
    const r = await run({ ...commentInput, source_comment_id }, "success");
    assert(r.status === 200 && r.data.success === true);
    const insert = r.calls.find(call => call.method === "POST" && call.path.endsWith("vehicle_observations"));
    assert(insert?.body?.source_comment_id === source_comment_id);
    inserted.push(insert!.body!);
  }
  assert(typeof inserted[0].content_hash === "string" && /^[0-9a-f]{64}$/.test(inserted[0].content_hash));
  assert(inserted[0].content_hash !== inserted[1].content_hash,
    "separate source comments must not collapse into one observation");
  assert(inserted[0].content_hash === inserted[2].content_hash,
    "replaying the same source comment must retain deterministic identity");
});

Deno.test("invalid source comment UUIDs fail before any database mutation", async () => {
  for (const source_comment_id of ["not-a-uuid", "", null, 42, {}, "20000000-0000-4000-8000-00000000000Z"]) {
    const r = await run({ ...commentInput, source_comment_id }, "success");
    assert(r.status === 400 && r.data.success !== true);
    assert(r.calls.length === 0);
  }
});

Deno.test("source-linked atoms require comment kind and explicit inference qualification", async () => {
  for (const patch of [
    { kind: "condition" }, { kind: "ownership" },
    { agent_inferred: false }, { agent_inferred: undefined }, { agent_inferred: "true" },
    { structured_data: undefined }, { structured_data: null }, { structured_data: {} },
    { structured_data: { is_inferred: false } }, { structured_data: { is_inferred: "true" } },
  ]) {
    const r = await run({ ...commentInput, ...patch }, "success");
    assert(r.status === 400 && r.data.success !== true);
    assert(r.calls.length === 0);
  }
});

Deno.test("comment source constraint failure cannot report successful intake or trigger analysis", async () => {
  const r = await run(commentInput, "comment_source_failed");
  assert(r.status === 500 && r.data.success !== true);
  assert(r.calls.some(call => call.method === "POST" && call.path.endsWith("vehicle_observations")));
  assert(!r.calls.some(call => call.path.endsWith("analysis-engine-coordinator")));
});

Deno.test("replayed deferred comment uses the existing observation without downstream work", async () => {
  for (const scenario of ["duplicate", "race"]) {
    const r = await run(commentInput, scenario);
    assert(r.status === 200 && r.data.duplicate === true && r.data.observation_id === UUID);
    assert(!r.calls.some(call => call.path.endsWith("analysis-engine-coordinator")));
  }
});

addEventListener("unload", () => envNames.forEach((name, index) => {
  if (saved[index] === undefined) Deno.env.delete(name); else Deno.env.set(name, saved[index]!);
}));
