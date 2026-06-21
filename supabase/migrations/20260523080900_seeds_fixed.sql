-- 20260523080900_seeds_fixed.sql
--
-- Corrected versions of boulder_city_shops_seed and first_name_economy_seed
-- after discovering schema mismatches:
--   - organizations.specializations/specialty_*/services_offered are text[] not jsonb
--   - technicians has inserted_at/updated_at NOT NULL with no default — need explicit values
--   - technicians.display_name + tier_inferred + claimed_hourly_rate added by 080800

-- ─── Skylar's physical shop org (single insert, using text[] for arrays) ───
INSERT INTO public.organizations (
  name, business_name, slug, address, city, state, zip_code,
  business_type, org_type, primary_focus,
  has_lift, has_fabrication,
  specializations, specialty_makes, specialty_eras,
  service_description,
  source, enrichment_status, verification_level,
  metadata
) VALUES (
  'Skylar Williams Shop',
  'Skylar Williams Shop',
  'skylar-williams-shop-boulder-city',
  '707 Yucca St',
  'Boulder City', 'NV', '89005',
  'restoration_shop', 'shop', 'service',
  TRUE, TRUE,
  ARRAY['classic_restoration','wiring_harness_fab','engine_swap','exhaust_install','sound_deadening']::text[],
  ARRAY['Ford','Chevrolet','GMC','Pontiac','Dodge','Lexus','Porsche']::text[],
  ARRAY['1960s','1970s','1980s','1990s']::text[],
  'Large property at 707 Yucca St, currently underutilized per Skylar self-testimony 2026-05-23. Co-located with Viva! Las Vegas Autos. Yellow lift + fabrication equipment + fluorescent shop lighting visible in many photos.',
  'skylar_self_testimony', 'unverified', 'basic',
  jsonb_build_object(
    'testimony_observation_ids', jsonb_build_array('ad288a80','3439f1e2','243a2d10'),
    'capture_date', '2026-05-23',
    'data_quality', 'A_owner_self_reported',
    'cascade_seed', TRUE
  )
) ON CONFLICT (slug) DO NOTHING;

