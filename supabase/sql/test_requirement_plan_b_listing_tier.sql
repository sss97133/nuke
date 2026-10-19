-- Disposable PG17 only. Proves 20261020173000_requirement_plan_b_listing_tier.sql as the job-loop replay applies it
-- (chained on the job-market-health contract): Plan-B lists keep paid-for-on-Nuke suppliers first and add public
-- organizations whose listing names a service mapped (reviewed map) to the requirement's capability key, in the job
-- area's state and within the listing's radius (100 miles when none), for skill/inspection requirements only, labelled
-- 'listed as offering ... — not verified', never evidence and never a match pass; job_market_health reports Plan-B by tier.
\set ON_ERROR_STOP on
\ir test_job_market_health.sql

RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SELECT as_user(NULL);
SELECT t_assert(us_state_code('Nevada') = 'NV' AND us_state_code(' nv ') = 'NV' AND us_state_code('Xanadu') IS NULL
  AND listing_service_term('Oil Changes') = 'oil_changes' AND listing_service_term('Tune-Ups ') = 'tune_ups'
  AND has_table_privilege('anon', 'listing_service_capability_map', 'SELECT')
  AND NOT has_table_privilege('anon', 'listing_service_capability_map', 'INSERT')
  AND NOT EXISTS (SELECT 1 FROM listing_service_capability_map WHERE service_term IN ('service', 'sales', 'restoration', 'lift_kits')),
  'helpers; the reviewed map is readable, not writable, and leaves vague terms unmapped');

UPDATE vehicles SET city = 'Boulder City', state = 'NV' WHERE id = '40000000-0000-0000-0000-000000000001';
INSERT INTO city_geocode_lookup(city, state, latitude, longitude, sample_size, source) VALUES
 ('Boulder City', 'NV', 35.978744, -114.834048, 70, 'fixture'), ('Reno', 'NV', 39.5296, -119.8138, 50, 'fixture'),
 ('Pahrump', 'Nevada', 36.2083, -115.9839, 10, 'fixture');
INSERT INTO organizations(id, business_name, is_public, city, state, services_offered, service_radius_miles, latitude, longitude) VALUES
 ('2e000000-0000-0000-0000-000000000001', 'Listed Lube', true, 'Boulder City', 'Nevada', ARRAY['Oil Changes', 'Tune-Ups'], NULL, NULL, NULL),
 ('2e000000-0000-0000-0000-000000000002', 'Far Lube', true, 'Reno', 'NV', ARRAY['oil_changes'], NULL, NULL, NULL),
 ('2e000000-0000-0000-0000-000000000003', 'Radius Lube', true, 'Pahrump', 'NV', ARRAY['maintenance'], 80, NULL, NULL),
 ('2e000000-0000-0000-0000-000000000004', 'Short Radius Lube', true, 'Pahrump', 'NV', ARRAY['maintenance'], 30, NULL, NULL),
 ('2e000000-0000-0000-0000-000000000005', 'Private Lube', false, 'Boulder City', 'NV', ARRAY['oil_changes'], NULL, NULL, NULL),
 ('2e000000-0000-0000-0000-000000000006', 'Arizona Lube', true, 'Kingman', 'AZ', ARRAY['oil_changes'], 200, NULL, NULL),
 ('2e000000-0000-0000-0000-000000000007', 'Vague Shop', true, 'Boulder City', 'NV', ARRAY['Service', 'Sales'], NULL, NULL, NULL),
 ('2e000000-0000-0000-0000-000000000008', 'Caps Shop', true, 'Boulder City', 'NV', NULL, NULL, 35.97, -114.83),
 ('2e000000-0000-0000-0000-000000000009', 'Paint Shop', true, 'Boulder City', 'NV', ARRAY['paint'], NULL, NULL, NULL);
INSERT INTO organization_capabilities(organization_id, capability_type, evidence_count, is_active) VALUES
 ('2e000000-0000-0000-0000-000000000008', 'engine', 0, true);

