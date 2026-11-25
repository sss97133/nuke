-- Contract: 20261125235500 private_row_watch_budget_v1. On the reader-probe fixture: with the default budget every probe
-- is assessed and the readings equal the unpatched assay's; with the config row's budget at 0 no probe runs, every one is
-- listed not assessed, and the watch raises naming them; a probe that sleeps past the statement timeout is recorded
-- timed_out, every later probe not assessed, and the assay still returns; the patch applies once; the rotation visits
-- every probe; the job carries its 30 s bound. Synthetic rows.
\ir test_private_row_reader_probes.sql
CREATE TABLE public.platform_config (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), config_key text NOT NULL UNIQUE,
  config_value jsonb NOT NULL, description text, updated_at timestamptz DEFAULT now(), updated_by uuid);
-- the rotation check below needs the hour's rotated first to differ from the rank-first: when (1 + hour) is a multiple of
-- the probe count, one more (missing) probe shifts it
INSERT INTO public.private_row_probes (rank, relation, row_key, subject_kind, subject_column, owner_lane, note)
SELECT 99, 'rotation_pad', 'id', 'vehicle', 'id', 'test', 'pads the probe count off the hour'
 WHERE (1 + extract(hour FROM now())::int) % (SELECT count(*) FROM public.private_row_probes WHERE active) = 0;
CREATE TABLE public._before AS SELECT public.assay_private_row_exposure() AS r;
\ir ../migrations/20261125235500_private_row_watch_budget.sql
\ir ../migrations/20261125235500_private_row_watch_budget.sql

DO $$
DECLARE r jsonb; b jsonb; d text; n int; msg text;
BEGIN
  d := pg_get_functiondef('public.assay_private_row_exposure()'::regprocedure);
  IF (length(d) - length(replace(d, 'private_row_watch_budget_v1', ''))) / length('private_row_watch_budget_v1') <> 1 THEN
    RAISE EXCEPTION 'FAIL: patch not applied exactly once';
  END IF;

  -- default budget: every probe assessed, the same readings as before the patch (order and the new per-probe ms aside)
  r := public.assay_private_row_exposure();
  SELECT x.r INTO b FROM public._before x;
  IF jsonb_array_length(r->'not_assessed') <> 0 THEN RAISE EXCEPTION 'FAIL: default budget skipped %', r->'not_assessed'; END IF;
  IF r->'exposed_relations' <> b->'exposed_relations' OR r->'probes' <> b->'probes'
     OR (SELECT jsonb_agg(e - 'ms' ORDER BY (e - 'ms')::text) FROM jsonb_array_elements(r->'relations') e)
        <> (SELECT jsonb_agg(e ORDER BY e::text) FROM jsonb_array_elements(b->'relations') e) THEN
    RAISE EXCEPTION 'FAIL: readings changed by the patch';
  END IF;
  -- the loop visits probes in the rotated order: the first reading is the probe the hour of day puts first
  IF r->'relations'->0->>'relation' IS DISTINCT FROM (
       SELECT CASE WHEN x.reader = '' THEN x.relation ELSE x.reader || '()' END
         FROM (SELECT p.*, row_number() OVER (ORDER BY p.rank, p.relation, p.reader) rot_n, count(*) OVER () rot_count
                 FROM public.private_row_probes p WHERE p.active) x
        ORDER BY (x.rot_n + extract(hour FROM now())::int) % x.rot_count, x.rank, x.relation, x.reader LIMIT 1) THEN
    RAISE EXCEPTION 'FAIL: first probe % is not the rotated first', r->'relations'->0->>'relation';
  END IF;

  IF (r->>'budget_ms')::int <> 20000 THEN RAISE EXCEPTION 'FAIL: budget % is not the config row''s', r->>'budget_ms'; END IF;

  -- budget 0 (the config row): nothing runs, every probe listed, none counted exposed
  UPDATE public.platform_config SET config_value = '{"budget_ms": 0}' WHERE config_key = 'private_row_watch';
  r := public.assay_private_row_exposure();
  SELECT count(*) INTO n FROM public.private_row_probes WHERE active;
  IF jsonb_array_length(r->'relations') <> n OR (r->>'exposed_relations')::int <> 0
     OR jsonb_array_length(r->'not_assessed') <> (SELECT count(DISTINCT CASE WHEN reader = '' THEN relation ELSE reader || '()' END)
                                                    FROM public.private_row_probes WHERE active)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(r->'relations') e WHERE NOT coalesce((e->>'not_assessed')::boolean, false)) THEN
    RAISE EXCEPTION 'FAIL: budget 0 still ran probes: %', r;
  END IF;
  BEGIN
    PERFORM public.private_row_exposure_watch();
    RAISE EXCEPTION 'FAIL: watch green with nothing assessed';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    IF msg NOT LIKE format('private rows: exposed 0 of 0 probed, not assessed %s: not assessed (budget 0 ms%%',
                           (SELECT count(DISTINCT CASE WHEN reader = '' THEN relation ELSE reader || '()' END)
                              FROM public.private_row_probes WHERE active)) THEN RAISE; END IF;
  END;
  UPDATE public.platform_config SET config_value = '{"budget_ms": 20000}' WHERE config_key = 'private_row_watch';
END $$;

-- every assessed probe carries its own ms
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM jsonb_array_elements((public.assay_private_row_exposure())->'relations') e
              WHERE NOT coalesce((e->>'missing')::boolean, false) AND NOT coalesce((e->>'not_assessed')::boolean, false)
                AND e->>'ms' IS NULL) THEN RAISE EXCEPTION 'FAIL: an assessed probe has no ms'; END IF;
