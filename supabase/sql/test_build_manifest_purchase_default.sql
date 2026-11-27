-- Synthetic admission cases, only in an empty disposable PostgreSQL17 database.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int/10000<>17
  OR EXISTS(SELECT FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN('r','p','v','m')) THEN
  RAISE EXCEPTION 'requires empty disposable PG17 dm_refinement database'; END IF;
END $$;
SET statement_timeout='10s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='manifest_default_owner') THEN CREATE ROLE manifest_default_owner NOSUPERUSER; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='manifest_admission_client') THEN CREATE ROLE manifest_admission_client NOSUPERUSER; END IF;
END $$;
CREATE TABLE public.vehicle_build_manifest(id uuid PRIMARY KEY,purchased boolean DEFAULT false,source_note text);
INSERT INTO public.vehicle_build_manifest VALUES
 ('00000000-0000-4000-8000-000000000001',true,'explicit existing claim'),
 ('00000000-0000-4000-8000-000000000002',false,'explicit existing claim'),
 ('00000000-0000-4000-8000-000000000003',NULL,'existing unknown');
SELECT md5(jsonb_agg(to_jsonb(m) ORDER BY id)::text) AS before_rows FROM public.vehicle_build_manifest m \gset
ALTER TABLE public.vehicle_build_manifest OWNER TO manifest_default_owner;
GRANT USAGE ON SCHEMA public TO manifest_default_owner,manifest_admission_client;
GRANT INSERT(id,purchased),SELECT(id,purchased) ON public.vehicle_build_manifest TO manifest_admission_client;
SET ROLE manifest_default_owner;
DO $$ BEGIN
 IF (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) THEN RAISE EXCEPTION 'migration must run as a non-superuser owner'; END IF;
END $$;
\ir ../migrations/20261127211703_build_manifest_unknown_purchase_default.sql
RESET ROLE;
SELECT (md5(jsonb_agg(to_jsonb(m) ORDER BY id)::text)=:'before_rows') AS existing_unchanged FROM public.vehicle_build_manifest m \gset
\if :existing_unchanged
\else
 \quit 1
\endif
SET ROLE manifest_admission_client;
INSERT INTO public.vehicle_build_manifest(id) VALUES('00000000-0000-4000-8000-000000000004');
INSERT INTO public.vehicle_build_manifest(id,purchased) VALUES
 ('00000000-0000-4000-8000-000000000005',true),
 ('00000000-0000-4000-8000-000000000006',false),
 ('00000000-0000-4000-8000-000000000007',NULL);
DO $$ BEGIN
 IF (SELECT purchased IS NOT NULL FROM public.vehicle_build_manifest WHERE id='00000000-0000-4000-8000-000000000004') THEN
  RAISE EXCEPTION 'omitting purchase evidence manufactured a boolean claim'; END IF;
 IF NOT (SELECT purchased IS TRUE FROM public.vehicle_build_manifest WHERE id='00000000-0000-4000-8000-000000000005')
  OR NOT (SELECT purchased IS FALSE FROM public.vehicle_build_manifest WHERE id='00000000-0000-4000-8000-000000000006')
  OR NOT (SELECT purchased IS NULL FROM public.vehicle_build_manifest WHERE id='00000000-0000-4000-8000-000000000007') THEN
  RAISE EXCEPTION 'explicit SQL input changed; this default does not qualify or overwrite claims'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
  WHERE d.adrelid='public.vehicle_build_manifest'::regclass AND a.attname='purchased') THEN
  RAISE EXCEPTION 'purchase default still exists'; END IF;
 RAISE NOTICE 'PASS: non-superuser install; existing rows preserved; omitted purchase unknown; explicit inputs preserved';
END $$;
