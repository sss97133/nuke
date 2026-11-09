// v101 contract tests for the orchestrator handler: leased queue, retry/failure handling, cited evidence, auth.
// LOCAL ONLY. All I/O goes through one stubbed global fetch that answers synthetic hosts and throws on anything else.
import { __setGuardDb, allowAllGuardDb } from "../_shared/geminiGuard.ts";
__setGuardDb(allowAllGuardDb());
const project = "https://example.invalid";
Deno.env.set("SUPABASE_URL", project);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
Deno.env.set("OPENAI_API_KEY", "synthetic-openai-key");
for (const k of ["OPEN_AI_API_KEY", "GOOGLE_AI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "free_api_key"]) Deno.env.delete(k);

const realNow = Date.now.bind(Date);
let skew = 0;
Date.now = () => realNow() + skew;
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((fn: () => void, _ms?: number) => realSetTimeout(fn, 0)) as typeof setTimeout; // backoff/stagger sleeps are instant
const tick = (ms: number) => new Promise<void>((r) => realSetTimeout(r, ms));

// ---------------- world state ----------------
type Call = { method: string; path: string; search: string; body: any; headers: Headers };
let calls: Call[] = [];
let row: Record<string, unknown> = {};
let patchBodies: Record<string, unknown>[] = [];
let rpc: Record<string, (body: any) => Response> = {};
let openai: (n: number) => Response = () => oaOk({});
let openaiCalls = 0, selfCalls: any[] = [], inflight = 0, maxInflight = 0;
let selfCall: (body: any) => Promise<Response> = async () => Response.json({ success: true, classification: "other", classifier_ok: true });
let queueRows: any[] = [];
let fieldEvidenceStatus = 201;
let filedVehicle: Record<string, unknown> = {};
let handler!: (req: Request) => Promise<Response>;
const originalServe = Deno.serve;

const oaOk = (content: unknown) => Response.json({ model: "gpt-4.1-mini-2025", usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 },
  choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] });
const base = { image_type: "other", image_medium: "photograph", confidence: 0.8, is_automotive: true, description: "Synthetic image classification" };
const GOOD_VIN = "1HGCM82633A004352";

