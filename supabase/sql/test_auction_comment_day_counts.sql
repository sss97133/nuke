-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_comment_day_counts -f this-file.sql
-- Proves 20261125144500_auction_comment_day_counts.sql: the backfill counts comments per car per UTC posted day for the
-- recent days; the statement trigger keeps the counts equal to a recount through multi-row inserts, moves between cars
-- and days, and deletes; the reconcile function corrects a wrong closed day and reports it; applying twice changes no
-- count; and hero_heat's comment_velocity, read as anon from the fold, lists the same cars and counts as the scan it
-- replaces, with private cars still excluded. hero_heat starts as 20261125134500 left it (embedded below).
-- Rows are a disposable database's rows, never testimony.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
SET TimeZone = 'America/Los_Angeles';  -- day buckets must be UTC whatever the session zone
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF;
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- pg_cron stand-in: the job table and the two calls the migration makes.
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS
$$ INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(p_jobid bigint) RETURNS boolean LANGUAGE sql AS
$$ DELETE FROM cron.job WHERE jobid = p_jobid RETURNING true $$;

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, year integer, make text, model text, is_public boolean DEFAULT true,
  deleted_at timestamptz, listing_kind text, heat_score numeric, sale_price integer, asking_price numeric,
  current_value numeric, primary_image_url text);
CREATE TABLE public.auction_comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid REFERENCES public.vehicles(id),
  posted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), comment_text text);
CREATE INDEX idx_auction_comments_created_at ON public.auction_comments (created_at DESC);

-- hero_heat as 20261125134500 leaves it.
CREATE OR REPLACE FUNCTION public.hero_heat()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '10s'
AS $function$
  WITH hot_vehicles AS (
    SELECT
      v.id,
      v.year,
      COALESCE(v.make, 'Unknown') AS make,
      v.model,
      v.heat_score,
      v.primary_image_url AS thumbnail,
      COALESCE(
        NULLIF(v.sale_price, 0)::numeric,
        NULLIF(v.asking_price, 0::numeric),
        NULLIF(v.current_value, 0::numeric)
      ) AS price
    FROM vehicles v
    WHERE v.heat_score IS NOT NULL AND v.heat_score > 0
      AND v.is_public = true AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
    ORDER BY v.heat_score DESC
    LIMIT 30
  ),
  comment_velocity AS (
    SELECT
      ac.vehicle_id AS id,
      count(*) AS comment_count_7d,
      v.year,
      COALESCE(v.make, 'Unknown') AS make,
      v.model,
      v.primary_image_url AS thumbnail
    FROM auction_comments ac
    JOIN vehicles v ON v.id = ac.vehicle_id
    WHERE ac.posted_at > now() - interval '7 days'
      AND v.is_public = true AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
    GROUP BY ac.vehicle_id, v.year, v.make, v.model, v.primary_image_url
    ORDER BY count(*) DESC
    LIMIT 20
  ),
  make_heat AS (
    SELECT
      COALESCE(v.make, 'Unknown') AS make,
      SUM(v.heat_score) AS total_heat,
      count(*) AS cnt
    FROM vehicles v
    WHERE v.heat_score IS NOT NULL AND v.heat_score > 0
      AND v.is_public = true AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
    GROUP BY v.make
    ORDER BY total_heat DESC
    LIMIT 20
  )
  SELECT jsonb_build_object(
    'top_hot', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'year', year, 'make', make, 'model', model,
      'heat_score', heat_score, 'thumbnail', thumbnail, 'price', price
    )), '[]'::jsonb) FROM hot_vehicles),
    'comment_velocity', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'year', year, 'make', make, 'model', model,
      'comment_count_7d', comment_count_7d, 'thumbnail', thumbnail
    )), '[]'::jsonb) FROM comment_velocity),
    'make_heat', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'make', make, 'total_heat', total_heat, 'count', cnt
    )), '[]'::jsonb) FROM make_heat)
  );
$function$;
GRANT EXECUTE ON FUNCTION public.hero_heat() TO anon, authenticated, service_role;

CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text) TO anon;
-- UTC midnight today, as timestamptz.
CREATE FUNCTION public.t_day0() RETURNS timestamptz LANGUAGE sql STABLE AS
$$ SELECT (now() AT TIME ZONE 'UTC')::date::timestamp AT TIME ZONE 'UTC' $$;
SET check_function_bodies = off;  -- t_drift reads the table the migration creates
-- Buckets that differ from a recount of the comments, over the fold's complete window (8 UTC days back to today).
CREATE FUNCTION public.t_drift() RETURNS bigint LANGUAGE sql AS $$
  WITH r AS (SELECT vehicle_id, (posted_at AT TIME ZONE 'UTC')::date d, count(*)::int n FROM public.auction_comments
              WHERE posted_at >= t_day0() - interval '8 days' AND vehicle_id IS NOT NULL GROUP BY 1, 2),
       f AS (SELECT vehicle_id, posted_day d, n FROM public.auction_comment_day_counts
              WHERE posted_day >= (now() AT TIME ZONE 'UTC')::date - 8 AND n > 0)
  SELECT count(*) FROM ((SELECT * FROM r EXCEPT SELECT * FROM f) UNION ALL (SELECT * FROM f EXCEPT SELECT * FROM r)) x $$;
CREATE FUNCTION public.t_velocity() RETURNS text LANGUAGE sql AS
$$ SELECT coalesce(string_agg((e->>'model') || '=' || (e->>'comment_count_7d'), ',' ORDER BY e->>'model'), '')
     FROM jsonb_array_elements(public.hero_heat()->'comment_velocity') e $$;
GRANT EXECUTE ON FUNCTION public.t_velocity() TO anon;

-- Cars: pub_a and pub_c public; priv_b private. Comments (posted, stored at posting unless noted):
--   pub_a: 3 posted 1 h after today's UTC midnight, 2 posted yesterday at noon, 1 posted 10 days ago
--   priv_b: 5 today; pub_c: 1 today
INSERT INTO public.vehicles (id, year, make, model, is_public, listing_kind) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 1978, 'Chevrolet', 'pub_a',  true,  'vehicle'),
  ('b0000000-0000-0000-0000-00000000000b', 1978, 'Chevrolet', 'priv_b', false, 'vehicle'),
  ('c0000000-0000-0000-0000-00000000000c', 1978, 'Chevrolet', 'pub_c',  true,  'vehicle');
INSERT INTO public.auction_comments (vehicle_id, posted_at, created_at)
SELECT 'a0000000-0000-0000-0000-00000000000a'::uuid, t_day0() + interval '1 hour', t_day0() + interval '1 hour' FROM generate_series(1, 3)
UNION ALL SELECT 'a0000000-0000-0000-0000-00000000000a', t_day0() - interval '12 hours', t_day0() - interval '12 hours' FROM generate_series(1, 2)
UNION ALL SELECT 'a0000000-0000-0000-0000-00000000000a', t_day0() - interval '10 days', t_day0() - interval '10 days'
UNION ALL SELECT 'b0000000-0000-0000-0000-00000000000b', t_day0() + interval '1 hour', t_day0() + interval '1 hour' FROM generate_series(1, 5)
UNION ALL SELECT 'c0000000-0000-0000-0000-00000000000c', t_day0() + interval '1 hour', t_day0() + interval '1 hour';

-- Before: the scan-based velocity.
SET ROLE anon;
SELECT t_assert(t_velocity() = 'pub_a=5,pub_c=1', 'before: the scan lists pub_a=5, pub_c=1 (private car excluded)');
RESET ROLE;

\ir ../migrations/20261125144500_auction_comment_day_counts.sql
RESET statement_timeout; RESET lock_timeout;

SELECT t_assert(t_drift() = 0, 'backfill: every bucket of the last 8 UTC days equals a recount');
SELECT t_assert((SELECT count(*) FROM public.auction_comment_day_counts WHERE posted_day < (now() AT TIME ZONE 'UTC')::date - 8) = 0,
  'backfill: no bucket older than the complete window is written');
SELECT t_assert((SELECT count(*) FROM cron.job WHERE jobname = 'auction-comment-day-counts-reconcile' AND schedule = '20 4 * * *') = 1,
  'job: one nightly reconcile job at 04:20 UTC');
SET ROLE anon;
SELECT t_assert(t_velocity() = 'pub_a=5,pub_c=1', 'after: velocity read from the fold equals the scan (pub_a=5, pub_c=1)');
SELECT t_assert(NOT has_table_privilege('anon', 'public.auction_comment_day_counts', 'SELECT'), 'anon cannot read the fold table directly');
RESET ROLE;

