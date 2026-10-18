import { qualifyCurrentSubjectReading, qualifySubjectSource, readSubjectProfiles } from "./subjectReader.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(900000), stranger = id(900001), cluster = id(800000);
const readAt = "2025-02-01T00:00:00.123456Z", asOf = "2025-02-02T00:00:00Z";
const origin = "https://qkgaybvrernstplzjaam.supabase.co";
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const feature = [
  { kind: "body_geometry", left_witness: "fold beside rear seam", right_witness: "same fold beside rear seam" },
  { kind: "fixed_wear", left_witness: "fixed scar crossing fold", right_witness: "same fixed scar crossing fold" },
];
function source(n: number): any {
  const file_hash = n.toString(16).padStart(64, "0");
  const storage_path = `users/${owner}/capture-relay/${file_hash}/IMG_${n}.JPG`;
  return { id: id(n), user_id: owner, image_url: `${origin}/storage/v1/object/public/vehicle-photos/${storage_path}`,
    file_hash, storage_path, taken_at: "2024-12-31T00:00:00.222333Z", created_at: "2025-01-01T00:00:00.000001Z",
    is_superseded: false, is_duplicate: false, is_document: false, is_sensitive: false, vision_gate_status: "approved" };
}
function envelope(sources: any[], anchor: string, edges?: Array<[string, string]>): any {
  return { method: "visual_subjects_v1", user_id: owner, provider: "fixture", model: "fixture", read_at: readAt,
    inputs: sources.map(s => ({ image_id: s.id, source_url: s.image_url, source_sha256: s.file_hash, input_sha256: s.file_hash,
      source_qualified: true, representation: "source", created_at: s.created_at, taken_at: s.taken_at })),
    frames: sources.map(s => ({ image_id: s.id, medium: "photograph", primary_subject: "vehicle",
      view: s.id === anchor ? "exterior" : "detail", bbox: [0.1, 0.1, 0.8, 0.8] })),
    subjects: [{ anchor_image_id: anchor, member_image_ids: sources.map(s => s.id), physical_identity: "unresolved",
      correspondences: (edges ?? sources.filter(s => s.id !== anchor).map(s => [anchor, s.id])).map(([a, b]) =>
        ({ left_image_id: a, right_image_id: b, features: clone(feature) })), contradictions: [],
      asserted_identity: { make: "Observed make", model_family: "Coupe" } }], contradictions: [] };
}
function fixture(count = 3, edges?: Array<[string, string]>) {
  const sources = Array.from({ length: count }, (_, i) => source(i + 1));
  const observations = sources.map((s, i) => ({ id: id(10000 + i), image_id: s.id, cluster_id: cluster, vehicle_id: null,
    role: "subject", observed_by: "visual_subjects_v1", agent_version: "fixture", observed_at: readAt,
    is_active: true, superseded_by: null, confidence_basis: { visual_subjects_v1: { state: "active", anchor_image_id: sources[0].id,
      envelope: envelope(count <= 14 ? sources : [sources[0], sources[i || 1]], sources[0].id, edges) } } }));
  const carriers = [{ id: cluster, created_at: readAt, is_active: true, resolved_to_vehicle_id: null,
    image_count: 9999, cluster_label: "UNTRUSTED CACHED LABEL", resolution_evidence: { visual_subjects_v1: { user_id: owner } } }];
  return { sources, observations, carriers };
}
const namespaceValue = (row: any, path: string) => path.split(/->>?/).reduce((value, key) => value?.[key], row);
class FixtureDB {
  calls: Array<{ table: string; returned: number; filters: Array<[string, string, unknown]> }> = [];
  failTable: string | null = null;
  omitSources = new Set<string>();
  constructor(public data: ReturnType<typeof fixture>) {}
  from(table: string) { return new FixtureQuery(this, table); }
}
class FixtureQuery {
  filters: Array<[string, string, any]> = [];
  orders: Array<[string, boolean]> = [];
  start = 0; end = Infinity;
  constructor(private db: FixtureDB, private table: string) {}
  select(_fields: string) { return this; }
  eq(field: string, value: unknown) { this.filters.push(["eq", field, value]); return this; }
  is(field: string, value: null) { this.filters.push(["is", field, value]); return this; }
  in(field: string, value: string[]) { this.filters.push(["in", field, value]); return this; }
  order(field: string, options: { ascending: boolean }) { this.orders.push([field, options.ascending]); return this; }
  limit(n: number) { this.end = this.start + n - 1; return this; }
  range(start: number, end: number) { this.start = start; this.end = end; return this; }
  then(resolve: (v: any) => unknown, reject: (e: unknown) => unknown) {
    const rows = this.table === "vehicle_images" ? this.db.data.sources : this.table === "image_observations"
      ? this.db.data.observations : this.db.data.carriers;
    const found = rows.filter((row: any) => (this.table !== "vehicle_images" || !this.db.omitSources.has(row.id)) &&
      this.filters.every(([op, field, value]) => {
        const got = namespaceValue(row, field);
        return op === "in" ? value.includes(got) : op === "is" ? got === null || got === undefined : got === value;
      })).sort((a: any, b: any) => {
      for (const [field, ascending] of this.orders) {
        if (a[field] === b[field]) continue;
        return (a[field] < b[field] ? -1 : 1) * (ascending ? 1 : -1);
      }
      return 0;
    }).slice(this.start, this.end + 1);
    this.db.calls.push({ table: this.table, returned: found.length, filters: this.filters });
    return Promise.resolve({ data: this.db.failTable === this.table ? null : found,
      error: this.db.failTable === this.table ? { message: "PRIVATE BACKEND PROSE" } : null }).then(resolve, reject);
  }
}

