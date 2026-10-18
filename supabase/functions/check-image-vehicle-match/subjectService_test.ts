import { resolveSubjectBatch, subjectOwnerId, type CandidateScope, type SubjectEnvelope, type SubjectReading,
  type SubjectSource, type SubjectStore, type SubjectDependencies } from "./subjectService.ts";
import type { VisionInputCapture } from "./inputCustody.ts";
import { VisionProviderUnavailable } from "../_shared/providerDiagnostic.ts";
const uid = "00000000-0000-4000-8000-000000000001", other = "00000000-0000-4000-8000-000000000002";
const ids = ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002", "10000000-0000-4000-8000-000000000003"];
const cluster = "20000000-0000-4000-8000-000000000001";
function equal(a: unknown, b: unknown) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
const scope: CandidateScope = { kind: "account_associated_terminal_vehicles", vehicle_ids: [cluster], retrieved: 1,
  exhausted: true, truncated: false, reference_photos_assessed: 0, unavailable_references: [cluster], global_novelty_asserted: false };
const source = (id: string, n: number): SubjectSource => ({ id, user_id: uid, file_hash: `${n}`.repeat(64),
  image_url: `https://example.test/${id}`, storage_path: `users/${uid}/capture-relay/${`${n}`.repeat(64)}/frame.JPG`, taken_at: null, created_at: "2026-10-01T00:00:00.000001Z",
  is_superseded: false, is_duplicate: false, is_document: false, is_sensitive: false, vision_gate_status: "approved" });