-- The trigger: a multi-row insert over two cars and two days.
INSERT INTO public.auction_comments (vehicle_id, posted_at)
SELECT 'c0000000-0000-0000-0000-00000000000c'::uuid, t_day0() + interval '2 hours' FROM generate_series(1, 2)
UNION ALL SELECT 'a0000000-0000-0000-0000-00000000000a', t_day0() - interval '30 hours';
SELECT t_assert(t_drift() = 0, 'trigger: a multi-row insert over two cars and two days keeps every bucket equal to a recount');
-- A move between cars and a move between days.
UPDATE public.auction_comments SET vehicle_id = 'c0000000-0000-0000-0000-00000000000c'
 WHERE id = (SELECT id FROM public.auction_comments WHERE vehicle_id = 'a0000000-0000-0000-0000-00000000000a'
               AND posted_at = t_day0() - interval '12 hours' LIMIT 1);
UPDATE public.auction_comments SET posted_at = t_day0() - interval '3 days'
 WHERE id = (SELECT id FROM public.auction_comments WHERE vehicle_id = 'b0000000-0000-0000-0000-00000000000b' LIMIT 1);
UPDATE public.auction_comments SET comment_text = 'edited' WHERE vehicle_id = 'a0000000-0000-0000-0000-00000000000a';
SELECT t_assert(t_drift() = 0, 'trigger: moves between cars and days (and a text-only edit) keep every bucket equal to a recount');
DELETE FROM public.auction_comments WHERE id = (SELECT id FROM public.auction_comments
  WHERE vehicle_id = 'c0000000-0000-0000-0000-00000000000c' AND posted_at = t_day0() + interval '2 hours' LIMIT 1);
SELECT t_assert(t_drift() = 0, 'trigger: a delete keeps every bucket equal to a recount');
SET ROLE anon;
SELECT t_assert(t_velocity() = 'pub_a=5,pub_c=3', 'after edits: pub_a = 3 today + 1 yesterday + 1 two days ago; pub_c = 1 + 2 - 1 today + 1 moved from pub_a');
RESET ROLE;

-- Reconcile corrects a closed day and reports it; it leaves today alone.
UPDATE public.auction_comment_day_counts SET n = 99
 WHERE vehicle_id = 'a0000000-0000-0000-0000-00000000000a' AND posted_day = (now() AT TIME ZONE 'UTC')::date - 1;
-- and a phantom bucket: a closed day with a count but no comments.
INSERT INTO public.auction_comment_day_counts (vehicle_id, posted_day, n)
VALUES ('b0000000-0000-0000-0000-00000000000b', (now() AT TIME ZONE 'UTC')::date - 5, 4);
SELECT t_assert(public.auction_comment_day_counts_reconcile(8) = 2 AND t_drift() = 0,
  'reconcile: corrects a wrong closed day and zeroes a phantom one, and reports 2');
SELECT t_assert(public.auction_comment_day_counts_reconcile(8) = 0, 'reconcile: a second run corrects nothing');
DO $$ BEGIN PERFORM public.auction_comment_day_counts_reconcile(30); RAISE EXCEPTION 'FAIL: reconcile accepted 30 days';
EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; RAISE NOTICE 'PASS: reconcile refuses a window over 14 days'; END $$;

-- Applying twice changes no count and keeps one job and three triggers.
CREATE TEMP TABLE t_snap AS SELECT * FROM public.auction_comment_day_counts;
\ir ../migrations/20261125144500_auction_comment_day_counts.sql
RESET statement_timeout; RESET lock_timeout;
SELECT t_assert((SELECT count(*) FROM ((SELECT vehicle_id, posted_day, n FROM t_snap EXCEPT SELECT vehicle_id, posted_day, n FROM public.auction_comment_day_counts)
  UNION ALL (SELECT vehicle_id, posted_day, n FROM public.auction_comment_day_counts EXCEPT SELECT vehicle_id, posted_day, n FROM t_snap)) x) = 0
  AND (SELECT count(*) FROM cron.job WHERE jobname = 'auction-comment-day-counts-reconcile') = 1
  AND (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.auction_comments'::regclass AND tgname LIKE 'auction_comment_day_counts_%') = 3,
  'applied twice: no count changes, one job, three triggers');
SELECT t_assert((SELECT count(*) FROM public.auction_comments) = 14, 'no comment changed by the migration (14 = 12 seeded + 3 inserted - 1 deleted)');
