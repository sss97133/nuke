/**
 * Extraction Quality Gate — Validates vehicle data BEFORE upsert.
 *
 * Every extractor must call qualityGate() before writing to the vehicles table.
 * This prevents garbage data (HTML in fields, model=full title, $5 sale prices)
 * from entering the database.
 *
 * Usage:
 *   import { qualityGate } from "../_shared/extractionQualityGate.ts";
 *
 *   const result = qualityGate(vehicleData, { source: 'mecum', sourceType: 'auction' });
 *   if (result.action === 'reject') { console.log('Rejected:', result.issues); return; }
 *   if (result.action === 'flag_for_review') { vehicleData.needs_review = true; }
 *   // proceed with upsert
 */

import { containsHtml, isPollutedField, cleanFieldValue } from "./pollutionDetector.ts";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface QualityGateResult {
  /** Whether the data passes minimum quality threshold */
  pass: boolean;
  /** Quality score 0-1 */
  score: number;
  /** List of specific issues found */
  issues: string[];
  /** Recommended action */
  action: "upsert" | "flag_for_review" | "reject";
  /** Cleaned vehicle data (HTML stripped, polluted fields nulled) */
  cleaned: Record<string, any>;
}

export interface QualityGateOptions {
  /** Data source platform */
  source: string;
  /** Source type for scoring weight adjustments */
  sourceType?: "auction" | "dealer" | "marketplace" | "registry" | "other";
  /** Custom reject threshold (default: 0.2) */
  rejectThreshold?: number;
  /** Custom review threshold (default: 0.5) */
  reviewThreshold?: number;
  /** Skip cleaning (just score, don't modify data) */
  scoreOnly?: boolean;
}

// ─── Core quality gate ─────────────────────────────────────────────────────

