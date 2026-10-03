// Handler integration uses only a synthetic project/key and in-memory HTTP.
// No net permission is requested; unexpected image/model calls fail the test.
let handler: (req: Request) => Promise<Response>;
const originalServe = Deno.serve;
const originalFetch = globalThis.fetch;
const project = "https://example.invalid";
Deno.env.set("SUPABASE_URL", project);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
for (const key of ["GOOGLE_AI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "free_api_key"]) Deno.env.delete(key);
Deno.serve = ((callback: typeof handler) => { handler = callback; }) as typeof Deno.serve;

let row: Record<string, unknown>, patches = 0, calls: string[] = [], rejectWrite = false;
let classificationType = "other", intakeSuccess = true, intakeDuplicate = false, rejectEvidence = false;
let intakeBody: Record<string, unknown> | null = null;
function reset() {
  patches = 0; calls = []; rejectWrite = false;
  classificationType = "other"; intakeSuccess = true; intakeDuplicate = false; rejectEvidence = false; intakeBody = null;
  Deno.env.delete("GEMINI_API_KEY");
  row = { id: "image", image_url: "https://example.invalid/image.jpg", vehicle_id: "vehicle",
    updated_at: "2026-01-01T00:00:00.000Z", ai_scan_metadata: { byok_deep_analysis: { original: true }, on_device_vision: { version: "local-v1" } },
    ai_processing_status: "pending", apple_ml_labels: [], vehicle_score: null, is_external: true, taken_at: null };
}
globalThis.fetch = (async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const options = init as RequestInit | undefined;
  calls.push(`${options?.method ?? "GET"} ${url.pathname}`);
  if (Deno.env.get("GEMINI_API_KEY") === "synthetic-model-key") {
    if (url.origin === "https://generativelanguage.googleapis.com") {
      if (url.pathname.endsWith(":countTokens")) return Response.json({ totalTokens: 1024 });
      return Response.json({ usageMetadata: { promptTokenCount: 1024, candidatesTokenCount: 100, totalTokenCount: 1124 }, candidates: [{ content: { parts: [{ text: JSON.stringify({
        image_type: classificationType, image_medium: "photograph", is_automotive: true, description: "Synthetic image classification", confidence: 0.8,
      }) }] } }] });
    }
    if (url.origin === project && url.pathname === "/image.jpg") return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
    if (url.origin === project && url.pathname === "/rest/v1/vehicle_observations") return Response.json([]);
    if (url.origin === project && url.pathname === "/functions/v1/ingest-observation") {
      intakeBody = JSON.parse(String(options?.body));
      return Response.json({ success: intakeSuccess, observation_id: intakeSuccess ? "observation" : null, duplicate: intakeDuplicate });
    }
    if (url.origin === project && url.pathname === "/functions/v1/part-number-ocr") return Response.json({ parts: [{ number: "synthetic-part" }], parts_found: 1 });
    if (url.origin === project && url.pathname === "/rest/v1/vehicle_field_evidence") {
      return rejectEvidence ? Response.json({ message: "synthetic evidence rejection" }, { status: 400 }) : Response.json([]);
    }
  }
  if (url.origin !== project || url.pathname !== "/rest/v1/vehicle_images") throw new Error("unexpected image/model/observation request");
  if (options?.method === "PATCH") {
    if (rejectWrite) return Response.json({ message: "synthetic write rejection", code: "42501" }, { status: 400 });
    if (url.searchParams.get("updated_at") !== `eq.${row.updated_at}`) return Response.json([]);
    patches++; row = { ...row, ...JSON.parse(String(options.body)), updated_at: new Date(Date.parse(String(row.updated_at)) + 1).toISOString() };
    return Response.json([{ id: row.id }]);
  }
  return Response.json(structuredClone(row));
}) as typeof fetch;
await import("./index.ts");
Deno.serve = originalServe;

function assert(value: unknown): asserts value { if (!value) throw new Error("assertion failed"); }
function request(overrides: Record<string, unknown> = {}) {
  return new Request(`${project}/functions/v1/photo-pipeline-orchestrator`, {
    method: "POST", headers: { Authorization: "Bearer synthetic-service-key", "Content-Type": "application/json" },
    body: JSON.stringify({ image_id: "image", image_url: row.image_url, vehicle_id: "vehicle", ...overrides }),
  });
}

Deno.test("missing classifier persists failure but emits no claim or fallback", async () => {
  reset(); const response = await handler(request()); const result = await response.json();
  assert(result.success === false && result.classifier_ok === false && result.state_persisted === true);
  assert(row.ai_processing_status === "failed" && patches === 2);
  const metadata = row.ai_scan_metadata as Record<string, unknown>;
  assert(metadata.byok_deep_analysis && metadata.on_device_vision);
  const receipt = (metadata.photo_pipeline as Record<string, Record<string, unknown>>).receipt;
  assert(receipt.error_class === "classifier_key_missing" && receipt.classifier_attempts === 0);
  assert(calls.every(c => c.endsWith("/rest/v1/vehicle_images")));
});

Deno.test("database rejection cannot return a successful or completed receipt", async () => {
  reset(); rejectWrite = true; const response = await handler(request()); const result = await response.json();
  assert(response.status === 500 && result.success === false && patches === 0 && row.ai_processing_status === "pending");
});

Deno.test("wrong canonical URL or vehicle is rejected without mutating image state", async () => {
  for (const overrides of [{ image_url: "https://example.invalid/wrong.jpg" }, { vehicle_id: "wrong-vehicle" }]) {
    reset(); const response = await handler(request(overrides));
    assert(response.status === 500 && patches === 0 && row.ai_processing_status === "pending");
  }
});

Deno.test("missing updated_at token fails closed without blind metadata overwrite", async () => {
  reset(); row.updated_at = null; const response = await handler(request());
  assert(response.status === 500 && patches === 0 && row.ai_processing_status === "pending");
});

Deno.test("repeated junk policy skips claim their own attempt and preserve siblings", async () => {
  reset(); row.image_url = "https://pixel.example.invalid/tracker.jpg";
  const first = await handler(request()); assert((await first.json()).success);
  await new Promise(r => setTimeout(r, 2));
  const second = await handler(request()); assert((await second.json()).success);
  assert(patches === 4 && row.ai_processing_status === "completed");
  assert((row.ai_scan_metadata as Record<string, unknown>).byok_deep_analysis);
});

Deno.test("canonical intake duplicate is an existing inferred observation receipt", async () => {
  reset(); Deno.env.set("GEMINI_API_KEY", "synthetic-model-key"); intakeDuplicate = true;
  const response = await handler(request()); const result = await response.json();
  assert(result.success === true && result.state_persisted === true && row.ai_processing_status === "completed");
  const receipt = ((row.ai_scan_metadata as Record<string, unknown>).photo_pipeline as Record<string, Record<string, unknown>>).receipt;
  assert(receipt.observation_id === "observation" && receipt.observation_status === "existing");
  assert(intakeBody?.agent_inferred === true && intakeBody?.extraction_method === "image_analysis");
  const extraction = intakeBody?.extraction_metadata as Record<string, unknown>;
  assert(extraction.observed_at_semantics === "analysis_review_time" && extraction.capture_at === null);
});

Deno.test("rejected canonical intake cannot finish as a successful analysis", async () => {
  reset(); Deno.env.set("GEMINI_API_KEY", "synthetic-model-key"); intakeSuccess = false;
  const response = await handler(request()); const result = await response.json();
  assert(response.status === 500 && result.success === false && row.ai_processing_status === "failed");
  const receipt = ((row.ai_scan_metadata as Record<string, unknown>).photo_pipeline as Record<string, Record<string, unknown>>).receipt;
  assert(receipt.outcome === "failed" && receipt.error_class === "pipeline_operation_failed");
});

Deno.test("field evidence rejection fails completion and composite model remains unknown", async () => {
  reset(); Deno.env.set("GEMINI_API_KEY", "synthetic-model-key"); classificationType = "part_closeup"; rejectEvidence = true;
  const response = await handler(request()); const result = await response.json();
  assert(response.status === 500 && result.success === false && row.ai_processing_status === "failed");
  assert(intakeBody?.agent_model === null);
  const extraction = intakeBody?.extraction_metadata as Record<string, unknown>;
  assert(extraction.classifier_model_configured === "gemini-2.5-flash" && extraction.downstream_model === null);
  assert(calls.includes("POST /rest/v1/vehicle_field_evidence"));
});

Deno.test("classifier assay dispatches before processing and refuses ordinary pipeline fields without writes", async () => {
  reset(); const response = await handler(request({ action: "classifier_assay" }));
  const result = await response.json();
  assert(response.status === 400 && result.error === "classifier_assay_input_invalid");
  assert(patches === 0 && calls.length === 0 && row.ai_processing_status === "pending");
});

Deno.test("restore handler-test fetch fixture", () => { globalThis.fetch = originalFetch; });
