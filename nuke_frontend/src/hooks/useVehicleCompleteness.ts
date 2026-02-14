/**
 * useVehicleCompleteness — structured completeness analysis for vehicles.
 *
 * Expanded to 19 fields (vs original 10), grouped by importance:
 * - critical: year, make, model, vin, mileage, any_price
 * - important: transmission, engine, exterior_color, interior_color, location, body_style
 * - nice_to_have: drivetrain, fuel_type, paint_code, msrp, description, has_images, has_timeline
 */

export type FieldImportance = 'critical' | 'important' | 'nice_to_have';

export interface CompletenessField {
  key: string;
  label: string;
  importance: FieldImportance;
  filled: boolean;
  /** Suggested action when missing */
  action?: string;
}

export interface VehicleCompleteness {
  fields: CompletenessField[];
  filledCount: number;
  totalCount: number;
  percent: number;
  byImportance: Record<FieldImportance, { filled: number; total: number }>;
}

const FIELD_DEFS: { key: string; label: string; importance: FieldImportance; action?: string }[] = [
  // Critical
  { key: 'year', label: 'Year', importance: 'critical' },
  { key: 'make', label: 'Make', importance: 'critical' },
  { key: 'model', label: 'Model', importance: 'critical' },
  { key: 'vin', label: 'VIN', importance: 'critical', action: 'Add VIN' },
  { key: 'mileage', label: 'Mileage', importance: 'critical', action: 'Snap your odometer' },
  { key: 'any_price', label: 'Any Price', importance: 'critical', action: 'Add MSRP or asking price' },
  // Important
  { key: 'transmission', label: 'Transmission', importance: 'important', action: 'Detect from images' },
  { key: 'engine', label: 'Engine', importance: 'important', action: 'Detect from images' },
  { key: 'exterior_color', label: 'Exterior Color', importance: 'important', action: 'What color is this?' },
  { key: 'interior_color', label: 'Interior Color', importance: 'important' },
  { key: 'location', label: 'Location', importance: 'important' },
  { key: 'body_style', label: 'Body Style', importance: 'important' },
  // Nice to have
  { key: 'drivetrain', label: 'Drivetrain', importance: 'nice_to_have' },
  { key: 'fuel_type', label: 'Fuel Type', importance: 'nice_to_have' },
  { key: 'paint_code', label: 'Paint Code', importance: 'nice_to_have', action: 'Know the paint code?' },
  { key: 'msrp', label: 'MSRP', importance: 'nice_to_have', action: 'Add MSRP' },
  { key: 'description', label: 'Description', importance: 'nice_to_have' },
  { key: 'has_images', label: '1+ Image', importance: 'nice_to_have', action: 'Upload photos' },
  { key: 'has_timeline', label: '1+ Timeline Event', importance: 'nice_to_have', action: 'Add history' },
];

function isPresent(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === 'string' && val.trim() === '') return false;
  if (typeof val === 'number' && val === 0) return false;
  return true;
}

export function computeVehicleCompleteness(vehicle: Record<string, any>): VehicleCompleteness {
  const fields: CompletenessField[] = FIELD_DEFS.map((def) => {
    let filled = false;

    switch (def.key) {
      case 'any_price':
        filled = isPresent(vehicle.sale_price) || isPresent(vehicle.asking_price) ||
                 isPresent(vehicle.current_value) || isPresent(vehicle.display_price) ||
                 isPresent(vehicle.msrp);
        break;
      case 'has_images':
        filled = (vehicle.image_count ?? 0) > 0;
        break;
      case 'has_timeline':
        filled = (vehicle.event_count ?? 0) > 0;
        break;
      case 'paint_code':
        filled = isPresent(vehicle.paint_code) || isPresent(vehicle.color_code);
        break;
      case 'msrp':
        filled = isPresent(vehicle.msrp) || isPresent(vehicle.original_msrp);
        break;
      default:
        filled = isPresent(vehicle[def.key]);
    }

    return { ...def, filled };
  });

  const filledCount = fields.filter(f => f.filled).length;
  const totalCount = fields.length;

  const byImportance: Record<FieldImportance, { filled: number; total: number }> = {
    critical: { filled: 0, total: 0 },
    important: { filled: 0, total: 0 },
    nice_to_have: { filled: 0, total: 0 },
  };

  for (const f of fields) {
    byImportance[f.importance].total++;
    if (f.filled) byImportance[f.importance].filled++;
  }

  return {
    fields,
    filledCount,
    totalCount,
    percent: Math.round((filledCount / totalCount) * 100),
    byImportance,
  };
}
