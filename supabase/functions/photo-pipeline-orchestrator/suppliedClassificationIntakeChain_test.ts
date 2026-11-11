// Actual supplied-classification handler -> actual intake handler -> serialized
// INSERT and source-CAS PATCH. Database/network boundaries are deterministic.
import { assert, assertEquals } from "jsr:@std/assert";
const project = "https://example.invalid", serviceKey = "sb_secret_classification_chain_fixture";
Deno.env.set("SUPABASE_URL", project); Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", serviceKey); Deno.env.delete("SUPABASE_SECRET_KEYS");
type Handler = (request: Request) => Promise<Response>;
let captured!: Handler;
const serve = Deno.serve;
Deno.serve = ((fn: Handler) => { captured = fn; }) as typeof Deno.serve;
let ingest!: Handler, classify!: Handler;
try { await import("../ingest-observation/index.ts"); ingest = captured; await import("./index.ts"); classify = captured; }
finally { Deno.serve = serve; }
const imageId = "10000000-0000-4000-8000-000000000001", observationId = "30000000-0000-4000-8000-000000000001";
const sourceId = "40000000-0000-4000-8000-000000000001";
const version = "2026-11-01T12:00:00.123456Z";
function fixtureRow() { return { id: imageId, image_url: `${project}/preview.jpeg`, vehicle_id: null, updated_at: version,
  is_superseded: false, is_duplicate: false, ai_processing_status: "skipped",
  ai_scan_metadata: { processing_policy: { mode: "subscription_review", deferred: true },
    photo_pipeline: { receipt: { receipt_id: "prior:failed", attempt_id: "prior", outcome: "failed", processing_started_at: version } } } }; }

/** Exported only to reuse this actual boundary in a disposable SQL integration
 * fixture. Caller supplies a synthetic local row; this harness has no network. */
export async function runSuppliedClassificationChain(sourceRow: Record<string, any> = fixtureRow(),
  boundary: { observationId?: string; sourceId?: string; reviewedAt?: string } = {}) {
  let row = structuredClone(sourceRow);
  const originalFetch = globalThis.fetch, calls: string[] = [], intakeInputs: any[] = [], inserts: any[] = [], patches: any[] = [];
  const packet = { processing_mode: "classification_only", image_id: row.id, image_url: row.image_url, vehicle_id: row.vehicle_id,
    classification_raw: { image_type: "vehicle_interior", image_medium: "photograph", confidence: .9, is_automotive: true,
      description: "Black cabin with a bird emblem visible on the steering wheel.", vehicle_hints: {}, vehicle_fields: [],
      text_lines: [{ text: "R 1 3", confidence: .9 }] }, reader: "fixture-supplied-reader",
    source: { image_url: row.image_url, expected_updated_at: row.updated_at, reviewed_url: row.image_url,
      reviewed_sha256: "a".repeat(64), reviewed_at: boundary.reviewedAt ?? new Date().toISOString() },
    provenance: { agent_model: "fixture-model", agent_tier: "interactive", extraction_method: "synthetic full-frame fixture", run_id: "fixture-chain" } };
  globalThis.fetch = (async (request, init) => {
    const url = new URL(typeof request === "string" ? request : request instanceof URL ? request.href : request.url);
    assertEquals(url.origin, project);
    const method = init?.method ?? "GET"; calls.push(`${method} ${url.pathname}`);
    if (url.pathname === "/rest/v1/rpc/classifier_schema_manifest") return Response.json({});
    if (url.pathname === "/rest/v1/vehicle_images") {
      if (method === "GET") return Response.json(structuredClone(row));
      if (method === "PATCH") {
        const patch = JSON.parse(String(init?.body));
        patches.push({ query: Object.fromEntries(url.searchParams), body: patch });
        if (url.searchParams.get("updated_at") !== `eq.${row.updated_at}`) return Response.json([]);
        row = { ...row, ...patch, updated_at: new Date(Date.now() + 1).toISOString() };
        return Response.json([{ id: row.id, image_url: row.image_url, vehicle_id: row.vehicle_id }]);
      }
    }
    if (url.pathname === "/functions/v1/ingest-observation") {
      intakeInputs.push(JSON.parse(String(init?.body)));
      return await ingest(new Request(url, { method: "POST", headers: init?.headers, body: String(init?.body) }));
    }
    if (url.pathname === "/rest/v1/observation_sources") {
      assertEquals(url.searchParams.get("slug"), "eq.photo_pipeline");
      return Response.json([{ id: boundary.sourceId ?? sourceId, base_trust_score: .7, supported_observations: ["media"] }]);
    }
    if (url.pathname === "/rest/v1/vehicle_observations" && method === "GET") return Response.json([]);
    if (url.pathname === "/rest/v1/vehicle_observations" && method === "POST") {
      const inserted = JSON.parse(String(init?.body)); inserts.push(inserted);
      assertEquals(new Headers(init?.headers).get("x-nuke-writer"), "ingest-observation");
      assert(inserted.extractor_id == null, "No extractor registry identity is invented");
      return Response.json([{ ...inserted, id: boundary.observationId ?? observationId }], { status: 201 });
    }
    throw new Error(`Unexpected effect: ${method} ${url.pathname}`);
  }) as typeof fetch;
  try {
    const result = await classify(new Request(`${project}/functions/v1/photo-pipeline-orchestrator`, {
      method: "POST", headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" }, body: JSON.stringify(packet),
    }));
    return { packet, status: result.status, response: await result.json(), intakeInputs, inserts, patches, finalRow: row, calls };
  } finally { globalThis.fetch = originalFetch; }
}
Deno.test({ name: "supplied classification reaches real intake as deferred source-only history before exact-source cache", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const r = await runSuppliedClassificationChain(); assertEquals(r.status, 200); assertEquals(r.response.model_calls, 0);
  assertEquals(r.inserts.length, 1); assertEquals(r.patches.length, 1);
  const stored = r.inserts[0], cache = r.finalRow.ai_scan_metadata;
  assertEquals(stored.vehicle_id, null); assertEquals(stored.analysis_deferred, true); assertEquals(stored.confidence_score, .6);
  assertEquals(stored.raw_source_ref, `vehicle_images:${imageId}`); assertEquals(stored.extraction_method, "supplied_image_classification_v1");
  assertEquals(stored.source_url, r.packet.source.image_url); assertEquals(stored.extraction_metadata.source, r.packet.source);
  assertEquals(stored.structured_data.classification, cache.classification);
  assertEquals(stored.structured_data.previous_pipeline_receipt.receipt_id, "prior:failed");
  assert(!("image_id" in stored.structured_data)); assert(!("witness_image_id" in stored.structured_data));
  assertEquals(cache.classification_review.observation_id, observationId);
  assertEquals(cache.classification_review.source_identifier, stored.source_identifier);
  assertEquals(r.patches[0].query.updated_at, `eq.${version}`);
  assertEquals(r.finalRow.vehicle_id, null); assertEquals(cache.processing_policy, fixtureRow().ai_scan_metadata.processing_policy);
  assert(r.calls.indexOf("POST /rest/v1/vehicle_observations") < r.calls.indexOf("PATCH /rest/v1/vehicle_images"));
} });
Deno.test({ name: "withdrawn intake source cannot create supplied history or projection", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const r = await runSuppliedClassificationChain({ ...fixtureRow(), is_superseded: true });
  assertEquals(r.status, 409); assertEquals(r.response.error, "classification_source_changed");
  assertEquals(r.inserts.length, 0); assertEquals(r.patches.length, 0);
} });
