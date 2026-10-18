import { observationClockMicroseconds } from "../_shared/observationContentHash.ts";

/** Local proposal only. The existing reader, producer and SQL admission do not use this yet. */
export interface LineageImage {
  id: string;
  vehicle_id: string | null;
  user_id: string | null;
  file_hash: string | null;
  image_url: string;
  storage_path: string | null;
  created_at: string | null;
  taken_at: string | null;
  exif_data: Record<string, unknown> | null;
  is_superseded: boolean | null;
  superseded_by: string | null;
  superseded_at: string | null;
  is_sensitive: boolean;
  is_document: boolean | null;
  is_duplicate: boolean | null;
  duplicate_of: string | null;
  vision_gate_status: string | null;
}

export interface AttributionAudit {
  id: string;
  observation_type: string;
  old_observation_id: string;
  new_observation_id: string;
  old_vehicle_id: string | null;
  new_vehicle_id: string | null;
  created_at: string | null;
}

export type LineageRefusal =
  | "incomplete_lookup" | "duplicate_row_id" | "missing_source" | "invalid_source_witness"
  | "source_witness_drift" | "wrong_owner" | "missing_audit" | "lineage_fork"
  | "lineage_cycle" | "lineage_too_deep" | "supersession_drift" | "audit_clock_drift" | "audit_identity_drift";

export interface ExactSourceLineage {
  /** The ID in the retained model input. It is never rewritten to the attribution leaf. */
  receipt_image_id: string;
  root_image_id: string;
  current_image_id: string;
  alias_image_ids: string[];
  audit_ids: string[];
  source_sha256: string;
  current_source: LineageImage;
  /** A row clone is the same photograph, not another independent model witness. */
  source_photo_count: 1;
  requires_live_byte_verification: true;
  /** Same-ID attribution audits are not checked here; vehicle_id is not attachment proof. */
  current_vehicle_attribution_proven: false;
}

export type SourceLineageResult =
  | { status: "refused"; reason: LineageRefusal }
  | { status: "held"; reason: "privacy_withdrawn" | "source_rejected" | "document" | "unrelated_duplicate" | "source_gate_not_approved";
      lineage: ExactSourceLineage }
  | { status: "eligible_for_byte_verification"; lineage: ExactSourceLineage };

const cameraKeys = ["uuid", "original_filename", "camera_make", "camera_model", "source_type",
  "Make", "Model", "DateTimeOriginal"] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const key = (value: string) => value.toLowerCase();
const idEqual = (a: string | null, b: string | null) => a === null || b === null ? a === b : key(a) === key(b);
const clock = observationClockMicroseconds;

function cameraWitness(row: LineageImage): string {
  return JSON.stringify(cameraKeys.map(name => [name, row.exif_data?.[name] ?? null]));
}

function validWitness(row: LineageImage, continuityRequired: boolean): boolean {
  const exif = row.exif_data;
  const hasCameraIdentity = typeof exif?.uuid === "string" && exif.uuid.length > 0 ||
    typeof exif?.camera_make === "string" && exif.camera_make.length > 0 &&
    typeof exif?.camera_model === "string" && exif.camera_model.length > 0 ||
    typeof exif?.Make === "string" && exif.Make.length > 0 &&
    typeof exif?.Model === "string" && exif.Model.length > 0;
  return uuid.test(row.id) && row.user_id !== null && uuid.test(row.user_id) &&
    /^[0-9a-f]{64}$/.test(row.file_hash ?? "") && /^https:\/\//.test(row.image_url) &&
    (!continuityRequired || typeof row.storage_path === "string" && row.storage_path.length > 0) &&
    clock(row.created_at) !== null &&
    (row.taken_at === null && !continuityRequired || clock(row.taken_at) !== null) &&
    (!continuityRequired || hasCameraIdentity);
}

function sameWitness(left: LineageImage, right: LineageImage): boolean {
  return idEqual(left.user_id, right.user_id) && left.file_hash === right.file_hash &&
    left.image_url === right.image_url && left.storage_path === right.storage_path &&
    clock(left.created_at) === clock(right.created_at) && clock(left.taken_at) === clock(right.taken_at) &&
    cameraWitness(left) === cameraWitness(right);
}

