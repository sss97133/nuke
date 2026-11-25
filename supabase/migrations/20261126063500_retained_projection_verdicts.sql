-- retained_projection_verdict_v1: the retained-listing matcher's answer, stored per projection with the inputs it read,
-- so a reader can use it without re-running the matcher and without reading the registry as the viewer.
--
-- WHY. vehicle_facet_items admits a retained_listing_property_projection_v1 row only when
-- retained_listing_property_result_matches(source, property, projection) is true. That matcher (25 functions, 4.3 ms a
-- row warm and about 28 ms cold as postgres) reads observation_sources, which anon cannot read, so for anon it is always
-- false (gate 20261126001500 skips it), and a logged-out visitor never sees the witnesses a public listing gives.
--
-- WHAT. One row per graded projection: admitted, body_key, input_fp, graded_at. A verdict counts only while
--   body_key = md5 over the live definitions of the matcher's call closure (recomputed from pg_proc each run, read by
--              oid at each read; a changed, dropped or recreated function changes it), and
--   input_fp = md5 over every input the closure reads that can change after the projection is written:
--     p (the source observation): xmin and ctid. Any UPDATE writes a new tuple version, so a changed p never reads as
--       unchanged; the only error is a false 'changed', which falls back to the live matcher.
--     o (the projection): is_superseded, agent_cost_cents, agent_model, the columns its immutability trigger
--       (validate_retained_listing_property_source) does not cover.
--     vehicles (p's car): id, is_public, deleted_at, listing_kind, listing_url, discovery_url, year, make, model, the
--       columns the closure reads (that row is updated often, so not by xmin).
--     observation_sources, observation_properties, schema_proposals: the whole row (small registries).
--     listing_page_snapshots, by both lookups the native-source path uses (extraction_metadata snapshot_id and
--       raw_source_ref): id, success, http_status, platform, listing_url, html_sha256, metadata, fetched_at, created_at.
--   The closure's only clock read is p.ingested_at / observed_at <= statement_timestamp(), which once true stays true;
--   a verdict counts only when both are at or before graded_at.
-- A verdict that does not count is no answer: the reader falls back to the gated live matcher. Never an error, never a
-- hidden row.
--
-- WRITER. retained_projection_grade_tick(), a procedure, every minute (job retained-projection-grade), as postgres,
-- committing per chunk inside a budget (platform_config 'retained_projection_verdicts': enabled, budget_ms, chunk,
-- sweep_rows, pause_close_minutes, pause_on_failing_jobs). Each run: pause when a live lot closes within
-- pause_close_minutes (monitored_auctions) or the last run of a named job failed (cron.job_run_details, the reading
-- v_job_health makes, at 5 ms instead of 600 ms); else
--   1. tail: projections by ingested_at (index), older than 10 minutes, after the watermark;
--   2. sweep: stored verdicts by projection_id cursor, re-fingerprinted (0.1 ms a row warm), regraded when stale;
--   3. backfill: projections by source_identifier (index idx_vobs_source_identifier_kind; 0 of 2,881 sampled
--      projections break the 'retained_listing_<key>_v1:<uuid>' form), until done.
-- The job is permanent: p, vehicles and snapshots change with no updated_at, so only the sweep finds a stale verdict.
-- Verdicts are written by this job, not by the insert trigger: a BEFORE trigger cannot reference a row not yet written,
-- and the admission it makes is not the root matcher (41 of 1,200 sampled rows are admitted and refused by the root,
-- all on hidden cars).
--
-- READ. retained_projection_verdicts_for(uuid[]) (definer, anon and authenticated execute): ids in, (id, admitted) out,
-- only for counting verdicts on a car with is_public, deleted_at IS NULL and listing_kind not non_vehicle_item. No
-- registry column leaves it. It restates the vehicles read rule, so it is registered in private_row_policy_copies.
--
-- GAUGE. retained_projection_verdict_gauge(): rows, admitted, newest graded_at, tail watermark and lag, backfill
-- cursor and done, sweep passes and stale found, last run.
--
-- REVERT. supabase/sql/revert_20261126063500_retained_projection_verdicts.sql
-- TEST. supabase/sql/test_retained_projection_verdicts.sql
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.retained_projection_verdicts (
  projection_id uuid PRIMARY KEY,
  admitted      boolean NOT NULL,
  body_key      text NOT NULL CHECK (body_key ~ '^[0-9a-f]{32}$'),
  input_fp      text NOT NULL CHECK (input_fp ~ '^[0-9a-f]{32}$'),
  graded_at     timestamptz NOT NULL
);
ALTER TABLE public.retained_projection_verdicts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.retained_projection_verdicts FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.retained_projection_verdicts IS
'retained_projection_verdict_v1: retained_listing_property_result_matches per projection, with the closure body_key and input_fp it was computed under; counts only while both still match (retained_projection_verdicts_for). Written by retained_projection_grade_tick. Migration 20261126063500.';

CREATE TABLE IF NOT EXISTS public.retained_projection_grading_state (
  id                     boolean PRIMARY KEY DEFAULT true CHECK (id),
  closure                oid[] NOT NULL DEFAULT '{}',
  tail_watermark         timestamptz,
  backfill_si            text,
  backfill_id            uuid,
  backfill_done          boolean NOT NULL DEFAULT false,
  sweep_cursor           uuid,
  sweep_passes           integer NOT NULL DEFAULT 0,
  sweep_stale_this_pass  integer NOT NULL DEFAULT 0,
  last_pass_stale        integer,
  last_pass_completed_at timestamptz,
  last_run_at            timestamptz,
  last_run               jsonb
);
ALTER TABLE public.retained_projection_grading_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.retained_projection_grading_state FROM PUBLIC, anon, authenticated;
INSERT INTO public.retained_projection_grading_state (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- The matcher's call closure: every public function whose name is called (name followed by '(') in a body already in
-- the closure, from the root. Over-inclusion (a name in a comment, every overload) only makes body_key change more often.
CREATE OR REPLACE FUNCTION public.retained_projection_closure()
RETURNS oid[] LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $f$
  WITH RECURSIVE f(oid) AS (
    SELECT 'public.retained_listing_property_result_matches(uuid,uuid,uuid)'::regprocedure::oid
    UNION
    SELECT q.oid
      FROM f JOIN pg_proc p ON p.oid = f.oid
      CROSS JOIN LATERAL (SELECT DISTINCT lower(m[1]) AS n
                            FROM regexp_matches(p.prosrc, '([A-Za-z_][A-Za-z0-9_]*)\s*\(', 'g') m) c
      JOIN pg_proc q ON q.proname = c.n AND q.pronamespace = 'public'::regnamespace AND q.prokind = 'f')
  SELECT array_agg(oid ORDER BY oid) FROM f
$f$;

-- md5 over the definitions of the given functions; NULL when any is gone (a dropped or recreated function).
CREATE OR REPLACE FUNCTION public.retained_projection_body_key(p_fns oid[])
RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $f$
  SELECT CASE WHEN count(*) = coalesce(cardinality(p_fns), 0) AND count(*) > 0 THEN
           md5(string_agg(p.oid::regprocedure::text || ':' || p.prosecdef::text || ':' || p.provolatile::text || ':'
                          || coalesce(p.proconfig::text, '') || ':' || p.prosrc, '|' ORDER BY p.oid)) END
    FROM pg_proc p WHERE p.oid = ANY (p_fns)
$f$;

-- The inputs the closure reads that can change after the projection is written (header), per projection.
-- p_time: the latest of p's ingested_at and observed_at, for the clock rule.
CREATE OR REPLACE FUNCTION public.retained_projection_input_fps(p_ids uuid[])
RETURNS TABLE (projection_id uuid, input_fp text, p_time timestamptz)
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $f$
  SELECT o.id,
         md5(concat_ws('|',
           p.xmin::text, p.ctid::text,
           ROW(o.is_superseded, o.agent_cost_cents, o.agent_model)::text,
           ROW(v.id, v.is_public, v.deleted_at, v.listing_kind, v.listing_url, v.discovery_url, v.year, v.make, v.model)::text,
           s::text, r::text, sp::text,
           ROW(n1.id, n1.success, n1.http_status, n1.platform, n1.listing_url, n1.html_sha256, n1.metadata, n1.fetched_at, n1.created_at)::text,
           ROW(n2.id, n2.success, n2.http_status, n2.platform, n2.listing_url, n2.html_sha256, n2.metadata, n2.fetched_at, n2.created_at)::text)),
         greatest(p.ingested_at, p.observed_at)
    FROM public.vehicle_observations o
    JOIN public.vehicle_observations p ON p.id = o.source_observation_id
    LEFT JOIN public.vehicles v ON v.id = p.vehicle_id
    LEFT JOIN public.observation_sources s ON s.id = p.source_id
    LEFT JOIN public.observation_properties r ON r.id = o.property_id
    LEFT JOIN public.schema_proposals sp ON sp.id = r.proposed_by_proposal_id
    LEFT JOIN public.listing_page_snapshots n1 ON n1.id = CASE
      WHEN p.extraction_metadata->>'snapshot_id' ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      THEN (p.extraction_metadata->>'snapshot_id')::uuid END
    LEFT JOIN public.listing_page_snapshots n2 ON n2.id = CASE
      WHEN p.raw_source_ref ~ '^listing_page_snapshots:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      THEN substr(p.raw_source_ref, 24)::uuid END
   WHERE o.id = ANY (p_ids)
     AND o.extraction_method = 'retained_listing_property_projection_v1'
$f$;

-- The read: (id, admitted) for each given projection with a counting verdict on a car anyone may read. A missing row
-- means no answer: the caller falls back to the gated live matcher.
CREATE OR REPLACE FUNCTION public.retained_projection_verdicts_for(p_ids uuid[])
RETURNS TABLE (projection_id uuid, admitted boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $f$
  -- retained_projection_verdict_v1
  WITH k AS MATERIALIZED (
    SELECT public.retained_projection_body_key(g.closure) AS key FROM public.retained_projection_grading_state g WHERE g.id)
  SELECT d.projection_id, d.admitted
    FROM public.retained_projection_input_fps(ARRAY(           -- fingerprint only ids that hold a verdict (PK lookups)
           SELECT x.projection_id FROM public.retained_projection_verdicts x WHERE x.projection_id = ANY (p_ids))) f
    JOIN public.retained_projection_verdicts d ON d.projection_id = f.projection_id
    JOIN public.vehicle_observations o ON o.id = f.projection_id
    JOIN public.vehicles v ON v.id = o.vehicle_id
     AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
    CROSS JOIN k
   WHERE d.body_key = k.key
     AND d.input_fp = f.input_fp
     AND (f.p_time IS NULL OR f.p_time <= d.graded_at)
$f$;

-- Grade the given projections now, as the owner: the root matcher and the fingerprint in one statement (one snapshot,
-- one statement_timestamp, which is also the clock the matcher reads).
CREATE OR REPLACE FUNCTION public.retained_projection_grade_ids(p_ids uuid[], p_key text)
RETURNS integer LANGUAGE plpgsql SET search_path = pg_catalog, public AS $f$
DECLARE n integer;
BEGIN
  IF p_key IS NULL OR coalesce(cardinality(p_ids), 0) = 0 THEN RETURN 0; END IF;
  INSERT INTO public.retained_projection_verdicts AS d (projection_id, admitted, body_key, input_fp, graded_at)
  SELECT o.id,
         coalesce(public.retained_listing_property_result_matches(o.source_observation_id, o.property_id, o.id), false),
         p_key, f.input_fp, statement_timestamp()
    FROM public.retained_projection_input_fps(p_ids) f
    JOIN public.vehicle_observations o ON o.id = f.projection_id
  ON CONFLICT (projection_id) DO UPDATE
    SET admitted = EXCLUDED.admitted, body_key = EXCLUDED.body_key, input_fp = EXCLUDED.input_fp, graded_at = EXCLUDED.graded_at;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $f$;

-- No SET clause: a procedure with one cannot COMMIT. Every name below is schema-qualified.
CREATE OR REPLACE PROCEDURE public.retained_projection_grade_tick()
LANGUAGE plpgsql AS $f$
DECLARE
  cfg jsonb := coalesce((SELECT c.config_value FROM public.platform_config c WHERE c.config_key = 'retained_projection_verdicts'), '{}');
  budget_ms int := least(greatest(CASE WHEN cfg->>'budget_ms' ~ '^\d{1,5}$' THEN (cfg->>'budget_ms')::int END, 1000), 8000);
  chunk int := least(greatest(CASE WHEN cfg->>'chunk' ~ '^\d{1,4}$' THEN (cfg->>'chunk')::int END, 10), 500);
  sweep_rows int := least(greatest(CASE WHEN cfg->>'sweep_rows' ~ '^\d{1,6}$' THEN (cfg->>'sweep_rows')::int END, 0), 100000);
  pause_min int := least(greatest(CASE WHEN cfg->>'pause_close_minutes' ~ '^\d{1,3}$' THEN (cfg->>'pause_close_minutes')::int END, 0), 240);
  jobs text[] := coalesce((SELECT array_agg(j) FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(cfg->'pause_on_failing_jobs') = 'array' THEN cfg->'pause_on_failing_jobs' END) j), '{}');
  t0 timestamptz := clock_timestamp();
  until timestamptz;
  st public.retained_projection_grading_state;
  fns oid[];
  key text;
  ids uuid[];
  batch uuid[];
  i int;
  wm_hi timestamptz;
  last_si text; last_id uuid;
  n_tail int := 0; n_backfill int := 0; n_swept int := 0; n_stale int := 0; pause text;
BEGIN
  IF budget_ms IS NULL THEN budget_ms := 7000; END IF;
  IF chunk IS NULL THEN chunk := 50; END IF;
  IF sweep_rows IS NULL THEN sweep_rows := 5000; END IF;
  IF pause_min IS NULL THEN pause_min := 15; END IF;
  until := t0 + make_interval(secs => budget_ms / 1000.0);
  IF NOT pg_try_advisory_lock(hashtextextended('retained_projection_grade_tick', 0)) THEN RETURN; END IF;
  PERFORM set_config('lock_timeout', '2s', false);

  IF coalesce(cfg->>'enabled', 'true') <> 'true' THEN
    pause := 'disabled';
  ELSIF pause_min > 0 AND to_regclass('public.monitored_auctions') IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.monitored_auctions m
       WHERE m.is_live AND m.auction_end_time BETWEEN now() AND now() + make_interval(mins => pause_min)) THEN
    pause := format('lots closing within %s min', pause_min);
  ELSIF EXISTS (
      SELECT 1 FROM cron.job j
       WHERE j.jobname = ANY (jobs)
         AND (SELECT d.status FROM cron.job_run_details d WHERE d.jobid = j.jobid ORDER BY d.runid DESC LIMIT 1) = 'failed') THEN
    pause := 'a watched job''s last run failed';
  END IF;
  IF pause IS NOT NULL THEN
    UPDATE public.retained_projection_grading_state
       SET last_run_at = t0, last_run = jsonb_build_object('paused', pause, 'ms', round(extract(epoch FROM clock_timestamp() - t0) * 1000))
     WHERE id;
    COMMIT;
    PERFORM pg_advisory_unlock(hashtextextended('retained_projection_grade_tick', 0));
    RETURN;
  END IF;

  fns := public.retained_projection_closure();
  key := public.retained_projection_body_key(fns);
  UPDATE public.retained_projection_grading_state SET closure = fns,
         tail_watermark = coalesce(tail_watermark, now() - interval '10 minutes')
   WHERE id AND (closure IS DISTINCT FROM fns OR tail_watermark IS NULL);
  COMMIT;

  -- 1. tail: new projections, 10 minutes settled (a writer's open transaction commits rows with an earlier ingested_at),
  --    a 5-minute window at a time, graded a chunk per commit
  LOOP
    EXIT WHEN clock_timestamp() >= until;
    SELECT * INTO st FROM public.retained_projection_grading_state WHERE id;
    wm_hi := least(now() - interval '10 minutes', st.tail_watermark + interval '5 minutes');
    EXIT WHEN wm_hi <= st.tail_watermark + interval '30 seconds';   -- caught up (now() moves at each COMMIT)
    SELECT array_agg(o.id ORDER BY o.id) INTO batch FROM public.vehicle_observations o
     WHERE o.ingested_at > st.tail_watermark AND o.ingested_at <= wm_hi
       AND o.extraction_method = 'retained_listing_property_projection_v1';
    i := 1;
    WHILE i <= coalesce(cardinality(batch), 0) LOOP
      n_tail := n_tail + public.retained_projection_grade_ids(batch[i:i + chunk - 1], key);
      COMMIT;
      i := i + chunk;
      EXIT WHEN clock_timestamp() >= until;
    END LOOP;
    EXIT WHEN i <= coalesce(cardinality(batch), 0);   -- out of budget inside the window: the next run redoes it (upsert)
    UPDATE public.retained_projection_grading_state SET tail_watermark = wm_hi WHERE id;
    COMMIT;
  END LOOP;

  -- 2. sweep: re-fingerprint stored verdicts in projection_id order; regrade the ones that no longer count
  WHILE n_swept < sweep_rows AND clock_timestamp() < until LOOP
    SELECT * INTO st FROM public.retained_projection_grading_state WHERE id;
    SELECT array_agg(x.projection_id ORDER BY x.projection_id) INTO batch FROM (
      SELECT d.projection_id FROM public.retained_projection_verdicts d
       WHERE st.sweep_cursor IS NULL OR d.projection_id > st.sweep_cursor
       ORDER BY d.projection_id LIMIT chunk * 10) x;
    IF batch IS NULL THEN
      UPDATE public.retained_projection_grading_state
         SET sweep_cursor = NULL, sweep_passes = sweep_passes + 1, last_pass_stale = sweep_stale_this_pass,
             sweep_stale_this_pass = 0, last_pass_completed_at = clock_timestamp() WHERE id;
      COMMIT;
      EXIT;
    END IF;
    n_swept := n_swept + cardinality(batch);
    -- a verdict whose projection is gone is removed (the reader never counts it: it joins the live row)
    DELETE FROM public.retained_projection_verdicts d WHERE d.projection_id = ANY (batch)
       AND NOT EXISTS (SELECT 1 FROM public.vehicle_observations o WHERE o.id = d.projection_id);
    SELECT array_agg(d.projection_id) INTO ids
      FROM public.retained_projection_verdicts d
      LEFT JOIN public.retained_projection_input_fps(batch) f ON f.projection_id = d.projection_id
     WHERE d.projection_id = ANY (batch)
       AND (d.body_key IS DISTINCT FROM key OR f.input_fp IS DISTINCT FROM d.input_fp
            OR (f.p_time IS NOT NULL AND f.p_time > d.graded_at));
    i := 1;
    WHILE i <= coalesce(cardinality(ids), 0) LOOP
      PERFORM public.retained_projection_grade_ids(ids[i:i + chunk - 1], key);
      COMMIT;
      i := i + chunk;
      EXIT WHEN clock_timestamp() >= until;
    END LOOP;
    n_stale := n_stale + coalesce(cardinality(ids), 0);
    EXIT WHEN i <= coalesce(cardinality(ids), 0);   -- out of budget: the cursor stays, the next run re-reads this batch
    UPDATE public.retained_projection_grading_state
       SET sweep_cursor = batch[cardinality(batch)],
           sweep_stale_this_pass = sweep_stale_this_pass + coalesce(cardinality(ids), 0)
     WHERE id;
    COMMIT;
  END LOOP;

  -- 3. backfill: every projection once, by source_identifier ('retained' .. 'retainee' bounds the prefix under the
  --    database collation; the LIKE and the method decide)
  LOOP
    EXIT WHEN clock_timestamp() >= until;
    SELECT * INTO st FROM public.retained_projection_grading_state WHERE id;
    EXIT WHEN st.backfill_done;
    SELECT array_agg(x.id), (array_agg(x.si ORDER BY x.si DESC, x.id DESC))[1], (array_agg(x.id ORDER BY x.si DESC, x.id DESC))[1]
      INTO ids, last_si, last_id
      FROM (SELECT o.id, o.source_identifier AS si FROM public.vehicle_observations o
             WHERE o.source_identifier >= coalesce(st.backfill_si, 'retained') AND o.source_identifier < 'retainee'
               AND (st.backfill_si IS NULL OR (o.source_identifier, o.id) > (st.backfill_si, st.backfill_id))
               AND o.source_identifier LIKE 'retained\_listing\_%'
               AND o.extraction_method = 'retained_listing_property_projection_v1'
             ORDER BY o.source_identifier, o.id LIMIT chunk) x;
    IF ids IS NULL THEN
      UPDATE public.retained_projection_grading_state SET backfill_done = true WHERE id;
      COMMIT;
      EXIT;
    END IF;
    SELECT array_agg(u.pid) INTO ids FROM unnest(ids) u(pid)
     WHERE NOT EXISTS (SELECT 1 FROM public.retained_projection_verdicts d WHERE d.projection_id = u.pid);
    n_backfill := n_backfill + public.retained_projection_grade_ids(ids, key);
    UPDATE public.retained_projection_grading_state SET backfill_si = last_si, backfill_id = last_id WHERE id;
    COMMIT;
  END LOOP;

  UPDATE public.retained_projection_grading_state
     SET last_run_at = t0,
         last_run = jsonb_build_object('tail', n_tail, 'swept', n_swept, 'stale', n_stale, 'backfill', n_backfill,
                                       'ms', round(extract(epoch FROM clock_timestamp() - t0) * 1000))
   WHERE id;
  COMMIT;
  PERFORM pg_advisory_unlock(hashtextextended('retained_projection_grade_tick', 0));
END $f$;

CREATE OR REPLACE FUNCTION public.retained_projection_verdict_gauge()
RETURNS jsonb LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $f$
  SELECT jsonb_build_object(
    'verdicts', (SELECT count(*) FROM public.retained_projection_verdicts),
    'admitted', (SELECT count(*) FROM public.retained_projection_verdicts WHERE admitted),
    'newest_graded_at', (SELECT max(graded_at) FROM public.retained_projection_verdicts),
    'tail_watermark', g.tail_watermark,
    'tail_lag_minutes', round(extract(epoch FROM now() - g.tail_watermark) / 60),
    'backfill_done', g.backfill_done,
    'backfill_at', g.backfill_si,
    'sweep_passes', g.sweep_passes,
    'last_pass_stale', g.last_pass_stale,
    'last_pass_completed_at', g.last_pass_completed_at,
    'closure_functions', cardinality(g.closure),
    'body_key_live', public.retained_projection_body_key(g.closure) IS NOT NULL,
    'last_run_at', g.last_run_at,
    'last_run', g.last_run)
  FROM public.retained_projection_grading_state g WHERE g.id
$f$;

REVOKE ALL ON FUNCTION public.retained_projection_closure() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.retained_projection_body_key(oid[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.retained_projection_input_fps(uuid[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.retained_projection_grade_ids(uuid[], text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON PROCEDURE public.retained_projection_grade_tick() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.retained_projection_verdict_gauge() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retained_projection_verdicts_for(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retained_projection_verdicts_for(uuid[]) TO anon, authenticated;

INSERT INTO public.platform_config (config_key, config_value, description)
VALUES ('retained_projection_verdicts',
        '{"enabled": true, "budget_ms": 7000, "chunk": 50, "sweep_rows": 5000, "pause_close_minutes": 15, "pause_on_failing_jobs": ["bat-live-pull"]}'::jsonb,
        'retained_projection_verdict_v1: retained_projection_grade_tick() (job retained-projection-grade, every minute). budget_ms caps a run (max 8000 under the 10 s role timeout); chunk = projections graded per commit (50 x 28 ms cold = 1.4 s); sweep_rows = verdicts re-fingerprinted per run (5000 x 0.1 ms warm); pauses while a live lot closes within pause_close_minutes or the last run of a pause_on_failing_jobs job failed. Migration 20261126063500.')
ON CONFLICT (config_key) DO NOTHING;

-- The read restates the vehicles read rule for anon (is_public, plus deleted_at and listing_kind as the matcher does).
DO $copy$
BEGIN
  IF to_regclass('public.private_row_policy_copies') IS NOT NULL THEN
    INSERT INTO public.private_row_policy_copies (reader, relation, policy_filter, recorded_hash, owner_lane, note)
    SELECT 'retained_projection_verdicts_for(uuid[])', 'vehicles', 'p.cmd IN (''SELECT'', ''ALL'')', h.policy_hash, 'ta-readers',
           '20261126063500 restates vehicles_public_select (is_public, with deleted_at and listing_kind as the matcher) for anon'
      FROM public.private_row_policy_hash('vehicles', 'p.cmd IN (''SELECT'', ''ALL'')') h
     WHERE h.policy_hash = '7773d11e280e80abad0422000a1ff9cc' OR current_database() LIKE 'dm_%'
    ON CONFLICT (reader, relation, policy_filter) DO NOTHING;
    IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM public.private_row_policy_copies
                                  WHERE reader = 'retained_projection_verdicts_for(uuid[])' AND relation = 'vehicles') THEN
      RAISE EXCEPTION 'vehicles read policies changed since 2026-11-25 (hash 7773d11e...); re-read before recording the copy';
    END IF;
  END IF;
END $copy$;

DO $job$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retained-projection-grade') THEN
      PERFORM cron.unschedule('retained-projection-grade');
    END IF;
    PERFORM cron.schedule('retained-projection-grade', '* * * * *', 'CALL public.retained_projection_grade_tick()');
  END IF;
END $job$;
