import { projectDepictedSubjects, type SubjectInput } from "./subjects.ts";
function equal(a: unknown, b: unknown) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
const input = (id: string, extra: Partial<SubjectInput> = {}): SubjectInput => ({ image_id: id,
  source_sha256: id.repeat(64), input_sha256: id.repeat(64), source_qualified: true,
  representation: "source", taken_at: null, created_at: "2026-10-01T00:00:00Z", ...extra });
const frame = (id: string, extra = {}) => ({ image_id: id, medium: "photograph", view: "exterior",
  primary_subject: "vehicle", bbox: [0.1, 0.1, 0.8, 0.8], ...extra });
const edge = (a: string, b: string, kinds = ["body_geometry", "configuration"]) => ({ left_image_id: a, right_image_id: b,
  features: kinds.map(kind => ({ kind, left_witness: "Visible A pillar and rack mounting", right_witness: "Corresponding pillar and rack mounting" })) });
const raw = (ids = ["a", "b"], edges = [edge("a", "b")]) => ({ frames: ids.map(id => frame(id)), correspondences: edges,
  labels: [{ anchor_image_id: "a", make: "Example", model_family: "Coupe" }], contradictions: [] as unknown[] });

Deno.test("a VIN anchor and walk-around combine source capture context without fabricating visible correspondences", () => {
  const reading = { ...raw(["a", "b"], []), capture_sessions: [{ anchor_image_id: "b", member_image_ids: ["a", "b"],
    identifier: { kind: "chassis", text: "6R07T123456", legibility: "clear" },
    basis: "A single primer coupe walk-around ends at its attached identification plate.",
    asserted_identity: { make: "Ford", model_family: "Mustang" } }] };
  reading.frames[1].view = "detail";
  const sources = [input("a", { taken_at: "2026-10-01T12:00:00Z", capture_context: { device_fingerprint: "device", latitude: 35, longitude: -115 } }),
    input("b", { taken_at: "2026-10-01T12:02:00Z", capture_context: { device_fingerprint: "device", latitude: 35.0001, longitude: -115 } })];
  const result = projectDepictedSubjects(reading, sources);
  equal(result.subjects, []);
  equal(result.capture_sessions?.[0].identifier.text, "6R07T123456");
  equal(result.capture_sessions?.[0].member_image_ids, ["a", "b"]);
  for (const change of [
    { taken_at: "2026-10-01T13:00:00Z" },
    { capture_context: { device_fingerprint: "other", latitude: 35, longitude: -115 } },
    { capture_context: { device_fingerprint: "device", latitude: 36, longitude: -115 } },
    { capture_context: { device_fingerprint: "device", latitude: null, longitude: -115 } },
    { source_qualified: false },
  ]) equal(projectDepictedSubjects(reading, [sources[0], { ...sources[1], ...change }]).capture_sessions, undefined);
  reading.contradictions = [{ left_image_id: "a", right_image_id: "b", reason: "Different paint and body configuration" }];
  equal(projectDepictedSubjects(reading, sources).capture_sessions, undefined);
});

Deno.test("competing VIN session proposals retain ambiguity regardless of array order", () => {
  const sources = [input("a", { taken_at: "2026-10-01T12:00:00Z", capture_context: { device_fingerprint: "device", latitude: 35, longitude: -115 } }),
    input("b", { taken_at: "2026-10-01T12:02:00Z", capture_context: { device_fingerprint: "device", latitude: 35, longitude: -115 } })];
  const proposal = { anchor_image_id: "b", member_image_ids: ["a", "b"], basis: "Walk-around and identifier detail",
    identifier: { kind: "chassis", text: "6R07T123456", legibility: "clear" } };
  const competing = { ...proposal, identifier: { ...proposal.identifier, text: "6R07T654321" } };
  for (const sessions of [[proposal, competing], [competing, proposal]]) {
    equal(projectDepictedSubjects({ ...raw(), capture_sessions: sessions }, sources).capture_sessions, undefined);
  }
});

