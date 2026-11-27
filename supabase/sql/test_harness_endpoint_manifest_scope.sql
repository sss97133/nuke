\set ON_ERROR_STOP on
SET statement_timeout='10s';
SET lock_timeout='2s';
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%'
  OR current_setting('server_version_num')::integer/10000<>17 THEN
  RAISE EXCEPTION 'Endpoint device scope contract requires disposable PG17';
 END IF;
END $$;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE FUNCTION public.t_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %',label;END IF;END $$;
CREATE TABLE public.vehicles(id uuid PRIMARY KEY);
CREATE TABLE public.harness_designs(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES public.vehicles(id),name text);
CREATE TABLE public.vehicle_build_manifest(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES public.vehicles(id),name text);
CREATE TABLE public.harness_endpoints(id uuid PRIMARY KEY,design_id uuid REFERENCES public.harness_designs(id) ON DELETE CASCADE,
 manifest_device_id uuid REFERENCES public.vehicle_build_manifest(id) ON DELETE SET NULL,name text);
ALTER TABLE public.harness_designs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_build_manifest ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harness_endpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY endpoints_read ON public.harness_endpoints FOR SELECT USING(true);
CREATE POLICY endpoints_write ON public.harness_endpoints FOR ALL TO authenticated USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.harness_endpoints TO authenticated;
INSERT INTO public.vehicles VALUES
 ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
INSERT INTO public.harness_designs VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','first'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','second'),
 ('20000000-0000-4000-8000-000000000003',NULL,'unassigned');
INSERT INTO public.vehicle_build_manifest VALUES
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','first device'),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','second device'),
 ('30000000-0000-4000-8000-000000000003',NULL,'unassigned device');
INSERT INTO public.harness_endpoints VALUES
 ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',NULL,'unlinked source');
BEGIN;
UPDATE public.harness_endpoints SET manifest_device_id='30000000-0000-4000-8000-000000000002';
SELECT public.t_assert((SELECT e.manifest_device_id=m.id AND d.vehicle_id<>m.vehicle_id
 FROM public.harness_endpoints e JOIN public.harness_designs d ON d.id=e.design_id
 JOIN public.vehicle_build_manifest m ON m.id=e.manifest_device_id),
 'before migration both existing ID foreign keys accept a different-vehicle device');
ROLLBACK;
SELECT md5(jsonb_agg(to_jsonb(e) ORDER BY e.id)::text) AS before_rows FROM public.harness_endpoints e \gset
\ir ../migrations/20261127201511_harness_endpoint_manifest_scope.sql
SELECT public.t_assert((SELECT md5(jsonb_agg(to_jsonb(e)-'device_vehicle_id' ORDER BY e.id)::text)=:'before_rows'
 FROM public.harness_endpoints e),'installation preserves every original source field');
SELECT public.t_assert((SELECT count(*)=0 FROM public.harness_endpoints WHERE device_vehicle_id IS NOT NULL),
 'installation invents no device link or vehicle assignment');
SELECT public.t_assert((SELECT count(*)=3 AND bool_and(convalidated) FROM pg_constraint
 WHERE conrelid='public.harness_endpoints'::regclass AND conname IN('harness_endpoints_device_scope_complete',
 'harness_endpoints_device_design_scope_fkey','harness_endpoints_device_manifest_scope_fkey')),
 'scope completeness and both native composite FKs are validated');
SET ROLE authenticated;
UPDATE public.harness_endpoints SET manifest_device_id='30000000-0000-4000-8000-000000000001'
 WHERE id='40000000-0000-4000-8000-000000000001';
RESET ROLE;
SELECT public.t_assert((SELECT device_vehicle_id='10000000-0000-4000-8000-000000000001'
 FROM public.harness_endpoints WHERE id='40000000-0000-4000-8000-000000000001'),
 'authorized endpoint writer can link a same-vehicle device without parent read grants');
