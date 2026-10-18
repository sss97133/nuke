import { attachSubjectPrivacy, hydrateSubjectPrivacy, privateSubjectPrivacyQualified, validDevicePrivacyReceipt, subjectSourceFamily,
  subjectPrivacyLookupComplete, subjectSourceAvailable, subjectSourceCanEstablishPrivacy } from "./subjectPrivacy.ts";
import { projectSourceIdentities, attachSourceIdentityRecords } from "./sourceIdentity.ts";
import { qualifySubjectSource } from "./subjectReader.ts";
import { captureTrustedJPEGInputs, visionInputSHA256 } from "./inputCustody.ts";
import { resolveSubjectBatch, type SubjectStore } from "./subjectService.ts";
import { assessSubjectAdmission } from "./subjectReplay.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = id(9000), at = "2026-10-18T00:00:00Z", origin = "https://qkgaybvrernstplzjaam.supabase.co";
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function equal(a: unknown, b: unknown) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
async function fixture() {
  const bytes = [new Uint8Array([255, 216, 255, 1]), new Uint8Array([255, 216, 255, 2])];
  const sources: any[] = [];
  for (let n = 0; n < 2; n++) {
    const hash = await visionInputSHA256(bytes[n]), path = `users/${user}/capture-relay/${hash}/synthetic-${n}.JPG`;
    sources.push({ id: id(n + 1), user_id: user, source: "capture_relay_ios", file_hash: hash, storage_path: path,
      image_url: `${origin}/storage/v1/object/public/vehicle-photos/${path}`, created_at: "2026-10-17T00:00:00.000001Z", taken_at: null,
      vision_gate_status: "pending", ai_processing_status: "pending", is_sensitive: false, is_document: false, is_duplicate: false, is_superseded: false });
  }
  const native = (s: any) => ({ method: "device_privacy_v1", purpose: "own_private_visual_subjects", policy_version: 1, owner_user_id: user,
    source_sha256: s.file_hash, source_byte_length: 4, observed_at: "2026-10-17T00:00:00Z", classifier_revision: 2, face_revision: 3,
    os_major: 26, classifier_completed: true, face_completed: true, pixels_eligible: true, clutter: false, personal: false,
    prominent_face: false, is_vehicle: true, max_core_confidence: 0.8, total_vehicle_confidence: 0.8, face_threshold: 0.045,
    labels: [{ identifier: "car", confidence: 0.8 }], decode: { contract: "imageio_thumbnail_512_v1", max_pixel: 512,
      orientation_applied: true, input_sha256: "b".repeat(64), width: 1, height: 1, byte_length: 4 } });
  let fetches = 0, modelCalls = 0;
  const capture = async (rows: any[], url: string) => await captureTrustedJPEGInputs(rows, url, { now: () => new Date(at), fetch: async (url: any) => {
    fetches++; const index = sources.findIndex(s => String(url).includes(s.storage_path));
    return new Response(bytes[index], { headers: { "Content-Type": "image/jpeg" } });
  } });
  const heads: any[] = [], retained: any[] = [];
  const store: SubjectStore = {
    sources: async (_u, ids) => attachSubjectPrivacy(sources.filter(s => ids.includes(s.id)), heads, true),
    readings: async () => [], candidates: async () => ({ kind: "account_associated_terminal_vehicles", vehicle_ids: [], retrieved: 0,
      exhausted: true, truncated: false, reference_photos_assessed: 0, unavailable_references: [], global_novelty_asserted: false }),
    retainPrivacy: async (image_id, envelope) => { heads.push({ id: id(100 + heads.length), image_id, observed_by: "device_privacy_v1", is_active: true,
      superseded_by: null, confidence_basis: { device_privacy_v1: { state: "active", envelope } } }); return id(100 + heads.length); },
    retainReading: async (_i, e) => { retained.push(e); return id(200); },
    admission: async e => assessSubjectAdmission(e, user, { sources: await store.sources(user, e.inputs.map(i => i.image_id)), readings: [], readings_complete: true }),
    ingest: async () => ({ id: id(300), cluster_id: id(400) }),
  };
  const vision = async (options: any) => {
    modelCalls++;
    const submitted = options.parts.filter((p: any) => p.imageUrl).map((p: any) => p.imageUrl);
    equal(submitted, bytes.map(b => `data:image/jpeg;base64,${btoa(String.fromCharCode(...b))}`));
    return { provider: "synthetic", model: "synthetic", data: { frames: sources.map(s => ({ image_id: s.id, medium: "photograph", view: "exterior", primary_subject: "vehicle", bbox: [0, 0, 1, 1] })),
      correspondences: [{ left_image_id: sources[0].id, right_image_id: sources[1].id, features: ["body_geometry", "fixed_wear"].map(kind =>
        ({ kind, left_witness: "specific seam and fixed notch", right_witness: "corresponding seam and fixed notch" })) }] } };
  };
  return { bytes, sources, native, capture, heads, retained, store, vision, counts: () => ({ fetches, modelCalls }), request: () => ({ user_id: user,
    image_ids: sources.map(s => s.id), expected_source_hashes: Object.fromEntries(sources.map(s => [s.id, s.file_hash])),
    device_privacy_receipts: Object.fromEntries(sources.map(s => [s.id, native(s)])) }) };
}

