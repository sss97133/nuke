import { observationClockMicroseconds } from "../_shared/observationContentHash.ts";

export const RETAINED_VIN_MODE = "retained_vin_reference_v1";
export const RETAINED_VIN_METHOD = "protected_retained_vin_reference_v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
const FIELD_KEYS = [
  "Make",
  "Model",
  "ModelYear",
  "BodyClass",
  "VehicleType",
  "DriveType",
  "EngineCylinders",
  "EngineConfiguration",
  "DisplacementL",
  "DisplacementCC",
  "EngineHP",
  "FuelTypePrimary",
  "Doors",
  "Seats",
  "TransmissionStyle",
  "TransmissionSpeeds",
  "WheelBaseShort",
  "Trim",
  "Series",
] as const;

/** The caller supplies a source selector, never reference values or raw bytes. */
export function retainedVinSelector(
  body: Record<string, unknown>,
): string | null {
  if (
    Object.keys(body).some((k) =>
      !["mode", "revision_id", "dry_run"].includes(k)
    ) ||
    body.mode !== RETAINED_VIN_MODE || typeof body.dry_run !== "boolean"
  ) return null;
  const id = body.revision_id;
  if (typeof id === "number" && (!Number.isSafeInteger(id) || id < 1)) {
    return null;
  }
  if (typeof id !== "number" && typeof id !== "string") return null;
  const text = String(id);
  if (!/^[1-9][0-9]{0,18}$/.test(text) || BigInt(text) > 9223372036854775807n) {
    return null;
  }
  return text;
}

export interface RetainedVinContext {
  revision: {
    id: string | number;
    vehicle_id: string;
    cache_vin: string | null;
    receipt: any;
  };
  vehicle: {
    id: string;
    vin: string | null;
    is_public: boolean | null;
    deleted_at: string | null;
    listing_kind: string | null;
    status: string | null;
  };
  cache: {
    vin: string;
    provider: string | null;
    decoded_at: string | null;
    updated_at: string | null;
    body_type: string | null;
    vehicle_type: string | null;
    raw_json: string;
  };
}
const refusal = (reason: string) => ({ ok: false as const, reason });
const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const sameClock = (a: unknown, b: unknown) =>
  observationClockMicroseconds(a) !== null &&
  observationClockMicroseconds(a) === observationClockMicroseconds(b);

