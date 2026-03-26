export interface HypeVehicle {
  id: string;
  year?: number;
  make?: string;
  model?: string;
  series?: string | null;
  trim?: string | null;
  engine?: string | null;
  transmission?: string | null;
  transmission_model?: string | null;
  drivetrain?: string | null;
  body_style?: string | null;
  canonical_body_style?: string | null;
  canonical_vehicle_type?: string | null;
  fuel_type?: string | null;
  current_value?: number;
  purchase_price?: number;
  sale_price?: number;
  sale_status?: string;
  sale_date?: string;
  asking_price?: number;
  display_price?: number;
  roi_pct?: number;
  image_count?: number;
  event_count?: number;
  activity_7d?: number;
  view_count?: number;
  primary_image_url?: string;
  hype_score?: number;
  hype_reason?: string;
  created_at?: string;
  updated_at?: string;
  image_url?: string;
  mileage?: number;
  vin?: string;
  is_for_sale?: boolean;
  bid_count?: number;
  auction_outcome?: string;
  all_images?: Array<{ id: string; url: string; is_primary: boolean }>;
  origin_metadata?: any;
  discovery_url?: string | null;
  discovery_source?: string | null;
  profile_origin?: string | null;
  origin_organization_id?: string | null;
  listing_start_date?: string;
  nuke_estimate?: number;
  nuke_estimate_confidence?: number;
  deal_score?: number;
  deal_score_label?: string;
  heat_score?: number;
  heat_score_label?: string;
  is_record_price?: boolean;
}

export type TimePeriod = 'ALL' | 'AT' | '1Y' | 'Q' | 'W' | 'D' | 'RT';
export type SalesTimePeriod = 'today' | '7d' | '30d' | '90d' | '1y' | '3y' | '5y' | '10y' | 'all';
export type ViewMode = 'gallery' | 'grid' | 'technical';
export type SortBy = 'year' | 'make' | 'model' | 'mileage' | 'newest' | 'oldest' | 'updated' | 'popular' | 'price_high' | 'price_low' | 'volume' | 'images' | 'events' | 'views' | 'deal_score' | 'heat_score' | 'finds';
export type SortDirection = 'asc' | 'desc';

export const SALES_PERIODS: { value: SalesTimePeriod; label: string; days: number | null }[] = [
  { value: 'today', label: 'today', days: 1 },
  { value: '7d', label: '7d', days: 7 },
  { value: '30d', label: '30d', days: 30 },
  { value: '90d', label: '90d', days: 90 },
  { value: '1y', label: '1y', days: 365 },
  { value: '3y', label: '3y', days: 365 * 3 },
  { value: '5y', label: '5y', days: 365 * 5 },
  { value: '10y', label: '10y', days: 365 * 10 },
  { value: 'all', label: 'all', days: null },
];

export interface FilterState {
  yearMin: number | null;
  yearMax: number | null;
  makes: string[];
  models: string[];
  bodyStyles: string[];
  is4x4: boolean;
  priceMin: number | null;
  priceMax: number | null;
  hasImages: boolean;
  addedTodayOnly: boolean;
  forSale: boolean;
  hideSold: boolean;
  showSoldOnly: boolean;
  privateParty: boolean;
  dealer: boolean;
  hideDealerListings: boolean;
  hideCraigslist: boolean;
  hideDealerSites: boolean;
  hideKsl: boolean;
  hideBat: boolean;
  hideClassic: boolean;
  hiddenSources?: string[];
  /** When set, only show vehicles from these sources (hero panel source filter) */
  includedSources?: string[];
  zipCode: string;
  radiusMiles: number;
  locations: Array<{ zipCode: string; radiusMiles: number; label?: string }>;
  showPending: boolean;
}

export type RalphHomepagePreset = {
  label: string;
  filters: Partial<FilterState>;
  rationale?: string;
};
