-- Disposable PG17 only. Synthetic fixtures. Proves 20261019191500_listing_work_plan_read.sql ports the read-only
-- buying-evidence --plan logic: identity conflicts first, claims with exclusions counted, keyword-table operations with
-- seed_uncalibrated hours (excluded matches counted, absent codes reported), the rate as returned, unverified priced
-- text-fitment parts, and a pre_purchase checklist in the shape request_inspection accepts; anon-callable, no PII.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable PG17 database required';
  END IF;
END $$;
SET TimeZone = 'UTC';
CREATE SCHEMA auth;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TYPE public.observation_kind AS ENUM ('valuation','condition','specification','work_record');
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, year integer, make text, model text, trim text, series text, vin text, engine_size text,
  engine_liters numeric, engine_displacement text, displacement text, transmission text, drivetrain text, listing_url text,
  bat_auction_url text, discovery_url text, description text, is_public boolean, deleted_at timestamptz, listing_kind text, seller_name text);
CREATE TABLE public.vin_decoded_data(vin text, make text, model text, year integer, engine_displacement_liters text, transmission text,
  drivetrain text, provider text, decoded_at timestamptz, raw_response jsonb);
CREATE TABLE public.description_discoveries(id uuid PRIMARY KEY, vehicle_id uuid, discovered_at timestamptz, model_used text, prompt_version text, raw_extraction jsonb);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, vehicle_id uuid, source text, is_sensitive boolean);
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY, vehicle_id uuid, subject_type text, kind public.observation_kind, source_url text,
  observed_at timestamptz, ingested_at timestamptz, extraction_method text, confidence_score numeric, content_text text, structured_data jsonb, is_superseded boolean DEFAULT false);
CREATE TABLE public.labor_operations(code text PRIMARY KEY, name text, base_hours numeric, system text, model_year_min integer, model_year_max integer);
CREATE TABLE public.stage_transition_labor_map(id uuid PRIMARY KEY, category text, from_stage text, to_stage text, zone_pattern text, description text,
  estimated_hours_min real, estimated_hours_typical real, estimated_hours_max real, materials_cost_min real, materials_cost_max real, confidence text);
CREATE TABLE public.catalog_parts(id uuid PRIMARY KEY, part_number text, name text, price_current numeric, currency text, fits_models text[],
  year_start integer, year_end integer, manufacturer text);
CREATE FUNCTION public.observation_is_public(k public.observation_kind, d jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT COALESCE(d->>'private', 'false') <> 'true' $$;
CREATE FUNCTION public.resolve_labor_rate(p_org uuid DEFAULT NULL, p_user uuid DEFAULT NULL, p_vehicle uuid DEFAULT NULL, p_client uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"rate":160,"source":"spitball","rate_confidence":"spitball_no_data"}'::jsonb $$;
CREATE FUNCTION public.viewer_identity_bridge(p_user uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"state":"none","evidenced_actor_ids":[]}'::jsonb $$;
CREATE FUNCTION public.job_reader_viewer(p_context text, p_slots text[], p_bridge jsonb, p_money_visible boolean) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('context', p_context, 'slots', to_jsonb(COALESCE(p_slots, '{}'::text[])), 'money_visible', COALESCE(p_money_visible, false),
    'contact_visible', false, 'decided_from', 'auth.uid()', 'identity_bridge', COALESCE(p_bridge->>'state', 'none')) $$;
CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
CREATE FUNCTION public.t_refused(q text) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean,text), public.t_refused(text) TO anon, authenticated;

INSERT INTO vehicles VALUES ('10000000-0000-0000-0000-000000000001', 1979, 'Chevrolet', 'K10', NULL, NULL, 'CKL149F123456', '5.7', NULL, NULL, NULL,
  'Automatic', '4WD', 'https://bringatrailer.com/listing/1979-chevrolet-k10-fixture/', NULL, NULL,
  E'This 1979 Chevrolet K10 pickup was refreshed in 2019. The paint shows fading and scratches on the hood. The brakes are worn and need service.\nGauges are inoperative. No rust on the frame. Power is from a 350 ci V8 with a four-speed manual transmission and 4x4.',
  true, NULL, NULL, 'Private Seller Name'),
 ('10000000-0000-0000-0000-000000000002', 1980, 'Ford', 'F-150', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Hidden truck.', false, NULL, NULL, NULL);
INSERT INTO description_discoveries VALUES
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','2026-01-01','m1','v3','{"error":"timeout"}'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','2026-01-02','m1','v3',
  '{"flags":[{"f":"Cracked dash pad","sev":"minor"}],"cond":"good","work":[{"w":"New radiator installed","d":"2020"}],"mods":["Lift kit"],"miles":45000,"mi_unit":"mi","t_type":"manual","e_liters":"5.7"}');
