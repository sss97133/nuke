import { observationClockMicroseconds as clock } from "../_shared/observationContentHash.ts";
import { qualifiedSubjectInput } from "./subjects.ts";
import { exactSourceIdentity, currentIdentitySource, sourceIdentityLineage, sourceIdentityRecords, attachSourceIdentityRecords } from "./sourceIdentity.ts";

export const DEVICE_PRIVACY_METHOD = "device_privacy_v1";
export const PRIVATE_SUBJECT_PURPOSE = "own_private_visual_subjects";
const ORIGIN = "https://qkgaybvrernstplzjaam.supabase.co";
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const sha = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const sameClock = (a: unknown, b: unknown) => a === null && b === null || clock(a) !== null && clock(a) === clock(b);
const junk = new Set(["document", "text", "menu", "receipt", "paper", "printout", "poster", "advertisement", "packaging", "envelope", "label", "book_jacket", "business_card", "website", "web_site", "screenshot", "spreadsheet", "invoice", "id_card", "form", "newspaper", "magazine"]);

/** Attributed native testimony, not attestation or public approval. Native
 * request revisions are pinned by the producer; unknown policy/revisions hold. */
export function validDevicePrivacyReceipt(native: unknown, source: any, readAt: unknown): boolean {
  if (!object(native) || !object(source) || native.method !== DEVICE_PRIVACY_METHOD || native.policy_version !== 1 ||
    native.purpose !== PRIVATE_SUBJECT_PURPOSE || native.owner_user_id !== source.user_id || native.source_sha256 !== source.file_hash || !sha(native.source_sha256) ||
    !Number.isSafeInteger(native.source_byte_length) || native.source_byte_length < 1 || native.source_byte_length > 4194304 ||
    native.classifier_revision !== 2 || native.face_revision !== 3 || native.os_major !== 26 ||
    native.classifier_completed !== true || native.face_completed !== true || native.pixels_eligible !== true ||
    native.clutter !== false || native.personal !== false || typeof native.prominent_face !== "boolean" ||
    typeof native.is_vehicle !== "boolean" || native.face_threshold !== 0.045 ||
    !Number.isFinite(native.max_core_confidence) || native.max_core_confidence < 0 || native.max_core_confidence > 1 ||
    !Number.isFinite(native.total_vehicle_confidence) || native.total_vehicle_confidence < 0 || native.total_vehicle_confidence > 128 ||
    native.is_vehicle !== (Math.fround(native.max_core_confidence) > Math.fround(0.1) || Math.fround(native.total_vehicle_confidence) > Math.fround(0.3)) ||
    native.prominent_face && !native.is_vehicle || !Array.isArray(native.labels) || native.labels.length > 12 ||
    native.labels.some((l: any) => !object(l) || typeof l.identifier !== "string" || !l.identifier || l.identifier.length > 120 ||
      typeof l.confidence !== "number" || !Number.isFinite(l.confidence) || l.confidence < 0 || l.confidence > 1) ||
    native.labels.slice(0, 3).some((l: any) => junk.has(l.identifier.toLowerCase()))) return false;
  const observed = clock(native.observed_at), read = clock(readAt), d = native.decode;
  return observed !== null && read !== null && observed <= read + 300_000_000n && object(d) &&
    d.contract === "imageio_thumbnail_512_v1" && d.max_pixel === 512 && d.orientation_applied === true &&
    sha(d.input_sha256) && Number.isSafeInteger(d.width) && d.width >= 1 && d.width <= 512 &&
    Number.isSafeInteger(d.height) && d.height >= 1 && d.height <= 512 &&
    Number.isSafeInteger(d.byte_length) && d.byte_length >= 1 && d.byte_length <= 4194304;
}

export interface SubjectSourceFamily {
  root_image_id: string; current_image_id: string; alias_image_ids: string[]; audit_ids: string[]; source_sha256: string;
}
export function subjectSourceFamily(source: unknown): SubjectSourceFamily | null {
  const lineage = sourceIdentityLineage(source);
  return lineage && lineage.alias_image_ids.length > 1 ? { root_image_id: lineage.root_image_id, current_image_id: lineage.current_image_id,
    alias_image_ids: lineage.alias_image_ids, audit_ids: lineage.audit_ids, source_sha256: lineage.source_sha256 } : null;
}
const familyEqual = (a: unknown, b: SubjectSourceFamily) => object(a) && Object.keys(a).sort().join(",") ===
  "alias_image_ids,audit_ids,current_image_id,root_image_id,source_sha256" && a.root_image_id === b.root_image_id &&
  a.current_image_id === b.current_image_id && a.source_sha256 === b.source_sha256 &&
  JSON.stringify(a.alias_image_ids) === JSON.stringify(b.alias_image_ids) && JSON.stringify(a.audit_ids) === JSON.stringify(b.audit_ids);

