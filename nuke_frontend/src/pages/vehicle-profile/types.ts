import type { LinkedOrg } from '../../components/vehicle/LinkedOrganizations';

// =============================================================================
// Vehicle Profile Type Contract
// =============================================================================
// Every field the RPC returns has a name and a type.
// If it doesn't exist here, it doesn't exist on the screen.
// NO [key: string]: any. NO escape hatches.
// =============================================================================

// --- Vehicle ---

export interface Vehicle {
  id: string;
  // Identity
  year: number | null;
  make: string | null;
  model: string | null;
  series: string | null;
  trim: string | null;
  vin: string | null;
  title: string | null;
  generation: string | null;
  normalized_model: string | null;
  normalized_series: string | null;
  model_series: string | null;
  cab_config: string | null;
  trim_level: string | null;
  trim_details: string | null;
  body_style: string | null;
  canonical_body_style: string | null;
  canonical_vehicle_type: string | null;
  vehicle_category: string | null;
  era: string | null;
  listing_kind: string;

  // Appearance
  color: string | null;
  color_primary: string | null;
  color_secondary: string | null;
  secondary_color: string | null;
  paint_code: string | null;
  paint_code_secondary: string | null;
  color_family: string | null;
  interior_color: string | null;
  interior_color_secondary: string | null;
  interior_color_tertiary: string | null;
  seat_type: string | null;
  seat_material_primary: string | null;
  seat_material_secondary: string | null;
  interior_material_details: string | null;
  has_molding: boolean | null;
  has_pinstriping: boolean | null;
  has_body_kit: boolean | null;
  has_racing_stripes: boolean | null;
  has_spoiler: boolean | null;
  has_air_dam: boolean | null;

  // Mechanical
  engine: string | null;
  engine_size: string | null;
  engine_type: string | null;
  engine_code: string | null;
  engine_displacement: string | null;
  engine_liters: number | null;
  displacement: string | null;
  horsepower: number | null;
  torque: number | null;
  compression_ratio: number | null;
  bore_mm: number | null;
  stroke_mm: number | null;
  redline_rpm: number | null;
  timing_type: string | null;
  cam_type: string | null;
  intake_type: string | null;
  carburetor_type: string | null;
  fuel_pressure_psi: number | null;
  fuel_octane: number | null;
  fuel_type: string | null;
  fuel_system_type: string | null;
  fuel_capacity_gallons: number | null;
  distributor_type: string | null;
  headers_type: string | null;
  exhaust_type: string | null;
  exhaust_diameter: string | null;
  manifold_type: string | null;
  oil_type: string | null;
  coolant_type: string | null;
  transmission: string | null;
  transmission_type: string | null;
  transmission_model: string | null;
  transmission_code: string | null;
  transmission_speeds: number | null;
  drivetrain: string | null;
  rear_axle_ratio: number | null;
  rear_axle_type: string | null;
  transfer_case: string | null;
  clutch_type: string | null;
  driveshaft_type: string | null;
  steering_type: string | null;
  steering_pump: string | null;
  frame_type: string | null;

  // Suspension & Brakes
  suspension_front: string | null;
  suspension_rear: string | null;
  brake_type_front: string | null;
  brake_type_rear: string | null;
  brake_booster_type: string | null;
  brake_master_cylinder: string | null;
  front_rotor_size: string | null;
  rear_rotor_size: string | null;
  abs_equipped: boolean | null;
  wheel_diameter_front: number | null;
  wheel_diameter_rear: number | null;
  tire_spec_front: string | null;
  tire_spec_rear: string | null;

  // Dimensions
  doors: number | null;
  seats: number | null;
  weight_lbs: number | null;
  length_inches: number | null;
  width_inches: number | null;
  height_inches: number | null;
  wheelbase_inches: number | null;
  ground_clearance_inches: number | null;
  ride_height_inches: number | null;
  lift_inches: number | null;
  drag_coefficient: number | null;
  frontal_area_sqft: number | null;