Deno.test("private profiles derive current photo counts and attributed labels, never cached cluster facts", async () => {
  const db = new FixtureDB(fixture(4));
  const result = await readSubjectProfiles(db, owner);
  equal(result.subjects.length, 1);
  const profile = result.subjects[0];
  equal(profile.id, cluster); equal(profile.image_count, 4); equal(profile.identity_status, "unresolved");
  equal(profile.anchor_image_id, db.data.sources[0].id);
  equal(profile.images.some(image => image.id === profile.anchor_image_id), true);
  equal(profile.label, "Observed make Coupe"); equal(profile.cover_image_url, db.data.sources[0].image_url);
  equal(profile.observed_at, readAt); equal(profile.images[0].taken_at, db.data.sources[0].taken_at);
  equal(profile.coverage.assessed, 4); equal(profile.coverage.eligible, 4); equal(profile.coverage.excluded, 0);
  equal(JSON.stringify(result).includes("UNTRUSTED"), false);
  equal(db.calls.filter(call => call.table === "vehicle_images")[0].filters.some(f => f[1] === "user_id" && f[2] === owner), true);
});

Deno.test("private cluster creation evidence without protected current observations proves no profile", async () => {
  const data = fixture(); data.observations = [];
  const result = await readSubjectProfiles(new FixtureDB(data), owner);
  equal(result.subjects, []); equal(result.coverage.eligible, 0);
});

Deno.test("terminal source withdrawal prunes members and cannot resurrect older active versions", async () => {
  const data = fixture(3), db = new FixtureDB(data);
  equal((await readSubjectProfiles(db, owner)).subjects[0].image_count, 3);
  data.observations[1].is_active = false;
  data.observations[1].confidence_basis.visual_subjects_v1.state = "withdrawn";
  data.observations.push({ ...clone(data.observations[1]), id: id(90000), is_active: true, agent_version: "old-version",
    confidence_basis: { visual_subjects_v1: { ...clone(data.observations[1].confidence_basis.visual_subjects_v1), state: "active" } } });
  const result = await readSubjectProfiles(db, owner);
  equal(result.subjects[0].image_count, 2);
  equal(result.subjects[0].coverage.excluded, 1);
  equal(result.subjects[0].images.some(image => image.id === data.sources[1].id), false);
});

Deno.test("withdrawing a bridge disconnects remaining pictures instead of inheriting the cluster", async () => {
  const data = fixture(4, [[id(1), id(2)], [id(2), id(3)], [id(3), id(4)]]);
  data.observations[1].is_active = false;
  equal((await readSubjectProfiles(new FixtureDB(data), owner)).subjects, []);
});

Deno.test("disjoint surviving interpretations never join without an anchor-connected support path", async () => {
  const data = fixture(4, [[id(1), id(2)], [id(3), id(4)]]);
  const result = await readSubjectProfiles(new FixtureDB(data), owner);
  equal(result.subjects[0].images.map(image => image.id), [id(1), id(2)]);
  equal(result.subjects[0].coverage.excluded, 2);
});

