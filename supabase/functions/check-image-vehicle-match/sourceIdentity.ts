import {
  type AttributionAudit, type ExactSourceLineage, type LineageImage, type SourceLineageResult,
  resolveImageAttributionLineage,
} from "./sourceLineage.ts";

export const SOURCE_IDENTITY_COLUMNS = "id,vehicle_id,user_id,source,image_url,file_hash,storage_path,taken_at,created_at,exif_data,latitude,longitude,device_fingerprint,image_vehicle_match_status," +
  "is_superseded,superseded_by,superseded_at,is_duplicate,duplicate_of,is_document,is_sensitive,vision_gate_status";
const AUDIT_COLUMNS = "id,observation_type,old_observation_id,new_observation_id,old_vehicle_id,new_vehicle_id,created_at";
const MAX_RECEIPTS = 256, MAX_ROWS = 2048, MAX_AUDITS = 2048, CHUNK = 128;
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

/** Internal server-loader output, never accepted as a client request assertion. */
export interface SourceIdentity {
  contract: "audited_image_source_identity_v1";
  receipt_image_id: string;
  result: SourceLineageResult;
  lookup_complete: boolean;
  /** Verified own-account aliases for current privacy-history hydration, never client proof. */
  family_sources: LineageImage[];
}
export type IdentitySource = Record<string, any> & { id: string; source_identity: SourceIdentity };
export interface SourceIdentityLookup {
  sources: IdentitySource[];
  bindings: Map<string, SourceIdentity>;
  alias_image_ids: string[];
  complete: boolean;
  coverage: { requested: number; source_records_read: number; audit_records_read: number;
    distinct_source_records: number; distinct_audit_records: number; lookup_queries: number; truncated: boolean };
}

const normalImage = (row: Record<string, any>): LineageImage => ({ ...row,
  vehicle_id: row.vehicle_id ?? null, exif_data: row.exif_data ?? null, taken_at: row.taken_at ?? null,
  superseded_by: row.superseded_by ?? null, superseded_at: row.superseded_at ?? null, duplicate_of: row.duplicate_of ?? null,
} as LineageImage);

/** Pure family projection also used by synthetic PostgreSQL/edge contracts. */
export function projectSourceIdentities(ownerId: string, receiptIds: string[], rawImages: Record<string, any>[],
  rawAudits: AttributionAudit[], complete: boolean): SourceIdentityLookup {
  const rows = rawImages.map(normalImage), byId = new Map(rows.map(row => [row.id, row]));
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!uuid(a) || !uuid(b) || a === b) return;
    adjacency.set(a, new Set([...(adjacency.get(a) ?? []), b]));
    adjacency.set(b, new Set([...(adjacency.get(b) ?? []), a]));
  };
  for (const row of rows) if (row.superseded_by) link(row.id, row.superseded_by);
  for (const audit of rawAudits) if (audit.observation_type === "image") link(audit.old_observation_id, audit.new_observation_id);
  const bindings = new Map<string, SourceIdentity>(), sources: IdentitySource[] = [], aliasIds = new Set<string>();
  for (const id of receiptIds) {
    const component = new Set([id]), pending = [id];
    while (pending.length && component.size <= 64) {
      for (const other of adjacency.get(pending.shift()!) ?? []) if (!component.has(other)) {
        component.add(other); pending.push(other);
      }
    }
    const result = resolveImageAttributionLineage({ receiptImageId: id, ownerId,
      images: rows.filter(row => component.has(row.id)),
      audits: rawAudits.filter(row => component.has(row.old_observation_id) || component.has(row.new_observation_id)),
      complete: complete && component.size <= 64,
    });
    const binding: SourceIdentity = { contract: "audited_image_source_identity_v1", receipt_image_id: id,
      result, lookup_complete: complete && component.size <= 64,
      family_sources: result.status === "refused" ? [] : rows.filter(row => result.lineage.alias_image_ids.includes(row.id)) };
    bindings.set(id, binding);
    if (result.status !== "refused") for (const alias of result.lineage.alias_image_ids) aliasIds.add(alias);
    else if (byId.get(id)?.user_id === ownerId) aliasIds.add(id);
    const source = byId.get(id);
    if (source?.user_id === ownerId) sources.push({ ...source, source_identity: binding });
  }
  complete = complete && [...bindings.values()].every(binding => binding.lookup_complete);
  return { sources, bindings, alias_image_ids: [...aliasIds].sort(), complete,
    coverage: { requested: receiptIds.length, source_records_read: rows.length, audit_records_read: rawAudits.length, distinct_source_records: rows.length, distinct_audit_records: rawAudits.length, lookup_queries: 0, truncated: !complete } };
}

