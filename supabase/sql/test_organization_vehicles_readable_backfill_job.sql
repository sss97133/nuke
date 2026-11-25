-- Empty disposable PG17 only:
--   createdb dm_refinement_ov_backfill; psql -X -v ON_ERROR_STOP=1 -d dm_refinement_ov_backfill -f this-file.sql
--   (-v bfmig=<path> runs the contract against another body; the mutation runs use it.)
-- Proves 20261126073000_organization_vehicles_readable_backfill_job.sql: it refuses to apply before 20261126071500; the
-- job fills NULL rows chunk_rows at a time in primary-key order with the car's answer; rows already stamped are not
-- rewritten; it pauses while a live monitored auction ends within the rule's minutes; a disabled rule writes nothing;
-- the rule is clamped; a pass that ends with NULL rows left starts another; with none left it records done_at and
-- unschedules its own job, and later runs do nothing; the gauge reports the cursor's remaining ids, a slice's NULL and
-- drift counts with their denominator, rows written and the newest write; neither function is executable by PUBLIC,
-- anon or authenticated; the migration runs twice; the revert removes the job, the functions and the rows.
-- Fixture: the shared profile fixture, the predicate, 20261126071500 itself, and, as read live on 2026-11-25,
-- platform_config's columns and keys, monitored_auctions' columns and keys, and a stand-in for pg_cron's
-- cron.job / cron.schedule / cron.unschedule (no pg_cron on this cluster).
-- guardrail-allow(center-key-fk): monitored_auctions: disposable fixture mirroring the live table, which has no foreign key on vehicle_id
\set ON_ERROR_STOP on
\if :{?bfmig}
\else
  \set bfmig ../migrations/20261126073000_organization_vehicles_readable_backfill_job.sql
\endif
\ir helpers/get_vehicle_profile_data_fixture_20261125.sql

CREATE FUNCTION public.vehicle_publicly_readable(p_is_public boolean, p_deleted_at timestamptz, p_merged_into_vehicle_id uuid)
 RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT coalesce(p_is_public, false) AND (p_deleted_at IS NULL OR p_merged_into_vehicle_id IS NOT NULL)
$function$;
REVOKE ALL ON FUNCTION public.vehicle_publicly_readable(boolean, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_publicly_readable(boolean, timestamptz, uuid) TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;

CREATE TABLE public.platform_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key text NOT NULL UNIQUE,
  config_value jsonb NOT NULL,
  description text,
  updated_at timestamp with time zone DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
CREATE TABLE public.live_auction_sources (id uuid PRIMARY KEY);
CREATE TABLE public.monitored_auctions (
  id uuid PRIMARY KEY,
  source_id uuid REFERENCES public.live_auction_sources(id) ON DELETE CASCADE,
  external_auction_id text,
  external_auction_url text,
  vehicle_id uuid,
  external_listing_id uuid,
  auction_start_time timestamp with time zone,
  auction_end_time timestamp with time zone,
  is_live boolean,
  current_bid_cents bigint,
  bid_count integer,
  high_bidder_username text,
  reserve_status text,
  is_in_soft_close boolean,
  extension_count integer,
  last_extension_at timestamp with time zone,
  last_synced_at timestamp with time zone,
  sync_latency_ms integer,
  poll_interval_ms integer,
  next_poll_at timestamp with time zone,
  last_comment_count integer,
  last_comment_synced_at timestamp with time zone,
  priority integer,
  notify_on_bid boolean,
  notify_on_extension boolean,
  watching_user_ids uuid[],
  proxy_bid_user_ids uuid[],
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  stream_state jsonb,
  UNIQUE (source_id, external_auction_id)
);
-- pg_cron stand-in: the three objects the migration and the job use.
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, schedule text, command text, jobname text UNIQUE);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS
$$ INSERT INTO cron.job (schedule, command, jobname) VALUES (p_schedule, p_command, p_name)
   ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(p_jobid bigint) RETURNS boolean LANGUAGE sql AS
$$ WITH d AS (DELETE FROM cron.job WHERE jobid = p_jobid RETURNING 1) SELECT EXISTS (SELECT 1 FROM d) $$;
CREATE FUNCTION cron.unschedule(p_name text) RETURNS boolean LANGUAGE sql AS
$$ WITH d AS (DELETE FROM cron.job WHERE jobname = p_name RETURNING 1) SELECT EXISTS (SELECT 1 FROM d) $$;