function fixture() {
  const sources = ids.map(source), readings: SubjectReading[] = [], writes: Array<{ image_id: string; envelope: SubjectEnvelope }> = [];
  const counts = { captures: 0, models: 0, candidates: 0 };
  const store: SubjectStore = {
    sources: async (_user, selected) => sources.filter(source => selected.includes(source.id)),
    readings: async selected => readings.filter(row => selected.includes(row.image_id)),
    candidates: async () => { counts.candidates++; return scope; },
    admission: async () => ({ data_reusable: true, admission_allowed: true, blocked_image_ids: [], reason: null }),
    retainReading: async (image_id, envelope) => {
      const id = ids[0];
      readings.push({ id, image_id, cluster_id: null, is_active: true,
        confidence_basis: { visual_subject_reading_v1: { envelope } } });
      return id;
    },
    ingest: async (image_id, anchor_image_id, envelope) => {
      writes.push({ image_id, envelope });
      const id = ids[writes.length % ids.length];
      readings.push({ id, image_id, cluster_id: cluster, is_active: true,
        confidence_basis: { visual_subjects_v1: { anchor_image_id, envelope, state: "active" } } });
      return { id, cluster_id: cluster };
    },
  };
  const dependencies: SubjectDependencies = {
    now: () => new Date("2026-10-02T00:00:00Z"),
    capture: async inputs => {
      counts.captures++;
      return { required_available: true, bytes_read: inputs.length * 100, unavailable: [],
        inputs: inputs.map(input => ({ key: input.key, data_uri: "data:image/jpeg;base64,/9j/", receipt: {
          key: input.key, image_id: input.image_id, source_url: input.source_url, input_url: input.source_url,
          representation: "source", source_qualified: true, source_bytes_qualified: true, derivation_qualified: false,
          source_sha256: input.expected_source_sha256!, input_sha256: input.expected_source_sha256!,
          expected_source_sha256: input.expected_source_sha256!, expected_input_sha256: null,
          byte_length: 100, mime_type: "image/jpeg", captured_at: "2026-10-02T00:00:00Z", request_accept: null,
        } })) };
    },
    vision: async options => {
      counts.models++;
      equal(options.maxTokens, 1600);
      equal(options.parts.filter(part => "imageUrl" in part).every(part => "imageUrl" in part && part.imageUrl.startsWith("data:")), true);
      return { provider: "synthetic", model: "offline", data: {
        frames: ids.map(image_id => ({ image_id, medium: "photograph", view: "exterior", primary_subject: "vehicle", bbox: [0, 0, 1, 1] })),
        correspondences: [{ left_image_id: ids[0], right_image_id: ids[1], features: [
          { kind: "body_geometry", left_witness: "Fixed pillar shape", right_witness: "Corresponding pillar shape" },
          { kind: "configuration", left_witness: "Rack mounts", right_witness: "Corresponding mounts" },
        ] }], contradictions: [], labels: [{ anchor_image_id: ids[0], make: "Example", model_family: "Coupe" }],
      } };
    },
  };
  const request = { user_id: uid, image_ids: ids.slice(0, 2), dry_run: false };
  const run = (body = request) => resolveSubjectBatch(store, body, "https://example.test", dependencies);
  return { sources, readings, writes, counts, store, dependencies, request, run };
}
Deno.test("protected owner binding rejects other accounts and anonymous or unscoped callers", () => {
  equal(subjectOwnerId({ kind: "user", userId: uid }, uid), uid);
  equal(subjectOwnerId({ kind: "service_role" }, other), other);
  for (const caller of [{ kind: "user", userId: other }, { kind: "anonymous" }, { kind: "api_key", userId: uid }]) {
    let refused = false; try { subjectOwnerId(caller, uid); } catch { refused = true; } equal(refused, true);
  }
});
Deno.test("source to projection to sanctioned storage retains per-photo evidence and broad retrieval coverage", async () => {
  const f = fixture(), result = await f.run();
  equal(result.status, "resolved"); equal(result.persisted_image_ids, ids.slice(0, 2));
  equal(f.counts, { captures: 1, models: 1, candidates: 1 });
  equal(f.writes[0].envelope.inputs[0].source_sha256, f.sources[0].file_hash);
  equal(f.writes[0].envelope.candidate_scope.reference_photos_assessed, 0);
  equal(f.writes[0].envelope.subjects[0].physical_identity, "unresolved");
  equal(f.writes[0].envelope.candidate_scope.global_novelty_asserted, false);
});
Deno.test("retained admitted reading replay performs no object, renderer, candidate or paid inference calls", async () => {
  const f = fixture(); await f.run(); const result = await f.run();
  equal(result.status, "cached"); equal(f.counts, { captures: 1, models: 1, candidates: 1 });
});
Deno.test("partial storage retry reuses protected full-batch receipt without redoing inference", async () => {
  const f = fixture(), ingest = f.store.ingest;
  f.store.ingest = async (...args) => { if (args[0] === ids[1]) throw new Error("transport"); return ingest(...args); };
  equal((await f.run()).status, "partial");
  f.store.ingest = ingest;
  equal((await resolveSubjectBatch(f.store, { ...f.request, reuse_only: true }, "https://example.test", f.dependencies)).status, "cached");
  equal(f.counts.models, 1);
});
Deno.test("an unavailable admission read retains the paid interpretation and retries without inference", async () => {
  const f = fixture(), admission = f.store.admission;
  f.store.admission = async () => { throw new Error("membership read unavailable"); };
  const held = await f.run();
  equal(held.status, "partial"); equal(held.persisted_image_ids, []);
  equal("retained_reading_image_ids" in held && held.retained_reading_image_ids, ids.slice(0, 2));
  equal(held.unresolved, ids.slice(0, 2).map(image_id => ({ image_id, reason: "subject_admission_unavailable" })));
  equal(f.writes, []); equal(f.readings.length, 2);
  f.store.admission = admission;
  const retried = await resolveSubjectBatch(f.store, { ...f.request, reuse_only: true }, "https://example.test", f.dependencies);
  equal(retried.status, "cached"); equal(retried.persisted_image_ids, ids.slice(0, 2));
  equal(f.counts, { captures: 1, models: 1, candidates: 1 });
});
Deno.test("an admission outage keeps context separate from deferred fresh work", async () => {
  const f = fixture(), admission = f.store.admission;
  f.store.context = async () => ({ sources: [f.sources[2]], coverage: { assessed: 1, eligible: 1, truncated: false } });
  f.store.admission = async () => { throw new Error("membership read unavailable"); };
  const held = await f.run();
  equal(held.status, "partial"); equal(held.persisted_image_ids, []);
  equal(held.unresolved, [{ image_id: ids[0], reason: "subject_admission_unavailable" }]);
  equal(held.deferred_image_ids, [ids[1]]);
  equal("retained_reading_image_ids" in held && held.retained_reading_image_ids, [ids[0]]);
  equal(f.readings.map(reading => reading.image_id), [ids[0], ids[2]]);
  f.store.admission = admission;
  const retried = await resolveSubjectBatch(f.store, { ...f.request, image_ids: [ids[0]], reuse_only: true }, "https://example.test", f.dependencies);
  equal(retried.status, "cached"); equal(retried.deferred_image_ids, []);
  equal(retried.unresolved.map(row => row.image_id), [ids[0]]);
  equal(f.counts, { captures: 1, models: 1, candidates: 1 });
});
Deno.test("a partial retry with no surviving protected receipt refuses before inference", async () => {
  const f = fixture(); f.store.ingest = async () => { throw new Error("unavailable"); };
  f.store.retainReading = async () => { throw new Error("unavailable"); };
  equal((await f.run()).status, "partial");
  const result = await resolveSubjectBatch(f.store, { ...f.request, reuse_only: true }, "https://example.test", f.dependencies);
  equal(result.status, "refused"); equal("refusal" in result && result.refusal, "retained_reading_unavailable"); equal(f.counts.models, 1);
});
Deno.test("withdrawn, wrong-account, duplicate, document and sensitive sources refuse before any paid read", async () => {
  for (const extra of [{ user_id: other }, { is_superseded: true }, { is_duplicate: true }, { is_sensitive: true },
    { is_document: true }, { vision_gate_status: "rejected_personal" }, { storage_path: `users/${other}/capture-relay/${"0".repeat(64)}/frame.JPG` }]) {
    const f = fixture(); Object.assign(f.sources[0], extra);
    equal((await f.run()).status, "refused"); equal(f.counts.models, 0); equal(f.writes.length, 0);
  }
});
Deno.test("pending privacy classification stays pending rather than becoming a negative identity result", async () => {
  const f = fixture(); f.sources[0].vision_gate_status = "pending";
  const result = await f.run(); equal("refusal" in result && result.refusal, "source_not_ready"); equal(f.counts.models, 0);
});
Deno.test("source hash pins and microsecond clocks prevent stale evidence reuse", async () => {
  const f = fixture(); await f.run(); f.sources[0].created_at = "2026-10-01T00:00:00.000002Z";
  const result = await resolveSubjectBatch(f.store, { ...f.request, reuse_only: true }, "https://example.test", f.dependencies);
  equal("refusal" in result && result.refusal, "retained_reading_unavailable"); equal(f.counts.models, 1);
  const expected = Object.fromEntries(f.sources.slice(0, 2).map(source => [source.id, source.file_hash]));
  f.sources[0].file_hash = "f".repeat(64);
  const pinned = await resolveSubjectBatch(f.store, { ...f.request, expected_source_hashes: expected }, "https://example.test", f.dependencies);
  equal("refusal" in pinned && pinned.refusal, "source_changed"); equal(f.counts.models, 1);
});
Deno.test("missing source and unavailable object retain explicit failure and make no provider call", async () => {
  const f = fixture(); f.sources.pop(); f.sources.pop(); equal((await f.run()).status, "refused"); equal(f.counts.models, 0);
  const g = fixture(); g.dependencies.capture = async (): Promise<VisionInputCapture> => ({ inputs: [], bytes_read: 0, required_available: false,
    unavailable: [{ key: ids[0], image_id: ids[0], required: true, code: "input_fetch_failed" }] });
  const result = await g.run(); equal("refusal" in result && result.refusal, "required_input_unavailable"); equal(g.counts.models, 0);
});
Deno.test("dry-run reads never persist or turn a supported subject into a chassis or owner claim", async () => {
  const f = fixture(), result = await f.run({ ...f.request, dry_run: true });
  equal(result.status, "resolved"); equal(f.writes, []); equal(result.persisted_image_ids, []);
});
Deno.test("all-unknown paid readings are retained and reusable across devices without reanalysis", async () => {
  const f = fixture(), vision = f.dependencies.vision;
  f.dependencies.vision = async options => {
    const result = await vision(options);
    return { ...result!, data: { frames: [], correspondences: [], contradictions: [], labels: [] } };
  };
  equal((await f.run()).status, "unresolved");
  equal(f.readings.filter(row => row.cluster_id === null).length, 2);
  equal((await f.run()).status, "cached"); equal(f.counts.models, 1); equal(f.writes.length, 0);
});
Deno.test("one fresh photo uses retained context and defers unused fresh work with exact receipt closure", async () => {
  const f = fixture(), vision = f.dependencies.vision;
  f.store.context = async () => ({ sources: [f.sources[2]], coverage: { assessed: 1, eligible: 1, truncated: false } });
  f.dependencies.vision = async options => {
    const response = await vision(options);
    const body = response!.data as Record<string, unknown>;
    body.correspondences = [{ left_image_id: ids[0], right_image_id: ids[2], features: [
      { kind: "body_geometry", left_witness: "Pillar", right_witness: "Corresponding pillar" },
      { kind: "configuration", left_witness: "Mount", right_witness: "Corresponding mount" },
    ] }];
    return response;
  };
  const result = await f.run();
  equal(result.status, "resolved"); equal(result.persisted_image_ids, [ids[0]]);
  equal(result.deferred_image_ids, [ids[1]]);
  equal("input_image_ids" in result && result.input_image_ids, [ids[0], ids[2]]);
  const retried = await resolveSubjectBatch(f.store, { ...f.request, image_ids: [ids[0]], reuse_only: true }, "https://example.test", f.dependencies);
  equal(retried.status, "cached"); equal(retried.persisted_image_ids, [ids[0]]); equal(f.counts.models, 1);
});
Deno.test("a lone photo with no retained view waits before any object or provider request", async () => {
  const f = fixture();
  const result = await resolveSubjectBatch(f.store, { ...f.request, image_ids: [ids[0]] }, "https://example.test", f.dependencies);
  equal("refusal" in result && result.refusal, "source_needs_corresponding_view");
  equal(f.counts, { captures: 0, models: 0, candidates: 0 });
});
Deno.test("an explicit source scope refuses outside selected context before capture or inference", async () => {
  const f = fixture();
  f.store.context = async () => ({ sources: [f.sources[2]], coverage: {} });
  const pins = Object.fromEntries(f.sources.slice(0, 2).map(source => [source.id, source.file_hash]));
  const result = await resolveSubjectBatch(f.store, { ...f.request, allowed_source_hashes: pins }, "https://example.test", f.dependencies);
  equal("refusal" in result && result.refusal, "source_outside_allowed_scope");
  equal(f.counts, { captures: 0, models: 0, candidates: 0 }); equal(f.readings, []); equal(f.writes, []);
});
Deno.test("an explicit source scope refuses context hash drift and fresh hash drift before input callbacks", async () => {
  for (const changed of [0, 2]) {
    const f = fixture(), pins = Object.fromEntries(f.sources.map(source => [source.id, source.file_hash]));
    f.store.context = async () => ({ sources: [f.sources[2]], coverage: {} });
    f.sources[changed].file_hash = "f".repeat(64);
    f.sources[changed].storage_path = `users/${uid}/capture-relay/${f.sources[changed].file_hash}/frame.JPG`;
    const result = await resolveSubjectBatch(f.store, { ...f.request, allowed_source_hashes: pins }, "https://example.test", f.dependencies);
    equal("refusal" in result && result.refusal, "source_changed");
    equal(f.counts, { captures: 0, models: 0, candidates: 0 }); equal(f.readings, []); equal(f.writes, []);
  }
});
Deno.test("a complete pinned selected context passes once and replay cannot broaden its caller scope", async () => {
  const f = fixture(), pins = Object.fromEntries(f.sources.map(source => [source.id, source.file_hash]));
  f.store.context = async () => ({ sources: [f.sources[2]], coverage: {} });
  const body = { ...f.request, allowed_source_hashes: pins,
    expected_source_hashes: Object.fromEntries(f.sources.slice(0, 2).map(source => [source.id, source.file_hash])) };
  const result = await resolveSubjectBatch(f.store, body, "https://example.test", f.dependencies);
  equal(result.status, "unresolved");
  equal("input_image_ids" in result && result.input_image_ids, [ids[0], ids[2]]);
  equal(f.counts, { captures: 1, models: 1, candidates: 1 });
  const stored = f.readings.length;
  const narrowed = await resolveSubjectBatch(f.store, { ...body, reuse_only: true,
    allowed_source_hashes: Object.fromEntries(f.sources.slice(0, 2).map(source => [source.id, source.file_hash])) }, "https://example.test", f.dependencies);
  equal("refusal" in narrowed && narrowed.refusal, "source_outside_allowed_scope"); equal(f.readings.length, stored);
  const replay = await resolveSubjectBatch(f.store, { ...body, reuse_only: true }, "https://example.test", f.dependencies);
  equal(replay.status, "cached"); equal(f.counts, { captures: 1, models: 1, candidates: 1 });
});
Deno.test("invalid source allowlists refuse before source lookup or any input callbacks", async () => {
  const f = fixture(); let sourceReads = 0;
  f.store.sources = async () => { sourceReads++; return f.sources; };
  for (const allowed of [null, [], {}, { [ids[0]]: f.sources[0].file_hash }, { [ids[0]]: "bad", [ids[1]]: f.sources[1].file_hash }]) {
    const result = await resolveSubjectBatch(f.store, { ...f.request, allowed_source_hashes: allowed as any }, "https://example.test", f.dependencies);
    equal("refusal" in result && result.refusal, "allowed_source_scope_invalid");
  }
  const pins = Object.fromEntries(f.sources.slice(0, 2).map(source => [source.id, source.file_hash]));
  const disagreement = await resolveSubjectBatch(f.store, { ...f.request, allowed_source_hashes: pins,
    expected_source_hashes: { ...pins, [ids[0]]: "f".repeat(64) } }, "https://example.test", f.dependencies);
  equal("refusal" in disagreement && disagreement.refusal, "allowed_source_scope_invalid");
  equal(sourceReads, 0); equal(f.counts, { captures: 0, models: 0, candidates: 0 });
});
Deno.test("protected data reuse cannot restore a later membership withdrawal", async () => {
  const f = fixture(); await f.run(); const before = f.writes.length;
  f.store.admission = async () => ({ data_reusable: true, admission_allowed: false, blocked_image_ids: [ids[0]], reason: "current_membership_conflict" });
  const result = await f.run();
  equal(result.status, "unresolved"); equal(result.persisted_image_ids, []);
  equal(result.unresolved.map(row => row.image_id), ids.slice(0, 2));
  equal(f.writes.length, before); equal(f.counts.models, 1);
});
Deno.test("typed provider failure reaches the owner receipt without saving readings or permitting a paid replay", async () => {
  const f = fixture();
  f.dependencies.vision = async () => {
    f.counts.models++;
    throw new VisionProviderUnavailable([
      { code: "credential_not_accepted", provider: "anthropic", http_status: 401, credential_kind: "oauth" },
      { code: "no_connected_key", provider: "google", http_status: null, credential_kind: null },
      { code: "credential_lookup_failed", provider: "openai", http_status: null, credential_kind: null },
    ]);
  };
  const result = await f.run();
  equal(result.status, "refused");
  equal("refusal" in result && result.refusal, "provider_unavailable");
  equal("provider_diagnostics" in result && result.provider_diagnostics?.length, 3);
  equal("provider_attempt_coverage" in result && result.provider_attempt_coverage?.no_reading_started, true);
  equal(f.readings.length, 0); equal(f.writes.length, 0); equal(f.counts.models, 1);
  const replay = await resolveSubjectBatch(f.store, { ...f.request, reuse_only: true }, "https://example.test", f.dependencies);
  equal("refusal" in replay && replay.refusal, "retained_reading_unavailable");
  equal(f.counts.models, 1); equal(f.counts.captures, 1);
});
