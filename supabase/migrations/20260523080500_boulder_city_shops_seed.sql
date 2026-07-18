-- 20260523080500_boulder_city_shops_seed.sql
--
-- Seeds the `organizations` table with the 18 confirmed/probable Boulder City NV
-- automotive operators identified by the parallel research agent on 2026-05-23.
--
-- Source: /tmp/boulder_city_shops_enrichment_2026-05-23.md (315 lines, every claim cited)
-- Confidence grades per row inline. Skylar's $160/hr Viva rate is the only publicly-known
-- labor rate; all others have NULL labor_rate (industry standard — rates quoted per-job).
--
-- This migration grows `n_comparables` for compute_inferred_value() from 3 (current)
-- to ~5 (with rates) and ~18 (counted as comparables even when rate is null but
-- specializations + capabilities are known). Confidence rating in the RPC will jump
-- from "low_n_under_3" to "moderate_n_under_10" or "high_n_at_least_10".
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING. Re-running is safe.

-- Skylar's physical shop (at 707 Yucca St, co-located with Viva)
-- His Nuke platform is already in organizations as a separate row.
INSERT INTO public.organizations (
  name, business_name, slug, address, city, state, zip_code,
  business_type, org_type, primary_focus,
  has_lift, has_fabrication, has_paint_booth,
  specializations, specialty_makes, specialty_eras,
  service_description,
  source, source_url, enrichment_status, verification_level,
  metadata
) VALUES (
  'Skylar Williams Shop',
  'Skylar Williams Shop',
  'skylar-williams-shop-boulder-city',
  '707 Yucca St',
  'Boulder City',
  'NV',
  '89005',
  'restoration_shop',
  'shop',
  'classic_car_restoration',
  TRUE, TRUE, NULL,  -- lift confirmed by photos; fabrication confirmed; paint booth unknown
  '["classic_restoration","wiring_harness_fab","engine_swap","exhaust_install","sound_deadening"]'::jsonb,
  '["Ford","Chevrolet","GMC","Pontiac","Dodge","Lexus","Porsche"]'::jsonb,
  '["1960s","1970s","1980s","1990s"]'::jsonb,
  'Large property at 707 Yucca St, currently underutilized — one Mustang at a time per Skylar self-testimony 2026-05-23. Co-located with Viva! Las Vegas Autos. Has yellow lift, fabrication equipment, fluorescent shop lighting visible in many photos.',
  'skylar_self_testimony',
  NULL,
  'self_reported',
  'owner_self_reported',
  jsonb_build_object(
    'testimony_observation_ids', jsonb_build_array('ad288a80','3439f1e2','243a2d10'),
    'capture_date', '2026-05-23',
    'data_quality', 'A_owner_self_reported',
    'cascade_seed', TRUE
  )
) ON CONFLICT (slug) DO NOTHING;

-- ─── SECTION 1: Skylar-named shops that web research confirmed ────────────

-- Viva! Las Vegas Autos already exists per earlier query (c433d27e, $160/hr).
-- Add metadata note linking to the research report.
UPDATE public.organizations
   SET metadata = COALESCE(metadata, '{}'::jsonb) ||
                  jsonb_build_object(
                    'corroborated_by', '/tmp/boulder_city_shops_enrichment_2026-05-23.md sec 1.1',
                    'data_quality', 'A_two_plus_sources',
                    'address_collision_with', 'skylar_williams_shop',
                    'note', 'Co-located at 707 Yucca with Skylar Williams operation'
                  )
 WHERE id = 'c433d27e-0000-0000-0000-000000000000'::uuid
    OR (name ILIKE 'Viva!%' AND city ILIKE 'Boulder%');

