-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_auction_close_yield -f this-file.sql
-- Proves 20261126033500_backfill_jobs_yield_to_auction_close.sql:
--   - auction_close_yield(job) is true only for a listed job while a live lot ends within 30 minutes, ended under 15
--     minutes ago, or is in soft close and ended under 60 minutes ago. A stale soft-close or live flag alone never
--     yields, and a lot that is not live never yields.
--   - A missing or malformed rule row raises.
--   - Each job keeps its name, schedule and command prefix. While yielding, its command does not call the backfill
--     function and returns no row. Otherwise it calls the function once.
--   - Applying twice leaves one job each and keeps a tuned rule row. anon cannot execute the reader.
-- Rows are a disposable database's rows, never testimony.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.monitored_auctions') IS NOT NULL THEN
    RAISE EXCEPTION 'run only on an empty disposable PG17 database named dm_refinement_*';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

-- pg_cron stand-in: cron.schedule replaces a job of the same name, as pg_cron does.
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS
$$ INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command)
   ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command RETURNING jobid $$;

CREATE TABLE public.platform_config (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), config_key text UNIQUE, config_value jsonb,
  description text, updated_at timestamptz DEFAULT now(), updated_by uuid);
CREATE TABLE public.monitored_auctions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid,
  external_auction_id text, auction_end_time timestamptz, is_live boolean, is_in_soft_close boolean);

-- The two backfills, as stubs that log each call.
CREATE TABLE public.call_log (fn text, at timestamptz DEFAULT clock_timestamp());
CREATE FUNCTION public.data_set_grades_backfill_v1(p integer) RETURNS integer LANGUAGE sql AS
$$ INSERT INTO public.call_log (fn) VALUES ('grades') RETURNING 1 $$;
CREATE FUNCTION public.data_set_public_counts_refresh_v2(p integer) RETURNS integer LANGUAGE sql AS
$$ INSERT INTO public.call_log (fn) VALUES ('counts') RETURNING 1 $$;

-- The live jobs as they stood (cron.job, 2026-11-25 14:22Z).
SELECT cron.schedule('data-set-grades-backfill', '* * * * *',
  $c$SET client_min_messages = error; SET statement_timeout = '55s'; SET lock_timeout = '5s'; SELECT public.data_set_grades_backfill_v1(600);$c$);
SELECT cron.schedule('data-set-public-counts', '*/5 * * * *',
  $c$SET statement_timeout = '120s'; SET lock_timeout = '5s'; SELECT public.data_set_public_counts_refresh_v2(90000);$c$);

\ir ../migrations/20261126033500_backfill_jobs_yield_to_auction_close.sql
-- A tuned rule row survives a second apply.
UPDATE public.platform_config SET config_value = jsonb_set(config_value, '{minutes_before_end}', '31')
 WHERE config_key = 'auction_close_yield';
\ir ../migrations/20261126033500_backfill_jobs_yield_to_auction_close.sql
DO $$ BEGIN
  IF (SELECT (config_value ->> 'minutes_before_end')::int FROM public.platform_config WHERE config_key = 'auction_close_yield') <> 31 THEN
    RAISE EXCEPTION 'second apply overwrote the tuned rule row';
  END IF;
END $$;
UPDATE public.platform_config SET config_value = jsonb_set(config_value, '{minutes_before_end}', '30')
 WHERE config_key = 'auction_close_yield';

-- Jobs: one each, same schedule, same prefix, the yield clause on the call.
DO $$ BEGIN
  IF (SELECT count(*) FROM cron.job) <> 2 THEN RAISE EXCEPTION 'expected 2 jobs, got %', (SELECT count(*) FROM cron.job); END IF;
  IF (SELECT schedule FROM cron.job WHERE jobname = 'data-set-grades-backfill') <> '* * * * *'
     OR (SELECT schedule FROM cron.job WHERE jobname = 'data-set-public-counts') <> '*/5 * * * *' THEN
    RAISE EXCEPTION 'schedule changed';
  END IF;
  IF (SELECT command FROM cron.job WHERE jobname = 'data-set-grades-backfill') <>
     $c$SET client_min_messages = error; SET statement_timeout = '55s'; SET lock_timeout = '5s'; SELECT public.data_set_grades_backfill_v1(600) WHERE NOT public.auction_close_yield('data-set-grades-backfill');$c$ THEN
    RAISE EXCEPTION 'grades command is not the old command plus the yield clause';
  END IF;
  IF (SELECT command FROM cron.job WHERE jobname = 'data-set-public-counts') <>
     $c$SET statement_timeout = '120s'; SET lock_timeout = '5s'; SELECT public.data_set_public_counts_refresh_v2(90000) WHERE NOT public.auction_close_yield('data-set-public-counts');$c$ THEN
    RAISE EXCEPTION 'counts command is not the old command plus the yield clause';
  END IF;
END $$;

