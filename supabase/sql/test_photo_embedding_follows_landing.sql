-- Contract for 20261120193000_photo_embedding_follows_landing.sql, on a fresh disposable database: the embedder's batch
-- hands out the newest landing first (a photo taken years ago that landed today is no longer last); the watch counts
-- photos that landed in the last 7 days, over 90 minutes ago, and still have no embedding on an active row with a
-- usable source, and raises above 10; one hourly cron runs it; grants and settings are as they were; the migration
-- refuses over a body someone changed; replay and revert.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_photo_embedding_follows%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_photo_embedding_follows* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;
CREATE FUNCTION pg_temp.raises(sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

-- the two tables the batch and the watch read. The embedding is a vector in production; only its presence matters here.
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY, image_url text, storage_path text, taken_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.image_observations (id uuid PRIMARY KEY, image_id uuid NOT NULL REFERENCES public.vehicle_images(id),
  is_active boolean NOT NULL DEFAULT true, embedding_clip_vitb32 text);
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job(jobname, schedule, command) VALUES (p_name, p_schedule, p_command) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(p_jobid bigint) RETURNS boolean LANGUAGE sql AS $$
  DELETE FROM cron.job WHERE jobid = p_jobid RETURNING true $$;

-- get_clip_embed_batch exactly as production held it on 2026-11-20 (pg_get_functiondef, byte for byte), with its grants
CREATE OR REPLACE FUNCTION public.get_clip_embed_batch(p_limit integer DEFAULT 100)
 RETURNS TABLE(obs_id uuid, image_url text, storage_path text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select io.id, vi.image_url, vi.storage_path
  from image_observations io
  join vehicle_images vi on vi.id = io.image_id
  where io.embedding_clip_vitb32 is null and io.is_active
    and (nullif(vi.image_url,'') is not null or vi.storage_path like '/Users/%')
  order by vi.taken_at desc nulls last
  limit greatest(1, least(p_limit, 500));
$function$;
REVOKE ALL ON FUNCTION public.get_clip_embed_batch(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_clip_embed_batch(integer) TO service_role;
CREATE FUNCTION pg_temp.batch_md5() RETURNS text LANGUAGE sql AS
  $$ SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.get_clip_embed_batch(integer)') $$;
SELECT pg_temp.assert_true(pg_temp.batch_md5() = '2f0eeae60b591a20049e9153748bf6cd', 'the fixture holds production''s body of 2026-11-20');

-- a photo and its row: n names both; landed = how long ago it landed; taken = when the picture was taken
CREATE FUNCTION pg_temp.img(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.obs(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.photo(n int, landed interval, taken timestamptz, url text DEFAULT 'https://example.test/p.jpg', path text DEFAULT NULL,
  embedded boolean DEFAULT false, active boolean DEFAULT true) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.vehicle_images (id, image_url, storage_path, taken_at, created_at) VALUES (pg_temp.img(n), url, path, taken, now() - landed);
  INSERT INTO public.image_observations (id, image_id, is_active, embedding_clip_vitb32)
  VALUES (pg_temp.obs(n), pg_temp.img(n), active, CASE WHEN embedded THEN '[0.1]' END) $$;
-- the batch, as the numbers of its rows in order
CREATE FUNCTION pg_temp.batch(lim int DEFAULT 100) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(ltrim(right(b.obs_id::text, 12), '0'), ',' ORDER BY b.ord), '')
    FROM public.get_clip_embed_batch(lim) WITH ORDINALITY AS b(obs_id, image_url, storage_path, ord) $$;

SELECT pg_temp.photo(1, interval '10 days',    '2026-11-18 12:00+00');                      -- taken lately, landed long ago
SELECT pg_temp.photo(2, interval '3 hours',    '2017-02-07 12:00+00');                      -- an old roll, landed today
SELECT pg_temp.photo(3, interval '20 minutes', '2018-06-01 12:00+00');                      -- an old roll, landed just now
SELECT pg_temp.photo(4, interval '3 hours',    '2026-11-20 12:00+00', embedded => true);    -- already embedded
SELECT pg_temp.photo(5, interval '3 hours',    '2026-11-20 12:00+00', active => false);     -- its row is not active
SELECT pg_temp.photo(6, interval '3 hours',    '2026-11-20 12:00+00', url => '');           -- no usable source
SELECT pg_temp.photo(7, interval '4 hours',    '2016-01-01 12:00+00', url => '', path => '/Users/someone/frames/7.jpg');  -- a local file

-- ===== 0. before: newest taken_at first, so the photos that landed today come after the one that landed ten days ago
SELECT pg_temp.assert_true(pg_temp.batch() = '1,3,2,7', 'before: the batch is ordered by when the picture was taken (' || pg_temp.batch() || ')');

-- the migration refuses over a body someone changed, and changes nothing
CREATE TEMP TABLE kept AS SELECT pg_get_functiondef('public.get_clip_embed_batch(integer)'::regprocedure) AS def;
DO $do$ BEGIN EXECUTE (SELECT regexp_replace(def, '\$function\$\s*$', E'-- changed since\n$function$') FROM kept); END $do$;
SELECT pg_temp.batch_md5() AS drifted_md5 \gset
\set ON_ERROR_STOP off
\i supabase/migrations/20261120193000_photo_embedding_follows_landing.sql
\set ON_ERROR_STOP on
SELECT pg_temp.assert_true(pg_temp.batch_md5() = :'drifted_md5' AND :'drifted_md5' <> '2f0eeae60b591a20049e9153748bf6cd'
  AND to_regprocedure('public.assay_photo_embedding_flow(boolean)') IS NULL AND (SELECT count(*) FROM cron.job) = 0,
  'refused: a batch body someone changed is not overwritten, and no watch or cron was created');
DO $do$ BEGIN EXECUTE (SELECT def FROM kept); END $do$;
SELECT pg_temp.assert_true(pg_temp.batch_md5() = '2f0eeae60b591a20049e9153748bf6cd', 'fixture: production''s body again');

\i supabase/migrations/20261120193000_photo_embedding_follows_landing.sql

-- ===== 1. the batch: newest landing first
SELECT pg_temp.assert_true(pg_temp.batch_md5() = '773d4bcfc3b94a6729ced0e9cb89ec6b', 'the batch function holds this migration''s body');
SELECT pg_temp.assert_true(pg_temp.batch() = '3,2,7,1', 'after: the batch is ordered by when the photo landed (' || pg_temp.batch() || ')');
SELECT pg_temp.assert_true(pg_temp.batch(2) = '3,2' AND pg_temp.batch(0) = '3' AND pg_temp.batch(-5) = '3', 'the limit still clamps (at least 1 row)');
SELECT pg_temp.assert_true((SELECT p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=public']
                              FROM pg_proc p WHERE p.oid = to_regprocedure('public.get_clip_embed_batch(integer)'))
  AND has_function_privilege('service_role', 'public.get_clip_embed_batch(integer)', 'execute')
  AND NOT has_function_privilege('anon', 'public.get_clip_embed_batch(integer)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.get_clip_embed_batch(integer)', 'execute'),
  'the batch function''s settings and grants are as they were');

-- ===== 2. the watch
SELECT pg_temp.assert_true((SELECT r ->> 'status' = 'passed' AND (r ->> 'waiting')::int = 2 AND (r ->> 'allowed')::int = 10
                                   AND (r ->> 'oldest_landing')::timestamptz = (SELECT created_at FROM vehicle_images WHERE id = pg_temp.img(7))
                              FROM (SELECT public.assay_photo_embedding_flow() AS r) x),
  'two photos have waited (2 and the local file 7); the one that landed 20 minutes ago, the one ten days ago, the embedded, the inactive and the one with no source are not counted');
-- ten waiting is still allowed; eleven raises with the count and the oldest landing
SELECT pg_temp.photo(20 + g, interval '2 hours' + g * interval '10 minutes', '2017-03-01 12:00+00') FROM generate_series(1, 8) g;
SELECT pg_temp.assert_true((public.assay_photo_embedding_flow() ->> 'waiting')::int = 10 AND public.assay_photo_embedding_flow() ->> 'status' = 'passed', 'ten waiting: passed');
SELECT pg_temp.photo(40, interval '6 days', '2017-03-01 12:00+00');
SELECT pg_temp.assert_true(pg_temp.raises($$SELECT public.assay_photo_embedding_flow()$$)
  LIKE 'photo embedding stalled: 11 photos that landed in the last 7 days have waited over 90 minutes for an embedding (oldest landed %', 'eleven waiting: the cron form raises with the numbers');
SELECT pg_temp.assert_true((SELECT r ->> 'status' = 'stalled' AND (r ->> 'waiting')::int = 11 FROM (SELECT public.assay_photo_embedding_flow(false) AS r) x),
  'asked not to raise, it answers stalled with the count');
-- the window's edges: 8 days ago is outside, 89 minutes ago is not yet waiting
SELECT pg_temp.photo(41, interval '8 days', '2017-03-01 12:00+00');
SELECT pg_temp.photo(42, interval '89 minutes', '2017-03-01 12:00+00');
SELECT pg_temp.assert_true((public.assay_photo_embedding_flow(false) ->> 'waiting')::int = 11, 'a landing 8 days old and one 89 minutes old are not counted');
-- an embedding landing takes a photo off the count
UPDATE public.image_observations SET embedding_clip_vitb32 = '[0.2]' WHERE id IN (pg_temp.obs(40), pg_temp.obs(21));
SELECT pg_temp.assert_true((SELECT r ->> 'status' = 'passed' AND (r ->> 'waiting')::int = 9 FROM (SELECT public.assay_photo_embedding_flow() AS r) x),
  'two embeddings landed: nine waiting, passed');
SELECT pg_temp.assert_true(has_function_privilege('service_role', 'public.assay_photo_embedding_flow(boolean)', 'execute')
  AND NOT has_function_privilege('anon', 'public.assay_photo_embedding_flow(boolean)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.assay_photo_embedding_flow(boolean)', 'execute'), 'the watch is the service role''s only');

-- ===== 3. one hourly cron, with a leading statement_timeout
SELECT pg_temp.assert_true((SELECT count(*) FROM cron.job) = 1
  AND (SELECT schedule = '25 * * * *' AND command LIKE 'SET statement_timeout = ''20s'';%assay_photo_embedding_flow()%' FROM cron.job WHERE jobname = 'photo-embedding-watch'),
  'photo-embedding-watch is scheduled once, hourly');

-- ===== 4. a replay changes nothing
\i supabase/migrations/20261120193000_photo_embedding_follows_landing.sql
SELECT pg_temp.assert_true(pg_temp.batch_md5() = '773d4bcfc3b94a6729ced0e9cb89ec6b' AND (SELECT count(*) FROM cron.job WHERE jobname = 'photo-embedding-watch') = 1
  AND NOT has_function_privilege('anon', 'public.assay_photo_embedding_flow(boolean)', 'execute'), 'replay: the same body, one cron, the same grants');

-- ===== 5. the revert refuses over a later change, then puts back what production held
DO $do$ BEGIN EXECUTE (SELECT regexp_replace(pg_get_functiondef('public.get_clip_embed_batch(integer)'::regprocedure), '\$function\$\s*$', E'-- changed later\n$function$')); END $do$;
\set ON_ERROR_STOP off
\i supabase/sql/revert_20261120193000_photo_embedding_follows_landing.sql
\set ON_ERROR_STOP on
SELECT pg_temp.assert_true(to_regprocedure('public.assay_photo_embedding_flow(boolean)') IS NOT NULL AND (SELECT count(*) FROM cron.job) = 1
  AND pg_temp.batch_md5() NOT IN ('2f0eeae60b591a20049e9153748bf6cd', '773d4bcfc3b94a6729ced0e9cb89ec6b'), 'revert refused over a later change: nothing was removed');
-- put this migration's body back (the kept definition is production's; applying the migration over it gives its own)
DO $do$ BEGIN EXECUTE (SELECT def FROM kept); END $do$;
\i supabase/migrations/20261120193000_photo_embedding_follows_landing.sql
SELECT pg_temp.assert_true(pg_temp.batch_md5() = '773d4bcfc3b94a6729ced0e9cb89ec6b', 'fixture: the migration''s body again');
\i supabase/sql/revert_20261120193000_photo_embedding_follows_landing.sql
SELECT pg_temp.assert_true(pg_temp.batch_md5() = '2f0eeae60b591a20049e9153748bf6cd' AND pg_temp.batch() LIKE '1,%'
  AND to_regprocedure('public.assay_photo_embedding_flow(boolean)') IS NULL AND (SELECT count(*) FROM cron.job) = 0
  AND has_function_privilege('service_role', 'public.get_clip_embed_batch(integer)', 'execute')
  AND NOT has_function_privilege('anon', 'public.get_clip_embed_batch(integer)', 'execute'),
  'revert: the batch is production''s body again (newest taken first), the watch and its cron are gone, grants as they were');
\i supabase/sql/revert_20261120193000_photo_embedding_follows_landing.sql
SELECT pg_temp.assert_true(pg_temp.batch_md5() = '2f0eeae60b591a20049e9153748bf6cd' AND (SELECT count(*) FROM cron.job) = 0, 'a second revert changes nothing');
-- and the migration applies again over the revert
\i supabase/migrations/20261120193000_photo_embedding_follows_landing.sql
SELECT pg_temp.assert_true(pg_temp.batch_md5() = '773d4bcfc3b94a6729ced0e9cb89ec6b' AND (SELECT count(*) FROM cron.job WHERE jobname = 'photo-embedding-watch') = 1
  AND to_regprocedure('public.assay_photo_embedding_flow(boolean)') IS NOT NULL, 'applied again after a revert');
\echo 'photo embedding follows landing contract passed'
