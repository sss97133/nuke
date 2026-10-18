/**
 * NHTSA vPIC VIN decode — one shared client.
 *
 * Callers: batch-vin-decode (fills factory specs on held vehicles) and
 * api-v1-vin-lookup (answers a VIN Nuke does not hold with a cited factory
 * decode instead of a bare 404). Free, no key. 17-character VINs only; pre-1981
 * VINs go to _shared/vin-decoder.ts.
 *
 * Every datum returned carries its source: the field names are NHTSA's own
 * variable names, and decodeVinRaw() keeps ErrorCode / ErrorText so a caller
 * can show how clean the decode was.
 */

export const NHTSA_BATCH_URL = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVINValuesBatch/";

// NHTSA field mapping: vPIC *Values* endpoints (DecodeVinValues, DecodeVINValuesBatch)
// return CamelCase keys. The earlier map used the spaced "Variable" names of the
// non-Values endpoint ("Model Year", "Body Class"), which the batch endpoint never
// returns, so only Make/Model/Doors/Trim/Series ever matched (verified against the
// live API 2026-10-06). Keys here are what the batch endpoint actually sends.
// `col` names are vehicles columns batch-vin-decode may fill; keep them as-is.
export const NHTSA_FIELD_MAP: Record<string, { col: string; transform?: (v: string) => any }> = {
  "Make": { col: "make" },
  "Model": { col: "model" },
  "ModelYear": { col: "year", transform: (v) => parseInt(v) || null },
  "BodyClass": { col: "body_style" },
  "DriveType": { col: "drivetrain", transform: normalizeDrivetrain },
  "TransmissionStyle": { col: "transmission_type" },
  "TransmissionSpeeds": { col: "transmission_speeds", transform: (v) => parseInt(v) || null },
  "EngineCylinders": { col: "engine_type", transform: (v) => `${v}-Cylinder` },
  "DisplacementL": { col: "engine_liters", transform: (v) => (Math.round(parseFloat(v) * 10) / 10) || null },
  "DisplacementCC": { col: "engine_displacement", transform: (v) => `${Math.round(parseFloat(v))}cc` },
  "EngineHP": { col: "horsepower", transform: (v) => parseInt(v) || null },
  "FuelTypePrimary": { col: "fuel_type" },
  "Doors": { col: "doors", transform: (v) => parseInt(v) || null },
  "Seats": { col: "seats", transform: (v) => parseInt(v) || null },
  "WheelBaseShort": { col: "wheelbase_inches", transform: (v) => parseFloat(v) || null },
  "Trim": { col: "trim" },
  "Series": { col: "series" },
  // PlantCity is deliberately not mapped to vehicles.location: location is where the
  // vehicle is, not where it was built. It is returned as plant_city in the decode only.
};

/** Extra reference fields for the decode-fallback answer only (not vehicles columns). */
const NHTSA_EXTRA_FIELDS: Record<string, string> = {
  "Manufacturer": "manufacturer",
  "PlantCity": "plant_city",
  "PlantCountry": "plant_country",
  "VehicleType": "vehicle_type",
  "EngineConfiguration": "engine_configuration",
  "EngineModel": "engine_model",
  "GVWR": "gvwr_class",
};

export function normalizeDrivetrain(v: string): string | null {
  const lower = v.toLowerCase();
  if (lower.includes("4x4") || lower.includes("4wd") || lower.includes("four wheel")) return "4WD";
  if (lower.includes("awd") || lower.includes("all wheel") || lower.includes("all-wheel")) return "AWD";
  if (lower.includes("fwd") || lower.includes("front wheel") || lower.includes("front-wheel")) return "FWD";
  if (lower.includes("rwd") || lower.includes("rear wheel") || lower.includes("rear-wheel")) return "RWD";
  return v;
}

function isMeaningful(val: unknown): val is string {
  return typeof val === "string" && val !== "" && val !== "Not Applicable" && val !== "0" && val !== "0.0";
}

/** POST up to 50 VINs; returns the raw NHTSA result item per VIN (all variables, as NHTSA names them). */
export async function decodeVinsRaw(vins: string[], timeoutMs = 30000): Promise<Map<string, Record<string, string>>> {
  const body = new URLSearchParams();
  body.append("format", "json");
  body.append("data", vins.join(";"));
  const resp = await fetch(NHTSA_BATCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) throw new Error(`NHTSA API returned ${resp.status}`);
  const data = await resp.json();
  const results = new Map<string, Record<string, string>>();
  for (const item of data?.Results ?? []) {
    if (item?.VIN) results.set(String(item.VIN).toUpperCase(), item);
  }
  return results;
}

/** Same call, but only the NHTSA_FIELD_MAP keys with meaningful values (what batch-vin-decode consumes). */
export async function decodeVinsBatch(vins: string[]): Promise<Map<string, Record<string, string>>> {
  const raw = await decodeVinsRaw(vins);
  const results = new Map<string, Record<string, string>>();
  for (const [vin, item] of raw) {
    const fields: Record<string, string> = {};
    for (const nhtsaKey of Object.keys(NHTSA_FIELD_MAP)) {
      const val = item[nhtsaKey];
      if (isMeaningful(val)) fields[nhtsaKey] = val;
    }
    results.set(vin, fields);
  }
  return results;
}

export interface NhtsaDecode {
  /** Mapped to our column names via NHTSA_FIELD_MAP, transforms applied. */
  fields: Record<string, unknown>;
  /** NHTSA's own verdict on the decode. "0" = clean; "1" = check digit mismatch, etc. */
  error_code: string | null;
  error_text: string | null;
  source: { name: string; method: string; url: string; fetched_at: string };
}

/** Decode one 17-character VIN. Returns null when NHTSA has nothing (no make and no year). */
export async function decodeOneVin(vin: string, timeoutMs = 8000): Promise<NhtsaDecode | null> {
  const clean = vin.trim().toUpperCase();
  const raw = await decodeVinsRaw([clean], timeoutMs);
  const item = raw.get(clean);
  if (!item) return null;
  const fields: Record<string, unknown> = {};
  for (const [nhtsaKey, mapping] of Object.entries(NHTSA_FIELD_MAP)) {
    const val = item[nhtsaKey];
    if (!isMeaningful(val)) continue;
    const out = mapping.transform ? mapping.transform(val) : val;
    if (out !== null && out !== undefined && out !== "") fields[mapping.col] = out;
  }
  for (const [nhtsaKey, name] of Object.entries(NHTSA_EXTRA_FIELDS)) {
    const val = item[nhtsaKey];
    if (isMeaningful(val)) fields[name] = val;
  }
  if (!fields.make && !fields.year) return null;
  return {
    fields,
    error_code: isMeaningful(item.ErrorCode) ? item.ErrorCode : (item.ErrorCode === "0" ? "0" : null),
    error_text: typeof item.ErrorText === "string" && item.ErrorText ? item.ErrorText : null,
    source: { name: "NHTSA vPIC", method: "DecodeVINValuesBatch", url: NHTSA_BATCH_URL, fetched_at: new Date().toISOString() },
  };
}
