-- Contract: 20261121230000 keeps automatic-tier photo readings (agent_tier 'subscription automatic') out of the readiness
-- condition score, the day receipt's reading, the visual-work keyed-value gate and the actor-link evidence items (five
-- readers), and keeps every reading with no tier or a reviewed tier counted. Observation counts are not changed by the
-- migration, because the count metric counts every attached row and a tier filter cannot be answered from the index.
-- Disposable PG17 only, synthetic rows only. The five readers are installed as production's bodies of 2026-11-21 (the
-- revert file carries them; check_function_bodies is off so that no table has to exist first, then each body runs against
-- minimal fixture tables), each behaviour is measured before the migration, the migration is applied, and the same calls
-- are measured again (also as the anonymous role, which cannot call the tier helper itself: the definer readers must).
-- Also checked: attributes and grants do not move, the migration is replayable, refuses a body that moved since (and
-- replaces none of the five), and its revert restores the earlier bodies and behaviour.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
    RAISE EXCEPTION 'Refusing fixtures outside a disposable database';
  END IF;
END $$;
SET statement_timeout = '120s';
SET lock_timeout = '3s';
SET TIME ZONE 'UTC';
SET check_function_bodies = off;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE FUNCTION public.t_assert(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

-- ===== the environment the readers use
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO PUBLIC;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT jsonb_build_object('role', nullif(current_setting('test.role', true), '')) $$;
CREATE TABLE public.platform_config(config_key text PRIMARY KEY, config_value jsonb NOT NULL);
ALTER TABLE public.platform_config ENABLE ROW LEVEL SECURITY;
INSERT INTO public.platform_config VALUES
 ('image_reading_tiers', '{"automatic": {"tier": "subscription automatic"}, "reviewed_tiers": ["caller-byok", "caller-byok subscription"]}');
-- Production's body (20261120140000) and grants: only the owner and service_role can call it.
CREATE FUNCTION public.image_reading_tier_is_automatic(p_tier text) RETURNS boolean
LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $$
  select coalesce(p_tier, '') <> '' and coalesce((select c.config_value -> 'automatic' ->> 'tier' = p_tier
                                                    from public.platform_config c where c.config_key = 'image_reading_tiers'), false) $$;
REVOKE EXECUTE ON FUNCTION public.image_reading_tier_is_automatic(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.image_reading_tier_is_automatic(text) TO service_role;

-- ===== fixture tables: the columns the five readers touch
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, make text, model text, year integer, vin text, color text, mileage integer,
 transmission text, condition_rating integer, sale_price integer, ownership_verified boolean, interior_color text,
 description text, title text, engine_type text, sold_price integer, highlights text, equipment text, modifications text,
 known_flaws text, title_status text, deal_score numeric(5,2), heat_score numeric(5,2), price_confidence text,
 canonical_sold_price numeric, is_public boolean, user_id uuid, owner_id uuid, uploaded_by uuid, deleted_at timestamptz);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, image_url text,
 thumbnail_url text, medium_url text, large_url text, variants jsonb, is_primary boolean, is_document boolean, position integer,
 created_at timestamptz DEFAULT now(), storage_path text, caption text, image_type text, category text, file_name text, source text,
 ai_scan_metadata jsonb, ai_processing_status text, vehicle_zone text, taken_at timestamptz, is_duplicate boolean,
 is_sensitive boolean, doc_flag boolean, is_superseded boolean, is_external boolean);
CREATE FUNCTION public.vehicle_image_gallery_eligible(public.vehicle_images) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, kind text, content_text text,
 structured_data jsonb, agent_tier text, agent_model text, is_superseded boolean NOT NULL DEFAULT false, descriptor_id uuid,
 property_id uuid, observed_at timestamptz DEFAULT now(), ingested_at timestamptz DEFAULT now(), submitted_by_user_id uuid);
CREATE TABLE public.observation_witnesses(observation_id uuid, image_id uuid);
CREATE TABLE public.vehicle_documents(vehicle_id uuid, uploaded_by uuid, privacy_level text, amount numeric, document_type text);
CREATE TABLE public.nuke_estimates(vehicle_id uuid, estimated_value numeric(12,2), confidence_score integer,
 deal_score numeric(5,2), heat_score numeric(5,2), input_count integer, calculated_at timestamptz);
