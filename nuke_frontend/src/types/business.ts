// Business Entity Types
// Comprehensive type definitions for business entities as first-class tradable assets

// Define basic types first
export type BusinessType = 
  | 'sole_proprietorship'
  | 'partnership' 
  | 'llc'
  | 'corporation'
  | 'garage'
  | 'dealership'
  | 'restoration_shop'
  | 'performance_shop'
  | 'body_shop'
  | 'detailing'
  | 'mobile_service'
  | 'specialty_shop'
  | 'parts_supplier'
  | 'fabrication'
  | 'racing_team'
  | 'auction_house'
  | 'other';

export type BusinessStatus = 
  | 'active'
  | 'inactive'
  | 'suspended'
  | 'for_sale'
  | 'sold';

export type VerificationLevel = 
  | 'unverified'
  | 'basic'
  | 'premium'
  | 'elite';

export interface DayHours {
  open: string; // "08:00"
  close: string; // "17:00"
  closed?: boolean;
}

export interface BusinessHours {
  monday?: DayHours;
  tuesday?: DayHours;
  wednesday?: DayHours;
  thursday?: DayHours;
  friday?: DayHours;
  saturday?: DayHours;
  sunday?: DayHours;
}

export interface Business {
  id: string;
  
  // Basic Information
  business_name: string;
  legal_name?: string;
  business_type: BusinessType;
  industry_focus: string[];
  
  // Legal & Registration
  business_license?: string;
  tax_id?: string;
  registration_state?: string;
  registration_date?: string;
  
  // Contact Information
  email?: string;
  phone?: string;
  website?: string;
  
  // Location
  address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  country: string;
  latitude?: number;
  longitude?: number;
  
  // Business Details
  description?: string;
  specializations: string[];
  services_offered: string[];
  years_in_business?: number;
  employee_count?: number;
  facility_size_sqft?: number;
  
  // Service Capabilities
  accepts_dropoff: boolean;
  offers_mobile_service: boolean;
  has_lift: boolean;
  has_paint_booth: boolean;
  has_dyno: boolean;
  has_alignment_rack: boolean;
  
  // Business Hours
  hours_of_operation: BusinessHours;
  
  // Market Data
  hourly_rate_min?: number;
  hourly_rate_max?: number;
  service_radius_miles?: number;
  
  // Reputation & Performance
  total_projects_completed: number;
  total_vehicles_worked: number;
  average_project_rating: number;
  total_reviews: number;
  repeat_customer_rate: number;
  on_time_completion_rate: number;
  
  // Verification & Trust
  is_verified: boolean;
  verification_date?: string;
  verification_level: VerificationLevel;
  insurance_verified: boolean;
  license_verified: boolean;
  
  // Business Status
  status: BusinessStatus;
  is_public: boolean;
  
  // Market Value (for trading)
  estimated_value?: number;
  last_valuation_date?: string;
  is_for_sale: boolean;
  asking_price?: number;
  
  // Media
  logo_url?: string;
  cover_image_url?: string;
  portfolio_images: string[];
  
  // Metadata
  metadata: Record<string, any>;

  // Neutral facts (human-readable)
  inventory_numbers?: string;
  market_share?: string;
  branding?: string;
  labeling?: string;
  
  // Timestamps
  created_at: string;
  updated_at: string;
}


export interface BusinessOwnership {
  id: string;
  business_id: string;
  owner_id: string;
  
  // Ownership Details
  ownership_percentage: number;
  ownership_type: OwnershipType;
  
  // Legal
  ownership_title?: string;
  voting_rights: boolean;
  
  // Financial
  investment_amount?: number;
  acquisition_date: string;
  acquisition_price?: number;
  
  // Status
  status: OwnershipStatus;
  
  // Timestamps
  created_at: string;
  updated_at: string;
}

export type OwnershipType = 
  | 'founder'
  | 'partner'
  | 'investor'
  | 'employee_equity'
  | 'acquired';

export type OwnershipStatus = 
  | 'active'
  | 'pending'
  | 'transferred'
  | 'dissolved';

export interface BusinessUserRole {
  id: string;
  business_id: string;
  user_id: string;
  
  // Role Information
  role_title: string;
  role_type: RoleType;
  department?: string;
  
  // Permissions
  permissions: string[];
  can_manage_vehicles: boolean;
  can_manage_users: boolean;
  can_create_projects: boolean;
  can_approve_timeline_events: boolean;
  
  // Employment Details
  employment_type: EmploymentType;
  hourly_rate?: number;
  salary?: number;
  start_date: string;
  end_date?: string;
  
  // Performance
  skill_level?: SkillLevel;
  specializations: string[];
  
  // Status
  status: RoleStatus;
  
  // Timestamps
  created_at: string;
  updated_at: string;
}

export type RoleType = 
  | 'owner'
  | 'manager'
  | 'employee'
  | 'contractor'
  | 'intern'
  | 'consultant';

export type EmploymentType = 
  | 'full_time'
  | 'part_time'
  | 'contract'
  | 'temporary'
  | 'volunteer';

export type SkillLevel = 
  | 'apprentice'
  | 'journeyman'
  | 'expert'
  | 'master';

export type RoleStatus = 
  | 'active'
  | 'inactive'
  | 'on_leave'
  | 'terminated';

export interface BusinessVehicleFleet {
  id: string;
  business_id: string;
  vehicle_id: string;
  
  // Fleet Role
  fleet_role: FleetRole;
  
  // Business Relationship
  relationship_type: RelationshipType;
  assigned_to?: string; // user_id
  
  // Project Information
  project_name?: string;
  project_status?: ProjectStatus;
  estimated_completion?: string;
  project_budget?: number;
  labor_hours_budgeted?: number;
  labor_hours_actual?: number;
  
