import { intakeRefusalWord, projectionFailure, projectionRefusalWord, recordReviewedAnalysis, validateReviewedAnalysis, REVIEW_METHOD, type ReviewedAnalysisDeps } from "./reviewedAnalysis.ts";

function assert(v: unknown, message = "assertion failed"): asserts v { if (!v) throw new Error(message); }
const imageId = "10000000-0000-4000-8000-000000000001";
const vehicleId = "20000000-0000-4000-8000-000000000001";
const observationId = "30000000-0000-4000-8000-000000000001";
const updated = "2026-11-01T12:00:00.123456+00:00";
function packet(): any {
  return {
    action: "record_reviewed_analysis",
    verdict: {
      image_id: imageId, vehicle_id: vehicleId, scene_type: "body_exterior", build_phase_guess: "final_assembly",
      intent: "unknown", intent_confidence: 0, needs_clarification: true,
      components_seen: [{ label: "Front wheel", confidence: 0.8, bbox: [100, 400, 300, 800], part_number_guess: null }],
      state_observations: { rust_severity: "unknown", paint_state: "unknown", completeness: "assembled" },
      workshop_signals: { tools_visible: [], fixturing: "unknown", lighting: "natural_outdoor" },
      presence: { person: false }, camera_pose: { method: "visual estimate", framing: "full vehicle", azimuth_deg: 45, distance_est: null },
      narrative_one_line: "A complete red car occupies the frame.", confidence: 0.9,
      text_regions: [{ text: "Visible badge", bbox: [400, 100, 450, 130] }],
    },
    source: { image_url: "https://example.test/source.jpg", expected_updated_at: updated,
      reviewed_url: "https://example.test/rendition.jpg", reviewed_sha256: "a".repeat(64), reviewed_at: "2026-11-09T19:00:00.000Z" },
    provenance: { agent_model: "fixture-model", agent_tier: "interactive", extraction_method: "interactive visual review", run_id: "fixture-review" },
  };
}
function fixture() {
  const row: any = { id: imageId, vehicle_id: vehicleId, image_url: packet().source.image_url, updated_at: updated,
    vision_gate_status: "approved", ai_scan_metadata: { classification: { existing: true } } };
  const effects: string[] = [];
  let received: any;
  const deps: ReviewedAnalysisDeps = {
    async authorize() { return true; },
    async readImage() { effects.push("read"); return row; },
    async ingest(body) { effects.push("ingest"); received = body; return { success: true, observation_id: observationId }; },
    async project(id) { effects.push("project"); return { success: true, observation_id: id, image_id: imageId, vehicle_id: vehicleId,
      image_observation_id: "50000000-0000-4000-8000-000000000001", cover: { chosen_image_id: imageId } }; },
    now: () => Date.parse("2026-11-09T20:00:00Z"),
  };
  return { row, deps, effects, get received() { return received; } };
}
async function refuses(f: () => Promise<unknown> | unknown, code: string) {
  try { await f(); } catch (e) { assert((e as Error).message === code, `expected ${code}, got ${(e as Error).message}`); return; }
  throw new Error(`did not refuse ${code}`);
}