-- BK Kustoms (Skylar called "BK Customs")
INSERT INTO public.organizations (name, business_name, slug, address, city, state, zip_code, business_type, org_type, hours_of_operation, years_in_business, source, source_url, verification_level, specializations, services_offered, metadata)
VALUES (
  'BK Kustoms',
  'BK Kustoms, LLC',
  'bk-kustoms-boulder-city',
  '738 Canyon Rd',
  'Boulder City', 'NV', '89005',
  'restoration_shop', 'shop',
  '{"mon-fri":"7:30am-5:30pm","sat":"8am-12pm","sun":"closed"}'::jsonb,
  38,
  'web_research_agent_2026-05-23',
  'https://bk-kustoms.wheree.com/',
  'bbb_accredited',
  '["vintage_restoration","custom_mechanical","lift_kits","lowering","engine_repair"]'::jsonb,
  '["engine_repair","inspections","oil_changes","lift_kits","lowering","vintage_restoration","custom_mechanical_projects","walk_ins_welcome"]'::jsonb,
  jsonb_build_object(
    'owner', 'Robert "Bob" Wrightnour',
    'former_show', 'Counts Kustoms reality-show mechanic',
    'bbb_accredited_since', '2020-12-03',
    'data_quality', 'A_two_plus_sources',
    'skylar_testimony', 'overloaded one-man shop',
    'sources', jsonb_build_array(
      'https://www.bbb.org/us/nv/boulder-city/profile/auto-repair/b-k-kustoms-llc-1086-90074994',
      'https://www.bodyshopleads.com/shops/nevada/boulder-city/bk-kustoms-boulder-city-nv'
    )
  )
) ON CONFLICT (slug) DO NOTHING;

-- Meineke #2968
INSERT INTO public.organizations (name, slug, address, city, state, zip_code, phone, business_type, org_type, hours_of_operation, source, source_url, verification_level, services_offered, metadata)
VALUES (
  'Meineke Car Care #2968',
  'meineke-2968-boulder-city',
  '1400 Boulder City Pkwy',
  'Boulder City', 'NV', '89005',
  '(702) 948-7711',
  'franchise_auto_repair', 'shop',
  '{"mon-sat":"7:30am-6pm","sun":"closed"}'::jsonb,
  'web_research_agent_2026-05-23',
  'https://www.meineke.com/locations/nv/boulder-city-2968/',
  'verified_franchise',
  '["oil_changes","exhaust","brakes","tires","ac","tune_ups","steering_suspension","diagnostics","transmission","battery","state_inspections","smog"]'::jsonb,
  jsonb_build_object(
    'address_collision_with', 'georges-tire-boulder-city',
    'collision_note', 'Same street address 1400 Boulder City Pkwy as Georges Tire — needs human verification of suite or recent tenant change',
    'data_quality', 'A',
    'franchise_chain', 'Meineke'
  )
) ON CONFLICT (slug) DO NOTHING;

-- Firestone Complete Auto Care
INSERT INTO public.organizations (name, slug, address, city, state, zip_code, phone, business_type, org_type, hours_of_operation, source, source_url, verification_level, services_offered, metadata)
VALUES (
  'Firestone Complete Auto Care',
  'firestone-complete-boulder-city',
  '1323 Boulder City Pkwy',
  'Boulder City', 'NV', '89005',
  '(702) 608-9541',
  'national_chain_auto_repair', 'shop',
  '{"mon-sat":"7am-5pm","sun":"closed"}'::jsonb,
  'web_research_agent_2026-05-23',
  'https://www.firestonecompleteautocare.com/nevada/boulder-city/1323-boulder-city-pkwy/',
  'verified_national_chain',
  '["tires","brakes","tune_ups","radiator","batteries","alignment","general_repair"]'::jsonb,
  jsonb_build_object('data_quality','A','national_chain','Firestone','yelp_reviews',35)
) ON CONFLICT (slug) DO NOTHING;