-- 0. Before 20261126071500 the migration refuses.
\set ON_ERROR_STOP off
\ir :bfmig
\set ON_ERROR_STOP on
DO $$ BEGIN
  ASSERT to_regprocedure('public.organization_vehicles_readable_backfill_run()') IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.platform_config) AND NOT EXISTS (SELECT 1 FROM cron.job),
    '0 refused before step 1: nothing created';
END $$;

-- Made-up rows in an empty disposable PG17 database, never production. Cars: 1 public, 2 private, 3 deleted unmerged.
-- 2,600 links exist before step 1 (NULL after it), spread over the three cars by id.
INSERT INTO auth.users (id) VALUES ('00000000-0000-4000-8000-00000000000a');
INSERT INTO public.profiles (id) VALUES ('00000000-0000-4000-8000-00000000000a');
INSERT INTO public.vehicles (id, is_public, deleted_at, make, model, year) VALUES
  ('11111111-1111-4111-8111-111111111111', true,  NULL,  'Fixture', 'Public', 1970),
  ('22222222-2222-4222-8222-222222222222', false, NULL,  'Fixture', 'Private', 1971),
  ('33333333-3333-4333-8333-333333333333', true,  now(), 'Fixture', 'Deleted', 1972);
INSERT INTO public.organization_vehicles (id, organization_id, vehicle_id, relationship_type, status, created_at)
SELECT md5('ov' || g)::uuid, md5('org' || (g % 7))::uuid,
       (ARRAY['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
              '33333333-3333-4333-8333-333333333333'])[1 + g % 3]::uuid,
       'dealer', 'active', now()
  FROM generate_series(1, 2600) g;

\ir ../migrations/20261126071500_organization_vehicles_vehicle_readable.sql
\ir :bfmig
\ir :bfmig

CREATE FUNCTION pg_temp.st() RETURNS jsonb LANGUAGE sql AS
$$ SELECT config_value FROM public.platform_config WHERE config_key = 'org_vehicles_readable_backfill_state' $$;
CREATE FUNCTION pg_temp.rule(p jsonb) RETURNS void LANGUAGE sql AS
$$ UPDATE public.platform_config SET config_value = config_value || p WHERE config_key = 'org_vehicles_readable_backfill' $$;
CREATE FUNCTION pg_temp.nulls() RETURNS bigint LANGUAGE sql AS
$$ SELECT count(*) FROM public.organization_vehicles WHERE vehicle_readable IS NULL $$;
CREATE FUNCTION pg_temp.wrong() RETURNS bigint LANGUAGE sql AS
$$ SELECT count(*) FROM public.organization_vehicles ov JOIN public.vehicles v ON v.id = ov.vehicle_id
   WHERE ov.vehicle_readable IS NOT NULL
     AND ov.vehicle_readable IS DISTINCT FROM public.vehicle_publicly_readable(v.is_public, v.deleted_at, v.merged_into_vehicle_id) $$;

-- 1. Scheduled once, every minute, bounded at 30 s; rule and state rows in place.
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM cron.job WHERE jobname = 'org-vehicles-readable-backfill' AND schedule = '* * * * *'
          AND command LIKE '%statement_timeout = ''30s''%organization_vehicles_readable_backfill_run()%') = 1, '1 job scheduled once';
  ASSERT (SELECT config_value FROM public.platform_config WHERE config_key = 'org_vehicles_readable_backfill')
       = '{"chunk_rows": 1000, "pause_minutes_before_close": 15, "enabled": true}', '1 rule row';
  ASSERT pg_temp.nulls() = 2600, '1 all 2,600 links NULL before the first run';
END $$;