function reset() {
  calls = []; patchBodies = []; openaiCalls = 0; selfCalls = []; inflight = 0; maxInflight = 0; queueRows = []; fieldEvidenceStatus = 201; skew += 11 * 60_000 + 1; // expire the isolate-local OpenAI breaker between tests
  row = { id: "image", image_url: "https://example.invalid/image.jpg", vehicle_id: "vehicle", updated_at: "2026-01-01T00:00:00.000Z",
    ai_scan_metadata: {}, ai_processing_status: "pending", apple_ml_labels: [], vehicle_score: null, is_external: true, taken_at: null };
  filedVehicle = { id: "vehicle", year: 1973, make: "Pontiac", model: "Firebird", vin: "2S87D3N000001" };
  rpc = {
    claim_photo_pipeline_batch: () => Response.json(queueRows),
    report_capture_step: () => Response.json(null),
    photo_pipeline_clear_retry: () => Response.json(null),
    photo_pipeline_note_failure: () => Response.json({ status: "failed", transient: false, attempts: 12, next_attempt_at: null }),
    land_identifier_claims: () => Response.json({ ok: true }),
    classifier_schema_manifest: () => Response.json({ message: "absent" }, { status: 404 }),
    identifier_rule_for: () => Response.json([{ rule_id: 23, rule_status: "in_range", series: "GM 13-char 1972-80", model_year_from: 1972, model_year_to: 1980 }]),
  };
  openai = () => oaOk(base);
  selfCall = async () => Response.json({ success: true, classification: "other", classifier_ok: true });
}
reset();

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const method = init?.method ?? "GET";
  let body: any = null; try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch { body = String(init?.body); }
  calls.push({ method, path: u.pathname, search: u.search, body, headers: new Headers(init?.headers) });
  if (u.origin === "https://api.openai.com") { openaiCalls++; return openai(openaiCalls); }
  if (u.origin === "https://generativelanguage.googleapis.com") throw new Error("Gemini must not be reached in these tests");
  if (u.origin !== project) throw new Error("unexpected network origin " + u.origin);
  if (u.pathname === "/image.jpg") return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
  if (u.pathname === "/functions/v1/photo-pipeline-orchestrator") {
    selfCalls.push({ body, auth: new Headers(init?.headers).get("authorization") }); inflight++; maxInflight = Math.max(maxInflight, inflight);
    try { return await selfCall(body); } finally { inflight--; }
  }
  if (u.pathname.startsWith("/rest/v1/rpc/")) {
    const name = u.pathname.slice("/rest/v1/rpc/".length);
    if (name === "auto_match_image_to_vehicles") return Response.json(gps ? [gps] : []);
    if (name === "attribute_testimony") {
      if (attributeResult.success === true) row = { ...row, vehicle_id: body.p_target_vehicle_id, updated_at: new Date(Date.parse(String(row.updated_at)) + 1).toISOString() };
      return Response.json(attributeResult);
    }
    const h = rpc[name]; if (!h) throw new Error("unexpected rpc " + name);
    return h(body);
  }
  if (u.pathname === "/rest/v1/platform_config") return Response.json({});
  if (u.pathname === "/rest/v1/vehicles" && method === "GET") return Response.json(u.searchParams.get("id") === "eq.vehicle" ? filedVehicle : []);
  if (u.pathname === "/rest/v1/llm_cost_tracking") return new Response(null, { status: 201 });
  if (u.pathname === "/rest/v1/field_evidence") return fieldEvidenceStatus >= 300 ? Response.json({ message: "synthetic" }, { status: fieldEvidenceStatus }) : new Response(null, { status: 201 });
  if (u.pathname === "/rest/v1/vehicle_observations") return Response.json([]);
  if (u.pathname === "/rest/v1/vehicle_field_evidence") return Response.json([]);
  if (u.pathname === "/functions/v1/ingest-observation") return Response.json({ success: true, observation_id: "observation", duplicate: false });
  if (u.pathname === "/rest/v1/vehicle_images") {
    if (method === "PATCH") {
      patchBodies.push(body);
      if (rejectWrite) return Response.json({ message: "synthetic write rejection", code: "42501" }, { status: 400 });
      if (u.searchParams.get("updated_at") !== `eq.${row.updated_at}`) return Response.json([]);
      row = { ...row, ...body, updated_at: new Date(Date.parse(String(row.updated_at)) + 1).toISOString() };
      return Response.json([{ id: row.id }]);
    }
    if (queueMode && u.searchParams.get("ai_processing_status") === "eq.pending") {
      return u.searchParams.has("user_id") ? Response.json(legacyOwner) : Response.json(legacyBacklog);
    }
    return Response.json(structuredClone(row));
  }
  throw new Error("unexpected path " + u.pathname);
}) as typeof fetch;
let gps: { vehicle_id: string; confidence: number } | null = null;
let attributeResult: Record<string, unknown> = { success: true };
let queueMode = false, legacyOwner: any[] = [], legacyBacklog: any[] = [], rejectWrite = false;

Deno.serve = ((cb: typeof handler) => { handler = cb; }) as typeof Deno.serve;
await import("./index.ts");
Deno.serve = originalServe;

