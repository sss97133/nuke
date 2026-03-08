/**
 * Nuke SDK Types
 */

// Configuration
export interface NukeConfig {
  baseUrl: string;
  timeout: number;
}

export interface RequestOptions {
  timeout?: number;
  idempotencyKey?: string;
}

// Pagination
export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages?: number;
    has_more?: boolean;
  };
}

// Vehicle Types
export interface Vehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim?: string | null;
  series?: string | null;
  vin: string | null;
  mileage: number | null;
  color?: string | null;
  interior_color: string | null;
  transmission: string | null;
  engine_type?: string | null;
  engine_displacement?: string | null;
  drivetrain: string | null;
  body_style: string | null;
  sale_price: number | null;
  purchase_price?: number | null;
  description?: string | null;
  is_public: boolean;
  owner_id?: string;
  created_at: string;
  updated_at?: string;
  primary_image_url?: string | null;
  discovery_url?: string | null;
}

export interface VehicleCreateParams {
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  mileage?: number;
  color?: string;
  interior_color?: string;
  transmission?: string;
  engine_type?: string;
  drivetrain?: string;
  body_style?: string;
  purchase_price?: number;
  description?: string;
  is_public?: boolean;
}

export interface VehicleUpdateParams {
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  mileage?: number;
  color?: string;
  interior_color?: string;
  transmission?: string;
  engine_type?: string;
  drivetrain?: string;
  body_style?: string;
  purchase_price?: number;
  description?: string;
  is_public?: boolean;
}

export interface VehicleListParams extends PaginationParams {
  mine?: boolean;
  make?: string;
  model?: string;
  year?: number;
  year_min?: number;
  year_max?: number;
  vin?: string;
  price_min?: number;
  price_max?: number;
  transmission?: string;
  mileage_max?: number;
  sort?: 'created_at' | 'year' | 'sale_price' | 'mileage' | 'updated_at';
  sort_dir?: 'asc' | 'desc';
}

// Observation Types
export interface Observation {
  id: string;
  vehicle_id: string;
  source_id: string | null;
  kind: string;
  observed_at: string;
  structured_data: Record<string, any> | null;
  confidence: number | null;
  created_at: string;
}

export interface ObservationCreateParams {
  vehicle_id?: string;
  vin?: string;
  source_id: string;
  kind: string;
  observed_at?: string;
  structured_data: Record<string, any>;
  confidence?: number;
  provenance?: {
    url?: string;
    document_id?: string;
    extracted_by?: string;
  };
}

export interface ObservationListParams extends PaginationParams {
  vehicle_id?: string;
  vin?: string;
  kind?: string;
}

// Webhook Types
export type WebhookEventType =
  | '*'
  | 'vehicle.created'
  | 'vehicle.updated'
  | 'vehicle.deleted'
  | 'observation.created'
  | 'document.uploaded'
  | 'import.completed';

export interface WebhookEndpoint {
  id: string;
  url: string;
  description: string | null;
  events: WebhookEventType[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
  stats?: {
    total_deliveries: number;
    failed_deliveries: number;
  };
}

export interface WebhookEndpointCreateParams {
  url: string;
  description?: string;
  events?: WebhookEventType[];
}

export interface WebhookEndpointUpdateParams {
  url?: string;
  description?: string;
  events?: WebhookEventType[];
  is_active?: boolean;
}

export interface WebhookDelivery {
  id: string;
  event_type: string;
  event_id: string;
  status: 'pending' | 'success' | 'failed' | 'retrying';
  attempts: number;
  response_status: number | null;
  response_time_ms: number | null;
  created_at: string;
  delivered_at: string | null;
  last_error: string | null;
}

export interface WebhookEndpointWithSecret extends WebhookEndpoint {
  secret: string;
}

// Batch Types
export interface BatchVehicle {
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  mileage?: number;
  exterior_color?: string;
  interior_color?: string;
  transmission?: string;
  engine?: string;
  drivetrain?: string;
  body_style?: string;
  sale_price?: number;
  description?: string;
  observations?: BatchObservation[];
}

export interface BatchObservation {
  source_type: string;
  observation_kind: string;
  observed_at?: string;
  data: Record<string, any>;
  confidence?: number;
}

export interface BatchIngestParams {
  vehicles: BatchVehicle[];
  options?: {
    skip_duplicates?: boolean;
    match_by?: 'vin' | 'year_make_model' | 'none';
    update_existing?: boolean;
  };
}

export interface BatchResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  vehicles: Array<{
    index: number;
    id?: string;
    status: 'created' | 'updated' | 'skipped' | 'failed';
    error?: string;
  }>;
}

