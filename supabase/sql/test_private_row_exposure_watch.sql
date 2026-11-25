-- Contract: 20261125100000. assay_private_row_exposure counts the private rows anon and a stranger can read, per probe;
-- private_row_exposure_watch raises while any relation is exposed and returns the reading once none is. Synthetic rows.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_private_row_exposure%' OR to_regclass('public.private_row_probes') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_private_row_exposure* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub', '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE cron.job (jobname text PRIMARY KEY, schedule text, command text);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS
$$ INSERT INTO cron.job VALUES (n, s, c) ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING 1 $$;

-- live shapes, reduced to the columns the probes read
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean NOT NULL, deleted_at timestamptz);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY, vehicle_id uuid REFERENCES public.vehicles (id), user_id uuid);
CREATE FUNCTION public.vehicle_image_gallery_eligible(vehicle_images) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE TABLE public.image_descriptions (id uuid PRIMARY KEY, image_id uuid REFERENCES public.vehicle_images (id), description text);
CREATE TABLE public.user_presence (id bigserial PRIMARY KEY, vehicle_id uuid REFERENCES public.vehicles (id), user_id uuid);
ALTER TABLE public.image_descriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.image_descriptions, public.user_presence TO anon, authenticated;
CREATE POLICY image_descriptions_select ON public.image_descriptions FOR SELECT USING (true);           -- the live defect
CREATE POLICY user_presence_select_own ON public.user_presence FOR SELECT TO authenticated USING (user_id = auth.uid());

INSERT INTO public.vehicles VALUES ('10000000-0000-0000-0000-000000000001', true, NULL), ('10000000-0000-0000-0000-000000000002', false, NULL);
INSERT INTO public.vehicle_images VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),  -- shown
  ('20000000-0000-0000-0000-000000000002', NULL, '30000000-0000-0000-0000-000000000001'),                                    -- unfiled
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001'); -- private car
INSERT INTO public.image_descriptions VALUES
  (gen_random_uuid(), '20000000-0000-0000-0000-000000000001', 'shown'),
  (gen_random_uuid(), '20000000-0000-0000-0000-000000000002', 'unfiled'),
  (gen_random_uuid(), '20000000-0000-0000-0000-000000000003', 'private car');
INSERT INTO public.user_presence (vehicle_id, user_id) VALUES
  ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'), ('10000000-0000-0000-0000-000000000001', NULL);

\ir ../migrations/20261125100000_private_row_exposure_watch.sql
\ir ../migrations/20261125100000_private_row_exposure_watch.sql

DO $$
DECLARE r jsonb; x jsonb; me text := current_user; raised boolean := false;
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'private-row-exposure-watch' AND command = 'SELECT public.private_row_exposure_watch()') <> 1 THEN
    RAISE EXCEPTION 'watch job not scheduled'; END IF;
  IF (SELECT count(*) FROM public.private_row_probes) <> 17 THEN RAISE EXCEPTION 'probe rows: %', (SELECT count(*) FROM public.private_row_probes); END IF;

  r := public.assay_private_row_exposure();
  IF current_user <> me OR coalesce(current_setting('request.jwt.claims', true), '') <> '' THEN
    RAISE EXCEPTION 'role or claims leaked past the assay: % %', current_user, current_setting('request.jwt.claims', true); END IF;
  SELECT x2 INTO x FROM jsonb_array_elements(r->'relations') x2 WHERE x2->>'relation' = 'image_descriptions';
  IF (x->>'private_sampled')::int <> 2 OR (x#>>'{visible,anon}')::int <> 2 OR (x#>>'{visible,authenticated}')::int <> 2 OR NOT (x->>'exposed')::boolean THEN
    RAISE EXCEPTION 'open image_descriptions: %', x; END IF;
  SELECT x2 INTO x FROM jsonb_array_elements(r->'relations') x2 WHERE x2->>'relation' = 'user_presence';
  IF (x->>'private_sampled')::int <> 1 OR (x#>>'{visible,anon}')::int <> 0 OR (x#>>'{visible,authenticated}')::int <> 0 OR (x->>'exposed')::boolean THEN
    RAISE EXCEPTION 'own-row user_presence must read 0 for anon and a stranger: %', x; END IF;
  SELECT x2 INTO x FROM jsonb_array_elements(r->'relations') x2 WHERE x2->>'relation' = 'vehicle_views';
  IF NOT coalesce((x->>'missing')::boolean, false) THEN RAISE EXCEPTION 'a missing relation must read missing: %', x; END IF;
  IF (r->>'exposed_relations')::int <> 1 OR r->'exposed' <> '["image_descriptions"]'::jsonb THEN RAISE EXCEPTION 'reading: %', r; END IF;

  BEGIN
    PERFORM public.private_row_exposure_watch();
  EXCEPTION WHEN raise_exception THEN
    raised := SQLERRM LIKE 'private rows readable in 1 of % relations: image_descriptions [ta-pipeline] anon 2, stranger 2 of 2%';
    IF NOT raised THEN RAISE EXCEPTION 'watch message: %', SQLERRM; END IF;
  END;
  IF NOT raised THEN RAISE EXCEPTION 'the watch did not raise while a relation is exposed'; END IF;
END $$;

-- the fix shape: shown photos for everyone, the uploader for the rest
ALTER POLICY image_descriptions_select ON public.image_descriptions USING (
  EXISTS (SELECT 1 FROM public.vehicle_images vi JOIN public.vehicles v ON v.id = vi.vehicle_id
           WHERE vi.id = image_descriptions.image_id AND v.is_public AND v.deleted_at IS NULL)
  OR EXISTS (SELECT 1 FROM public.vehicle_images vi WHERE vi.id = image_descriptions.image_id AND vi.user_id = auth.uid()));
GRANT SELECT ON public.vehicle_images, public.vehicles TO anon, authenticated;

DO $$
DECLARE r jsonb;
BEGIN
  r := public.private_row_exposure_watch();
  IF (r->>'exposed_relations')::int <> 0 THEN RAISE EXCEPTION 'after the fix: %', r; END IF;
  -- the uploader still reads their own unfiled photo's description (the probe's stranger does not)
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"30000000-0000-0000-0000-000000000001"}', true);
  SET LOCAL ROLE authenticated;
  IF (SELECT count(*) FROM public.image_descriptions) <> 3 THEN RAISE EXCEPTION 'uploader lost rows'; END IF;
  RESET ROLE;
END $$;

DO $$ BEGIN
  IF has_function_privilege('anon', 'public.assay_private_row_exposure()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.private_row_exposure_watch()', 'EXECUTE')
     OR has_table_privilege('anon', 'public.private_row_probes', 'SELECT') THEN
    RAISE EXCEPTION 'API roles must not reach the assay'; END IF;
END $$;
\echo private_row_exposure_watch: ok