export function qualityGate(
  vehicleData: Record<string, any>,
  options: QualityGateOptions,
): QualityGateResult {
  const issues: string[] = [];
  const source = options.source;
  const rejectThreshold = options.rejectThreshold ?? 0.2;
  const reviewThreshold = options.reviewThreshold ?? 0.5;

  // Work on a copy
  const data = { ...vehicleData };

  // ── Check 1: Identity fields (year/make/model) ──────────────────────
  let identityScore = 0;
  const identityMax = 3;

  if (data.year) {
    const year = Number(data.year);
    if (year >= 1885 && year <= new Date().getFullYear() + 2) {
      identityScore += 1;
    } else {
      issues.push(`invalid_year: ${year}`);
    }
  } else {
    issues.push("missing_year");
  }

  if (data.make && String(data.make).trim().length > 0) {
    if (isPollutedField("make", data.make, { platform: source })) {
      issues.push(`polluted_make: "${String(data.make).slice(0, 60)}"`);
      if (!options.scoreOnly) data.make = null;
    } else {
      identityScore += 1;
    }
  } else {
    issues.push("missing_make");
  }

  if (data.model && String(data.model).trim().length > 0) {
    const model = String(data.model).trim();
    if (model.length > 80) {
      issues.push(`model_too_long: ${model.length} chars (full title stuffed in model)`);
      if (!options.scoreOnly) data.model = null;
    } else if (isPollutedField("model", data.model, { platform: source })) {
      issues.push(`polluted_model: "${model.slice(0, 60)}"`);
      if (!options.scoreOnly) data.model = null;
    } else {
      identityScore += 1;
    }
  } else {
    issues.push("missing_model");
  }

  // ── Check 2: HTML contamination in text fields ──────────────────────
  const textFields = [
    "description", "color", "exterior_color", "interior_color",
    "transmission", "drivetrain", "engine", "engine_type", "engine_size",
    "body_style", "listing_title",
  ];
  let htmlContaminationCount = 0;

  for (const field of textFields) {
    if (data[field] && containsHtml(String(data[field]))) {
      htmlContaminationCount++;
      issues.push(`html_in_${field}`);
      if (!options.scoreOnly) {
        data[field] = cleanFieldValue(field, data[field], { platform: source });
      }
    }
  }

  // ── Check 3: Pollution in structured fields ─────────────────────────
  const specFields = ["transmission", "drivetrain", "engine", "engine_type", "engine_size", "body_style", "color", "exterior_color", "interior_color"];
  let pollutedFieldCount = 0;

  for (const field of specFields) {
    if (data[field] && !containsHtml(String(data[field]))) { // Don't double-count HTML
      if (isPollutedField(field, data[field], { platform: source })) {
        pollutedFieldCount++;
        issues.push(`polluted_${field}: "${String(data[field]).slice(0, 50)}"`);
        if (!options.scoreOnly) data[field] = null;
      }
    }
  }

  // ── Check 4: Description presence ───────────────────────────────────
  const hasDescription = Boolean(
    data.description && String(data.description).trim().length > 20,
  );

  // ── Check 5: Price sanity ───────────────────────────────────────────
  let priceScore = 0;
  const priceFields = ["sale_price", "asking_price", "high_bid"];
  for (const field of priceFields) {
    if (data[field] != null) {
      const price = Number(data[field]);
      if (price <= 0) {
        issues.push(`zero_or_negative_${field}: ${price}`);
      } else if (price < 10 && options.sourceType === "auction") {
        issues.push(`suspicious_low_${field}: $${price}`);
      } else if (price > 100_000_000) {
        issues.push(`unrealistic_${field}: $${price.toLocaleString()}`);
      } else {
        priceScore = 1;
      }
    }
  }

  // ── Check 6: Spec completeness ──────────────────────────────────────
  let specScore = 0;
  let specMax = 0;
  const optionalSpecs = [
    { field: "vin", weight: 1 },
    { field: "mileage", weight: 1 },
    { field: "transmission", weight: 0.5 },
    { field: "engine", weight: 0.5 },
    { field: "engine_size", weight: 0.5 },
    { field: "engine_type", weight: 0.5 },
    { field: "color", weight: 0.3 },
    { field: "exterior_color", weight: 0.3 },
    { field: "interior_color", weight: 0.3 },
    { field: "drivetrain", weight: 0.3 },
    { field: "body_style", weight: 0.3 },
  ];

  for (const spec of optionalSpecs) {
    specMax += spec.weight;
    const val = data[spec.field];
    if (val != null && String(val).trim().length > 0) {
      specScore += spec.weight;
    }
  }

  // ── Calculate overall score ─────────────────────────────────────────
  // Weights: identity=40%, description=20%, specs=20%, price=10%, cleanliness=10%
  const identityPct = identityScore / identityMax;
  const descriptionPct = hasDescription ? 1 : 0;
  const specsPct = specMax > 0 ? specScore / specMax : 0;
  const pricePct = priceScore;
  const cleanlinessDeductions = (htmlContaminationCount * 0.15) + (pollutedFieldCount * 0.1);
  const cleanlinessPct = Math.max(0, 1 - cleanlinessDeductions);

  const score = Math.min(1, Math.max(0,
    identityPct * 0.40 +
    descriptionPct * 0.20 +
    specsPct * 0.20 +
    pricePct * 0.10 +
    cleanlinessPct * 0.10
  ));

  // ── Determine action ────────────────────────────────────────────────
  let action: "upsert" | "flag_for_review" | "reject";
  if (score < rejectThreshold) {
    action = "reject";
  } else if (score < reviewThreshold) {
    action = "flag_for_review";
  } else {
    action = "upsert";
  }

  // Hard reject: no identity at all
  if (identityScore === 0) {
    action = "reject";
    if (!issues.includes("no_identity_fields")) {
      issues.push("no_identity_fields");
    }
  }

  return {
    pass: action !== "reject",
    score: Math.round(score * 1000) / 1000,
    issues,
    action,
    cleaned: options.scoreOnly ? vehicleData : data,
  };
}

/**
 * Convenience: run quality gate and return cleaned data if it passes.
 * Returns null if the data should be rejected.
 */
export function gateAndClean(
  vehicleData: Record<string, any>,
  options: QualityGateOptions,
): { data: Record<string, any>; score: number; issues: string[] } | null {
  const result = qualityGate(vehicleData, options);

  if (result.action === "reject") {
    console.warn(
      `[qualityGate] REJECTED (score=${result.score}): ${result.issues.join(", ")}`,
    );
    return null;
  }

  if (result.action === "flag_for_review") {
    console.warn(
      `[qualityGate] FLAGGED for review (score=${result.score}): ${result.issues.join(", ")}`,
    );
  }

  return {
    data: result.cleaned,
    score: result.score,
    issues: result.issues,
  };
}