CREATE TABLE public.analysis_signals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL, widget_slug text NOT NULL,
 score numeric(5,2), label text, severity text, value_json jsonb NOT NULL DEFAULT '{}'::jsonb, reasons text[] DEFAULT '{}'::text[],
 computed_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION public.check_mvps_zone_coverage(p_zones text[]) RETURNS TABLE(mvps_complete boolean, zones_missing text[])
LANGUAGE sql STABLE AS $$ SELECT false, ARRAY[]::text[] $$;
CREATE TABLE public.timeline_events(id uuid, vehicle_id uuid, event_type text, event_date timestamptz, created_at timestamptz);
DO $$ DECLARE c text; BEGIN
  FOREACH c IN ARRAY ARRAY['user_id','source','title','description','image_urls','metadata','updated_at','mileage_at_event','cost_amount',
   'cost_currency','duration_hours','location_name','location_address','service_provider_name','service_provider_type','invoice_number',
   'warranty_info','parts_used','is_insurance_claim','insurance_claim_number','next_service_due_date','next_service_due_mileage',
   'data_source','confidence_score','source_type','event_category','activity_type','automated_tags','manual_tags','receipt_data',
   'parts_mentioned','tools_mentioned','labor_hours','cost_estimate','organization_id','client_id','is_monetized','work_started',
   'work_completed','contract_id','applied_labor_rate','applied_shop_rate','rate_source','contextual_analysis_status','documented_by',
   'primary_technician','quality_rating','quality_justification','value_impact','ai_confidence_score','concerns',
   'industry_standard_comparison','work_order_id']
  LOOP EXECUTE format('ALTER TABLE public.timeline_events ADD COLUMN %I text', c); END LOOP;
END $$;
CREATE TABLE public.work_sessions(id uuid, user_id uuid, vehicle_id uuid, session_date date, title text, work_type text, image_count integer,
 duration_minutes integer, total_parts_cost numeric, total_labor_cost numeric, total_job_cost numeric, work_description text,
 status text, start_time timestamptz, end_time timestamptz, session_type text);
CREATE TABLE public.receipts(id uuid, user_id uuid, vendor_name text, total_amount numeric, vehicle_id uuid, transaction_date date,
 purchase_date date, receipt_date date);
CREATE TABLE public.organization_contributors(organization_id uuid, user_id uuid, status text);
CREATE TABLE public.organizations(id uuid, is_verified boolean, business_name text, name text);
CREATE TABLE public.component_events(id uuid, vehicle_id uuid, event_date timestamptz, org_id uuid, evidence_ids uuid[], actor_id uuid);
CREATE TABLE public.work_orders(id uuid, vehicle_id uuid, started_at timestamptz, actual_start timestamptz, created_at timestamptz,
 completed_at timestamptz, actual_end timestamptz, organization_id uuid);