Deno.test("reviewed result preserves provided unknowns and defers all observation inference", async () => {
  const f = fixture(); const out = await recordReviewedAnalysis(packet(), f.deps);
  assert(f.effects.join(",") === "read,ingest,project");
  assert(out.model_calls === 0 && out.cover.chosen_image_id === imageId);
  assert(f.received.defer_analysis === true && f.received.agent_inferred === true);
  assert(f.received.source_slug === "photo_pipeline" && f.received.kind === "condition");
  assert(f.received.extraction_method === REVIEW_METHOD && f.received.agent_model === "fixture-model");
  assert(f.received.structured_data.camera_pose.distance_est === null);
  assert(f.received.structured_data.intent === "unknown" && f.received.structured_data.needs_clarification === true);
  assert(!("agent_cost_cents" in f.received) && !("agent_duration_ms" in f.received));
  assert(!("vehicle_hints" in f.received) && !("property_key" in f.received));
});
Deno.test("ordinary authenticated caller cannot enter reviewed persistence", async () => {
  const f = fixture(); f.deps.authorize = async () => false;
  await refuses(() => recordReviewedAnalysis(packet(), f.deps), "review_requires_service_role");
  assert(f.effects.length === 0);
});
for (const [name, value] of [["is_sensitive", true], ["is_superseded", true], ["is_duplicate", true], ["is_document", true], ["doc_flag", true],
  ["vision_gate_status", "review_needed"], ["vision_gate_status", "rejected_personal"], ["image_vehicle_match_status", "mismatch"]]) {
  Deno.test(`withdrawn source ${name}=${value} is refused before intake`, async () => {
    const f = fixture(); f.row[String(name)] = value;
    await refuses(() => recordReviewedAnalysis(packet(), f.deps), "review_source_withdrawn");
    assert(f.effects.join() === "read");
  });
}
for (const [name, value] of [["vehicle_id", null], ["vehicle_id", "other"], ["image_url", "https://example.test/replaced.jpg"], ["updated_at", "2026-11-01T12:00:00.123457Z"]]) {
  Deno.test(`source CAS rejects ${name} change including submillisecond drift`, async () => {
    const f = fixture(); f.row[String(name)] = value;
    await refuses(() => recordReviewedAnalysis(packet(), f.deps), "review_source_changed");
    assert(f.effects.join() === "read");
  });
}
Deno.test("equivalent UTC timestamp spelling retains microsecond precision", async () => {
  const f = fixture(); f.row.updated_at = "2026-11-01 12:00:00.123456+00:00";
  await recordReviewedAnalysis(packet(), f.deps); assert(f.effects.includes("project"));
});
Deno.test("projection failure after intake is surfaced, with no retry through the normal pipeline", async () => {
  const f = fixture(); f.deps.project = async () => { f.effects.push("project"); return { success: false }; };
  await refuses(() => recordReviewedAnalysis(packet(), f.deps), "review_projection_not_persisted");
  assert(f.effects.join() === "read,ingest,project");
});
Deno.test("wrong observation/subject response cannot claim success", async () => {
  const f = fixture(); f.deps.project = async () => ({ success: true, observation_id: observationId, image_id: imageId, vehicle_id: "other" });
  await refuses(() => recordReviewedAnalysis(packet(), f.deps), "review_projection_not_persisted");
});
Deno.test("a cache-only projector cannot report completed reviewed analysis", async () => {
  const f = fixture(); f.deps.project = async () => ({ success: true, observation_id: observationId, image_id: imageId, vehicle_id: vehicleId });
  await refuses(() => recordReviewedAnalysis(packet(), f.deps), "review_projection_not_persisted");
});
// An automatic reading is its observation alone: the projection (migration 20261120140000) answers thin_tier with a null
// placement. This is the answer supabase/sql/test_thin_real_row.sql pins on a real Postgres.
const thinAnswer = (): any => ({ success: true, observation_id: observationId, image_id: imageId, vehicle_id: vehicleId,
  projection_duplicate: null, image_observation_id: null, search_vehicle_id: null,
  cover: { vehicle_id: vehicleId, changed: false, reason: "thin_tier_reading" }, thin_tier: true, superseded_readings: 1, model_calls: 0 });
