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
  vin: string | null;
  mileage: number | null;
  exterior_color: string | null;
  interior_color: string | null;
  transmission: string | null;
  engine: string | null;
  drivetrain: string | null;
  body_style: string | null;
  sale_price: number | null;
  description: string | null;
  is_public: boolean;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface VehicleCreateParams {
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
  is_public?: boolean;
}

export interface VehicleUpdateParams {
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
  is_public?: boolean;
}

export interface VehicleListParams extends PaginationParams {
  mine?: boolean;
}

// Observation Types
export interface Observation {
  id: string;
  vehicle_id: string;
  vin: string | null;
  source_type: string;
  observation_kind: string;
  observed_at: string;
  data: Record<string, any>;
  confidence: number;
  provenance: {
    ingested_by?: string;
    ingested_via?: string;
    url?: string;
    document_id?: string;
    extracted_by?: string;
  };
  created_at: string;
}

export interface ObservationCreateParams {
  vehicle_id?: string;
  vin?: string;
  source_type: string;
  observation_kind: string;
  observed_at?: string;
  data: Record<string, any>;
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
export interface ExternalListing {
  id: string;
  vehicle_id: string;
  platform: string;
  listing_url: string;
  listing_id: string;
  listing_status: string;
  start_date: string | null;
  end_date: string | null;
  current_bid: number | null;
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
  vehicle_id: string;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  vin: string | null;
  sale_price: number;
  mileage: number | null;
  transmission: string | null;
  color: string | null;
  condition_rating: number | null;
  image_url: string | null;
  location: string | null;
}

export interface CompsSummary {
  count: number;
  avg_price: number;
  median_price: number;
  min_price: number;
  max_price: number;
}

export interface CompsResponse {
  data: Comparable[];
  summary: CompsSummary | null;
  query: {
    make: string;
    model: string | null;
    year: number | null;
    year_range: number;
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
  listings: ExternalListing[];
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

// Search Types
export interface SearchParams {
  q: string;
  types?: string[];
  limit?: number;
}

export interface SearchResult {
  id: string;
  type: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  image_url: string | null;
  relevance_score: number;
  metadata: Record<string, any> | null;
}

export interface SearchResponse {
  data: SearchResult[];
  query: {
    q: string;
    types: string[] | null;
    limit: number;
  };
  total_count: number;
  query_type: string;
  search_time_ms: number | null;
}