/**
 * Resolve a fully loaded, bounded audit family. `complete` is a trusted loader result,
 * never an end-user assertion. The loader must query incoming AND outgoing image audits
 * for every discovered alias (plus superseded_by rows), and refuse any truncated page.
 *
 * A sanctioned first attribution can update a leaf's vehicle in place and audit oldID=newID.
 * That is not an identity edge. This helper neither validates that later audit nor proves
 * the leaf's current canonical vehicle attachment; it establishes exact source identity only.
 */
export function resolveImageAttributionLineage(input: {
  receiptImageId: string;
  ownerId: string;
  images: LineageImage[];
  audits: AttributionAudit[];
  complete: boolean;
}): SourceLineageResult {
  const refuse = (reason: LineageRefusal): SourceLineageResult => ({ status: "refused", reason });
  if (!input.complete || input.images.length > 64 || input.audits.length > 64) return refuse("incomplete_lookup");
  if (!uuid.test(input.receiptImageId) || !uuid.test(input.ownerId)) return refuse("invalid_source_witness");
  const images = new Map<string, LineageImage>();
  for (const row of input.images) {
    if (images.has(key(row.id))) return refuse("duplicate_row_id");
    images.set(key(row.id), row);
  }
  const edges = input.audits.filter(a => a.observation_type === "image" &&
    !idEqual(a.old_observation_id, a.new_observation_id));
  const auditIdsSeen = new Set<string>();
  for (const edge of edges) {
    if (!uuid.test(edge.id) || !uuid.test(edge.old_observation_id) || !uuid.test(edge.new_observation_id) ||
      auditIdsSeen.has(key(edge.id))) return refuse("audit_identity_drift");
    auditIdsSeen.add(key(edge.id));
  }
  const incoming = (id: string) => edges.filter(a => idEqual(a.new_observation_id, id));
  const outgoing = (id: string) => edges.filter(a => idEqual(a.old_observation_id, id));
  let root = key(input.receiptImageId);
  const backwards = new Set<string>();
  for (;;) {
    if (backwards.has(root)) return refuse("lineage_cycle");
    backwards.add(root);
    if (backwards.size > 9) return refuse("lineage_too_deep");
    if (!images.has(root)) return refuse("missing_source");
    const parents = incoming(root);
    if (parents.length > 1) return refuse("lineage_fork");
    if (!parents.length) break;
    root = key(parents[0].old_observation_id);
  }
  const chain: LineageImage[] = [];
  const auditIds: string[] = [];
  let previousAuditTime: bigint | null = null;
  const visited = new Set<string>();
  let cursor = root;
  for (;;) {
    if (visited.has(cursor)) return refuse("lineage_cycle");
    visited.add(cursor);
    if (visited.size > 9) return refuse("lineage_too_deep");
    const row = images.get(cursor);
    if (!row) return refuse("missing_source");
    if (!validWitness(row, edges.some(edge => idEqual(edge.old_observation_id, row.id) ||
        idEqual(edge.new_observation_id, row.id)))) return refuse("invalid_source_witness");
    if (!idEqual(row.user_id, input.ownerId)) return refuse("wrong_owner");
    if (chain.length && !sameWitness(chain[0], row)) return refuse("source_witness_drift");
    chain.push(row);
    if (incoming(cursor).length > 1) return refuse("lineage_fork");
    const children = outgoing(cursor);
    if (children.length > 1) return refuse("lineage_fork");
    if (!children.length) {
      if (row.is_superseded === true || row.superseded_by !== null || row.superseded_at !== null) {
        return refuse("missing_audit");
      }
      break;
    }
    const edge = children[0];
    if (row.is_superseded !== true || !idEqual(row.superseded_by, edge.new_observation_id) ||
      !idEqual(row.vehicle_id, edge.old_vehicle_id)) return refuse("supersession_drift");
    const auditTime = clock(edge.created_at);
    if (auditTime === null || clock(row.superseded_at) !== auditTime || auditTime < clock(row.created_at)!) {
      return refuse("audit_clock_drift");
    }
    if (previousAuditTime !== null && auditTime < previousAuditTime) {
      return refuse("audit_clock_drift");
    }
    previousAuditTime = auditTime;
    auditIds.push(edge.id);
    cursor = key(edge.new_observation_id);
  }
  const leaf = chain.at(-1)!;
  const lineage: ExactSourceLineage = {
    receipt_image_id: key(input.receiptImageId), root_image_id: root, current_image_id: key(leaf.id),
    alias_image_ids: chain.map(r => key(r.id)), audit_ids: auditIds, source_sha256: leaf.file_hash!,
    current_source: leaf, source_photo_count: 1, requires_live_byte_verification: true,
    current_vehicle_attribution_proven: false,
  };
  if (chain.some(row => row.is_sensitive === true || row.vision_gate_status === "rejected_personal")) {
    return { status: "held", reason: "privacy_withdrawn", lineage };
  }
  // Exact bytes do not supersede a gate decision. A separately modeled sanctioned
  // correction would be needed before ANY historical rejection could be relaxed.
  if (chain.some(row => row.vision_gate_status?.startsWith("rejected"))) {
    return { status: "held", reason: "source_rejected", lineage };
  }
  if (chain.some(row => row.is_document === true)) return { status: "held", reason: "document", lineage };
  // The live duplicate trigger marks each row clone. This is a known ancestor only,
  // never permission to admit another same-hash row or count a second photograph.
  if (chain.some((row, index) => row.is_duplicate === true &&
      (index === 0 || row.duplicate_of === null ||
       !chain.slice(0, index).some(parent => idEqual(parent.id, row.duplicate_of))))) {
    return { status: "held", reason: "unrelated_duplicate", lineage };
  }
  if (leaf.vision_gate_status !== "approved") return { status: "held", reason: "source_gate_not_approved", lineage };
  return { status: "eligible_for_byte_verification", lineage };
}

