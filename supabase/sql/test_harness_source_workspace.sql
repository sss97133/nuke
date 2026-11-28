-- Disposable PG17 only. Reuse the existing source, visibility and actual v2
-- selection contracts, including split pieces, conflicting specs and open ends.
\set ON_ERROR_STOP on
\i supabase/sql/test_harness_component_requirements.sql

CREATE ROLE harness_source_reader_owner NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE,CREATE ON SCHEMA public TO harness_source_reader_owner;
SET ROLE harness_source_reader_owner;
\i supabase/migrations/20261127234705_harness_source_workspace_reader.sql
RESET ROLE;

SET timezone='UTC';
SELECT set_config('test.auth_uid','',false), set_config('test.auth_jwt','{}',false);
CREATE TEMP TABLE source_before AS SELECT md5(jsonb_build_object(
 'circuits',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.vehicle_custom_circuits c),
 'pieces',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.harness_segments s),
 'ends',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.wire_termination_specs t),
 'endpoints',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.harness_endpoints e))::text) digest;

SET ROLE anon;
DO $$
DECLARE r jsonb; again jsonb; m jsonb; raw jsonb;
  v uuid := 'e08bf694-970f-4cbe-8a74-8715158a0f2e';
BEGIN
 r:=public.harness_source_workspace(v);
 again:=public.harness_source_workspace(v);
 m:=public.harness_model_inputs(v)->'model'; raw:=public.harness_schematic_model(v);
 IF r->>'contract_version'<>'1' OR r->>'snapshot_kind'<>'current_read_not_published_revision'
  OR r->>'vehicle_id'<>v::text OR r#>>'{selection,owner}'<>'harness_model_inputs'
  OR r#>>'{selection,contract_version}'<>'2' OR r#>>'{selection,kind}'<>'decided_design'
 THEN RAISE EXCEPTION 'Wrong source workspace contract'; END IF;
 IF r->'source' IS DISTINCT FROM raw-'read_at' THEN RAISE EXCEPTION 'Source was rewritten or supplemented'; END IF;
 IF r#>'{selection,segment_ids}' IS DISTINCT FROM
  (SELECT coalesce(jsonb_agg(x->>'id' ORDER BY x->>'id'),'[]') FROM jsonb_array_elements(m->'segments') x)
  OR r#>'{selection,circuit_ids}' IS DISTINCT FROM
  (SELECT coalesce(jsonb_agg(x->>'id' ORDER BY x->>'id'),'[]') FROM jsonb_array_elements(m->'circuits') x)
 THEN RAISE EXCEPTION 'Workspace forked canonical membership'; END IF;
 IF r->>'snapshot_hash' IS DISTINCT FROM again->>'snapshot_hash'
  OR r->>'snapshot_hash' IS DISTINCT FROM md5((r-'read_at'-'snapshot_hash')::text)
 THEN RAISE EXCEPTION 'Source hash includes clock or omits returned content'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(r#>'{source,segments}') x
  WHERE x ?| ARRAY['current_circuit_id','in_current_plan','needs_revision','blockers'])
 THEN RAISE EXCEPTION 'Uninstalled material revision fields fabricated'; END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(r#>'{source,segments}') x
  WHERE x->>'circuit_code'='23' AND x->>'specification_state'='conflict')
 THEN RAISE EXCEPTION 'Recorded specification conflict lost'; END IF;
 IF public.harness_source_workspace('00000000-0000-0000-0000-00000000ff01') IS NOT NULL
  OR public.harness_source_workspace('00000000-0000-0000-0000-00000000ff02') IS NOT NULL
 THEN RAISE EXCEPTION 'Private, deleted or missing graph exposed'; END IF;
END $$;
RESET ROLE;

DO $$ BEGIN
 IF (SELECT digest FROM source_before) IS DISTINCT FROM md5(jsonb_build_object(
  'circuits',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.vehicle_custom_circuits c),
  'pieces',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.harness_segments s),
  'ends',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.wire_termination_specs t),
  'endpoints',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.harness_endpoints e))::text)
 THEN RAISE EXCEPTION 'Read changed physical source rows'; END IF;
 IF (SELECT prosecdef FROM pg_proc WHERE oid='public.harness_source_workspace(uuid)'::regprocedure)
 THEN RAISE EXCEPTION 'Wrapper bypasses source RLS'; END IF;
 IF EXISTS(SELECT FROM aclexplode((SELECT proacl FROM pg_proc
   WHERE oid='public.harness_source_workspace(uuid)'::regprocedure)) WHERE grantee=0)
 THEN RAISE EXCEPTION 'PUBLIC execute remains'; END IF;
