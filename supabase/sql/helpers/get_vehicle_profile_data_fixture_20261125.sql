-- get_vehicle_profile_data fixture, generated 2026-11-25 from the live catalog (pg_attribute, pg_constraint, column
-- privileges) for the tables the reader and its helpers read. Columns keep their live types; enum, domain and extension
-- types become text. Every live foreign key on a vehicle_id, user_id, image_id, owner_id or uploaded_by column is kept;
-- other constraints and defaults are left out. vehicles and external_listings carry their live column grants to anon
-- and authenticated. Live bodies: vehicle_user_has_access, jsonb_mask_keys, text_redact_contact,
-- vehicle_row_public_projection, get_vehicle_profile_data (sha-asserted by the test that loads this file).
-- vehicle_image_gallery_eligible is a stub (true): the gallery gate is not under test here and has its own contract.
-- Schema only; no production row is copied. Load into an empty disposable PG17 database.
-- guardrail-allow(center-key-fk): vehicles: disposable fixture mirroring the live table, which has no foreign key on these columns
-- guardrail-allow(center-key-fk): vehicle_images: disposable fixture mirroring the live table, which has no foreign key on these columns
-- guardrail-allow(center-key-fk): timeline_events: disposable fixture mirroring the live table, which has no foreign key on these columns
-- guardrail-allow(center-key-fk): work_sessions: disposable fixture mirroring the live table, which has no foreign key on these columns
-- guardrail-allow(center-key-fk): auction_comments: disposable fixture mirroring the live table, which has no foreign key on these columns
-- guardrail-allow(center-key-fk): vehicle_observations: disposable fixture mirroring the live table, which has no foreign key on these columns
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
-- Signs in as a user id ('' = anon, 'service' = service_role, 'none' = no claims), as PostgREST sets the claims.
CREATE FUNCTION public.t_claims(p_uid text) RETURNS void LANGUAGE sql AS
$$ SELECT set_config('request.jwt.claims', CASE WHEN p_uid = '' THEN '{"role":"anon"}'
     WHEN p_uid = 'service' THEN '{"role":"service_role"}' WHEN p_uid = 'none' THEN ''
     ELSE json_build_object('sub', p_uid, 'role', 'authenticated')::text END, false) $$;
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id));
CREATE TABLE public.auction_events_canonical (id uuid PRIMARY KEY);

CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY,
  uploaded_by uuid,
  make text,
  model text,
  year integer,
  vin text,
  license_plate text,
  color text,
  mileage integer,
  fuel_type text,
  transmission text,
  engine_size text,
  horsepower integer,
  torque integer,
  drivetrain text,
  body_style text,
  doors integer,
  seats integer,
  weight_lbs integer,
  length_inches integer,
  width_inches integer,
  height_inches integer,
  wheelbase_inches integer,
  fuel_capacity_gallons numeric(5,2),
  mpg_city integer,
  mpg_highway integer,
  mpg_combined integer,
  msrp numeric(10,2),
  current_value numeric(10,2),
  purchase_price numeric(10,2),
  purchase_date date,
  purchase_location text,
  previous_owners integer,
  is_modified boolean,
  modification_details text,
  condition_rating integer,
  maintenance_notes text,
  insurance_company text,
  insurance_policy_number text,
  registration_state text,
  registration_expiry date,
  inspection_expiry date,
  is_public boolean,
  notes text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  sale_price integer,
  auction_end_date text,
  bid_count integer,
  view_count integer,
  auction_source text,
  ownership_verified boolean,
  ownership_verified_at timestamp without time zone,
  ownership_verification_id uuid,
  bat_auction_url text,
  bat_sold_price numeric(10,2),
  bat_sale_date date,
  bat_bid_count integer,
  bat_view_count integer,
  is_daily_driver boolean,
  is_weekend_car boolean,
  is_track_car boolean,
  is_show_car boolean,
  is_project_car boolean,
  is_garage_kept boolean,
  discovered_by uuid,
  discovery_source text,
  discovery_url text,
  bat_listing_title text,
  bat_bids integer,
  bat_comments integer,
  bat_views integer,
  bat_location text,
  bat_seller text,
  sale_status text,
  sale_date date,
  status text,
  completion_percentage integer,
  displacement text,
  interior_color text,
  is_for_sale boolean,
  is_draft boolean,
  deleted_at timestamp with time zone,
  entry_type text,
  verification_status text,
  confidence_score integer,
  source text,
  import_source character varying(255),
  import_metadata jsonb,
  uploaded_at timestamp(0) without time zone,
  asking_price numeric,
  owner_shop_id uuid,
  user_id uuid,
  acting_on_behalf_of text,
  ownership_percentage numeric(5,2),
  owner_name text,
  owner_contact text,
  relationship_notes text,
  description text,
  value_score numeric,
  value_breakdown jsonb,
  owner_id uuid,
  quality_grade numeric(3,1),
  investment_grade text,
  investment_confidence integer,
  quality_last_assessed timestamp with time zone,
  trim text,
  color_primary text,
  color_secondary text,
  paint_code text,
  paint_code_secondary text,
  zip_code text,
  city text,
  state text,
  country text,
  gps_latitude numeric,
  gps_longitude numeric,
  imported_by uuid,
  title_transfer_date date,
  primary_image_url text,
  title text,
  data_quality_score integer,
  quality_issues text[],
  requires_improvement boolean,
  last_quality_check timestamp with time zone,
  vin_source text,
  year_source text,
  make_source text,
  model_source text,
  mileage_source text,
  engine_source text,
  transmission_source text,
  color_source text,
  vin_confidence integer,
  year_confidence integer,
  make_confidence integer,
  model_confidence integer,
  created_by_user_id uuid,
  created_via_role text,
  import_method text,
  automation_script text,
  content_source_type text,
  content_source_id uuid,
  platform_source text,
  platform_url text,
  provenance_metadata jsonb,
  bat_buyer text,
  profile_origin text,
  origin_organization_id uuid,
  origin_metadata jsonb,
  series text,
  series_source text,
  series_confidence integer,
  trim_source text,
  trim_confidence integer,
  description_source text,
  description_generated_at timestamp with time zone,
  model_series text,
  cab_config text,
  trim_level text,
  engine_displacement text,
  engine_liters numeric,
  engine_type text,
  engine_code text,
  transmission_model text,
  transmission_type text,
  transmission_code text,
  merged_into_vehicle_id uuid,
  secondary_color text,
  has_molding boolean,
  has_pinstriping boolean,
  has_body_kit boolean,
  has_racing_stripes boolean,
  trim_details text,
  interior_color_secondary text,
  interior_color_tertiary text,
  seat_type text,
  seat_material_primary text,
  seat_material_secondary text,
  interior_material_details text,
  received_in_trade boolean,
  import_queue_id uuid,
  selling_organization_id uuid,
  price integer,
  sold_price integer,
  normalized_model text,
  normalized_series text,
  generation text,
  auction_outcome text,
  high_bid integer,
  winning_bid integer,
  vin_source_image_id uuid,
  location text,
  is_streaming boolean,
  image_url text,
  search_vector tsvector,
  listing_url text,
  listing_source text,
  listing_posted_at timestamp with time zone,
  listing_updated_at timestamp with time zone,
  listing_title text,
  listing_location text,
  analysis_tier integer,
  signal_score numeric,
  signal_reasons text[],
  last_signal_assessed_at timestamp with time zone,
  listing_location_raw text,
  listing_location_observed_at timestamp with time zone,
  listing_location_source text,
  listing_location_confidence real,
  bat_lot_number text,
  bat_watchers integer,
  reserve_status text,
  canonical_vehicle_type text,
  canonical_body_style text,
  listing_kind text,
  segment_id uuid,
  era text,
  canonical_make_id uuid,
  source_listing_category text,
  dougs_take text,
  highlights text,
  equipment text,
  modifications text,
  known_flaws text,
  recent_service_history text,
  title_status text,
  seller_name text,
  comment_count integer,
  auction_status text,
  extractor_version text,
  rennlist_url text,
  rennlist_listing_id text,
  documents_on_hand jsonb,
  price_is_outlier boolean,
  price_outlier_reason text,
  data_gaps jsonb,
  nuke_estimate numeric(12,2),
  nuke_estimate_confidence integer,
  deal_score numeric(5,2),
  heat_score numeric(5,2),
  valuation_calculated_at timestamp with time zone,
  zero_to_sixty numeric(4,1),
  quarter_mile numeric(4,1),
  quarter_mile_speed numeric(5,1),
  top_speed_mph integer,
  braking_60_0_ft numeric(5,1),
  lateral_g numeric(3,2),
  redline_rpm integer,
  power_to_weight numeric(6,2),
  suspension_front text,
  suspension_rear text,
  brake_type_front text,
  brake_type_rear text,
  wheel_diameter_front integer,
  wheel_diameter_rear integer,
  tire_spec_front text,
  tire_spec_rear text,
  tire_condition_score integer,
  brake_condition_score integer,
  suspension_condition_score integer,
  perf_power_score integer,
  perf_acceleration_score integer,
  perf_braking_score integer,
  perf_handling_score integer,
  perf_comfort_score integer,
  social_positioning_score integer,
  investment_quality_score integer,
  provenance_score integer,
  overall_desirability_score integer,
  perf_scores_updated_at timestamp with time zone,
  social_positioning_breakdown jsonb,
  compression_ratio numeric(4,1),
  compression_test_psi jsonb,
  leakdown_test_pct jsonb,
  engine_health_score integer,
  timing_type text,
  cam_type text,
  intake_type text,
  carburetor_type text,
  fuel_pressure_psi numeric(4,1),
  fuel_octane integer,
  distributor_type text,
  headers_type text,
  exhaust_type text,
  exhaust_diameter text,
  manifold_type text,
  oil_type text,
  coolant_type text,
  bore_mm numeric(5,1),
  stroke_mm numeric(5,1),
  rear_axle_ratio numeric(4,2),
  rear_axle_type text,
  transfer_case text,
  clutch_type text,
  driveshaft_type text,
  transmission_speeds integer,
  steering_type text,
  steering_pump text,
  steering_condition_score integer,
  frame_type text,
  brake_booster_type text,
  brake_master_cylinder text,
  front_rotor_size text,
  rear_rotor_size text,
  abs_equipped boolean,
  drag_coefficient numeric(4,3),
  frontal_area_sqft numeric(5,2),
  ground_clearance_inches numeric(4,1),
  ride_height_inches numeric(4,1),
  has_spoiler boolean,
  has_air_dam boolean,
  lift_inches numeric(4,1),
  last_fuel_receipt jsonb,
  fuel_system_type text,
  last_inspection_date date,
  inspection_type text,
  inspection_passed boolean,
  smog_exempt boolean,
  segment_slug text,
  last_enrichment_attempt timestamp with time zone,
  enrichment_failures integer,
  msrp_source text,
  msrp_contributed_by uuid,
  color_family text,
  data_quality_flags jsonb,
  current_transfer_id uuid,
  ownership_confirmed_at timestamp with time zone,
  vehicle_category text,
  display_tier text,
  price_confidence text,
  cz_estimated_value numeric,
  image_count integer,
  observation_count integer,
  visual_signature jsonb,
  discovery_priority smallint,
  canonical_platform text,
  canonical_sold_price numeric,
  canonical_outcome text,
  realization_plan jsonb,
  has_photos boolean,
  existence_tier text,
  is_replica boolean,
  replica_quote text,
  numbers_state text,
  numbers_documented_by text[],
  numbers_quote text,
  body_style_quote text,
  currency_code text,
  currency_source text,
  sale_price_currency text,
  sale_price_usd numeric,
  sale_price_fx_rate numeric,
  sale_price_fx_date date,
  sale_price_fx_source text,
  odometer_reading numeric,
  odometer_unit text,
  odometer_source_url text,
  mileage_normalized_miles integer,
  mileage_normalized_method text,
  mileage_normalized_confidence text,
  mileage_normalized_source text,
  sale_price_fx_provider text,
  description_truncated boolean,
  description_length_source text,
  source_listing_key text,
  title_make_code text,
  build_class text,
  FOREIGN KEY (owner_id) REFERENCES public.profiles(id),
  FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id),
  FOREIGN KEY (owner_id) REFERENCES auth.users(id),
  FOREIGN KEY (uploaded_by) REFERENCES auth.users(id)
);
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY,
  vehicle_id uuid,
  user_id uuid,
  image_url text,
  image_type text,
  category text,
  position integer,
  caption text,
  is_primary boolean,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  exif_data jsonb,
  timeline_event_id uuid,
  image_context text,
  file_hash text,
  file_name text,
  file_size bigint,
  taken_at timestamp with time zone,
  source text,
  source_url text,
  is_external boolean,
  mime_type text,
  is_sensitive boolean,
  sensitive_type text,
  storage_path text,
  safe_preview_url text,
  process_stage text,
  workflow_role text,
  area text,
  part text,
  damage_type text,
  operation text,
  materials text[],
  labels text[],
  task_id uuid,
  event_id uuid,
  angle text,
  perspective text,
  latitude numeric(10,8),
  longitude numeric(11,8),
  location_name text,
  thumbnail_url text,
  medium_url text,
  large_url text,
  optimization_status text,
  optimized_at timestamp with time zone,
  variants jsonb,
  spatial_tags jsonb[],
  ai_scan_metadata jsonb,
  ai_last_scanned timestamp with time zone,
  ai_component_count integer,
  ai_avg_confidence numeric(3,2),
  filename text,
  temp_session_id text,
  is_approved boolean,
  approved_by uuid,
  approved_at timestamp with time zone,
  imported_by uuid,
  ghost_user_id uuid,
  verification_status text,
  pending_submission_id uuid,
  image_category text,
  approval_status text,
  submitted_by uuid,
  redaction_level text,
  redacted_by uuid,
  redacted_at timestamp with time zone,
  redaction_reason text,
  uploaded_at timestamp with time zone,
  analysis_history jsonb,
  context_score integer,
  processing_models_used text[],
  total_processing_cost numeric(10,6),
  rotation integer,
  document_classification text,
  is_document boolean,
  document_category text,
  manual_priority integer,
  display_order integer,
  user_tags text[],
  user_notes text,
  ai_processing_status text,
  ai_processing_started_at timestamp with time zone,
  ai_processing_completed_at timestamp with time zone,
  ai_suggestions jsonb,
  organization_status text,
  organized_at timestamp with time zone,
  ai_detected_vehicle jsonb,
  ai_detected_angle text,
  ai_detected_angle_confidence real,
  suggested_vehicle_id uuid,
  perceptual_hash text,
  dhash text,
  duplicate_of uuid,
  is_duplicate boolean,
  documented_by_device text,
  documented_by_user_id uuid,
  photographer_attribution text,
  user_confirmed_vehicle boolean,
  user_confirmed_vehicle_by uuid,
  user_confirmed_vehicle_at timestamp with time zone,
  auto_suggested_vehicle_id uuid,
  auto_suggestion_confidence real,
  auto_suggestion_reasons text[],
  angle_confidence numeric,
  yaw_deg numeric,
  yaw_confidence numeric,
  angle_source text,
  bbox jsonb,
  doc_flag boolean,
  doc_confidence numeric,
  components jsonb,
  vehicle_vin text,
  vehicle_vin_confidence numeric,
  vehicle_make text,
  vehicle_model text,
  vehicle_year integer,
  vehicle_confidence numeric,
  vehicle_source text,
  stale boolean,
  last_rerun_at timestamp with time zone,
  tags jsonb,
  ai_extractions jsonb,
  ai_extraction_consensus jsonb,
  device_fingerprint text,
  location_confidence numeric(3,2),
  phash text,
  condition_score smallint,
  damage_flags text[],
  modification_flags text[],
  photo_quality_score smallint,
  vision_analyzed_at timestamp with time zone,
  vision_model_version text,
  surface_coord_v numeric(8,2),
  surface_coord_u numeric(8,2),
  camera_pose jsonb,
  vehicle_zone text,
  zone_confidence numeric(4,3),
  yono_queued_at timestamp with time zone,
  interior_quality smallint,
  zone_source text,
  fabrication_stage text,
  stage_confidence real,
  duration_seconds numeric,
  video_codec text,
  video_resolution text,
  is_video boolean,
  image_vehicle_match_status text,
  image_medium text,
  apple_ml_labels text[],
  vehicle_score real,
  upload_batch_id uuid,
  work_session_id uuid,
  merged_from_vehicle_id uuid,
  vision_gate_status text,
  vision_gate_processed_at timestamp with time zone,
  vision_gate_agent_reasoning text,
  vision_gate_attribution_confidence numeric,
  is_superseded boolean,
  superseded_by uuid,
  superseded_at timestamp with time zone,
  ai_retry_count integer,
  image_identity_id uuid,
  occurred_at timestamp with time zone,
  ingest_kind text,
  FOREIGN KEY (user_id) REFERENCES auth.users(id),
  FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id)
);
CREATE TABLE public.timeline_events (
  id uuid PRIMARY KEY,
  vehicle_id uuid,
  user_id uuid,
  event_type text,
  source text,
  title text,
  description text,
  event_date date,
  image_urls text[],
  metadata jsonb,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  mileage_at_event integer,
  cost_amount numeric(10,2),
  cost_currency text,
  duration_hours numeric(5,2),
  location_name text,
  location_address text,
  location_coordinates point,
  service_provider_name text,
  service_provider_type text,
  invoice_number text,
  warranty_info jsonb,
  parts_used jsonb[],
  verification_documents jsonb[],
  is_insurance_claim boolean,
  insurance_claim_number text,
  next_service_due_date date,
  next_service_due_mileage integer,
  data_source text,
  confidence_score integer,
  source_type text,
  event_category text,
  activity_type text,
  automated_tags text[],
  manual_tags text[],
  photo_analysis jsonb,
  receipt_data jsonb,
  parts_mentioned text[],
  tools_mentioned text[],
  labor_hours numeric,
  cost_estimate numeric,
  organization_id uuid,
  client_id uuid,
  is_monetized boolean,
  work_started timestamp with time zone,
  work_completed timestamp with time zone,
  contract_id uuid,
  applied_labor_rate numeric(8,2),
  applied_shop_rate numeric(8,2),
  rate_source text,
  contextual_analysis_status text,
  documented_by uuid,
  primary_technician uuid,
  quality_rating integer,
  quality_justification text,
  value_impact numeric(10,2),
  ai_confidence_score numeric(3,2),
  concerns text[],
  industry_standard_comparison jsonb,
  search_vector tsvector,
  work_order_id uuid,
  merged_from_vehicle_id uuid,
  FOREIGN KEY (user_id) REFERENCES auth.users(id),
  FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id)
);
CREATE TABLE public.work_sessions (
  id uuid PRIMARY KEY,
  user_id uuid,
  vehicle_id uuid,
  session_date date,
  start_time timestamp with time zone,
  end_time timestamp with time zone,
  duration_minutes integer,
  confidence_score numeric(3,2),
  image_count integer,
  work_description text,
  metadata jsonb,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  user_activity_id uuid,
  status text,
  title text,
  work_type text,
  total_parts_cost numeric(10,2),
  total_tool_depreciation numeric(10,2),
  labor_rate_per_hour numeric(10,2),
  total_labor_cost numeric(10,2),
  total_job_cost numeric(10,2),
  quoted_price numeric(10,2),
  final_invoice numeric(10,2),
  profit_margin numeric(5,2),
  finalized_at timestamp with time zone,
  technician_id uuid,
  session_type text,
  start_image_id uuid,
  end_image_id uuid,
  zones_touched text[],
  stages_observed text[],
  stage_transitions jsonb,
  technician_phone_link_id uuid,
  place_id uuid,
  evidence jsonb,
  owner_confirmed_at timestamp with time zone,
  owner_confirmed_by uuid,
  intent text,
  intent_confidence numeric(4,3),
  intent_source text,
  FOREIGN KEY (user_id) REFERENCES auth.users(id),
  FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id)
);
CREATE TABLE public.vehicle_comments (
  id uuid PRIMARY KEY,
  vehicle_id uuid,
  user_id uuid,
  comment_text text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  image_urls text[],
  is_nsfw boolean,
  moderator_only boolean,
  FOREIGN KEY (user_id) REFERENCES auth.users(id),
  FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id)
);
CREATE TABLE public.vehicle_valuations (
  id uuid PRIMARY KEY,
  vehicle_id uuid,
  estimated_value numeric,
  documented_components numeric,
  confidence_score integer,
  components jsonb,
  environmental_context jsonb,
  value_justification text,
  methodology text,
  valuation_date timestamp with time zone,
  created_at timestamp with time zone,
  evidence_score integer,
  required_evidence jsonb,
  source_run_id uuid,
  FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id)
);
CREATE TABLE public.external_listings (
  id uuid PRIMARY KEY,
  vehicle_id uuid,
  organization_id uuid,
  platform text,
  listing_url text,
  listing_id text,
  listing_status text,
  start_date timestamp with time zone,
  end_date timestamp with time zone,
  current_bid numeric,
  reserve_price numeric,
  buy_now_price numeric,
  bid_count integer,
  view_count integer,
  watcher_count integer,
  final_price numeric,
  sold_at timestamp with time zone,
  commission_rate numeric,
  affiliate_link text,
  sync_enabled boolean,
  last_synced_at timestamp with time zone,
  metadata jsonb,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  listing_url_key text,
  FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id)
);
CREATE TABLE public.vehicle_documents (
  id uuid PRIMARY KEY,
  vehicle_id uuid,
  uploaded_by uuid,
  document_type text,
  title text,
  description text,
  file_url text,
  file_type text,
  amount numeric(10,2),
  vendor_name text,
  currency text,
  privacy_level text,
  linked_to_tag_id uuid,
  source_document_id uuid,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  FOREIGN KEY (uploaded_by) REFERENCES auth.users(id),
  FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id)
);
CREATE TABLE public.auction_comments (
  id uuid PRIMARY KEY,
  auction_event_id uuid,
  vehicle_id uuid,
  comment_type text,
  posted_at timestamp with time zone,
  sequence_number integer,
  hours_until_close numeric,
  author_username text,
  author_type text,
  author_total_likes integer,
  is_seller boolean,
  comment_text text,
  word_count integer,
  has_question boolean,
  has_media boolean,
  media_urls text[],
  mentions text[],
  comment_likes integer,
  reply_count integer,
  is_flagged boolean,
  bid_amount numeric,
  is_leading_bid boolean,
  bid_increment numeric,
  sentiment text,
  sentiment_score numeric,
  toxicity_score numeric,
  expertise_indicators text[],
  authenticity_score numeric,
  expertise_score numeric,
  influence_score numeric,
  key_claims text[],
  raw_html text,
  analyzed_at timestamp with time zone,
  created_at timestamp with time zone,
  platform text,
  source_url text,
  content_hash text,
  author_bat_user_id uuid,
  author_external_identity_id uuid,
  external_identity_id uuid,
  question_categories jsonb,
  question_primary_l1 text,
  question_primary_l2 text,
  question_classified_at timestamp with time zone,
  question_classify_method text,
  bat_author_id integer,
  bat_comment_id integer,
  bat_author_likes integer,
  likers_count integer,
  merged_from_vehicle_id uuid,
  community_stance_score numeric,
  stance_scored_at timestamp with time zone,
  stance_model text,
  condition_polarity numeric,
  extracted_claims jsonb,
  rubric_version smallint,
  source_comment_id text,
  FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id)
);
CREATE TABLE public.vehicle_observations (
  id uuid PRIMARY KEY,
  vehicle_id uuid,
  vehicle_match_confidence numeric(3,2),
  vehicle_match_signals jsonb,
  observed_at timestamp with time zone,
  ingested_at timestamp with time zone,
  source_id uuid,
  source_url text,
  source_identifier text,
  observer_id uuid,
  observer_raw jsonb,
  kind text,
  content_text text,
  content_hash text,
  structured_data jsonb,
  confidence text,
  confidence_score numeric(3,2),
  confidence_factors jsonb,
  is_processed boolean,
  processing_metadata jsonb,
  extractor_id uuid,
  extraction_metadata jsonb,
  is_superseded boolean,
  superseded_by uuid,
  superseded_at timestamp with time zone,
  lineage_chain uuid[],
  original_source_id uuid,
  original_source_url text,
  discovered_via_id uuid,
  data_freshness_at_discovery interval,
  submitted_by_user_id uuid,
  agent_tier text,
  extraction_method text,
  raw_source_ref text,
  agent_model text,
  agent_cost_cents numeric(10,4),
  agent_duration_ms integer,
  extracted_by text,
  merged_from_vehicle_id uuid,
  cluster_id uuid,
  observed_at_confidence numeric(3,2),
  rank text,
  changeset_id uuid,
  applies_to_build_id uuid,
  property_id uuid,
  citation_document_id uuid,
  citation_page_number integer,
  citation_excerpt text,
  subject_type text,
  subject_id uuid,
  anchor_frame_id uuid,
  anchor_x_mm real,
  anchor_y_mm real,
  anchor_z_mm real,
  anchor_extent_mm real,
  condition_rating_0_100 smallint,
  citation_secure_document_id uuid,
  descriptor_id uuid,
  source_comment_id uuid,
  source_snapshot_id uuid,
  source_vehicle_event_id uuid,
  source_observation_id uuid,
  source_vin text,
  source_vin_taxonomy_revision_id bigint,
  citation_publication_id uuid,
  auction_event_id uuid,
  media_start_ms bigint,
  media_end_ms bigint,
  media_relation text,
  media_span_semantics text,
  observed_at_basis text,
  source_event_at timestamp with time zone,
  source_event_date date,
  source_event_time_precision text,
  source_available_at timestamp with time zone,
  subject_organization_id uuid,
  context_bound_at timestamp with time zone,
  analysis_deferred boolean,
  component_subject_id uuid,
  FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id)
);
CREATE TABLE public.organization_vehicles (
  id uuid PRIMARY KEY,
  organization_id uuid,
  vehicle_id uuid,
  relationship_type text,
  status text,
  start_date date,
  end_date date,
  linked_by_user_id uuid,
  auto_tagged boolean,
  gps_match_confidence numeric(4,2),
  receipt_match_count integer,
  notes text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  listing_status text,
  asking_price numeric,
  cost_basis numeric,
  days_on_lot integer,
  featured boolean,
  sale_date date,
  sale_price numeric,
  internal_notes text,
  location_on_lot text,
  quality_flag text,
  quality_notes text,
  flagged_by_user_id uuid,
  flagged_at timestamp with time zone,
  hidden_from_public boolean,
  service_status text,
  auto_matched_confidence real,
  auto_matched_reasons text[],
  auto_matched_at timestamp with time zone,
  user_confirmed boolean,
  user_confirmed_by uuid,
  user_confirmed_at timestamp with time zone,
  user_rejected boolean,
  user_rejected_by uuid,
  user_rejected_at timestamp with time zone,
  override_notes text,
  location_id uuid,
  FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id)
);
CREATE TABLE public.organization_contributors (
  id uuid PRIMARY KEY,
  organization_id uuid,
  user_id uuid,
  role text,
  start_date date,
  end_date date,
  status text,
  contribution_count integer,
  notes text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  agent_id text,
  actor_type text,
  verification_method text,
  verified_by uuid,
  verified_at timestamp with time zone,
  claim_evidence jsonb,
  FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.admin_users (
  id uuid PRIMARY KEY,
  user_id uuid,
  admin_level text,
  permissions text[],
  is_active boolean,
  created_at timestamp without time zone,
  updated_at timestamp without time zone,
  FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.ownership_verifications (
  id uuid PRIMARY KEY,
  user_id uuid,
  vehicle_id uuid,
  status text,
  title_document_url text,
  drivers_license_url text,
  face_scan_url text,
  insurance_document_url text,
  extracted_data jsonb,
  title_owner_name text,
  license_holder_name text,
  vehicle_vin_from_title text,
  ai_confidence_score numeric(3,2),
  ai_processing_results jsonb,
  name_match_score numeric(3,2),
  vin_match_confirmed boolean,
  document_authenticity_score numeric(3,2),
  human_reviewer_id uuid,
  human_review_notes text,
  rejection_reason text,
  requires_supervisor_review boolean,
  submitted_at timestamp without time zone,
  ai_processed_at timestamp without time zone,
  human_reviewed_at timestamp without time zone,
  approved_at timestamp without time zone,
  rejected_at timestamp without time zone,
  expires_at timestamp without time zone,
  created_at timestamp without time zone,
  updated_at timestamp without time zone,
  verification_type character varying(255),
  inserted_at timestamp(0) without time zone,
  supporting_documents jsonb,
  verification_category text,
  claim_source text,
  sms_submission_id uuid,
  FOREIGN KEY (user_id) REFERENCES auth.users(id),
  FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id)
);
CREATE TABLE public.vehicle_user_permissions (
  id uuid PRIMARY KEY,
  vehicle_id uuid,
  user_id uuid,
  role text,
  is_active boolean,
  created_at timestamp with time zone,
  granted_by uuid,
  permissions text[],
  context text,
  granted_at timestamp with time zone,
  expires_at timestamp with time zone,
  revoked_at timestamp with time zone,
  revoked_by uuid,
  FOREIGN KEY (user_id) REFERENCES auth.users(id),
  FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id)
);
CREATE TABLE public.vehicle_contributors (
  id uuid PRIMARY KEY,
  vehicle_id uuid,
  user_id uuid,
  role text,
  start_date date,
  end_date date,
  notes text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  status text,
  can_edit boolean,
  can_delete boolean,
  can_approve boolean,
  can_sell boolean,
  organization_id uuid,
  FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id)
);
GRANT SELECT (id, uploaded_by, make, model, year, vin, color, mileage, fuel_type, transmission, engine_size, horsepower, torque, drivetrain, body_style, doors, seats, weight_lbs, length_inches, width_inches, height_inches, wheelbase_inches, fuel_capacity_gallons, mpg_city, mpg_highway, mpg_combined, msrp, current_value, previous_owners, is_modified, modification_details, condition_rating, maintenance_notes, insurance_company, insurance_policy_number, registration_state, registration_expiry, inspection_expiry, is_public, notes, created_at, updated_at, sale_price, auction_end_date, bid_count, view_count, auction_source, ownership_verified, ownership_verified_at, ownership_verification_id, bat_auction_url, bat_sold_price, bat_sale_date, bat_bid_count, bat_view_count, is_daily_driver, is_weekend_car, is_track_car, is_show_car, is_project_car, is_garage_kept, discovered_by, discovery_source, discovery_url, bat_listing_title, bat_bids, bat_comments, bat_views, bat_location, bat_seller, sale_status, sale_date, status, completion_percentage, displacement, interior_color, is_for_sale, is_draft, deleted_at, entry_type, verification_status, confidence_score, source, import_source, import_metadata, uploaded_at, asking_price, owner_shop_id, user_id, acting_on_behalf_of, ownership_percentage, relationship_notes, description, value_score, value_breakdown, owner_id, quality_grade, investment_grade, investment_confidence, quality_last_assessed, trim, color_primary, color_secondary, paint_code, paint_code_secondary, zip_code, city, state, country, gps_latitude, gps_longitude, imported_by, title_transfer_date, primary_image_url, title, data_quality_score, quality_issues, requires_improvement, last_quality_check, vin_source, year_source, make_source, model_source, mileage_source, engine_source, transmission_source, color_source, vin_confidence, year_confidence, make_confidence, model_confidence, created_by_user_id, created_via_role, import_method, automation_script, content_source_type, content_source_id, platform_source, platform_url, provenance_metadata, bat_buyer, profile_origin, origin_organization_id, origin_metadata, series, series_source, series_confidence, trim_source, trim_confidence, description_source, description_generated_at, model_series, cab_config, trim_level, engine_displacement, engine_liters, engine_type, engine_code, transmission_model, transmission_type, transmission_code, merged_into_vehicle_id, secondary_color, has_molding, has_pinstriping, has_body_kit, has_racing_stripes, trim_details, interior_color_secondary, interior_color_tertiary, seat_type, seat_material_primary, seat_material_secondary, interior_material_details, received_in_trade, import_queue_id, selling_organization_id, price, sold_price, normalized_model, normalized_series, generation, auction_outcome, high_bid, winning_bid, vin_source_image_id, location, is_streaming, image_url, search_vector, listing_url, listing_source, listing_posted_at, listing_updated_at, listing_title, listing_location, analysis_tier, signal_score, signal_reasons, last_signal_assessed_at, listing_location_raw, listing_location_observed_at, listing_location_source, listing_location_confidence, bat_lot_number, bat_watchers, reserve_status, canonical_vehicle_type, canonical_body_style, listing_kind, segment_id, era, canonical_make_id, source_listing_category, dougs_take, highlights, equipment, modifications, known_flaws, recent_service_history, title_status, seller_name, comment_count, auction_status, extractor_version, rennlist_url, rennlist_listing_id, documents_on_hand, price_is_outlier, price_outlier_reason, data_gaps, nuke_estimate, nuke_estimate_confidence, deal_score, heat_score, valuation_calculated_at, zero_to_sixty, quarter_mile, quarter_mile_speed, top_speed_mph, braking_60_0_ft, lateral_g, redline_rpm, power_to_weight, suspension_front, suspension_rear, brake_type_front, brake_type_rear, wheel_diameter_front, wheel_diameter_rear, tire_spec_front, tire_spec_rear, tire_condition_score, brake_condition_score, suspension_condition_score, perf_power_score, perf_acceleration_score, perf_braking_score, perf_handling_score, perf_comfort_score, social_positioning_score, investment_quality_score, provenance_score, overall_desirability_score, perf_scores_updated_at, social_positioning_breakdown, compression_ratio, compression_test_psi, leakdown_test_pct, engine_health_score, timing_type, cam_type, intake_type, carburetor_type, fuel_pressure_psi, fuel_octane, distributor_type, headers_type, exhaust_type, exhaust_diameter, manifold_type, oil_type, coolant_type, bore_mm, stroke_mm, rear_axle_ratio, rear_axle_type, transfer_case, clutch_type, driveshaft_type, transmission_speeds, steering_type, steering_pump, steering_condition_score, frame_type, brake_booster_type, brake_master_cylinder, front_rotor_size, rear_rotor_size, abs_equipped, drag_coefficient, frontal_area_sqft, ground_clearance_inches, ride_height_inches, has_spoiler, has_air_dam, lift_inches, last_fuel_receipt, fuel_system_type, last_inspection_date, inspection_type, inspection_passed, smog_exempt, segment_slug, last_enrichment_attempt, enrichment_failures, msrp_source, msrp_contributed_by, color_family, data_quality_flags, current_transfer_id, ownership_confirmed_at, vehicle_category, display_tier, price_confidence, cz_estimated_value, image_count, observation_count, visual_signature, discovery_priority, canonical_platform, canonical_sold_price, canonical_outcome, realization_plan, has_photos, existence_tier, is_replica, sale_price_usd) ON public.vehicles TO anon;
GRANT SELECT (id, uploaded_by, make, model, year, vin, license_plate, color, mileage, fuel_type, transmission, engine_size, horsepower, torque, drivetrain, body_style, doors, seats, weight_lbs, length_inches, width_inches, height_inches, wheelbase_inches, fuel_capacity_gallons, mpg_city, mpg_highway, mpg_combined, msrp, current_value, previous_owners, is_modified, modification_details, condition_rating, maintenance_notes, insurance_company, insurance_policy_number, registration_state, registration_expiry, inspection_expiry, is_public, notes, created_at, updated_at, sale_price, auction_end_date, bid_count, view_count, auction_source, ownership_verified, ownership_verified_at, ownership_verification_id, bat_auction_url, bat_sold_price, bat_sale_date, bat_bid_count, bat_view_count, is_daily_driver, is_weekend_car, is_track_car, is_show_car, is_project_car, is_garage_kept, discovered_by, discovery_source, discovery_url, bat_listing_title, bat_bids, bat_comments, bat_views, bat_location, bat_seller, sale_status, sale_date, status, completion_percentage, displacement, interior_color, is_for_sale, is_draft, deleted_at, entry_type, verification_status, confidence_score, source, import_source, import_metadata, uploaded_at, asking_price, owner_shop_id, user_id, acting_on_behalf_of, ownership_percentage, relationship_notes, description, value_score, value_breakdown, owner_id, quality_grade, investment_grade, investment_confidence, quality_last_assessed, trim, color_primary, color_secondary, paint_code, paint_code_secondary, zip_code, city, state, country, gps_latitude, gps_longitude, imported_by, title_transfer_date, primary_image_url, title, data_quality_score, quality_issues, requires_improvement, last_quality_check, vin_source, year_source, make_source, model_source, mileage_source, engine_source, transmission_source, color_source, vin_confidence, year_confidence, make_confidence, model_confidence, created_by_user_id, created_via_role, import_method, automation_script, content_source_type, content_source_id, platform_source, platform_url, provenance_metadata, bat_buyer, profile_origin, origin_organization_id, origin_metadata, series, series_source, series_confidence, trim_source, trim_confidence, description_source, description_generated_at, model_series, cab_config, trim_level, engine_displacement, engine_liters, engine_type, engine_code, transmission_model, transmission_type, transmission_code, merged_into_vehicle_id, secondary_color, has_molding, has_pinstriping, has_body_kit, has_racing_stripes, trim_details, interior_color_secondary, interior_color_tertiary, seat_type, seat_material_primary, seat_material_secondary, interior_material_details, received_in_trade, import_queue_id, selling_organization_id, price, sold_price, normalized_model, normalized_series, generation, auction_outcome, high_bid, winning_bid, vin_source_image_id, location, is_streaming, image_url, search_vector, listing_url, listing_source, listing_posted_at, listing_updated_at, listing_title, listing_location, analysis_tier, signal_score, signal_reasons, last_signal_assessed_at, listing_location_raw, listing_location_observed_at, listing_location_source, listing_location_confidence, bat_lot_number, bat_watchers, reserve_status, canonical_vehicle_type, canonical_body_style, listing_kind, segment_id, era, canonical_make_id, source_listing_category, dougs_take, highlights, equipment, modifications, known_flaws, recent_service_history, title_status, seller_name, comment_count, auction_status, extractor_version, rennlist_url, rennlist_listing_id, documents_on_hand, price_is_outlier, price_outlier_reason, data_gaps, nuke_estimate, nuke_estimate_confidence, deal_score, heat_score, valuation_calculated_at, zero_to_sixty, quarter_mile, quarter_mile_speed, top_speed_mph, braking_60_0_ft, lateral_g, redline_rpm, power_to_weight, suspension_front, suspension_rear, brake_type_front, brake_type_rear, wheel_diameter_front, wheel_diameter_rear, tire_spec_front, tire_spec_rear, tire_condition_score, brake_condition_score, suspension_condition_score, perf_power_score, perf_acceleration_score, perf_braking_score, perf_handling_score, perf_comfort_score, social_positioning_score, investment_quality_score, provenance_score, overall_desirability_score, perf_scores_updated_at, social_positioning_breakdown, compression_ratio, compression_test_psi, leakdown_test_pct, engine_health_score, timing_type, cam_type, intake_type, carburetor_type, fuel_pressure_psi, fuel_octane, distributor_type, headers_type, exhaust_type, exhaust_diameter, manifold_type, oil_type, coolant_type, bore_mm, stroke_mm, rear_axle_ratio, rear_axle_type, transfer_case, clutch_type, driveshaft_type, transmission_speeds, steering_type, steering_pump, steering_condition_score, frame_type, brake_booster_type, brake_master_cylinder, front_rotor_size, rear_rotor_size, abs_equipped, drag_coefficient, frontal_area_sqft, ground_clearance_inches, ride_height_inches, has_spoiler, has_air_dam, lift_inches, last_fuel_receipt, fuel_system_type, last_inspection_date, inspection_type, inspection_passed, smog_exempt, segment_slug, last_enrichment_attempt, enrichment_failures, msrp_source, msrp_contributed_by, color_family, data_quality_flags, current_transfer_id, ownership_confirmed_at, vehicle_category, display_tier, price_confidence, cz_estimated_value, image_count, observation_count, visual_signature, discovery_priority, canonical_platform, canonical_sold_price, canonical_outcome, realization_plan, has_photos, existence_tier, is_replica, sale_price_usd) ON public.vehicles TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
CREATE FUNCTION public.vehicle_image_gallery_eligible(public.vehicle_images) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE OR REPLACE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- vehicle_viewer_tie_plpgsql_v1: the reviewed SQL body, unchanged.
  RETURN (
  SELECT p_user_id IS NOT NULL AND p_vehicle_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.vehicles v
      WHERE v.id = p_vehicle_id AND p_user_id IN (v.user_id, v.owner_id, v.uploaded_by))
    OR EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = p_user_id AND au.is_active)
    OR EXISTS (SELECT 1 FROM public.ownership_verifications ov
      WHERE ov.vehicle_id = p_vehicle_id AND ov.user_id = p_user_id AND ov.status = 'approved')
    OR EXISTS (SELECT 1 FROM public.vehicle_user_permissions vup JOIN public.vehicles v ON v.id = vup.vehicle_id
      WHERE vup.vehicle_id = p_vehicle_id AND vup.user_id = p_user_id AND coalesce(vup.is_active, true)
        AND vup.role = ANY (ARRAY['owner', 'co_owner', 'mechanic', 'appraiser', 'moderator', 'contributor', 'photographer',
          'dealer_rep', 'sales_agent', 'restorer', 'consigner', 'board_member'])
        AND vup.granted_by <> vup.user_id AND vup.granted_by IN (v.user_id, v.owner_id, v.uploaded_by))
    OR EXISTS (SELECT 1 FROM public.vehicle_contributors vc
      WHERE vc.vehicle_id = p_vehicle_id AND vc.user_id = p_user_id AND coalesce(vc.status, 'active') = 'active'
        AND vc.role = ANY (ARRAY['owner', 'co_owner', 'restorer', 'moderator', 'consigner', 'mechanic', 'appraiser',
          'photographer', 'sales_agent']))
    OR EXISTS (SELECT 1 FROM public.organization_vehicles ov JOIN public.vehicles v ON v.id = ov.vehicle_id
      JOIN public.organization_contributors oc ON oc.organization_id = ov.organization_id
      WHERE ov.vehicle_id = p_vehicle_id AND ov.relationship_type IN ('owner', 'consigner') AND ov.status = 'active'
        AND (ov.linked_by_user_id IS NULL OR ov.linked_by_user_id IN (v.user_id, v.owner_id))
        AND oc.user_id = p_user_id AND oc.status = 'active'
        AND oc.role IN ('owner', 'co_founder', 'board_member', 'manager', 'employee')))
);
END
$function$;

