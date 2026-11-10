// Exercise the actual handler and Supabase client headers. No network permission:
// every image/provider, filing, queue or unrelated write fails the test.
const project = "https://example.invalid";
const serviceKey = "sb_secret_reviewed_fixture";
Deno.env.set("SUPABASE_URL", project);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", serviceKey);
Deno.env.delete("SUPABASE_SECRET_KEYS");
let handler: (req: Request) => Promise<Response>;
const originalServe = Deno.serve;
Deno.serve = ((callback: typeof handler) => { handler = callback; }) as typeof Deno.serve;
const imageId = "10000000-0000-4000-8000-000000000001";
const vehicleId = "20000000-0000-4000-8000-000000000001";
const observationId = "30000000-0000-4000-8000-000000000001";
const updated = "2026-11-01T12:00:00.123456Z";
const sourceUrl = `${project}/image.jpg`;
const calls: string[] = [];
let intakeBody: any, rejectProjection = false;
function assert(value: unknown): asserts value { if (!value) throw new Error("assertion failed"); }
globalThis.fetch = (async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const headers = new Headers(init?.headers);
  assert(url.origin === project && headers.get("apikey") === serviceKey);
  calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
  if (url.pathname === "/rest/v1/vehicle_images" && init?.method !== "PATCH") {
    assert(url.searchParams.get("id") === `eq.${imageId}`);
    return Response.json({ id: imageId, vehicle_id: vehicleId, image_url: sourceUrl, updated_at: updated,
      vision_gate_status: "approved", ai_scan_metadata: {} });
  }
  if (url.pathname === "/functions/v1/ingest-observation") {
    intakeBody = JSON.parse(String(init?.body));
    return Response.json({ success: true, observation_id: observationId });
  }
  if (url.pathname === "/rest/v1/rpc/project_reviewed_image_analysis") {
    assert(JSON.parse(String(init?.body)).p_observation_id === observationId);
    return rejectProjection ? Response.json({ message: "source withdrawn", code: "23514" }, { status: 400 }) :
      Response.json({ success: true, observation_id: observationId, image_id: imageId, vehicle_id: vehicleId,
        image_observation_id: "50000000-0000-4000-8000-000000000001" });
  }
  throw new Error(`unexpected effect: ${url.pathname}`);
}) as typeof fetch;
await import("./index.ts");
Deno.serve = originalServe;
function request(token = serviceKey) {
  return new Request(`${project}/functions/v1/photo-pipeline-orchestrator`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "record_reviewed_analysis", verdict: {
      image_id: imageId, vehicle_id: vehicleId, scene_type: "body_exterior", build_phase_guess: "final_assembly",
      intent: "unknown", intent_confidence: 0, needs_clarification: true, components_seen: [],
      state_observations: { rust_severity: "unknown", paint_state: "unknown", completeness: "assembled" },
      workshop_signals: { tools_visible: [], fixturing: "unknown", lighting: "unknown" }, presence: { person: false },
      camera_pose: { framing: "whole vehicle", azimuth_deg: null, distance_est: null },
      narrative_one_line: "Whole vehicle visible in the reviewed frame.", confidence: 0.9,
    }, source: { image_url: sourceUrl, expected_updated_at: updated, reviewed_url: sourceUrl,
      reviewed_sha256: "a".repeat(64), reviewed_at: new Date().toISOString() },
    provenance: { agent_model: "fixture-model", agent_tier: "interactive", extraction_method: "visual review", run_id: "fixture" } }),
  });
}
Deno.test("actual reviewed action sends service credentials only to read, deferred intake and projection", async () => {
  calls.length = 0; rejectProjection = false;
  const response = await handler(request()), result = await response.json();
  assert(response.status === 200 && result.success === true && result.model_calls === 0);
  assert(result.image_observation_id === "50000000-0000-4000-8000-000000000001");
  assert(calls.join("|") === "GET /rest/v1/vehicle_images|POST /functions/v1/ingest-observation|POST /rest/v1/rpc/project_reviewed_image_analysis");
  assert(intakeBody.defer_analysis === true && intakeBody.agent_inferred === true);
  assert(intakeBody.extraction_metadata.reviewer_provenance.agent_model === "fixture-model");
});
Deno.test("actual reviewed action rejects anonymous caller before persistence", async () => {
  calls.length = 0;
  const response = await handler(request("sb_publishable_fixture"));
  assert(response.status === 401 && calls.length === 0);
  await response.body?.cancel();
});
Deno.test("actual reviewed action rejects valid signed-in user before reading the source", async () => {
  calls.length = 0;
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
  Deno.env.set("SUPABASE_JWKS", JSON.stringify({ keys: [{ ...publicKey, kid: "fixture", alg: "ES256", use: "sig" }] }));
  const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const encode = (x: unknown) => b64(new TextEncoder().encode(JSON.stringify(x)));
  const material = `${encode({ alg: "ES256", kid: "fixture", typ: "JWT" })}.${encode({ sub: "40000000-0000-4000-8000-000000000001", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 300 })}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(material)));
  const response = await handler(request(`${material}.${b64(signature)}`)), result = await response.json();
  assert(response.status === 403 && result.error === "review_requires_service_role" && calls.length === 0);
});
Deno.test("actual projection rejection returns failure without normal pipeline state writes", async () => {
  calls.length = 0; rejectProjection = true;
  const response = await handler(request()), result = await response.json();
  assert(response.status === 409 && result.error === "review_projection_refused" && result.model_calls === 0);
  assert(calls.length === 3 && !calls.some(c => c.startsWith("PATCH")));
});