END $$;

-- An actual source edit changes the complete content identity without forcing a
-- producer. A membership edit remains owned by harness_model_inputs.
BEGIN;
CREATE TEMP TABLE old_read AS SELECT public.harness_source_workspace('e08bf694-970f-4cbe-8a74-8715158a0f2e') r;
UPDATE public.harness_segments SET design_status='candidate'
 WHERE vehicle_custom_circuit_id='00000000-0000-0000-0000-000000000a01';
DO $$
DECLARE r jsonb:=public.harness_source_workspace('e08bf694-970f-4cbe-8a74-8715158a0f2e');
BEGIN
 IF r->>'snapshot_hash'=(SELECT o.r->>'snapshot_hash' FROM old_read o)
 THEN RAISE EXCEPTION 'Changed source did not invalidate content identity'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(r#>'{source,segments}') s
  WHERE s->>'circuit_code'='110' AND r#>'{selection,segment_ids}' ? (s->>'id'))
 THEN RAISE EXCEPTION 'Canonical removal ignored'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(r#>'{source,segments}') s WHERE s->>'circuit_code'='110')<>2
 THEN RAISE EXCEPTION 'Unselected physical history was dropped'; END IF;
END $$;
ROLLBACK;

INSERT INTO public.vehicles(id,is_public,user_id) VALUES
 ('00000000-0000-0000-0000-00000000fa01',false,'00000000-0000-0000-0000-00000000fa11');
SELECT set_config('test.auth_uid','00000000-0000-0000-0000-00000000fa11',false),
 set_config('test.auth_jwt','{"is_anonymous":true}',false);
SET ROLE authenticated;
DO $$ BEGIN
 IF public.harness_source_workspace('00000000-0000-0000-0000-00000000fa01') IS NOT NULL
 THEN RAISE EXCEPTION 'Anonymous owner claim bypassed model visibility'; END IF;
END $$;
RESET ROLE;
SELECT set_config('test.auth_jwt','{"is_anonymous":false}',false);
SET ROLE authenticated;
DO $$ BEGIN
 IF public.harness_source_workspace('00000000-0000-0000-0000-00000000fa01') IS NULL
 THEN RAISE EXCEPTION 'Legitimate owner could not read own source'; END IF;
END $$;
RESET ROLE;
UPDATE public.vehicles SET deleted_at=now() WHERE id='00000000-0000-0000-0000-00000000fa01';
SET ROLE authenticated;
DO $$ BEGIN
 IF public.harness_source_workspace('00000000-0000-0000-0000-00000000fa01') IS NOT NULL
 THEN RAISE EXCEPTION 'Deleted owner source exposed'; END IF;
END $$;
RESET ROLE;
SELECT set_config('test.auth_uid','',false),set_config('test.auth_jwt','{}',false);

-- Contract drift must withdraw the response, never select an invented subset.
BEGIN;
CREATE OR REPLACE FUNCTION public.harness_model_inputs(p_vehicle_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('model',jsonb_build_object(
 'contract_version',99,'vehicle_id',p_vehicle_id,'selection','decided_design','segments','[]'::jsonb,'circuits','[]'::jsonb)); $$;
DO $$ BEGIN
 BEGIN
  PERFORM public.harness_source_workspace('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  RAISE EXCEPTION 'Incompatible selection contract accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;
END $$;
ROLLBACK;

-- Existing RLS denials reach both providers; the wrapper never turns them into
-- privileged source records.
DROP POLICY "Public read for public vehicles" ON public.harness_segments;
CREATE POLICY source_workspace_deny_segments ON public.harness_segments FOR SELECT USING(false);
SET ROLE anon;
DO $$
DECLARE r jsonb:=public.harness_source_workspace('e08bf694-970f-4cbe-8a74-8715158a0f2e');
BEGIN
 IF jsonb_array_length(r#>'{source,segments}')<>0 OR jsonb_array_length(r#>'{selection,segment_ids}')<>0
 THEN RAISE EXCEPTION 'Source row security bypassed'; END IF;
END $$;
RESET ROLE;
SELECT 'test_harness_source_workspace: PASS' AS result;
