// Organization Entity Types
// Industry-standard taxonomy: EntityType (functional role) × LegalStructure (legal form)

// === NEW: Industry-standard taxonomy ===

export type EntityType =
  // Ownership entities
  | 'collection' | 'museum' | 'private_foundation'
  // Commercial operators (DMV license types + Hagerty categories)
  | 'dealer' | 'franchise_dealer' | 'independent_dealer' | 'wholesale_dealer'
  | 'broker' | 'consignment_dealer' | 'dealer_group'
  // Auction (industry standard)
  | 'auction_house' | 'online_auction_platform'
  // Service providers (Hagerty commercial insurance categories)
  | 'restoration_shop' | 'performance_shop' | 'body_shop' | 'detailing'
  | 'storage_facility' | 'collection_manager' | 'appraiser' | 'transporter'
  | 'garage' | 'mobile_service' | 'specialty_shop' | 'fabrication'
  // Manufacturers (NHTSA)
  | 'manufacturer' | 'heritage_division' | 'importer_distributor'
  // Associations (501(c)(3)/501(c)(7))
  | 'marque_club' | 'club' | 'registry' | 'concours'
  // Platforms
  | 'marketplace' | 'data_platform' | 'investment_platform'
  // Investment vehicles (SEC/FINRA)
  | 'investment_fund' | 'series_llc' | 'spv'
  // Other
  | 'media' | 'racing_team' | 'builder' | 'parts_supplier'
  | 'forum' | 'developer' | 'other' | 'uncategorized';

export type LegalStructure =
  // IRS entity classifications
  | 'individual' | 'sole_proprietorship' | 'partnership'
  | 'llc' | 'single_member_llc' | 'multi_member_llc' | 'series_llc'
  | 'corporation' | 'c_corp' | 's_corp'
  // Trust structures (estate planning)
  | 'revocable_trust' | 'irrevocable_trust' | 'dynasty_trust'
  | 'charitable_remainder_trust'
  // Nonprofit
  | 'foundation_501c3' | 'social_club_501c7'
  // Investment
  | 'limited_partnership' | 'family_limited_partnership'
  | 'family_office'
  | 'unknown';

// === BACKWARD COMPAT: Legacy BusinessType ===
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
  | 'developer'
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

export interface Organization {
  id: string;

  // Identity
  business_name: string;
  legal_name?: string;
  entity_type: EntityType;
  legal_structure?: LegalStructure;
  business_type?: BusinessType; // legacy, still in DB
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

  // Details
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

  // Status
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

  // Structured entity-specific data (separate from metadata)
  entity_attributes: EntityAttributes;

