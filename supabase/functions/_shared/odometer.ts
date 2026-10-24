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
