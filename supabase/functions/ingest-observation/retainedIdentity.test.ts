import { ingestRetainedIdentity, retainedIdentitySelector, retainedIdentityTupleHash, RETAINED_IDENTITY_MODE, RetainedIdentityConflict, type RetainedIdentityStore } from "./retainedIdentity.ts";
function assert(value: unknown) { if (!value) throw new Error("assertion failed"); }
const sourceId = "11111111-1111-4111-8111-111111111111";
const original: any = { id: sourceId, vehicle_id: "22222222-2222-4222-8222-222222222222", platform: "bat",
  author_username: "abc123", bat_author_id: 123, source_url: "https://bringatrailer.com/listing/synthetic/",
  posted_at: "2026-10-01T00:00:00.123456Z", created_at: "2026-10-05T00:00:00.234567Z", content_hash: "a".repeat(64),
  external_identity_id: null, author_external_identity_id: null };
function fixture(options: { existing?: any[]; concurrent?: any; source?: any; comments?: any[]; private?: boolean; changeSource?: boolean } = {}) {
  const source = structuredClone(options.source ?? original), rows = structuredClone(options.existing ?? []);
  let writes = 0, profiles = 0, reads = 0;
  const store: RetainedIdentityStore = {
    async readSource() { reads++; return structuredClone(options.changeSource && reads > 1 ? { ...source, created_at: "2026-10-05T00:00:00.234568Z" } : source); },
    async publicVehicle() { return !options.private; },
    async accountComments() { return options.comments ?? [{ bat_author_id: 123 }]; },
    async find(handles) { return structuredClone(rows.filter((r: any) => handles.includes(r.handle))); },
    async insertMissing(items) { writes++; rows.push(options.concurrent ?? { id: "canonical-id", ...items[0] }); },
    async refreshProfile() { profiles++; },
  };
  return { store, source, rows, counts: () => ({ writes, profiles }) };
}
async function refuses(options: Parameters<typeof fixture>[0]) {
  const f = fixture(options); let refused = false;
  try { await ingestRetainedIdentity(f.store, sourceId); } catch (error) { refused = error instanceof RetainedIdentityConflict; }
  assert(refused); assert(f.counts().profiles === 0); return f;
}
Deno.test("selector admits only source UUID and mode, no caller testimony or identity", () => {
  assert(retainedIdentitySelector({ mode: RETAINED_IDENTITY_MODE, source_comment_id: sourceId }) === sourceId);
  for (const key of ["handle", "publisher_id", "identity_id", "source_hash", "structured_data"])
    assert(retainedIdentitySelector({ mode: RETAINED_IDENTITY_MODE, source_comment_id: sourceId, [key]: "forged" }) === null);
});
Deno.test("canonical account preserves source with explicitly untyped citation and separate clocks", async () => {
  const f = fixture(), before = JSON.stringify(f.source);
  const r = await ingestRetainedIdentity(f.store, sourceId);
  assert(r.identity_id === "canonical-id" && f.counts().writes === 1);
  assert(JSON.stringify(f.source) === before && f.source.external_identity_id === null);
  assert(r.source_lineage === "untyped_metadata_citation" && r.source_citation.source_comment_id === sourceId);
  assert(r.source_citation.source_recorded_at === original.created_at && r.source_citation.source_event_at === original.posted_at);
  assert(!("observation_input" in r) && r.person_identity === "unknown");
  assert(f.rows[0].metadata.retained_bat_source_account.source_hash === original.content_hash);
  assert(f.rows[0].metadata.retained_bat_source_account.source_event_at_basis === "retained_posted_at");
  assert(r.source_citation.source_event_clock_origin === "unknown_legacy_fallback_possible");
  const replay = await ingestRetainedIdentity(f.store, sourceId);
  assert(replay.identity_id === r.identity_id && f.counts().writes === 1 && replay.insert_attempted === false);
});
Deno.test("existing same-handle identity and claims preserved, concurrent winner read back", async () => {
  const existing = { id: "existing", handle: "abc123", claimed_by_user_id: "owner", metadata: { bat_author_id: 123, keep: "claim" } };
  const f = fixture({ existing: [existing] }), before = JSON.stringify(f.rows);
  assert((await ingestRetainedIdentity(f.store, sourceId)).identity_id === "existing");
  assert(f.counts().writes === 0 && JSON.stringify(f.rows) === before);
  const race = fixture({ concurrent: { ...existing, id: "concurrent-winner" } });
  assert((await ingestRetainedIdentity(race.store, sourceId)).identity_id === "concurrent-winner");
  assert(race.rows[0].metadata.keep === "claim");
});
Deno.test("known ID conflicts and ambiguous aliases rejected, including concurrent conflict", async () => {
  await refuses({ existing: [{ id: "conflict", handle: "abc123", metadata: { bat_author_id: 124 } }] });
  await refuses({ existing: [{ id: "alias", handle: "ABC123", metadata: {} }] });
  await refuses({ comments: [{ bat_author_id: 124 }] });
  await refuses({ source: { ...original, external_identity_id: "unmatched-source-identity" } });
  await refuses({ concurrent: { id: "conflict", handle: "abc123", metadata: { retained_bat_source_account: { publisher_author_id: 124 } } } });
});
Deno.test("unknown namespace/author/clocks, private parents and replay overflow refuse without mint", async () => {
  for (const patch of [{ platform: "carsandbids" }, { author_username: "Unknown" }, { author_username: "anonymous" },
    { bat_author_id: 0 }, { bat_author_id: null }, { posted_at: "unknown" }, { created_at: "unknown" },
    { source_url: "https://example.test/listing/synthetic" }, { content_hash: "not-a-source-hash" }]) {
    const f = await refuses({ source: { ...original, ...patch } }); assert(f.counts().writes === 0);
  }
  assert((await refuses({ private: true })).counts().writes === 0);
  assert((await refuses({ comments: Array.from({ length: 1001 }, () => ({ bat_author_id: 123 })) })).counts().writes === 0);
});
Deno.test("microsecond source drift withholds profile replay and is never treated as complete delivery", async () => {
  await refuses({ changeSource: true });
  assert(await retainedIdentityTupleHash(original) !== await retainedIdentityTupleHash({ ...original, created_at: "2026-10-05T00:00:00.234568Z" }));
});
