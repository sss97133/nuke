/**
 * Complete Vehicle Interface matching the full database schema
 * This represents the comprehensive data collection capabilities
 * for building the ultimate vehicle documentation system
 */

export interface CompleteVehicle {
  // Core Identity
  id: string;
  uploaded_by?: string;  // Updated field name - tracks who uploaded, NOT ownership
  user_id?: string;      // @deprecated - kept for backwards compatibility only
  make: string;
  model: string;
  year?: number;
  vin?: string;
  license_plate?: string;

  // Physical Specifications
  color?: string;
  interior_color?: string;
  body_style?: string;
  doors?: number;
  seats?: number;

  // Engine & Performance
  fuel_type?: string;
  transmission?: string;
  engine_size?: string;
  displacement?: string;
  horsepower?: number;
  torque?: number;
  drivetrain?: string;

  // Dimensions & Weight
  weight_lbs?: number;
  length_inches?: number;
  width_inches?: number;
  height_inches?: number;
  wheelbase_inches?: number;

  // Fuel Economy
  fuel_capacity_gallons?: number;
  mpg_city?: number;
  mpg_highway?: number;
  mpg_combined?: number;

  // Financial Information
  msrp?: number;
  current_value?: number;
  purchase_price?: number;
  purchase_date?: string;
  purchase_location?: string;

  // Ownership & History
  mileage?: number;
  previous_owners?: number;
  condition_rating?: number; // 1-10 scale

  // Modifications
  is_modified?: boolean;
  modification_details?: string;

  // Legal & Insurance
  maintenance_notes?: string;
  insurance_company?: string;
  insurance_policy_number?: string;
  registration_state?: string;
  registration_expiry?: string;
  inspection_expiry?: string;

  // Discovery & Source Tracking
  discovered_by?: string;
  discovered_at?: string;
  discovery_source?: string;
  discovery_url?: string;

  // Sales & Auction Data
  sale_status?: string;
  sale_price?: number;
  sale_date?: string;
  auction_end_date?: string;
  bid_count?: number;
  view_count?: number;
  auction_source?: string;

  // BAT Integration
  bat_listing_title?: string;
  bat_bids?: number;
  bat_comments?: number;
  bat_views?: number;
  bat_location?: string;
  bat_seller?: string;

  // Data Quality & Verification
  completion_percentage?: number;
  status?: 'draft' | 'active' | 'archived';
  ownership_verified?: boolean;
  ownership_verified_at?: string;
  ownership_verification_id?: string;

  // System Fields
  is_public?: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface VehicleFormData extends Omit<CompleteVehicle, 'id' | 'created_at' | 'updated_at'> {
  // Additional form-specific fields
  relationship_type?: 'owned' | 'previously_owned' | 'interested' | 'discovered' | 'curated' | 'consigned';
  owner_name?: string;
  scanned_fields?: string[]; // Fields populated from title scan
}

export interface ValidationTier {
  level: 'basic' | 'enhanced' | 'professional' | 'verified';
  requirements: string[];
  benefits: string[];
  points_awarded: number;
}

export interface FieldValidation {
  field: keyof CompleteVehicle;
  is_verified: boolean;
  verification_source: 'user' | 'document_scan' | 'ai_analysis' | 'human_review';
  confidence_score: number;
  conflicts?: string[];
  last_verified_at?: string;
  verified_by?: string;
}

export interface ContributionFeedback {
  timeline_events_created: number;
  profile_points_earned: number;
  verification_level_achieved: string;
  completion_percentage: number;
  next_milestone: string;
  total_contributions: number;
}

export interface DataConflict {
  field_name: string;
  existing_value: any;
  new_value: any;
  confidence_scores: {
    existing: number;
    new: number;
  };
  sources: {
    existing: string;
    new: string;
  };
  resolution_recommendation: 'keep_existing' | 'use_new' | 'manual_review';
}