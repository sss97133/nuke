import {
  type AttributionAudit, type ExactSourceLineage, type LineageImage,
  lineageReadingAfterWithdrawals, resolveImageAttributionLineage, stableLineageAnchor,
} from "./sourceLineage.ts";

const id = (n: number) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
const owner = id(100), vehicle = id(101), stamp = "2026-10-18T10:00:00.123456Z";
function assert(value: unknown, label = "assertion failed"): asserts value { if (!value) throw new Error(label); }
function image(n: number, extra: Partial<LineageImage> = {}): LineageImage {
  return { id: id(n), user_id: owner, vehicle_id: vehicle, file_hash: "a".repeat(64),
    image_url: "https://example.invalid/object/photo.heic", storage_path: "users/source/photo.heic",
    created_at: "2026-10-16T08:00:00.000001Z", taken_at: "2026-10-15T08:00:00.000001Z",
    exif_data: { uuid: "synthetic-asset", camera_make: "Example", camera_model: "Synthetic camera" },
    is_superseded: false, superseded_by: null, superseded_at: null, is_sensitive: false,
    is_document: false, is_duplicate: false, duplicate_of: null, vision_gate_status: "approved", ...extra };
}
function family(count = 2): { images: LineageImage[]; audits: AttributionAudit[] } {
  const images = Array.from({ length: count }, (_, i) => image(i + 1, i ? {
    vehicle_id: null, is_duplicate: true, duplicate_of: id(i),
  } : {}));
  const audits = images.slice(0, -1).map((row, i): AttributionAudit => {
    row.is_superseded = true; row.superseded_by = images[i + 1].id; row.superseded_at = stamp;
    return { id: id(200 + i), observation_type: "image", old_observation_id: row.id,
      new_observation_id: images[i + 1].id, old_vehicle_id: row.vehicle_id, new_vehicle_id: null, created_at: stamp };
  });
  return { images, audits };
}
const resolve = (f = family(), receipt = id(1), complete = true) => resolveImageAttributionLineage({
  ...f, receiptImageId: receipt, ownerId: owner, complete,
});
function accepted(f = family(), receipt = id(1)): ExactSourceLineage {
  const result = resolve(f, receipt);
  assert(result.status === "eligible_for_byte_verification", JSON.stringify(result));
  return result.lineage;
}

