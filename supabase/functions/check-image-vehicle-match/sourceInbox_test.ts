import { projectSourceInbox, readSourceInbox, type SourceInboxState } from "./sourceInbox.ts";
import { observationClockMicroseconds as clock } from "../_shared/observationContentHash.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(9000), other = id(9001), origin = "https://qkgaybvrernstplzjaam.supabase.co";
const readAt = "2026-10-02T00:00:00.123456Z", asOf = "2026-10-03T00:00:00Z";
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
function source(n: number): any {
  const file_hash = n.toString(16).padStart(64, "0"), storage_path = `users/${owner}/capture-relay/${file_hash}/IMG_${n}.HEIC`;
  return { id: id(n), user_id: owner, storage_path, file_hash, image_url: `${origin}/storage/v1/object/public/vehicle-photos/${storage_path}`,
    created_at: "2026-10-01T00:00:00.000001Z", taken_at: null, vehicle_id: null,
    is_superseded: false, is_duplicate: false, is_document: false, is_sensitive: false, vision_gate_status: "approved" };
}
function readings(sources: any[]): any[] {
  const envelope = { user_id: owner, method: "visual_subjects_v1", provider: "offline-fixture", model: "offline-fixture",
    run_key: "fixture-reading", read_at: readAt,
    inputs: sources.map(s => ({ image_id: s.id, source_url: s.image_url, source_sha256: s.file_hash, input_sha256: s.file_hash,
      source_qualified: true, representation: "source", created_at: s.created_at, taken_at: s.taken_at })),
    frames: sources.map(s => ({ image_id: s.id, medium: "photograph", primary_subject: "unknown", view: "unknown", bbox: null })),
    subjects: [], unresolved: sources.map(s => ({ image_id: s.id, reason: "primary_subject_unqualified" })) };
  return sources.map((s, i) => ({ id: id(100 + i), image_id: s.id, vehicle_id: null, cluster_id: null, role: "part",
    observed_by: "visual_subject_reading_v1", agent_version: "visual_subject_reading_v1", observed_at: readAt,
    is_active: true, superseded_by: null,
    confidence_basis: { visual_subject_reading_v1: { state: "active", input_key: "a".repeat(32), envelope: clone(envelope) } } }));
}
function fixture(count = 2, read = true): SourceInboxState {
  const sources = Array.from({ length: count }, (_, i) => source(i + 1));
  return { page: clone(sources), sources, raw_heads: read && count >= 2 ? readings(sources) : [], membership_heads: [],
    raw_heads_complete: true, membership_heads_complete: true, dependencies_complete: true, page_more: false, as_of: asOf };
}
const raw = (row: any) => row.confidence_basis.visual_subject_reading_v1;

Deno.test("one newly uploaded source stays visible before any same-car profile or model reading exists", () => {
  const state = fixture(1, false), result = projectSourceInbox(owner, state);
  equal(result.photos.length, 1); equal(result.photos[0].image_url, (state.sources[0] as any).image_url);
  equal(result.photos[0].subject_analysis_state, "not_read"); equal(result.photos[0].identity, null);
  equal(result.photos[0].grain, "source_photo"); equal(result.photos[0].grouping_asserted, false);
  equal(result.photos[0].taken_at, null); equal(result.coverage.inference_started, false);
  equal(result.coverage.account_total, null); equal(result.coverage.accessible_device_library_total, null);
});

Deno.test("all-unknown protected readings preserve separate source photos and attributed reasons", () => {
  const result = projectSourceInbox(owner, fixture());
  equal(result.photos.map(photo => photo.id), [id(1), id(2)]);
  for (const photo of result.photos) {
    equal(photo.identity, null); equal(photo.grouping_asserted, false);
    equal(photo.subject_analysis_state, "current_readings"); equal(photo.readings[0].frame?.primary_subject, "unknown");
    equal(photo.readings[0].unresolved_reasons, ["primary_subject_unqualified"]);
    equal(photo.readings[0].provider, "offline-fixture"); equal(photo.readings[0].read_at, readAt);
  }
});

