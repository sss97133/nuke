import { assertComparisonReceiptCapacity, comparisonReceiptPatch, parseReferenceDecision,
  referenceDecisionProjection } from "./decision.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const candidates = [
  { label: "A", vehicle_id: "mustang", has_reference: true },
  { label: "B", vehicle_id: "porsche", has_reference: true },
  { label: "C", vehicle_id: "corvette", has_reference: true },
];
const support = { candidate_label: "B", relation: "supports", query_feature: "rear-quarter crease beside rivet",
  reference_feature: "same rear-quarter crease beside rivet" };
const match = { outcome: "reference_match", assigned_label: "B", confidence: 0.97,
  image_type: "exterior", image_medium: "photograph", comparisons: [support], reason: "Visible correspondence" };

Deno.test("a comparison stays a candidate; it cannot admit a physical vehicle or ownership", () => {
  const decision = parseReferenceDecision(match, candidates);
  equal(decision.outcome, "reference_match");
  equal(decision.candidate_vehicle_id, "porsche");
  equal(decision.identity_admitted, false);
  equal(decision.refusal, "reference_membership_unverified");
  equal(referenceDecisionProjection(decision).status, "ambiguous");
});

Deno.test("unknown or missing labels never fall back to the current Mustang", () => {
  for (const assigned_label of [undefined, null, "", "none", "unknown", "Z"]) {
    const decision = parseReferenceDecision({ ...match, assigned_label }, candidates);
    equal(decision.outcome, "unknown");
    equal(decision.candidate_vehicle_id, null);
  }
});

Deno.test("missing, malformed or weak confidence never confirms the first reference", () => {
  for (const confidence of [undefined, null, "0.99", NaN, Infinity, -1, 1.01, 0.79]) {
    const decision = parseReferenceDecision({ ...match, assigned_label: "A", confidence }, candidates);
    equal(decision.outcome, "unknown");
    equal(decision.candidate_vehicle_id, null);
    equal(referenceDecisionProjection(decision).suggested_vehicle_id, null);
  }
});

Deno.test("a high-confidence model label alone or absent reference is not identity evidence", () => {
  equal(parseReferenceDecision({ ...match, comparisons: [] }, candidates).outcome, "unknown");
  equal(parseReferenceDecision(match, candidates.map(c => ({ ...c, has_reference: false }))).outcome, "unknown");
});

Deno.test("same-model competing truck features retain contradiction rather than forcing a choice", () => {
  const contradiction = { ...support, relation: "contradicts", query_feature: "round mounting hole",
    reference_feature: "square mounting hole" };
  const decision = parseReferenceDecision({ ...match, comparisons: [support, contradiction] }, candidates);
  equal(decision.outcome, "unknown");
  equal(decision.candidate_vehicle_id, null);
  equal(decision.comparisons.length, 2);
});

Deno.test("a novel-looking subject is unmatched only to supplied references, never globally new", () => {
  const comparisons = candidates.map(c => ({ ...support, candidate_label: c.label, relation: "contradicts" }));
  const decision = parseReferenceDecision({ ...match, outcome: "unmatched_references", assigned_label: null,
    comparisons }, candidates);
  equal(decision.outcome, "unmatched_references");
  equal(decision.candidate_vehicle_id, null);
  equal(decision.identity_admitted, false);
  equal(referenceDecisionProjection(decision).status, "ambiguous");
  equal(parseReferenceDecision({ ...match, outcome: "unmatched_references", comparisons: comparisons.slice(1) }, candidates).outcome, "unknown");
  equal(parseReferenceDecision({ ...match, outcome: "unmatched_references", comparisons: [...comparisons, support] }, candidates).outcome, "unknown");
  equal(parseReferenceDecision({ ...match, outcome: "unmatched_references", comparisons }, []).outcome, "unknown");
});

Deno.test("generic parts and unreadable details remain unknown without visible correspondence", () => {
  const decision = parseReferenceDecision({ ...match, outcome: "unknown", assigned_label: "A", image_type: "detail",
    comparisons: [] }, candidates);
  equal(decision.outcome, "unknown");
  equal(decision.candidate_vehicle_id, null);
});

Deno.test("documents and unrelated photos cannot acquire a vehicle from their current label", () => {
  equal(parseReferenceDecision({ ...match, image_type: "documentation" }, candidates).outcome, "unknown");
  const unrelated = parseReferenceDecision({ ...match, outcome: "unrelated", image_type: "unrelated" }, candidates);
  equal(unrelated.outcome, "unrelated");
  equal(unrelated.candidate_vehicle_id, null);
});

