-- Fresh disposable PostgreSQL17 only; canonical fixtures and established tests.
\set ON_ERROR_STOP on
\i supabase/sql/test_harness_component_requirements.sql

CREATE ROLE harness_source_layout_owner NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE,CREATE ON SCHEMA public TO harness_source_layout_owner;
ALTER FUNCTION public.harness_manual_compute(jsonb,jsonb) OWNER TO harness_source_layout_owner;
SET ROLE harness_source_layout_owner;
\i supabase/migrations/20261127234705_harness_source_workspace_reader.sql
RESET ROLE;
SET timezone='UTC';
SELECT set_config('test.auth_uid','',false),set_config('test.auth_jwt','{}',false);
DO $$ BEGIN
 IF public.harness_model_fold('e08bf694-970f-4cbe-8a74-8715158a0f2e')->>'status'<>'current'
 THEN RAISE EXCEPTION 'Pre-change evaluated fixture is not current'; END IF;
END $$;

CREATE TEMP TABLE layout_before AS
SELECT public.harness_manual_compute(i,'{}'::jsonb) AS expected,
 public.harness_source_workspace('e08bf694-970f-4cbe-8a74-8715158a0f2e') AS old_source
FROM (SELECT public.harness_model_inputs('e08bf694-970f-4cbe-8a74-8715158a0f2e') i) q;
GRANT SELECT ON layout_before TO anon;
SET ROLE harness_source_layout_owner;
\i supabase/migrations/20261128012734_harness_source_manual_layout.sql
RESET ROLE;

SET ROLE anon;
DO $$
DECLARE r jsonb; again jsonb; layout jsonb; old jsonb; expected jsonb;
 v uuid:='e08bf694-970f-4cbe-8a74-8715158a0f2e';
BEGIN
 SELECT old_source,b.expected INTO old,expected FROM layout_before b;
 r:=public.harness_source_workspace(v); again:=public.harness_source_workspace(v);
 IF coalesce((public.harness_manual_index(v)->>'current')::boolean,false)
 THEN RAISE EXCEPTION 'Helper code change left old evaluated sheets current'; END IF;
 layout:=r->'manual_layout';
 IF layout->>'owner'<>'harness_manual_compute' OR layout->>'contract_version'<>'1'
  OR layout->>'kind'<>'current_source_presentation_not_evaluated'
  OR layout-'owner'-'contract_version'-'kind' IS DISTINCT FROM expected
 THEN RAISE EXCEPTION 'Source sheets diverged from existing presentation owner'; END IF;
 IF r->'source' IS DISTINCT FROM old->'source' OR r->'selection' IS DISTINCT FROM old->'selection'
 THEN RAISE EXCEPTION 'Layout changed source data or canonical selection'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(layout->'sheets') s
   WHERE (s->>'piece_count')::integer NOT BETWEEN 1 AND 8)
  OR (SELECT coalesce(jsonb_agg(m->>'segment_id' ORDER BY m->>'segment_id'),'[]')
    FROM jsonb_array_elements(layout->'members') m) IS DISTINCT FROM r#>'{selection,segment_ids}'
  OR EXISTS(SELECT FROM jsonb_array_elements(layout->'members') m GROUP BY m->>'segment_id' HAVING count(*)<>1)
 THEN RAISE EXCEPTION 'Manual omitted, repeated or overpacked a selected physical piece'; END IF;
 IF layout->'ends'<>'[]'::jsonb OR layout ? 'electrical_nodes' OR layout ? 'evaluation'
 THEN RAISE EXCEPTION 'Source layout invented evaluated electrical addresses'; END IF;
 IF r->>'snapshot_hash' IS DISTINCT FROM md5((r-'snapshot_hash'-'read_at')::text)
  OR r->>'snapshot_hash' IS DISTINCT FROM again->>'snapshot_hash'
  OR r->>'snapshot_hash'=old->>'snapshot_hash'
 THEN RAISE EXCEPTION 'Content identity omitted layout or included read clock'; END IF;
END $$;