-- First Choice Auto
INSERT INTO public.organizations (name, business_name, slug, address, city, state, zip_code, phone, business_type, org_type, hours_of_operation, founded_year, years_in_business, source, source_url, verification_level, services_offered, metadata)
VALUES (
  'First Choice Auto',
  'First Choice Auto',
  'first-choice-auto-boulder-city',
  '1634 Foothill Dr',
  'Boulder City', 'NV', '89005',
  '(702) 294-1861',
  'independent_general_repair', 'shop',
  '{"mon-fri":"8am-5pm","sat-sun":"closed"}'::jsonb,
  2001, 23,
  'web_research_agent_2026-05-23',
  'https://www.firstchoiceautonv.com/',
  'ase_certified_general',
  '["repair","maintenance","performance_upgrades","engines","ac","electrical","transmissions","brakes","batteries"]'::jsonb,
  jsonb_build_object(
    'data_quality','A',
    'certifications','ASE-certified mechanics (general claim)',
    'warranty','12-month / 12,000-mile parts + installation',
    'awards','2023 Best in City Automotive Repair Shop',
    'discounts','military, veterans, first responders, seniors',
    'skylar_testimony','decent shop'
  )
) ON CONFLICT (slug) DO NOTHING;

-- ─── SECTION 2: Shops Skylar did NOT name ────────────