  // Performance
  zero_to_sixty: number | null;
  quarter_mile: number | null;
  quarter_mile_speed: number | null;
  top_speed_mph: number | null;
  braking_60_0_ft: number | null;
  lateral_g: number | null;
  power_to_weight: number | null;
  mpg_city: number | null;
  mpg_highway: number | null;
  mpg_combined: number | null;

  // Condition & Scores
  mileage: number | null;
  condition_rating: number | null;
  is_modified: boolean | null;
  modification_details: string | null;
  tire_condition_score: number | null;
  brake_condition_score: number | null;
  suspension_condition_score: number | null;
  steering_condition_score: number | null;
  engine_health_score: number | null;
  compression_test_psi: Record<string, unknown> | null;
  leakdown_test_pct: Record<string, unknown> | null;

  // Scores (computed)
  data_quality_score: number | null;
  quality_issues: string[] | null;
  requires_improvement: boolean | null;
  last_quality_check: string | null;
  quality_grade: number | null;
  value_score: number | null;
  value_breakdown: Record<string, unknown> | null;
  signal_score: number | null;
  signal_reasons: string[] | null;
  last_signal_assessed_at: string | null;
  completion_percentage: number | null;
  perf_power_score: number | null;
  perf_acceleration_score: number | null;
  perf_braking_score: number | null;
  perf_handling_score: number | null;
  perf_comfort_score: number | null;
  perf_scores_updated_at: string | null;
  social_positioning_score: number | null;
  social_positioning_breakdown: Record<string, unknown> | null;
  investment_quality_score: number | null;
  investment_grade: string | null;
  investment_confidence: number | null;
  provenance_score: number | null;
  overall_desirability_score: number | null;

  // Pricing & Valuation
  sale_price: number | null;
  sold_price: number | null;
  price: number | null;
  asking_price: number | null;
  purchase_price: number | null;
  msrp: number | null;
  current_value: number | null;
  current_bid: number | null;
  high_bid: number | null;
  winning_bid: number | null;
  nuke_estimate: number | null;
  nuke_estimate_confidence: number | null;
  deal_score: number | null;
  heat_score: number | null;
  cz_estimated_value: number | null;
  valuation_calculated_at: string | null;
  price_is_outlier: boolean | null;
  price_outlier_reason: string | null;
  price_confidence: string | null;

  // Auction / Listing
  auction_source: string | null;
  auction_status: string | null;
  auction_outcome: string | null;
  auction_end_date: string | null;
  reserve_status: string | null;
  bid_count: number | null;
  view_count: number | null;
  comment_count: number | null;
  is_for_sale: boolean | null;
  sale_status: string | null;
  sale_date: string | null;
  bat_auction_url: string | null;
  bat_listing_title: string | null;
  bat_sold_price: number | null;
  bat_sale_date: string | null;
  bat_bid_count: number | null;
  bat_bids: number | null;
  bat_view_count: number | null;
  bat_views: number | null;
  bat_comments: number | null;
  bat_location: string | null;
  bat_seller: string | null;
  bat_buyer: string | null;
  bat_lot_number: string | null;
  bat_watchers: number | null;
  listing_url: string | null;
  listing_source: string | null;
  listing_title: string | null;
  listing_location: string | null;
  listing_location_raw: string | null;
  listing_location_observed_at: string | null;
  listing_location_source: string | null;
  listing_location_confidence: number | null;
  listing_posted_at: string | null;
  listing_updated_at: string | null;
  rennlist_url: string | null;
  rennlist_listing_id: string | null;

  // BaT content
  description: string | null;
  highlights: string | null;
  equipment: string | null;
  modifications: string | null;
  known_flaws: string | null;
  recent_service_history: string | null;
  dougs_take: string | null;
  title_status: string | null;
  seller_name: string | null;

  // Ownership & Users
  user_id: string | null;
  uploaded_by: string | null;
  owner_id: string | null;
  owner_name: string | null;
  owner_contact: string | null;
  owner_shop_id: string | null;
  acting_on_behalf_of: string | null;
  ownership_percentage: number | null;
  relationship_notes: string | null;
  ownership_verified: boolean | null;
  ownership_verified_at: string | null;
  ownership_verification_id: string | null;
  ownership_confirmed_at: string | null;
  current_transfer_id: string | null;
  ownership_type: string | null;
  is_public: boolean | null;
  is_draft: boolean | null;
  is_daily_driver: boolean | null;
  is_weekend_car: boolean | null;
  is_track_car: boolean | null;
  is_show_car: boolean | null;
  is_project_car: boolean | null;
  is_garage_kept: boolean | null;
  is_streaming: boolean | null;
  received_in_trade: boolean | null;

