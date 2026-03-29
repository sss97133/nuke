/**
 * QI Explorer — shared constants and types
 */

export interface TaxonomyRow {
  taxonomy_id: string;
  l1_category: string;
  l2_subcategory: string;
  display_name: string;
  description?: string;
  answerable_from_db: boolean;
  data_fields: string[] | null;
  question_count: number;
  vehicle_count: number;
  avg_sale_price: number;
  median_sale_price: number;
  pct_of_all_questions: number;
  seller_response_pct: number;
  regex_classified: number;
  llm_classified: number;
}

export const L1_COLORS: Record<string, string> = {
  mechanical:      '#7d6b91',
  provenance:      '#6b9d7d',
  condition:       '#9d8b6b',
  functionality:   '#6b8b9d',
  logistics:       '#8b6b7d',
  auction_process: '#7d9d6b',
  general:         '#9d6b6b',
};

export const fmtK = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
};

export const fmt = (n: number) => n?.toLocaleString() ?? '—';

/** Whitelist of valid vehicle table columns that can appear in data_fields */
const VALID_FIELD_COLUMNS = new Set([
  'engine_type', 'engine_displacement', 'engine_cylinders', 'engine_aspiration',
  'transmission_type', 'transmission_speeds', 'drivetrain',
  'exterior_color', 'interior_color', 'interior_material',
  'body_style', 'num_doors', 'wheelbase',
  'vin', 'mileage', 'condition_score',
  'sale_price', 'asking_price', 'reserve_price',
  'title_status', 'service_history', 'accident_history',
  'modifications', 'options', 'production_number',
  'tire_size', 'wheel_size', 'wheel_type',
  'fuel_type', 'horsepower', 'torque',
  'curb_weight', 'towing_capacity', 'payload_capacity',
  'suspension_type', 'brake_type', 'steering_type',
  'description', 'highlights', 'known_flaws',
]);

/** Validate a field name against whitelist to prevent SQL injection */
export function isValidFieldColumn(field: string): boolean {
  return VALID_FIELD_COLUMNS.has(field);
}