Deno.test("renders, drawings, screenshots and unknown media cannot identify a photographed physical subject", () => {
  for (const image_medium of [undefined, null, "render", "drawing", "screenshot"]) {
    const decision = parseReferenceDecision({ ...match, image_medium }, candidates);
    equal(decision.outcome, "unknown");
    equal(decision.candidate_vehicle_id, null);
  }
});

Deno.test("mixed-car images each retain their own result without day or session inheritance", () => {
  const decisions = candidates.map(c => parseReferenceDecision({ ...match, assigned_label: c.label,
    comparisons: [{ ...support, candidate_label: c.label }] }, candidates));
  equal(decisions.map(d => d.candidate_vehicle_id), ["mustang", "porsche", "corvette"]);
  equal(decisions.every(d => referenceDecisionProjection(d).status === "ambiguous"), true);
  equal(parseReferenceDecision({ outcome: "unknown", confidence: 0.99, image_type: "engine" }, candidates).candidate_vehicle_id, null);
});

Deno.test("comparison persistence preserves rejected eligibility and independent serial suggestions", () => {
  const decision = parseReferenceDecision(match, candidates);
  for (const image_vehicle_match_status of ["mismatch", "unrelated", "confirmed", null]) {
    const row = {
      image_vehicle_match_status, vision_gate_status: "rejected_misattributed", vehicle_id: "existing-vehicle",
      auto_suggested_vehicle_id: "serial-match", suggested_vehicle_id: "another-writer-candidate",
      auto_suggestion_confidence: 0.99, auto_suggestion_reasons: ["vin_ocr_match", "edit_distance=0"],
      ai_scan_metadata: { classification: { classifier_ok: true, model: "existing-model" },
        photo_pipeline: { receipt: { attempt_id: "earlier-attempt" } },
        image_vehicle_identity: { legacy_marker: "keep", readings: [{ method: "earlier-comparison" }] } },
    };
    const original = JSON.parse(JSON.stringify(row));
    const patch = comparisonReceiptPatch(row.ai_scan_metadata, { method: "comparison", decision });
    equal(Object.keys(patch), ["ai_scan_metadata"]);
    const updated = { ...row, ...patch };
    for (const key of ["image_vehicle_match_status", "vision_gate_status", "vehicle_id", "auto_suggested_vehicle_id",
      "suggested_vehicle_id", "auto_suggestion_confidence", "auto_suggestion_reasons"] as const) {
      equal(updated[key], row[key]);
    }
    equal(updated.ai_scan_metadata.classification, row.ai_scan_metadata.classification);
    equal(updated.ai_scan_metadata.photo_pipeline, row.ai_scan_metadata.photo_pipeline);
    equal(updated.ai_scan_metadata.image_vehicle_identity.legacy_marker, "keep");
    equal(updated.ai_scan_metadata.image_vehicle_identity.readings, [
      { method: "earlier-comparison" }, { method: "comparison", decision }]);
    equal(row, original);
  }
});

Deno.test("malformed comparison metadata and histories refuse append rather than inventing empty history", () => {
  for (const metadata of ["bad", [], 7, false, { image_vehicle_identity: null },
    { image_vehicle_identity: [] }, { image_vehicle_identity: {} },
    { image_vehicle_identity: { readings: null } }, { image_vehicle_identity: { readings: "bad" } },
    { image_vehicle_identity: { readings: [null] } }, { image_vehicle_identity: { readings: ["bad"] } }]) {
    const before = JSON.stringify(metadata);
    for (const attempt of [() => assertComparisonReceiptCapacity(metadata),
      () => comparisonReceiptPatch(metadata, { method: "comparison" })]) {
      let refused = false;
      try { attempt(); } catch { refused = true; }
      equal(refused, true);
    }
    equal(JSON.stringify(metadata), before);
  }
});

Deno.test("first comparison initializes an absent namespace and a full history refuses without dropping readings", () => {
  for (const metadata of [null, undefined, {}, { classification: { classifier_ok: true } }]) {
    assertComparisonReceiptCapacity(metadata);
    const patch = comparisonReceiptPatch(metadata, { method: "comparison" });
    equal(patch.ai_scan_metadata.image_vehicle_identity.readings, [{ method: "comparison" }]);
  }
  const metadata = { image_vehicle_identity: { readings: Array.from({ length: 32 }, (_, i) => ({ i })) } };
  let refused = false;
  try { comparisonReceiptPatch(metadata, { method: "comparison" }); } catch { refused = true; }
  equal(refused, true);
  equal(metadata.image_vehicle_identity.readings.length, 32);
});