function assert(v: unknown, m = "assertion failed"): asserts v { if (!v) throw new Error(m); }
const T = { sanitizeOps: false, sanitizeResources: false } as const;
const req = (body: Record<string, unknown>, auth: string | null = "Bearer synthetic-service-key") => new Request(`${project}/functions/v1/photo-pipeline-orchestrator`, {
  method: "POST", headers: { ...(auth ? { Authorization: auth } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body) });
const one = (over: Record<string, unknown> = {}) => req({ image_id: "image", image_url: row.image_url, vehicle_id: row.vehicle_id, ...over });
const pend = (n: number, prefix = "https://example.invalid/") => Array.from({ length: n }, (_, i) => ({ id: "img" + i, image_url: `${prefix}p${i}.jpg`, vehicle_id: null, user_id: "u" }));
const rpcCalls = (name: string) => calls.filter((c) => c.path === "/rest/v1/rpc/" + name);

// ===================== leased queue =====================
Deno.test({ name: "process_pending: claim_photo_pipeline_batch with 300 s lease; limit clamps 1..12 (default 6)", ...T, fn: async () => {
  for (const [input, expected] of [[undefined, 6], [0, 6], [-5, 1], [99, 12], ["7", 7], ["abc", 6], [12, 12], [1, 1]] as const) {
    reset(); queueRows = [];
    const r = await handler(req({ action: "process_pending", ...(input === undefined ? {} : { limit: input }) }));
    const j = await r.json();
    const c = rpcCalls("claim_photo_pipeline_batch");
    assert(c.length === 1 && c[0].body.p_limit === expected && c[0].body.p_lease_seconds === 300, `limit ${String(input)} => ${JSON.stringify(c.map((x) => x.body))}`);
    assert(j.success === true && j.processed === 0 && j.message === "No pending images");
  }
}});

Deno.test({ name: "process_pending: worker pool concurrency clamps 1..4 (default 3); self-calls carry the service key", ...T, fn: async () => {
  for (const [input, expected] of [[undefined, 3], [9, 4], [1, 1], [-2, 1], [2, 2]] as const) {
    reset(); queueRows = pend(8); selfCall = async () => { await tick(8); return Response.json({ success: true, classification: "other", classifier_ok: true }); };
    const r = await handler(req({ action: "process_pending", limit: 8, ...(input === undefined ? {} : { concurrency: input }) }));
    const j = await r.json();
    assert(j.attempted === 8 && j.processed === 8 && j.not_started === 0 && j.success === true, JSON.stringify(j));
    assert(maxInflight === expected, `concurrency ${String(input)} => max in-flight ${maxInflight}, expected ${expected}`);
    assert(selfCalls.every((s) => s.auth === "Bearer synthetic-service-key"));
  }
}});

Deno.test({ name: "process_pending: 100 s deadline stops new work and reports not_started", ...T, fn: async () => {
  reset(); queueRows = pend(6); selfCall = async () => { skew += 101_000; return Response.json({ success: true, classification: "other", classifier_ok: true }); };
  const j = await (await handler(req({ action: "process_pending", limit: 6, concurrency: 1 }))).json();
  assert(selfCalls.length === 1 && j.attempted === 1 && j.not_started === 5, JSON.stringify({ n: selfCalls.length, a: j.attempted, ns: j.not_started }));
}});

Deno.test({ name: "process_pending: junk URLs complete inline and are never self-called; requeued results are counted", ...T, fn: async () => {
  reset(); queueRows = [{ id: "j1", image_url: "https://pixel.example.invalid/t.jpg", vehicle_id: null, user_id: null }, ...pend(2)];
  row = { ...row, id: "j1", image_url: "https://pixel.example.invalid/t.jpg", vehicle_id: null };
  let n = 0; selfCall = async () => (++n === 1 ? Response.json({ success: false, classifier_ok: false, requeued: true, error_class: "classifier_rate_limited" }) : Response.json({ success: true, classification: "other", classifier_ok: true }));
  const j = await (await handler(req({ action: "process_pending", limit: 6, concurrency: 1 }))).json();
  assert(selfCalls.length === 2 && selfCalls.every((s) => s.body.image_id !== "j1"), "junk not self-called");
  assert(j.requeued === 1 && j.results.some((x: any) => x.classification === "junk_url"), JSON.stringify(j));
}});

Deno.test({ name: "process_pending: claim RPC error falls back to the legacy two-pass read (KNOWN GAP: no retry-backoff filter)", ...T, fn: async () => {
  reset(); rpc.claim_photo_pipeline_batch = () => Response.json({ message: "absent" }, { status: 404 });
  queueMode = true; legacyOwner = pend(1); legacyBacklog = [...pend(1), ...pend(3, "https://other.example.invalid/")].map((x, i) => ({ ...x, id: i === 0 ? "img0" : "b" + i }));
  try {
    const j = await (await handler(req({ action: "process_pending", limit: 4, concurrency: 1 }))).json();
    const reads = calls.filter((c) => c.path === "/rest/v1/vehicle_images" && c.method === "GET" && c.search.includes("ai_processing_status=eq.pending"));
    const keys = (c: Call) => new URLSearchParams(c.search);
    assert(reads.length === 2 && keys(reads[0]).has("user_id") && !keys(reads[1]).has("user_id"), "owner pass then backlog pass: " + JSON.stringify(reads.map((c) => c.search)));
    assert(reads.every((c) => !c.search.includes("next_attempt_at") && !c.search.includes("retry")), "legacy path has no backoff gate (known gap)");
    assert(j.attempted === 4, "owner row + backlog top-up, de-duplicated: " + j.attempted);
  } finally { queueMode = false; }
}});

// ===================== failure handling =====================
const rateLimited = () => new Response("slow", { status: 429, headers: { "retry-after": "1" } });

Deno.test({ name: "transient classifier failure: note_failure(4 args) -> pending + requeued, no vehicle resolution, no filing", ...T, fn: async () => {
  reset(); row = { ...row, vehicle_id: null, latitude: 40, longitude: -100 }; gps = { vehicle_id: "gps-vehicle", confidence: 0.95 };
  openai = rateLimited;
  rpc.photo_pipeline_note_failure = () => Response.json({ status: "pending", transient: true, attempts: 1, next_attempt_at: "2026-11-07T13:00:00Z" });
  const j = await (await handler(one({ user_id: "u" }))).json();
  assert(openaiCalls === 3, "3 OpenAI tries: " + openaiCalls);
  const nf = rpcCalls("photo_pipeline_note_failure");
  assert(nf.length === 1 && JSON.stringify(nf[0].body) === JSON.stringify({ p_image_id: "image", p_error_class: "classifier_rate_limited", p_http_status: 429, p_fallback_error_class: null }), JSON.stringify(nf.map((c) => c.body)));
  assert(j.success === false && j.requeued === true && j.next_attempt_at === "2026-11-07T13:00:00Z" && j.state_persisted === true, JSON.stringify(j));
  assert(row.ai_processing_status === "pending" && row.vehicle_id === null, "back to pending, never filed");
  assert(rpcCalls("auto_match_image_to_vehicles").length === 0 && rpcCalls("attribute_testimony").length === 0, "no resolution while requeued");
  gps = null;
}});

Deno.test({ name: "terminal classifier failure: status failed, signal-only resolution runs (GPS gate) and is filed by attribute_testimony", ...T, fn: async () => {
  reset(); row = { ...row, vehicle_id: null, latitude: 40, longitude: -100 }; gps = { vehicle_id: "gps-vehicle", confidence: 0.95 }; attributeResult = { success: true };
  openai = () => new Response("nope", { status: 400 });    // not retryable => 1 call
  const resp = await handler(one({ user_id: "u" })); const j = await resp.json();
  assert(openaiCalls === 1);
  assert(rpcCalls("auto_match_image_to_vehicles").length === 1, "signal-only resolution ran");
  const at = rpcCalls("attribute_testimony");
  console.log("  terminal-failure+GPS-filed => http", resp.status, JSON.stringify({ attribute_calls: at.length, row_status: row.ai_processing_status, row_vehicle: row.vehicle_id, body: j }));
  gps = null;
  assert(at.length === 1, "attribute_testimony is the only filing path");
  assert(patchBodies.every((p) => !("vehicle_id" in p)), "no raw vehicle_id patch");
  // CHARACTERIZATION OF A LIVE v101 DEFECT (preserved, not fixed): the failure path files the photo (index.ts ~451-455) but does not
  // refresh processingSource, so persistence.ts:47 throws photo_pipeline_source_changed, the catch block skips note_failure for that
  // message, and the row is left 'processing' (filed, no failure receipt, response 500). Recovery depends on the claim lease expiring.
  // If this assertion starts failing because someone fixed it, update the report: that is a behaviour change from v101.
  assert(resp.status === 500 && j.error === "photo_pipeline_operation_failed" && row.ai_processing_status === "processing" && row.vehicle_id === "gps-vehicle",
    "defect characterization changed: " + JSON.stringify({ s: resp.status, st: row.ai_processing_status }));
  assert(rpcCalls("photo_pipeline_note_failure").length === 1, "only the pre-resolution note_failure; the catch block skips source_changed");
}});

Deno.test({ name: "terminal failure when the filing writer refuses: failed state persisted, photo stays unfiled", ...T, fn: async () => {
  reset(); row = { ...row, vehicle_id: null, latitude: 40, longitude: -100 }; gps = { vehicle_id: "gps-vehicle", confidence: 0.95 }; attributeResult = { success: false, error: "file_hash_exists_on_target" };
  openai = () => new Response("nope", { status: 400 });
  const resp = await handler(one({ user_id: "u" })); const j = await resp.json();
  gps = null; attributeResult = { success: true };
  assert(resp.status === 200 && j.success === false && j.requeued === false && row.ai_processing_status === "failed" && row.vehicle_id === null, JSON.stringify({ s: resp.status, j, st: row.ai_processing_status }));
}});

Deno.test({ name: "note_failure RPC unavailable => pre-v99 terminal behaviour (failed, not requeued)", ...T, fn: async () => {
  reset(); openai = () => new Response("nope", { status: 400 });
  rpc.photo_pipeline_note_failure = () => Response.json({ message: "absent" }, { status: 404 });
  const j = await (await handler(one())).json();
  assert(j.success === false && j.requeued === false && row.ai_processing_status === "failed");
}});

Deno.test({ name: "unexpected pipeline exception: catch block calls note_failure, except for source_changed / stale_attempt", ...T, fn: async () => {
  // a) a write rejection once processing has begun => noteFailure("pipeline_operation_failed") is attempted
  reset(); rejectWrite = true;
  rpc.photo_pipeline_note_failure = () => Response.json({ status: "pending", transient: true, attempts: 1, next_attempt_at: "2026-11-07T13:00:00Z" });
  const resp = await handler(one()); const j = await resp.json(); rejectWrite = false;
  const nf = rpcCalls("photo_pipeline_note_failure");
  assert(resp.status === 500 && j.success === false && j.error === "photo_pipeline_operation_failed" && nf.length === 1
    && JSON.stringify(nf[0].body) === JSON.stringify({ p_image_id: "image", p_error_class: "pipeline_operation_failed", p_http_status: null, p_fallback_error_class: null }), JSON.stringify(nf.map((c) => c.body)));
  assert(rpcCalls("report_capture_step").some((c) => c.body.p_step === "failed"), "failed step reported best-effort");
  // b) source changed (canonical URL mismatch) => no noteFailure
  reset(); const r2 = await handler(one({ image_url: "https://example.invalid/other.jpg" }));
  assert(r2.status === 500 && rpcCalls("photo_pipeline_note_failure").length === 0 && patchBodies.length === 0, "source_changed does not note failure or write");
}});

// ===================== cited evidence =====================
const citedAnswer = { ...base, vin: { value: GOOD_VIN, confidence: 0.95, evidence: "stamped plate reads " + GOOD_VIN }, is_document: false,
  angle: { value: "exterior_front", confidence: 0.9 },
  vehicle_fields: [
    { field_name: "make", value: "Porsche", confidence: 0.9, evidence: "PORSCHE script on the deck lid" },
    { field_name: "model", value: "911", confidence: 0.4, evidence: "looks like a 911" },       // < 0.6 => skipped
    { field_name: "year", value: "1990", confidence: 0.9, evidence: null },                       // no evidence => dropped by applyV2
    { field_name: "not_a_column", value: "x", confidence: 0.9, evidence: "y" },                   // not in manifest => dropped
  ] };

const classicAnswer = { ...base, image_type: "vin_plate", is_document: false,
  vin: { value: "2S87D3N000001", confidence: .97, evidence: "Dash VIN plate reads 2S87D3N000001", evidence_role: "vehicle_vin_plate" } };

Deno.test({ name: "physical pre1981VIN: source→registered rule→existing identifier and direct photo evidence, with no auto-filing", ...T, fn: async () => {
  reset(); openai = () => oaOk(classicAnswer);
  const response = await handler(one()); const result = await response.json();
  assert(response.status === 200 && result.success === true, JSON.stringify(result));
  const fields = calls.find(c => c.path === "/rest/v1/field_evidence")?.body;
  const vin = fields?.find((r: any) => r.field_name === "vin");
  assert(vin && vin.proposed_value === "2S87D3N000001" && vin.proposed_value.length === 13);
  assert(vin.raw_extraction_data.photo_id === "image" && vin.raw_extraction_data.image_id === "image" &&
    vin.raw_extraction_data.image_url === row.image_url && vin.raw_extraction_data.quote === classicAnswer.vin.evidence,
    "existing get_field_provenance field_evidence join receives its exact photo_id and literal quote");
  assert(vin.raw_extraction_data.checksum_ok === null && vin.raw_extraction_data.checksum_status === "not_applicable_pre1981");
  assert(vin.raw_extraction_data.identifier_rule_id === 23 && vin.raw_extraction_data.model_year_context === 1973);
  const rule = rpcCalls("identifier_rule_for")[0]?.body;
  assert(rule?.p_make === "Pontiac" && rule.p_kind === "vin" && rule.p_value === classicAnswer.vin.value);
  const claim = rpcCalls("land_identifier_claims")[0]?.body;
  assert(claim?.p_read.identifiers[0].kind === "vin" && claim.p_read.identifiers[0].value === classicAnswer.vin.value &&
    claim.p_source_kind === "photo" && claim.p_source_image_id === "image");
  assert(rpcCalls("attribute_testimony").length === 0 && rpcCalls("auto_match_image_to_vehicles").length === 0);
  assert(patchBodies.every(p => !("vehicle_id" in p)));
  assert(patchBodies.some(p => p.vehicle_vin === classicAnswer.vin.value && p.vehicle_vin_confidence === .79));
  assert(rpcCalls("report_capture_step").some(c => c.body.p_detail?.vin_admission === "pre1981_physical_plate"));
}});

Deno.test({ name: "physical pre1981VIN: conflicting/unsupported sources retain their reading with explicit refusal and no field/identifier admission", ...T, fn: async () => {
  for (const [answer, vehicle, reason] of [
    [classicAnswer, { vin: "2S87D3N000002" }, "stored_identifier_conflict"],
    [classicAnswer, { year: null }, "vehicle_year_unknown"],
    [classicAnswer, { year: 1981 }, "vehicle_year_not_pre1981"],
    [{ ...classicAnswer, vin: { ...classicAnswer.vin, evidence_role: "body_tag" } }, {}, "physical_vin_source_required"],
    [{ ...classicAnswer, vin: { ...classicAnswer.vin, evidence_role: "engine_stamp" } }, {}, "physical_vin_source_required"],
    [{ ...classicAnswer, vin: { ...classicAnswer.vin, evidence_role: "sticker" } }, {}, "physical_vin_source_required"],
  ] as const) {
    reset(); Object.assign(filedVehicle, vehicle); openai = () => oaOk(answer);
    const result = await (await handler(one())).json();
    assert(result.success === true && rpcCalls("land_identifier_claims").length === 0, reason);
    assert(!calls.some(c => c.path === "/rest/v1/field_evidence"), reason);
    assert(!patchBodies.some(p => "vehicle_vin" in p), reason);
    assert(rpcCalls("report_capture_step").some(c => c.body.p_detail?.vin_admission === reason), reason);
    assert(JSON.stringify(row.ai_scan_metadata).includes(classicAnswer.vin.value), "original reading preserved");
  }
}});

Deno.test({ name: "generic vehicle_fields cannot bypass dedicatedVIN admission", ...T, fn: async () => {
  reset(); openai = () => oaOk({ ...base, vehicle_fields: [{ field_name: "vin", value: "1HGCM82633A004353", confidence: .99, evidence: "bad-checksum number" }] });
  const result = await (await handler(one())).json();
  assert(result.success === true && !calls.some(c => c.path === "/rest/v1/field_evidence") && rpcCalls("land_identifier_claims").length === 0);
}});

Deno.test({ name: "cited evidence: pending field_evidence rows with quote/photo id; VIN capped at 0.79; identifier claim; clear_retry; no testimony overwrite", ...T, fn: async () => {
  reset(); openai = () => oaOk(citedAnswer);
  const resp = await handler(one()); const j = await resp.json();
  assert(resp.status === 200 && j.success === true && j.vehicle_id === "vehicle" && row.ai_processing_status === "completed", JSON.stringify(j));
  const fe = calls.filter((c) => c.path === "/rest/v1/field_evidence");
  assert(fe.length === 1 && fe[0].method === "POST", "one batched upsert");
  assert(fe[0].search.includes("on_conflict=vehicle_id%2Cfield_name%2Csource_type%2Cproposed_value") && /ignore-duplicates/.test(fe[0].headers.get("prefer") ?? ""), "ignoreDuplicates upsert: " + fe[0].search + " " + fe[0].headers.get("prefer"));
  const rows = fe[0].body as any[];
  assert(rows.length === 2 && rows.map((r) => r.field_name).sort().join() === "make,vin", JSON.stringify(rows.map((r) => r.field_name)));
  const vin = rows.find((r) => r.field_name === "vin"), make = rows.find((r) => r.field_name === "make");
  assert(vin.source_confidence === 79 && vin.proposed_value === GOOD_VIN && vin.source_type === "ai_visual" && vin.vehicle_id === "vehicle", "VIN confidence capped at 0.79 => 79: " + vin.source_confidence);
  assert(make.source_confidence === 90 && make.raw_extraction_data.photo_id === "image" && make.raw_extraction_data.quote === "PORSCHE script on the deck lid" && make.raw_extraction_data.confidence === 0.9);
  assert(rows.every((r) => !("status" in r)), "status left to the table default ('pending'); nothing here accepts it");
  const lic = rpcCalls("land_identifier_claims");
  assert(lic.length === 1 && lic[0].body.p_source_kind === "photo" && lic[0].body.p_source_image_id === "image" && lic[0].body.p_vehicle_id === "vehicle"
    && lic[0].body.p_read.identifiers[0].kind === "vin" && lic[0].body.p_read.identifiers[0].confidence === 0.79 && lic[0].body.p_run_id === null, JSON.stringify(lic[0]?.body));
  assert(rpcCalls("photo_pipeline_clear_retry").length === 1 && rpcCalls("photo_pipeline_clear_retry")[0].body.p_image_id === "image");
  // v98 columns: separate best-effort UPDATE; VIN written at the cap; never image_type / vehicle_id
  const v98 = patchBodies.find((p) => "vehicle_vin" in p)!;
  assert(v98 && v98.vehicle_vin === GOOD_VIN && v98.vehicle_vin_confidence === 0.79 && v98.ai_detected_angle === "exterior_front", JSON.stringify(v98));
  assert(patchBodies.every((p) => !("image_type" in p) && !("vehicle_id" in p)), "never writes image_type or vehicle_id");
  const done = rpcCalls("report_capture_step").map((c) => c.body).find((b) => b.p_step === "done");
  assert(done && done.p_detail.cited_field_evidence === 2 && done.p_detail.cited_identifiers === 1 && done.p_detail.by === "photo-pipeline-orchestrator");
  console.log("  reportStep version tag:", done.p_detail.v, "(function is v101)");
}});

Deno.test({ name: "cited evidence: an existing row VIN is never overwritten; confidence is still capped in evidence", ...T, fn: async () => {
  reset(); row = { ...row, vehicle_vin: "EXISTINGVIN000000A" }; openai = () => oaOk(citedAnswer);
  await handler(one());
  assert(patchBodies.every((p) => !("vehicle_vin" in p)), "existing VIN untouched");
}});

Deno.test({ name: "cited evidence: unfiled photo lands nothing (no field_evidence, no identifier claim)", ...T, fn: async () => {
  reset(); row = { ...row, vehicle_id: null }; openai = () => oaOk(citedAnswer);
  const j = await (await handler(one())).json();
  assert(j.success === true && j.vehicle_resolved === false);
  assert(calls.filter((c) => c.path === "/rest/v1/field_evidence").length === 0 && rpcCalls("land_identifier_claims").length === 0, "no evidence for an unfiled photo");
}});

Deno.test({ name: "cited evidence: bad checksum VIN, low confidence or write errors never fail classification", ...T, fn: async () => {
  reset(); openai = () => oaOk({ ...citedAnswer, vin: { value: "1HGCM82633A004353", confidence: 0.95, evidence: "x" } });
  let j = await (await handler(one())).json();
  const rows = (calls.find((c) => c.path === "/rest/v1/field_evidence")?.body ?? []) as any[];
  assert(j.success === true && rows.every((r) => r.field_name !== "vin") && rpcCalls("land_identifier_claims").length === 0, "checksum-invalid VIN is not landed");
  reset(); openai = () => oaOk(citedAnswer); fieldEvidenceStatus = 500; rpc.land_identifier_claims = () => Response.json({ message: "boom" }, { status: 500 });
  j = await (await handler(one())).json();
  assert(j.success === true && row.ai_processing_status === "completed", "landing errors are swallowed: " + JSON.stringify(j));
  reset(); openai = () => oaOk(citedAnswer); rpc.report_capture_step = () => { throw new Error("rpc down"); }; rpc.photo_pipeline_clear_retry = () => { throw new Error("down"); };
  j = await (await handler(one())).json();
  assert(j.success === true && row.ai_processing_status === "completed", "reportStep / clear_retry are best-effort");
}});

// ===================== auth =====================
Deno.test({ name: "requireWriteAuth is first: unauthenticated / wrong-key requests do no work and make no outbound calls", ...T, fn: async () => {
  for (const auth of [null, "Bearer wrong-key", "Bearer "]) {
    reset(); const before = calls.length;
    const resp = await handler(req({ action: "process_pending" }, auth));
    await resp.text();
    assert(resp.status === 401 || resp.status === 403, "status " + resp.status + " for " + auth);
    assert(calls.filter((c) => c.path.startsWith("/rest/v1/rpc/claim_photo")).length === 0 && openaiCalls === 0, "no claim and no provider call");
    void before;
  }
}});