// What ties an answer to this landing, whatever its tier: this vehicle, this observation, and success that is the boolean true.
const notThisLanding: Array<[string, (a: any) => void]> = [
  ["another vehicle", (a: any) => { a.vehicle_id = "20000000-0000-4000-8000-000000000002"; }],
  ["another observation", (a: any) => { a.observation_id = "30000000-0000-4000-8000-000000000002"; }],
  ["success that is not true", (a: any) => { a.success = false; }],
  ["success that is not the boolean true", (a: any) => { a.success = "true"; }],
];
Deno.test("an automatic reading lands without a placement when the projection says thin_tier", async () => {
  const f = fixture(); f.deps.project = async () => { f.effects.push("project"); return thinAnswer(); };
  const out = await recordReviewedAnalysis(packet(), f.deps);
  assert(f.effects.join(",") === "read,ingest,project");
  assert(out.thin_tier === true && out.image_observation_id === null && out.superseded_readings === 1 && out.model_calls === 0);
});
for (const [name, change] of [
  ["a placement that is not an id", (a: any) => { a.image_observation_id = "placed"; }],
  ["no placement key", (a: any) => { delete a.image_observation_id; }],
  ["thin_tier that is not the boolean true", (a: any) => { a.thin_tier = "true"; }],
  ["no thin_tier", (a: any) => { delete a.thin_tier; }],
  ["another photo", (a: any) => { a.image_id = "10000000-0000-4000-8000-000000000002"; }],
  ...notThisLanding,
] as Array<[string, (a: any) => void]>) {
  Deno.test(`a thin answer with ${name} cannot claim success`, async () => {
    const f = fixture(); f.deps.project = async () => { const a = thinAnswer(); change(a); return a; };
    await refuses(() => recordReviewedAnalysis(packet(), f.deps), "review_projection_not_persisted");
  });
}
// The same three on a placed answer, which is whole in every other respect: each must be refused for that field alone.
for (const [name, change] of [["another photo", (a: any) => { a.image_id = "10000000-0000-4000-8000-000000000002"; }], ...notThisLanding] as Array<[string, (a: any) => void]>) {
  Deno.test(`a placed answer with ${name} cannot claim success`, async () => {
    const f = fixture(); const placed = f.deps.project;
    f.deps.project = async (id) => { const a: any = await placed(id); change(a); return a; };
    await refuses(() => recordReviewedAnalysis(packet(), f.deps), "review_projection_not_persisted");
    assert(f.effects.join(",") === "read,ingest,project");
  });
}
Deno.test("a failed projection is named: its own word, a database fault as unavailable, anything else refused", () => {
  const named = (error: unknown, status?: unknown) => { const f = projectionFailure(error, status); return `${f.word} ${f.http}`; };
  // one of the projection's words wins, whatever the status
  assert(named({ code: "23514", message: "review_source_changed" }, 400) === "review_source_changed 409");
  assert(named({ code: "23514", message: "thin_review_over_reviewed" }, 500) === "thin_review_over_reviewed 409");
  // the database could not answer: a 5xx, no HTTP answer at all, or a lock timeout, statement timeout or deadlock by code
  assert(named({ code: "55P03", message: "canceling statement due to lock timeout" }, 500) === "review_source_unavailable 503");
  assert(named({ code: "XX000", message: "internal error" }, 502) === "review_source_unavailable 503");
  assert(named({ code: "", message: "TypeError: fetch failed" }, 0) === "review_source_unavailable 503");
  for (const code of ["55P03", "57014", "40P01"]) assert(named({ code, message: "x" }) === "review_source_unavailable 503", code);
  // a rule the caller has no word for stays a refusal: a 4xx, a raised check with other text, no status and no known code
  assert(named({ code: "23514", message: "some other check" }, 400) === "review_projection_refused 409");
  assert(named({ code: "42501", message: "review_requires_service_role" }, 403) === "review_projection_refused 409");
  assert(named({ code: "PGRST202", message: "Could not find the function" }, 404) === "review_projection_refused 409");
  assert(named({ message: "x" }) === "review_projection_refused 409" && named(null) === "review_projection_refused 409" && named("55P03", "500") === "review_projection_refused 409");
});
Deno.test("the projection's own refusal words are passed on by name, and nothing else is", () => {
  for (const word of ["thin_review_over_reviewed", "review_observation_not_eligible", "review_source_changed", "review_source_withdrawn",
    "review_source_previously_withdrawn", "review_source_changed_during_projection", "review_search_projection_not_persisted"]) {
    assert(projectionRefusalWord({ code: "23514", message: word }) === word, word);
  }
  for (const other of [{ message: "review_requires_service_role" }, { message: "canceling statement due to statement timeout" },
    { message: "thin_review_over_reviewed " }, { message: "x thin_review_over_reviewed" }, { details: "thin_review_over_reviewed" },
    { message: 5 }, null, undefined, "thin_review_over_reviewed", ["thin_review_over_reviewed"]]) {
    assert(projectionRefusalWord(other) === null, JSON.stringify(other));
  }
});
Deno.test("stable material review identity survives own CAS token change only", async () => {
  const f = fixture(); await recordReviewedAnalysis(packet(), f.deps); const identifier = f.received.source_identifier;
  f.row.updated_at = "2026-11-09T20:00:00Z"; f.row.ai_scan_metadata.byok_deep_analysis = { source_identifier: identifier };
  await recordReviewedAnalysis(packet(), f.deps); assert(f.received.source_identifier === identifier);
  const changed = packet(); changed.verdict.state_observations.completeness = "partial";
  await refuses(() => recordReviewedAnalysis(changed, f.deps), "review_source_changed");
});
const bad: Array<[string, (p: any) => void, string]> = [
  ["missing full analysis", p => delete p.verdict.camera_pose, "invalid_review_verdict"],
  ["fabricated precision format", p => p.verdict.camera_pose.distance_est = "2-4m", "invalid_review_camera"],
  ["ambiguous pose shorthand", p => p.verdict.camera_pose.framing = "three-quarter", "invalid_review_verdict"],
  ["reversed box", p => p.verdict.components_seen[0].bbox = [500, 500, 100, 100], "invalid_review_regions"],
  ["confidence scale", p => p.verdict.confidence = 90, "invalid_review_verdict"],
  ["intent guess without flag", p => delete p.verdict.needs_clarification, "invalid_review_verdict"],
  ["hidden canonical field", p => p.verdict.engine_type = "SD-455", "invalid_review_identity"],
  ["normal pipeline option", p => p.classification_raw = {}, "invalid_review_envelope"],
  ["unknown source bytes", p => p.source.reviewed_sha256 = "unknown", "invalid_review_source"],
  ["future review", p => p.source.reviewed_at = "2030-01-01T00:00:00Z", "invalid_review_source"],
  ["missing actual model", p => delete p.provenance.agent_model, "invalid_review_provenance"],
  ["nested camera metadata", p => p.verdict.camera_pose.framing = { arbitrary: true }, "invalid_review_camera"],
  ["invented EXIF flag", p => p.verdict.camera_pose.exif_present = "yes", "invalid_review_camera"],
  ["nested presence hint", p => p.verdict.presence.place_hint = { arbitrary: true }, "invalid_review_presence"],
  ["nested provenance", p => p.provenance.cost_basis = { arbitrary: true }, "invalid_review_provenance"],
  ["nested notes", p => p.verdict.agent_notes = { arbitrary: true }, "invalid_review_notes"],
];
for (const [name, edit, code] of bad) Deno.test(`invalid supplied review: ${name}`, async () => {
  const p = packet(); edit(p); const f = fixture();
  await refuses(() => recordReviewedAnalysis(p, f.deps), code); assert(f.effects.length === 0);
});
Deno.test("validator does not mutate or invent measured fields", () => {
  const p = packet(), before = JSON.stringify(p); validateReviewedAnalysis(p, Date.parse("2026-11-09T20:00:00Z"));
  assert(JSON.stringify(p) === before);
});

Deno.test("the intake guard's two words for an automatic reading pass on by name; every other refusal stays opaque", () => {
  // ingest-observation answers a refused insert as { error, details: <the database's message> }
  assert(intakeRefusalWord({ error: "Failed to insert observation", details: "thin_review_over_reviewed" }) === "thin_review_over_reviewed");
  assert(intakeRefusalWord({ error: "Failed to insert observation", details: "thin_review_asserts_unchecked_field" }) === "thin_review_asserts_unchecked_field");
  for (const body of [null, undefined, "thin_review_over_reviewed", ["thin_review_over_reviewed"], {}, { details: 7 }, { details: "invalid_review_observation" },
    { details: "thin_review_over_reviewed and more" }, { details: "duplicate key value violates unique constraint" }, { error: "thin_review_over_reviewed" }]) {
    assert(intakeRefusalWord(body) === null, JSON.stringify(body));
  }
});
