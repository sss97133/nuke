-- Disposable PG17 only. Synthetic fixtures (the base of test_listing_work_plan_read.sql). Proves
-- 20261125233000_listing_work_plan_shown_photos.sql: an image-derived claim reaches a caller only when the photo is
-- shown (gallery-eligible), the caller uploaded it, or the caller is tied to its vehicle; otherwise it is counted in
-- exclusions.image_claims_excluded_not_shown. The condition loop compares the enum, not its text.
-- The visibility test COALESCEs each term, so a hidden photo with user_id NULL is excluded for a signed-in stranger.
-- The condition walk stops at the rule row's candidate cap and counts the rest (a 900-row car, every third row private).
-- Which assertion fails if the fix is removed: "anon: no claim from the hidden photo; counted as not shown" (and, for
-- edit c, "condition loop: enum compare, ids first" and "cap 600: ..."; for edit d, "stranger: no claim from either
-- hidden photo, the NULL-uploader one included").
-- Fixture rows are disposable PG17 rows. -- ALLOW_RAW_TESTIMONY_WRITE
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
CREATE TABLE public.description_discoveries(id uuid PRIMARY KEY, vehicle_id uuid REFERENCES public.vehicles(id), discovered_at timestamptz, model_used text, prompt_version text, raw_extraction jsonb);
-- guardrail-allow(center-key-fk): vehicle_images.user_id: auth.users is not part of this fixture
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, vehicle_id uuid REFERENCES public.vehicles(id), source text, is_sensitive boolean,
  user_id uuid, shown boolean NOT NULL DEFAULT true);
-- Stubs of the live visibility pieces the fix calls: the gallery test reads the fixture's shown flag; tied is a claim.
CREATE VIEW public.vehicle_images_public WITH (security_invoker = true) AS SELECT * FROM public.vehicle_images;
CREATE FUNCTION public.vehicle_image_gallery_eligible(r public.vehicle_images_public) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT r.shown $$;
-- tied answers NULL (not false) when untied, so a missing COALESCE on that term fails the stranger case too
CREATE FUNCTION public.vehicle_viewer_tied(p_vehicle_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_vehicle_id IS NOT NULL AND current_setting('request.jwt.claims', true)::jsonb->>'tied_to' = p_vehicle_id::text THEN true END $$;
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY, vehicle_id uuid REFERENCES public.vehicles(id), subject_type text, kind public.observation_kind, source_url text,
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
-- Live shapes (2026-11-25): platform_config keeps rule rows by unique config_key; the policy-copy registry of #3925.
CREATE TABLE public.platform_config(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), config_key text NOT NULL UNIQUE, config_value jsonb NOT NULL,
  description text, updated_at timestamptz DEFAULT now(), updated_by uuid);
CREATE TABLE public.private_row_policy_copies(reader text NOT NULL, relation text NOT NULL, policy_filter text NOT NULL, recorded_hash text NOT NULL,
  owner_lane text NOT NULL, note text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (reader, relation, policy_filter));
CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
CREATE FUNCTION public.t_refused(q text) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean,text), public.t_refused(text) TO anon, authenticated;

INSERT INTO vehicles VALUES ('10000000-0000-0000-0000-000000000001', 1979, 'Chevrolet', 'K10', NULL, NULL, 'CKL149F123456', '5.7', NULL, NULL, NULL,
  'Automatic', '4WD', 'https://bringatrailer.com/listing/1979-chevrolet-k10-fixture/', NULL, NULL,
  E'This 1979 Chevrolet K10 pickup was refreshed in 2019. The paint shows fading and scratches on the hood. The brakes are worn and need service.\nGauges are inoperative. No rust on the frame. Power is from a 350 ci V8 with a four-speed manual transmission and 4x4.',
  true, NULL, NULL, 'Private Seller Name'),
 ('10000000-0000-0000-0000-000000000003', 1978, 'Chevrolet', 'C10', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  'https://bringatrailer.com/listing/1978-chevrolet-c10-fixture/', NULL, NULL, 'A truck with many condition rows.', true, NULL, NULL, NULL),
 ('10000000-0000-0000-0000-000000000002', 1980, 'Ford', 'F-150', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Hidden truck.', false, NULL, NULL, NULL);
INSERT INTO description_discoveries VALUES
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','2026-01-01','m1','v3','{"error":"timeout"}'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','2026-01-02','m1','v3',
  '{"flags":[{"f":"Cracked dash pad","sev":"minor"}],"cond":"good","work":[{"w":"New radiator installed","d":"2020"}],"mods":["Lift kit"],"miles":45000,"mi_unit":"mi","t_type":"manual","e_liters":"5.7"}');