END $$;

-- the job: its command carries the 30 s bound and quiet notices, then calls the watch
DO $$ BEGIN
  IF (SELECT command FROM cron.job WHERE jobname = 'private-row-exposure-watch')
     <> $c$SET client_min_messages = error; SET statement_timeout = '30s'; SELECT public.private_row_exposure_watch()$c$ THEN
    RAISE EXCEPTION 'FAIL: job command %', (SELECT command FROM cron.job WHERE jobname = 'private-row-exposure-watch');
  END IF;
END $$;

-- a probe that outlasts the statement timeout: recorded timed_out, the rest not assessed, the assay returns
CREATE FUNCTION public.slow_feed(p_ms integer) RETURNS jsonb LANGUAGE plpgsql AS
$f$ BEGIN PERFORM pg_sleep(p_ms / 1000.0); RETURN '[]'::jsonb; END $f$;
INSERT INTO public.private_row_probes (rank, relation, row_key, subject_kind, subject_column, reader, reader_args, reader_ids, owner_lane, note)
VALUES (1, 'vehicle_images', 'id', 'image', 'id', 'slow_feed', '3000', '$[*].id', 'test', 'sleeps past the statement timeout');
CREATE TABLE public._slow (r jsonb, ms int);
INSERT INTO public._slow VALUES (NULL, NULL);
SET statement_timeout = '1s';
UPDATE public._slow SET r = public.assay_private_row_exposure(), ms = (extract(epoch FROM clock_timestamp() - statement_timestamp()) * 1000)::int;
RESET statement_timeout;
DO $$
DECLARE r jsonb; ms int; pos int; n int;
BEGIN
  SELECT x.r, x.ms INTO r, ms FROM public._slow x;
  IF r IS NULL THEN RAISE EXCEPTION 'FAIL: assay returned nothing'; END IF;
  IF r->'timed_out' <> '["slow_feed()"]' THEN RAISE EXCEPTION 'FAIL: timed_out %', r->'timed_out'; END IF;
  IF ms > 2500 THEN RAISE EXCEPTION 'FAIL: assay ran % ms after the cancel', ms; END IF;
  SELECT o INTO pos FROM jsonb_array_elements(r->'relations') WITH ORDINALITY e(v, o) WHERE v->>'relation' = 'slow_feed()';
  IF NOT coalesce((r->'relations'->(pos - 1)->>'timed_out')::boolean, false) THEN RAISE EXCEPTION 'FAIL: slow probe entry %', r->'relations'->(pos - 1); END IF;
  SELECT count(*) INTO n FROM public.private_row_probes WHERE active;
  IF jsonb_array_length(r->'relations') <> n THEN RAISE EXCEPTION 'FAIL: % entries for % probes', jsonb_array_length(r->'relations'), n; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(r->'relations') WITH ORDINALITY e(v, o)
              WHERE o > pos AND NOT coalesce((v->>'not_assessed')::boolean, false)) THEN
    RAISE EXCEPTION 'FAIL: a probe after the timed-out one ran: %', r->'relations';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(r->'relations') WITH ORDINALITY e(v, o)
              WHERE o < pos AND coalesce((v->>'not_assessed')::boolean, false)) THEN
    RAISE EXCEPTION 'FAIL: a probe before the timed-out one was skipped';
  END IF;
END $$;
SET statement_timeout = '1s';
DO $$ DECLARE msg text; BEGIN
  PERFORM public.private_row_exposure_watch();
  RAISE EXCEPTION 'FAIL: watch green with a timed-out probe';
EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
  IF msg NOT LIKE 'private rows: exposed % of % probed, not assessed %' OR msg NOT LIKE '%timed out: slow_feed()%'
     OR msg NOT LIKE '%not assessed (budget 20000 ms, ran % ms): %slow_feed()%' THEN RAISE; END IF;
END $$;
RESET statement_timeout;
UPDATE public.private_row_probes SET active = false WHERE reader = 'slow_feed';

-- rotation: across 24 hours every probe is first at least once when there are at most 24 active probes
DO $$
DECLARE firsts int;
BEGIN
  SELECT count(DISTINCT first) INTO firsts FROM (
    SELECT h, (SELECT concat_ws('|', x.rank, x.relation, x.reader, x.subject_kind, x.subject_column) FROM (SELECT p.*, row_number() OVER (ORDER BY p.rank, p.relation, p.reader) rot_n,
                       count(*) OVER () rot_count FROM public.private_row_probes p WHERE p.active) x
               ORDER BY (x.rot_n + h) % x.rot_count, x.rank, x.relation, x.reader LIMIT 1) first
    FROM generate_series(0, 23) h) s;
  IF firsts <> least(24, (SELECT count(*) FROM public.private_row_probes WHERE active)) THEN
    RAISE EXCEPTION 'FAIL: rotation leads with only % distinct probes', firsts;
  END IF;
END $$;
-- the watch replacement refuses a body it does not know
CREATE OR REPLACE FUNCTION public.private_row_exposure_watch() RETURNS jsonb LANGUAGE sql AS $f$ SELECT '{}'::jsonb $f$;
\set ON_ERROR_STOP off
\ir ../migrations/20261125235500_private_row_watch_budget.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.private_row_exposure_watch()'::regprocedure) NOT LIKE '%SELECT ''{}''::jsonb%' THEN
    RAISE EXCEPTION 'FAIL: watch replaced over an unknown body';
  END IF;
END $$;
SELECT 'private_row_watch_budget: ok';