// Valuation Types
export interface Valuation {
  vehicle_id: string;
  estimated_value: number | null;
  value_low: number | null;
  value_high: number | null;
  confidence_score: number | null;
  deal_score: number | null;
  deal_score_label: string | null;
  heat_score: number | null;
  heat_score_label: string | null;
  price_tier: string | null;
  signal_weights: Record<string, number> | null;
  model_version: string | null;
  calculated_at: string | null;
  is_stale: boolean | null;
  source: 'nuke_estimates' | 'vehicle_fields';
  vehicle_summary?: string;
}

export interface ValuationGetParams {
  vehicle_id?: string;
  vin?: string;
}

// External Listing Types
// Field names match the vehicle_events table returned by api-v1-listings
export interface ExternalListing {
  id: string;
  vehicle_id: string;
  source_platform: string;
  source_url: string | null;
  source_listing_id: string | null;
  event_status: string | null;
  started_at: string | null;
  ended_at: string | null;
  current_price: number | null;
  reserve_price: number | null;
  buy_now_price: number | null;
  bid_count: number | null;
  view_count: number | null;
  watcher_count: number | null;
  final_price: number | null;
  sold_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListingListParams extends PaginationParams {
  vehicle_id?: string;
  vin?: string;
  platform?: string;
  status?: 'active' | 'sold' | 'expired' | 'ended';
}

// Comparable Types
export interface Comparable {
  vehicle_id: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  vin: string | null;
  sale_price: number;
  mileage: number | null;
  color: string | null;
  image_url: string | null;
  location: string | null;
  listing_url: string | null;
  platform: string | null;
  platform_raw: string | null;
  sold_date: string | null;
  source_type: 'auction_event' | 'vehicle_record';
}

export interface CompsSummary {
  count: number;
  avg_price: number;
  median_price: number;
  min_price: number;
  max_price: number;
  auction_event_count: number;
}

export interface CompsResponse {
  data: Comparable[];
  summary: CompsSummary | null;
  query: {
    make: string;
    model: string | null;
    year: number | null;
    year_range: number;
    excluded_vehicle_id: string | null;
  };
}

export interface CompsGetParams {
  make?: string;
  model?: string;
  year?: number;
  vin?: string;
  year_range?: number;
  min_price?: number;
  max_price?: number;
  limit?: number;
}

// Webhook Payload Types (for receiving webhooks)
export interface WebhookPayload<T = any> {
  id: string;
  type: WebhookEventType;
  created: number;
  data: T;
  livemode: boolean;
}

export interface WebhookSignature {
  timestamp: number;
  signature: string;
}

// VIN Lookup Types
export interface VinLookupResponse {
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
  created_at: string;
  updated_at: string;
  primary_image_url: string | null;
  valuation: {
    estimated_value: number | null;
    value_low: number | null;
    value_high: number | null;
    confidence_score: number | null;
    deal_score: number | null;
    deal_score_label: string | null;
    heat_score: number | null;
    heat_score_label: string | null;
    price_tier: string | null;
    model_version: string | null;
    calculated_at: string | null;
    is_stale: boolean | null;
  } | null;
  counts: {
    listings: number;
    observations: number;
    images: number;
  };
  images: Array<{
    id: string;
    image_url: string;
    image_type: string | null;
    category: string | null;
    is_primary: boolean | null;
  }>;
}

// Vehicle History Types
export interface VehicleHistoryParams extends PaginationParams {
  kind?: string;
}

export interface VehicleHistoryObservation {
  id: string;
  vehicle_id: string;
  source_id: string | null;
  kind: string;
  observed_at: string;
  structured_data: Record<string, any> | null;
  confidence: number | null;
  content_text: string | null;
  source_url: string | null;
  ingested_at: string;
}

export interface VehicleHistoryResponse {
  data: {
    vehicle: {
      id: string;
      year: number | null;
      make: string | null;
      model: string | null;
      vin: string | null;
    };
    observations: VehicleHistoryObservation[];
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

// Vehicle Auction Types
export interface AuctionComment {
  id: string;
  comment_text: string | null;
  author_name: string | null;
  posted_at: string | null;
  comment_type: string | null;
  platform: string | null;
  source_url: string | null;
}

export interface AuctionSentiment {
  overall: string | null;
  score: number | null;
  comment_count_analyzed: number | null;
  fields_extracted: number | null;
  details: Record<string, any> | null;
  analyzed_at: string | null;
}

export interface VehicleAuctionResponse {
  vehicle: {
    id: string;
    year: number | null;
    make: string | null;
    model: string | null;
    vin: string | null;
    sale_price: number | null;
  };
  /** Auction/listing records from vehicle_events table */
  listings: Array<{
    id: string;
    source_platform: string | null;
    source_url: string | null;
    source_listing_id: string | null;
    event_status: string | null;
    started_at: string | null;
    ended_at: string | null;
    current_price: number | null;
    reserve_price: number | null;
    buy_now_price: number | null;
    bid_count: number | null;
    view_count: number | null;
    watcher_count: number | null;
    final_price: number | null;
    sold_at: string | null;
    created_at: string;
    updated_at: string;
  }>;
  comments: {
    total_count: number;
    recent: AuctionComment[];
  };
  sentiment: AuctionSentiment | null;
}

// Market Trends Types
export interface MarketTrendsParams {
  make: string;
  model?: string;
  year_from?: number;
  year_to?: number;
  period?: '30d' | '90d' | '1y' | '3y';
}

export interface MarketTrendsPeriod {
  period_start: string;
  period_end: string;
  sale_count: number;
  avg_price: number | null;
  median_price: number | null;
  p25_price: number | null;
  p75_price: number | null;
  min_price: number | null;
  max_price: number | null;
  avg_mileage: number | null;
}

export interface MarketTrendsSummary {
  total_sales: number;
  periods_with_data: number;
  overall_avg_price: number;
  price_change_pct: number;
  trend_direction: 'rising' | 'falling' | 'stable';
}

export interface MarketTrendsResponse {
  query: {
    make: string;
    model: string | null;
    year_from: number | null;
    year_to: number | null;
    period: string;
  };
  summary: MarketTrendsSummary | null;
  periods: MarketTrendsPeriod[];
}

// Signal Score Types

/**
 * Market signal score — answers "is this a good deal?"
 * Combines comparable sales, pricing position, heat, and auction sentiment.
 */
export interface SignalScore {
  vehicle_id: string;

  /** Deal score 0–100. Higher = better deal. */
  deal_score: number | null;
  /**
   * Human-readable deal label.
   * - 'strong_buy' — significantly below market, high confidence
   * - 'buy' — below market, worth pursuing
   * - 'hold' — at market, neutral
   * - 'pass' — above market or low confidence
   * - 'overpriced' — meaningfully above comparable sales
   */
  deal_score_label: 'strong_buy' | 'buy' | 'hold' | 'pass' | 'overpriced' | null;

  /** Heat score 0–100. Market demand intensity for this vehicle class. */
  heat_score: number | null;
  /** Heat label: 'cold' | 'warm' | 'hot' | 'fire' | 'volcanic' */
  heat_score_label: string | null;

  /** Estimated fair market value in USD */
  estimated_value: number | null;
  /** Lower bound of value range */
  value_low: number | null;
  /** Upper bound of value range */
  value_high: number | null;

  /**
   * How this vehicle's listing price compares to estimated market value.
   * Negative = priced BELOW market (better deal), positive = ABOVE market (overpriced).
   * Expressed as a percentage. Null if no listing price is available.
   * Example: -12 means the vehicle is listed 12% below estimated value.
   */
  price_vs_market: number | null;

  /** Number of comparable sales used in the valuation */
  comp_count: number | null;

  /**
   * Contribution weights for each signal factor (0.0–1.0 each).
   * Shows what drove the score.
   */
  signal_weights: {
    /** Weight given to comparable sales coverage */
    comp_coverage: number | null;
    /** Weight given to vehicle condition signals */
    condition_signal: number | null;
    /** Weight given to auction comment sentiment */
    auction_sentiment: number | null;
    /** Weight given to market trend / listing velocity */
    listing_velocity: number | null;
    /** Weight given to bid curve / price position signals */
    price_position: number | null;
  } | null;

  /** Confidence score 0.0–1.0 (derived from comp count and data quality) */
  confidence: number | null;
  /** Model version used to compute the score */
  model_version: string | null;
  /** ISO timestamp when the score was last calculated */
  calculated_at: string | null;
  /** True if the score is older than the staleness threshold */
  is_stale: boolean | null;
  /** True if the score was computed on-demand (no pre-existing estimate) */
  computed_on_demand?: boolean;
}

export interface SignalScoreParams {
  /** Nuke vehicle UUID */
  vehicle_id?: string;
  /** 17-character VIN */
  vin?: string;
}

// Search Types
export interface SearchParams {
  q: string;
  make?: string;
  model?: string;
  year_from?: number;
  year_to?: number;
  has_vin?: boolean;
  sort?: 'relevance' | 'price_desc' | 'price_asc' | 'year_desc' | 'year_asc';
  types?: string[];
  limit?: number;
  page?: number;
}

export interface SearchResult {
  id: string;
  vin: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  title: string;
  sale_price: number | null;
  mileage: number | null;
  color: string | null;
  interior_color: string | null;
  transmission: string | null;
  engine_size: string | null;
  body_style: string | null;
  auction_source: string | null;
  valuation: {
    estimated_value: number | null;
    confidence_score: number | null;
  } | null;
  data_density: {
    has_vin: boolean;
    has_valuation: boolean;
    has_price: boolean;
  };
}

export interface SearchResponse {
  data: SearchResult[];
  query: {
    q: string | null;
    make: string | null;
    model: string | null;
    year_from: number | null;
    year_to: number | null;
    sort: string;
  };
  pagination: {
    page: number;
    limit: number;
    total_count: number;
    total_pages: number;
  };
  search_time_ms: number;
}
