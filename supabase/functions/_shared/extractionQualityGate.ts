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
import { validateVINChecksum } from "./intelligence-layer.ts";
import { normalizeMake, normalizeVehicleFields } from "./normalizeVehicle.ts";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface FieldConfidence {
  field: string;
  value: any;
  confidence: number; // 0-1
  source: string; // 'json_ld' | 'stats_table' | 'url_slug' | 'essentials_block' | 'html_meta' | etc.
}

export interface QualityGateResult {
  /** Whether the data passes minimum quality threshold */
  pass: boolean;
  /** Quality score 0-1 */
  score: number;
  /** List of specific issues found */
  issues: string[];
  /** Recommended action */
  action: "upsert" | "flag_for_review" | "reject";
  /** Cleaned vehicle data (HTML stripped, polluted fields nulled, make normalized) */
  cleaned: Record<string, any>;
  /** Per-field confidence scores (populated when available) */
  fieldConfidence?: FieldConfidence[];
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

  // ── Check 3b: Make canonicalization ─────────────────────────────────
  if (data.make && !options.scoreOnly) {
    const normalized = normalizeMake(data.make);
    if (normalized && normalized !== data.make) {
      data.make = normalized;
    }
  }

  // ── Check 3c: Apply normalizeVehicleFields ────────────────────────
  if (!options.scoreOnly) {
    const normalized = normalizeVehicleFields(data);
    Object.assign(data, normalized);
  }

  // ── Check 3d: VIN checksum validation ──────────────────────────────
  if (data.vin) {
    const vinStr = String(data.vin).trim().toUpperCase();
    if (vinStr.length === 17) {
      // Post-1981 VIN: must pass MOD11 checksum
      if (/[IOQ]/.test(vinStr)) {
        issues.push(`vin_invalid_chars: contains I/O/Q`);
        if (!options.scoreOnly) data.vin = null;
      } else if (!validateVINChecksum(vinStr)) {
        issues.push(`vin_checksum_fail: ${vinStr}`);
        // DOUBT, not reject — could be transcription error. Keep the VIN but flag.
      }
    } else if (vinStr.length >= 6 && vinStr.length < 17) {
      // Pre-1981 chassis number — acceptable, no checksum
    } else if (vinStr.length < 6) {
      issues.push(`vin_too_short: ${vinStr.length} chars`);
      if (!options.scoreOnly) data.vin = null;
    }
  }

  // ── Check 4: Description presence ───────────────────────────────────
  const hasDescription = Boolean(
    data.description && String(data.description).trim().length > 20,
  );

  // ── Check 5: Price sanity (era-based bounds) ────────────────────────
  let priceScore = 0;
  const priceFields = ["sale_price", "asking_price", "high_bid"];
  const year = Number(data.year) || 0;

  // Era-based price bounds: {min, typicalMax, absoluteMax}
  const getPriceBounds = (yr: number): { min: number; typicalMax: number; absoluteMax: number } => {
    if (yr >= 2020) return { min: 500, typicalMax: 500_000, absoluteMax: 5_000_000 };
    if (yr >= 2000) return { min: 200, typicalMax: 500_000, absoluteMax: 5_000_000 };
    if (yr >= 1970) return { min: 100, typicalMax: 2_000_000, absoluteMax: 20_000_000 };
    if (yr >= 1950) return { min: 100, typicalMax: 5_000_000, absoluteMax: 50_000_000 };
    if (yr >= 1920) return { min: 50, typicalMax: 10_000_000, absoluteMax: 100_000_000 };
    return { min: 50, typicalMax: 20_000_000, absoluteMax: 100_000_000 }; // brass era
  };

  const bounds = year > 0 ? getPriceBounds(year) : { min: 10, typicalMax: 10_000_000, absoluteMax: 100_000_000 };

  for (const field of priceFields) {
    if (data[field] != null) {
      const price = Number(data[field]);
      if (price <= 0) {
        issues.push(`zero_or_negative_${field}: ${price}`);
      } else if (price < bounds.min && options.sourceType === "auction") {
        issues.push(`suspicious_low_${field}: $${price} (min for era: $${bounds.min})`);
      } else if (price > bounds.absoluteMax) {
        issues.push(`unrealistic_${field}: $${price.toLocaleString()} (absolute max: $${bounds.absoluteMax.toLocaleString()})`);
      } else if (price > bounds.typicalMax) {
        issues.push(`atypical_high_${field}: $${price.toLocaleString()} (typical max: $${bounds.typicalMax.toLocaleString()})`);
        priceScore = 0.5; // flag but don't reject
      } else {
        priceScore = 1;
      }
    }
  }

  // ── Check 5b: Cross-field consistency ──────────────────────────────
  // Reserve not met + sale_price > 0 = conflict
  if (
    String(data.reserve_status || "").toLowerCase() === "reserve_not_met" &&
    data.sale_price != null && Number(data.sale_price) > 0
  ) {
    issues.push("cross_field_conflict: reserve_not_met but sale_price > 0");
  }

  // Year < 1950 + mileage > 500K = suspicious
  if (year > 0 && year < 1950 && data.mileage != null && Number(data.mileage) > 500_000) {
    issues.push(`suspicious_mileage_for_era: ${data.mileage} miles for ${year} vehicle`);
  }

  // Mileage > 1M = suspicious for any vehicle
  if (data.mileage != null && Number(data.mileage) > 1_000_000) {
    issues.push(`extreme_mileage: ${data.mileage}`);
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