  // Location
  location: string | null;
  zip_code: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  registration_state: string | null;
  registration_expiry: string | null;
  purchase_location: string | null;
  purchase_date: string | null;

  // Provenance & Source
  profile_origin: string | null;
  origin_organization_id: string | null;
  origin_metadata: Record<string, unknown> | null;
  discovery_url: string | null;
  discovery_source: string | null;
  discovered_by: string | null;
  source: string | null;
  import_source: string | null;
  import_metadata: Record<string, unknown> | null;
  import_method: string | null;
  import_queue_id: string | null;
  imported_by: string | null;
  platform_source: string | null;
  platform_url: string | null;
  provenance_metadata: Record<string, unknown> | null;
  entry_type: string | null;
  content_source_type: string | null;
  content_source_id: string | null;
  automation_script: string | null;
  created_by_user_id: string | null;
  created_via_role: string | null;
  extractor_version: string | null;

  // Data confidence
  verification_status: string | null;
  confidence_score: number | null;
  vin_source: string | null;
  vin_confidence: number | null;
  vin_source_image_id: string | null;
  year_source: string | null;
  year_confidence: number | null;
  make_source: string | null;
  make_confidence: number | null;
  model_source: string | null;
  model_confidence: number | null;
  series_source: string | null;
  series_confidence: number | null;
  trim_source: string | null;
  trim_confidence: number | null;
  mileage_source: string | null;
  engine_source: string | null;
  transmission_source: string | null;
  color_source: string | null;
  description_source: string | null;
  description_generated_at: string | null;
  msrp_source: string | null;
  msrp_contributed_by: string | null;

  // Misc
  status: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  uploaded_at: string | null;
  license_plate: string | null;
  insurance_company: string | null;
  insurance_policy_number: string | null;
  inspection_expiry: string | null;
  maintenance_notes: string | null;
  notes: string | null;
  previous_owners: number | null;
  primary_image_url: string | null;
  image_url: string | null;
  image_count: number;
  observation_count: number;
  display_tier: string | null;
  analysis_tier: number;
  merged_into_vehicle_id: string | null;
  selling_organization_id: string | null;
  segment_id: string | null;
  segment_slug: string | null;
  canonical_make_id: string | null;
  source_listing_category: string | null;
  last_enrichment_attempt: string | null;
  enrichment_failures: number | null;
  data_quality_flags: Record<string, unknown> | null;
  data_gaps: Record<string, unknown> | null;
  documents_on_hand: Record<string, unknown> | null;
  visual_signature: Record<string, unknown> | null;
  discovery_priority: number | null;
  last_inspection_date: string | null;
  inspection_type: string | null;
  inspection_passed: boolean | null;
  smog_exempt: boolean | null;
  last_fuel_receipt: Record<string, unknown> | null;
  title_transfer_date: string | null;
  quality_last_assessed: string | null;
  search_vector: string | null;
}

// --- Image Record (RPC + overflow query) ---

export interface ImageRecord {
  id: string;
  vehicle_id: string;
  image_url: string;
  thumbnail_url: string | null;
  medium_url: string | null;
  large_url: string | null;
  variants: Record<string, string> | null;
  is_primary: boolean | null;
  is_document: boolean | null;
  position: number | null;
  created_at: string | null;
  storage_path: string | null;
  caption: string | null;
  image_type: string | null;
  category: string | null;
  file_name: string | null;
  source: string | null;
  // Extended fields (from overflow DB query / components)
  taken_at: string | null;
  vehicle_zone: string | null;
  photo_quality_score: number | null;
  condition_score: number | null;
  damage_flags: string[] | null;
  modification_flags: string[] | null;
  is_sensitive: boolean;
  sensitive_type: string | null;
  document_category: string | null;
  ai_processing_status: string | null;
  optimization_status: string | null;
  organization_status: string | null;
  angle: string | null;
  latitude: number | null;
  longitude: number | null;
  location_name: string | null;
  source_url: string | null;
  is_duplicate: boolean | null;
  duplicate_of: string | null;
  exif_data: Record<string, unknown> | null;
  ai_scan_metadata: Record<string, unknown> | null;
  components: Record<string, unknown> | null;
  fabrication_stage: string | null;
  vehicle_vin: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
}

