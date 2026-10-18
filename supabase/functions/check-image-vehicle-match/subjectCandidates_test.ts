import { projectResolutionContext, qualifiedUnresolvedFrame, selectResolutionContext } from "./subjectCandidates.ts";
import { projectDepictedSubjects, type SubjectInput } from "./subjects.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(9000), cluster = id(8000), as_of = "2025-03-01T00:00:00Z";
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function equal(a: unknown, b: unknown) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
const source = (n: number): any => ({ id: id(n), user_id: owner, image_url: `https://source.invalid/${n}.jpg`,
  file_hash: n.toString(16).padStart(64, "0"), created_at: "2025-01-01T00:00:00.000001Z", taken_at: null,
  vision_gate_status: "approved", is_superseded: false, is_duplicate: false, is_document: false, is_sensitive: false });
const input = (s: any): SubjectInput => ({ image_id: s.id, source_url: s.image_url, source_sha256: s.file_hash, input_sha256: s.file_hash,
  representation: "source", source_qualified: true, created_at: s.created_at, taken_at: null });
const frame = (image_id: string) => ({ image_id, medium: "photograph", primary_subject: "vehicle", view: "exterior", bbox: [0, 0, 1, 1] });
function raw(sources: any[], read = "2025-02-01T00:00:00Z"): any[] {
  const envelope = { user_id: owner, method: "visual_subjects_v1", provider: "fixture", model: "fixture", read_at: read,
    run_key: `${read}|${sources.map(s => s.id).join("|")}`, inputs: sources.map(input), frames: sources.map(s => frame(s.id)),
    subjects: [], unresolved: sources.map(s => ({ image_id: s.id, reason: "needs_corresponding_view" })) };
  return sources.map((s, i) => ({ id: id(100 + i), image_id: s.id, observed_by: "visual_subject_reading_v1",
    observed_at: read, is_active: true, superseded_by: null, confidence_basis: { visual_subject_reading_v1: { envelope } } }));
}
function state(sources: any[], readings = raw(sources)) {
  return { profiles: [] as any[], raw_readings: readings, membership_heads: [] as any[], sources,
    membership_complete: true, truncated: false, as_of };
}
function addProfile(s: ReturnType<typeof state>, anchor: any, peer: any) {
  s.profiles.push({ id: cluster, anchor_image_id: anchor.id, image_count: 2, images: [{ id: anchor.id }, { id: peer.id }] });
  const envelope = raw([anchor, peer])[0].confidence_basis.visual_subject_reading_v1.envelope;
  s.membership_heads.push({ image_id: anchor.id, observed_by: "visual_subjects_v1", cluster_id: cluster,
    is_active: true, superseded_by: null, confidence_basis: { visual_subjects_v1: { state: "active", anchor_image_id: anchor.id, envelope } } });
}
const edge = (a: string, b: string) => ({ left_image_id: a, right_image_id: b, features: ["body_geometry", "fixed_wear"].map(kind =>
  ({ kind, left_witness: "particular seam and fixed scar", right_witness: "corresponding seam and fixed scar" })) });

Deno.test("two interleaved unknown cars survive as context and can each acquire independent support", () => {
  const [a1, b1, a2, b2] = [1, 2, 3, 4].map(source);
  const bootstrap = projectDepictedSubjects({ frames: [a1, b1].map(s => frame(s.id)) }, [a1, b1].map(input));
  equal(bootstrap.subjects, []);
  const s = state([a1, b1, a2, b2], raw([a1, b1]));
  const aContext = projectResolutionContext(owner, a2.id, s);
  equal([...aContext.image_ids].sort(), [a1.id, b1.id]); equal(aContext.coverage.fresh_batch_size, 1);
  const aResult = projectDepictedSubjects({ frames: [a2, a1, b1].map(s => frame(s.id)), correspondences: [edge(a2.id, a1.id)] }, [a2, a1, b1].map(input));
  equal(aResult.subjects[0].member_image_ids, [a1.id, a2.id]);
  addProfile(s, a1, a2);
  const bContext = projectResolutionContext(owner, b2.id, s);
  equal([...bContext.image_ids].sort(), [a1.id, b1.id]);
  const bInputs = [input(b2), { ...input(a1), existing_cluster_id: cluster, existing_anchor_image_id: a1.id }, input(b1)];
  const bResult = projectDepictedSubjects({ frames: [b2, a1, b1].map(s => frame(s.id)), correspondences: [edge(b2.id, b1.id)] }, bInputs);
  equal(bResult.subjects[0].member_image_ids, [b1.id, b2.id]); equal(bResult.subjects[0].existing_cluster_id, null);
});

