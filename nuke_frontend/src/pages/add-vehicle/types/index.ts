// AddVehicle - Types and Interfaces

export type DetailLevel = 'basic' | 'detailed' | 'professional' | 'expert';

export interface VehicleFormData {
  // Core Identity
  make: string;
  model: string;
  year?: number;
  vin?: string;
  license_plate?: string;
  location?: string;

  // Physical Specifications
  color?: string;
  interior_color?: string;
  body_style?: string;
  doors?: number;
  seats?: number;

  // Engine & Performance
  fuel_type?: string;
  transmission?: string;
  transmission_model?: string;
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
  is_for_sale?: boolean;
  asking_price?: number;
  sale_price?: number;
  listing_posted_at?: string;
  listing_updated_at?: string;
  listing_source?: string;
  listing_url?: string;

  // Ownership & History
  mileage?: number;
  previous_owners?: number;
  condition_rating?: number;
  title_status?: string;

  // Modifications
  is_modified?: boolean;
  modification_details?: string;

  // Legal & Insurance
  title_transfer_date?: string;
  maintenance_notes?: string;
  insurance_company?: string;
  insurance_policy_number?: string;
  registration_state?: string;
  registration_expiry?: string;
  inspection_expiry?: string;

  // System Fields
  is_public?: boolean;
  notes?: string;
  description?: string;
  trim?: string;
  status?: 'draft' | 'active' | 'archived';

  // Form-specific fields
  relationship_type?: 'owned' | 'previously_owned' | 'interested' | 'discovered' | 'curated' | 'consigned';
  owner_name?: string;
  scanned_fields?: string[];
  import_url?: string;
  contributor_roles?: ('consigner' | 'mechanic' | 'technician' | 'painter' | 'appraiser' | 'dealer' | 'broker' | 'other')[];
  discoverer_opinion?: string;

  // BAT Integration Fields
  bat_auction_url?: string;
  bat_listing_title?: string;
  bat_sold_price?: number;
  bat_sale_date?: string;
  bat_bid_count?: number;
  bat_view_count?: number;
  discovery_source?: string;
  discovery_url?: string;
  source?: string;
}

export interface VerificationProgress {
  tier: number;
  points: number;
  completionPercentage: number;
  nextMilestone: string;
  fieldsCompleted: number;
  totalFields: number;
}

export interface ImageUploadProgress {
  [key: number]: number;
}

export interface ImageUploadStatus {
  [key: number]: 'pending' | 'uploading' | 'completed' | 'error';
}

export interface AutoSaveState {
  lastSaved: string;
  hasUnsavedChanges: boolean;
}

// Field groups for form organization
export const FIELD_GROUPS = {
  CORE: ['make', 'model', 'year', 'vin', 'license_plate'],
  PHYSICAL: ['color', 'interior_color', 'body_style', 'doors', 'seats'],
  ENGINE: ['fuel_type', 'transmission', 'engine_size', 'displacement', 'horsepower', 'torque', 'drivetrain'],
  DIMENSIONS: ['weight_lbs', 'length_inches', 'width_inches', 'height_inches', 'wheelbase_inches'],
  FUEL: ['fuel_capacity_gallons', 'mpg_city', 'mpg_highway', 'mpg_combined'],
  FINANCIAL: ['msrp', 'current_value', 'purchase_price', 'purchase_date', 'purchase_location', 'is_for_sale', 'asking_price', 'sale_price'],
  OWNERSHIP: ['mileage', 'previous_owners', 'condition_rating'],
  MODS: ['is_modified', 'modification_details'],
  LEGAL: ['title_transfer_date', 'maintenance_notes', 'insurance_company', 'insurance_policy_number', 'registration_state', 'registration_expiry', 'inspection_expiry']
} as const;

// Export the type separately for better module resolution
export type FieldGroup = 'CORE' | 'PHYSICAL' | 'ENGINE' | 'DIMENSIONS' | 'FUEL' | 'FINANCIAL' | 'OWNERSHIP' | 'MODS' | 'LEGAL';

// Also export as a named export to ensure compatibility
export type { FieldGroup as FieldGroupType };