INSERT INTO public.organizations (name, business_name, slug, address, city, state, zip_code, phone, business_type, org_type, hours_of_operation, source, source_url, verification_level, services_offered, metadata)
VALUES
  ('Auto Specialists Auto Repair', 'Auto Specialists', 'auto-specialists-boulder-city', '705 Juniper Way', 'Boulder City', 'NV', '89005', '(702) 293-4776', 'independent_general_repair', 'shop',
    '{"mon-fri":"7:30am-5:30pm","sat-sun":"closed"}'::jsonb,
    'web_research_agent_2026-05-23', 'https://www.bcautospecialists.com/', 'ase_master_certified',
    '["ac","brakes","maintenance","diagnostics","electrical","engine","oil","undercar","4x4","alignment","transmission","domestic","import","asian","european"]'::jsonb,
    jsonb_build_object('data_quality','A','certifications','ASE Master Technician','yelp_reviews',52,'note','One block from Skylar shop at 707 Yucca — was not in his mental map','strategic_flag','direct_neighbor_competitor')),

  ('Honestlee Auto', 'Honestlee Auto, LLC', 'honestlee-auto-boulder-city', '726 Canyon Rd', 'Boulder City', 'NV', '89005', '(702) 293-1260', 'independent_general_repair', 'shop',
    '{"mon-fri":"8am-6pm","sat":"8am-3pm","sun":"closed"}'::jsonb,
    'web_research_agent_2026-05-23', 'https://honestleeauto.com', 'bbb_accredited',
    '["complete_auto_repair","light_truck","light_diesel_maintenance"]'::jsonb,
    jsonb_build_object('data_quality','A','owner','Leland J Koll','founded','2014-12-09','note','Next door to BK Kustoms (738 Canyon Rd)','yelp_reviews',35)),

  ('Curt''s Auto Care', 'Curt''s Auto Care, LLC', 'curts-auto-care-boulder-city', '1585 Foothill Dr', 'Boulder City', 'NV', '89005', '(702) 294-6600', 'napa_auto_care', 'shop',
    '{"mon-sat":"8am-5pm"}'::jsonb,
    'web_research_agent_2026-05-23', 'https://www.napaonline.com/en/autocare/?facilityId=1346756', 'ase_certified_napa_member',
    '["general_repair","diagnostics","maintenance"]'::jsonb,
    jsonb_build_object('data_quality','A','founded','1985','sold','1998','bought_back','2015-01','owner_disputed','Mike Gardner per one source, Christine Callahan per BBB','napa_facility_id',1346756,'yelp_reviews',17)),

  ('George''s Tire & Auto Repair', 'George''s Tire & Auto', 'georges-tire-boulder-city', '1400 Boulder City Pkwy', 'Boulder City', 'NV', '89005', '(702) 294-1155', 'tire_plus_auto', 'shop',
    '{"mon-sat":"7:30am-6pm"}'::jsonb,
    'web_research_agent_2026-05-23', 'https://www.yellowpages.com/boulder-city-nv/mip/georges-tire-auto-repair-3215854', 'verified_directory',
    '["tires","general_auto_repair"]'::jsonb,
    jsonb_build_object('data_quality','A','owners','Chuck & Vicki Rowlett','founded_llc','1998','prior_address','1100 Nevada Hwy','address_collision_with','meineke-2968-boulder-city','collision_note','Same 1400 Boulder City Pkwy as Meineke #2968')),

  ('Ralph''s Tire Pros', 'Ralph''s Tire Pros', 'ralphs-tire-pros-boulder-city', '1581 Foothill Dr Ste C', 'Boulder City', 'NV', '89005', '(702) 294-8473', 'tire_plus_auto', 'shop',
    NULL,
    'web_research_agent_2026-05-23', 'https://www.ralphstirepros.com/', 'ase_certified',
    '["tires","custom_wheels","alignments","diesel_repair","brakes","transmission","cooling","ac","engine_diag","tpms","trailer_maintenance"]'::jsonb,
    jsonb_build_object('data_quality','A','founder','Ralph Mortensen','founded','1986','years_in_business',40,'note','One mechanic with 30+ years experience','tire_brands',ARRAY['Continental','General','Hercules','Michelin','BFGoodrich','Toyo','Falken','Dunlop','Nitto'])),

  ('Lakeside Auto Service', 'Lakeside Auto Service, Ltd', 'lakeside-auto-service-boulder-city', '707 Canyon Rd Ste 111A', 'Boulder City', 'NV', '89005', '(702) 293-6158', 'independent_general_repair', 'shop',
    '{"mon-fri":""}'::jsonb,
    'web_research_agent_2026-05-23', 'https://www.bbb.org/us/nv/boulder-city/profile/auto-repair/lakeside-auto-service-1086-74929', 'bbb_listed',
    '["general_repair"]'::jsonb,
    jsonb_build_object('data_quality','A','started','1995-09-01','incorporated','1996-08-14','yelp_rating',4.5,'note','Same Canyon Rd cluster as Honestlee + BK Kustoms')),

  ('K-C''s Auto Repair', 'K-C''s Auto Repair', 'kcs-auto-repair-boulder-city', NULL, 'Boulder City', 'NV', '89005', NULL, 'independent_general_repair', 'shop',
    NULL,
    'web_research_agent_2026-05-23', 'https://www.facebook.com/p/KCs-AUTO-Repair-100067872573630/', 'directory_only',
    '["ac","brakes","oil","tune_ups","smog","diagnostics","import","domestic"]'::jsonb,
    jsonb_build_object('data_quality','B','address_unknown',TRUE,'note','Address not surfaced — check Yellow Pages or Facebook page')),

  ('Transcend Automotive', 'Transcend Automotive, LLC', 'transcend-automotive-boulder-city', NULL, 'Boulder City', 'NV', '89005', NULL, 'independent_general_repair', 'shop',
    NULL,
    'web_research_agent_2026-05-23', 'https://www.dnb.com/business-directory/company-profiles.transcend_automotive_llc.c821f2e83f4b7bfe49b076013c80bc01.html', 'dnb_listed',
    '["general_repair","muffler"]'::jsonb,
    jsonb_build_object('data_quality','B','address_unknown',TRUE,'note','Smaller/newer shop — appears in Yelp top-10 lists')),

  ('DB''s Automotive Service', 'DB''s Automotive Service', 'dbs-automotive-boulder-city', NULL, 'Boulder City', 'NV', '89005', '(702) 293-2473', 'independent_general_repair', 'shop',
    NULL,
    'web_research_agent_2026-05-23', 'http://www.wefixcars.net/', 'bbb_listed',
    '["diagnostics","full_repair"]'::jsonb,
    jsonb_build_object('data_quality','A','manager','Donny Anderson','note','Latest diagnostic and testing equipment per claim')),

  ('B & J Body Shop', 'B & J Body Shop', 'bj-body-shop-boulder-city', '1512 Boulder City Pkwy', 'Boulder City', 'NV', '89005', '(702) 293-1140', 'body_collision', 'shop',
    '{"mon-fri":"7:30am-5pm"}'::jsonb,
    'web_research_agent_2026-05-23', 'https://bandjbodyshop.com/', 'carwise_ranked',
    '["auto_body","collision_repair","body_paint","paintless_dent_removal","headlight_restoration","windshield","replacement_truck_beds"]'::jsonb,
    jsonb_build_object(
      'data_quality','A',
      'owner','Charles Williams',
      'lineage','third-generation family operation',
      'founded',1962,
      'years_in_business',62,
      'name_collision_with','Skylar Williams (owner names share surname — presumed unrelated, worth a 30-sec conversation check)',
      'specialization','factory-approved parts + paint (not aftermarket)',
      'service_area','Las Vegas Valley (free pickup/delivery)',
      'rankings','#2 of 31 auto body shops in Southern NV + NW AZ per Carwise',
      'inventory_stocked','350+ replacement truck beds',
      'strategic_flag','OLDEST_BODY_SHOP_IN_TOWN',
      'skylar_omission','was NOT in Skylar mental map'
    )),

  ('Parsons Auto Body', 'Parsons Auto Body', 'parsons-auto-body-boulder-city', '1574 Foothill Dr Ste A', 'Boulder City', 'NV', '89005', '(702) 293-0867', 'body_collision', 'shop',
    '{"mon-fri":"8am-5pm"}'::jsonb,
    'web_research_agent_2026-05-23', 'https://www.parsonsautobody.com/', 'ppg_icar_platinum',
    '["collision_repair","dent_removal","auto_glass","bumper_repair","paint"]'::jsonb,
    jsonb_build_object(
      'data_quality','A',
      'certifications',jsonb_build_array('PPG','I-CAR Platinum','DRP partner'),
      'location_since',1999,
      'makes_serviced',jsonb_build_array('Acura','Honda','Toyota','Ford','Chevrolet','Dodge','Jeep','BMW','Tesla','Rivian','+30 more'),
      'claim','Boulder City #1 body shop',
      'strategic_flag','TOP_TIER_COLLISION'
    )),

  ('Ken''s Boulder City Canvas & Upholstery', 'Ken''s Boulder City Canvas & Upholstery', 'kens-bc-canvas-upholstery-boulder-city', '1500 Industrial Rd', 'Boulder City', 'NV', '89005', '(702) 293-4509', 'upholstery_canvas', 'shop',
    NULL,
    'web_research_agent_2026-05-23', 'https://www.superpages.com/boulder-city-nv/bpp/kens-boulder-city-canvas-upholstery-482726551', 'directory_listed',
    '["bimini_tops","enclosures","boat_top_covers","automotive_seat_covers","custom_upholstery","ready_made_upholstery"]'::jsonb,
    jsonb_build_object(
      'data_quality','A',
      'lineage','Successor business to B.C. Canvas & Upholstery (1680 Nevada Hwy, CLOSED per Yelp Nov 2025)',
      'possible_skylar_referent','Likely the "Ernies Upholstery" Skylar mentioned (name mismatch — verify)',
      'strategic_flag','PRIMARY_LOCAL_UPHOLSTERY'
    )),

  ('TIG Mobile Automotive', 'TIG Mobile Automotive Service', 'tig-mobile-automotive-boulder-city', NULL, 'Boulder City', 'NV', '89005', '(702) 294-7741', 'mobile_service_specialty', 'shop',
    NULL,
    'web_research_agent_2026-05-23', 'https://www.yelp.com/biz/tig-mobile-automotive-service-boulder-city-2', 'ase_certified',
    '["mobile_electrical_diagnosis","ac_heat","alternators","batteries","starters"]'::jsonb,
    jsonb_build_object(
      'data_quality','B',
      'tenure','20+ years serving Clark County',
      'possible_skylar_referent','Likely "Dave the neighbor electrical specialist" (Skylar verbal testimony) — verify',
      'service_model','mobile (no fixed shop address)',
      'specialization','electrical_diagnosis'
    ))
ON CONFLICT (slug) DO NOTHING;

-- ─── Verify count post-insert ────────────
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM public.organizations WHERE city ILIKE 'Boulder%' AND state = 'NV';
  RAISE NOTICE 'Boulder City NV organizations count after seed: %', v_count;
END $$;
