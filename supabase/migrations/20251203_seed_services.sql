-- SEED AVAILABLE SERVICES
-- Initial catalog of integrations

INSERT INTO service_integrations (
  service_key, service_name, provider, category, integration_type, 
  trigger_mode, trigger_conditions, required_fields, is_free, 
  price_usd, avg_turnaround_hours, fields_populated, document_types, description
) VALUES

-- ============================================================================
-- FREE AUTO SERVICES
-- ============================================================================

('nhtsa_vin_decode', 'NHTSA VIN Decoder', 'NHTSA (US Government)', 'documentation', 'api', 
  'auto', 
  '{"has_vin": true, "year_gte": 1981}'::jsonb, 
  ARRAY['vin'], 
  true, 
  NULL, 
  0.1, 
  ARRAY['make', 'model', 'year', 'body_style', 'engine_type', 'manufacturer', 'plant_city', 'plant_state', 'trim', 'series'],
  ARRAY['decode_report'],
  'Free government VIN decoder for vehicles 1981+. Provides factory specs and build information.'),

('spid_auto_extract', 'SPID Sheet Analysis', 'N-Zero (Internal)', 'documentation', 'api', 
  'auto',
  '{"has_images": true, "make_in": ["Chevrolet", "GMC"]}'::jsonb,
  ARRAY['vehicle_id'],
  true, 
  NULL,
  0.5,
  ARRAY['vin', 'paint_code_exterior', 'paint_code_interior', 'rpo_codes', 'build_date', 'engine_code', 'transmission_code', 'axle_ratio'],
  ARRAY['spid_extraction'],
  'Automatic SPID sheet detection and extraction from uploaded images. Provides factory build data for GM vehicles.'),

('hagerty_instant_quote', 'Hagerty Valuation', 'Hagerty', 'appraisal', 'api', 
  'auto',
  '{"year_lte": 1995, "has_vin": true}'::jsonb,
  ARRAY['vin', 'year', 'make', 'model', 'mileage'],
  true, 
  NULL,
  0.1,
  ARRAY['market_value_low', 'market_value_avg', 'market_value_high', 'insurance_value'],
  ARRAY['valuation_report'],
  'Free instant classic car valuation for vehicles 1995 and older.'),

-- ============================================================================
-- PAID AUTO SERVICES (require payment before execution)
-- ============================================================================

('gm_heritage', 'GM Heritage Certificate', 'General Motors', 'documentation', 'web_form', 
  'manual',  -- Manual because it costs money
  '{"make_in": ["Chevrolet", "GMC", "Pontiac", "Buick", "Oldsmobile", "Cadillac"], "year_gte": 1930}'::jsonb,
  ARRAY['vin'],
  false,
  50.00,
  168,  -- ~1 week turnaround
  ARRAY['build_date', 'factory_options', 'original_dealer', 'production_sequence', 'color_code', 'interior_code', 'body_style', 'plant_location'],
  ARRAY['heritage_certificate', 'build_sheet'],
  'Official GM factory build documentation. Includes complete RPO codes, original dealer, and build date. $50 + processing time ~1 week.'),

-- ============================================================================
-- PAID HISTORY SERVICES
-- ============================================================================

('carfax_report', 'Carfax Vehicle History', 'Carfax', 'history', 'api', 
  'manual',
  '{"has_vin": true}'::jsonb,
  ARRAY['vin'],
  false,
  39.99,
  0.1,
  ARRAY['accident_history', 'ownership_count', 'service_records', 'title_status', 'odometer_readings'],
  ARRAY['carfax_report'],
  'Comprehensive vehicle history report. Includes accidents, ownership, service records, and title history.'),

('nmvtis_check', 'NMVTIS Title Check', 'NMVTIS (US Government)', 'history', 'api', 
  'manual',
  '{"has_vin": true}'::jsonb,
  ARRAY['vin'],
  false,
  9.99,
  0.1,
  ARRAY['title_brand', 'theft_check', 'odometer_history', 'total_loss_history'],
  ARRAY['nmvtis_report'],
  'Federal title database search. Checks for theft, total loss, and title brands.'),

-- ============================================================================
-- APPRAISAL SERVICES
-- ============================================================================

('appraisal_network_booking', 'Professional Appraisal', 'N-Zero Appraisal Network', 'appraisal', 'manual', 
  'manual',
  '{}'::jsonb,
  ARRAY['year', 'make', 'model', 'location'],
  false,
  199.00,
  72,
  ARRAY['appraised_value', 'condition_rating', 'authenticity_score', 'market_comparables'],
  ARRAY['appraisal_certificate', 'photo_documentation', 'appraisal_report'],
  'In-person professional appraisal by certified experts. Includes condition assessment, authenticity verification, and market analysis. $149-$299 depending on location.'),

-- ============================================================================
-- MARKETPLACE INTEGRATIONS
-- ============================================================================

('bat_submission', 'Bring a Trailer Submission', 'Bring a Trailer', 'marketplace', 'email', 
  'manual',
  '{}'::jsonb,
  ARRAY['year', 'make', 'model', 'vin', 'photos'],
  false,
  NULL,  -- No direct fee (BAT takes commission)
  168,
  ARRAY['listing_url', 'auction_start_date', 'reserve_price'],
  ARRAY['bat_listing'],
  'Submit vehicle for consideration on Bring a Trailer auction platform. Requires detailed photos and documentation.'),

('cars_bids_submission', 'Cars & Bids Listing', 'Cars & Bids', 'marketplace', 'api', 
  'manual',
  '{"year_gte": 1980}'::jsonb,
  ARRAY['year', 'make', 'model', 'mileage', 'photos'],
  false,
  NULL,  -- No direct fee (C&B takes commission)
  72,
  ARRAY['listing_url', 'reserve_price', 'listing_end_date'],
  ARRAY['cars_bids_listing'],
  'List vehicle on Cars & Bids auction platform for enthusiast cars 1980+.')

ON CONFLICT (service_key) DO UPDATE SET
  service_name = EXCLUDED.service_name,
  provider = EXCLUDED.provider,
  description = EXCLUDED.description,
  updated_at = NOW();

SELECT 'Seeded ' || COUNT(*) || ' services' as status FROM service_integrations;