/**
 * Bounded incoming AND outgoing audited family discovery. Each new pointer is
 * read through an owner-scoped image query. A limit/error never proves absence.
 * No byte read, model call, interpretation write or global photo scan occurs.
 */
export async function loadSourceIdentities(client: any, ownerId: string, receiptIds: string[]): Promise<SourceIdentityLookup> {
  if (!uuid(ownerId) || !Array.isArray(receiptIds) || receiptIds.length > MAX_RECEIPTS ||
    new Set(receiptIds).size !== receiptIds.length || receiptIds.some(id => !uuid(id))) throw new Error("source_identity_scope_invalid");
  if (!receiptIds.length) return projectSourceIdentities(ownerId, [], [], [], true);
  const images = new Map<string, Record<string, any>>(), audits = new Map<string, AttributionAudit>(), visited = new Set<string>();
  let frontier = [...receiptIds], complete = true, sourceReturned = 0, auditReturned = 0, queries = 0;
  for (let depth = 0; frontier.length && depth <= 8; depth++) {
    const current = frontier.filter(id => !visited.has(id)); frontier = [];
    for (let start = 0; start < current.length; start += CHUNK) {
      const ids = current.slice(start, start + CHUNK);
      const [source, outgoing, incoming] = await Promise.all([
        client.from("vehicle_images").select(SOURCE_IDENTITY_COLUMNS).eq("user_id", ownerId).in("id", ids).limit(CHUNK + 1),
        client.from("reattribution_audit").select(AUDIT_COLUMNS).eq("observation_type", "image")
          .in("old_observation_id", ids).limit(MAX_AUDITS + 1),
        client.from("reattribution_audit").select(AUDIT_COLUMNS).eq("observation_type", "image")
          .in("new_observation_id", ids).limit(MAX_AUDITS + 1),
      ]);
      if ([source, outgoing, incoming].some(result => result.error || !Array.isArray(result.data))) throw new Error("source_identity_read_failed");
      sourceReturned += source.data.length; auditReturned += outgoing.data.length + incoming.data.length; queries += 3;
      if (source.data.length > CHUNK || outgoing.data.length > MAX_AUDITS || incoming.data.length > MAX_AUDITS) complete = false;
      for (const id of ids) visited.add(id);
      for (const row of source.data.slice(0, CHUNK)) {
        if (!record(row) || !uuid(row.id) || row.user_id !== ownerId || !ids.includes(row.id) || images.has(row.id)) {
          complete = false; continue;
        }
        images.set(row.id, row);
        if (uuid(row.superseded_by) && !visited.has(row.superseded_by)) frontier.push(row.superseded_by);
      }
      for (const row of [...outgoing.data.slice(0, MAX_AUDITS), ...incoming.data.slice(0, MAX_AUDITS)]) {
        if (!record(row) || !uuid(row.id) || row.observation_type !== "image" ||
          !uuid(row.old_observation_id) || !uuid(row.new_observation_id)) { complete = false; continue; }
        const old = audits.get(row.id);
        if (old && JSON.stringify(old) !== JSON.stringify(row)) { complete = false; continue; }
        audits.set(row.id, row as AttributionAudit);
        if (row.old_observation_id !== row.new_observation_id) for (const id of [row.old_observation_id, row.new_observation_id]) {
          if (!visited.has(id)) frontier.push(id);
        }
      }
      if (!complete || images.size > MAX_ROWS || audits.size > MAX_AUDITS) { complete = false; break; }
    }
    frontier = [...new Set(frontier)].filter(id => !visited.has(id));
    if (!complete || images.size > MAX_ROWS || audits.size > MAX_AUDITS) break;
  }
  if (frontier.length) complete = false;
  const result = projectSourceIdentities(ownerId, receiptIds, [...images.values()].slice(0, MAX_ROWS),
    [...audits.values()].slice(0, MAX_AUDITS), complete);
  result.coverage.source_records_read = sourceReturned; result.coverage.audit_records_read = auditReturned;
  result.coverage.lookup_queries = queries;
  return result;
}