Deno.test("mixed cars retain a supported subject and an unresolved third frame, regardless of current filing", () => {
  const result = projectDepictedSubjects(raw(["a", "b", "c"]), [input("a"), input("b"), input("c")]);
  equal(result.subjects.map(s => s.member_image_ids), [["a", "b"]]);
  equal(result.subjects[0].physical_identity, "unresolved");
  equal(result.subjects[0].asserted_identity, { make: "Example", model_family: "Coupe" });
  equal(result.unresolved, [{ image_id: "c", reason: "needs_corresponding_view" }]);
});
Deno.test("paint, background, time and model confidence cannot identify a specific car", () => {
  for (const kinds of [["paint", "background", "sequence"], ["body_geometry", "paint"], ["configuration", "fixed_wear"]]) {
    const result = projectDepictedSubjects(raw(["a", "b"], [edge("a", "b", kinds)]), [input("a"), input("b")]);
    equal(result.subjects.length, 0);
  }
});
Deno.test("a negative in a near-identical-car bridge retains the whole conflict", () => {
  const reading = raw(["a", "b", "c"], [edge("a", "b"), edge("b", "c")]);
  reading.contradictions = [{ left_image_id: "a", right_image_id: "c", reason: "Different fixed door damage" }];
  const result = projectDepictedSubjects(reading, [input("a"), input("b"), input("c")]);
  equal(result.subjects, []);
  equal(result.unresolved.map(r => r.reason), Array(3).fill("contradictory_subject_component"));
  equal(result.contradictions.length, 1);
});
Deno.test("nonprimary multicar frames, screenshots and invalid locators do not anchor", () => {
  for (const extra of [{ primary_subject: "multiple" }, { medium: "screenshot" }, { bbox: [0, 0, 0, 1] }]) {
    const reading = raw(); reading.frames[0] = frame("a", extra);
    equal(projectDepictedSubjects(reading, [input("a"), input("b")]).subjects.length, 0);
  }
});
Deno.test("generic engine/part views need an identifying exterior anchor", () => {
  const reading = raw(); reading.frames = [frame("a", { view: "engine" }), frame("b", { view: "detail" })];
  equal(projectDepictedSubjects(reading, [input("a"), input("b")]).unresolved.map(r => r.reason), ["needs_identifying_view", "needs_identifying_view"]);
});
Deno.test("missing or changed bytes, malformed clocks and duplicate originals cannot form a subject", () => {
  for (const extra of [{ source_qualified: false }, { input_sha256: "c".repeat(64) }, { source_sha256: "bad" }, { taken_at: "bad" }, { created_at: "infinity" }]) {
    equal(projectDepictedSubjects(raw(), [input("a", extra), input("b")]).subjects.length, 0);
  }
  equal(projectDepictedSubjects(raw(), [input("a"), input("b", { source_sha256: "a".repeat(64), input_sha256: "a".repeat(64) })]).subjects.length, 0);
});
Deno.test("an existing subject anchor preserves continuity; competing retained subjects stay separate", () => {
  const reading = raw();
  equal(projectDepictedSubjects(reading, [input("a"), input("b", { existing_cluster_id: "cluster", existing_anchor_image_id: "b" })]).subjects[0].anchor_image_id, "b");
  equal(projectDepictedSubjects(reading, [input("a", { existing_cluster_id: "cluster", existing_anchor_image_id: "outside" }), input("b")]).subjects, []);
  const result = projectDepictedSubjects(reading, [input("a", { existing_cluster_id: "one" }), input("b", { existing_cluster_id: "two" })]);
  equal(result.subjects.length, 0); equal(result.unresolved[0].reason, "competing_existing_subjects");
});
Deno.test("duplicate frame testimony cannot silently replace a primary-subject assessment", () => {
  const reading = raw(); reading.frames.push(frame("a"));
  equal(projectDepictedSubjects(reading, [input("a"), input("b")]).subjects.length, 0);
});
Deno.test("a qualified normalized input retains different source/consumed hashes and its derivation", () => {
  const origin = "https://example.supabase.co", path = "vehicle-photos/users/example/capture-relay/original/example.HEIC";
  const normalized: Partial<SubjectInput> = { representation: "derivative", input_sha256: "d".repeat(64),
    source_bytes_qualified: false, derivation_qualified: true, byte_length: 100, mime_type: "image/jpeg",
    source_url: `${origin}/storage/v1/object/public/${path}`,
    input_url: `${origin}/storage/v1/render/image/public/${path}?width=1600&height=1600&resize=contain&quality=85`,
    derivation: { contract: "supabase_content_addressed_render_v1", trusted_origin: origin, source_object_path: path,
      render_path: `/storage/v1/render/image/public/${path}`, request_accept: "image/jpeg",
      source_sha256: "a".repeat(64), input_sha256: "d".repeat(64), source_byte_length: 1000,
      source_mime_type: "image/heic", source_captured_at: "2026-10-01T01:00:00Z",
      parameters: { width: 1600, height: 1600, resize: "contain", quality: 85 } } };
  equal(projectDepictedSubjects(raw(), [input("a", normalized), input("b")]).subjects.length, 1);
  for (const extra of [{ derivation_qualified: false }, { source_bytes_qualified: true }, { mime_type: "image/heic" }, { input_url: "https://untrusted.example/other.jpg" }]) {
    equal(projectDepictedSubjects(raw(), [input("a", { ...normalized, ...extra }), input("b")]).subjects.length, 0);
  }
});