CREATE TABLE public.work_order_line_items(id uuid, work_order_id uuid, actor_id uuid, component_event_id uuid, source_observation_id uuid);
CREATE TABLE public.account_link_claims(id uuid, user_id uuid, actor_id uuid, status text, verification_method text, created_at timestamptz);
CREATE TABLE public.admin_users(user_id uuid, is_active boolean);
CREATE FUNCTION public.platform_actor_label(uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'actor' $$;

-- ===== production's earlier bodies, installed by the revert file (a function that is absent is created)
\ir revert_20261121230000_thin_readings_out_of_scores.sql
RESET check_function_bodies;
GRANT EXECUTE ON FUNCTION public.compute_auction_readiness(uuid), public.get_user_day_receipt(uuid, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.actor_link_claim_evidence_read(uuid) TO authenticated;

CREATE FUNCTION public.t_md5(fn text) RETURNS text LANGUAGE sql AS $$ SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure(fn) $$;
CREATE FUNCTION public.t_marks(fn text) RETURNS int LANGUAGE sql AS $$
  SELECT ((length(d) - length(replace(d, '(20261121230000)', ''))) / length('(20261121230000)'))::int
    FROM (SELECT pg_get_functiondef(to_regprocedure(fn)) d) x $$;
-- Everything about each reader except its body: the migration must leave all of it as it is.
CREATE FUNCTION public.t_attrs() RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(concat_ws('|', p.oid::regprocedure::text, pg_get_userbyid(p.proowner), p.prosecdef, p.provolatile, p.prorettype::regtype,
           p.proconfig, p.proacl, p.proretset, p.prolang::regclass), E'\n' ORDER BY p.oid::regprocedure::text)
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('compute_auction_readiness', 'get_user_day_receipt',
      'visual_work_uncited_keyed_photos', 'actor_link_evidence_items', 'actor_link_claim_evidence_read') $$;
CREATE TABLE public.t_pins AS SELECT public.t_attrs() AS attrs;
SELECT public.t_assert(
  public.t_md5('public.compute_auction_readiness(uuid)') = '19ee0abbfe2d3de7ee225c5df90acc67'
  AND public.t_md5('public.get_user_day_receipt(uuid,date)') = 'cf19cf335b9d08fddc47f6329e203a0e'
  AND public.t_md5('public.visual_work_uncited_keyed_photos(uuid,jsonb)') = '9bd9bf992a8b97f8a03dd6e26183a4bd'
  AND public.t_md5('public.actor_link_evidence_items(uuid,uuid)') = 'cad427c36ad728e4e72f7da892c043ef'
  AND public.t_md5('public.actor_link_claim_evidence_read(uuid)') = '20007b3f1fde0d6110020aca494c76d2',
  'fixture: the five readers are production''s bodies of 2026-11-21');
SELECT public.t_assert(NOT has_function_privilege('anon', 'public.image_reading_tier_is_automatic(text)', 'EXECUTE'),
  'fixture: the anonymous role cannot call the tier helper itself, as in production');

-- ===== rows. Tiers: automatic = 'subscription automatic'; reviewed = 'caller-byok subscription'; legacy = no tier.
INSERT INTO public.vehicles(id, is_public, user_id, ownership_verified) VALUES
 ('a0000000-0000-0000-0000-000000000001', true, '10000000-0000-0000-0000-000000000001', false),  -- only automatic readings
 ('a0000000-0000-0000-0000-000000000002', true, '10000000-0000-0000-0000-000000000001', false),  -- one legacy reading
 ('a0000000-0000-0000-0000-000000000003', true, '10000000-0000-0000-0000-000000000001', false),  -- one reviewed reading
 ('a0000000-0000-0000-0000-000000000004', true, '10000000-0000-0000-0000-000000000001', false),  -- one superseded legacy reading
 ('a0000000-0000-0000-0000-000000000005', true, '10000000-0000-0000-0000-000000000001', false),  -- automatic and reviewed
 ('a0000000-0000-0000-0000-000000000006', true, '10000000-0000-0000-0000-000000000001', false);  -- no condition rows
INSERT INTO public.vehicle_observations(vehicle_id, kind, agent_tier, is_superseded) VALUES
 ('a0000000-0000-0000-0000-000000000001', 'condition', 'subscription automatic', false),
 ('a0000000-0000-0000-0000-000000000001', 'condition', 'subscription automatic', false),
 ('a0000000-0000-0000-0000-000000000002', 'condition', NULL, false),
 ('a0000000-0000-0000-0000-000000000003', 'condition', 'caller-byok subscription', false),
 ('a0000000-0000-0000-0000-000000000004', 'condition', NULL, true),
 ('a0000000-0000-0000-0000-000000000005', 'condition', 'subscription automatic', false),
 ('a0000000-0000-0000-0000-000000000005', 'condition', 'caller-byok subscription', false);

CREATE FUNCTION public.t_cond(v int) RETURNS int LANGUAGE sql AS
$$ SELECT (public.compute_auction_readiness(('a0000000-0000-0000-0000-00000000000' || v)::uuid) ->> 'condition_score')::int $$;
-- ===== 2. get_user_day_receipt: the reading shown for each photo of one day. Photo a: automatic only; b: reviewed only;
-- c: legacy only; d: reviewed, then a newer automatic; e: a superseded reviewed reading only.
INSERT INTO public.vehicles(id, is_public, user_id) VALUES
 ('a0000000-0000-0000-0000-000000000007', true, '20000000-0000-0000-0000-000000000002'),
 ('a0000000-0000-0000-0000-000000000008', true, '10000000-0000-0000-0000-000000000001'),
 ('a0000000-0000-0000-0000-000000000009', true, '10000000-0000-0000-0000-000000000001'),
 ('a0000000-0000-0000-0000-00000000000a', true, '10000000-0000-0000-0000-000000000001'),
 ('a0000000-0000-0000-0000-00000000000b', true, '10000000-0000-0000-0000-000000000001');
INSERT INTO public.vehicle_images(id, vehicle_id, user_id, image_url, file_name, taken_at, is_external)
SELECT ('b1000000-0000-0000-0000-00000000000' || n)::uuid, 'a0000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000002',
       'https://img.example/' || n || '.jpg', n, '2026-10-01 10:00+00'::timestamptz + (i || ' minutes')::interval, false
FROM unnest(ARRAY['a','b','c','d','e']) WITH ORDINALITY AS t(n, i);
INSERT INTO public.vehicle_observations(vehicle_id, kind, agent_tier, agent_model, is_superseded, ingested_at, structured_data) VALUES
 ('a0000000-0000-0000-0000-000000000007', 'condition', 'subscription automatic', 'm1', false, '2026-10-05',
  '{"analysis_kind":"image_deep_byok","image_id":"b1000000-0000-0000-0000-00000000000a","narrative_one_line":"auto"}'),
 ('a0000000-0000-0000-0000-000000000007', 'condition', 'caller-byok subscription', 'm1', false, '2026-10-05',
  '{"analysis_kind":"image_deep_byok","image_id":"b1000000-0000-0000-0000-00000000000b","narrative_one_line":"rev"}'),
 ('a0000000-0000-0000-0000-000000000007', 'condition', NULL, 'm1', false, '2026-10-05',
  '{"analysis_kind":"image_deep_byok","image_id":"b1000000-0000-0000-0000-00000000000c","narrative_one_line":"leg"}'),
 ('a0000000-0000-0000-0000-000000000007', 'condition', 'caller-byok subscription', 'm1', false, '2026-10-05',
  '{"analysis_kind":"image_deep_byok","image_id":"b1000000-0000-0000-0000-00000000000d","narrative_one_line":"rev"}'),
 ('a0000000-0000-0000-0000-000000000007', 'condition', 'subscription automatic', 'm1', false, '2026-10-06',
  '{"analysis_kind":"image_deep_byok","image_id":"b1000000-0000-0000-0000-00000000000d","narrative_one_line":"auto"}'),
 ('a0000000-0000-0000-0000-000000000007', 'condition', 'caller-byok subscription', 'm1', true, '2026-10-05',
  '{"analysis_kind":"image_deep_byok","image_id":"b1000000-0000-0000-0000-00000000000e","narrative_one_line":"rev"}');

-- ===== 3. visual_work_uncited_keyed_photos: three photos each witnessed by one keyed value (automatic, legacy, reviewed),
-- cited by a work record with no claim ids named.
INSERT INTO public.vehicle_observations(vehicle_id, kind, agent_tier, property_id, structured_data) VALUES
 ('a0000000-0000-0000-0000-000000000008', 'condition', 'subscription automatic', gen_random_uuid(), '{"image_id":"c1000000-0000-0000-0000-000000000001"}'),
 ('a0000000-0000-0000-0000-000000000008', 'condition', NULL, gen_random_uuid(), '{"image_id":"c1000000-0000-0000-0000-000000000002"}'),
 ('a0000000-0000-0000-0000-000000000008', 'condition', 'caller-byok subscription', gen_random_uuid(), '{"image_id":"c1000000-0000-0000-0000-000000000003"}');
INSERT INTO public.observation_witnesses(observation_id, image_id)
SELECT id, (structured_data ->> 'image_id')::uuid FROM public.vehicle_observations WHERE vehicle_id = 'a0000000-0000-0000-0000-000000000008';
CREATE FUNCTION public.t_visual() RETURNS text LANGUAGE sql AS $$
  SELECT array_to_string(ARRAY(SELECT right(x, 2) FROM unnest(public.visual_work_uncited_keyed_photos('a0000000-0000-0000-0000-000000000008',
    jsonb_build_object('visual_sources', jsonb_build_array(
      jsonb_build_object('image_id', 'c1000000-0000-0000-0000-000000000001'),
      jsonb_build_object('image_id', 'c1000000-0000-0000-0000-000000000002'),
      jsonb_build_object('image_id', 'c1000000-0000-0000-0000-000000000003'))))) x ORDER BY x), ',') $$;

-- ===== 4. actor-link evidence: one component event of the actor on one day, the claimant's three photos of that day with an
-- automatic, a reviewed and a legacy reading.
INSERT INTO public.component_events(id, vehicle_id, event_date, actor_id)
  VALUES (gen_random_uuid(), 'a0000000-0000-0000-0000-00000000000b', '2026-10-01 12:00+00', '40000000-0000-0000-0000-000000000001');
INSERT INTO public.account_link_claims VALUES ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001', 'pending', 'photo', now());
INSERT INTO public.vehicle_images(id, vehicle_id, user_id, image_url, taken_at, is_external)
SELECT ('d1000000-0000-0000-0000-00000000000' || n)::uuid, 'a0000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-000000000001',
       'https://img.example/d' || n || '.jpg', '2026-10-01 11:00+00'::timestamptz + (n || ' minutes')::interval, false
FROM generate_series(1, 3) n;
INSERT INTO public.vehicle_observations(vehicle_id, kind, agent_tier, structured_data) VALUES
 ('a0000000-0000-0000-0000-00000000000b', 'condition', 'subscription automatic', '{"analysis_kind":"image_deep_byok","image_id":"d1000000-0000-0000-0000-000000000001"}'),
 ('a0000000-0000-0000-0000-00000000000b', 'condition', 'caller-byok subscription', '{"analysis_kind":"image_deep_byok","image_id":"d1000000-0000-0000-0000-000000000002"}'),
 ('a0000000-0000-0000-0000-00000000000b', 'condition', NULL, '{"analysis_kind":"image_deep_byok","image_id":"d1000000-0000-0000-0000-000000000003"}');

-- ===== the measurements. The anonymous set is what anon can execute in production; the rest runs as the owner of the data.
CREATE TABLE public.t_got(step text, k text, v text);
GRANT INSERT ON public.t_got TO anon;
CREATE FUNCTION public.t_narr(p_owner boolean) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  PERFORM set_config('test.uid', CASE WHEN p_owner THEN '20000000-0000-0000-0000-000000000002' ELSE '' END, false);
  SELECT string_agg(e ->> 'file_name' || '=' || coalesce(e ->> 'narrative', '-'), ',' ORDER BY e ->> 'file_name') INTO r
    FROM jsonb_array_elements(public.get_user_day_receipt('20000000-0000-0000-0000-000000000002', '2026-10-01') -> 'photos') e;
  PERFORM set_config('test.uid', '', false);
  RETURN r;
END $$;
CREATE FUNCTION public.t_m_anon(p_step text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.t_got SELECT p_step, 'cond', string_agg(public.t_cond(i)::text, ',' ORDER BY i) FROM generate_series(1, 6) i;
  INSERT INTO public.t_got VALUES (p_step, 'narr_public', public.t_narr(false));
END $$;
CREATE FUNCTION public.t_m_priv(p_step text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c jsonb;
BEGIN
  INSERT INTO public.t_got VALUES (p_step, 'narr_owner', public.t_narr(true)), (p_step, 'visual', public.t_visual()),
    (p_step, 'items', (SELECT count(*) FROM jsonb_array_elements(public.actor_link_evidence_items('30000000-0000-0000-0000-000000000001',
        '40000000-0000-0000-0000-000000000001')) e WHERE e ->> 'kind' = 'observation')::text);
  PERFORM set_config('test.role', 'service_role', false);
  c := public.actor_link_claim_evidence_read('50000000-0000-0000-0000-000000000001');
  PERFORM set_config('test.role', '', false);
  INSERT INTO public.t_got VALUES (p_step, 'claim_service', c #>> '{counts,by_kind,observation}');
  PERFORM set_config('test.uid', '30000000-0000-0000-0000-000000000001', false);
  c := public.actor_link_claim_evidence_read('50000000-0000-0000-0000-000000000001');
  PERFORM set_config('test.uid', '', false);
  INSERT INTO public.t_got VALUES (p_step, 'claim_claimant', c #>> '{counts,by_kind,observation}');
END $$;
CREATE FUNCTION public.t_v(p_step text, p_k text) RETURNS text LANGUAGE sql AS $$ SELECT v FROM public.t_got WHERE step = p_step AND k = p_k $$;

SELECT public.t_m_anon('before');
SELECT public.t_m_priv('before');
SELECT public.t_assert(public.t_v('before', 'cond') = '60,60,60,60,60,5', 'before: automatic-only and superseded-only cars score a condition observation (60 against the 5 of none)');
SELECT public.t_assert(public.t_v('before', 'narr_owner') = 'a=auto,b=rev,c=leg,d=auto,e=rev' AND public.t_v('before', 'narr_public') = public.t_v('before', 'narr_owner'),
  'before: the day receipt shows an automatic reading, and a newer automatic reading hides the reviewed one');
SELECT public.t_assert(public.t_v('before', 'visual') = '01,02,03', 'before: the automatic keyed value is a claim a work record must cite');
SELECT public.t_assert(public.t_v('before', 'items') = '3' AND public.t_v('before', 'claim_service') = '3' AND public.t_v('before', 'claim_claimant') = '3',
  'before: an automatic reading is a corroborating evidence item');

-- ===== the migration
\ir ../migrations/20261121230000_thin_readings_out_of_scores.sql

SELECT public.t_m_anon('after');
SELECT public.t_m_priv('after');
GRANT EXECUTE ON FUNCTION public.t_m_anon(text), public.t_cond(int), public.t_narr(boolean) TO anon;
SET ROLE anon;
SELECT public.t_m_anon('after as anon');
RESET ROLE;
SELECT public.t_assert(public.t_v('after', 'cond') = '5,60,60,5,60,5', 'after: an automatic or superseded reading adds nothing to the condition score; a legacy, reviewed or mixed car still scores 60');
SELECT public.t_assert(public.t_v('after', 'narr_owner') = 'a=-,b=rev,c=leg,d=rev,e=-' AND public.t_v('after', 'narr_public') = public.t_v('after', 'narr_owner'),
  'after: the day receipt shows no automatic or superseded reading, and the reviewed reading shows again');
SELECT public.t_assert(public.t_v('after', 'visual') = '02,03', 'after: an automatic keyed value is not a claim to cite; legacy and reviewed ones still are');
SELECT public.t_assert(public.t_v('after', 'items') = '2' AND public.t_v('after', 'claim_service') = '2' AND public.t_v('after', 'claim_claimant') = '2',
  'after: an automatic reading is no evidence item; legacy and reviewed readings still are');
SELECT public.t_assert((SELECT count(*) = 2 AND bool_and(a.v = b.v) FROM public.t_got a JOIN public.t_got b ON a.k = b.k AND a.step = 'after' AND b.step = 'after as anon'),
  'after, called as the anonymous role: the same numbers (the definer readers run with their owner''s rights)');

-- Nothing but the bodies moved.
SELECT public.t_assert(public.t_attrs() = (SELECT attrs FROM public.t_pins), 'owner, grants, security setting, volatility, SET clauses and return types are unchanged');
SELECT public.t_assert(public.t_md5('public.compute_auction_readiness(uuid)') = '2a2a4c3a2b9f6d9cf2f7f6087030241e'
  AND public.t_md5('public.get_user_day_receipt(uuid,date)') = 'da8b99c06758ca0da01b10e37ac4b287'
  AND public.t_md5('public.visual_work_uncited_keyed_photos(uuid,jsonb)') = 'a24c91a7d581e8b07bde8287f56b8990'
  AND public.t_md5('public.actor_link_evidence_items(uuid,uuid)') = 'a54d40ff87799efaa1e028ed40cd281b'
  AND public.t_md5('public.actor_link_claim_evidence_read(uuid)') = '6046dc96ab23882d632a5a29748ffbf4',
  'the five readers are the bodies the migration names');
SELECT public.t_assert(public.t_marks('public.compute_auction_readiness(uuid)') = 1 AND public.t_marks('public.get_user_day_receipt(uuid,date)') = 1
  AND public.t_marks('public.visual_work_uncited_keyed_photos(uuid,jsonb)') = 1 AND public.t_marks('public.actor_link_evidence_items(uuid,uuid)') = 1
  AND public.t_marks('public.actor_link_claim_evidence_read(uuid)') = 1,
  'each reader carries its one marker line');

-- ===== with the tiers row missing nothing is automatic, so the readers count every reading as before
BEGIN;
DELETE FROM public.platform_config WHERE config_key = 'image_reading_tiers';
SELECT public.t_assert(public.t_cond(1) = 60 AND public.t_visual() = '01,02,03'
  AND (SELECT count(*) FROM jsonb_array_elements(public.actor_link_evidence_items('30000000-0000-0000-0000-000000000001',
        '40000000-0000-0000-0000-000000000001')) e WHERE e ->> 'kind' = 'observation') = 3, 'tiers row missing: nothing is hidden');
ROLLBACK;

-- ===== replay: nothing moves
CREATE FUNCTION public.t_all_md5() RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(public.t_md5(oid::regprocedure::text), ',' ORDER BY oid::regprocedure::text) FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname IN ('compute_auction_readiness', 'get_user_day_receipt',
   'visual_work_uncited_keyed_photos', 'actor_link_evidence_items', 'actor_link_claim_evidence_read') $$;
CREATE TABLE public.t_md5_after AS SELECT public.t_all_md5() AS m;
\ir ../migrations/20261121230000_thin_readings_out_of_scores.sql
SELECT public.t_assert((SELECT m FROM public.t_md5_after) = public.t_all_md5(), 'replay: every body is left as it is');

-- ===== revert: production's earlier bodies, attributes unchanged
\ir revert_20261121230000_thin_readings_out_of_scores.sql
SELECT public.t_assert(public.t_md5('public.compute_auction_readiness(uuid)') = '19ee0abbfe2d3de7ee225c5df90acc67'
  AND public.t_md5('public.get_user_day_receipt(uuid,date)') = 'cf19cf335b9d08fddc47f6329e203a0e'
  AND public.t_md5('public.visual_work_uncited_keyed_photos(uuid,jsonb)') = '9bd9bf992a8b97f8a03dd6e26183a4bd'
  AND public.t_md5('public.actor_link_evidence_items(uuid,uuid)') = 'cad427c36ad728e4e72f7da892c043ef'
  AND public.t_md5('public.actor_link_claim_evidence_read(uuid)') = '20007b3f1fde0d6110020aca494c76d2'
  AND public.t_attrs() = (SELECT attrs FROM public.t_pins), 'revert: the earlier bodies, attributes unchanged');
SELECT public.t_m_anon('reverted');
SELECT public.t_m_priv('reverted');
SELECT public.t_assert((SELECT count(*) = 7 AND bool_and(a.v = b.v) FROM public.t_got a JOIN public.t_got b ON a.k = b.k AND a.step = 'reverted' AND b.step = 'before')
  AND public.t_v('reverted', 'visual') = '01,02,03', 'revert: the earlier behaviour of all five readers is back');

-- ===== refused: a reader that moved since the migration was written (the others are not replaced either)
CREATE TABLE public.t_def AS SELECT pg_get_functiondef('public.visual_work_uncited_keyed_photos(uuid,jsonb)'::regprocedure) AS def;
DO $$ BEGIN
  EXECUTE replace((SELECT def FROM public.t_def), 'ORDER BY r.image_id)', 'ORDER BY r.image_id DESC)');
END $$;
CREATE TABLE public.t_moved AS SELECT public.t_md5('public.visual_work_uncited_keyed_photos(uuid,jsonb)') AS m;
SELECT public.t_assert((SELECT m FROM public.t_moved) <> '9bd9bf992a8b97f8a03dd6e26183a4bd', 'fixture: the reader has moved');
\set ON_ERROR_STOP off
\ir ../migrations/20261121230000_thin_readings_out_of_scores.sql
\set ON_ERROR_STOP on
SELECT public.t_assert(public.t_md5('public.visual_work_uncited_keyed_photos(uuid,jsonb)') = (SELECT m FROM public.t_moved)
  AND public.t_md5('public.compute_auction_readiness(uuid)') = '19ee0abbfe2d3de7ee225c5df90acc67'
  AND public.t_md5('public.get_user_day_receipt(uuid,date)') = 'cf19cf335b9d08fddc47f6329e203a0e'
  AND public.t_md5('public.actor_link_evidence_items(uuid,uuid)') = 'cad427c36ad728e4e72f7da892c043ef'
  AND public.t_md5('public.actor_link_claim_evidence_read(uuid)') = '20007b3f1fde0d6110020aca494c76d2',
  'refused: a moved reader is not overwritten and the refusal takes the other four readers with it');
DO $$ BEGIN EXECUTE (SELECT def FROM public.t_def); END $$;

-- ===== applied again from the reverted state: the same bodies
\ir ../migrations/20261121230000_thin_readings_out_of_scores.sql
SELECT public.t_assert((SELECT m FROM public.t_md5_after) = public.t_all_md5(), 'applied again from the reverted state: the same bodies');
