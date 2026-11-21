// Actual review producer -> actual ingest handler -> actual Supabase INSERT.
// Only database/network boundaries are replaced; UUID/null is the real extractor
// column contract. No network permission, private source or registered ID invented.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
const project = "https://example.invalid", serviceKey = "sb_secret_review_chain_fixture";
Deno.env.set("SUPABASE_URL", project);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", serviceKey);
Deno.env.delete("SUPABASE_SECRET_KEYS");
let ingestHandler: (request: Request) => Promise<Response>;
const originalServe = Deno.serve;
Deno.serve = ((fn: typeof ingestHandler) => { ingestHandler = fn; }) as typeof Deno.serve;
try { await import("../ingest-observation/index.ts"); }
finally { Deno.serve = originalServe; }
const { recordReviewedAnalysis, PROJECTION_REFUSALS } = await import("./reviewedAnalysis.ts");
const imageId = "10000000-0000-4000-8000-000000000001", vehicleId = "20000000-0000-4000-8000-000000000001";
const observationId = "30000000-0000-4000-8000-000000000001", sourceId = "40000000-0000-4000-8000-000000000001";
const placementId = "50000000-0000-4000-8000-000000000001", sourceUrl = `${project}/image.jpg`;
const updated = "2026-11-01T12:00:00.123456Z", reviewed = "2026-11-09T12:00:00.000Z";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function packet() {
  return { action: "record_reviewed_analysis", verdict: {
    image_id: imageId, vehicle_id: vehicleId, scene_type: "body_exterior", build_phase_guess: "final_assembly",
    intent: "documentation", intent_confidence: .8, components_seen: [],
    state_observations: { rust_severity: "unknown", paint_state: "unknown", completeness: "assembled" },
    workshop_signals: { tools_visible: [], fixturing: "unknown", lighting: "unknown" }, presence: { person: false },
    camera_pose: { framing: "whole vehicle", azimuth_deg: null, distance_est: null },
    narrative_one_line: "Whole vehicle visible in the reviewed frame.", confidence: .9,
  }, source: { image_url: sourceUrl, expected_updated_at: updated, reviewed_url: sourceUrl,
    reviewed_sha256: "a".repeat(64), reviewed_at: reviewed }, provenance: {
    agent_model: "fixture-model", agent_tier: "interactive", extraction_method: "visual review", run_id: "fixture",
  } };
}
// thin: the projection's answer for an automatic reading (migration 20261120140000; the shape supabase/sql/test_thin_real_row.sql
// pins): nothing is placed on the photo, and it says so.
async function run(injectInvalidExtractor = false, input: any = packet(), photo = { id: imageId, url: sourceUrl, updated, now: reviewed, vehicle: vehicleId }, thin = false) {
  const originalFetch = globalThis.fetch, inserts: Record<string, any>[] = [], paths: string[] = [];
  let projected = 0, producerInput: any;
  globalThis.fetch = (async (request, init) => {
    const url = new URL(typeof request === "string" ? request : request instanceof URL ? request.href : request.url);
    assertEquals(url.origin, project);
    const method = init?.method ?? "GET", headers = new Headers(init?.headers);
    assertEquals(headers.get("apikey"), serviceKey);
    paths.push(`${method} ${url.pathname}`);
    if (url.pathname === "/rest/v1/observation_sources") {
      assertEquals(url.searchParams.get("slug"), "eq.photo_pipeline");
      return Response.json([{ id: sourceId, base_trust_score: .7, supported_observations: ["condition"] }]);
    }
    if (url.pathname === "/rest/v1/vehicle_observations" && method === "GET") return Response.json([]);
    if (url.pathname === "/rest/v1/vehicle_observations" && method === "POST") {
      const row = JSON.parse(String(init?.body)); inserts.push(row);
      assertEquals(headers.get("x-nuke-writer"), "ingest-observation");
      if (row.extractor_id != null && !uuid.test(row.extractor_id)) {
        return Response.json({ code: "22P02", message: "invalid input syntax for type uuid: extractor_id" }, { status: 400 });
      }
      return Response.json([{ ...row, id: observationId }], { status: 201 });
    }
    throw new Error(`unexpected effect: ${method} ${url.pathname}`);
  }) as typeof fetch;
  try {
    const result = await recordReviewedAnalysis(input, {
      authorize: async () => true,
      readImage: async () => ({ id: photo.id, vehicle_id: photo.vehicle, image_url: photo.url, updated_at: photo.updated,
        vision_gate_status: "approved", ai_scan_metadata: {} }),
      now: () => Date.parse(photo.now),
      ingest: async (input: any) => {
        producerInput = input;
        const body = injectInvalidExtractor ? { ...input, extractor_id: "photo-pipeline-orchestrator" } : input;
        const response = await ingestHandler(new Request(`${project}/functions/v1/ingest-observation`, {
          method: "POST", headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }));
        return await response.json();
      },
      project: async (id: string) => {
        projected++;
        assertEquals(id, observationId);
        if (thin) {
          return { success: true, observation_id: id, image_id: photo.id, vehicle_id: photo.vehicle, projection_duplicate: null,
            image_observation_id: null, search_vehicle_id: null, cover: { vehicle_id: photo.vehicle, changed: false, reason: "thin_tier_reading" },
            thin_tier: true, superseded_readings: 0, model_calls: 0 };
        }
        return { success: true, observation_id: id, image_observation_id: placementId,
          image_id: photo.id, vehicle_id: photo.vehicle };
      },
    });
    return { result, producerInput, inserts, paths, projected };
  } finally { globalThis.fetch = originalFetch; }
}
Deno.test("reviewed source reaches actual intake with UUID-safe attribution and exact deferred citation", async () => {
  const r = await run();
  assertEquals(r.result.image_observation_id, placementId); assertEquals(r.result.model_calls, 0);
  assertEquals(r.projected, 1); assertEquals(r.inserts.length, 1);
  const row = r.inserts[0];
  assert(row.extractor_id == null, "No registered extractor UUID is established; producer label must not populate it");
  assertEquals(row.extraction_method, "reviewed_image_analysis_v1");
  assertEquals(row.source_id, sourceId); assertEquals(row.source_url, sourceUrl); assertEquals(row.vehicle_id, vehicleId);
  assertEquals(row.structured_data.image_id, imageId); assertEquals(row.structured_data.witness_image_id, imageId);
  assertEquals(row.raw_source_ref, `vehicle_images:${imageId}`);
  assertEquals(row.extraction_metadata.reviewed_image, packet().source);
  assertEquals(row.extraction_metadata.reviewer_provenance, packet().provenance);
  assertEquals(row.source_identifier, r.producerInput.source_identifier);
  assertEquals(row.analysis_deferred, true); assertEquals(row.confidence_score, .6);
  assertEquals(r.paths, ["GET /rest/v1/observation_sources", "GET /rest/v1/vehicle_observations", "POST /rest/v1/vehicle_observations"]);
});
Deno.test("actual UUID-column refusal cannot become a projected reviewed-image success", async () => {
  await assertRejects(() => run(true), Error, "review_observation_not_persisted");
});