Deno.test("historical and currently attached photos do not disappear behind an orphan-only filter", () => {
  const state = fixture(1, false), source = state.sources[0] as any;
  source.vehicle_id = id(8000); state.page = [clone(source)];
  const result = projectSourceInbox(owner, state);
  equal(result.photos.length, 1); equal(result.photos[0].attached_vehicle_id_context, id(8000));
  equal(result.photos[0].identity, null); equal(result.photos[0].membership_state, "none_recorded");
});

Deno.test("unknown and detail frames remain visible even though they cannot anchor context retrieval", () => {
  const state = fixture();
  for (const row of state.raw_heads as any[]) for (const frame of raw(row).envelope.frames) frame.view = "detail";
  const result = projectSourceInbox(owner, state);
  equal(result.photos.map(photo => photo.subject_analysis_state), ["current_readings", "current_readings"]);
  equal(result.photos[0].readings[0].frame?.view, "detail");
});

Deno.test("later source withdrawals and privacy holds suppress pixels and retained interpretations", () => {
  for (const patch of [{ is_superseded: true }, { is_duplicate: true }, { is_document: true }, { is_sensitive: true },
    { vision_gate_status: "pending" }, { vision_gate_status: "rejected_personal" }]) {
    const state = fixture(); Object.assign(state.sources[0] as any, patch);
    const result = projectSourceInbox(owner, state), photo = result.photos[0];
    equal(photo.image_url, null); equal(photo.readings, []);
    equal(result.photos[1].image_url !== null, true); equal(result.photos[1].readings, []);
  }
});

Deno.test("metadata-only historic rows preserve unknown provenance without calling them personal or analyzed", () => {
  const state = fixture(1, false), source = state.sources[0] as any;
  Object.assign(source, { image_url: "", storage_path: null, file_hash: null, ai_processing_status: "skipped", vision_gate_status: null });
  state.page = [clone(source)];
  const photo = projectSourceInbox(owner, state).photos[0];
  equal(photo.source_state, "metadata_only"); equal(photo.source_reason, "pixels_not_retained_reason_unknown");
  equal(photo.image_url, null); equal(photo.subject_analysis_state, "not_read"); equal(photo.readings, []);
});

Deno.test("microsecond source-clock changes invalidate readings without losing the retained source card", () => {
  const state = fixture(); (state.sources[0] as any).created_at = "2026-10-01T00:00:00.000002Z";
  const result = projectSourceInbox(owner, state);
  equal(result.photos[0].image_url !== null, true); equal(result.photos[0].readings, []);
  equal(result.photos[0].created_at, "2026-10-01T00:00:00.000002Z");
  equal(result.photos[0].subject_analysis_state, "reading_no_longer_qualified");
});

Deno.test("a changed locator uses the current own source and never presents its old reading", () => {
  const state = fixture(), changed = source(9); changed.id = id(1); state.sources[0] = changed;
  const photo = projectSourceInbox(owner, state).photos[0];
  equal(photo.image_url, changed.image_url); equal(photo.source_sha256, changed.file_hash); equal(photo.readings, []);
});

Deno.test("terminal withdrawal cannot resurrect the older active raw reading", () => {
  const state = fixture(), previous = clone(state.raw_heads[0]) as any, withdrawn = state.raw_heads[0] as any;
  previous.superseded_by = id(300); withdrawn.id = id(300); withdrawn.is_active = false; raw(withdrawn).state = "withdrawn";
  state.raw_heads.push(previous);
  const photo = projectSourceInbox(owner, state).photos[0];
  equal(photo.readings, []); equal(photo.subject_analysis_state, "reading_withdrawn"); equal(photo.image_url !== null, true);
});

Deno.test("independent reading contexts remain attributed alternatives rather than a merged identity", () => {
  const state = fixture(), alternative = clone(state.raw_heads[0]) as any;
  alternative.id = id(300); raw(alternative).input_key = "b".repeat(32);
  raw(alternative).envelope.frames[0].primary_subject = "vehicle";
  state.raw_heads.push(alternative);
  const photo = projectSourceInbox(owner, state).photos[0];
  equal(photo.readings.map(reading => reading.frame?.primary_subject), ["unknown", "vehicle"]);
  equal(photo.identity, null); equal(photo.grouping_asserted, false);
});

