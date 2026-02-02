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
    pages: number;
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