Deno.test("a fresh photo plus unresolved same-car photo also sees its supported anchor and preserves profile ID", () => {
  const [anchor, peer, unresolved, fresh] = [1, 2, 3, 4].map(source), s = state([anchor, peer, unresolved, fresh], raw([unresolved]));
  addProfile(s, anchor, peer);
  const r = projectResolutionContext(owner, fresh.id, s);
  equal(r.image_ids, [anchor.id, unresolved.id]);
  const inputs = [input(fresh), { ...input(anchor), existing_cluster_id: cluster, existing_anchor_image_id: anchor.id }, input(unresolved)];
  const projection = projectDepictedSubjects({ frames: inputs.map(i => frame(i.image_id)),
    correspondences: [edge(fresh.id, unresolved.id), edge(unresolved.id, anchor.id)] }, inputs);
  equal(projection.subjects.length, 1); equal(projection.subjects[0].existing_cluster_id, cluster);
  equal(projection.subjects[0].anchor_image_id, anchor.id);
});

Deno.test("withdrawn or already assigned frames never return through the unresolved retrieval path", () => {
  for (const active of [true, false]) {
    const [candidate, fresh] = [1, 2].map(source), s = state([candidate, fresh], raw([candidate]));
    s.membership_heads.push({ image_id: candidate.id, observed_by: "visual_subjects_v1", is_active: active,
      superseded_by: null, confidence_basis: { visual_subjects_v1: { state: active ? "active" : "withdrawn" } } });
    equal(projectResolutionContext(owner, fresh.id, s).image_ids, []);
  }
});

Deno.test("raw proposed support whose cluster writes all failed remains an unbound retrieval candidate", () => {
  const [candidate, peer, fresh] = [1, 2, 3].map(source), s = state([candidate, peer, fresh], raw([candidate, peer]));
  for (const row of s.raw_readings) {
    const e = row.confidence_basis.visual_subject_reading_v1.envelope;
    e.unresolved = []; e.subjects = [{ anchor_image_id: candidate.id, member_image_ids: [candidate.id, peer.id] }];
  }
  equal(projectResolutionContext(owner, fresh.id, s).image_ids.length, 2);
  s.membership_heads.push({ image_id: candidate.id, observed_by: "visual_subjects_v1", is_active: false,
    superseded_by: null, confidence_basis: { visual_subjects_v1: { state: "withdrawn" } } });
  equal(projectResolutionContext(owner, fresh.id, s).image_ids, [peer.id]);
});

Deno.test("current source changes and per-frame ambiguity reject retained context without inherited labels", () => {
  const changes = [{ is_sensitive: true }, { is_document: true }, { vision_gate_status: "pending" },
    { created_at: "2025-01-01T00:00:00.000002Z" }, { file_hash: "f".repeat(64) }, { user_id: id(9999) }];
  for (const change of changes) {
    const sources = [1, 2].map(source), s = state(sources, raw([sources[0]])); Object.assign(sources[0], change);
    equal(projectResolutionContext(owner, sources[1].id, s).image_ids, []);
  }
  for (const change of [{ primary_subject: "multiple" }, { view: "detail" }, { medium: "other" }, { bbox: [0, 0, 0, 1] }]) {
    const candidate = source(1), row = raw([candidate])[0]; Object.assign(row.confidence_basis.visual_subject_reading_v1.envelope.frames[0], change);
    equal(qualifiedUnresolvedFrame(row, candidate, owner, as_of), false);
  }
});

