\set ON_ERROR_STOP on
-- Standalone core contract. Domain entry below is an explicit fixture signature,
-- not a substitute for the later real stock/build integration contracts.
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int<170000
 OR to_regclass('public.vehicle_observations') IS NOT NULL THEN RAISE EXCEPTION 'Requires empty disposable PG17'; END IF;
END $$;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('test.jwt',true),'')::jsonb,'{}'::jsonb) $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT auth.jwt()->>'role' $$;
GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon,authenticated,service_role;
CREATE TABLE public.vehicles(id uuid PRIMARY KEY);
CREATE TABLE public.observation_sources(id uuid PRIMARY KEY,slug text UNIQUE);
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY,source_id uuid REFERENCES public.observation_sources,source_identifier text,
 vehicle_id uuid REFERENCES public.vehicles(id),subject_type text,subject_id uuid,kind text,observed_at timestamptz,ingested_at timestamptz,
 observed_at_basis text,source_event_at timestamptz,source_event_time_precision text,content_text text,content_hash text,structured_data jsonb,
 submitted_by_user_id uuid,observer_raw jsonb,extraction_method text,confidence_score numeric,analysis_deferred boolean,
 is_superseded boolean DEFAULT false,superseded_by uuid REFERENCES public.vehicle_observations(id),superseded_at timestamptz);
