-- Disposable PG17 only. Proves 20261020184000_requirement_plan_b_listing_cache.sql as the job-loop replay applies it
-- (chained on the listing-tier contract: Boulder City NV listings, an open oil-change requirement): the cached listing tier
-- returns exactly what the live computation returns; listing-field changes (and only those) mark the cache dirty so readers
-- fall back to live rows until refresh_plan_b_listing_cache(); organization_on_nuke keeps its output.
\set ON_ERROR_STOP on
\ir test_requirement_plan_b_listing_tier.sql

RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SELECT as_user(NULL);
SELECT t_assert(NOT has_table_privilege('anon', 'plan_b_listing_cache', 'SELECT') AND NOT has_table_privilege('authenticated', 'plan_b_listing_cache', 'SELECT')
  AND NOT has_table_privilege('anon', 'plan_b_listing_cache_state', 'SELECT') AND NOT has_table_privilege('authenticated', 'plan_b_listing_cache_areas', 'SELECT')
  AND NOT has_function_privilege('anon', 'refresh_plan_b_listing_cache()', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'refresh_plan_b_listing_cache()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'plan_b_listing_candidates_live(text,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'plan_b_listing_cache_touch()', 'EXECUTE')
  AND (SELECT count(*) FROM pipeline_registry WHERE owned_by = 'refresh_plan_b_listing_cache') = 3,
  'cache, writer and helpers are service-only; tables registered');

CREATE FUNCTION pg_temp.tiers(p_text text, p_key text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT requirement_plan_b_suppliers_tiered(p_text, 'skill', jsonb_build_array(jsonb_build_object('key', p_key)), '{"city":"Boulder City","state":"NV"}', 5) $$;
CREATE FUNCTION pg_temp.dirty() RETURNS boolean LANGUAGE sql AS $$ SELECT version <> clean_version FROM plan_b_listing_cache_state $$;
CREATE FUNCTION pg_temp.snap() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(pg_temp.tiers('Oil change', 'general_maintenance'), pg_temp.tiers('Intake manifold gasket', 'intake_system'),
    pg_temp.tiers('Paint touch-up for the door', 'paint_refinish'),
    (SELECT jsonb_agg(r->'plan_b_suppliers' ORDER BY r->>'requirement_id') FROM jsonb_array_elements(open_requirements_read(NULL, 100, NULL)->'rows') r)) $$;

SELECT t_assert(pg_temp.dirty(), 'the fixture''s listing inserts left the cache dirty');
SELECT pg_temp.snap() AS live1 \gset
SET ROLE service_role;
SELECT refresh_plan_b_listing_cache() AS rf \gset
RESET ROLE;
SELECT t_assert(NOT pg_temp.dirty() AND (:'rf'::jsonb)->>'areas' >= '1'
  AND EXISTS (SELECT 1 FROM plan_b_listing_cache_areas WHERE state_code = 'NV' AND city_key = 'boulder city')
  AND (SELECT count(*) FROM plan_b_listing_cache WHERE state_code = 'NV' AND city_key = 'boulder city') >= 4,
  'refresh caches the Boulder City area and marks the cache clean: ' || (:'rf')::text);
SELECT pg_temp.snap() AS cached1 \gset
SELECT t_assert((:'cached1'::jsonb) = (:'live1'::jsonb)
  AND (SELECT count(*) FROM jsonb_array_elements((:'cached1'::jsonb)->0) e WHERE e->>'tier' = 'stated_by_listing') = 2,
  'cached listing tier is identical to the live computation (direct calls and open_requirements_read)');

UPDATE organizations SET business_name = 'Listed Lube & Tune' WHERE id = '2e000000-0000-0000-0000-000000000001';
SELECT t_assert(NOT pg_temp.dirty() AND (pg_temp.tiers('Oil change', 'general_maintenance')->0) @> '{"organization":{"name":"Listed Lube & Tune"}}',
  'a non-listing change (name) keeps the cache clean; labels are read live');
UPDATE organizations SET services_offered = ARRAY['Service', 'Sales', 'oil_changes'] WHERE id = '2e000000-0000-0000-0000-000000000007';
SELECT t_assert(pg_temp.dirty() AND EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.tiers('Oil change', 'general_maintenance')) e
    WHERE e#>>'{organization,name}' = 'Vague Shop'),
  'a listing change marks the cache dirty and readers see it at once (live rows)');
SELECT pg_temp.snap() AS live2 \gset
SET ROLE service_role;
SELECT refresh_plan_b_listing_cache();
RESET ROLE;
SELECT t_assert(NOT pg_temp.dirty() AND pg_temp.snap() = (:'live2'::jsonb), 'after refresh the cache returns the new live result');
INSERT INTO listing_service_capability_map(service_term, capability_key, reviewed_note) VALUES ('fixture_term', 'general_maintenance', 'fixture');
SELECT t_assert(pg_temp.dirty(), 'map changes mark the cache dirty');
DELETE FROM listing_service_capability_map WHERE service_term = 'fixture_term';
INSERT INTO city_geocode_lookup(city, state, latitude, longitude, sample_size, source) VALUES ('Nowhere', 'NV', 38, -117, 1, 'fixture');
SET ROLE service_role;
SELECT refresh_plan_b_listing_cache();
RESET ROLE;
UPDATE city_geocode_lookup SET sample_size = 2 WHERE city = 'Nowhere';
SELECT t_assert(pg_temp.dirty(), 'geocode changes mark the cache dirty');
SET ROLE service_role;
SELECT refresh_plan_b_listing_cache();
RESET ROLE;
UPDATE organization_capabilities SET evidence_count = 1 WHERE organization_id = '2e000000-0000-0000-0000-000000000008';
SELECT t_assert(pg_temp.dirty(), 'organization_capabilities changes mark the cache dirty');

SELECT t_assert((SELECT prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql') FROM pg_proc WHERE oid = 'public.organization_on_nuke(uuid)'::regprocedure)
  AND organization_on_nuke('2e000000-0000-0000-0000-000000000001') = jsonb_build_object('state', 'not_on_nuke_yet', 'label', 'Not on Nuke yet',
    'members_active', 0, 'owners_active', 0, 'verified_claimants', 0, 'claimed_via', '[]'::jsonb, 'offer_capable', false,
    'claim', jsonb_build_object('writer', 'claim_organization', 'methods', jsonb_build_array('document'), 'domain', NULL,
      'domain_email_rule', 'your confirmed sign-in e-mail is at this website''s domain',
      'grants', 'offer as this organization on open requirements; quote, start, complete and invoice only jobs where its offer was accepted; no access to its other work orders, customers or payments'))
  AND organization_on_nuke(:'az') @> '{"state":"claimed","label":"Claimed on Nuke","verified_claimants":1,"claimed_via":["domain_email"],
    "claim":{"methods":["domain_email","document"],"domain":"autozone.com"}}',
  'organization_on_nuke (PL/pgSQL) keeps its output');
SELECT t_assert((SELECT (length(prosrc) - length(replace(prosrc, '(SELECT public.requirement_template_excluded(p_requirement))', ''))) / length('(SELECT public.requirement_template_excluded(p_requirement))') = 3
    FROM pg_proc WHERE oid = 'public.requirement_capability_keys(jsonb,jsonb)'::regprocedure)
  AND (SELECT (length(prosrc) - length(replace(prosrc, 'requirement_capability_keys(', ''))) / length('requirement_capability_keys(') = 1
    FROM pg_proc WHERE oid = 'public.job_market_health_compute()'::regprocedure),
  'exclusion checks run once per key computation; health computes keys once per requirement');