-- ─── Boulder City competitor shops (text[] for arrays) ───
INSERT INTO public.organizations (name, business_name, slug, address, city, state, zip_code, business_type, org_type, hours_of_operation, years_in_business, source, source_url, verification_level, specializations, services_offered, metadata) VALUES
  (
    'BK Kustoms', 'BK Kustoms, LLC', 'bk-kustoms-boulder-city',
    '738 Canyon Rd', 'Boulder City', 'NV', '89005',
    'restoration_shop', 'shop',
    '{"mon-fri":"7:30am-5:30pm","sat":"8am-12pm","sun":"closed"}'::jsonb,
    38, 'web_research_agent_2026-05-23', 'https://bk-kustoms.wheree.com/', 'basic',
    ARRAY['vintage_restoration','custom_mechanical','lift_kits','lowering','engine_repair']::text[],
    ARRAY['engine_repair','inspections','oil_changes','lift_kits','lowering','vintage_restoration','custom_mechanical_projects','walk_ins_welcome']::text[],
    jsonb_build_object('owner','Robert "Bob" Wrightnour','former_show','Counts Kustoms','bbb_accredited_since','2020-12-03','data_quality','A','skylar_testimony','overloaded one-man shop')
  )
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.organizations (name, business_name, slug, address, city, state, zip_code, phone, business_type, org_type, hours_of_operation, source, source_url, verification_level, services_offered, metadata) VALUES
  (
    'Meineke Car Care #2968', 'meineke-2968-boulder-city',
    '1400 Boulder City Pkwy', 'Boulder City', 'NV', '89005',
    '(702) 948-7711', 'garage', 'shop',
    '{"mon-sat":"7:30am-6pm","sun":"closed"}'::jsonb,
    'web_research_agent_2026-05-23', 'https://www.meineke.com/locations/nv/boulder-city-2968/', 'premium',
    ARRAY['oil_changes','exhaust','brakes','tires','ac','tune_ups','steering_suspension','diagnostics','transmission','battery','state_inspections','smog']::text[],
    jsonb_build_object('address_collision_with','georges-tire-boulder-city','data_quality','A','franchise_chain','Meineke')
  ),
  (
    'Firestone Complete Auto Care', 'firestone-complete-boulder-city',
    '1323 Boulder City Pkwy', 'Boulder City', 'NV', '89005',
    '(702) 608-9541', 'garage', 'shop',
    '{"mon-sat":"7am-5pm","sun":"closed"}'::jsonb,
    'web_research_agent_2026-05-23', 'https://www.firestonecompleteautocare.com/nevada/boulder-city/1323-boulder-city-pkwy/', 'premium',
    ARRAY['tires','brakes','tune_ups','radiator','batteries','alignment','general_repair']::text[],
    jsonb_build_object('data_quality','A','national_chain','Firestone','yelp_reviews',35)
  )
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.organizations (name, business_name, slug, address, city, state, zip_code, phone, business_type, org_type, hours_of_operation, founded_year, years_in_business, source, source_url, verification_level, services_offered, metadata) VALUES
  ('First Choice Auto', 'First Choice Auto', 'first-choice-auto-boulder-city',
    '1634 Foothill Dr', 'Boulder City', 'NV', '89005', '(702) 294-1861',
    'garage', 'shop',
    '{"mon-fri":"8am-5pm","sat-sun":"closed"}'::jsonb,
    2001, 23, 'web_research_agent_2026-05-23', 'https://www.firstchoiceautonv.com/', 'basic',
    ARRAY['repair','maintenance','performance_upgrades','engines','ac','electrical','transmissions','brakes','batteries']::text[],
    jsonb_build_object('data_quality','A','warranty','12-month/12000-mile','awards','2023 Best in City Automotive Repair Shop','skylar_testimony','decent shop'))
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.organizations (name, business_name, slug, address, city, state, zip_code, phone, business_type, org_type, hours_of_operation, source, source_url, verification_level, services_offered, metadata) VALUES
  ('Auto Specialists Auto Repair', 'Auto Specialists Auto Repair', 'auto-specialists-boulder-city', '705 Juniper Way', 'Boulder City', 'NV', '89005', '(702) 293-4776', 'garage', 'shop',
    '{"mon-fri":"7:30am-5:30pm","sat-sun":"closed"}'::jsonb, 'web_research_agent_2026-05-23', 'https://www.bcautospecialists.com/', 'premium',
    ARRAY['ac','brakes','maintenance','diagnostics','electrical','engine','oil','undercar','4x4','alignment','transmission','domestic','import']::text[],
    jsonb_build_object('data_quality','A','certifications','ASE Master Technician','yelp_reviews',52,'note','One block from Skylar shop at 707 Yucca','strategic_flag','direct_neighbor_competitor')),
  ('Honestlee Auto', 'Honestlee Auto', 'honestlee-auto-boulder-city', '726 Canyon Rd', 'Boulder City', 'NV', '89005', '(702) 293-1260', 'garage', 'shop',
    '{"mon-fri":"8am-6pm","sat":"8am-3pm","sun":"closed"}'::jsonb, 'web_research_agent_2026-05-23', 'https://honestleeauto.com', 'basic',
    ARRAY['complete_auto_repair','light_truck','light_diesel_maintenance']::text[],
    jsonb_build_object('data_quality','A','owner','Leland J Koll','founded','2014-12-09','note','Next door to BK Kustoms (738 Canyon Rd)','yelp_reviews',35)),
  ('Curts Auto Care', 'Curts Auto Care', 'curts-auto-care-boulder-city', '1585 Foothill Dr', 'Boulder City', 'NV', '89005', '(702) 294-6600', 'garage', 'shop',
    '{"mon-sat":"8am-5pm"}'::jsonb, 'web_research_agent_2026-05-23', 'https://www.napaonline.com/en/autocare/?facilityId=1346756', 'basic',
    ARRAY['general_repair','diagnostics','maintenance']::text[],
    jsonb_build_object('data_quality','A','founded','1985','napa_facility_id',1346756,'yelp_reviews',17)),
  ('Georges Tire and Auto Repair', 'Georges Tire and Auto Repair', 'georges-tire-boulder-city', '1400 Boulder City Pkwy', 'Boulder City', 'NV', '89005', '(702) 294-1155', 'specialty_shop', 'shop',
    '{"mon-sat":"7:30am-6pm"}'::jsonb, 'web_research_agent_2026-05-23', 'https://www.yellowpages.com/boulder-city-nv/mip/georges-tire-auto-repair-3215854', 'basic',
    ARRAY['tires','general_auto_repair']::text[],
    jsonb_build_object('data_quality','A','owners','Chuck & Vicki Rowlett','founded_llc','1998','address_collision_with','meineke-2968-boulder-city')),
  ('Ralphs Tire Pros', 'Ralphs Tire Pros', 'ralphs-tire-pros-boulder-city', '1581 Foothill Dr Ste C', 'Boulder City', 'NV', '89005', '(702) 294-8473', 'specialty_shop', 'shop',
    NULL, 'web_research_agent_2026-05-23', 'https://www.ralphstirepros.com/', 'basic',
    ARRAY['tires','custom_wheels','alignments','diesel_repair','brakes','transmission','cooling','ac','engine_diag','tpms']::text[],
    jsonb_build_object('data_quality','A','founder','Ralph Mortensen','founded','1986','years_in_business',40)),
  ('Lakeside Auto Service', 'Lakeside Auto Service', 'lakeside-auto-service-boulder-city', '707 Canyon Rd Ste 111A', 'Boulder City', 'NV', '89005', '(702) 293-6158', 'garage', 'shop',
    NULL, 'web_research_agent_2026-05-23', 'https://www.bbb.org/us/nv/boulder-city/profile/auto-repair/lakeside-auto-service-1086-74929', 'basic',
    ARRAY['general_repair']::text[],
    jsonb_build_object('data_quality','A','started','1995-09-01','yelp_rating',4.5)),
  ('K-Cs Auto Repair', 'K-Cs Auto Repair', 'kcs-auto-repair-boulder-city', NULL, 'Boulder City', 'NV', '89005', NULL, 'garage', 'shop',
    NULL, 'web_research_agent_2026-05-23', 'https://www.facebook.com/p/KCs-AUTO-Repair-100067872573630/', 'unverified',
    ARRAY['ac','brakes','oil','tune_ups','smog','diagnostics','import','domestic']::text[],
    jsonb_build_object('data_quality','B','address_unknown',TRUE)),
  ('Transcend Automotive', 'Transcend Automotive', 'transcend-automotive-boulder-city', NULL, 'Boulder City', 'NV', '89005', NULL, 'garage', 'shop',
    NULL, 'web_research_agent_2026-05-23', 'https://www.dnb.com/business-directory/company-profiles.transcend_automotive_llc.c821f2e83f4b7bfe49b076013c80bc01.html', 'basic',
    ARRAY['general_repair','muffler']::text[],
    jsonb_build_object('data_quality','B','address_unknown',TRUE)),
  ('DBs Automotive Service', 'DBs Automotive Service', 'dbs-automotive-boulder-city', NULL, 'Boulder City', 'NV', '89005', '(702) 293-2473', 'garage', 'shop',
    NULL, 'web_research_agent_2026-05-23', 'http://www.wefixcars.net/', 'basic',
    ARRAY['diagnostics','full_repair']::text[],
    jsonb_build_object('data_quality','A','manager','Donny Anderson')),
  ('B and J Body Shop', 'B and J Body Shop', 'bj-body-shop-boulder-city', '1512 Boulder City Pkwy', 'Boulder City', 'NV', '89005', '(702) 293-1140', 'body_shop', 'shop',
    '{"mon-fri":"7:30am-5pm"}'::jsonb, 'web_research_agent_2026-05-23', 'https://bandjbodyshop.com/', 'premium',
    ARRAY['auto_body','collision_repair','body_paint','paintless_dent_removal','headlight_restoration','windshield','replacement_truck_beds']::text[],
    jsonb_build_object('data_quality','A','owner','Charles Williams','founded',1962,'years_in_business',62,'name_collision_with','Skylar Williams (owner names share surname — presumed unrelated)','strategic_flag','OLDEST_BODY_SHOP_IN_TOWN','skylar_omission','was NOT in mental map','inventory_stocked','350+ replacement truck beds')),
  ('Parsons Auto Body', 'Parsons Auto Body', 'parsons-auto-body-boulder-city', '1574 Foothill Dr Ste A', 'Boulder City', 'NV', '89005', '(702) 293-0867', 'body_shop', 'shop',
    '{"mon-fri":"8am-5pm"}'::jsonb, 'web_research_agent_2026-05-23', 'https://www.parsonsautobody.com/', 'elite',
    ARRAY['collision_repair','dent_removal','auto_glass','bumper_repair','paint']::text[],
    jsonb_build_object('data_quality','A','certifications',jsonb_build_array('PPG','I-CAR Platinum','DRP partner'),'location_since',1999,'claim','Boulder City #1 body shop','strategic_flag','TOP_TIER_COLLISION')),
  ('Kens Boulder City Canvas and Upholstery', 'Kens Boulder City Canvas and Upholstery', 'kens-bc-canvas-upholstery-boulder-city', '1500 Industrial Rd', 'Boulder City', 'NV', '89005', '(702) 293-4509', 'specialty_shop', 'shop',
    NULL, 'web_research_agent_2026-05-23', 'https://www.superpages.com/boulder-city-nv/bpp/kens-boulder-city-canvas-upholstery-482726551', 'basic',
    ARRAY['bimini_tops','enclosures','boat_top_covers','automotive_seat_covers','custom_upholstery']::text[],
    jsonb_build_object('data_quality','A','lineage','Successor to B.C. Canvas & Upholstery','possible_skylar_referent','Likely Ernies Upholstery Skylar mentioned (verify)','strategic_flag','PRIMARY_LOCAL_UPHOLSTERY')),
  ('TIG Mobile Automotive', 'TIG Mobile Automotive', 'tig-mobile-automotive-boulder-city', NULL, 'Boulder City', 'NV', '89005', '(702) 294-7741', 'mobile_service', 'shop',
    NULL, 'web_research_agent_2026-05-23', 'https://www.yelp.com/biz/tig-mobile-automotive-service-boulder-city-2', 'basic',
    ARRAY['mobile_electrical_diagnosis','ac_heat','alternators','batteries','starters']::text[],
    jsonb_build_object('data_quality','B','tenure','20+ years','possible_skylar_referent','Likely Dave the neighbor electrical specialist (verify)','service_model','mobile_no_fixed_address','specialization','electrical_diagnosis'))