-- Pure supplied-data computation has no access to hidden records. Empty supplied
-- data must stay empty, even when the vehicle ID names a real public harness.
DO $$
DECLARE r jsonb;
BEGIN
 r:=public.harness_manual_compute(jsonb_build_object('model',jsonb_build_object(
   'vehicle_id','e08bf694-970f-4cbe-8a74-8715158a0f2e')),'{}');
 IF r<>jsonb_build_object('sheets','[]'::jsonb,'members','[]'::jsonb,'ends','[]'::jsonb)
 THEN RAISE EXCEPTION 'Pure helper looked up hidden source data'; END IF;
 BEGIN
  PERFORM public.harness_manual_compute(jsonb_build_object('model',jsonb_build_object(
   'segments',jsonb_build_array(jsonb_build_object('id','same'),jsonb_build_object('id','same')))),'{}');
  RAISE EXCEPTION 'Duplicate piece keys accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM public.harness_manual_compute('{"model":{"endpoints":[{}]}}','{}');
  RAISE EXCEPTION 'Missing source keys accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM public.harness_manual_compute('{"model":{"circuits":{}}}','{}');
  RAISE EXCEPTION 'Object in array position accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM public.harness_manual_compute(jsonb_build_object('model',jsonb_build_object(
    'segments',(SELECT jsonb_agg(jsonb_build_object('id',n)) FROM generate_series(1,8193) n))),'{}');
  RAISE EXCEPTION 'Oversized collection accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM public.harness_manual_compute(jsonb_build_object('model',jsonb_build_object('padding',repeat('x',8388609))),'{}');
  RAISE EXCEPTION 'Oversized serialized input accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM public.harness_manual_compute('{}',jsonb_build_object('segment_ends',
    (SELECT jsonb_agg(jsonb_build_object('id',n)) FROM generate_series(1,16385) n)));
  RAISE EXCEPTION 'Oversized result addresses accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 -- Large unrelated evaluation/rule payloads never affect the presentation query.
 IF public.harness_manual_compute(jsonb_build_object('unrelated_rules',repeat('x',8388609)),
   jsonb_build_object('unrelated_checks',repeat('x',8388609)))
  <>jsonb_build_object('sheets','[]'::jsonb,'members','[]'::jsonb,'ends','[]'::jsonb)
 THEN RAISE EXCEPTION 'Unrelated producer fields consumed layout budget'; END IF;
END $$;
RESET ROLE;

DO $$ BEGIN
 IF (SELECT old_source->'source' FROM layout_before) IS DISTINCT FROM
   public.harness_schematic_model('e08bf694-970f-4cbe-8a74-8715158a0f2e')-'read_at'
 THEN RAISE EXCEPTION 'Source rows changed during pure layout reads'; END IF;
 IF EXISTS(SELECT FROM pg_proc WHERE oid IN('public.harness_manual_compute(jsonb,jsonb)'::regprocedure,
  'public.harness_source_workspace(uuid)'::regprocedure) AND prosecdef)
  OR (SELECT provolatile FROM pg_proc WHERE oid='public.harness_manual_compute(jsonb,jsonb)'::regprocedure)<>'i'
  OR EXISTS(SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
   WHERE p.oid IN('public.harness_manual_compute(jsonb,jsonb)'::regprocedure,
   'public.harness_source_workspace(uuid)'::regprocedure) AND a.grantee=0)
 THEN RAISE EXCEPTION 'Presentation privileges or volatility widened beyond explicit contract'; END IF;
END $$;

-- Real source change updates read/layout identity without a producer call.
BEGIN;
CREATE TEMP TABLE layout_old AS SELECT public.harness_source_workspace('e08bf694-970f-4cbe-8a74-8715158a0f2e') r;
UPDATE public.harness_segments SET design_status='candidate'
 WHERE vehicle_custom_circuit_id='00000000-0000-0000-0000-000000000a01';