-- Grants.
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.auction_close_yield(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.auction_close_yield(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon or authenticated can execute auction_close_yield';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.auction_close_yield(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute auction_close_yield';
  END IF;
END $$;

-- The reader, case by case. Each case is one lot alone in the table.
CREATE TEMP TABLE cases (label text, end_offset interval, is_live boolean, soft boolean, want boolean);
INSERT INTO cases VALUES
  ('no lots',                         NULL,                 NULL,  NULL,  false),
  ('live, ends in 20 min',            interval '20 min',    true,  false, true),
  ('live, ends in 29 min',            interval '29 min',    true,  false, true),
  ('live, ends in 40 min',            interval '40 min',    true,  false, false),
  ('live, ended 10 min ago',          interval '-10 min',   true,  false, true),
  ('live, ended 20 min ago',          interval '-20 min',   true,  false, false),
  ('live, soft close, ended 40 min',  interval '-40 min',   true,  true,  true),
  ('live, soft close, ended 90 min',  interval '-90 min',   true,  true,  false),
  ('stale live flag, ended 3 h ago',  interval '-3 hours',  true,  false, false),
  ('not live, ends in 5 min',         interval '5 min',     false, false, false),
  ('not live, soft close, ended 5m',  interval '-5 min',    false, true,  false);

DO $$
DECLARE c record; got boolean;
BEGIN
  FOR c IN SELECT * FROM cases LOOP
    TRUNCATE public.monitored_auctions;
    IF c.end_offset IS NOT NULL THEN
      INSERT INTO public.monitored_auctions (auction_end_time, is_live, is_in_soft_close)
      VALUES (now() + c.end_offset, c.is_live, c.soft);
    END IF;
    FOREACH got IN ARRAY ARRAY[public.auction_close_yield('data-set-grades-backfill'),
                              public.auction_close_yield('data-set-public-counts')] LOOP
      IF got IS DISTINCT FROM c.want THEN
        RAISE EXCEPTION 'case "%": yield %, want %', c.label, got, c.want;
      END IF;
    END LOOP;
    IF public.auction_close_yield('retained-projection-grade') IS DISTINCT FROM c.want THEN
      RAISE EXCEPTION 'case "%": retained-projection-grade yield differs from the backfills', c.label;
    END IF;
    -- A job not in the rule row never yields.
    IF public.auction_close_yield('bat-live-pull') THEN
      RAISE EXCEPTION 'case "%": an unlisted job yielded', c.label;
    END IF;
  END LOOP;
END $$;

-- The commands themselves: yielding calls nothing, otherwise each calls its function once.
SELECT command AS grades_cmd FROM cron.job WHERE jobname = 'data-set-grades-backfill' \gset
SELECT command AS counts_cmd FROM cron.job WHERE jobname = 'data-set-public-counts' \gset

TRUNCATE public.monitored_auctions;
INSERT INTO public.monitored_auctions (auction_end_time, is_live, is_in_soft_close) VALUES (now() + interval '10 min', true, false);
:grades_cmd
:counts_cmd
RESET client_min_messages; RESET statement_timeout; RESET lock_timeout;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.call_log) <> 0 THEN
    RAISE EXCEPTION 'a backfill ran while a lot was closing (% calls)', (SELECT count(*) FROM public.call_log);
  END IF;
END $$;

TRUNCATE public.monitored_auctions;
INSERT INTO public.monitored_auctions (auction_end_time, is_live, is_in_soft_close) VALUES (now() + interval '2 hours', true, false);
:grades_cmd
:counts_cmd
RESET client_min_messages; RESET statement_timeout; RESET lock_timeout;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.call_log WHERE fn = 'grades') <> 1 OR (SELECT count(*) FROM public.call_log WHERE fn = 'counts') <> 1 THEN
    RAISE EXCEPTION 'with no lot closing each backfill must run once (grades %, counts %)',
      (SELECT count(*) FROM public.call_log WHERE fn = 'grades'), (SELECT count(*) FROM public.call_log WHERE fn = 'counts');
  END IF;
END $$;

-- A missing or malformed rule row raises.
UPDATE public.platform_config SET config_value = config_value - 'minutes_after_end' WHERE config_key = 'auction_close_yield';
DO $$ BEGIN
  PERFORM public.auction_close_yield('data-set-grades-backfill');
  RAISE EXCEPTION 'malformed rule row did not raise';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE 'auction_close_yield: rule row needs%' THEN RAISE; END IF;
END $$;
DELETE FROM public.platform_config WHERE config_key = 'auction_close_yield';
DO $$ BEGIN
  PERFORM public.auction_close_yield('data-set-grades-backfill');
  RAISE EXCEPTION 'missing rule row did not raise';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE 'auction_close_yield: rule row platform_config auction_close_yield is missing%' THEN RAISE; END IF;
END $$;

SELECT 'test_backfill_jobs_yield_to_auction_close: pass' AS result;
