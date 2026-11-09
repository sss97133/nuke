import { recordReviewedAnalysis, validateReviewedAnalysis, REVIEW_METHOD, type ReviewedAnalysisDeps } from "./reviewedAnalysis.ts";

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