Deno.test("two conflicting terminal heads for the same exact input context do not select a favorite", () => {
  const state = fixture(), otherHead = clone(state.raw_heads[0]) as any;
  otherHead.id = id(300); state.raw_heads.push(otherHead);
  equal(projectSourceInbox(owner, state).photos[0].readings, []);
});

Deno.test("foreign account carriers and dependencies never supply source pixels or model readings", () => {
  const state = fixture(), foreign = source(3); foreign.user_id = other; foreign.image_url = "https://private.invalid/foreign-secret";
  state.page.push(foreign); state.sources.push(foreign);
  (state.sources[0] as any).user_id = other;
  const result = projectSourceInbox(owner, state);
  equal(result.photos.length, 2); equal(result.photos[0].image_url, null); equal(result.photos[1].readings, []);
  equal(JSON.stringify(result).includes("foreign-secret"), false);
});

Deno.test("incomplete correction/dependency scopes remain unassessed rather than empty successful analysis", () => {
  for (const key of ["raw_heads_complete", "dependencies_complete"] as const) {
    const state = fixture(); state[key] = false;
    const result = projectSourceInbox(owner, state);
    equal(result.photos[0].subject_analysis_state, "not_assessed"); equal(result.photos[0].readings, []);
    equal(result.coverage.truncated, true);
  }
  const state = fixture(); state.membership_heads_complete = false;
  equal(projectSourceInbox(owner, state).photos[0].membership_state, "not_assessed");
});

Deno.test("legacy filename-addressed objects retain an explicit unresolved card without asserting current bytes", () => {
  const state = fixture(1, false), current = state.sources[0] as any;
  current.storage_path = `users/${owner}/capture-relay/IMG_1.HEIC`;
  current.image_url = `${origin}/storage/v1/object/public/vehicle-photos/${current.storage_path}`;
  const photo = projectSourceInbox(owner, state).photos[0];
  equal(photo.image_url, null); equal(photo.source_reason, "source_locator_unpinned"); equal(photo.identity, null);
});

Deno.test("source-page and missing-current-row coverage cannot become an account or library total", () => {
  const state = fixture(1, false); state.sources = []; state.page_more = true;
  const result = projectSourceInbox(owner, state);
  equal(result.photos.length, 1); equal(result.photos[0].source_reason, "source_current_row_unavailable");
  equal(result.photos[0].image_url, null); equal(result.coverage.truncated, true); equal(result.coverage.account_total, null);
  let refused = false; try { projectSourceInbox(owner, { ...fixture(), page: Array.from({ length: 25 }, () => source(1)) }); } catch { refused = true; }
  equal(refused, true);
});

Deno.test("membership withdrawal does not let an earlier raw interpretation recreate a same-car profile", () => {
  const state = fixture(); state.membership_heads = [{ image_id: id(1), observed_by: "visual_subjects_v1", superseded_by: null,
    is_active: false, confidence_basis: { visual_subjects_v1: { state: "withdrawn" } } }];
  const photo = projectSourceInbox(owner, state).photos[0];
  equal(photo.membership_state, "withdrawn_or_conflicting"); equal(photo.grouping_asserted, false);
  equal(photo.identity, null); equal(photo.readings.length, 1);
});

Deno.test("dependency budget covers all 96 readings of three inputs and refuses larger source scope", () => {
  const state = fixture(1, false); state.sources = Array.from({ length: 312 }, (_, i) => source(i + 1));
  equal(projectSourceInbox(owner, state).photos.length, 1);
  state.sources.push(source(313));
  let refused = false; try { projectSourceInbox(owner, state); } catch { refused = true; }
  equal(refused, true);
});