INSERT INTO vehicle_images VALUES ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','bat_import',false,NULL,true),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','user_upload',false,NULL,true),
 -- a listing import the gallery hides (a duplicate, a withheld plate, a mismatch), uploaded by u1
 ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','bat_import',false,'70000000-0000-0000-0000-000000000001',false),
 -- a listing capture the gallery hides, with no uploader (user_id NULL, as listing imports land)
 ('30000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','bat_import',false,NULL,false);
INSERT INTO vehicle_observations(id, vehicle_id, subject_type, kind, source_url, observed_at, ingested_at, extraction_method, confidence_score, content_text, structured_data) VALUES
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','vehicle','condition','https://bringatrailer.com/listing/1979-chevrolet-k10-fixture','2026-01-03','2026-01-03','rubric_v1',0.8,NULL,
  '{"rubric":true,"known_issues":["Exhaust leak at the manifold and a loud muffler"]}'),
 ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','vehicle','condition',NULL,'2026-01-03','2026-01-03','image_deep',0.6,NULL,
  '{"analysis_kind":"image_deep_byok","image_id":"30000000-0000-0000-0000-000000000001","state_observations":{"damage_callouts":["Dent on the driver door"]}}'),
 ('40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','vehicle','condition',NULL,'2026-01-03','2026-01-03','image_deep',0.6,NULL,
  '{"analysis_kind":"image_deep_byok","image_id":"30000000-0000-0000-0000-000000000002","state_observations":{"damage_callouts":["Dent from an unrelated upload"]}}'),
 ('40000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','vehicle','condition',NULL,'2026-01-03','2026-01-03','image_deep',0.6,NULL,
  '{"analysis_kind":"image_deep_byok","image_id":"30000000-0000-0000-0000-000000000003","state_observations":{"damage_callouts":["Scratch seen only in a hidden frame"]}}'),
 ('40000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','vehicle','condition',NULL,'2026-01-03','2026-01-03','image_deep',0.6,NULL,
  '{"analysis_kind":"image_deep_byok","image_id":"30000000-0000-0000-0000-000000000004","state_observations":{"damage_callouts":["Crack seen only in an orphan frame"]}}');
