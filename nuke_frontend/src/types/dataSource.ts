export interface DataSource {
  id: string;
  vehicle_id: string;
  field_name: string;
  field_value: string | null;
  source_type: 'user_upload' | 'web_scrape' | 'vin_decode' | 'library_spec' | 'service_record' | 'modification_doc' | 'professional_assessment' | 'manufacturer_data';
  source_url?: string;
  source_entity?: string;
  source_metadata: Record<string, any>;
  contributor_id?: string;
  confidence_score: number;
  verification_status: 'unverified' | 'human_verified' | 'multi_verified' | 'disputed';
  superseded_by?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface VehicleModification {
  id: string;
  vehicle_id: string;
  modification_type: 'engine_swap' | 'performance_upgrade' | 'suspension_modification' | 'cosmetic_change' | 'part_replacement' | 'electrical_modification' | 'exhaust_modification' | 'brake_upgrade' | 'wheel_tire_change' | 'interior_modification' | 'body_modification' | 'transmission_modification' | 'other';
  modification_title: string;
  modification_description?: string;
  parts_changed: string[];
  before_specs: Record<string, any>;
  after_specs: Record<string, any>;
  cost_estimate?: number;
  labor_hours?: number;
  documentation_urls: string[];
  before_images: string[];
  after_images: string[];
  performed_by?: string;
  performed_by_shop?: string;
  verified_by?: string;
  timeline_event_id?: string;
  modification_date?: string;
  warranty_info?: string;
  reversible: boolean;
  affects_performance: boolean;
  affects_emissions: boolean;
  affects_safety: boolean;
  created_at: string;
  updated_at: string;
}

export interface FieldAnnotation {
  fieldName: string;
  sources: DataSource[];
  primarySource?: DataSource;
  conflictingSources?: DataSource[];
  lastUpdated: string;
  verificationLevel: 'unverified' | 'basic' | 'professional' | 'multi_verified';
}