/** Current source is kept separate; no id/flag rewriting to make an old row look live. */
export function exactSourceIdentity(source: unknown): SourceIdentity | null {
  if (!record(source) || !record(source.source_identity) ||
    source.source_identity.contract !== "audited_image_source_identity_v1" ||
    source.source_identity.receipt_image_id !== source.id) return null;
  return source.source_identity as SourceIdentity;
}
export function sourceIdentityLineage(source: unknown): ExactSourceLineage | null {
  const binding = exactSourceIdentity(source);
  return binding?.lookup_complete && binding.result.status !== "refused" ? binding.result.lineage : null;
}
export const sourceAliases = (source: unknown): string[] => sourceIdentityLineage(source)?.alias_image_ids ??
  (record(source) && uuid(source.id) ? [source.id] : []);
export const sourceRoot = (source: unknown): string | null => sourceIdentityLineage(source)?.root_image_id ??
  (record(source) && uuid(source.id) ? source.id : null);
export const currentIdentitySource = (source: unknown): Record<string, any> | null => {
  const binding = exactSourceIdentity(source);
  if (!binding) return record(source) ? source : null;
  return binding.lookup_complete && binding.result.status !== "refused" ? binding.result.lineage.current_source : null;
};

/** Collect aliases before hydrating protected current/privacy withdrawal history. */
export function sourceIdentityRecords(sources: Record<string, any>[]): Record<string, any>[] {
  const rows = new Map<string, Record<string, any>>();
  for (const source of sources) {
    const binding = exactSourceIdentity(source);
    for (const row of binding?.family_sources ?? [source]) rows.set(row.id, row);
  }
  return [...rows.values()];
}

/** Hydration adds independently loaded testimony to each real alias, not to an invented active receipt row. */
export function attachSourceIdentityRecords<T extends Record<string, any>>(sources: T[], records: Record<string, any>[]): T[] {
  const rows = new Map(records.map(row => [row.id, row]));
  return sources.map(source => {
    const binding = exactSourceIdentity(source);
    if (!binding || binding.result.status === "refused") return { ...source, ...(rows.get(source.id) ?? {}) };
    const family = binding.family_sources.map(row => rows.get(row.id) ?? row);
    const leaf = rows.get(binding.result.lineage.current_image_id) ?? binding.result.lineage.current_source;
    return { ...source, ...(rows.get(source.id) ?? {}), source_identity: { ...binding, family_sources: family,
      result: { ...binding.result, lineage: { ...binding.result.lineage, current_source: leaf } } } };
  });
}

/** Safe operational metadata; no URL/pixels from a held or unverified source. */
export function inspectSourceIdentity(source: unknown) {
  const binding = exactSourceIdentity(source);
  if (!binding) return null;
  const result = binding.result, lineage = result.status === "refused" ? null : result.lineage;
  return { contract: binding.contract, receipt_image_id: binding.receipt_image_id,
    root_image_id: lineage?.root_image_id ?? null, current_image_id: lineage?.current_image_id ?? null,
    alias_image_ids: lineage?.alias_image_ids ?? [binding.receipt_image_id], audit_ids: lineage?.audit_ids ?? [],
    state: result.status, reason: result.status === "eligible_for_byte_verification" ? null : result.reason,
    complete: binding.lookup_complete, source_photo_count: lineage ? 1 : null,
    current_vehicle_attribution_proven: false };
}