export function nativePrivateSource(source: any, userId: string, family?: SubjectSourceFamily | null): boolean {
  return object(source) && source.user_id === userId && source.source === "capture_relay_ios" &&
    source.vision_gate_status === "pending" && source.is_superseded !== true && (source.is_duplicate !== true ||
      !!family && family.current_image_id === source.id && family.source_sha256 === source.file_hash &&
      source.duplicate_of !== source.id && family.alias_image_ids.includes(source.duplicate_of)) &&
    source.is_document !== true && source.is_sensitive !== true && sha(source.file_hash) &&
    typeof source.storage_path === "string" && new RegExp(`^users/${userId}/capture-relay/${source.file_hash}/[A-Za-z0-9._-]+$`).test(source.storage_path) &&
    ![".", ".."].includes(source.storage_path.split("/").at(-1)!) &&
    source.image_url === `${ORIGIN}/storage/v1/object/public/vehicle-photos/${source.storage_path}`;
}

export function subjectPrivacyWithdrawn(source: any): boolean {
  const rows = sourceIdentityRecords([source]).flatMap((s: any) => Array.isArray(s.private_subject_privacy) ? s.private_subject_privacy : []);
  return rows.some((row: any) =>
    row?.observed_by === DEVICE_PRIVACY_METHOD && row?.confidence_basis?.[DEVICE_PRIVACY_METHOD]?.state === "withdrawn");
}

/** Proof comes only from freshly read terminal protected heads. No ancestor,
 * cached metadata, album or model subject can qualify a pending source. */
