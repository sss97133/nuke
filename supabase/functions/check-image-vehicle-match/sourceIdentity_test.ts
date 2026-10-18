import { attachSourceIdentityRecords, currentIdentitySource, inspectSourceIdentity, loadSourceIdentities,
  projectSourceIdentities, sourceAliases, sourceIdentityLineage, sourceIdentityRecords, sourceRoot } from "./sourceIdentity.ts";
import type { AttributionAudit, LineageImage } from "./sourceLineage.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(900), stranger = id(901), auditAt = "2026-10-18T00:00:00.123456Z";
function assert(value: unknown, label = "assertion failed"): asserts value { if (!value) throw new Error(label); }
const image = (n: number, extra: Partial<LineageImage> = {}): LineageImage => ({
  id: id(n), user_id: owner, vehicle_id: id(800), image_url: "https://example.invalid/frame.heic",
  file_hash: "a".repeat(64), storage_path: "synthetic/frame.heic", taken_at: "2026-10-15T00:00:00.000001Z",
  created_at: "2026-10-16T00:00:00.000001Z", exif_data: { uuid: "synthetic", camera_model: "Example" },
  is_superseded: false, superseded_by: null, superseded_at: null, is_sensitive: false, is_document: false,
  is_duplicate: false, duplicate_of: null, vision_gate_status: "approved", ...extra,
});
function family() {
  const images = [image(1, { is_superseded: true, superseded_by: id(2), superseded_at: auditAt }),
    image(2, { vehicle_id: null, is_duplicate: true, duplicate_of: id(1), vision_gate_status: "pending" })];
  const audits: AttributionAudit[] = [{ id: id(700), observation_type: "image", old_observation_id: id(1),
    new_observation_id: id(2), old_vehicle_id: id(800), new_vehicle_id: null, created_at: auditAt }];
  return { images, audits };
}
class DB {
  calls: Array<{ table: string; filters: Array<[string, string, any]> }> = [];
  fail: string | null = null;
  constructor(public images: any[], public audits: any[]) {}
  from(table: string) {
    const filters: Array<[string, string, any]> = [], self = this; let limit = Infinity;
    const q = {
      select(_columns: string) { return q; },
      eq(field: string, value: unknown) { filters.push(["eq", field, value]); return q; },
      in(field: string, value: unknown[]) { filters.push(["in", field, value]); return q; },
      limit(n: number) { limit = n; return q; },
      then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
        self.calls.push({ table, filters });
        const rows = (table === "vehicle_images" ? self.images : self.audits)
          .filter(row => filters.every(([op, field, value]) => op === "eq" ? row[field] === value : value.includes(row[field]))).slice(0, limit);
        return Promise.resolve(self.fail === table ? { error: { message: "backend detail" }, data: null } : { error: null, data: rows }).then(resolve, reject);
      },
    }; return q;
  }
}

Deno.test("bounded incoming/outgoing audit loader preserves receipt IDs and a pending clone stays held", async () => {
  const f = family(), db = new DB(f.images, f.audits);
  const result = await loadSourceIdentities(db, owner, [id(1), id(2)]);
  assert(result.complete && result.sources.length === 2);
  for (const source of result.sources) {
    assert(sourceRoot(source) === id(1)); assert(currentIdentitySource(source)?.id === id(2));
    assert(source.source_identity.receipt_image_id === source.id);
    assert(source.source_identity.result.status === "held");
    assert(sourceAliases(source).join() === [id(1), id(2)].join());
  }
  assert(result.sources[0].is_superseded === true && result.sources[1].is_duplicate === true);
  assert(db.calls.filter(row => row.table === "vehicle_images").every(row => row.filters.some(f => f[1] === "user_id" && f[2] === owner)));
});
Deno.test("a request starting at current leaf still discovers its exact original receipt family", async () => {
  const f = family(), result = await loadSourceIdentities(new DB(f.images, f.audits), owner, [id(2)]);
  assert(result.sources[0].id === id(2) && sourceIdentityLineage(result.sources[0])?.root_image_id === id(1));
  assert(result.coverage.source_records_read === 2 && result.coverage.distinct_audit_records === 1 && result.coverage.audit_records_read === 2 && result.coverage.lookup_queries === 6);
});
Deno.test("inspection metadata describes history without returning held pixels or pretending attachment proof", async () => {
  const f = family(), result = await loadSourceIdentities(new DB(f.images, f.audits), owner, [id(1)]);
  const receipt = inspectSourceIdentity(result.sources[0]);
  assert(receipt?.receipt_image_id === id(1) && receipt.current_image_id === id(2));
  assert(receipt.source_photo_count === 1 && receipt.current_vehicle_attribution_proven === false);
  assert(!JSON.stringify(receipt).includes("https://"));
});
Deno.test("missing audit and foreign source rows never become guessed aliases", async () => {
  const f = family(); let result = await loadSourceIdentities(new DB(f.images, []), owner, [id(1)]);
  assert(result.sources[0].source_identity.result.status === "refused");
  f.images[1].user_id = stranger;
  result = await loadSourceIdentities(new DB(f.images, f.audits), owner, [id(1)]);
  assert(result.sources[0].source_identity.result.status === "refused");
  assert(result.alias_image_ids.join() === id(1));
  assert(inspectSourceIdentity(result.sources[0])?.current_image_id === null);
});
Deno.test("capped audit lookup is incomplete and cannot assert absence of a fork or withdrawal", async () => {
  const f = family(), audits = Array.from({ length: 2049 }, (_, n) => ({ ...f.audits[0], id: id(10000 + n) }));
  const result = await loadSourceIdentities(new DB(f.images, audits), owner, [id(1)]);
  assert(!result.complete && result.coverage.truncated);
  assert(result.sources[0].source_identity.result.status === "refused");
});
Deno.test("loader failure is a failure rather than an empty photo account", async () => {
  const f = family(), db = new DB(f.images, f.audits); db.fail = "reattribution_audit";
  let error = ""; try { await loadSourceIdentities(db, owner, [id(1)]); } catch (e) { error = (e as Error).message; }
  assert(error === "source_identity_read_failed");
});
Deno.test("privacy hydration keeps each alias's own proof and withdrawal history on real rows", async () => {
  const f = family(), result = await loadSourceIdentities(new DB(f.images, f.audits), owner, [id(1)]);
  const records = sourceIdentityRecords(result.sources).map(row => ({ ...row, private_subject_privacy_complete: true,
    private_subject_privacy: [{ image_id: row.id, state: row.id === id(1) ? "withdrawn" : "active" }] }));
  const sources = attachSourceIdentityRecords(result.sources, records), leaf = currentIdentitySource(sources[0]);
  assert(sources[0].id === id(1) && sources[0].is_superseded === true);
  assert(leaf?.id === id(2) && leaf.is_duplicate === true && leaf.private_subject_privacy[0].image_id === id(2));
  const old = sourceIdentityRecords(sources).find(row => row.id === id(1));
  assert(old?.private_subject_privacy[0].state === "withdrawn");
});
Deno.test("an unchanged current source does not need invented camera or capture-clock fields", () => {
  const row = image(1, { exif_data: null, taken_at: null });
  const result = projectSourceIdentities(owner, [row.id], [row], [], true);
  assert(result.sources[0].source_identity.result.status === "eligible_for_byte_verification");
  assert(sourceRoot(result.sources[0]) === row.id);
});
Deno.test("a complete duplicate row identity cannot be silently last-wins", () => {
  const row = image(1), result = projectSourceIdentities(owner, [row.id], [row, { ...row }], [], true);
  assert(result.sources[0].source_identity.result.status === "refused");
});
