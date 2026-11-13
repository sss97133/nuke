import { htmlToText } from "../_shared/htmlToText.ts";
import { vinCheckDigitOk } from "../_shared/batAuctionRecord.ts";

/** Deterministic projection of publisher fields; the original payload stays in the observation. */
export function purplewaveDescription(rawDescription: unknown, rawVin: unknown) {
  const description = typeof rawDescription === "string" ? htmlToText(rawDescription) || null : null;
  const native = typeof rawVin === "string" ? rawVin.trim().toUpperCase() : "";
  // Only an explicit VIN label, never a serial number or an arbitrary 17-character token.
  const labels = [...(description ?? "").matchAll(/(?:^|\n)\s*VIN\s*:\s*([^\n]+)/gi)]
    .map(match => match[1].trim().toUpperCase());
  const candidates = [...new Set([native, ...labels].filter(Boolean))];
  const vin = candidates.length === 1 && vinCheckDigitOk(candidates[0]) === true ? candidates[0] : null;
  const vinStatus = vin ? "validated_explicit" : candidates.length > 1 ? "conflicting_explicit_values"
    : candidates.length ? "invalid_or_unsupported" : "not_stated";
  return { description, vin, vin_evidence: { status: vinStatus, candidates,
    native_field: native ? "vin" : null, description_label: labels.length ? "VIN" : null } };
}