INSERT INTO vehicle_images VALUES ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','bat_import',false),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','user_upload',false);
INSERT INTO vehicle_observations(id, vehicle_id, subject_type, kind, source_url, observed_at, ingested_at, extraction_method, confidence_score, content_text, structured_data) VALUES
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','vehicle','condition','https://bringatrailer.com/listing/1979-chevrolet-k10-fixture','2026-01-03','2026-01-03','rubric_v1',0.8,NULL,
  '{"rubric":true,"known_issues":["Exhaust leak at the manifold and a loud muffler"]}'),
 ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','vehicle','condition',NULL,'2026-01-03','2026-01-03','image_deep',0.6,NULL,
  '{"analysis_kind":"image_deep_byok","image_id":"30000000-0000-0000-0000-000000000001","state_observations":{"damage_callouts":["Dent on the driver door"]}}'),
 ('40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','vehicle','condition',NULL,'2026-01-03','2026-01-03','image_deep',0.6,NULL,
  '{"analysis_kind":"image_deep_byok","image_id":"30000000-0000-0000-0000-000000000002","state_observations":{"damage_callouts":["Dent from an unrelated upload"]}}');
INSERT INTO labor_operations VALUES ('PAINT-COMPLETE-PANEL','Complete paint per panel',4,'paint',NULL,NULL),('MECH-BRAKES-FRONT','Front brakes',2,'brakes',NULL,NULL),
 ('MECH-BRAKES-REAR','Rear brakes',2,'brakes',NULL,NULL),('MECH-BRAKES-ALL','All brakes',4,'brakes',NULL,NULL),('ELEC-GAUGES','Gauges',3,'electrical',1960,1990),
 ('INT-DASH-RR','Dash pad',3,'interior',NULL,NULL),('EXH-MUFFLER-RR','Muffler',1.5,'exhaust',NULL,NULL),('BODY-DENT-SMALL','Small dent',1,'body',NULL,NULL);
INSERT INTO stage_transition_labor_map VALUES
 ('50000000-0000-0000-0000-000000000001','body','fabricated','primed','panel_*','Panel prime',1,2,3,40,120,'high'),
 ('50000000-0000-0000-0000-000000000002','body','primed','blocked','panel_*','Block sand',2,3,4,10,30,'high'),
 ('50000000-0000-0000-0000-000000000003','body','blocked','basecoated','panel_*','Basecoat',1,1.5,2,60,150,'medium'),
 ('50000000-0000-0000-0000-000000000004','body','basecoated','clearcoated','panel_*','Clearcoat',1,1.5,2,50,120,'medium'),
 ('50000000-0000-0000-0000-000000000005','chassis','stock','refreshed','*','Chassis refresh',6,10,16,200,800,'low');
INSERT INTO catalog_parts VALUES ('60000000-0000-0000-0000-000000000001','BP-1','Brake pad set',40,'USD',ARRAY['K10','C10'],1973,1987,'Acme'),
 ('60000000-0000-0000-0000-000000000002','BP-2','Brake pad set',35,'USD',ARRAY['F-150'],1973,1987,'Acme');

\ir ../migrations/20261019191500_listing_work_plan_read.sql

SELECT t_assert(has_function_privilege('anon','public.listing_work_plan_read(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.listing_plan_resolve_target(jsonb,integer)','EXECUTE')
  AND (SELECT prosecdef AND 'search_path=pg_catalog, public' = ANY (proconfig) FROM pg_proc WHERE proname='listing_work_plan_read'), 'anon reader; helpers closed');
SELECT t_assert((SELECT count(*) FROM listing_plan_sentences(E'One. Two!? three\nFour') ) = 4
  AND (SELECT string_agg(quote || '|' || start_cp || '-' || end_cp, ',' ORDER BY ord) FROM listing_plan_sentences(E'One. Two!? three\nFour'))
    = E'One.|0-4, Two!?|4-10, three\n|10-17,Four|17-21', 'sentence pieces and code-point offsets as the script (node output)');