SET ROLE anon;
DO $$
DECLARE r jsonb:=public.harness_source_workspace('e08bf694-970f-4cbe-8a74-8715158a0f2e');
BEGIN
 IF EXISTS(SELECT FROM jsonb_array_elements(r#>'{manual_layout,members}') m
  JOIN jsonb_array_elements(r#>'{source,segments}') s ON s->>'id'=m->>'segment_id'
  WHERE s->>'circuit_code'='110') THEN RAISE EXCEPTION 'New source selection did not remove old sheet pieces'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT r->>'snapshot_hash' FROM layout_old)=
  public.harness_source_workspace('e08bf694-970f-4cbe-8a74-8715158a0f2e')->>'snapshot_hash'
 THEN RAISE EXCEPTION 'Source edit failed to invalidate layout snapshot'; END IF;
END $$;
ROLLBACK;

-- The same helper remains the normal producer's owner. Its code change must
-- still invalidate evaluated output; a disposable refold restores exact sheets.
DO $$
DECLARE r jsonb; source jsonb;
BEGIN
 r:=public.harness_model_fold('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 IF r->>'status'<>'current' THEN RAISE EXCEPTION 'Normal producer rejected bounded presentation helper'; END IF;
 source:=public.harness_source_workspace('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 IF (SELECT coalesce(jsonb_agg(jsonb_build_object('sheet_id',m.sheet_id,'segment_id',m.segment_id,'ordinal',m.ordinal)
   ORDER BY m.sheet_id,m.ordinal),'[]') FROM public.harness_model_sheet_members m
   WHERE m.evaluation_id=(r->>'evaluation_id')::uuid) IS DISTINCT FROM source#>'{manual_layout,members}'
 THEN RAISE EXCEPTION 'Source and evaluated producer forked manual membership'; END IF;
END $$;

INSERT INTO public.vehicles(id,is_public,user_id) VALUES
 ('00000000-0000-0000-0000-00000000fb01',false,'00000000-0000-0000-0000-00000000fb11');
SET ROLE anon;
DO $$ BEGIN
 IF public.harness_source_workspace('00000000-0000-0000-0000-00000000fb01') IS NOT NULL
 THEN RAISE EXCEPTION 'Private source layout exposed'; END IF;
END $$;
RESET ROLE;
SELECT set_config('test.auth_uid','00000000-0000-0000-0000-00000000fb11',false),
 set_config('test.auth_jwt','{"is_anonymous":true}',false);
SET ROLE authenticated;
DO $$ BEGIN
 IF public.harness_source_workspace('00000000-0000-0000-0000-00000000fb01') IS NOT NULL
 THEN RAISE EXCEPTION 'Anonymous owner spoof exposed layout'; END IF;
END $$;
RESET ROLE;
SELECT set_config('test.auth_jwt','{"is_anonymous":false}',false);
SET ROLE authenticated;
DO $$ BEGIN
 IF public.harness_source_workspace('00000000-0000-0000-0000-00000000fb01') IS NULL
 THEN RAISE EXCEPTION 'Legitimate private owner lost source layout'; END IF;
END $$;
RESET ROLE;
UPDATE public.vehicles SET deleted_at=now() WHERE id='00000000-0000-0000-0000-00000000fb01';
SET ROLE authenticated;
DO $$ BEGIN
 IF public.harness_source_workspace('00000000-0000-0000-0000-00000000fb01') IS NOT NULL
 THEN RAISE EXCEPTION 'Deleted owner source layout exposed'; END IF;
END $$;
RESET ROLE;
SELECT set_config('test.auth_uid','',false),set_config('test.auth_jwt','{}',false);

DROP POLICY "Public read for public vehicles" ON public.harness_segments;
CREATE POLICY source_layout_deny_segments ON public.harness_segments FOR SELECT USING(false);
SET ROLE anon;
DO $$
DECLARE r jsonb:=public.harness_source_workspace('e08bf694-970f-4cbe-8a74-8715158a0f2e');
BEGIN
 IF jsonb_array_length(r#>'{source,segments}')<>0
  OR jsonb_array_length(r#>'{selection,segment_ids}')<>0
  OR r#>'{manual_layout,members}'<>'[]'::jsonb
 THEN RAISE EXCEPTION 'Source layout bypassed existing row denial'; END IF;
END $$;
RESET ROLE;
SELECT 'test_harness_source_manual_layout: PASS' AS result;
