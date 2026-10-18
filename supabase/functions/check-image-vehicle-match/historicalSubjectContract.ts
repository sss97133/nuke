/** Disposable PG17 assay adapter. Executes the actual sanctioned SQL writers
 * and production TypeScript consumers; no network, source bytes or model calls.
 * Invoked only by test_source_lineage_consumers.sql inside run-db-contracts.sh. */
import { readSubjectReinspections } from "./subjectReinspection.ts";
import { captureVisionInputs, visionInputSHA256 } from "./inputCustody.ts";
import { readSubjectProfiles } from "./subjectReader.ts";
import { supabaseSubjectStore, resolveSubjectBatch } from "./subjectService.ts";
import { loadSourceIdentities, sourceIdentityLineage, currentIdentitySource } from "./sourceIdentity.ts";
import { hydrateSubjectPrivacy, subjectSourceFamily, subjectSourceCanEstablishPrivacy } from "./subjectPrivacy.ts";

const database = Deno.env.get("PGDATABASE"), socket = Deno.env.get("PGHOST");
if (database !== "dm_refinement_historical_subject_reinspection" || !(socket?.startsWith("/tmp/db-contracts.") || Deno.env.get("CI") === "true" && socket === "localhost" && Deno.env.get("PGUSER") === "postgres")) {
  throw new Error("requires the exact disposable local contract database/socket");
}
const psql = Deno.env.get("DB_CONTRACT_PSQL");
if (!psql?.startsWith("/") || !psql.endsWith("/psql")) throw new Error("requires the harness-selected installed psql binary");
const literal = (value: unknown) => value === null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
async function sql(query: string): Promise<any> {
  const result = await new Deno.Command(psql, { args: ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", query], stdout: "piped", stderr: "piped" }).output();
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
  const text = new TextDecoder().decode(result.stdout).trim(); return text ? JSON.parse(text) : null;
}
const allowedTables = new Set(["source_lineage_scenario", "vehicle_images", "reattribution_audit", "image_observations", "emergent_vehicle_clusters"]);
const path = (row: any, field: string) => field.split(/->>?/).reduce((value, key) => value?.[key], row);
class Query {
  filters: Array<(row: any) => boolean> = []; orders: Array<[string, boolean]> = []; start = 0; end = Infinity;
  constructor(private table: string) { if (!allowedTables.has(table)) throw new Error(`unexpected table ${table}`); }
  select(_columns: string) { return this; }
  eq(field: string, value: unknown) { this.filters.push(row => path(row, field) === value); return this; }
  is(field: string, _value: null) { this.filters.push(row => path(row, field) == null); return this; }
  in(field: string, values: unknown[]) { this.filters.push(row => values.includes(path(row, field))); return this; }
  or(expression: string) {
    const namespace = expression.includes("device_privacy_v1") ? "device_privacy_v1" : "visual_subjects_v1";
    this.filters.push(row => row.superseded_by === null || row.confidence_basis?.[namespace]?.state === "withdrawn"); return this;
  }
  order(field: string, options: { ascending: boolean }) { this.orders.push([field, options.ascending]); return this; }
  limit(value: number) { this.end = this.start + value - 1; return this; }
  range(start: number, end: number) { this.start = start; this.end = end; return this; }
  single() { return this.then(result => ({ ...result, data: result.data.length === 1 ? result.data[0] : null }), reason => { throw reason; }); }
  then(resolve: (result: any) => any, reject: (reason: unknown) => any) {
    return sql(`SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM public.${this.table} t`).then((rows: any[]) => ({
      data: rows.filter(row => this.filters.every(test => test(row))).sort((a, b) => {
        for (const [field, ascending] of this.orders) if (a[field] !== b[field]) return (a[field] < b[field] ? -1 : 1) * (ascending ? 1 : -1);
        return 0;
      }).slice(this.start, this.end + 1), error: null,
    })).then(resolve, reject);
  }
}
const client = {
  from: (table: string) => new Query(table),
  async rpc(name: string, args: Record<string, any>) {
    if (name !== "ingest_image_observation" && name !== "reattribute_observation") throw new Error(`unexpected RPC ${name}`);
    try {
      const parameters = Object.entries(args).map(([key, value]) => {
        if (!/^p_[a-z_]+$/.test(key)) throw new Error("unexpected argument");
        return `${key} => ${literal(typeof value === "object" && value !== null ? JSON.stringify(value) : value)}`;
      }).join(",");
      return { data: await sql(`SELECT to_jsonb(public.${name}(${parameters}))`), error: null };
    } catch (error) { return { data: null, error }; }
  },
};
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function equal(a: unknown, b: unknown, message: string) { assert(JSON.stringify(a) === JSON.stringify(b), `${message}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
const scenario = await sql("SELECT to_jsonb(s) FROM source_lineage_scenario s");
const owner: string = scenario.owner_id, originals: string[] = scenario.original_ids;
const before = await readSubjectProfiles(client, owner);
assert(before.subjects.length === 1 && before.subjects[0].image_count === 3, "initial real protected reader supports three photographs");
const cluster = before.subjects[0].id, anchor = before.subjects[0].anchor_image_id, leaves: string[] = [];
for (const original of originals) {
  const live = (await client.from("vehicle_images").select("*").eq("id", original)).data[0];
  const reason = { contract: "photo_unfile_review_v1", scope: "negative_vehicle_attribution", destination_identity_asserted: false,
    reason: "Synthetic negative attribution interpretation", reviewed_at: new Date().toISOString(),
    review_ref: "synthetic://historical-bridge", review_method: "synthetic_visual_interpretation", review_observer: "synthetic_assistant",
    expected: { user_id: live.user_id, old_vehicle_id: live.vehicle_id, source_sha256: live.file_hash,
      image_url: live.image_url, storage_path: live.storage_path, created_at: live.created_at, taken_at: live.taken_at } };
  const result = await client.rpc("reattribute_observation", { p_observation_type: "image", p_observation_id: original,
    p_target_vehicle_id: null, p_reason: JSON.stringify(reason), p_actor_user_id: owner });
  assert(!result.error && result.data.success, `actual NULL CAS writer: ${result.error}`); leaves.push(result.data.new_observation_id);
}
equal((await readSubjectProfiles(client, owner)).subjects, [], "pending leaves never inherit historical approval");
const pixels = new Map<string, Uint8Array>();
for (const n of [1, 2, 3]) { const bytes = new Uint8Array([255, 216, 255, n]); pixels.set(await visionInputSHA256(bytes), bytes); }
let modelCalls = 0, captureCalls = 0, fetches = 0;
const capturedScopes: string[][] = [];
const dependencies = {
  capturePrivacy: async (sources: any[]) => {
    captureCalls++; capturedScopes.push(sources.map(source => source.image_id));
    return await captureVisionInputs(sources, { fetch: async (url: any) => {
      assert(!String(url).includes("/render/"), "proof-only repair does not normalize an unsubmitted image");
      fetches++; const bytes = [...pixels].find(([hash]) => String(url).includes(hash))?.[1];
      assert(bytes, "only pinned synthetic original/render source is available");
      return new Response(bytes, { headers: { "Content-Type": "image/jpeg" } });
    } });
  },
  vision: async () => { modelCalls++; throw new Error("provider callback is forbidden for historical repair"); },
};
const store = supabaseSubjectStore(client), origin = "https://qkgaybvrernstplzjaam.supabase.co";
const page = await readSubjectReinspections(client, store, owner);
assert(page.candidates.length === 1, "bounded read-only candidate reaches current pending original IDs");
let candidate = page.candidates[0];
equal(candidate.pending_source_count, 3, "all three need independently current permission");
equal(candidate.inspect.length, 2, "at most two device originals offered per pass");
assert(page.next_offset !== null && page.coverage.truncated, "carrier continuation remains explicit");
equal([captureCalls, fetches, modelCalls], [0, 0, 0], "candidate view has no image/model access");
const native = (w: any) => ({ method: "device_privacy_v1", policy_version: 1, purpose: "own_private_visual_subjects", owner_user_id: owner,
  source_sha256: w.source_sha256, source_byte_length: pixels.get(w.source_sha256)!.length, observed_at: new Date().toISOString(),
  classifier_revision: 2, face_revision: 3, os_major: 26, classifier_completed: true, face_completed: true, pixels_eligible: true,
  clutter: false, personal: false, prominent_face: false, is_vehicle: true, max_core_confidence: 0.8, total_vehicle_confidence: 0.8,
  face_threshold: 0.045, labels: [{ identifier: "car", confidence: 0.8 }], decode: { contract: "imageio_thumbnail_512_v1", max_pixel: 512,
    orientation_applied: true, input_sha256: "b".repeat(64), width: 1, height: 1, byte_length: 4 } });
const request = (c: typeof candidate) => ({ user_id: owner, image_ids: c.image_ids, expected_source_hashes: c.expected_source_hashes,
  reuse_only: true, device_privacy_receipts: Object.fromEntries(c.inspect.map(w => [w.receipt_image_id, native(w)])) });
for (const mode of ["missing", "changed_input", "withdrawn", "malformed"]) {
  const guarded = { ...store, readings: async (ids: string[]) => {
    if (mode === "missing") return [];
    const rows = structuredClone(await store.readings(ids));
    for (const row of rows as any[]) {
      const raw = row.confidence_basis?.visual_subject_reading_v1;
      if (raw && mode === "changed_input") raw.envelope.inputs[0].source_sha256 = "f".repeat(64);
      if (raw && mode === "malformed") raw.envelope.subjects = [{}];
      if (mode === "withdrawn" && row.confidence_basis?.visual_subjects_v1) {
        row.is_active = false; row.confidence_basis.visual_subjects_v1.state = "withdrawn";
      }
    }
    return rows;
  } };
  const refused = await resolveSubjectBatch(guarded, request(candidate), origin, dependencies);
  assert(refused.status === "refused", `${mode} old scope remains held`);
  equal([captureCalls, fetches, modelCalls], [0, 0, 0], `${mode} reading refuses before source/model callbacks`);
}
const untouched = candidate.image_ids.filter(id => !candidate.inspect.some(w => w.receipt_image_id === id));
const partial = await resolveSubjectBatch(store, request(candidate), origin, dependencies);
assert(partial.status === "refused" && "refusal" in partial && partial.refusal === "source_privacy_partial" &&
  "reinspection_candidate" in partial && partial.reinspection_candidate, `first bounded progress: ${JSON.stringify(partial)}`);
equal(partial.persisted_image_ids, [], "privacy progress is not an analyzed/membership receipt");
equal(capturedScopes[0].length, 2, "only two originals captured on first pass");
assert(untouched.every(id => !capturedScopes[0].includes(id)), "third pending source is not fetched");
candidate = partial.reinspection_candidate;
equal([candidate.pending_source_count, candidate.inspect.length], [1, 1], "next pass offers just the third original");
equal((await readSubjectProfiles(client, owner)).subjects, [], "partial privacy proof cannot partially expose an unsupported profile");
const result = await resolveSubjectBatch(store, request(candidate), origin, dependencies);
assert(result.status === "cached" && "subjects" in result, `old paid scope reused after final permission: ${JSON.stringify(result)}`);
equal(capturedScopes.map(scope => scope.length), [2, 1], "two then one original across separate bounded passes");
equal([captureCalls, fetches, modelCalls], [2, 3, 0], "three exact originals, no renders or privacy/identity provider calls");
equal(result.input_image_ids, scenario.envelope.inputs.map((input: any) => input.image_id), "old model input IDs are immutable");
const profiles = await readSubjectProfiles(client, owner);
assert(profiles.subjects.length === 1 && profiles.subjects[0].id === cluster && profiles.subjects[0].anchor_image_id === anchor,
  "actual consumer keeps the original supported cluster and anchor");
equal(profiles.subjects[0].image_count, 3, "three original photographs remain three, not six aliases");
const current = (await client.from("vehicle_images").select("*").in("id", leaves)).data;
assert(current.every((row: any) => row.vision_gate_status === "pending" && row.is_duplicate && row.ai_processing_status === "skipped" && row.vehicle_id === null),
  "global gate, duplicate flag, processing state and canonical filing unchanged");
const retained = (await client.from("image_observations").select("*").eq("observed_by", "visual_subject_reading_v1")).data;
assert(retained.every((row: any) => JSON.stringify(row.confidence_basis.visual_subject_reading_v1.envelope) === JSON.stringify(scenario.envelope)),
  "old paid envelope and actual reading clock unchanged");
const proof = (await client.from("image_observations").select("*").eq("observed_by", "device_privacy_v1").eq("image_id", leaves[0])).data[0];
const withdrawal = await client.rpc("ingest_image_observation", { p_image_id: leaves[0], p_vehicle_id: null, p_role: "part", p_confidence: 0,
  p_observed_by: "device_privacy_v1", p_agent_version: "device_privacy_v1", p_layer_version: {}, p_confidence_basis: { device_privacy_v1: {
    state: "withdrawn", withdrawal_reason: "synthetic explicit privacy withdrawal", envelope: proof.confidence_basis.device_privacy_v1.envelope } } });
assert(!withdrawal.error, "actual protected privacy withdrawal");
equal((await readSubjectProfiles(client, owner)).subjects, [], "withdrawal prunes actual source-backed profile");
const after = [captureCalls, fetches, modelCalls];
equal((await readSubjectReinspections(client, store, owner)).candidates, [], "withdrawn family supplies no native candidate metadata");
assert((await resolveSubjectBatch(store, request(candidate), origin, dependencies)).status === "refused", "old reading cannot restore withdrawn permission");
equal([captureCalls, fetches, modelCalls], after, "withdrawal refuses before byte/provider calls");
console.log("PASS actual NULL CAS → pending clone → bounded metadata candidate → 2+1 exact-byte purpose receipts via real writer → old replay → actual reader; zero provider; withdrawal prunes");