  // Metadata (operational/provenance)
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

// === Entity-specific attribute interfaces ===
// entity_attributes = business-domain data about what the entity is/does
// metadata = operational/provenance (who scraped, when, from where)

export interface CollectionAttributes {
  collection_size?: number;
  collection_focus?: string[];       // ['Ferrari', 'pre-war', 'race cars']
  era_focus?: string[];              // ['1950s', '1960s', 'modern hypercar']
  display_status?: 'private' | 'public' | 'by_appointment' | 'museum';
  storage_type?: 'climate_controlled' | 'standard' | 'outdoor' | 'mixed';
  concours_participation?: string[];
  notable_vehicles?: string[];
  acquisition_strategy?: string;
}

export interface DealerAttributes {
  dealer_license_number?: string;
  dealer_license_state?: string;
  brands_carried?: string[];
  annual_units_sold?: number;
  price_range_low?: number;
  price_range_high?: number;
  financing_offered?: boolean;
  consignment_accepted?: boolean;
}

export interface AuctionHouseAttributes {
  auction_format?: ('live' | 'online' | 'timed' | 'sealed')[];
  buyer_premium_pct?: number;
  seller_premium_pct?: number;
  annual_sales_volume?: number;
  specialist_categories?: string[];
  accepts_consignment?: boolean;
}

export interface ServiceProviderAttributes {
  marque_specialization?: string[];
  era_specialization?: string[];
  certifications?: string[];
  concurrent_projects?: number;
  typical_project_duration_months?: number;
}

export interface ClubAttributes {
  member_count?: number;
  membership_fee_annual?: number;
  founding_year?: number;
  marque_focus?: string[];
  events_per_year?: number;
  chapters?: string[];
}

export interface ConcoursAttributes {
  event_frequency?: 'annual' | 'biennial' | 'irregular';
  typical_entrant_count?: number;
  judged?: boolean;
  award_categories?: string[];
  location_permanent?: boolean;
  founding_year?: number;
}

export interface RegistryAttributes {
  marque_focus?: string[];
  model_focus?: string[];
  registered_vehicles?: number;
  founding_year?: number;
  publishes_data?: boolean;
}

export interface ManufacturerAttributes {
  brands?: string[];
  production_years?: string;
  headquarters_country?: string;
  current_status?: 'active' | 'defunct' | 'merged' | 'subsidiary';
  parent_company?: string;
}

export interface MediaAttributes {
  media_type?: ('print' | 'digital' | 'video' | 'podcast' | 'social')[];
  audience_focus?: string[];
  founding_year?: number;
  publication_frequency?: string;
}

export interface MarketplaceAttributes {
  listing_types?: ('buy_now' | 'auction' | 'classified' | 'offer')[];
  fee_structure?: string;
  average_listings?: number;
  vehicle_categories?: string[];
}

export interface InvestmentAttributes {
  fund_size?: number;
  minimum_investment?: number;
  vehicle_focus?: string[];
  return_target_pct?: number;
  fund_status?: 'raising' | 'deployed' | 'distributing' | 'closed';
}

export interface ForumAttributes {
  member_count?: number;
  post_count?: number;
  marque_focus?: string[];
  platform?: string;
}

// Union of all entity-specific attribute types
export type EntityAttributes =
  | CollectionAttributes
  | DealerAttributes
  | AuctionHouseAttributes
  | ServiceProviderAttributes
  | ClubAttributes
  | ConcoursAttributes
  | RegistryAttributes
  | ManufacturerAttributes
  | MediaAttributes
  | MarketplaceAttributes
  | InvestmentAttributes
  | ForumAttributes
  | Record<string, any>;

// Backward compat: Business is an alias for Organization
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

// === NEW: Industry-standard entity type options ===
export const ENTITY_TYPES: { value: EntityType; label: string; category: string }[] = [
  // Ownership
  { value: 'collection', label: 'Private Collection', category: 'Ownership' },
  { value: 'museum', label: 'Museum', category: 'Ownership' },
  { value: 'private_foundation', label: 'Private Foundation', category: 'Ownership' },
  // Commercial - Dealers
  { value: 'dealer', label: 'Dealer', category: 'Dealer' },
  { value: 'franchise_dealer', label: 'Franchise Dealer', category: 'Dealer' },
  { value: 'independent_dealer', label: 'Independent Dealer', category: 'Dealer' },
  { value: 'wholesale_dealer', label: 'Wholesale Dealer', category: 'Dealer' },
  { value: 'broker', label: 'Broker', category: 'Dealer' },
  { value: 'consignment_dealer', label: 'Consignment Dealer', category: 'Dealer' },
  { value: 'dealer_group', label: 'Dealer Group', category: 'Dealer' },
  // Auction
  { value: 'auction_house', label: 'Auction House', category: 'Auction' },
  { value: 'online_auction_platform', label: 'Online Auction Platform', category: 'Auction' },
  // Service
  { value: 'restoration_shop', label: 'Restoration Shop', category: 'Service' },
  { value: 'performance_shop', label: 'Performance Shop', category: 'Service' },
  { value: 'body_shop', label: 'Body Shop', category: 'Service' },
  { value: 'detailing', label: 'Detailing', category: 'Service' },
  { value: 'garage', label: 'Garage', category: 'Service' },
  { value: 'mobile_service', label: 'Mobile Service', category: 'Service' },
  { value: 'specialty_shop', label: 'Specialty Shop', category: 'Service' },
  { value: 'fabrication', label: 'Fabrication', category: 'Service' },
  { value: 'storage_facility', label: 'Storage Facility', category: 'Service' },
  { value: 'collection_manager', label: 'Collection Manager', category: 'Service' },
  { value: 'appraiser', label: 'Appraiser', category: 'Service' },
  { value: 'transporter', label: 'Transporter', category: 'Service' },
  // Manufacturer
  { value: 'manufacturer', label: 'Manufacturer', category: 'Manufacturer' },
  { value: 'heritage_division', label: 'Heritage Division', category: 'Manufacturer' },
  { value: 'importer_distributor', label: 'Importer/Distributor', category: 'Manufacturer' },
  // Association
  { value: 'marque_club', label: 'Nuke Club', category: 'Association' },
  { value: 'club', label: 'Club', category: 'Association' },
  { value: 'registry', label: 'Registry', category: 'Association' },
  { value: 'concours', label: 'Concours/Event', category: 'Association' },
  // Platform
  { value: 'marketplace', label: 'Marketplace', category: 'Platform' },
  { value: 'data_platform', label: 'Data Platform', category: 'Platform' },
  { value: 'investment_platform', label: 'Investment Platform', category: 'Platform' },
  // Investment
  { value: 'investment_fund', label: 'Investment Fund', category: 'Investment' },
  { value: 'series_llc', label: 'Series LLC', category: 'Investment' },
  { value: 'spv', label: 'SPV', category: 'Investment' },
  // Other
  { value: 'media', label: 'Media', category: 'Other' },
  { value: 'racing_team', label: 'Racing Team', category: 'Other' },
  { value: 'builder', label: 'Builder', category: 'Other' },
  { value: 'parts_supplier', label: 'Parts Supplier', category: 'Other' },
  { value: 'forum', label: 'Forum', category: 'Other' },
  { value: 'developer', label: 'Developer', category: 'Other' },
  { value: 'other', label: 'Other', category: 'Other' },
  { value: 'uncategorized', label: 'Uncategorized', category: 'Other' },
];

export const LEGAL_STRUCTURES: { value: LegalStructure; label: string; category: string }[] = [
  { value: 'individual', label: 'Individual', category: 'Individual' },
  { value: 'sole_proprietorship', label: 'Sole Proprietorship', category: 'Individual' },
  { value: 'partnership', label: 'Partnership', category: 'Partnership' },
  { value: 'llc', label: 'LLC', category: 'LLC' },
  { value: 'single_member_llc', label: 'Single-Member LLC', category: 'LLC' },
  { value: 'multi_member_llc', label: 'Multi-Member LLC', category: 'LLC' },
  { value: 'series_llc', label: 'Series LLC', category: 'LLC' },
  { value: 'corporation', label: 'Corporation', category: 'Corporation' },
  { value: 'c_corp', label: 'C-Corp', category: 'Corporation' },
  { value: 's_corp', label: 'S-Corp', category: 'Corporation' },
  { value: 'revocable_trust', label: 'Revocable Trust', category: 'Trust' },
  { value: 'irrevocable_trust', label: 'Irrevocable Trust', category: 'Trust' },
  { value: 'dynasty_trust', label: 'Dynasty Trust', category: 'Trust' },
  { value: 'charitable_remainder_trust', label: 'Charitable Remainder Trust', category: 'Trust' },
  { value: 'foundation_501c3', label: '501(c)(3) Foundation', category: 'Nonprofit' },
  { value: 'social_club_501c7', label: '501(c)(7) Social Club', category: 'Nonprofit' },
  { value: 'limited_partnership', label: 'Limited Partnership', category: 'Investment' },
  { value: 'family_limited_partnership', label: 'Family Limited Partnership', category: 'Investment' },
  { value: 'family_office', label: 'Family Office', category: 'Investment' },
  { value: 'unknown', label: 'Unknown', category: 'Other' },
];

// Backward compat: legacy BUSINESS_TYPES constant
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
  { value: 'developer', label: 'Developer' },
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
