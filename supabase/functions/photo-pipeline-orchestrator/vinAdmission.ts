import type { ClassificationResult, V2Extras } from "./classifierTypes.ts";

type Read = NonNullable<V2Extras["vin"]>;
export interface VinAdmissionContext {
  vehicleId: string;
  sourceVehicleId: string | null;
  year: number | null;
  vin: string | null;
  rule: { rule_id: number; rule_status: string; series: string | null; model_year_from: number | null; model_year_to: number | null } | null;
}
// Names and digit positions are the registered VIN series documented by
// 20261023000700_identifier_rules_pre1981_seed.sql. The SQL rule validates the
// complete make/model format; its range alone does not validate the year digit.
const YEAR_DIGIT_INDEX: Readonly<Record<string, number>> = {
  "GM 13-char 1965-71": 5,
  "GM 13-char 1971": 5,
  "GM 13-char 1972-80": 5,
  "Chevrolet 12-char 1960-64": 0,
  "Ford 11-char 1960-80": 0,
  "Mopar 13-char 1966-80": 5,
};
export type VinAdmission =
  | { admitted: true; read: Read; kind: "vin"; basis: "modern_checksum" | "pre1981_physical_plate"; modelYear?: number; ruleId?: number; ruleSeries?: string }
  | { admitted: false; reason: string };

/** Admission to existing cited evidence, not identity filing or a specification decode.
 * Short VINs use the registered make/model VIN rule. A format match never invents
 * characters or claims an ISO check digit. The original reading remains in v2. */
export function qualifyVinRead(c: ClassificationResult, context?: VinAdmissionContext): VinAdmission {
  const read = c.v2?.vin;
  if (!read) return { admitted: false, reason: "no_full_identifier_read" };
  if (read.value.length === 17) {
    if (read.checksum_ok !== true) return { admitted: false, reason: "modern_checksum_failed" };
    if ((read.confidence ?? 0) < 0.8) return { admitted: false, reason: "identifier_confidence_low" };
    return { admitted: true, read, kind: "vin", basis: "modern_checksum" };
  }
  if (read.checksum_ok !== null || read.value.length >= 17) return { admitted: false, reason: "identifier_format_unsupported" };
  if (c.image_type !== "vin_plate" || c.image_medium !== "photograph" || c.v2?.is_document ||
      !["vehicle_vin_plate", "vehicle_vin_stamp"].includes(read.evidence_role ?? ""))
    return { admitted: false, reason: "physical_vin_source_required" };
  if ((read.confidence ?? 0) < 0.9) return { admitted: false, reason: "identifier_confidence_low" };
  const tokens: string[] = (read.evidence ?? "").toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  if (!tokens.includes(read.value)) return { admitted: false, reason: "full_literal_quote_required" };
  if (!context) return { admitted: false, reason: "vehicle_context_required" };
  if (context.sourceVehicleId !== context.vehicleId) return { admitted: false, reason: "image_vehicle_changed" };
  if (!Number.isInteger(context.year) || Number(context.year) < 1886) return { admitted: false, reason: "vehicle_year_unknown" };
  if (Number(context.year) >= 1981) return { admitted: false, reason: "vehicle_year_not_pre1981" };
  const current = context.vin?.toUpperCase().replace(/[\s\-/.]/g, "");
  if (current && current !== read.value) return { admitted: false, reason: "stored_identifier_conflict" };
  const rule = context.rule;
  if (!rule || rule.rule_status !== "in_range" || !Number.isInteger(rule.rule_id) ||
      !Number.isInteger(rule.model_year_from) || !Number.isInteger(rule.model_year_to))
    return { admitted: false, reason: "pre1981_vin_rule_unavailable" };
  if (context.year! < rule.model_year_from! || context.year! > rule.model_year_to!)
    return { admitted: false, reason: "identifier_rule_year_mismatch" };
  const yearIndex = rule.series == null ? undefined : YEAR_DIGIT_INDEX[rule.series];
  if (yearIndex === undefined) return { admitted: false, reason: "identifier_year_layout_unsupported" };
  if (read.value[yearIndex] !== String(context.year! % 10))
    return { admitted: false, reason: "identifier_model_year_mismatch" };
  return { admitted: true, read, kind: "vin", basis: "pre1981_physical_plate", modelYear: context.year!, ruleId: rule.rule_id, ruleSeries: rule.series! };
}

export function vinCitation(admission: Extract<VinAdmission, { admitted: true }>) {
  return {
    checksum_ok: admission.read.checksum_ok,
    checksum_status: admission.basis === "modern_checksum" ? "passed" : "not_applicable_pre1981",
    identifier_kind: admission.kind,
    evidence_role: admission.read.evidence_role ?? null,
    admission_basis: admission.basis,
    ...(admission.modelYear === undefined ? {} : { model_year_context: admission.modelYear, model_year_basis: "vehicles.year", identifier_rule_id: admission.ruleId, identifier_rule_series: admission.ruleSeries }),
  };
}