-- Car 3: 900 condition rows in id order, every third one private (observation_is_public false), so the walk interleaves.
INSERT INTO vehicle_observations(id, vehicle_id, subject_type, kind, source_url, observed_at, ingested_at, extraction_method, confidence_score, content_text, structured_data)
SELECT ('41000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '10000000-0000-0000-0000-000000000003', 'vehicle', 'condition', NULL, '2026-01-03', '2026-01-03',
       'rubric_v1', 0.5, NULL, jsonb_build_object('rubric', true, 'known_issues', jsonb_build_array('Worn trim piece ' || n)) || CASE WHEN n % 3 = 0 THEN '{"private":"true"}'::jsonb ELSE '{}'::jsonb END
FROM generate_series(1, 900) n;
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
GRANT SELECT ON public.vehicle_images_public TO anon, authenticated;

CREATE FUNCTION public.t_read(p_claims text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE j jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, true);
  j := public.listing_work_plan_read('10000000-0000-0000-0000-000000000001');
  RETURN jsonb_build_object(
    'hidden_claims', (SELECT count(*) FROM jsonb_array_elements(j->'claims') c WHERE c->'source'->>'image_id' = '30000000-0000-0000-0000-000000000003'),
    'shown_claims', (SELECT count(*) FROM jsonb_array_elements(j->'claims') c WHERE c->'source'->>'image_id' = '30000000-0000-0000-0000-000000000001'),
    'hidden_text', j::text ~ 'hidden frame',
    'orphan_claims', (SELECT count(*) FROM jsonb_array_elements(j->'claims') c WHERE c->'source'->>'image_id' = '30000000-0000-0000-0000-000000000004'),
    'orphan_text', j::text ~ 'orphan frame',
    'not_shown', (j#>>'{exclusions,image_claims_excluded_not_shown}')::int,
    'unattributed', (j#>>'{exclusions,image_claims_excluded_unattributed}')::int);
END $$;
GRANT EXECUTE ON FUNCTION public.t_read(text) TO anon, authenticated;
-- Car 3 as anon: condition refs in claim order, fetched rows, the cap exclusion and the gap.
CREATE FUNCTION public.t_big() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE j jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  j := public.listing_work_plan_read('10000000-0000-0000-0000-000000000003');
  RETURN jsonb_build_object(
    'refs', (SELECT jsonb_agg(c#>>'{source,ref}' ORDER BY o) FROM jsonb_array_elements(j->'claims') WITH ORDINALITY x(c, o) WHERE c#>>'{source,table}' = 'vehicle_observations'),
    'fetched', (j#>>'{collections,condition,fetched_rows}')::int,
    'cap', (j#>>'{collections,condition,candidate_cap}')::int,
    'beyond', (j#>>'{exclusions,condition_candidates_beyond_cap}')::int,
    'cap_gap', j->'gaps' @> '[{"family":"condition","reason":"candidate_cap"}]');
END $$;
-- The first k public ids of car 3 in id order (n % 3 <> 0), as the reader's refs.
CREATE FUNCTION public.t_first_public(k int, upto int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(r ORDER BY n) FROM (SELECT n, 'vehicle_observations:41000000-0000-0000-0000-' || lpad(n::text, 12, '0') AS r
    FROM generate_series(1, upto) n WHERE n % 3 <> 0 ORDER BY n LIMIT k) s $$;
GRANT EXECUTE ON FUNCTION public.t_big(), public.t_first_public(int, int) TO anon;

-- Before the fix: the defect. The whole anon read is kept to compare after.
CREATE TABLE public.t_before(j jsonb);
GRANT INSERT, SELECT ON public.t_before TO anon;
BEGIN; SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
INSERT INTO public.t_before SELECT listing_work_plan_read('10000000-0000-0000-0000-000000000001');
SELECT t_read('{"role":"anon"}') AS before_read \gset
SELECT t_big() AS before_big \gset
SELECT t_assert((:'before_big'::jsonb->>'fetched')::int = 500 AND :'before_big'::jsonb->'refs' = t_first_public(500, 900),
  'before: car 3 walks the first 500 public condition rows in id order');
SELECT t_assert((:'before_read'::jsonb->>'hidden_claims')::int = 1 AND (:'before_read'::jsonb->>'hidden_text')::boolean,
  'before: anon gets a claim from a photo the gallery hides');
COMMIT;

-- The migration's guard accepts only this body.
SELECT t_assert((SELECT md5(prosrc) = '5795c6f78ba7845c20a1666935930844' FROM pg_proc WHERE proname = 'listing_work_plan_read'),
  'fixture body is the live body the guard expects');
\ir ../migrations/20261125233000_listing_work_plan_shown_photos.sql

SELECT t_assert(t_refused($q$DO $g$ BEGIN IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.listing_work_plan_read(uuid)'::regprocedure)
  IS DISTINCT FROM '5795c6f78ba7845c20a1666935930844' THEN RAISE EXCEPTION 'guard'; END IF; END $g$$q$),
  'guard: a second apply (body no longer the expected one) is refused');
SELECT t_assert((SELECT prosecdef AND 'search_path=pg_catalog, public' = ANY (proconfig) FROM pg_proc WHERE proname = 'listing_work_plan_read')
  AND has_function_privilege('anon', 'public.listing_work_plan_read(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.listing_work_plan_read(uuid)', 'EXECUTE'), 'definer, search_path and grants kept');
SELECT t_assert((SELECT prosrc NOT LIKE '%kind::text = ''condition''%' AND prosrc LIKE '%c.kind = ''condition''::public.observation_kind%'
  AND prosrc LIKE '%ORDER BY c.id LIMIT cand_cap) cand%' FROM pg_proc WHERE proname = 'listing_work_plan_read'), 'condition loop: enum compare, ids first');

BEGIN; SET LOCAL ROLE anon;
SELECT t_read('{"role":"anon"}') AS anon_read \gset
SELECT t_assert((:'anon_read'::jsonb->>'hidden_claims')::int = 0 AND NOT (:'anon_read'::jsonb->>'hidden_text')::boolean
  AND (:'anon_read'::jsonb->>'orphan_claims')::int = 0 AND NOT (:'anon_read'::jsonb->>'orphan_text')::boolean
  AND (:'anon_read'::jsonb->>'not_shown')::int = 2, 'anon: no claim from the hidden photo; counted as not shown');
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT t_assert((SELECT (SELECT jsonb_agg(c ORDER BY c->>'claim_id') FROM jsonb_array_elements(b.j->'claims') c
                          WHERE c->'source'->>'image_id' IS DISTINCT FROM '30000000-0000-0000-0000-000000000003'
                            AND c->'source'->>'image_id' IS DISTINCT FROM '30000000-0000-0000-0000-000000000004')
                      = (SELECT jsonb_agg(c ORDER BY c->>'claim_id') FROM jsonb_array_elements(a.j->'claims') c)
                    AND b.j->'exclusions' || '{"image_claims_excluded_not_shown":2,"condition_candidates_beyond_cap":0}' = a.j->'exclusions'
                   FROM public.t_before b, (SELECT listing_work_plan_read('10000000-0000-0000-0000-000000000001') j) a),
  'anon: every other claim and exclusion as before (ids-first loop returns the same rows)');
SELECT t_assert((:'anon_read'::jsonb->>'shown_claims')::int >= 1 AND (:'anon_read'::jsonb->>'unattributed')::int = 1,
  'anon: the shown listing photo still yields its claim; the unrelated upload stays unattributed');
COMMIT;

BEGIN; SET LOCAL ROLE authenticated;
SELECT t_read('{"role":"authenticated","sub":"70000000-0000-0000-0000-000000000009"}') AS stranger_read \gset
SELECT t_assert((:'stranger_read'::jsonb->>'hidden_claims')::int = 0 AND (:'stranger_read'::jsonb->>'orphan_claims')::int = 0
  AND NOT (:'stranger_read'::jsonb->>'orphan_text')::boolean AND (:'stranger_read'::jsonb->>'not_shown')::int = 2,
  'stranger: no claim from either hidden photo, the NULL-uploader one included; both counted as not shown');
SELECT t_read('{"role":"authenticated","sub":"70000000-0000-0000-0000-000000000001"}') AS uploader_read \gset
SELECT t_assert((:'uploader_read'::jsonb->>'hidden_claims')::int = 1 AND (:'uploader_read'::jsonb->>'orphan_claims')::int = 0
  AND (:'uploader_read'::jsonb->>'not_shown')::int = 1, 'uploader: the hidden photo''s claim, not the NULL-uploader one''s');
SELECT t_read('{"role":"authenticated","sub":"70000000-0000-0000-0000-000000000002","tied_to":"10000000-0000-0000-0000-000000000001"}') AS tied_read \gset
SELECT t_assert((:'tied_read'::jsonb->>'hidden_claims')::int = 1 AND (:'tied_read'::jsonb->>'orphan_claims')::int = 1
  AND (:'tied_read'::jsonb->>'not_shown')::int = 0, 'tied viewer: both hidden photos'' claims');
COMMIT;

-- The candidate cap (rule row) and the walk order, on car 3 (900 candidates, 600 public).
SELECT t_assert((SELECT (config_value->>'condition_candidate_cap')::int = 2000 FROM platform_config WHERE config_key = 'listing_work_plan_read'),
  'rule row: condition_candidate_cap 2000');
SELECT t_assert((SELECT recorded_hash = '3af9ebbc1bebf423e3bd1e0b7c45a194' AND owner_lane = 'ta-policies' FROM private_row_policy_copies
                  WHERE reader = 'listing_work_plan_read(uuid)' AND relation = 'vehicle_images'), 'policy copy registered');
BEGIN; SET LOCAL ROLE anon;
SELECT t_big() AS big \gset
SELECT t_assert((:'big'::jsonb->>'fetched')::int = 500 AND (:'big'::jsonb->>'cap')::int = 2000 AND (:'big'::jsonb->>'beyond')::int = 0
  AND NOT (:'big'::jsonb->>'cap_gap')::boolean AND :'big'::jsonb->'refs' = :'before_big'::jsonb->'refs',
  'cap 2000: the same 500 rows, in the same id order, as the old body');
COMMIT;
UPDATE platform_config SET config_value = jsonb_set(config_value, '{condition_candidate_cap}', '600') WHERE config_key = 'listing_work_plan_read';
BEGIN; SET LOCAL ROLE anon;
SELECT t_big() AS big \gset
SELECT t_assert((:'big'::jsonb->>'fetched')::int = 400 AND (:'big'::jsonb->>'cap')::int = 600 AND (:'big'::jsonb->>'beyond')::int = 300
  AND (:'big'::jsonb->>'cap_gap')::boolean AND :'big'::jsonb->'refs' = t_first_public(400, 600),
  'cap 600: walks the first 600 ids only (400 public, in id order), counts the other 300 and names the gap');
COMMIT;
UPDATE platform_config SET config_value = jsonb_set(config_value, '{condition_candidate_cap}', '10') WHERE config_key = 'listing_work_plan_read';
BEGIN; SET LOCAL ROLE anon;
SELECT t_big() AS big \gset
SELECT t_assert((:'big'::jsonb->>'cap')::int = 500 AND (:'big'::jsonb->>'fetched')::int = 334 AND (:'big'::jsonb->>'beyond')::int = 400
  AND :'big'::jsonb->'refs' = t_first_public(334, 500), 'cap 10 in the row: bounded up to 500');
COMMIT;
UPDATE platform_config SET config_value = jsonb_set(config_value, '{condition_candidate_cap}', '"lots"') WHERE config_key = 'listing_work_plan_read';
BEGIN; SET LOCAL ROLE anon;
SELECT t_assert((t_big()->>'cap')::int = 2000, 'a malformed cap reads as 2000, never an error');
COMMIT;
DELETE FROM platform_config WHERE config_key = 'listing_work_plan_read';
BEGIN; SET LOCAL ROLE anon;
SELECT t_assert((t_big()->>'cap')::int = 2000 AND (t_big()->>'fetched')::int = 500, 'no rule row: 2000');
COMMIT;

BEGIN; SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT t_assert(t_refused($q$SELECT listing_work_plan_read('10000000-0000-0000-0000-000000000002')$q$), 'non-public vehicle still refused');
COMMIT;

INSERT INTO platform_config(config_key, config_value) VALUES ('listing_work_plan_read', '{"condition_candidate_cap":2000}');
\ir revert_20261125233000_listing_work_plan_shown_photos.sql
SELECT t_assert(NOT EXISTS (SELECT 1 FROM platform_config WHERE config_key = 'listing_work_plan_read')
  AND NOT EXISTS (SELECT 1 FROM private_row_policy_copies WHERE reader = 'listing_work_plan_read(uuid)'),
  'revert applies with the live-body md5 check and removes its rule row and policy-copy row');
