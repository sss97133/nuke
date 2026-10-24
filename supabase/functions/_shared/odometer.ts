// Odometer readings keep the unit the source stated (Skylar's rule: never silently convert).
// vehicles.mileage stays in miles; odometer_reading/odometer_unit keep the source figure, and the
// conversion is recorded explicitly in mileage_normalized_* (method, confidence, source).

export type OdometerUnit = "mi" | "km";
export interface Odometer {
  value: number;
  unit: OdometerUnit | null;
}

export const KM_TO_MI = 0.621371;

export function unitFromText(s: string | null | undefined): OdometerUnit | null {
  if (!s) return null;
  if (/\b(km|kms|kilomet(?:er|re)s?)\b/i.test(s)) return "km";
  if (/\b(mi|miles?)\b/i.test(s)) return "mi";
  return null;
}

export function toMiles(o: Odometer): number {
  return o.unit === "km" ? Math.round(o.value * KM_TO_MI) : o.value;
}

export interface OdometerColumns {
  mileage?: number;
  odometer_reading?: number;
  odometer_unit?: OdometerUnit | null;
  odometer_source_url?: string | null;
  mileage_normalized_miles?: number;
  mileage_normalized_method?: string;
  mileage_normalized_confidence?: "high" | "low";
  mileage_normalized_source?: string;
}

/** Columns to spread into a vehicles insert/update ({} when there is no reading). */
export function odometerColumns(o: Odometer | null, writer: string, sourceUrl?: string | null): OdometerColumns {
  if (!o || !(o.value > 0)) return {};
  const miles = toMiles(o);
  return {
    mileage: miles,
    odometer_reading: o.value,
    odometer_unit: o.unit,
    odometer_source_url: sourceUrl ?? null,
    mileage_normalized_miles: miles,
    mileage_normalized_method: o.unit === "km" ? "km_to_mi_x0.621371" : o.unit === "mi" ? "as_stated_mi" : "unit_unknown_assumed_mi",
    mileage_normalized_confidence: o.unit ? "high" : "low",
    mileage_normalized_source: writer,
  };
}

// Placeholder ("sentinel") odometer values that sellers type when the real reading is unknown.
// Rule placeholder_sentinel_v1 (run mileage_status_placeholder_v1_20261024): the value is kept on
// vehicles.mileage but a public.mileage_value_status row (status 'suspect') hides it from loaders
// and valuation readers. 1 / 12 / 123 / 9999 are deliberately excluded (too often real).
export const PLACEHOLDER_MILEAGES: ReadonlySet<number> = new Set([
  1234, 11111, 12345, 99999, 111111, 123456, 222222, 333333, 444444, 555555, 666666, 777777, 888888,
  999999, 1111111, 1234567, 9999999,
]);

export function isPlaceholderMileage(v: number | null | undefined): boolean {
  return typeof v === "number" && PLACEHOLDER_MILEAGES.has(v);
}

export interface MileageStatusRow {
  vehicle_id: string;
  field: "vehicles.mileage";
  value: number;
  status: "suspect";
  reason: "placeholder_sentinel";
  source_url: string | null;
  evidence: string;
  run_id: string;
  old_vehicle_mileage: number;
}

/** mileage_value_status row for a placeholder value, or null when the value is not a sentinel. */
export function placeholderMileageStatusRow(
  vehicleId: string, miles: number | null | undefined, writer: string, sourceUrl?: string | null,
): MileageStatusRow | null {
  if (!vehicleId || !isPlaceholderMileage(miles)) return null;
  return {
    vehicle_id: vehicleId, field: "vehicles.mileage", value: miles as number, status: "suspect",
    reason: "placeholder_sentinel", source_url: sourceUrl ?? null,
    evidence: `rule placeholder_sentinel_v1 (_shared/odometer.ts isPlaceholderMileage): value ${miles} written by ${writer}; status only, vehicles.mileage unchanged`,
    run_id: `placeholder_sentinel_v1_writer_${writer}`, old_vehicle_mileage: miles as number,
  };
}

// deno-lint-ignore no-explicit-any
type MinimalClient = { from: (t: string) => any };

/** Best-effort: flag a just-written placeholder mileage. Never throws; logs on error. */
export async function flagPlaceholderMileage(
  client: MinimalClient, vehicleId: string, miles: number | null | undefined, writer: string, sourceUrl?: string | null,
): Promise<boolean> {
  const row = placeholderMileageStatusRow(vehicleId, miles, writer, sourceUrl);
  if (!row) return false;
  try {
    const { error } = await client.from("mileage_value_status").insert(row);
    if (error) { console.error(`[odometer] placeholder flag ${vehicleId}: ${error.message}`); return false; }
    return true;
  } catch (e) {
    console.error(`[odometer] placeholder flag ${vehicleId}: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}