-- 2. A run fills the first 1,000 ids in primary-key order with the car's answer and advances the cursor.
DO $$
DECLARE r jsonb; c uuid;
BEGIN
  r := public.organization_vehicles_readable_backfill_run();
  ASSERT (r ->> 'written')::int = 1000, format('2 wrote 1,000: %s', r);
  c := (SELECT id FROM public.organization_vehicles ORDER BY id OFFSET 999 LIMIT 1);
  ASSERT (pg_temp.st() ->> 'cursor')::uuid = c, '2 cursor is the 1,000th id';
  ASSERT NOT EXISTS (SELECT 1 FROM public.organization_vehicles WHERE id <= c AND vehicle_readable IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.organization_vehicles WHERE id > c AND vehicle_readable IS NOT NULL), '2 exactly the first 1,000 ids';
  ASSERT pg_temp.wrong() = 0, '2 every written value is the car''s answer';
  ASSERT (pg_temp.st() ->> 'rows_written')::int = 1000 AND (pg_temp.st() ->> 'runs')::int = 1
     AND pg_temp.st() ? 'newest_write_at', '2 state counts the run';
END $$;

-- 3. A live monitored auction ending within the rule's minutes pauses the job; one ending later does not.
INSERT INTO public.monitored_auctions (id, is_live, auction_end_time) VALUES
  ('a0000000-0000-4000-8000-000000000001', true, now() + interval '10 minutes');
DO $$
DECLARE r jsonb;
BEGIN
  r := public.organization_vehicles_readable_backfill_run();
  ASSERT r ->> 'skipped' = 'lots_near_close' AND pg_temp.nulls() = 1600, format('3 paused: %s', r);
  ASSERT pg_temp.st() ? 'paused_at', '3 the pause is recorded';
  PERFORM pg_temp.rule('{"pause_minutes_before_close": 5}');
  r := public.organization_vehicles_readable_backfill_run();
  ASSERT (r ->> 'written')::int = 1000, format('3 a lot 10 min out runs under a 5 min rule: %s', r);
  PERFORM pg_temp.rule('{"pause_minutes_before_close": 15}');
  UPDATE public.monitored_auctions SET is_live = false;
END $$;

-- 4. Disabled writes nothing; the rule is clamped (chunk 0 runs 1 row); a link already stamped is not rewritten.
DO $$
DECLARE r jsonb; n0 bigint;
BEGIN
  PERFORM pg_temp.rule('{"enabled": false}');
  r := public.organization_vehicles_readable_backfill_run();
  ASSERT r ->> 'skipped' = 'disabled' AND pg_temp.nulls() = 600, format('4 disabled: %s', r);
  PERFORM pg_temp.rule('{"enabled": true, "chunk_rows": 0}');
  r := public.organization_vehicles_readable_backfill_run();
  ASSERT (r ->> 'written')::int = 1 AND pg_temp.nulls() = 599, format('4 chunk 0 clamps to 1: %s', r);
  PERFORM pg_temp.rule('{"chunk_rows": 1000}');
END $$;

-- 5. Rows that come back NULL behind the cursor (here: written directly) are found by a second pass.
DO $$
DECLARE r jsonb; i int := 0;
BEGIN
  -- Finish the first pass.
  LOOP
    r := public.organization_vehicles_readable_backfill_run();
    i := i + 1;
    EXIT WHEN (pg_temp.st() ->> 'cursor')::uuid = (SELECT id FROM public.organization_vehicles ORDER BY id DESC LIMIT 1) OR i > 5;
  END LOOP;
  ASSERT pg_temp.nulls() = 0, '5 first pass fills every row';
  -- Two rows go NULL behind the cursor. The stamp trigger never writes NULL, so this disposable test writes them with
  -- triggers skipped for one statement (session_replication_role, local to this test database).
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.organization_vehicles SET vehicle_readable = NULL
   WHERE id IN (SELECT id FROM public.organization_vehicles ORDER BY id LIMIT 2);
  PERFORM set_config('session_replication_role', 'origin', true);
  r := public.organization_vehicles_readable_backfill_run();   -- end of pass: NULLs remain, cursor resets
  ASSERT (pg_temp.st() ->> 'passes')::int = 2 AND (pg_temp.st() ->> 'cursor')::uuid = '00000000-0000-0000-0000-000000000000'
     AND NOT pg_temp.st() ? 'done_at', format('5 a second pass starts: %s', pg_temp.st());
  ASSERT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'org-vehicles-readable-backfill'), '5 job still scheduled';
  r := public.organization_vehicles_readable_backfill_run();
  ASSERT pg_temp.nulls() = 0 AND (r ->> 'written')::int = 2, format('5 the second pass writes only the 2: %s', r);