CREATE FUNCTION public.lt_names(p jsonb, p_tier text) RETURNS text[] LANGUAGE sql AS $$
  SELECT COALESCE(array_agg(e#>>'{organization,name}' ORDER BY o), '{}') FROM jsonb_array_elements(p) WITH ORDINALITY x(e, o) WHERE e->>'tier' = p_tier $$;
SELECT requirement_plan_b_suppliers_tiered('Oil change', 'skill', '[{"key":"general_maintenance"}]', '{"city":"Boulder City","state":"NV"}') AS oil \gset
SELECT t_assert(lt_names(:'oil', 'stated_by_listing') = ARRAY['Listed Lube', 'Radius Lube']
  AND lt_names(:'oil', 'paid_for_on_nuke') = '{}'::text[],
  'listing tier: same city first, then within the stated radius; far, short-radius, private, other-state and unmapped listings excluded: '
  || array_to_string(lt_names(:'oil', 'stated_by_listing'), ','));
SELECT t_assert((:'oil'::jsonb)->0 @> '{"tier":"stated_by_listing","tier_label":"stated by the business listing","label":"listed as offering oil changes, tune ups — not verified",
    "record_backed":false,"verified":false,"counts_as_evidence":false,"can_receive_requests":false,"on_nuke":{"state":"not_on_nuke_yet","label":"Not on Nuke yet"},
    "geography":{"same_state":true,"same_city":true,"distance_miles":0.0},"services_listed":["oil_changes","tune_ups"],"capability_keys_matched":["general_maintenance"]}'
  AND ((:'oil'::jsonb)->1#>>'{geography,distance_miles}')::numeric BETWEEN 60 AND 80,
  'listing entries are labelled not verified, never evidence, Not on Nuke yet with the claim/invite path: ' || ((:'oil'::jsonb)->1)::text);
SELECT t_assert(requirement_plan_b_suppliers_tiered('Oil change', 'tool', '[{"key":"general_maintenance"}]', '{"city":"Boulder City","state":"NV"}') = '[]'::jsonb
  AND requirement_plan_b_suppliers_tiered('Oil change', 'facility', '[{"key":"general_maintenance"}]', '{"city":"Boulder City","state":"NV"}') = '[]'::jsonb
  AND requirement_plan_b_suppliers_tiered('Oil change', 'skill', '[{"key":"general_maintenance"}]', NULL) = '[]'::jsonb
  AND requirement_plan_b_suppliers_tiered('Oil change', 'skill', '[]', '{"city":"Boulder City","state":"NV"}') = '[]'::jsonb,
  'no listing tier for tool/facility requirements, without a job area or without capability keys');
SELECT t_assert(lt_names(requirement_plan_b_suppliers_tiered('Intake manifold gasket', 'skill', '[{"key":"intake_system"}]', '{"city":"Boulder City","state":"NV"}'),
    'stated_by_listing') = ARRAY['Caps Shop']
  AND requirement_plan_b_suppliers_tiered('Intake manifold gasket', 'skill', '[{"key":"intake_system"}]', '{"city":"Boulder City","state":"NV"}')->0
    @> '{"services_listed":["engine"],"verified":false}',
  'organization_capabilities terms count as listing statements (their verified flag is ignored)');
SELECT requirement_plan_b_suppliers_tiered('Paint touch-up for the door', 'skill', '[{"key":"paint_refinish"}]', '{"city":"Boulder City","state":"NV"}') AS paint \gset
SELECT t_assert((:'paint'::jsonb)->0 @> '{"tier":"paid_for_on_nuke","organization":{"name":"AutoZone"},"record_backed":true}'
  AND lt_names(:'paint', 'stated_by_listing') = ARRAY['Paint Shop']
  AND (SELECT max(o) FROM jsonb_array_elements(:'paint'::jsonb) WITH ORDINALITY x(e, o) WHERE e->>'tier' = 'paid_for_on_nuke')
    < (SELECT min(o) FROM jsonb_array_elements(:'paint'::jsonb) WITH ORDINALITY x(e, o) WHERE e->>'tier' = 'stated_by_listing'),
  'paid-for-on-Nuke suppliers rank before listing-stated ones: ' || (:'paint')::text);

-- In the readers: an open oil-change requirement on the Boulder City vehicle.
INSERT INTO work_orders(id, vehicle_id, customer_id, title, description, status) VALUES
 ('ab000000-0000-0000-0000-000000000007', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000c', 'Service', '- Oil change', 'pending');
INSERT INTO work_order_line_items(id, work_order_id, line_number, task_type, task_description, status) VALUES
 ('ab100000-0000-0000-0000-000000000007', 'ab000000-0000-0000-0000-000000000007', 1, 'other', 'Oil change', 'pending');
INSERT INTO vehicle_observations(id, vehicle_id, kind, source_id, observed_at, extraction_method, structured_data) VALUES
 ('ab200000-0000-0000-0000-000000000007', '40000000-0000-0000-0000-000000000001', 'work_record', '90000000-0000-0000-0000-000000000001', '2026-03-02',
  'requirement_interpretation_v1', jsonb_build_object('work_order_resource', jsonb_build_object('version', 1, 'event_type', 'requirement',
   'work_order_id', 'ab000000-0000-0000-0000-000000000007', 'line_item_id', 'ab100000-0000-0000-0000-000000000007', 'requirement_kind', 'skill',
   'description', 'Oil change (Shell Rotella T6 5W-40)', 'quantity', 1, 'unit', 'job')));
SET ROLE service_role;
SELECT project_work_order_resource_observation('ab200000-0000-0000-0000-000000000007');
SELECT record_job_market_health_snapshot();
RESET ROLE;
SET ROLE anon;
SELECT (SELECT r FROM jsonb_array_elements(open_requirements_read(NULL, 100, NULL)->'rows') r WHERE r->>'requirement_id' = 'ab200000-0000-0000-0000-000000000007') AS row7 \gset
SELECT job_market_health_read() AS h \gset
RESET ROLE;
SELECT t_assert((:'row7'::jsonb)->'capability_keys' @> '[{"key":"general_maintenance"}]'
  AND lt_names((:'row7'::jsonb)->'plan_b_suppliers', 'stated_by_listing') = ARRAY['Listed Lube', 'Radius Lube'],
  'open_requirements_read carries the listing tier for the open oil-change requirement: ' || ((:'row7'::jsonb)->'plan_b_suppliers')::text);
SELECT t_assert((:'h'::jsonb)#>'{matching,plan_b_by_tier}' ?& ARRAY['paid_for_on_nuke', 'stated_by_listing', 'listing_only', 'any', 'none']
  AND ((:'h'::jsonb)#>>'{matching,plan_b_by_tier,listing_only}')::int >= 1
  AND (:'h'::jsonb)#>'{matching,with_plan_b_supplier}' = (:'h'::jsonb)#>'{matching,plan_b_by_tier,paid_for_on_nuke}'
  AND ((:'h'::jsonb)#>>'{matching,plan_b_by_tier,any}')::int + ((:'h'::jsonb)#>>'{matching,plan_b_by_tier,none}')::int = ((:'h'::jsonb)#>>'{matching,open_requirements}')::int
  AND ((:'h'::jsonb)->'history'->-1) ?& ARRAY['with_plan_b_listing_only', 'with_plan_b_any']
  AND (:'h'::jsonb)#>'{rules}' ? 'plan_b_tiers'
  AND (:'h'::jsonb)::text !~ '(Listed Lube|Radius Lube)',
  'job_market_health reports Plan-B by tier (paid-for stays with_plan_b_supplier), in history too, names never: ' || ((:'h'::jsonb)#>'{matching,plan_b_by_tier}')::text);
SELECT t_assert(NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('provider_requirement_match', 'verified_claimant_match_inputs', 'open_requirement_skill_input',
    'open_requirement_tools_input', 'open_requirement_facility_input') AND prosrc ~ '(listing_service_capability_map|stated_by_listing|services_offered)'),
  'listings never reach a match input');
