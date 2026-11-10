// Real handler + source CAS path; no network/provider capability. A simulated
// existing contradiction trigger proves validation happens before metadata.
import { assert, assertEquals } from "jsr:@std/assert";
const project = "https://example.invalid", key = "sb_secret_classification_fixture";
Deno.env.set("SUPABASE_URL", project); Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", key); Deno.env.delete("SUPABASE_SECRET_KEYS");
const image = "10000000-0000-4000-8000-000000000001", vehicle = "20000000-0000-4000-8000-000000000001", observation = "30000000-0000-4000-8000-000000000001";
const version = "2026-11-01T12:00:00.123456Z", source = `${project}/image.jpg`;
let row: any, bodies: any[], calls: string[], mode: string;
function reset() {
  row = { id: image, image_url: source, vehicle_id: vehicle, updated_at: version,
    ai_scan_metadata: { classification: { image_type: "vehicle_interior", description: "Old contradictory emblem reading.", vehicle_hints: { make: "Wrong make" } },
      processing_policy: { mode: "subscription_review" }, rendition_provenance: { source: "retained" }, byok_deep_analysis: { independent: "retained" } } };
  bodies = []; calls = []; mode = "ok";
}
reset();
globalThis.fetch = (async (url, init) => {
  const u = new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url), method = init?.method ?? "GET";
  assertEquals(u.origin, project); calls.push(`${method} ${u.pathname}`);
  if (u.pathname === "/rest/v1/rpc/classifier_schema_manifest") return Response.json({});
  if (u.pathname === "/rest/v1/vehicle_images") {
    if (method === "GET") return Response.json(structuredClone(row));
    if (method === "PATCH") {
      const patch = JSON.parse(String(init?.body));
      if (u.searchParams.get("updated_at") !== `eq.${row.updated_at}`) return Response.json([]);
      row = { ...row, ...patch, updated_at: "2026-11-01T12:00:01.123456Z" };
      // Same effect as existing b10 guard; no test-only bypass marker.
      if (row.ai_scan_metadata.classification.vehicle_hints?.make === "Wrong make" || mode === "guard-withdrawal") row.vehicle_id = null;
      return Response.json([{ id: image, image_url: row.image_url, vehicle_id: row.vehicle_id }]);
    }
  }
  if (u.pathname === "/functions/v1/ingest-observation") {
    bodies.push(JSON.parse(String(init?.body)));
    if (mode === "race") row.updated_at = "2026-11-01T12:00:00.123457Z";
    if (mode === "move") row.vehicle_id = null;
    return mode === "history-failed" ? Response.json({ error: "unavailable" }, { status: 500 }) : Response.json({ success: true, observation_id: observation });
  }
  throw new Error(`unexpected effect ${method} ${u.pathname}`);
}) as typeof fetch;
let handler!: (r: Request) => Promise<Response>;
const serve = Deno.serve; Deno.serve = ((cb: typeof handler) => { handler = cb; }) as typeof Deno.serve;
await import("./index.ts"); Deno.serve = serve;
function packet(): any { return { processing_mode: "classification_only", image_id: image, image_url: source, vehicle_id: vehicle,
  classification_raw: { image_type: "vehicle_interior", image_medium: "photograph", confidence: .9, is_automotive: true,
    description: "Black cabin with a bird emblem visible on the steering wheel.", vehicle_hints: {}, vehicle_fields: [],
    text_lines: [{ text: "R 1 3", confidence: .9 }] }, reader: "interactive-source-review",
  source: { image_url: source, expected_updated_at: version, reviewed_url: source, reviewed_sha256: "a".repeat(64), reviewed_at: version },
  provenance: { agent_model: "fixture-model", agent_tier: "interactive", extraction_method: "full-frame visual review", run_id: "fixture" } }; }
async function invoke(p = packet()) { const r = await handler(new Request(`${project}/functions/v1/photo-pipeline-orchestrator`, {
  method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(p) })); return { status: r.status, value: await r.json() }; }
