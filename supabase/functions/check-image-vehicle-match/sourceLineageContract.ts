/** Disposable PG17 assay adapter. Executes the actual sanctioned SQL writers
 * and production TypeScript consumers; no network, source bytes or model calls.
 * Invoked only by test_source_lineage_consumers.sql inside run-db-contracts.sh. */
import { readSubjectProfiles } from "./subjectReader.ts";
import { supabaseSubjectStore, resolveSubjectBatch } from "./subjectService.ts";
import { loadSourceIdentities, sourceIdentityLineage, currentIdentitySource } from "./sourceIdentity.ts";
import { hydrateSubjectPrivacy, subjectSourceFamily, subjectSourceCanEstablishPrivacy } from "./subjectPrivacy.ts";
import { readSourceInbox } from "./sourceInbox.ts";

const database = Deno.env.get("PGDATABASE"), socket = Deno.env.get("PGHOST");
if (database !== "dm_refinement_source_lineage_consumers" || !(socket?.startsWith("/tmp/db-contracts.") || Deno.env.get("CI") === "true" && socket === "localhost" && Deno.env.get("PGUSER") === "postgres")) {
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
const scenario = (await sql("SELECT to_jsonb(s) FROM source_lineage_scenario s"));
const owner: string = scenario.owner_id, originals: string[] = scenario.original_ids;
const before = await readSubjectProfiles(client, owner);
assert(before.subjects.length === 1 && before.subjects[0].image_count === 2, "initial protected reader support");
const cluster = before.subjects[0].id, anchor = before.subjects[0].anchor_image_id;
const store = supabaseSubjectStore(client);
const dependencies = {
  capture: async () => { throw new Error("source/renderer access forbidden"); },
  vision: async () => { throw new Error("paid inference forbidden"); },
};
const leaves: string[] = [];
for (const original of originals) {
  const live = (await client.from("vehicle_images").select("*").eq("id", original)).data[0];
  const reason = { contract: "photo_unfile_review_v1", scope: "negative_vehicle_attribution", destination_identity_asserted: false,
    reason: "Synthetic negative attribution interpretation only", review_ref: "synthetic://source-lineage-contract",
    review_method: "synthetic_assistant_visual_interpretation", review_observer: "synthetic_assistant", reviewed_at: new Date().toISOString(),
    expected: { user_id: live.user_id, old_vehicle_id: live.vehicle_id, source_sha256: live.file_hash,
      image_url: live.image_url, storage_path: live.storage_path, created_at: live.created_at, taken_at: live.taken_at } };
  const result = await client.rpc("reattribute_observation", { p_observation_type: "image", p_observation_id: original,
    p_target_vehicle_id: null, p_reason: JSON.stringify(reason), p_actor_user_id: owner });
  assert(!result.error && result.data.success === true, `sanctioned NULL CAS writer: ${result.error}`);
  leaves.push(result.data.new_observation_id);
}
let profiles = await readSubjectProfiles(client, owner);
equal(profiles.subjects, [], "pending clones cannot inherit approved ancestor profile");
assert(!JSON.stringify(profiles).includes("/storage/"), "held gallery leaks no source URL");
const pendingInbox = await readSourceInbox(client, owner, { image_id: leaves[0] });
assert(pendingInbox.photos.length === 1 && pendingInbox.photos[0].id === leaves[0] && pendingInbox.photos[0].image_url === null &&
  pendingInbox.photos[0].readings.length === 0 && pendingInbox.photos[0].retained_contexts.length === 1 &&
  pendingInbox.photos[0].retained_contexts[0]!.receipt_image_id === originals[0],
  "actual pending source inbox preserves source-record ID and old receipt metadata without pixels or interpretation");
const held = await resolveSubjectBatch(store, { user_id: owner, image_ids: leaves, reuse_only: true }, "https://qkgaybvrernstplzjaam.supabase.co", dependencies);
assert(held.status === "refused" && "refusal" in held && held.refusal === "source_not_ready", "pending clone held before paid reuse");

const proofs = new Map<string, any>();
for (const leaf of leaves) {
  const lookup = await loadSourceIdentities(client, owner, [leaf]);
  const source = (await hydrateSubjectPrivacy(client, owner, lookup.sources))[0];
  const live = currentIdentitySource(source)!;
  assert(lookup.complete && subjectSourceCanEstablishPrivacy(source, owner), "current exact leaf can establish its OWN privacy proof");
  const now = new Date().toISOString();
  const envelope = { method: "device_privacy_v1", purpose: "own_private_visual_subjects", user_id: owner, read_at: now,
    source_family: subjectSourceFamily(source), subjects: [],
    inputs: [{ image_id: leaf, source_url: live.image_url, input_url: live.image_url, storage_path: live.storage_path,
      source_sha256: live.file_hash, input_sha256: live.file_hash, source_qualified: true, source_bytes_qualified: true,
      representation: "source", mime_type: "image/jpeg", byte_length: 4, captured_at: now, created_at: live.created_at, taken_at: live.taken_at }],
    native: { method: "device_privacy_v1", purpose: "own_private_visual_subjects", policy_version: 1, owner_user_id: owner,
      source_sha256: live.file_hash, source_byte_length: 4, observed_at: now, classifier_revision: 2, face_revision: 3, os_major: 26,
      classifier_completed: true, face_completed: true, pixels_eligible: true, clutter: false, personal: false,
      prominent_face: false, is_vehicle: true, max_core_confidence: 0.8, total_vehicle_confidence: 0.8, face_threshold: 0.045,
      labels: [{ identifier: "car", confidence: 0.8 }], decode: { contract: "imageio_thumbnail_512_v1", max_pixel: 512,
        orientation_applied: true, input_sha256: "b".repeat(64), width: 1, height: 1, byte_length: 4 } } };
  const result = await client.rpc("ingest_image_observation", { p_image_id: leaf, p_vehicle_id: null, p_role: "part", p_confidence: 0,
    p_observed_by: "device_privacy_v1", p_agent_version: "device_privacy_v1",
    p_confidence_basis: { device_privacy_v1: { envelope, state: "active" } }, p_is_high_confidence_subject: false, p_layer_version: {} });
  assert(!result.error, `protected leaf-specific purpose proof: ${result.error}`); proofs.set(leaf, envelope);
}
const result = await resolveSubjectBatch(store, { user_id: owner, image_ids: leaves, reuse_only: true }, "https://qkgaybvrernstplzjaam.supabase.co", dependencies);
assert("subjects" in result && result.status === "cached", `old paid interpretation reused: ${JSON.stringify(result)}`);
equal(result.persisted_image_ids, leaves, "requested current leaf acknowledgments");
equal(result.input_image_ids, scenario.envelope.inputs.map((input: any) => input.image_id), "immutable original paid receipt input IDs");
profiles = await readSubjectProfiles(client, owner);
assert(profiles.subjects.length === 1 && profiles.subjects[0].id === cluster && profiles.subjects[0].anchor_image_id === anchor,
  "existing private cluster/anchor survives exact attribution supersession");
equal(profiles.subjects[0].image_count, 2, "two original photos stay two sources, not four aliases");
const qualifiedInbox = await readSourceInbox(client, owner, { image_id: leaves[0] });
assert(qualifiedInbox.photos[0].source_state === "ready" && qualifiedInbox.photos[0].readings.length === 1 &&
  qualifiedInbox.photos[0].source_identity?.root_image_id === originals[0], "actual inbox qualifies old reading through current leaf without renaming the record");
const current = (await client.from("vehicle_images").select("*").in("id", leaves)).data;
assert(current.every((row: any) => row.vision_gate_status === "pending" && row.is_duplicate === true && row.ai_processing_status === "skipped" && row.vehicle_id === null),
  "no flag mask, global approval, canonical attribution or paid processing manufactured");
const retained = (await client.from("image_observations").select("*").eq("observed_by", "visual_subject_reading_v1")).data;
assert(retained.every((row: any) => JSON.stringify(row.confidence_basis.visual_subject_reading_v1.envelope) === JSON.stringify(scenario.envelope)),
  "original model envelope/run/read clock unchanged");
const withdrawn = await client.rpc("ingest_image_observation", { p_image_id: leaves[0], p_vehicle_id: null, p_role: "part", p_confidence: 0,
  p_observed_by: "device_privacy_v1", p_agent_version: "device_privacy_v1", p_layer_version: {},
  p_confidence_basis: { device_privacy_v1: { state: "withdrawn", withdrawal_reason: "synthetic explicit privacy withdrawal", envelope: proofs.get(leaves[0]) } } });
assert(!withdrawn.error, `protected privacy withdrawal: ${withdrawn.error}`);
equal((await readSubjectProfiles(client, owner)).subjects, [], "alias privacy withdrawal prunes original anchored profile");
const withdrawnInbox = await readSourceInbox(client, owner, { image_id: leaves[0] });
assert(withdrawnInbox.photos[0].image_url === null && withdrawnInbox.photos[0].retained_contexts.length === 0 &&
  withdrawnInbox.photos[0].readings.length === 0, "withdrawn alias remains opaque in actual inbox");
assert((await resolveSubjectBatch(store, { user_id: owner, image_ids: leaves, reuse_only: true }, "https://qkgaybvrernstplzjaam.supabase.co", dependencies)).status === "refused",
  "withdrawal blocks old paid evidence from restoring membership");
console.log("PASS actual NULL CAS writer → held pending leaf → own exact family privacy proof → protected old receipt replay → actual private reader; zero source/model access; withdrawal prunes");