DO $$ BEGIN
 BEGIN
  UPDATE public.harness_endpoints SET manifest_device_id='30000000-0000-4000-8000-000000000002';
  RAISE EXCEPTION 'cross-vehicle device accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;END;
 BEGIN
  UPDATE public.harness_endpoints SET design_id='20000000-0000-4000-8000-000000000002';
  RAISE EXCEPTION 'cross-vehicle design accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;END;
 BEGIN
  UPDATE public.harness_endpoints SET design_id='20000000-0000-4000-8000-000000000003';
  RAISE EXCEPTION 'unassigned design accepted';
 EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN
  UPDATE public.harness_endpoints SET manifest_device_id='30000000-0000-4000-8000-000000000003';
  RAISE EXCEPTION 'unassigned manifest accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;END;
 BEGIN
  UPDATE public.harness_endpoints SET manifest_device_id='30000000-0000-4000-8000-000000000009';
  RAISE EXCEPTION 'absent manifest accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;END;
 BEGIN
  UPDATE public.harness_designs SET vehicle_id='10000000-0000-4000-8000-000000000002'
   WHERE id='20000000-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'linked design reparent accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;END;
 BEGIN
  UPDATE public.vehicle_build_manifest SET vehicle_id='10000000-0000-4000-8000-000000000002'
   WHERE id='30000000-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'linked device reparent accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;END;
 BEGIN
  UPDATE public.harness_designs SET vehicle_id=NULL WHERE id='20000000-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'linked design ownership withdrawal accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;END;
END $$;
UPDATE public.harness_endpoints SET device_vehicle_id='10000000-0000-4000-8000-000000000002';
SELECT public.t_assert((SELECT device_vehicle_id='10000000-0000-4000-8000-000000000001' FROM public.harness_endpoints),
 'caller cannot forge the derived scope key');
SET session_replication_role=replica;
DO $$ BEGIN
 BEGIN
  UPDATE public.harness_endpoints SET manifest_device_id='30000000-0000-4000-8000-000000000002';
  RAISE EXCEPTION 'replication-role cross-vehicle link accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;END;
 BEGIN
  UPDATE public.vehicle_build_manifest SET vehicle_id='10000000-0000-4000-8000-000000000002'
   WHERE id='30000000-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'replication-role parent reparent accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;END;
END $$;
SET session_replication_role=origin;
SELECT public.t_assert((SELECT count(*)=8 AND bool_and(g.tgenabled='A') FROM pg_trigger g
 JOIN pg_constraint c ON c.oid=g.tgconstraint WHERE c.conrelid='public.harness_endpoints'::regclass
 AND c.conname IN('harness_endpoints_device_design_scope_fkey','harness_endpoints_device_manifest_scope_fkey')),
 'only the new native FK guards enforce every write role, including parent reassignment');
INSERT INTO public.harness_endpoints(id,design_id,manifest_device_id,name) VALUES
 ('40000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001','inserted link');
DELETE FROM public.vehicle_build_manifest WHERE id='30000000-0000-4000-8000-000000000001';
SELECT public.t_assert((SELECT count(*)=2 AND bool_and(manifest_device_id IS NULL AND device_vehicle_id IS NULL)
 FROM public.harness_endpoints),'existing device delete-set-null behavior clears the scope key atomically');
UPDATE public.harness_endpoints SET design_id='20000000-0000-4000-8000-000000000003';
SELECT public.t_assert((SELECT count(*)=2 FROM public.harness_endpoints WHERE device_vehicle_id IS NULL),
 'unlinked endpoints can retain an unassigned design');
UPDATE public.harness_endpoints SET design_id='20000000-0000-4000-8000-000000000002',
 manifest_device_id='30000000-0000-4000-8000-000000000002' WHERE id='40000000-0000-4000-8000-000000000001';
UPDATE public.harness_endpoints SET manifest_device_id=NULL;
SELECT public.t_assert((SELECT count(*)=2 AND bool_and(device_vehicle_id IS NULL) FROM public.harness_endpoints),
 'explicit unlink clears the derived key');
SELECT public.t_assert((SELECT prosecdef AND proconfig=ARRAY['search_path=pg_catalog, public']
 AND NOT has_function_privilege('anon',oid,'EXECUTE') AND NOT has_function_privilege('authenticated',oid,'EXECUTE')
 AND NOT has_function_privilege('service_role',oid,'EXECUTE') FROM pg_proc
 WHERE oid='public.harness_endpoint_device_scope()'::regprocedure),
 'trigger-only definer has a fixed search path and no API execution grants');
SELECT public.t_assert((SELECT tgenabled='A' FROM pg_trigger WHERE tgrelid='public.harness_endpoints'::regclass
 AND tgname='harness_endpoint_device_scope'),'derivation trigger also enforces replication-role writes');
SELECT 'endpoint manifest scope contract PASS' AS result;