INSERT INTO public.observation_sources VALUES('00000000-0000-0000-0000-000000000001','owner-input');
\i supabase/migrations/20261126005947_account_work_admission.sql
CREATE FUNCTION pg_temp.ok(v boolean,m text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION '%',m; END IF; END $$;
CREATE TABLE public.fixture_work_projection(id uuid PRIMARY KEY,observation_id uuid REFERENCES public.vehicle_observations(id));
CREATE FUNCTION public.record_parts_arrival(p_request uuid,p_input jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE observation uuid=gen_random_uuid(); subject uuid='00000000-0000-0000-0000-000000000010'; claim jsonb; result uuid;
BEGIN
 claim:=jsonb_build_object('profile','parts_arrival_sign_v1','lot_id',subject,'quantity',1,'unit','ea',
  'received_at','2026-11-24T10:00:00Z','quantity_basis','direct_count_or_measurement','inspection','not_implied','receipt_line_is_this_arrival',true);
 IF p_input ? 'extra_claim' THEN claim:=claim||jsonb_build_object('authority_override',true); END IF;
 result:=public.record_account_work(observation,coalesce(p_input->>'profile','parts_arrival_sign_v1'),p_request,subject,NULL,
  coalesce((p_input->>'performed_at')::timestamptz,'2026-11-24T10:00:00Z'),'reported_time','Synthetic counted arrival',claim,
  encode(sha256(convert_to(jsonb_build_array(p_request,p_input)::text,'UTF8')),'hex'));
 IF p_input->>'fail_projection'='true' THEN RAISE EXCEPTION 'Synthetic projection failure' USING ERRCODE='23514'; END IF;
 INSERT INTO public.fixture_work_projection VALUES(gen_random_uuid(),result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.record_parts_arrival(uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.record_parts_arrival(uuid,jsonb) TO authenticated;
GRANT SELECT ON public.vehicle_observations,public.fixture_work_projection TO authenticated;
CREATE FUNCTION public.undeclared_stock_wrapper(p_request uuid,p_claim jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN RETURN public.record_parts_arrival(p_request,p_claim); END $$;
CREATE FUNCTION public.undeclared_sql_wrapper(p_request uuid,p_claim jsonb) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT public.record_parts_arrival(p_request,p_claim) $$;
CREATE FUNCTION public.record_parts_arrival(p_request uuid,p_claim jsonb,p_unregistered_overload boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN RETURN public.record_account_work(gen_random_uuid(),'parts_arrival_sign_v1',p_request,gen_random_uuid(),NULL,
 '2026-11-24T10:00:00Z','reported_time','Synthetic invalid overload',p_claim,repeat('a',64)); END $$;
SELECT pg_temp.ok(NOT has_function_privilege('authenticated','public.record_account_work(uuid,text,uuid,uuid,uuid,timestamptz,text,text,jsonb,text)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.record_account_work(uuid,text,uuid,uuid,uuid,timestamptz,text,text,jsonb,text)','EXECUTE')
 AND NOT has_function_privilege('anon','public.record_account_work(uuid,text,uuid,uuid,uuid,timestamptz,text,text,jsonb,text)','EXECUTE'),
 'Canonical account work is private to declared domain writers');
SET ROLE authenticated;
SELECT set_config('test.uid','00000000-0000-0000-0000-000000000002',false),set_config('test.jwt','{"role":"authenticated","is_anonymous":false}',false);
SELECT public.record_parts_arrival(gen_random_uuid(),'{}');
DO $$ DECLARE refused boolean; before_n int; command text; expected text; BEGIN
 PERFORM pg_temp.ok((SELECT count(*) FROM public.vehicle_observations)=1 AND (SELECT count(*) FROM public.fixture_work_projection)=1,
  'Declared domain entry admits canonical source plus projection');
 PERFORM pg_temp.ok((SELECT confidence_score IS NULL AND submitted_by_user_id=auth.uid() AND ingested_at>=observed_at
  AND source_event_at=observed_at AND source_event_time_precision='exact' AND observer_raw->>'user_id'=auth.uid()::text
  FROM public.vehicle_observations),'Actor, event/receipt clocks and NULL confidence are server-derived');
 FOR command,expected IN SELECT * FROM (VALUES
  ('SELECT public.undeclared_stock_wrapper(gen_random_uuid(),''{}'')','Physical work cannot be signed through an undeclared wrapper'),
  ('SELECT public.undeclared_sql_wrapper(gen_random_uuid(),''{}'')','Physical work cannot be signed through an undeclared SQL wrapper'),
  ('SELECT public.record_parts_arrival(gen_random_uuid(),''{}'',true)','Physical work requires the exact declared writer signature')
 ) x(q,m) LOOP
  refused:=false;
  BEGIN EXECUTE command; EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM=expected THEN refused:=true; ELSE RAISE; END IF; END;
  PERFORM pg_temp.ok(refused,expected);
 END LOOP;
 FOR command IN SELECT * FROM (VALUES
  ('SELECT public.record_parts_arrival(gen_random_uuid(),''{"extra_claim":true}'')'),
  ('SELECT public.record_parts_arrival(gen_random_uuid(),''{"performed_at":"2999-01-01T00:00:00Z"}'')'),
  ('SELECT public.record_parts_arrival(gen_random_uuid(),''{"profile":"parts_stock_sign_v1"}'')'),
  ('SELECT public.record_parts_arrival(gen_random_uuid(),''{"profile":"arbitrary_work_record"}'')')
 ) x(q) LOOP
  refused:=false;
  BEGIN EXECUTE command; EXCEPTION WHEN check_violation OR insufficient_privilege THEN refused:=true; END;
  PERFORM pg_temp.ok(refused,'Wrong profile, extra authority claim or false clock refused');
 END LOOP;
 SELECT count(*) INTO before_n FROM public.vehicle_observations; refused:=false;
 BEGIN PERFORM public.record_parts_arrival(gen_random_uuid(),'{"fail_projection":true}');
 EXCEPTION WHEN check_violation THEN IF SQLERRM='Synthetic projection failure' THEN refused:=true; ELSE RAISE; END IF; END;
 PERFORM pg_temp.ok(refused AND (SELECT count(*) FROM public.vehicle_observations)=before_n
  AND (SELECT count(*) FROM public.fixture_work_projection)=1,'Source and domain projection roll back together');
END $$;
RESET ROLE;
-- Preserve completed fixtures in single-query PGlite as well as psql autocommit.
COMMIT;
BEGIN;
GRANT INSERT ON public.vehicle_observations TO authenticated,service_role;
SET LOCAL ROLE authenticated;
DO $$ DECLARE refused boolean=false; id uuid=gen_random_uuid(); BEGIN
 PERFORM set_config('nuke.account_work_admission',id::text,true);
 BEGIN
  INSERT INTO public.vehicle_observations(id,extraction_method,structured_data,submitted_by_user_id,kind,subject_type,subject_id)
  VALUES(id,'parts_arrival_sign_v1','{"profile":"parts_arrival_sign_v1"}',auth.uid(),'work_record','asset',gen_random_uuid());
 EXCEPTION WHEN insufficient_privilege THEN refused:=true; END;
 PERFORM pg_temp.ok(refused,'Authenticated generic insertion plus spoofed capability cannot sign stock');
END $$;
SET LOCAL ROLE service_role;
SELECT set_config('test.jwt','{"role":"service_role","is_anonymous":false}',true);
DO $$ DECLARE refused boolean=false; id uuid=gen_random_uuid(); BEGIN
 PERFORM set_config('nuke.account_work_admission',id::text,true);
 BEGIN
  INSERT INTO public.vehicle_observations(id,extraction_method,structured_data,submitted_by_user_id,kind,subject_type,subject_id)
  VALUES(id,'generic-ingest','{"contract":"harness_build_operation_v1"}',auth.uid(),'work_record','vehicle',NULL);
 EXCEPTION WHEN insufficient_privilege THEN refused:=true; END;
 PERFORM pg_temp.ok(refused,'Service cannot hide a reserved profile behind a generic method and owner uid');
END $$;
ROLLBACK;
SET ROLE authenticated;
SELECT set_config('test.jwt','{"role":"authenticated","is_anonymous":true}',false);
DO $$ DECLARE refused boolean=false; BEGIN
 BEGIN PERFORM public.record_parts_arrival(gen_random_uuid(),'{}'); EXCEPTION WHEN insufficient_privilege THEN refused:=true; END;
 PERFORM pg_temp.ok(refused,'Anonymous account cannot sign physical work');
END $$;
SELECT set_config('test.jwt','{"role":"service_role","is_anonymous":false}',false);
DO $$ DECLARE refused boolean=false; BEGIN
 BEGIN PERFORM public.record_parts_arrival(gen_random_uuid(),'{}'); EXCEPTION WHEN insufficient_privilege THEN refused:=true; END;
 PERFORM pg_temp.ok(refused,'Service claim cannot impersonate the authenticated signer');
END $$;
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.vehicle_observations)=1,'Negative requests left no canonical work sources');
INSERT INTO public.vehicle_observations(id,extraction_method,kind) VALUES(gen_random_uuid(),'unrelated_source_fixture','comment');
DO $$ DECLARE refused boolean; source uuid; BEGIN
 SELECT id INTO source FROM public.vehicle_observations WHERE extraction_method='parts_arrival_sign_v1';
 UPDATE public.vehicle_observations SET is_superseded=true,superseded_at=statement_timestamp() WHERE id=source;
 PERFORM pg_temp.ok((SELECT is_superseded AND superseded_at IS NOT NULL FROM public.vehicle_observations WHERE id=source),
  'Coherent withdrawal remains supported without rewriting original testimony');
 refused:=false;
 BEGIN UPDATE public.vehicle_observations SET is_superseded=false,superseded_at=NULL WHERE id=source;
 EXCEPTION WHEN check_violation THEN refused:=true; END;
 PERFORM pg_temp.ok(refused,'Retired work cannot silently become current again');
 refused:=false;
 BEGIN UPDATE public.vehicle_observations SET structured_data='{"contract":"harness_build_operation_v2"}' WHERE extraction_method='unrelated_source_fixture';
 EXCEPTION WHEN check_violation THEN refused:=true; END;
 PERFORM pg_temp.ok(refused,'A generic observation cannot acquire a reserved work contract through UPDATE');
 refused:=false;
 BEGIN UPDATE public.vehicle_observations SET content_text='Replacement assertion' WHERE id=source;
 EXCEPTION WHEN check_violation THEN refused:=true; END;
 PERFORM pg_temp.ok(refused,'Source assertion cannot be overwritten');
 refused:=false;
 BEGIN DELETE FROM public.vehicle_observations WHERE id=source;
 EXCEPTION WHEN check_violation THEN refused:=true; END;
 PERFORM pg_temp.ok(refused,'Physical source history cannot be deleted');
END $$;
SELECT 'account-work core: exact writer and SQL/PLpgSQL wrapper denial, actor, capability, clocks, scope and atomicity passed' AS result;