SELECT t_assert(listing_plan_liters('350 ci') = 5.7 AND listing_plan_liters('5.7L') = 5.7 AND listing_plan_liters('5700') = 5.7, 'liters normalizer');

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
CREATE TEMP TABLE lp AS SELECT listing_work_plan_read('10000000-0000-0000-0000-000000000001') j;
SELECT t_assert((SELECT j @> '{"schema_version":"buying_plan_v1","state":"public_current_parent","viewer":{"context":"visitor"},"record_label":"1979 Chevrolet K10",
  "listing_url":"https://bringatrailer.com/listing/1979-chevrolet-k10-fixture",
  "identity":{"conflicts":["transmission"],"vin_decode":{"state":"not_applicable_vin_absent_or_not_17"},
    "fields":{"year":{"status":"agree"},"model":{"status":"agree"},"engine_displacement_l":{"status":"agree"},"drivetrain":{"status":"agree"},"transmission":{"status":"conflict"}}},
  "rate":{"state":"as_returned","value":{"rate":160,"source":"spitball"},"call":"public.resolve_labor_rate() with no arguments"},
  "keyword_table":{"schema_version":"buying_plan_keywords_v1","entries":21},"model_calls":0,"database_writes":0}' FROM lp), 'identity conflict first, rate as returned, keyword table recorded');
SELECT t_assert((SELECT j->'exclusions' @> '{"description_discovery_failure_rows":1,"image_claims_excluded_unattributed":1}'
  AND (j#>>'{exclusions,keyword_matches_excluded_by_rule}')::int >= 1 FROM lp), 'failure rows, unattributed images and excluded keyword matches counted');
SELECT t_assert((SELECT j->'counts'->'claims_by_kind' @> '{"listing_statement":4,"defect_or_condition":3,"condition_summary":1,"reported_completed_work":1,"modification":1,"odometer":1}' FROM lp),
  'claims from listing text, extraction, rubric and attributed image');
SELECT t_assert((SELECT (SELECT jsonb_agg(op->>'keyword_entry_id' ORDER BY op->>'keyword_entry_id') FROM jsonb_array_elements(j->'candidate_operations') op)
  = '["brakes","dash","dent","exhaust","gauges","paint_refinish"]' FROM lp), 'candidate operations from the reviewed keyword table');
SELECT t_assert((SELECT bool_and(t->>'label' = 'seed_uncalibrated') FROM lp, jsonb_array_elements(j->'candidate_operations') op, jsonb_array_elements(op->'targets') t WHERE t->>'state' = 'resolved'),
  'every resolved hour value is labelled seed_uncalibrated');
SELECT t_assert((SELECT op->'targets' @> '[{"code":"BODY-DENT-SMALL","state":"resolved"},{"code":"BODY-DENT-MED","state":"code_absent_from_reference"}]'
  FROM lp, jsonb_array_elements(j->'candidate_operations') op WHERE op->>'keyword_entry_id' = 'dent'), 'absent reference codes reported, not invented');
SELECT t_assert((SELECT op->'targets' @> '[{"type":"stage_chain","state":"resolved","hours":{"min":5,"typical":8,"max":11},"range_basis":"sum_of_author_declared_rows"}]'
  FROM lp, jsonb_array_elements(j->'candidate_operations') op WHERE op->>'keyword_entry_id' = 'paint_refinish'), 'stage chain summed from author-declared rows');
SELECT t_assert((SELECT op->'targets' @> '[{"code":"ELEC-GAUGES","year_applicability":"in_range"}]' FROM lp, jsonb_array_elements(j->'candidate_operations') op
  WHERE op->>'keyword_entry_id' = 'gauges'), 'year applicability checked');
SELECT t_assert((SELECT j->'parts' @> '[{"term":"brake","state":"priced_text_fitment_match","fitment":"text_match_unverified","rows":[{"part_number":"BP-1","price_current":40}]},{"term":"dash pad","state":"no_priced_text_fitment_match"}]'
  AND j::text !~ 'BP-2' FROM lp), 'parts only with priced text fitment for the record model, labelled unverified');
SELECT t_assert((SELECT j->'ppi_checklist'->0 @> '{"item_id":"ppi:identity:transmission","basis":"identity_conflict","finding":{"inspection_type":"pre_purchase","system":"drivetrain"}}'
  AND jsonb_array_length(j->'ppi_checklist') = (SELECT count(DISTINCT lower(c->>'kind') || lower(c->>'text')) FROM jsonb_array_elements(j->'claims') c) + 1 FROM lp),
  'checklist: identity first, one item per distinct claim');
SELECT t_assert((SELECT j->'inspection_scope' @> '{"inspection_type":"pre_purchase"}'
  AND jsonb_array_length(j#>'{inspection_scope,ppi_checklist}') = jsonb_array_length(j->'ppi_checklist')
  AND (SELECT bool_and(i ? 'item_id' AND i ? 'question' AND position(E'\n' IN i->>'question') = 0 AND char_length(i->>'question') <= 500)
    FROM jsonb_array_elements(j#>'{inspection_scope,ppi_checklist}') i) FROM lp), 'inspection_scope is request_inspection''s p_scope shape');
SELECT t_assert((SELECT c->>'claim_id' = left(encode(sha256(convert_to('vehicles:10000000-0000-0000-0000-000000000001' || E'\n/description\n' || (c->>'text'), 'UTF8')), 'hex'), 16)
  FROM lp, jsonb_array_elements(j->'claims') c WHERE c->>'kind' = 'listing_statement' LIMIT 1), 'claim ids computed as the script');
SELECT t_assert((SELECT j::text !~ '(Private Seller Name|unrelated upload)' FROM lp), 'no seller identity; unattributed image claim absent');
SELECT t_assert(t_refused($q$SELECT listing_work_plan_read('10000000-0000-0000-0000-000000000002')$q$), 'non-public vehicle refused');
RESET ROLE;
