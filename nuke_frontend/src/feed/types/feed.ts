/**
 * Feed module types — superset of legacy feedTypes.ts
 *
 * These types define the server response shape (FeedVehicle),
 * query parameters (FeedQueryParams), and view configuration
 * for the new feed system.
 */

// Re-export legacy types for backward compatibility
export type {
  FilterState,
  TimePeriod,
  SalesTimePeriod,
  ViewMode,
  SortBy,
  SortDirection,
  RalphHomepagePreset,
} from '../../types/feedTypes';
export { SALES_PERIODS } from '../../types/feedTypes';

// ---------------------------------------------------------------------------
// Server response types (from feed-query edge function)
// ---------------------------------------------------------------------------

/** A vehicle as returned by the feed-query endpoint — pre-enriched server-side. */
export interface FeedVehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  series?: string | null;
  trim?: string | null;
  vin?: string | null;
  mileage?: number | null;
  body_style?: string | null;
  canonical_body_style?: string | null;
  canonical_vehicle_type?: string | null;
  transmission?: string | null;
  transmission_model?: string | null;
  drivetrain?: string | null;
  fuel_type?: string | null;
  engine_size?: string | null;

  // Price fields (server resolves display_price)
  display_price: number | null;
  price_source: PriceSource;
  sale_price?: number | null;
  asking_price?: number | null;
  current_value?: number | null;
  purchase_price?: number | null;
  msrp?: number | null;
  sale_date?: string | null;
  sale_status?: string | null;
  auction_outcome?: string | null;
  is_for_sale: boolean;

  // Valuation
  nuke_estimate?: number | null;
  nuke_estimate_confidence?: number | null;
  deal_score?: number | null;
  deal_score_label?: string | null;
  heat_score?: number | null;
  heat_score_label?: string | null;
  is_record_price?: boolean;
  feed_rank_score?: number | null;

  // Image (resolved server-side)
  thumbnail_url: string | null;
  image_count?: number | null;

  // Source & provenance
  discovery_url?: string | null;
  discovery_source?: string | null;
  profile_origin?: string | null;
  origin_organization_id?: string | null;

  // Auction state (resolved server-side from external_listings)
  auction_end_date?: string | null;
  current_bid?: number | null;
  bid_count?: number | null;
  listing_status?: string | null;
  listing_url?: string | null;

  // Data quality
  data_completeness_tier?: string | null;

  // Timestamps
  created_at: string;
  updated_at?: string | null;
}

export type PriceSource =
  | 'sale'
  | 'live_bid'
  | 'winning_bid'
  | 'high_bid'
  | 'current_bid'
  | 'asking'
  | 'estimate'
  | 'purchase'
  | 'msrp'
  | 'none';

// ---------------------------------------------------------------------------
// Resolved price (output of feedPriceResolution.ts)
// ---------------------------------------------------------------------------

export interface ResolvedPrice {
  /** The numeric amount, or null if no price available */
  amount: number | null;
  /** Formatted string (e.g. "$142,000" or "—") */
  formatted: string;
  /** Which price field was used */
  source: PriceSource;
  /** True if this is a live auction bid */
  isLive: boolean;
  /** True if the vehicle has sold */
  isSold: boolean;
  /** True if auction ended without sale (RNM, no_sale) */
  isResult: boolean;
  /** Badge text: "SOLD $142,000", "BID", "RESULT $98,000", or just the formatted price */
  badgeText: string;
  /** Whether the sold badge should be displayed (within 30-day window) */
  showSoldBadge: boolean;
}

// ---------------------------------------------------------------------------
// Feed query types (for the feed-query edge function)
// ---------------------------------------------------------------------------

export interface FeedQueryParams {
  q?: string;
  year_min?: number;
  year_max?: number;
  makes?: string[];
  models?: string[];
  body_styles?: string[];
  price_min?: number;
  price_max?: number;
  is_4x4?: boolean;
  for_sale?: boolean;
  sold_only?: boolean;
  hide_sold?: boolean;
  has_images?: boolean;
  excluded_sources?: string[];
  sort: FeedSortField;
  direction: 'asc' | 'desc';
  cursor?: string;
  limit?: number;
  zip?: string;
  radius_miles?: number;
}

export type FeedSortField =
  | 'newest'
  | 'oldest'
  | 'deal_score'
  | 'heat_score'
  | 'price_high'
  | 'price_low'
  | 'year'
  | 'make'
  | 'mileage'
  | 'feed_rank';

export interface FeedQueryResponse {
  items: FeedVehicle[];
  next_cursor: string | null;
  total_estimate: number;
  stats: FeedStats;
}

export interface FeedStats {
  total_vehicles: number;
  total_value: number;
  for_sale_count: number;
  active_auctions: number;
  avg_price: number;
  vehicles_added_today: number;
  sales_count_today: number;
  sales_volume_today: number;
}

// ---------------------------------------------------------------------------
// View configuration
// ---------------------------------------------------------------------------

export interface FeedViewConfig {
  viewMode: 'grid' | 'gallery' | 'technical';
  cardsPerRow: number;
  thumbnailFit: 'cover' | 'contain';
  infoDense: boolean;
  thermalPricing: boolean;
  filterCollapsed: boolean;
}

export const DEFAULT_VIEW_CONFIG: FeedViewConfig = {
  viewMode: 'grid',
  cardsPerRow: 6,
  thumbnailFit: 'cover',
  infoDense: false,
  thermalPricing: false,
  filterCollapsed: false,
};