// --- Timeline Event ---

export interface TimelineEvent {
  id: string;
  vehicle_id: string;
  user_id: string | null;
  event_type: string;
  source: string;
  source_type: string;
  title: string;
  description: string | null;
  event_date: string;
  event_category: string | null;
  activity_type: string | null;
  image_urls: string[] | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
  mileage_at_event: number | null;
  cost_amount: number | null;
  cost_currency: string | null;
  cost_estimate: number | null;
  duration_hours: number | null;
  labor_hours: number | null;
  location_name: string | null;
  location_address: string | null;
  service_provider_name: string | null;
  service_provider_type: string | null;
  invoice_number: string | null;
  parts_used: string[] | null;
  parts_mentioned: string[] | null;
  tools_mentioned: string[] | null;
  confidence_score: number | null;
  data_source: string | null;
  automated_tags: string[] | null;
  manual_tags: string[] | null;
  value_impact: number | null;
  ai_confidence_score: number | null;
  concerns: string[] | null;
}

// --- Vehicle Comment ---

export interface VehicleComment {
  id: string;
  vehicle_id: string;
  user_id: string;
  comment_text: string;
  created_at: string | null;
  updated_at: string | null;
  image_urls: string[] | null;
  is_nsfw: boolean | null;
  moderator_only: boolean | null;
}

// --- Vehicle Valuation ---

export interface VehicleValuation {
  id: string;
  vehicle_id: string;
  estimated_value: number;
  documented_components: number | null;
  confidence_score: number | null;
  components: Record<string, unknown> | null;
  environmental_context: Record<string, unknown> | null;
  value_justification: string | null;
  methodology: string | null;
  valuation_date: string | null;
  created_at: string | null;
  evidence_score: number;
  required_evidence: Record<string, unknown>;
  source_run_id: string | null;
}

// --- External Listing ---

export interface ExternalListing {
  id: string;
  vehicle_id: string;
  organization_id: string | null;
  platform: string;
  listing_url: string;
  listing_id: string | null;
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
  commission_rate: number | null;
  affiliate_link: string | null;
  sync_enabled: boolean | null;
  last_synced_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
}

// --- Profile Stats (from RPC) ---

export interface ProfileStats {
  image_count: number;
  event_count: number;
  comment_count: number;
  document_count: number;
  last_activity: string | null;
  total_documented_costs: number;
}

// --- Aggregate RPC Response ---

export interface VehicleProfileData {
  vehicle: Vehicle;
  images: ImageRecord[];
  timeline_events: TimelineEvent[];
  comments: VehicleComment[];
  latest_valuation: VehicleValuation | null;
  external_listings: ExternalListing[];
  stats: ProfileStats;
}

// =============================================================================
// Component Props (unchanged interfaces below)
// =============================================================================

export interface VehiclePermissions {
  isVerifiedOwner: boolean;
  hasContributorAccess: boolean;
  contributorRole: string | null;
  isDbUploader: boolean;
}

export interface SaleSettings {
  for_sale: boolean;
  live_auction: boolean;
  partners: string[];
  reserve: number | '';
}

export interface FieldAudit {
  open: boolean;
  fieldName: string;
  fieldLabel: string;
  entries: Array<{
    field_value: string;
    source_type?: string;
    user_id?: string;
    is_verified?: boolean;
    updated_at: string;
  }>;
  score?: number;
  met?: string[];
  next?: string[];
}

export interface CommentPopup {
  isOpen: boolean;
  targetId: string;
  targetType: 'vehicle' | 'data_point';
  targetLabel: string;
  anchorElement?: HTMLElement;
  dataPointType?: string;
  dataPointValue?: string;
}