export function privateSubjectPrivacyQualified(source: any, userId: string, readAt: unknown, family?: SubjectSourceFamily | null): boolean {
  if (!nativePrivateSource(source, userId, family) || source.private_subject_privacy_complete !== true || subjectPrivacyWithdrawn(source) || !Array.isArray(source.private_subject_privacy) || source.private_subject_privacy.length !== 1) return false;
  const row = source.private_subject_privacy[0], w = row?.confidence_basis?.[DEVICE_PRIVACY_METHOD], e = w?.envelope;
  if (!object(row) || row.image_id !== source.id || row.observed_by !== DEVICE_PRIVACY_METHOD || row.is_active !== true ||
    row.superseded_by !== null || w?.state !== "active" || !object(e) || e.method !== DEVICE_PRIVACY_METHOD ||
    e.purpose !== PRIVATE_SUBJECT_PURPOSE || e.user_id !== userId || !Array.isArray(e.inputs) || e.inputs.length !== 1 ||
    clock(e.read_at) === null || clock(readAt) === null || clock(e.read_at)! > clock(readAt)! ||
    !validDevicePrivacyReceipt(e.native, source, e.read_at) || (family ? !familyEqual(e.source_family, family) : e.source_family !== undefined)) return false;
  const input = e.inputs[0];
  if (!object(input) || input.image_id !== source.id || input.source_url !== source.image_url || input.storage_path !== source.storage_path ||
    input.source_sha256 !== source.file_hash || !sameClock(input.created_at, source.created_at) || !sameClock(input.taken_at, source.taken_at) ||
    clock(source.created_at) === null || clock(source.created_at)! > clock(e.read_at)!) return false;
  try { if (!qualifiedSubjectInput(input as any)) return false; } catch { return false; }
  if (input.representation === "source") {
    if (input.source_bytes_qualified !== true || input.input_url !== source.image_url || !["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(input.mime_type)) return false;
  } else {
    const d = input.derivation, path = `vehicle-photos/${source.storage_path}`;
    if (!object(d) || d.trusted_origin !== ORIGIN || d.source_object_path !== path ||
      input.input_url !== `${ORIGIN}/storage/v1/render/image/public/${path}?width=1600&height=1600&resize=contain&quality=85` ||
      clock(d.source_captured_at) === null || clock(d.source_captured_at)! > clock(e.read_at)!) return false;
  }
  if (clock(input.captured_at) === null || clock(input.captured_at)! > clock(e.read_at)!) return false;
  const originalLength = input.representation === "source" ? input.byte_length : input.derivation?.source_byte_length;
  return originalLength === e.native.source_byte_length;
}

/** Shared negative/authority gate, also required before fetching any source to
 * establish its first purpose proof. Missing proof never bypasses family holds. */
function sourceAvailabilityBasis(source: unknown, userId: string) {
  if (!object(source) || source.user_id !== userId || subjectPrivacyWithdrawn(source)) return null;
  const binding = exactSourceIdentity(source), current = currentIdentitySource(source);
  if (!current || source.source_identity !== undefined && !binding) return null;
  if (binding) {
    if (!binding.lookup_complete || binding.result.status === "refused") return null;
    const lineage = binding.result.lineage;
    if (
      binding.result.status === "held" && binding.result.reason !== "source_gate_not_approved" ||
      binding.family_sources.length !== lineage.alias_image_ids.length ||
      binding.family_sources.some((s: any) => s.private_subject_privacy_complete !== true || s.user_id !== userId ||
        s.is_sensitive === true || s.is_document === true || s.vision_gate_status?.startsWith("rejected") ||
        !lineage.alias_image_ids.includes(s.id) || s.is_duplicate === true &&
          !lineage.alias_image_ids.slice(0, lineage.alias_image_ids.indexOf(s.id)).includes(s.duplicate_of))) return null;
  } else if (source.is_superseded === true || source.is_duplicate === true) return null;
  if (current.user_id !== userId || current.is_superseded === true || current.is_document === true || current.is_sensitive === true ||
    current.private_subject_privacy_complete !== true || current.vision_gate_status?.startsWith("rejected")) return null;
  return { current, binding };
}

/** Only absence of a current pending purpose proof may be bypassed by a new
 * exact native receipt. This grants permission to verify bytes, not admission. */
export function subjectSourceCanEstablishPrivacy(source: unknown, userId: string): boolean {
  const basis = sourceAvailabilityBasis(source, userId);
  return !!basis && nativePrivateSource(basis.current, userId, subjectSourceFamily(source));
}

/** Current availability is separate from the historical model-input witness.
 * Only the loader's exact audited identity can admit a known ancestor duplicate.
 * Raw flags are never rewritten to impersonate a live source. */
export function subjectSourceAvailable(source: unknown, userId: string, asOf: unknown): boolean {
  const basis = sourceAvailabilityBasis(source, userId);
  if (!basis) return false;
  const { current, binding } = basis;
  if (current.vision_gate_status === "approved") return true;
  if (!privateSubjectPrivacyQualified(current, userId, asOf, subjectSourceFamily(source))) return false;
  if (binding) {
    const latestAudit = binding.family_sources.reduce<bigint | null>((latest, row) => {
      const time = clock(row.superseded_at); return time !== null && (latest === null || time > latest) ? time : latest;
    }, null);
    if (latestAudit !== null) {
      const envelope = current.private_subject_privacy[0].confidence_basis[DEVICE_PRIVACY_METHOD].envelope;
      if (clock(envelope.read_at)! < latestAudit || clock(envelope.inputs[0].captured_at)! < latestAudit) return false;
    }
  }
  return true;
}

/** Consumers expose incomplete privacy discovery as truncated/opaque, including
 * an otherwise approved source. An absent lookup marker is not completeness. */
export function subjectPrivacyLookupComplete(sources: Array<Record<string, any>>): boolean {
  return sources.every(source => {
    const binding = exactSourceIdentity(source);
    return (!binding || binding.lookup_complete && binding.result.status !== "refused") &&
      sourceIdentityRecords([source]).every(row => row.private_subject_privacy_complete === true);
  });
}

/** Attach complete terminal testimony; explicit inactive heads are retained. */
export function attachSubjectPrivacy<T extends { id: string }>(sources: T[], heads: any[], complete: boolean): Array<T & { private_subject_privacy: any[]; private_subject_privacy_complete: boolean }> {
  return sources.map(source => ({ ...source, private_subject_privacy_complete: complete, private_subject_privacy: complete ? heads.filter(row => row.image_id === source.id &&
    row.observed_by === DEVICE_PRIVACY_METHOD && (row.superseded_by === null || row.confidence_basis?.[DEVICE_PRIVACY_METHOD]?.state === "withdrawn")) : [] }));
}

export async function hydrateSubjectPrivacy<T extends { id: string }>(client: any, userId: string, sources: T[]) {
  if (!sources.length) return sources;
  const records = sourceIdentityRecords(sources) as Array<Record<string, any> & { id: string }>;
  if (records.length > 256) return attachSourceIdentityRecords(sources, attachSubjectPrivacy(records, [], false));
  const cap = Math.min(512, records.length * 2);
  const { data, error } = await client.from("image_observations")
    .select("id,image_id,observed_by,is_active,superseded_by,confidence_basis")
    .eq("observed_by", DEVICE_PRIVACY_METHOD).eq("confidence_basis->device_privacy_v1->envelope->>user_id", userId)
    .or("superseded_by.is.null,confidence_basis->device_privacy_v1->>state.eq.withdrawn")
    .in("image_id", records.map(s => s.id)).limit(cap + 1);
  if (error || !Array.isArray(data)) throw new Error("subject_privacy_read_failed");
  return attachSourceIdentityRecords(sources, attachSubjectPrivacy(records, data.slice(0, cap), data.length <= cap));
}