Deno.test("one existing source capture qualifies native privacy with zero extra providers and exact one subject request", async () => {
  const f = await fixture(), before = clone(f.sources);
  const result = await resolveSubjectBatch(f.store, f.request(), origin, { capture: f.capture, vision: f.vision, now: () => new Date(at) });
  equal(result.status, "resolved"); equal(f.counts(), { fetches: 4, modelCalls: 1 }); equal(f.heads.length, 2);
  equal(f.sources, before); // Global gate, processing state, visibility flags and canonical attachments are untouched.
  const own = await f.store.sources(user, [f.sources[0].id]);
  equal(privateSubjectPrivacyQualified(own[0], user, at), true);
  equal(qualifySubjectSource(f.retained[0].inputs[0], own[0], user, at), true);
});

Deno.test("unsupported native revisions, unavailable detectors, junk and clocks refuse before any fetch or provider", async () => {
  for (const change of [{ classifier_revision: 99 }, { face_revision: 99 }, { policy_version: 2 }, { os_major: 27 },
    { face_completed: false }, { classifier_completed: false }, { source_sha256: "f".repeat(64) }, { source_byte_length: 0 },
    { observed_at: "2026-10-18T00:06:00Z" }, { observed_at: "infinity" }, { pixels_eligible: false },
    { labels: [{ identifier: "document", confidence: 0.9 }] }, { prominent_face: true, is_vehicle: false },
    { decode: { contract: "thumbnail_from_album", input_sha256: "b".repeat(64) } }]) {
    const f = await fixture(), req = f.request(); Object.assign(req.device_privacy_receipts[f.sources[0].id], change);
    equal((await resolveSubjectBatch(f.store, req, origin, { capture: f.capture, vision: f.vision, now: () => new Date(at) })).status, "refused");
    equal(f.counts(), { fetches: 0, modelCalls: 0 });
  }
});

Deno.test("actual original length mismatch and failed protected intake cannot reach a paid callback", async () => {
  for (const storageFailure of [false, true]) {
    const f = await fixture(), req = f.request();
    if (storageFailure) f.store.retainPrivacy = async () => { throw new Error("synthetic unavailable storage"); };
    else req.device_privacy_receipts[f.sources[0].id].source_byte_length = 3;
    const r = await resolveSubjectBatch(f.store, req, origin, { capture: f.capture, vision: f.vision, now: () => new Date(at) });
    equal(r.status, "refused"); equal(f.counts().modelCalls, 0);
  }
});