END $$;

-- 6. At 0 NULL rows the pass's end records done_at and unschedules the job; later runs write nothing.
DO $$
DECLARE r jsonb; i int := 0; w bigint;
BEGIN
  LOOP
    r := public.organization_vehicles_readable_backfill_run();
    i := i + 1;
    EXIT WHEN pg_temp.st() ? 'done_at' OR i > 6;
  END LOOP;
  ASSERT pg_temp.st() ? 'done_at', format('6 done after %s runs: %s', i, pg_temp.st());
  ASSERT NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'org-vehicles-readable-backfill'), '6 job unscheduled';
  w := (pg_temp.st() ->> 'rows_written')::bigint;
  ASSERT w = 2602, format('6 rows written 2,600 + 2 = %s', w);
  r := public.organization_vehicles_readable_backfill_run();
  ASSERT r ->> 'skipped' = 'done' AND (pg_temp.st() ->> 'rows_written')::bigint = w, '6 a later run does nothing';
  ASSERT pg_temp.wrong() = 0, '6 every value is the car''s answer';
END $$;
-- Re-applying the migration after done does not schedule the job again.
\ir :bfmig
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'org-vehicles-readable-backfill'), '6 re-apply after done schedules nothing';
END $$;

-- 7. The gauge: remaining ids after the cursor, a slice with its denominator, its NULL and drift counts, state.
DO $$
DECLARE g jsonb;
BEGIN
  g := public.organization_vehicles_readable_backfill_gauge();
  ASSERT g ? 'slice' AND (g ->> 'slice_rows')::int >= 0 AND (g ->> 'slice_null')::int = 0 AND (g ->> 'slice_drift')::int = 0
     AND (g ->> 'job_scheduled')::boolean = false AND g ? 'done_at' AND g ? 'newest_write_at'
     AND (g ->> 'remaining_ids_after_cursor')::int >= 0, format('7 gauge: %s', g);
  -- Drift in the gauge's slice is counted (written directly, as the insert-vs-flip race would leave it).
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.organization_vehicles SET vehicle_readable = NOT vehicle_readable
   WHERE id IN (SELECT id FROM public.organization_vehicles
                 WHERE id >= (lpad(to_hex(extract(hour FROM now())::int * 10 % 256), 2, '0') || '000000-0000-0000-0000-000000000000')::uuid
                 ORDER BY id LIMIT 1);
  PERFORM set_config('session_replication_role', 'origin', true);
  g := public.organization_vehicles_readable_backfill_gauge();
  ASSERT (g ->> 'slice_rows')::int > 0 AND (g ->> 'slice_drift')::int = 1, format('7 drift counted: %s', g);
END $$;

-- 8. Neither function is executable by PUBLIC, anon or authenticated.
DO $$ BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.organization_vehicles_readable_backfill_run()', 'EXECUTE')
     AND NOT has_function_privilege('authenticated', 'public.organization_vehicles_readable_backfill_run()', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'public.organization_vehicles_readable_backfill_gauge()', 'EXECUTE')
     AND NOT has_function_privilege('authenticated', 'public.organization_vehicles_readable_backfill_gauge()', 'EXECUTE'),
    '8 EXECUTE withheld';
END $$;

-- 9. The revert removes the job, both functions and both rows.
SELECT cron.schedule('org-vehicles-readable-backfill', '* * * * *', 'SELECT 1');
\ir revert_20261126073000_organization_vehicles_readable_backfill_job.sql
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'org-vehicles-readable-backfill'), '9 job gone';
  ASSERT to_regprocedure('public.organization_vehicles_readable_backfill_run()') IS NULL
     AND to_regprocedure('public.organization_vehicles_readable_backfill_gauge()') IS NULL, '9 functions gone';
  ASSERT NOT EXISTS (SELECT 1 FROM public.platform_config WHERE config_key LIKE 'org_vehicles_readable_backfill%'), '9 rows gone';
END $$;
SELECT 'PASS: the vehicle_readable backfill job fills, pauses, finishes and unschedules itself' AS result;