/** Negative subject testimony must be queried across EVERY alias, including old receipt IDs. */
export function lineageReadingAfterWithdrawals(lineage: ExactSourceLineage, readAt: string,
  withdrawals: { source_image_id: string; observed_at: string }[], complete: boolean): boolean {
  const read = clock(readAt);
  if (!complete || read === null) return false;
  return withdrawals.filter(row => lineage.alias_image_ids.includes(key(row.source_image_id))).every(row => {
    const withdrawn = clock(row.observed_at);
    return withdrawn !== null && read > withdrawn;
  });
}

/** Preserve any existing anchor verbatim; a clone's new row ID cannot mint another profile. */
export function stableLineageAnchor(lineages: ExactSourceLineage[], selectedReceiptId: string,
  existing: { cluster_id: string; anchor_image_id: string }[], complete: boolean):
  { status: "held"; reason: "incomplete_lookup" | "competing_anchors" | "missing_anchor_source" } |
  { status: "supported"; anchor_image_id: string; cluster_id: string | null } {
  if (!complete) return { status: "held", reason: "incomplete_lookup" };
  const allAliases = new Set(lineages.flatMap(row => row.alias_image_ids));
  const candidates = existing.filter(row => allAliases.has(key(row.anchor_image_id)));
  const distinct = new Map(candidates.map(row => [key(row.cluster_id), row]));
  if (distinct.size > 1 || new Set(candidates.map(row => key(row.anchor_image_id))).size > 1) {
    return { status: "held", reason: "competing_anchors" };
  }
  if (distinct.size === 1) {
    const old = [...distinct.values()][0];
    return { status: "supported", anchor_image_id: key(old.anchor_image_id), cluster_id: key(old.cluster_id) };
  }
  const selected = lineages.find(row => row.alias_image_ids.includes(key(selectedReceiptId)));
  return selected ? { status: "supported", anchor_image_id: selected.root_image_id, cluster_id: null } :
    { status: "held", reason: "missing_anchor_source" };
}