  // Financial
  acquisition_cost?: number;
  acquisition_date?: string;
  target_sale_price?: number;
  actual_sale_price?: number;
  profit_margin?: number;
  
  // Customer Information
  customer_id?: string;
  customer_contact_info: Record<string, any>;
  
  // Status
  status: FleetStatus;
  
  // Timestamps
  added_to_fleet: string;
  removed_from_fleet?: string;
  created_at: string;
  updated_at: string;
}

export type FleetRole = 
  | 'inventory'
  | 'project_car'
  | 'customer_vehicle'
  | 'company_vehicle'
  | 'demo_vehicle'
  | 'parts_car'
  | 'completed_project'
  | 'for_sale';

export type RelationshipType = 
  | 'owned'
  | 'consignment'
  | 'customer_dropoff'
  | 'lease'
  | 'rental';

export type ProjectStatus = 
  | 'planning'
  | 'in_progress'
  | 'on_hold'
  | 'completed'
  | 'delivered';

export type FleetStatus = 
  | 'active'
  | 'completed'
  | 'sold'
  | 'returned';

export interface BusinessTimelineEvent {
  id: string;
  business_id: string;
  created_by: string;
  
  // Event Classification
  event_type: BusinessEventType;
  event_category: BusinessEventCategory;
  
  // Event Details
  title: string;
  description?: string;
  event_date: string;
  location?: string;
  
  // Supporting Data
  documentation_urls: string[];
  cost_amount?: number;
  cost_currency: string;
  
  // Impact Assessment
  affects_valuation: boolean;
  affects_capacity: boolean;
  affects_reputation: boolean;
  
  // Verification
  verification_status: EventVerificationStatus;
  
  // Metadata
  metadata: Record<string, any>;
  
  // Timestamps
  created_at: string;
  updated_at: string;
}

export type BusinessEventType = 
  | 'founded'
  | 'incorporated'
  | 'license_acquired'
  | 'facility_move'
  | 'equipment_purchase'
  | 'employee_hired'
  | 'employee_terminated'
  | 'partnership'
  | 'acquisition'
  | 'certification'
  | 'award_received'
  | 'milestone_reached'
  | 'expansion'
  | 'renovation'
  | 'sale_listing'
  | 'ownership_transfer'
  | 'closure'
  | 'rebranding'
  | 'other';

export type BusinessEventCategory = 
  | 'legal'
  | 'operational'
  | 'personnel'
  | 'financial'
  | 'recognition'
  | 'growth'
  | 'other';

export type EventVerificationStatus = 
  | 'unverified'
  | 'user_verified'
  | 'document_verified'
  | 'third_party_verified';

// Form interfaces for creating/editing businesses
export interface BusinessFormData {
  business_name: string;
  legal_name?: string;
  business_type: BusinessType;
  industry_focus: string[];
  
  // Contact & Location
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  
  // Business Details
  description?: string;
  specializations: string[];
  services_offered: string[];
  years_in_business?: number;
  employee_count?: number;
  facility_size_sqft?: number;
  
  // Capabilities
  accepts_dropoff: boolean;
  offers_mobile_service: boolean;
  has_lift: boolean;
  has_paint_booth: boolean;
  has_dyno: boolean;
  has_alignment_rack: boolean;
  
  // Business Hours
  hours_of_operation: BusinessHours;
  
  // Market Data
  hourly_rate_min?: number;
  hourly_rate_max?: number;
  service_radius_miles?: number;
  
  // Legal
  business_license?: string;
  tax_id?: string;
  registration_state?: string;
  registration_date?: string;
}

// Validation schemas and utilities
export const BUSINESS_TYPES: { value: BusinessType; label: string }[] = [
  { value: 'garage', label: 'Auto Garage' },
  { value: 'dealership', label: 'Car Dealership' },
  { value: 'restoration_shop', label: 'Restoration Shop' },
  { value: 'performance_shop', label: 'Performance Shop' },
  { value: 'body_shop', label: 'Body Shop' },
  { value: 'detailing', label: 'Detailing Service' },
  { value: 'mobile_service', label: 'Mobile Service' },
  { value: 'specialty_shop', label: 'Specialty Shop' },
  { value: 'parts_supplier', label: 'Parts Supplier' },
  { value: 'fabrication', label: 'Fabrication Shop' },
  { value: 'racing_team', label: 'Racing Team' },
  { value: 'auction_house', label: 'Auction House' },
  { value: 'sole_proprietorship', label: 'Sole Proprietorship' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'llc', label: 'LLC' },
  { value: 'corporation', label: 'Corporation' },
  { value: 'other', label: 'Other' }
];

export const SPECIALIZATIONS = [
  'engine_rebuild', 'transmission_repair', 'electrical_systems', 'diagnostics',
  'paint_and_bodywork', 'interior_restoration', 'suspension_tuning', 'brake_systems',
  'air_conditioning', 'custom_fabrication', 'performance_tuning', 'racing_prep',
  'classic_car_restoration', 'exotic_car_service', 'diesel_repair', 'hybrid_electric',
  'detailing', 'paint_protection', 'window_tinting', 'audio_installation',
  'tire_service', 'alignment', 'inspection', 'emissions_testing'
];

export const SERVICES_OFFERED = [
  'maintenance', 'repair', 'restoration', 'custom_build', 'performance_upgrade',
  'diagnostics', 'inspection', 'detailing', 'paint_work', 'bodywork',
  'engine_work', 'transmission_service', 'brake_service', 'suspension_work',
  'electrical_repair', 'air_conditioning', 'tire_service', 'alignment',
  'parts_sales', 'consultation', 'appraisal', 'storage'
];