Deno.test("trusted HEIC normalization preserves both the source and consumed JPEG hashes", () => {
  const state = fixture(), source = state.sources[0] as any, normalizedHash = "f".repeat(64);
  for (const row of state.raw_heads as any[]) {
    const input = raw(row).envelope.inputs[0], source_object_path = `vehicle-photos/${source.storage_path}`;
    Object.assign(input, { representation: "derivative", source_bytes_qualified: false, derivation_qualified: true,
      input_sha256: normalizedHash, mime_type: "image/jpeg", byte_length: 100,
      input_url: `${origin}/storage/v1/render/image/public/${source_object_path}?width=1600&height=1600&resize=contain&quality=85`,
      derivation: { contract: "supabase_content_addressed_render_v1", trusted_origin: origin, source_object_path,
        render_path: `/storage/v1/render/image/public/${source_object_path}`, parameters: { width: 1600, height: 1600, resize: "contain", quality: 85 },
        request_accept: "image/jpeg", source_sha256: source.file_hash, input_sha256: normalizedHash,
        source_mime_type: "image/heic", source_byte_length: 100, source_captured_at: readAt } });
  }
  const photo = projectSourceInbox(owner, state).photos[0];
  equal(photo.readings[0].input, { source_sha256: source.file_hash, input_sha256: normalizedHash, representation: "derivative" });
  (state.raw_heads[0] as any).confidence_basis.visual_subject_reading_v1.envelope.inputs[0].input_sha256 = "e".repeat(64);
  equal(projectSourceInbox(owner, state).photos[0].readings, []);
});

class FixtureDB {
  calls: Array<{ table: string; filters: Array<[string, string, any]>; limit: number }> = [];
  fail: string | null = null;
  afterCarrier: (() => void) | null = null;
  constructor(public state: SourceInboxState) {}
  from(table: string) { return new FixtureQuery(this, table); }
}
class FixtureQuery {
  filters: Array<[string, string, any]> = [];
  orders: Array<[string, boolean]> = [];
  bound = Infinity;
  constructor(private db: FixtureDB, private table: string) {}
  select(_columns: string) { return this; }
  eq(field: string, value: any) { this.filters.push(["eq", field, value]); return this; }
  is(field: string, value: any) { this.filters.push(["is", field, value]); return this; }
  lt(field: string, value: any) { this.filters.push(["lt", field, value]); return this; }
  in(field: string, value: any) { this.filters.push(["in", field, value]); return this; }
  or(expression: string) { this.filters.push(["or", "", expression]); return this; }
  order(field: string, opts: { ascending: boolean }) { this.orders.push([field, opts.ascending]); return this; }
  limit(count: number) { this.bound = count; return this; }
  then(resolve: (v: any) => unknown, reject: (v: any) => unknown) {
    const value = (row: any, field: string) => field.split(/->>?/).reduce((current, key) => current?.[key], row);
    const data = this.table === "vehicle_images" ? this.db.state.sources : [...this.db.state.raw_heads, ...this.db.state.membership_heads];
    const found = data.filter((row: any) => this.filters.every(([op, field, expected]) => {
      const got = value(row, field);
      if (op === "or") {
        const match = /created_at\.lt\."([^"]+)".*id\.lt\.([^),]+)/.exec(expected)!;
        return row.created_at === null || clock(row.created_at)! < clock(match[1])! ||
          clock(row.created_at) === clock(match[1]) && row.id < match[2];
      }
      return op === "in" ? expected.includes(got) : op === "lt" ? got < expected : got === expected;
    })).sort((left: any, right: any) => {
      for (const [field, ascending] of this.orders) {
        if (left[field] === right[field]) continue;
        if (left[field] === null) return 1;
        if (right[field] === null) return -1;
        return (left[field] < right[field] ? -1 : 1) * (ascending ? 1 : -1);
      }
      return 0;
    }).slice(0, this.bound);
    this.db.calls.push({ table: this.table, filters: this.filters, limit: this.bound });
    const snapshot = clone(found);
    if (this.table === "vehicle_images" && !this.filters.some(([op]) => op === "in")) this.db.afterCarrier?.();
    return Promise.resolve({ data: this.db.fail === this.table ? null : snapshot,
      error: this.db.fail === this.table ? { message: "private backend detail" } : null }).then(resolve, reject);
  }
}