/** Independently verify retained bytes and immutable receipt binding. No network. */
export async function qualifyRetainedVinReference(
  context: RetainedVinContext | null,
  now = Date.now(),
) {
  if (!context?.revision || !context.vehicle || !context.cache) {
    return refusal("retained_reference_unavailable");
  }
  const { revision: r, vehicle: v, cache: c } = context;
  if (
    !retainedVinSelector({
      mode: RETAINED_VIN_MODE,
      revision_id: r.id,
      dry_run: true,
    })
  ) {
    return refusal("invalid_taxonomy_revision");
  }
  if (
    !UUID.test(v.id) || r.vehicle_id !== v.id || v.is_public !== true ||
    v.deleted_at !== null ||
    v.listing_kind === "non_vehicle_item" || v.status === "merged"
  ) return refusal("parent_not_public_real_vehicle");
  const vin = typeof v.vin === "string" ? v.vin.toUpperCase() : "";
  if (!VIN.test(vin) || c.vin !== vin || r.cache_vin !== vin) {
    return refusal("current_vin_binding_changed");
  }
  const input = r.receipt?.input;
  if (
    r.receipt?.method !== "retained_vin_taxonomy_v1" ||
    r.receipt?.reference_status !== "accepted" ||
    input?.cache_vin !== vin || typeof input?.vin !== "string" ||
    input.vin.toUpperCase() !== vin
  ) {
    return refusal("taxonomy_reference_not_qualified");
  }
  if (c.provider !== "nhtsa") return refusal("unsupported_reference_provider");
  const decoded = observationClockMicroseconds(c.decoded_at);
  if (
    decoded === null || !Number.isFinite(now) ||
    decoded > BigInt(Math.trunc(now)) * 1000n
  ) {
    return refusal("source_clock_missing_or_future");
  }
  if (
    !sameClock(input.source_recorded_at, c.decoded_at) ||
    (input.cache_updated_at !== null || c.updated_at !== null) &&
      !sameClock(input.cache_updated_at, c.updated_at)
  ) {
    return refusal("reference_changed_since_taxonomy");
  }
  if (
    c.updated_at !== null &&
    (observationClockMicroseconds(c.updated_at) === null ||
      observationClockMicroseconds(c.updated_at)! >
        BigInt(Math.trunc(now)) * 1000n)
  ) {
    return refusal("source_clock_missing_or_future");
  }
  if (
    typeof c.raw_json !== "string" ||
    new TextEncoder().encode(c.raw_json).length > 131072
  ) {
    return refusal("reference_body_unavailable_or_oversize");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(c.raw_json),
  );
  const rawSha = Array.from(
    new Uint8Array(digest),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  if (input.raw_sha256 !== rawSha) return refusal("reference_hash_changed");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(c.raw_json);
  } catch {
    return refusal("reference_body_invalid");
  }
  if (
    !raw || Array.isArray(raw) || typeof raw !== "object" ||
    typeof raw.VIN !== "string" || raw.VIN.toUpperCase() !== vin
  ) return refusal("raw_vin_binding_changed");
  if (text(raw.ErrorCode) !== "0") return refusal("reference_error_code");
  if (
    text(raw.BodyClass) !== text(c.body_type) ||
    text(raw.VehicleType) !== text(c.vehicle_type)
  ) {
    return refusal("reference_projection_mismatch");
  }
  const fields: Record<string, string> = {};
  const excluded: Record<string, string> = {};
  const numeric = new Set([
    "ModelYear",
    "EngineCylinders",
    "DisplacementL",
    "DisplacementCC",
    "EngineHP",
    "Doors",
    "Seats",
    "TransmissionSpeeds",
    "WheelBaseShort",
  ]);
  for (const key of FIELD_KEYS) {
    const value = text(raw[key]);
    if (
      value &&
      !/^(?:N\/?A|Not Applicable|Not Available|Not Reported|Unknown|0 - Not Applicable)$/i
        .test(value)
    ) {
      if (
        numeric.has(key) &&
        (value.length > 64 || !/^\d+(?:\.\d+)?$/.test(value) ||
          !Number.isFinite(Number(value)) || Number(value) <= 0)
      ) {
        excluded[key] = "unsupported_numeric_reference_value";
        continue;
      }
      fields[key] = value;
    }
  }
  if (!Object.keys(fields).length) {
    return refusal("no_supported_reference_fields");
  }
  // Reference identity excludes taxonomy processing/projection clocks. Multiple
  // revisions witnessing the same retained decode must reuse one source claim.
  const receipt = {
    method: RETAINED_VIN_METHOD,
    role: "factory_reference",
    vehicle_id: v.id,
    cache_vin: vin,
    source_sha256: rawSha,
    source_recorded_at: c.decoded_at,
    recorded_clock_basis:
      "retained_provider_decode_recording_not_manufacture_or_physical_observation",
    physical_configuration_verified: false,
    field_namespace: "nhtsa_vpic_values",
    fields,
    field_exclusions: excluded,
    raw_reference: raw,
  };
  return {
    ok: true as const,
    receipt,
    revision_id: String(r.id),
    input: {
      source_slug: "nhtsa",
      kind: "specification",
      vehicle_id: v.id,
      observed_at: c.decoded_at!,
      source_url:
        `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`,
      source_identifier: `retained-vin:${v.id}:${vin}:${rawSha}:${decoded}`,
      structured_data: { vin_reference_receipt: receipt },
      extraction_method: RETAINED_VIN_METHOD,
      raw_source_ref: `vin_decoded_data:${vin}`,
      source_vin: vin,
      source_vin_taxonomy_revision_id: String(r.id),
      agent_cost_cents: 0,
      defer_analysis: true,
      extraction_metadata: {
        supporting_taxonomy_revision_id: String(r.id),
        cache_updated_at: c.updated_at,
      },
    },
  };
}