Deno.test("changed source custody, privacy flags and unknown gates fail closed on every fresh read", async () => {
  const changes = [{ is_sensitive: true }, { is_document: true }, { is_duplicate: true }, { is_superseded: true },
    { vision_gate_status: "pending" }, { vision_gate_status: null }, { user_id: stranger },
    { file_hash: "f".repeat(64) }, { created_at: "2025-01-01T00:00:00.000002Z" },
    { taken_at: "2024-12-31T00:00:00.222334Z" }, { image_url: "https://other.invalid/replacement.jpg" }];
  for (const change of changes) {
    const db = new FixtureDB(fixture(2));
    equal((await readSubjectProfiles(db, owner)).subjects.length, 1);
    Object.assign(db.data.sources[1], change);
    const result = await readSubjectProfiles(db, owner);
    equal(result.subjects, []); equal(result.coverage.assessed, 2); equal(result.coverage.excluded, 2);
  }
});

Deno.test("unavailable anchor cannot fall back to another cover or leak its withdrawn URL", async () => {
  const data = fixture(3); data.sources[0].is_sensitive = true;
  const result = await readSubjectProfiles(new FixtureDB(data), owner);
  equal(result.subjects, []); equal(JSON.stringify(result).includes(data.sources[0].image_url), false);
});

Deno.test("partial source responses and competing current clusters cannot supply missing proof", async () => {
  const db = new FixtureDB(fixture(2)); db.omitSources.add(id(2));
  equal((await readSubjectProfiles(db, owner)).subjects, []);
  const data = fixture(2);
  data.observations.push({ ...clone(data.observations[1]), id: id(80000), cluster_id: id(800001) });
  equal((await readSubjectProfiles(new FixtureDB(data), owner)).subjects, []);
});

Deno.test("weak, contradictory or invalid primary-frame evidence never supplies an identity path", async () => {
  for (const kind of ["weak", "contradiction", "frame"]) {
    const data = fixture(2);
    for (const observation of data.observations) {
      const e = observation.confidence_basis.visual_subjects_v1.envelope;
      if (kind === "weak") e.subjects[0].correspondences[0].features = [
        { kind: "paint", left_witness: "red", right_witness: "red" },
        { kind: "background", left_witness: "shop", right_witness: "shop" }];
      if (kind === "contradiction") e.contradictions = [{ left_image_id: id(1), right_image_id: id(2), reason: "different identifier" }];
      if (kind === "frame") e.frames[0].primary_subject = "multiple";
    }
    equal((await readSubjectProfiles(new FixtureDB(data), owner)).subjects, []);
  }
});

Deno.test("owner scope applies to carriers, observations and live pictures", async () => {
  const db = new FixtureDB(fixture(2));
  equal((await readSubjectProfiles(db, stranger)).subjects, []);
  equal(db.calls.length, 1);
  const data = fixture(2);
  data.observations[1].confidence_basis.visual_subjects_v1.envelope.user_id = stranger;
  equal((await readSubjectProfiles(new FixtureDB(data), owner)).subjects, []);
});

Deno.test("carrier pagination caps24 subjects and advances independently of excluded observations", async () => {
  const data = fixture(2); data.carriers = []; data.observations = []; data.sources = [];
  for (let i = 0; i < 26; i++) {
    const a = source(100 + i * 2), b = source(101 + i * 2), c = id(810000 + i);
    const group = fixture(2); group.sources = [a, b];
    group.carriers[0].id = c;
    group.observations = [a, b].map((s, j) => ({ ...group.observations[j], id: id(20000 + i * 2 + j),
      image_id: s.id, cluster_id: c, confidence_basis: { visual_subjects_v1: { state: "active", anchor_image_id: a.id, envelope: envelope([a, b], a.id) } } }));
    data.sources.push(...group.sources); data.carriers.push(...group.carriers); data.observations.push(...group.observations);
  }
  const db = new FixtureDB(data), first = await readSubjectProfiles(db, owner, { limit: 100 });
  equal(first.subjects.length, 24); equal(first.next_offset, 24); equal(first.coverage.truncated, true);
  const last = await readSubjectProfiles(db, owner, { offset: first.next_offset! });
  equal(last.subjects.length, 2); equal(last.next_offset, null);
  equal(new Set([...first.subjects, ...last.subjects].map(subject => subject.id)).size, 26);
});