Deno.test("owner source reader pages historical and filed rows without inference or writer capabilities", async () => {
  const state = fixture(3); (state.sources[1] as any).vehicle_id = id(8000);
  const db = new FixtureDB(state), first = await readSourceInbox(db, owner, { limit: 2 });
  equal(first.photos.map(photo => photo.id), [id(3), id(2)]); equal(first.next_cursor !== null, true);
  equal(first.photos[1].attached_vehicle_id_context, id(8000));
  const last = await readSourceInbox(db, owner, { limit: 2, cursor: first.next_cursor! });
  equal(last.photos.map(photo => photo.id), [id(1)]); equal(last.next_cursor, null);
  equal(db.calls.every(call => ["vehicle_images", "image_observations"].includes(call.table)), true);
  equal(db.calls.filter(call => call.table === "vehicle_images").every(call => call.filters.some(([op, field, v]) => op === "eq" && field === "user_id" && v === owner)), true);
  equal(db.calls.some(call => call.filters.some(([, field]) => field === "vehicle_id")), false);
  equal(first.coverage.inference_started, false);
});

Deno.test("an opaque held source is still a pagination carrier rather than false exhaustion", async () => {
  const state = fixture(3); (state.sources[2] as any).vision_gate_status = "pending";
  const db = new FixtureDB(state), first = await readSourceInbox(db, owner, { limit: 1 });
  equal(first.photos[0].id, id(3)); equal(first.photos[0].image_url, null); equal(first.next_cursor !== null, true);
  const second = await readSourceInbox(db, owner, { limit: 1, cursor: first.next_cursor! });
  equal(second.photos[0].id, id(2));
});

Deno.test("a live withdrawal between carrier and dependency reads wins before pixels reach the consumer", async () => {
  const db = new FixtureDB(fixture());
  db.afterCarrier = () => { (db.state.sources[1] as any).is_sensitive = true; };
  const result = await readSourceInbox(db, owner);
  equal(result.photos.find(photo => photo.id === id(2))?.image_url, null);
  equal(result.photos.flatMap(photo => photo.readings), []);
});

Deno.test("read failures and malformed keysets refuse rather than returning a successful empty inbox", async () => {
  for (const table of ["vehicle_images", "image_observations"]) {
    const db = new FixtureDB(fixture()); db.fail = table;
    let failed = false; try { await readSourceInbox(db, owner); } catch { failed = true; } equal(failed, true);
  }
  for (const cursor of ["injected,filter", btoa(JSON.stringify({ created_at: "2026-10-01T00:00:00Z),user_id.eq.other", id: id(1) }))]) {
    const db = new FixtureDB(fixture()); let refused = false;
    try { await readSourceInbox(db, owner, { cursor }); } catch { refused = true; }
    equal(refused, true); equal(db.calls, []);
  }
});

Deno.test("an exact source detail read stays owner-bound and returns no unsupported profile link", async () => {
  const result = await readSourceInbox(new FixtureDB(fixture()), owner, { image_id: id(1) });
  equal(result.photos.map(photo => photo.id), [id(1)]); equal(result.next_cursor, null);
  equal(result.photos[0].grouping_asserted, false); equal(result.photos[0].identity, null);
});

Deno.test("unknown ingestion clocks remain opaque carriers across the null-clock history frontier", async () => {
  const state = fixture(4, false); (state.sources[0] as any).created_at = null; (state.sources[1] as any).created_at = null;
  const db = new FixtureDB(state), seen: string[] = []; let cursor: string | undefined;
  for (let page = 0; page < 4; page++) {
    const read = await readSourceInbox(db, owner, { limit: 1, cursor });
    seen.push(...read.photos.map(photo => photo.id)); cursor = read.next_cursor ?? undefined;
    if (page >= 2) { equal(read.photos[0].image_url, null); equal(read.photos[0].created_at, null); }
  }
  equal(seen, [id(4), id(3), id(2), id(1)]); equal(cursor, undefined);
});

Deno.test("capped terminal-head lookup cannot masquerade as no retained reading for another photo", async () => {
  const state = fixture(), exemplar = state.raw_heads[0];
  state.raw_heads = Array.from({ length: 97 }, (_, index) => ({ ...clone(exemplar as any), id: id(300 + index) }));
  const result = await readSourceInbox(new FixtureDB(state), owner);
  equal(result.coverage.truncated, true);
  equal(result.photos.map(photo => photo.subject_analysis_state), ["not_assessed", "not_assessed"]);
  equal(result.photos.flatMap(photo => photo.readings), []);
});