Deno.test("exact-source purpose qualification fails after byte, locator, microsecond clock, gate or privacy changes", async () => {
  const f = await fixture(); await resolveSubjectBatch(f.store, f.request(), origin, { capture: f.capture, vision: f.vision, now: () => new Date(at) });
  const source: any = (await f.store.sources(user, [f.sources[0].id]))[0];
  for (const change of [{ user_id: id(9999) }, { file_hash: "f".repeat(64) }, { created_at: "2026-10-17T00:00:00.000002Z" },
    { taken_at: "2026-10-17T01:00:00Z" }, { image_url: "https://private.invalid/other.jpg" }, { storage_path: "other" },
    { vision_gate_status: null }, { vision_gate_status: "review_needed" }, { vision_gate_status: "rejected_personal" },
    { is_sensitive: true }, { is_document: true }, { is_duplicate: true }, { is_superseded: true }, { private_subject_privacy_complete: false }]) {
    const current = { ...source, ...change };
    equal(qualifySubjectSource(f.retained[0].inputs[0], current, user, at), false);
  }
});

Deno.test("a privacy withdrawal remains blocking after supersession and global approval", async () => {
  const f = await fixture(); await resolveSubjectBatch(f.store, f.request(), origin, { capture: f.capture, vision: f.vision, now: () => new Date(at) });
  const withdrawn = clone(f.heads[0]); withdrawn.is_active = false; withdrawn.superseded_by = id(999);
  withdrawn.confidence_basis.device_privacy_v1.state = "withdrawn"; f.heads.push(withdrawn);
  f.sources[0].vision_gate_status = "approved";
  const current = await f.store.sources(user, [f.sources[0].id]);
  equal(qualifySubjectSource(f.retained[0].inputs[0], current[0], user, at), false);
  const calls = f.counts();
  equal((await resolveSubjectBatch(f.store, f.request(), origin, { capture: f.capture, vision: f.vision, now: () => new Date(at) })).status, "refused");
  equal(f.counts(), calls);
});

Deno.test("legacy labels, album names and source IDs cannot replace exact native receipt evidence", async () => {
  const f = await fixture(), source = f.sources[0];
  equal(validDevicePrivacyReceipt({ labels: ["car"], source_id: source.id, album: "year make model" }, source, at), false);
  equal(privateSubjectPrivacyQualified({ ...source, apple_ml_labels: ["car"], private_subject_privacy: [] }, user, at), false);
});

Deno.test("current purpose permission is separate from immutable old model custody and preserves native Float thresholds", async () => {
  const f = await fixture(), native = f.native(f.sources[0]);
  Object.assign(native, { is_vehicle: false, max_core_confidence: Math.fround(0.1), total_vehicle_confidence: Math.fround(0.3) });
  equal(validDevicePrivacyReceipt(native, f.sources[0], at), true);
  await resolveSubjectBatch(f.store, f.request(), origin, { capture: f.capture, vision: f.vision, now: () => new Date(at) });
  const current = (await f.store.sources(user, [f.sources[0].id]))[0];
  const oldInput: any = { ...f.retained[0].inputs[0], representation: "source", input_sha256: f.sources[0].file_hash,
    source_bytes_qualified: true, derivation_qualified: false, derivation: undefined,
    input_url: f.sources[0].image_url, captured_at: "2026-10-17T00:00:01Z" };
  equal(qualifySubjectSource(oldInput, current, user, "2026-10-17T00:00:02Z", at), true);
  equal(qualifySubjectSource(oldInput, current, user, "2026-10-17T00:00:02Z", "2026-10-17T00:00:03Z"), false);
});

