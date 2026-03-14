/** Theme mode for widgets */
export type WidgetTheme = 'light' | 'dark' | 'inherit';

/** Racing accent colorways */
export type WidgetAccent = 'neutral' | 'gulf' | 'martini' | 'ricard' | 'rosso';

/** Common attributes shared by all widgets */
export interface WidgetBaseAttributes {
  'api-key'?: string;
  'user-token'?: string;
  theme?: WidgetTheme;
  accent?: WidgetAccent;
}

/** Vehicle data shape returned by api-v1-vehicles */
export interface VehicleData {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  series: string | null;
  vin: string | null;
  mileage: number | null;
  color: string | null;
  interior_color: string | null;
  transmission: string | null;
  engine_type: string | null;
  engine_displacement: string | null;
  drivetrain: string | null;
  body_style: string | null;
  sale_price: number | null;
  purchase_price: number | null;
  description: string | null;
  is_public: boolean;
  primary_image_url: string | null;
  created_at: string;
  updated_at: string;
}

/** VIN lookup response from api-v1-vin-lookup */
export interface VinLookupResult {
  vehicle: VehicleData | null;
  valuation: ValuationData | null;
  listing_count: number;
  observation_count: number;
  images: Array<{ url: string }>;
}

/** Valuation data from nuke_estimates */
export interface ValuationData {
  estimated_value: number | null;
  value_low: number | null;
  value_high: number | null;
  confidence_score: number | null;       // 0-100 scale
  deal_score: number | null;             // raw score (can be negative)
  deal_score_label: string | null;       // e.g. "minus_3", "great_deal"
  heat_score: number | null;             // raw score
  heat_score_label: string | null;       // e.g. "cold", "hot", "warm"
  price_tier: string | null;
  model_version: string | null;
}

/** Comparable sale (matches api-v1-comps response shape) */
export interface CompSale {
  vehicle_id?: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim?: string | null;
  vin?: string | null;
  sale_price: number | null;
  mileage?: number | null;
  color?: string | null;
  image_url?: string | null;
  location?: string | null;
  listing_url?: string | null;
  platform: string | null;
  platform_raw?: string | null;
  sold_date: string | null;
  source_type?: string | null;
}

/** Comps API response */
export interface CompsResult {
  data: CompSale[];
  summary: {
    count: number;
    avg_price: number;
    median_price: number;
    min_price: number;
    max_price: number;
    auction_event_count: number;
  };
  query: Record<string, unknown>;
}

/** Vision classification result */
export interface VisionResult {
  make: string;
  confidence: number;
  top5: Array<{ label: string; confidence: number }>;
  is_vehicle?: boolean;
  family?: string;
  family_confidence?: number;
  source?: string;
  ms?: number;
  cost_usd?: number;
}

/** Vision analysis result (full mode) */
export interface VisionAnalysisResult extends VisionResult {
  vehicle_zone?: string;
  zone_confidence?: number;
  condition_score?: number;
  damage_flags?: string[];
  modification_flags?: string[];
  interior_quality?: string;
  photo_quality?: string;
  photo_type?: string;
  comps?: CompSale[];
  classify_ms?: number;
  analyze_ms?: number;
  elapsed_ms?: number;
}