ON CONFLICT (slug) DO NOTHING;

-- ─── First name economy technicians (with required inserted_at/updated_at) ───
INSERT INTO public.technicians (
  name, display_name, source, tier_inferred,
  specialties_jsonb, certifications_jsonb,
  geography_history,
  claimed_hourly_rate, inferred_hourly_rate, inferred_rate_confidence,
  inserted_at, updated_at
)
VALUES
  ('Justin (last name unknown)','Justin','skylar_verbal_testimony_2026-05-23',NULL,
   '{}'::jsonb,'[]'::jsonb,
   '[{"city":"Boulder City","state":"NV","role":"hustler_sells_cars"}]'::jsonb,
   NULL,NULL,'zero_data', now(), now()),
  ('Trent (last name unknown)','Trent','skylar_verbal_testimony_2026-05-23',NULL,
   '{}'::jsonb,'[]'::jsonb,
   '[{"city":"Boulder City","state":"NV","role":"semi_professional"}]'::jsonb,
   NULL,NULL,'zero_data', now(), now()),
  ('Tommy (paint, last name unknown)','Tommy','skylar_verbal_testimony_2026-05-23',NULL,
   '{"paint":{"hours":0,"evidence_count":0,"note":"Skylar says Tommy does paint"}}'::jsonb,'[]'::jsonb,
   '[{"city":"Boulder City","state":"NV","role":"individual_painter"}]'::jsonb,
   NULL,NULL,'zero_data', now(), now()),
  ('Dave (Skylar neighbor, electrical)','Dave','skylar_verbal_testimony_2026-05-23','specialist',
   '{"electrical":{"hours":0,"evidence_count":0,"note":"Specialized in electrical, doesn''t serve general public"}}'::jsonb,'[]'::jsonb,
   '[{"city":"Boulder City","state":"NV","role":"electrical_specialist","possible_match":"TIG Mobile Automotive"}]'::jsonb,
   NULL,NULL,'zero_data', now(), now()),
  ('Charles (Bronco mechanic, last name unknown)','Charles','skylar_verbal_testimony_session_aefe49ba',NULL,
   '{"general_mechanic":{"hours":0,"evidence_count":0,"note":"Did work on Skylar Bronco"}}'::jsonb,'[]'::jsonb,
   '[]'::jsonb,NULL,NULL,'zero_data', now(), now()),
  ('Keoni (Charles partner)','Keoni','skylar_verbal_testimony_session_aefe49ba',NULL,
   '{}'::jsonb,'[]'::jsonb,'[]'::jsonb,NULL,NULL,'zero_data', now(), now()),
  ('JB Hart','JB Hart','skylar_verbal_testimony_session_aefe49ba',NULL,
   '{}'::jsonb,'[]'::jsonb,'[]'::jsonb,NULL,NULL,'zero_data', now(), now()),
  ('Skylar Williams','Skylar','platform_user_self','master',
   '{"wiring":{"evidence_count":30,"note":"Session 9fcdd38f atoms April-May 2026"},"restoration":{"evidence_count":30},"fabrication":{"evidence_count":5,"note":"Harness fab at vise May 20"},"exhaust_install":{"evidence_count":4}}'::jsonb,
   '[]'::jsonb,
   '[{"city":"Boulder City","state":"NV","shop_address":"707 Yucca St","role":"shop_owner_operator"}]'::jsonb,
   85.00,NULL,'fallback_to_claimed_rate', now(), now())
ON CONFLICT DO NOTHING;
