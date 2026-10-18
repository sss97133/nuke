import { assessSubjectAdmission } from "./subjectReplay.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(9000), cluster = id(8000), read_at = "2025-02-01T00:00:00Z";
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function equal(a: unknown, b: unknown) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function fixture() {
  const sources = [1, 2, 3].map(n => ({ id: id(n), user_id: owner, image_url: `https://source.invalid/${n}.jpg`,
    file_hash: n.toString(16).padStart(64, "0"), created_at: "2025-01-01T00:00:00.000001Z", taken_at: null,
    vision_gate_status: "approved", private_subject_privacy_complete: true, private_subject_privacy: [], is_superseded: false, is_duplicate: false, is_document: false, is_sensitive: false }));
  const envelope: any = { user_id: owner, method: "visual_subjects_v1", read_at,
    inputs: sources.map(s => ({ image_id: s.id, source_url: s.image_url, source_sha256: s.file_hash, input_sha256: s.file_hash,
      representation: "source", source_qualified: true, created_at: s.created_at, taken_at: null })),
    subjects: [{ anchor_image_id: id(1), member_image_ids: sources.map(s => s.id), existing_cluster_id: null }] };
  const head = (n: number, active = true): any => ({ id: id(100 + n), image_id: id(n), cluster_id: cluster,
    observed_by: "visual_subjects_v1", is_active: active, superseded_by: null,
    confidence_basis: { visual_subjects_v1: { state: active ? "active" : "withdrawn", anchor_image_id: id(1), envelope } } });
  return { sources, envelope, head, state: { sources, readings: [] as any[], readings_complete: true } };
}

Deno.test("a surviving paid reading never authorizes restoration of a terminal withdrawal", () => {
  const f = fixture();
  f.state.readings = [f.head(1), f.head(2, false), { ...f.head(2), observed_by: "visual_subject_reading_v1" }];
  const before = clone(f.state);
  const r = assessSubjectAdmission(f.envelope, owner, f.state);
  equal(r.data_reusable, true); equal(r.admission_allowed, false); equal(r.blocked_image_ids, [id(2)]);
  equal(r.reason, "current_membership_conflict"); equal(f.state, before);
});

Deno.test("automatic admission also blocks a newly inferred graph containing a withdrawn member", () => {
  const f = fixture(); f.state.readings = [f.head(1, false)];
  equal(assessSubjectAdmission({ ...f.envelope, read_at: "2025-03-01T00:00:00Z" }, owner, f.state).admission_allowed, false);
});

Deno.test("a partial first admission can retry while its supported profile is not yet complete", () => {
  const f = fixture(); f.state.readings = [f.head(1)];
  equal(assessSubjectAdmission(f.envelope, owner, f.state).admission_allowed, true);
});

Deno.test("raw producer inactivity is not a subject withdrawal and superseded heads are not current", () => {
  const f = fixture(); f.state.readings = [{ ...f.head(2, false), observed_by: "visual_subject_reading_v1" },
    { ...f.head(1, false), superseded_by: id(999) }];
  equal(assessSubjectAdmission(f.envelope, owner, f.state).admission_allowed, true);
});

Deno.test("current conflicting cluster anchor and malformed current testimony fail closed", () => {
  for (const change of ["other_anchor", "bad_envelope"]) {
    const f = fixture(), head = f.head(2);
    if (change === "other_anchor") head.confidence_basis.visual_subjects_v1.anchor_image_id = id(7);
    else head.confidence_basis.visual_subjects_v1.envelope = null;
    f.state.readings = [head];
    equal(assessSubjectAdmission(f.envelope, owner, f.state).blocked_image_ids, [id(2)]);
  }
});

Deno.test("cached third-anchor bytes alone cannot preserve a profile after support withdrawal", () => {
  const f = fixture(); f.envelope.subjects[0].existing_cluster_id = cluster;
  const r = assessSubjectAdmission(f.envelope, owner, f.state);
  equal(r.data_reusable, true); equal(r.admission_allowed, false); equal(r.reason, "existing_subject_support_unavailable");
  const profiles: any[] = [{ id: cluster, anchor_image_id: id(1), image_count: 2, images: [{ id: id(1) }, { id: id(4) }] }];
  equal(assessSubjectAdmission(f.envelope, owner, { ...f.state, profiles }).admission_allowed, true);
  profiles[0].images.shift();
  equal(assessSubjectAdmission(f.envelope, owner, { ...f.state, profiles }).admission_allowed, false);
});

Deno.test("live source custody and exact microsecond clocks are rechecked without paid work", () => {
  for (const change of [{ file_hash: "f".repeat(64) }, { is_sensitive: true }, { user_id: id(9999) },
    { created_at: "2025-01-01T00:00:00.000002Z" }, { image_url: "https://source.invalid/replaced.jpg" }]) {
    const f = fixture(); Object.assign(f.sources[1], change);
    const r = assessSubjectAdmission(f.envelope, owner, f.state);
    equal(r.data_reusable, false); equal(r.admission_allowed, false); equal(r.blocked_image_ids, [id(2)]);
  }
});

Deno.test("an incomplete current-head scope cannot imply absence of withdrawals", () => {
  const f = fixture(); f.state.readings_complete = false;
  const r = assessSubjectAdmission(f.envelope, owner, f.state);
  equal(r.data_reusable, true); equal(r.admission_allowed, false); equal(r.reason, "current_membership_unassessed");
  equal(r.blocked_image_ids, [id(1), id(2), id(3)]);
  equal(assessSubjectAdmission(f.envelope, id(9999), f.state).data_reusable, false);
});