Deno.test("a typed audited leaf needs its own family-bound permission and reuses old reading/anchor with no model call", async () => {
  const f = await fixture();
  for (const source of f.sources) Object.assign(source, { vehicle_id: null, taken_at: "2026-10-16T00:00:00Z", superseded_by: null,
    superseded_at: null, duplicate_of: null, exif_data: { uuid: `synthetic-${source.id}`, camera_make: "Apple", camera_model: "synthetic" } });
  await resolveSubjectBatch(f.store, f.request(), origin, { capture: f.capture, vision: f.vision, now: () => new Date(at) });
  const modelEnvelope = f.retained[0], root = f.sources[0], peer = f.sources[1];
  root.vehicle_id = id(7000);
  const leaf = { ...clone(root), id: id(10), vehicle_id: null, is_duplicate: true, duplicate_of: root.id };
  Object.assign(root, { is_superseded: true, superseded_by: leaf.id, superseded_at: "2026-10-18T00:00:01Z" });
  const audits = [{ id: id(8000), observation_type: "image", old_observation_id: root.id, new_observation_id: leaf.id,
    old_vehicle_id: id(7000), new_vehicle_id: null, created_at: root.superseded_at }];
  const lookup = (ids: string[]) => {
    const projected = projectSourceIdentities(user, ids, [root, leaf, peer], audits, true);
    return attachSourceIdentityRecords(projected.sources, attachSubjectPrivacy([root, leaf, peer], f.heads, true)) as any;
  };
  const input = modelEnvelope.inputs.find((i: any) => i.image_id === root.id);
  equal(qualifySubjectSource(input, lookup([root.id])[0], user, modelEnvelope.read_at, "2026-10-18T00:00:03Z"), false);
  // A fresh independently captured leaf privacy receipt, never the ancestor's permission.
  const family = subjectSourceFamily(lookup([root.id])[0]);
  const privacyEnvelope = clone(f.heads[0].confidence_basis.device_privacy_v1.envelope);
  privacyEnvelope.read_at = "2026-10-18T00:00:02Z"; privacyEnvelope.source_family = family;
  Object.assign(privacyEnvelope.inputs[0], { image_id: leaf.id, key: leaf.id, captured_at: privacyEnvelope.read_at });
  f.heads.push({ id: id(8800), image_id: leaf.id, observed_by: "device_privacy_v1", is_active: true, superseded_by: null,
    confidence_basis: { device_privacy_v1: { state: "active", envelope: privacyEnvelope } } });
  const current = lookup([root.id])[0];
  equal(current.id, root.id); equal(current.is_superseded, true); equal(current.source_identity.result.lineage.current_source.is_duplicate, true);
  equal(qualifySubjectSource(input, current, user, modelEnvelope.read_at, "2026-10-18T00:00:03Z"), true);
  f.store.sources = async (_user, ids) => lookup(ids);
  f.store.readings = async () => [{ id: id(9900), image_id: root.id, cluster_id: null, is_active: true,
    confidence_basis: { visual_subject_reading_v1: { envelope: modelEnvelope } } }];
  const before = f.counts();
  const reused = await resolveSubjectBatch(f.store, { ...f.request(), reuse_only: true }, origin,
    { capture: f.capture, vision: f.vision, now: () => new Date("2026-10-18T00:00:03Z") });
  equal(reused.status, "cached");
  if (!("subjects" in reused) || !("input_image_ids" in reused)) throw new Error("cached response omitted its retained scope");
  equal(reused.subjects[0].anchor_image_id, root.id); equal(f.counts(), before);
  equal(reused.input_image_ids, modelEnvelope.inputs.map((i: any) => i.image_id));
  // Family drift and any alias withdrawal are negative evidence even if the leaf later has global approval.
  privacyEnvelope.source_family.audit_ids = [];
  equal(qualifySubjectSource(input, lookup([root.id])[0], user, modelEnvelope.read_at, "2026-10-18T00:00:03Z"), false);
  privacyEnvelope.source_family = family;
  const withdrawal = clone(f.heads[0]); withdrawal.is_active = false; withdrawal.superseded_by = id(9999);
  withdrawal.confidence_basis.device_privacy_v1.state = "withdrawn"; f.heads.push(withdrawal); leaf.vision_gate_status = "approved";
  equal(qualifySubjectSource(input, lookup([root.id])[0], user, modelEnvelope.read_at, "2026-10-18T00:00:03Z"), false);
});