export interface LiveSession {
  id: string;
  platform: string;
  stream_url: string | null;
  title: string | null;
  stream_provider?: string | null;
}

export interface AuctionPulse {
  platform: string;
  listing_url: string;
  listing_status: string;
  end_date: string | null;
  current_bid: number | null;
  bid_count: number | null;
  watcher_count: number | null;
  view_count: number | null;
  comment_count: number | null;
  last_bid_at: string | null;
  last_comment_at: string | null;
  updated_at: string | null;
}

export interface VehicleBaseProps {
  vehicle: Vehicle;
  session: any;
  permissions: VehiclePermissions;
}

export interface VehicleHeaderProps {
  vehicle: Vehicle | null;
  isOwner: boolean;
  canEdit: boolean;
  session?: any;
  permissions?: VehiclePermissions;
  responsibleName?: string;
  onPriceClick?: () => void;
  initialValuation?: VehicleValuation | null;
  initialPriceSignal?: any;
  organizationLinks?: any[];
  onClaimClick?: () => void;
  userOwnershipClaim?: {
    id: string;
    status: string;
    verification_type?: string | null;
    title_document_url?: string | null;
    drivers_license_url?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
  } | null;
  suppressExternalListing?: boolean;
  leadImageUrl?: string | null;
  liveSession?: LiveSession | null;
  auctionPulse?: AuctionPulse | null;
}

export interface HeroMeta {
  camera?: string;
  location?: string;
  date?: string;
}

export interface VehicleHeroImageProps {
  leadImageUrl: string | null;
  overlayNode?: React.ReactNode;
  heroMeta?: HeroMeta | null;
}

export interface VehiclePricingSectionProps {
  vehicle: Vehicle | null;
  saleSettings?: SaleSettings;
  isOwner: boolean;
}

export interface WorkMemorySectionProps {
  vehicleId: string;
  permissions: VehiclePermissions;
}

export interface ImageGalleryV2Props {
  vehicleId: string;
  vehicleYMM?: { year?: number; make?: string; model?: string };
  onImagesUpdated?: () => void;
  showUpload?: boolean;
}

export interface FinancialProductsProps {
  vehicleId: string;
  vehicleName?: string;
  vehicleValue?: number;
}

export interface MobilePhotoDumpProps {
  onClose: () => void;
  session: any;
  vehicleId?: string;
}

export interface LinkedOrganizationsProps {
  organizations: any[];
}

export interface MobileVehicleProfileV2Props {
  vehicleId?: string;
  isMobile?: boolean;
}

export interface VehicleBasicInfoProps extends VehicleBaseProps {
  onDataPointClick?: (event: React.MouseEvent, dataType: string, dataValue: string, label: string) => void;
  onEditClick?: () => void;
  onOpenVINProofImages?: () => void;
}

export interface VehicleTimelineSectionProps extends VehicleBaseProps {
  onAddEventClick?: () => void;
}

export interface VehicleImageGalleryProps extends VehicleBaseProps {
  showMap: boolean;
  onToggleMap: () => void;
  onImageUpdate: () => void;
}

export interface VehicleCommentsSectionProps {
  vehicleId: string;
}

export interface VehicleSaleSettingsProps extends VehicleBaseProps {
  saleSettings: SaleSettings;
  savingSale: boolean;
  viewCount: number;
  onSaleSettingsChange: (settings: SaleSettings) => void;
  onSaveSaleSettings: () => void;
  onShowCompose: () => void;
}

export interface VehicleMetadataProps extends VehicleBaseProps {
  isPublic: boolean;
  viewCount: number;
  onPrivacyChange: (isPublic: boolean) => void;
}

export interface WorkspaceContentProps {
  vehicle: Vehicle;
  session: any;
  permissions: VehiclePermissions;
  images: ImageRecord[];
  timelineEvents: TimelineEvent[];
  comments: VehicleComment[];
  stats: ProfileStats;
  latestValuation: VehicleValuation | null;
  externalListings: ExternalListing[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  onImageClick: (image: ImageRecord, index: number) => void;
  onImagesUpdated: () => void;
}
