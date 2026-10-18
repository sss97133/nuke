/** A comparison to supplied photographs, never a canonical identity or ownership decision.
 * Profile labels and signatures are context, not an independent anchor. A novel-looking
 * subject remains discoverable even when no existing reference fits; it is not a new car
 * merely because this bounded candidate set did not contain a match.
 */
export interface ReferenceCandidate {
  label: string;
  vehicle_id: string;
  has_reference: boolean;
}

export interface FeatureComparison {
  candidate_label: string;
  relation: "supports" | "contradicts";
  query_feature: string;
  reference_feature: string;
}

export interface ReferenceDecision {
  outcome: "reference_match" | "unmatched_references" | "unknown" | "unrelated";
  candidate_vehicle_id: string | null;
  confidence: number | null;
  image_type: string;
  image_medium: string;
  comparisons: FeatureComparison[];
  reason: string;
  refusal: string | null;
  identity_admitted: false;
}

const text = (value: unknown, limit = 500): string => typeof value === "string" ? value.trim().slice(0, limit) : "";
const imageTypes = new Set(["exterior", "interior", "engine", "undercarriage", "documentation", "detail", "unrelated"]);

export function parseReferenceDecision(raw: unknown, candidates: ReferenceCandidate[]): ReferenceDecision {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const confidence = typeof value.confidence === "number" && Number.isFinite(value.confidence) &&
    value.confidence >= 0 && value.confidence <= 1 ? value.confidence : null;
  const image_type = imageTypes.has(String(value.image_type)) ? String(value.image_type) : "unknown";
  const image_medium = ["photograph", "render", "drawing", "screenshot"].includes(String(value.image_medium))
    ? String(value.image_medium) : "unknown";
  const comparisons: FeatureComparison[] = [];
  for (const item of Array.isArray(value.comparisons) ? value.comparisons.slice(0, 32) : []) {
    if (!item || typeof item !== "object") continue;
    const candidate_label = text(item.candidate_label, 16);
    const query_feature = text(item.query_feature);
    const reference_feature = text(item.reference_feature);
    if (candidates.some(c => c.label === candidate_label && c.has_reference) && query_feature && reference_feature &&
      (item.relation === "supports" || item.relation === "contradicts")) {
      comparisons.push({ candidate_label, query_feature, reference_feature, relation: item.relation });
    }
  }
  const base: ReferenceDecision = { outcome: "unknown", candidate_vehicle_id: null, confidence,
    image_type, image_medium, comparisons, reason: text(value.reason, 1000), refusal: null, identity_admitted: false };
  const refuse = (refusal: string): ReferenceDecision => ({ ...base, refusal });
  // Numeric model confidence is uncalibrated. The extraction floor only rejects
  // weak outputs; passing it never authorizes attribution or profile creation.
  if (confidence === null || confidence < 0.8) return refuse("confidence_unqualified");
  if (value.outcome === "unrelated" && image_type === "unrelated") return { ...base, outcome: "unrelated" };
  if (image_medium !== "photograph") return refuse("physical_subject_unqualified");
  if (["documentation", "unrelated", "unknown"].includes(image_type)) return refuse("identity_not_visible");
  if (value.outcome === "unknown") return base;
  if (value.outcome === "unmatched_references") {
    if (comparisons.some(e => e.relation === "supports")) return refuse("reference_exclusions_conflict");
    const references = candidates.filter(c => c.has_reference);
    if (!references.length || references.length !== candidates.length || !references.every(c =>
      comparisons.some(e => e.candidate_label === c.label && e.relation === "contradicts"))) {
      return refuse("reference_exclusions_incomplete");
    }
    return { ...base, outcome: "unmatched_references" };
  }
  if (value.outcome !== "reference_match") return refuse("outcome_invalid");
  const candidate = candidates.find(c => c.label === value.assigned_label);
  if (!candidate) return refuse("candidate_label_invalid");
  if (!candidate.has_reference) return refuse("candidate_reference_unavailable");
  const evidence = comparisons.filter(e => e.candidate_label === candidate.label);
  if (!evidence.some(e => e.relation === "supports") || evidence.some(e => e.relation === "contradicts")) {
    return refuse("candidate_comparison_unqualified");
  }
  return { ...base, outcome: "reference_match", candidate_vehicle_id: candidate.vehicle_id,
    refusal: "reference_membership_unverified" };
}

/** Response fields only. These are not a vehicle_images update: even an
 * ambiguous status would reopen a photo previously rejected as a mismatch.
 */
export function referenceDecisionProjection(decision: ReferenceDecision) {
  return {
    status: decision.outcome === "unrelated" ? "unrelated" : "ambiguous",
    suggested_vehicle_id: decision.candidate_vehicle_id,
  };
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function receiptState(metadata: unknown) {
  // NULL is an uninitialized metadata column. A present malformed value or
  // namespace must not be mistaken for an empty history and overwritten.
  const previous = metadata === null || metadata === undefined ? {} : metadata;
  if (!record(previous)) throw new Error("identity_metadata_malformed");
  const present = Object.hasOwn(previous, "image_vehicle_identity");
  const namespace = present ? previous.image_vehicle_identity : {};
  if (!record(namespace)) throw new Error("identity_receipt_namespace_malformed");
  const readings = present ? namespace.readings : [];
  if (!Array.isArray(readings) || readings.some(reading => !record(reading))) {
    throw new Error("identity_receipt_history_malformed");
  }
  if (readings.length >= 32) throw new Error("identity_receipt_budget_exhausted");
  return { previous, namespace, readings };
}

/** Run before inference so a full or malformed history never incurs a new call. */
export function assertComparisonReceiptCapacity(metadata: unknown): void {
  receiptState(metadata);
}

/** Only the comparison namespace belongs to this writer. Canonical eligibility,
 * independent serial suggestions and unrelated classifier metadata are untouched.
 * The caller still must compare-and-swap the row's updated_at token.
 */
export function comparisonReceiptPatch(metadata: unknown, reading: Record<string, unknown>): {
  ai_scan_metadata: Record<string, unknown> & {
    image_vehicle_identity: Record<string, unknown> & { readings: Record<string, unknown>[] };
  };
} {
  const { previous, namespace, readings } = receiptState(metadata);
  return { ai_scan_metadata: { ...previous,
    image_vehicle_identity: { ...namespace, readings: [...readings, reading] } } };
}