Deno.test("scope truncation cannot imply membership absence; missing or repeated bytes do not spend a view", () => {
  const [candidate, fresh] = [1, 2].map(source), s = state([candidate, fresh], raw([candidate]));
  s.membership_complete = false; equal(projectResolutionContext(owner, fresh.id, s).image_ids, []);
  s.membership_complete = true; s.sources = [fresh]; equal(projectResolutionContext(owner, fresh.id, s).image_ids, []);
  const sameBytes = clone(candidate); sameBytes.id = id(3); s.sources = [candidate, sameBytes];
  equal(projectResolutionContext(owner, sameBytes.id, s).image_ids, []);
});

Deno.test("least-exposed rotation is bounded retrieval rather than a color/time identity assertion", () => {
  const sources = [1, 2, 3, 4, 5].map(source), s = state(sources, raw(sources.slice(0, 4)));
  s.raw_readings.push(...raw([sources[0]], "2025-02-02T00:00:00Z"));
  const r = projectResolutionContext(owner, sources[4].id, s);
  equal(r.image_ids.length, 2); equal(r.image_ids.includes(sources[0].id), false);
  equal(r.coverage.truncated, true); equal(r.coverage.global_novelty_asserted, false);
  equal(JSON.stringify(r).includes("make"), false);
});

class DB {
  calls: Array<{ table: string; returned: number; filters: Array<[string, string, any]> }> = [];
  constructor(public observations: any[], public sources: any[]) {}
  from(table: string) { return new Query(this, table); }
}
class Query {
  filters: Array<[string, string, any]> = []; orders: Array<[string, boolean]> = []; start = 0; end = Infinity;
  constructor(private db: DB, private table: string) {}
  select(_s: string) { return this; } eq(k: string, v: any) { this.filters.push(["eq", k, v]); return this; }
  is(k: string, v: any) { this.filters.push(["is", k, v]); return this; } in(k: string, v: any) { this.filters.push(["in", k, v]); return this; }
  order(k: string, o: any) { this.orders.push([k, o.ascending]); return this; } limit(n: number) { this.end = n - 1; return this; }
  range(a: number, b: number) { this.start = a; this.end = b; return this; }
  then(resolve: (value: any) => any, reject: (reason: any) => any) {
    const data = this.table === "image_observations" ? this.db.observations : this.table === "vehicle_images" ? this.db.sources : [];
    const rows = data.filter(row => this.filters.every(([op, k, v]) => {
      const got = k.split(/->>?/).reduce((value, key) => value?.[key], row);
      return op === "in" ? v.includes(got) : op === "is" ? got === null || got === undefined : got === v;
    })).sort((a, b) => {
      for (const [k, asc] of this.orders) if (a[k] !== b[k]) return (a[k] < b[k] ? -1 : 1) * (asc ? 1 : -1);
      return 0;
    }).slice(this.start, this.end + 1);
    this.db.calls.push({ table: this.table, returned: rows.length, filters: this.filters });
    return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
  }
}

Deno.test("database selector owner-scopes evidence, limits retained sources and rechecks withdrawals on the next call", async () => {
  const sources = Array.from({ length: 40 }, (_, i) => source(i + 1)), fresh = source(1000);
  const stranger = source(99), privateRows = raw([stranger]);
  privateRows[0].confidence_basis.visual_subject_reading_v1.envelope.user_id = id(9999);
  const db = new DB([...sources.flatMap(s => raw([s])), ...privateRows], [...sources, fresh, stranger]);
  const first = await selectResolutionContext(db, owner, fresh.id);
  equal(first.image_ids.length, 2); equal(first.coverage.truncated, true); equal(first.image_ids.includes(stranger.id), false);
  const selected = first.image_ids[0];
  db.observations.push({ image_id: selected, observed_by: "visual_subjects_v1", observed_at: "2025-02-02T00:00:00Z",
    is_active: false, superseded_by: null, confidence_basis: { visual_subjects_v1: { state: "withdrawn", envelope: { user_id: owner } } } });
  const second = await selectResolutionContext(db, owner, fresh.id);
  equal(second.image_ids.includes(selected), false);
  equal(db.calls.filter(c => c.table === "vehicle_images").every(c => c.filters.some(f => f[1] === "user_id" && f[2] === owner)), true);
  equal(db.calls.reduce((n, c) => n + c.returned, 0) < 1000, true);
});