Deno.test("audited exact clone keeps immutable receipt and resolves attribution leaf as one source photo", () => {
  const lineage = accepted();
  assert(lineage.receipt_image_id === id(1) && lineage.root_image_id === id(1) && lineage.current_image_id === id(2));
  assert(lineage.source_photo_count === 1 && lineage.requires_live_byte_verification === true);
  assert(lineage.current_vehicle_attribution_proven === false);
});
Deno.test("requesting current leaf or a middle alias finds the same original source", () => {
  const f = family(3);
  assert(accepted(f, id(3)).root_image_id === id(1));
  assert(accepted(f, id(2)).current_image_id === id(3));
});
Deno.test("a pending clone does not inherit its ancestor's approval", () => {
  for (const gate of ["pending", "review_needed", null]) {
    const f = family(); f.images[1].vision_gate_status = gate;
    const result = resolve(f);
    assert(result.status === "held" && result.reason === "source_gate_not_approved");
  }
});
Deno.test("a later approved clone does not waive any historical or current rejected gate", () => {
  for (const gate of ["rejected_misattributed", "rejected", "rejected_sensitive", "rejected_junk"]) {
    for (const index of [0, 1]) {
      const f = family(); f.images[index].vision_gate_status = gate;
      const result = resolve(f);
      assert(result.status === "held" && result.reason === "source_rejected");
    }
  }
});
Deno.test("personal or sensitive withdrawal on ANY alias still blocks a cleared leaf", () => {
  for (const index of [0, 1]) for (const field of ["is_sensitive", "vision_gate_status"]) {
    const f = family();
    if (field === "is_sensitive") f.images[index].is_sensitive = true;
    else f.images[index].vision_gate_status = "rejected_personal";
    const result = resolve(f);
    assert(result.status === "held" && result.reason === "privacy_withdrawn");
  }
});
Deno.test("document and unrelated duplicate remain excluded through attribution", () => {
  const f = family(); f.images[0].is_document = true;
  let result = resolve(f); assert(result.status === "held" && result.reason === "document");
  f.images[0].is_document = false; f.images[1].duplicate_of = id(99);
  result = resolve(f); assert(result.status === "held" && result.reason === "unrelated_duplicate");
  f.images[1].duplicate_of = id(1); f.images[0].is_duplicate = true;
  result = resolve(f); assert(result.status === "held" && result.reason === "unrelated_duplicate");
});
Deno.test("truncated lookup cannot assert that no other lineage or anchor exists", () => {
  const r = resolve(family(), id(1), false);
  assert(r.status === "refused" && r.reason === "incomplete_lookup");
  assert(stableLineageAnchor([accepted()], id(2), [], false).status === "held");
});
Deno.test("supersession without a matching audit or missing source is refused", () => {
  const f = family(); f.audits = [];
  let r = resolve(f); assert(r.status === "refused" && r.reason === "missing_audit");
  const g = family(); g.images.pop();
  r = resolve(g); assert(r.status === "refused" && r.reason === "missing_source");
});
Deno.test("hash, owner, exact URL/path, camera, ingest and capture clock drift refuse lineage", () => {
  const changes: Partial<LineageImage>[] = [
    { file_hash: "b".repeat(64) }, { user_id: id(999) },
    { image_url: "https://example.invalid/different.heic" }, { storage_path: "different.heic" },
    { created_at: "2026-10-16T08:00:00.000002Z" }, { taken_at: "2026-10-15T08:00:00.000002Z" },
    { exif_data: { uuid: "another asset", camera_make: "Example", camera_model: "Synthetic camera" } },
  ];
  for (const change of changes) {
    const f = family(); Object.assign(f.images[1], change);
    assert(resolve(f).status === "refused", JSON.stringify(change));
  }
});
Deno.test("equivalent UTC encodings preserve microsecond identity", () => {
  const f = family(); f.images[1].taken_at = "2026-10-15T01:00:00.000001-07:00";
  f.images[1].created_at = "2026-10-16 08:00:00.000001+00";
  assert(accepted(f).current_image_id === id(2));
});
Deno.test("legacy URL-only or missing camera/source witnesses stay outside this contract", () => {
  for (const change of [{ file_hash: "legacy-url-hash" }, { storage_path: null }, { exif_data: {} }, { taken_at: null }]) {
    const f = family(); Object.assign(f.images[0], change);
    const r = resolve(f); assert(r.status === "refused" && r.reason === "invalid_source_witness");
  }
});
Deno.test("outgoing forks and incoming coalescence are refused rather than guessed", () => {
  const f = family(); f.images.push(image(3));
  f.audits.push({ ...f.audits[0], id: id(201), new_observation_id: id(3) });
  let r = resolve(f); assert(r.status === "refused" && r.reason === "lineage_fork");
  const g = family(); g.images.push(image(3));
  g.audits.push({ ...g.audits[0], id: id(201), old_observation_id: id(3) });
  r = resolve(g, id(2)); assert(r.status === "refused" && r.reason === "lineage_fork");
});
Deno.test("cycles and depth beyond eight edges refuse", () => {
  const f = family(); f.images[1].is_superseded = true; f.images[1].superseded_by = id(1);
  f.images[1].superseded_at = stamp;
  f.audits.push({ ...f.audits[0], id: id(201), old_observation_id: id(2), new_observation_id: id(1) });
  let r = resolve(f); assert(r.status === "refused" && r.reason === "lineage_cycle");
  r = resolve(family(10)); assert(r.status === "refused" && r.reason === "lineage_too_deep");
});
Deno.test("malformed or repeated audit IDs cannot disguise a different edge", () => {
  const f = family(3); f.audits[1].id = f.audits[0].id;
  let r = resolve(f); assert(r.status === "refused" && r.reason === "audit_identity_drift");
  f.audits[1].id = "not-an-audit-id";
  r = resolve(f); assert(r.status === "refused" && r.reason === "audit_identity_drift");
});
Deno.test("a claimed-complete oversized family still refuses its bounded lookup", () => {
  const f = family(); f.audits = Array.from({ length: 65 }, (_, i) => ({ ...f.audits[0], id: id(300 + i) }));
  const r = resolve(f); assert(r.status === "refused" && r.reason === "incomplete_lookup");
});
Deno.test("pointer, old attachment, or audit timestamp mismatch refuses", () => {
  for (const change of [{ superseded_by: id(9) }, { is_superseded: false },
    { vehicle_id: id(777) }, { superseded_at: "2026-10-18T10:00:00.123455Z" }]) {
    const f = family(); Object.assign(f.images[0], change);
    assert(resolve(f).status === "refused");
  }
  const f = family(3); f.audits[1].created_at = "2026-10-17T00:00:00Z";
  f.images[1].superseded_at = f.audits[1].created_at;
  const r = resolve(f); assert(r.status === "refused" && r.reason === "audit_clock_drift");
});
Deno.test("first attribution self-audit is not an identity edge or reason to rename anchor", () => {
  const f = family(); f.images[1].vehicle_id = id(103);
  f.audits.push({ ...f.audits[0], id: id(201), old_observation_id: id(2), new_observation_id: id(2),
    old_vehicle_id: null, new_vehicle_id: id(103) });
  assert(accepted(f).root_image_id === id(1));
});
Deno.test("subject withdrawal on a historical alias blocks old/equal reading clocks across clone", () => {
  const lineage = accepted(family(), id(2));
  const withdrawals = [{ source_image_id: id(1), observed_at: stamp }];
  assert(!lineageReadingAfterWithdrawals(lineage, "2026-10-18T09:59:00Z", withdrawals, true));
  assert(!lineageReadingAfterWithdrawals(lineage, stamp, withdrawals, true));
  assert(lineageReadingAfterWithdrawals(lineage, "2026-10-18T10:00:00.123457Z", withdrawals, true));
  assert(!lineageReadingAfterWithdrawals(lineage, "2026-10-19T00:00:00Z", [], false));
});
Deno.test("bad withdrawal clocks fail closed and unrelated negative edges do not remove this subject", () => {
  const lineage = accepted();
  assert(!lineageReadingAfterWithdrawals(lineage, stamp, [{ source_image_id: id(2), observed_at: "invalid" }], true));
  assert(lineageReadingAfterWithdrawals(lineage, stamp, [{ source_image_id: id(99), observed_at: stamp }], true));
});
Deno.test("existing original or middle anchor survives every attribution alias", () => {
  const lineage = accepted(family(3), id(3));
  for (const anchor of [id(1), id(2)]) {
    const r = stableLineageAnchor([lineage], id(3), [{ cluster_id: id(400), anchor_image_id: anchor }], true);
    assert(r.status === "supported" && r.anchor_image_id === anchor && r.cluster_id === id(400));
  }
});
Deno.test("no prior cluster chooses original witness and competing clusters require explicit interpretation", () => {
  const lineage = accepted();
  const r = stableLineageAnchor([lineage], id(2), [], true);
  assert(r.status === "supported" && r.anchor_image_id === id(1) && r.cluster_id === null);
  assert(stableLineageAnchor([lineage], id(2), [
    { cluster_id: id(400), anchor_image_id: id(1) }, { cluster_id: id(401), anchor_image_id: id(2) },
  ], true).status === "held");
});