Deno.test("native testimony cannot fetch a held, refused, incomplete or privacy-negative audited family", async () => {
  for (const change of ["sensitive", "document", "rejected", "unrelated_duplicate", "withdrawn", "incomplete", "refused", "privacy_incomplete"]) {
    const f = await fixture(), root = f.sources[0], peer = f.sources[1];
    Object.assign(root, { vehicle_id: id(7000), taken_at: "2026-10-16T00:00:00Z", superseded_by: null, superseded_at: null,
      duplicate_of: null, exif_data: { uuid: "same-camera-source" } });
    const leaf = { ...clone(root), id: id(10), vehicle_id: null, is_duplicate: true, duplicate_of: root.id };
    Object.assign(root, { is_superseded: true, superseded_by: leaf.id, superseded_at: "2026-10-17T00:00:01Z" });
    const audits = [{ id: id(8000), observation_type: "image", old_observation_id: root.id, new_observation_id: leaf.id,
      old_vehicle_id: id(7000), new_vehicle_id: null, created_at: root.superseded_at }];
    if (change === "sensitive") root.is_sensitive = true;
    if (change === "document") root.is_document = true;
    if (change === "rejected") root.vision_gate_status = "rejected_personal";
    if (change === "unrelated_duplicate") Object.assign(root, { is_duplicate: true, duplicate_of: id(9999) });
    const rows = projectSourceIdentities(user, [root.id, peer.id], [root, leaf, peer], audits, change !== "incomplete").sources;
    const privacyHeads = change === "withdrawn" ? [{ image_id: root.id, observed_by: "device_privacy_v1", is_active: false,
      superseded_by: id(9999), confidence_basis: { device_privacy_v1: { state: "withdrawn" } } }] : [];
    const bound: any[] = attachSourceIdentityRecords(rows, attachSubjectPrivacy([root, leaf, peer], privacyHeads, change !== "privacy_incomplete"));
    if (change === "refused") bound[0].source_identity.result = { status: "refused", reason: "missing_audit" };
    equal(subjectSourceCanEstablishPrivacy(bound[0], user), false);
    f.store.sources = async () => bound;
    const result = await resolveSubjectBatch(f.store, f.request(), origin, { capture: f.capture, vision: f.vision, now: () => new Date(at) });
    equal(result.status, "refused"); equal(f.counts(), { fetches: 0, modelCalls: 0 }); equal(f.heads.length, 0);
  }
});

Deno.test("privacy hydration exposes alias/history cap exhaustion and holds approved sources without spending", async () => {
  const f = await fixture(), source = { ...f.sources[0], vision_gate_status: "approved" };
  equal(subjectPrivacyLookupComplete([source]), false); equal(subjectSourceAvailable(source, user, at), false);
  equal(subjectSourceCanEstablishPrivacy({ ...source, vision_gate_status: "pending" }, user), false);
  let reads = 0, limit = 0;
  const head = { image_id: source.id, observed_by: "device_privacy_v1", superseded_by: null, is_active: true,
    confidence_basis: { device_privacy_v1: { state: "active" } } };
  const history = { ...clone(head), superseded_by: id(9999), is_active: false, confidence_basis: { device_privacy_v1: { state: "withdrawn" } } };
  const client = { from: () => { reads++; const query: any = { select: () => query, eq: () => query, or: () => query, in: () => query,
    limit: (value: number) => { limit = value; return Promise.resolve({ data: [head, history, clone(history)], error: null }); } }; return query; } };
  const overflow = await hydrateSubjectPrivacy(client, user, [source]);
  equal(reads, 1); equal(limit, 3); equal(subjectPrivacyLookupComplete(overflow), false);
  equal(subjectSourceAvailable(overflow[0], user, at), false); equal(subjectSourceCanEstablishPrivacy(overflow[0], user), false);
  equal(overflow[0].private_subject_privacy, []); // No fabricated complete absence: false completeness accompanies the opaque result.
  const tooManyAliases = Array.from({ length: 257 }, (_, n) => ({ ...source, id: id(1000 + n) }));
  const aliasOverflow = await hydrateSubjectPrivacy(client, user, tooManyAliases);
  equal(reads, 1); equal(subjectPrivacyLookupComplete(aliasOverflow), false);
  equal(aliasOverflow.every(row => !subjectSourceAvailable(row, user, at)), true);
  const complete = attachSubjectPrivacy([source], [head, history], true);
  equal(subjectPrivacyLookupComplete(complete), true); equal(subjectSourceAvailable(complete[0], user, at), false);
  equal(f.counts(), { fetches: 0, modelCalls: 0 });
});