Deno.test("detail returns at most60 references and bounded evidence coverage instead of an initial count", async () => {
  const db = new FixtureDB(fixture(65));
  const result = await readSubjectProfiles(db, owner, { cluster_id: cluster });
  equal(result.subjects[0].images.length, 60); equal(result.subjects[0].image_count, 65);
  equal(result.subjects[0].coverage.truncated, true); equal(result.next_offset, null);
  equal(db.calls.reduce((sum, call) => sum + call.returned, 0) < 1000, true);
});

Deno.test("current observation and source reads stop at their bounded scope with truncation explicit", async () => {
  const data = fixture(300);
  data.observations[0].observed_at = "2025-02-01T00:00:01Z";
  const db = new FixtureDB(data), result = await readSubjectProfiles(db, owner, { cluster_id: cluster });
  equal(result.coverage.assessed, 256); equal(result.coverage.truncated, true);
  equal(result.subjects[0].image_count, 256); equal(result.subjects[0].images.length, 60);
  equal(db.calls.reduce((sum, call) => sum + call.returned, 0) < 1000, true);
});

Deno.test("terminal-head truncation cannot hide an older withdrawal behind newer producer versions", async () => {
  const data = fixture(2), anchor = clone(data.observations[0]);
  data.observations[1].observed_at = "2025-02-01T00:00:02Z";
  for (let i = 0; i < 255; i++) data.observations.push({ ...clone(anchor), id: id(100000 + i), agent_version: `version-${i}` });
  const withdrawal = clone(anchor); withdrawal.id = id(200000); withdrawal.is_active = false;
  withdrawal.observed_at = "2025-01-31T00:00:00Z";
  withdrawal.confidence_basis.visual_subjects_v1.state = "withdrawn";
  data.observations.push(withdrawal);
  const db = new FixtureDB(data), result = await readSubjectProfiles(db, owner);
  equal(result.subjects, []); equal(result.coverage.eligible, 0); equal(result.coverage.truncated, true);
  equal(db.calls.some(call => call.table === "vehicle_images"), false);
});

Deno.test("backend failures do not become zero coverage or return a stale cached profile", async () => {
  const db = new FixtureDB(fixture(2)); equal((await readSubjectProfiles(db, owner)).subjects.length, 1);
  db.failTable = "vehicle_images";
  let message = "";
  try { await readSubjectProfiles(db, owner); } catch (error) { message = (error as Error).message; }
  equal(message, "subject_sources_read_failed"); equal(message.includes("PRIVATE"), false);
});

Deno.test("exported replay qualification preserves exact clocks and rejects malformed derivative custody", () => {
  const data = fixture(2), row = data.observations[0], live = data.sources[0];
  const e = row.confidence_basis.visual_subjects_v1.envelope, input = e.inputs[0];
  equal(qualifyCurrentSubjectReading(row, live, owner, asOf) !== null, true);
  equal(qualifySubjectSource({ ...input, created_at: "2025-01-01T00:00:00.000002Z" }, live, owner, readAt), false);
  equal(qualifySubjectSource({ ...input, representation: "derivative", derivation: {} }, live, owner, readAt), false);
  const path = `vehicle-photos/${live.storage_path}`;
  const derivative = { ...input, representation: "derivative", input_sha256: "e".repeat(64), source_bytes_qualified: false,
    derivation_qualified: true, mime_type: "image/jpeg", byte_length: 200,
    input_url: `${origin}/storage/v1/render/image/public/${path}?width=1600&height=1600&resize=contain&quality=85`,
    derivation: { contract: "supabase_content_addressed_render_v1", trusted_origin: origin,
      source_object_path: path, render_path: `/storage/v1/render/image/public/${path}`,
      source_sha256: live.file_hash, input_sha256: "e".repeat(64), request_accept: "image/jpeg",
      source_mime_type: "image/heic", source_byte_length: 2000, source_captured_at: "2025-01-31T00:00:00Z",
      parameters: { width: 1600, height: 1600, resize: "contain", quality: 85 } } };
  equal(qualifySubjectSource(derivative, live, owner, readAt), true);
  equal(qualifySubjectSource({ ...derivative, derivation: { ...derivative.derivation, trusted_origin: "https://other.invalid" } }, live, owner, readAt), false);
});