CREATE OR REPLACE FUNCTION public.jsonb_mask_keys(j jsonb, p_keys text[])
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT CASE jsonb_typeof(j)
    WHEN 'object' THEN coalesce((
      SELECT jsonb_object_agg(e.k, CASE WHEN e.k = ANY (p_keys) THEN 'null'::jsonb ELSE public.jsonb_mask_keys(e.v, p_keys) END)
      FROM jsonb_each(j) AS e(k, v)), '{}'::jsonb)
    WHEN 'array' THEN coalesce((
      SELECT jsonb_agg(public.jsonb_mask_keys(a.e, p_keys) ORDER BY a.o)
      FROM jsonb_array_elements(j) WITH ORDINALITY AS a(e, o)), '[]'::jsonb)
    ELSE j END;
$function$;

CREATE OR REPLACE FUNCTION public.text_redact_contact(p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT regexp_replace(regexp_replace(p_text,
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}', '[contact through Nuke]', 'g'),
    '(\(\d{3}\)|\m\d{3})[-. )]*\d{3}[-. ]*\d{4}(?![0-9])', '[contact through Nuke]', 'g')
$function$;

CREATE OR REPLACE FUNCTION public.vehicle_row_public_projection(p_row jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN jsonb_typeof(m.j -> 'description') = 'string'
              THEN jsonb_set(m.j, '{description}', to_jsonb(public.text_redact_contact(m.j ->> 'description')))
              ELSE m.j END
  FROM (SELECT CASE WHEN jsonb_typeof(r.j -> 'origin_metadata') IN ('object', 'array')
                    THEN jsonb_set(r.j, '{origin_metadata}', regexp_replace((r.j -> 'origin_metadata')::text,
                           '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}', '[contact through Nuke]', 'g')::jsonb)
                    ELSE r.j END AS j
        FROM (SELECT public.jsonb_mask_keys(p_row, ARRAY['purchase_price', 'purchase_date', 'purchase_location', 'owner_name', 'owner_contact']) AS j) r) m
$function$;


CREATE OR REPLACE FUNCTION public.get_vehicle_profile_data(p_vehicle_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result json;
  v_uid uuid := auth.uid();
  v_service boolean := COALESCE(auth.jwt() ->> 'role', '') = 'service_role';
  v_public boolean;
  v_insider boolean;     -- same test as vehicles_private_select
  v_org_member boolean;  -- same test as "Organization members can view org vehicle images"
BEGIN
  -- COALESCE: a NULL owner_id/uploaded_by makes the comparison NULL, and NOT (false OR NULL)
  -- is NULL, which IF treats as false -- that let a signed-in stranger open a private vehicle
  -- in the local test.
  SELECT COALESCE(v.is_public, false),
         COALESCE(v_service OR (v_uid IS NOT NULL AND (
           v_uid = v.user_id
           OR v_uid = v.owner_id
           OR v_uid = v.uploaded_by
           OR public.vehicle_user_has_access(v.id, v_uid))), false)
    INTO v_public, v_insider
  FROM public.vehicles v
  WHERE v.id = p_vehicle_id;

  IF NOT FOUND OR NOT (v_public OR v_insider) THEN
    RETURN NULL;
  END IF;

  v_org_member := v_uid IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.organization_vehicles ov
    JOIN public.organization_contributors oc ON oc.organization_id = ov.organization_id
    WHERE ov.vehicle_id = p_vehicle_id
      AND oc.user_id = v_uid
      AND oc.status = 'active'
  );

  SELECT json_build_object(
    -- The owner's purchase facts reach insiders only (owner rule 2026-09-28): everyone else reads the
    -- row with purchase_price, purchase_date and purchase_location set to null, and money_masked = true.
    'vehicle', (
      SELECT CASE WHEN v_insider THEN row_to_json(v.*)
                  ELSE public.vehicle_row_public_projection(to_jsonb(v.*))::json END
      FROM public.vehicles v
      WHERE v.id = p_vehicle_id
    ),
    'money_masked', NOT v_insider,
    'images', (
      SELECT COALESCE(
        json_agg(
          json_build_object(
            'id', vi.id,
            'vehicle_id', vi.vehicle_id,
            'image_url', vi.image_url,
            'thumbnail_url', vi.thumbnail_url,
            'medium_url', vi.medium_url,
            'large_url', vi.large_url,
            'variants', vi.variants,
            'is_primary', vi.is_primary,
            'is_document', vi.is_document,
            'position', vi.position,
            'created_at', vi.created_at,
            'storage_path', vi.storage_path,
            'caption', vi.caption,
            'image_type', vi.image_type,
            'category', vi.category,
            'file_name', vi.file_name,
            'source', vi.source,
            'has_analysis', (vi.ai_scan_metadata ? 'byok_deep_analysis'),
            'analysis', (
              CASE WHEN vi.ai_scan_metadata ? 'byok_deep_analysis' THEN
                json_build_object(
                  'scene_type',   vi.ai_scan_metadata->'byok_deep_analysis'->>'scene_type',
                  'build_phase',  vi.ai_scan_metadata->'byok_deep_analysis'->>'build_phase_guess',
                  'intent',       vi.ai_scan_metadata->'byok_deep_analysis'->>'intent',
                  'narrative',    vi.ai_scan_metadata->'byok_deep_analysis'->>'narrative_one_line',
                  'confidence',   vi.ai_scan_metadata->'byok_deep_analysis'->>'confidence',
                  'component_count', jsonb_array_length(COALESCE(vi.ai_scan_metadata->'byok_deep_analysis'->'components_seen', '[]'::jsonb))
                )
              ELSE NULL END
            )
          )
        ),
        '[]'::json
      )
      FROM (
        SELECT id, vehicle_id, image_url, thumbnail_url, medium_url, large_url,
               variants, is_primary, is_document, position, created_at,
               storage_path, caption, image_type, category, file_name, source,
               ai_scan_metadata
        FROM public.vehicle_images
        WHERE vehicle_id = p_vehicle_id
          AND public.vehicle_image_gallery_eligible(vehicle_images)
          AND COALESCE(is_document, false) = false
          AND COALESCE(is_duplicate, false) = false
          AND image_url IS NOT NULL
          AND (source IS NULL OR source <> 'e2e_test')
          AND (image_url NOT LIKE 'file://%')
          AND COALESCE(is_superseded, false) = false
          AND (v_insider OR v_org_member
               OR COALESCE(is_sensitive, false) = false
               OR user_id = v_uid)
        ORDER BY
          COALESCE(is_primary, false) DESC,
          position ASC NULLS LAST,
          created_at ASC,
          id ASC
        LIMIT 50
      ) vi
    ),
    'timeline_events', (
      SELECT COALESCE(json_agg(te.* ORDER BY te.event_date DESC), '[]'::json)
      FROM (
        -- Every column the page reads. Left out: search_vector (a tsvector the browser cannot use,
        -- 32 KB of the K5's 100 rows), photo_analysis, verification_documents and
        -- location_coordinates (read nowhere in the frontend). Fewer TOAST reads cold, less JSON warm.
        SELECT id, vehicle_id, user_id, event_type, source, title, description, event_date, image_urls,
               metadata, created_at, updated_at, mileage_at_event, cost_amount, cost_currency,
               duration_hours, location_name, location_address, service_provider_name,
               service_provider_type, invoice_number, warranty_info, parts_used, is_insurance_claim,
               insurance_claim_number, next_service_due_date, next_service_due_mileage, data_source,
               confidence_score, source_type, event_category, activity_type, automated_tags, manual_tags,
               receipt_data, parts_mentioned, tools_mentioned, labor_hours, cost_estimate, organization_id,
               client_id, is_monetized, work_started, work_completed, contract_id, applied_labor_rate,
               applied_shop_rate, rate_source, contextual_analysis_status, documented_by,
               primary_technician, quality_rating, quality_justification, value_impact, ai_confidence_score,
               concerns, industry_standard_comparison, work_order_id
        FROM public.timeline_events
        WHERE vehicle_id = p_vehicle_id
        ORDER BY event_date DESC
        LIMIT 100
      ) te
    ),
    'work_sessions', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'id', ws.id,
          'session_date', ws.session_date,
          'title', ws.title,
          'work_type', ws.work_type,
          'image_count', ws.image_count,
          'duration_minutes', ws.duration_minutes,
          'total_parts_cost', ws.total_parts_cost,
          'total_labor_cost', ws.total_labor_cost,
          'total_job_cost', ws.total_job_cost,
          'work_description', ws.work_description,
          'status', ws.status
        )
        ORDER BY ws.session_date DESC
      ), '[]'::json)
      FROM public.work_sessions ws
      WHERE ws.vehicle_id = p_vehicle_id
        AND (v_insider OR ws.user_id = v_uid)
    ),
    'comments', (
      SELECT COALESCE(json_agg(vc.* ORDER BY vc.created_at DESC), '[]'::json)
      FROM (
        SELECT * FROM public.vehicle_comments
        WHERE vehicle_id = p_vehicle_id
        ORDER BY created_at DESC
        LIMIT 50
      ) vc
    ),
    'latest_valuation', (
      SELECT row_to_json(vv.*)
      FROM public.vehicle_valuations vv
      WHERE vv.vehicle_id = p_vehicle_id
      ORDER BY vv.valuation_date DESC
      LIMIT 1
    ),
    'external_listings', (
      SELECT COALESCE(json_agg(el.* ORDER BY el.created_at DESC), '[]'::json)
      FROM public.external_listings el
      WHERE el.vehicle_id = p_vehicle_id
    ),
    'stats', json_build_object(
      'image_count', (
        SELECT COUNT(*) FROM public.vehicle_images WHERE vehicle_id = p_vehicle_id AND COALESCE(is_superseded, false) = false
      ),
      'event_count', (SELECT COUNT(*) FROM public.timeline_events WHERE vehicle_id = p_vehicle_id),
      'comment_count', (
        (SELECT COUNT(*) FROM public.vehicle_comments WHERE vehicle_id = p_vehicle_id) +
        (SELECT COUNT(*) FROM public.auction_comments WHERE vehicle_id = p_vehicle_id
      AND (auction_comments.auction_event_id IS NULL OR EXISTS (SELECT 1 FROM public.auction_events_canonical canonical_event WHERE canonical_event.id = auction_comments.auction_event_id OFFSET 0)))
      ),
      'observation_count', (SELECT COUNT(*) FROM public.vehicle_observations WHERE vehicle_id = p_vehicle_id),
      'document_count', (
        SELECT COUNT(*) FROM public.vehicle_documents d
        WHERE d.vehicle_id = p_vehicle_id
          AND (v_insider OR d.uploaded_by = v_uid OR d.privacy_level = 'public')
      ),
      'last_activity', (SELECT MAX(created_at) FROM public.timeline_events WHERE vehicle_id = p_vehicle_id),
      'total_documented_costs', (
        SELECT COALESCE(SUM(d.amount), 0)
        FROM public.vehicle_documents d
        WHERE d.vehicle_id = p_vehicle_id
          AND d.document_type IN ('receipt', 'invoice')
          AND (v_insider OR d.uploaded_by = v_uid OR d.privacy_level = 'public')
      )
    )
  ) INTO result;

  RETURN result;
EXCEPTION
  WHEN others THEN
    RAISE WARNING 'get_vehicle_profile_data failed for vehicle %: %', p_vehicle_id, SQLERRM;
    RETURN NULL;
END;
$function$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