const options = { sanitizeOps: false, sanitizeResources: false };
Deno.test({ name: "supplied correction retains prior testimony before replacing stale cache, without paid/filing/queue calls", ...options, fn: async () => {
  reset(); const r = await invoke(); assertEquals(r.status, 200); assertEquals(r.value.model_calls, 0); assertEquals(row.vehicle_id, vehicle);
  assertEquals(bodies.length, 1); const b = bodies[0];
  assertEquals(b.defer_analysis, true); assertEquals(b.vehicle_id, null); assertEquals(b.agent_inferred, true);
  assertEquals(b.structured_data.source_image_id, image); assertEquals(b.structured_data.previous_classification.vehicle_hints.make, "Wrong make");
  assertEquals(b.extraction_metadata.source.expected_updated_at, version); assertEquals(b.extraction_metadata.reviewer_provenance.agent_model, "fixture-model");
  assertEquals(row.ai_scan_metadata.classification_review.observation_id, observation);
  assertEquals(row.ai_scan_metadata.processing_policy.mode, "subscription_review"); assertEquals(row.ai_scan_metadata.rendition_provenance.source, "retained");
  assert(calls.findIndex(c => c.includes("ingest-observation")) < calls.findIndex(c => c.startsWith("PATCH")));
  const again = await invoke(); assertEquals(again.status, 200); assertEquals(again.value.duplicate, true); assertEquals(bodies.length, 1);
} });
Deno.test({ name: "unfiled supplied reading remains unfiled and source-only", ...options, fn: async () => {
  reset(); row.vehicle_id = null; const p = packet(); p.vehicle_id = null;
  assertEquals((await invoke(p)).status, 200); assertEquals(row.vehicle_id, null); assertEquals(bodies[0].structured_data.source_vehicle_id, null);
} });
Deno.test({ name: "exact-version correction replaces a prior completed or failed pipeline receipt and retains its history", ...options, fn: async () => {
  for (const outcome of ["completed", "failed"]) {
    reset();
    const prior = { receipt_id: `prior:${outcome}`, attempt_id: "prior", outcome, processing_started_at: version, observation_id: observation };
    row.ai_scan_metadata.photo_pipeline = { receipt: prior, last_failure: { receipt_id: "retained-failure" } };
    const r = await invoke(); assertEquals(r.status, 200); assertEquals(row.vehicle_id, vehicle);
    assertEquals(bodies[0].structured_data.previous_pipeline_receipt, prior);
    assertEquals(bodies[0].structured_data.previous_observation_id, observation);
    assertEquals(row.ai_scan_metadata.photo_pipeline.last_failure.receipt_id, "retained-failure");
    assertEquals(row.ai_scan_metadata.photo_pipeline.receipt.outcome, "completed");
    assert(row.ai_scan_metadata.photo_pipeline.receipt.attempt_id !== "prior");
  }
} });
Deno.test({ name: "a newer pipeline attempt still refuses an exact-version supplied completion", ...options, fn: async () => {
  reset(); row.ai_scan_metadata.photo_pipeline = { receipt: { receipt_id: "newer", attempt_id: "newer", outcome: "processing", processing_started_at: "2099-01-01T00:00:00Z" } };
  const r = await invoke(); assertEquals(r.status, 409); assertEquals(row.ai_scan_metadata.photo_pipeline.receipt.receipt_id, "newer");
  assertEquals(bodies.length, 1); assert(!calls.some(c => c.startsWith("PATCH")));
} });
Deno.test({ name: "invalid reading and generic fact payload refuse before history or metadata; no provider fallback", ...options, fn: async () => {
  for (const mutate of [(p: any) => p.classification_raw.image_type = "invented", (p: any) => p.classification_raw.vehicle_fields = [{ field_name: "make", value: "Wrong make" }],
    (p: any) => p.source.observation_id = observation, (p: any) => p.reader = null]) {
    reset(); const p = packet(); mutate(p); assertEquals((await invoke(p)).status, 400);
    assertEquals(bodies.length, 0); assert(!calls.some(c => c.startsWith("PATCH")));
  }
} });
Deno.test({ name: "stale source and intake failure cannot overwrite classification", ...options, fn: async () => {
  for (const which of ["stale", "history-failed", "race", "move"]) {
    reset(); mode = which; if (which === "stale") row.updated_at = "2026-11-01T12:00:00.123457Z";
    const r = await invoke(); assertEquals(r.status, which === "history-failed" ? 502 : 409);
    assertEquals(row.ai_scan_metadata.classification.vehicle_hints.make, "Wrong make");
    assert(!calls.some(c => c.startsWith("PATCH")));
  }
} });
Deno.test({ name: "successful update with guard withdrawal is a refused source, not success", ...options, fn: async () => {
  reset(); mode = "guard-withdrawal"; const r = await invoke(); assertEquals(r.status, 409); assertEquals(r.value.error, "classification_source_changed");
  assertEquals(row.vehicle_id, null); assertEquals(bodies.length, 1);
} });