// The automatic ("thin") reading, end to end on real code: the Mac reader's own envelope (scripts/photo-pipeline/deep-stage.mjs)
// -> the actual producer -> the actual ingest handler -> the row it INSERTs. That row is pinned in
// supabase/sql/fixtures/thin_real_rows.json, and supabase/sql/test_thin_real_row.sql puts the pinned rows through the database
// guard (guard_reviewed_image_analysis) on a real Postgres. So a key added anywhere on this path fails here first, with the
// instruction to regenerate, and then fails the database contract if the guard does not admit it.
// Regenerate: THIN_REAL_ROWS_WRITE=1 deno test --node-modules-dir=none --allow-env --allow-read=supabase/sql/fixtures \
//   --allow-write=supabase/sql/fixtures supabase/functions/photo-pipeline-orchestrator/reviewedIntakeChain_test.ts
Deno.test("the reader's automatic reading reaches the actual intake as exactly the pinned rows the database contract admits", async () => {
  const reader: any = await import("../../../scripts/photo-pipeline/deep-stage.mjs");
  // the projection's words: the list the orchestrator passes on by name is the list the reader has a rule for
  assertEquals([...reader.PROJECTION_WORDS].sort(), [...PROJECTION_REFUSALS].sort());
  const cases: any = (await import("../../../scripts/photo-pipeline/fixtures/automatic-thin-verdicts.json", { with: { type: "json" } })).default;
  const admits = reader.admitsFrom({ automatic: { admits: cases.admits } });
  const thinVehicle = "20000000-0000-4000-8000-000000000101", updatedAt = "2026-11-20T20:00:00.123456+00:00", reviewedAt = "2026-11-20T20:05:00.000Z";
  const rows: Record<string, any>[] = [];
  for (let n = 0; n < cases.accepted.length; n++) {
    const id = `30000000-0000-4000-8000-00000000010${n + 1}`;
    const url = `https://example.invalid/storage/v1/object/public/vehicle-images/${id}.jpg`;
    const verdict = { ...cases.accepted[n], image_id: id, vehicle_id: thinVehicle };
    assertEquals(reader.thinViolation(verdict, admits), null, `the reader's own check admits accepted case ${n + 1}`);
    const envelope = reader.buildEnvelope({ verdict, row: { image_url: url, updated_at: updatedAt }, reviewedUrl: url, sha256: "a".repeat(64), reviewedAt,
      provenance: reader.automaticProvenance({ model: reader.DEFAULT_MODEL, runId: "claude-cli-fire-20261120T200000Z-abc123", durationMs: 20000, method: reader.automaticMethod(admits) }) });
    const r = await run(false, envelope, { id, url, updated: updatedAt, now: reviewedAt, vehicle: thinVehicle }, true);
    assertEquals(r.inserts.length, 1); assertEquals(r.projected, 1);
    // landed as its observation alone: the producer accepts the projection's thin answer, with no placement on the photo
    assertEquals(r.result.thin_tier, true); assertEquals(r.result.image_observation_id, null); assertEquals(r.result.model_calls, 0);
    const row = r.inserts[0];
    assertEquals(row.agent_tier, "subscription automatic"); assertEquals(row.extraction_method, "reviewed_image_analysis_v1");
    assertEquals(row.source_id, sourceId);
    assertEquals(row.vehicle_id, thinVehicle);
    // the pinned row carries no source id: the database contract looks up its own photo_pipeline source
    rows.push({ n: n + 1, image_id: id, image_url: url, expected_updated_at: updatedAt, row: { ...row, source_id: null } });
  }
  const file = new URL("../../sql/fixtures/thin_real_rows.json", import.meta.url);
  if (Deno.env.get("THIN_REAL_ROWS_WRITE") === "1") { Deno.writeTextFileSync(file, JSON.stringify(rows, null, 1) + "\n"); return; }
  const stored: any = (await import("../../sql/fixtures/thin_real_rows.json", { with: { type: "json" } })).default;
  assertEquals(rows, stored, "the intake row changed: regenerate supabase/sql/fixtures/thin_real_rows.json (command above) and run supabase/sql/test_thin_real_row.sql");
});
