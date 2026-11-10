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
const { recordReviewedAnalysis } = await import("./reviewedAnalysis.ts");
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
async function run(injectInvalidExtractor = false) {
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
    const result = await recordReviewedAnalysis(packet(), {
      authorize: async () => true,
      readImage: async () => ({ id: imageId, vehicle_id: vehicleId, image_url: sourceUrl, updated_at: updated,
        vision_gate_status: "approved", ai_scan_metadata: {} }),
      now: () => Date.parse(reviewed),
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
        return { success: true, observation_id: id, image_observation_id: placementId,
          image_id: imageId, vehicle_id: vehicleId };
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
