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
-- sweep_rows_min, sweep_rows_max, target_miss_share, census_rows, pause_close_minutes, watch, tick_seconds,
-- stall_minutes, max_paused_ticks). Each run: pause when a live lot closes within pause_close_minutes
-- (monitored_auctions), or a watch job's last run failed or ran past its max_run_seconds (cron.job_run_details: what
-- this work can slow, never the job's coverage assay); else
--   1. tail: projections by ingested_at (index), older than 10 minutes, after the watermark;
--   2. sweep: stored verdicts by projection_id cursor, re-fingerprinted (0.1 ms a row warm), regraded when stale. A
--      read never serves a stale verdict (the read recomputes input_fp); the sweep keeps the hit rate up, sized by the
--      measured miss rate (rows a run = stale per minute / (2 x target_miss_share));
--   3. census, then backfill by key: the census counts each car's projections once by source_identifier keyset
--      (index idx_vobs_source_identifier_kind; 0 of 2,881 sampled projections break the
--      'retained_listing_<key>_v1:<uuid>' form) into retained_projection_backfill_cars; then cars are graded in key
--      order, publicly readable first, most projections first. Progress: v_retained_projection_backfill (graded /
--      eligible cars, newest graded_at, status 'stalled' when nothing moved in 30 minutes), written each run as the
--      job's own assay row in job_assay_readings, which v_job_health reads; a pause longer than max_paused_ticks
--      reads 'paused_too_long' (red).
-- The job is permanent: p, vehicles and snapshots change with no updated_at, so only the sweep finds a stale verdict.
-- Verdicts are written by this job, not by the insert trigger: a BEFORE trigger cannot reference a row not yet written,
-- and the admission it makes is not the root matcher (41 of 1,200 sampled rows are admitted and refused by the root,
-- all on hidden cars).
--
-- READ. retained_projection_verdicts_for(uuid[]) (definer, anon and authenticated execute): ids in, (id, admitted) out,
-- only for counting verdicts on a car with is_public, deleted_at IS NULL and listing_kind not non_vehicle_item, whose
-- source observation anon can read (its car public and observation_is_public, or the broadcast source; no private
-- method), so a direct call is no oracle for a source the caller cannot read. No registry column leaves it. It
-- restates the vehicles and vehicle_observations read rules, so both are registered in private_row_policy_copies.
--
-- GAUGE. retained_projection_verdict_gauge(): graded, remaining, newest graded_at, and the share of reads served from
-- a verdict (estimated from the job's own counts: coverage x verdicts not waiting stale); then the miss rate, pass
-- length, tail lag, backfill cursor and last run.
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
  census_si              text,
  census_id              uuid,
  census_done            boolean NOT NULL DEFAULT false,
  backfill_done          boolean NOT NULL DEFAULT false,
  backfill_progress_at   timestamptz,
  paused_since           timestamptz,
  sweep_cursor           uuid,
  sweep_passes           integer NOT NULL DEFAULT 0,
  sweep_stale_this_pass  integer NOT NULL DEFAULT 0,
  sweep_rows_this_pass   integer NOT NULL DEFAULT 0,
  sweep_pass_started_at  timestamptz,
  last_pass_stale        integer,
  last_pass_rows         integer,
  last_pass_minutes      numeric,
  last_pass_completed_at timestamptz,
  last_run_at            timestamptz,
  last_run               jsonb
);

-- The backfill order is a key, not arrival order: one row per car holding retained projections (counted once by the
-- census), graded car by car, publicly readable cars first, most projections first (those time out through the live
-- matcher today). public_readable is the car's state at census time, an ordering key only; eligibility in the
-- progress view is read live from vehicles.
CREATE TABLE IF NOT EXISTS public.retained_projection_backfill_cars (
  vehicle_id      uuid PRIMARY KEY REFERENCES public.vehicles (id) ON DELETE CASCADE,
  projections     integer NOT NULL CHECK (projections >= 0),
  public_readable boolean NOT NULL,
  censused_at     timestamptz NOT NULL,
  graded_at       timestamptz
);
CREATE INDEX IF NOT EXISTS retained_projection_backfill_cars_next
  ON public.retained_projection_backfill_cars (public_readable DESC, projections DESC, vehicle_id) WHERE graded_at IS NULL;
ALTER TABLE public.retained_projection_backfill_cars ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.retained_projection_backfill_cars FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS retained_projection_verdicts_graded_at ON public.retained_projection_verdicts (graded_at);
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
    JOIN public.vehicle_observations p ON p.id = o.source_observation_id
    LEFT JOIN public.vehicles pv ON pv.id = p.vehicle_id
    CROSS JOIN k
   WHERE d.body_key = k.key
     -- the source observation as anon reads it (vehicle_observations read policies, hash 16c9e48f...): a permissive
     -- term (its car public and observation_is_public, or the broadcast source) and no restrictive private method
     AND ((pv.is_public IS TRUE AND public.observation_is_public(p.kind, p.structured_data))
          OR p.source_id = 'e980c7bd-404f-41f6-8a17-1c7cabd1d8a4')
     AND coalesce(p.extraction_method, '') <> ALL (ARRAY['garage_owner_correction_v1', 'owner_statement_v1',
           'owner_statement_org_link_v1', 'vehicle_statement_v1', 'work_order_payment_witness_sign_v1'])
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

-- Backfill progress as one row: graded cars / eligible cars (publicly readable, live), newest graded_at, and a status
-- that turns 'stalled' (red) when cars remain and neither the census nor the backfill has moved in 30 minutes while
-- the job is not paused. The job writes this row as its own assay (job_assay_readings 'retained-projection-grade'),
-- which v_job_health reads.
CREATE OR REPLACE VIEW public.v_retained_projection_backfill WITH (security_invoker = true) AS
WITH g AS (SELECT * FROM public.retained_projection_grading_state WHERE id),
rule AS (   -- typed thresholds from the rule row (platform_config 'retained_projection_verdicts'), defaults if absent
  SELECT make_interval(mins => CASE WHEN c->>'stall_minutes' ~ '^\d{1,4}$' THEN (c->>'stall_minutes')::int ELSE 30 END) AS stall_after,
         make_interval(secs => (CASE WHEN c->>'max_paused_ticks' ~ '^\d{1,5}$' THEN (c->>'max_paused_ticks')::int ELSE 60 END)
                               * (CASE WHEN c->>'tick_seconds' ~ '^\d{1,4}$' THEN (c->>'tick_seconds')::int ELSE 60 END)) AS paused_after
    FROM (SELECT coalesce((SELECT pc.config_value FROM public.platform_config pc WHERE pc.config_key = 'retained_projection_verdicts'),
                          '{}'::jsonb) AS c) x),
c AS (
  SELECT count(*) AS cars,
         count(*) FILTER (WHERE e.eligible) AS eligible_cars,
         count(*) FILTER (WHERE e.eligible AND b.graded_at IS NOT NULL) AS graded_eligible_cars,
         count(*) FILTER (WHERE b.graded_at IS NOT NULL) AS graded_cars,
         coalesce(sum(b.projections) FILTER (WHERE e.eligible), 0) AS eligible_projections,
         coalesce(sum(b.projections) FILTER (WHERE e.eligible AND b.graded_at IS NOT NULL), 0) AS graded_eligible_projections
    FROM public.retained_projection_backfill_cars b
    LEFT JOIN public.vehicles v ON v.id = b.vehicle_id
   CROSS JOIN LATERAL (SELECT (v.is_public IS TRUE AND v.deleted_at IS NULL
                               AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item') AS eligible) e)
SELECT CASE WHEN NOT g.census_done THEN 'census' WHEN NOT g.backfill_done THEN 'grading' ELSE 'done' END AS phase,
       c.cars, c.eligible_cars, c.graded_eligible_cars, c.graded_cars, c.eligible_projections, c.graded_eligible_projections,
       g.census_si AS census_at_key,
       (SELECT max(d.graded_at) FROM public.retained_projection_verdicts d) AS newest_graded_at,
       g.backfill_progress_at,
       g.last_run_at,
       g.last_run->>'paused' AS paused,
       g.paused_since,
       rule.stall_after, rule.paused_after,
       CASE WHEN g.paused_since IS NOT NULL AND g.paused_since < statement_timestamp() - rule.paused_after THEN 'paused_too_long'
            WHEN g.census_done AND g.backfill_done THEN 'done'
            WHEN g.paused_since IS NOT NULL THEN 'paused'
            WHEN g.backfill_progress_at IS NULL OR g.backfill_progress_at < statement_timestamp() - rule.stall_after THEN 'stalled'
            ELSE 'running' END AS status
  FROM g, c, rule;
REVOKE ALL ON public.v_retained_projection_backfill FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.retained_projection_record_assay(p_started timestamptz)
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, public AS $f$
DECLARE r jsonb;
BEGIN
  IF to_regclass('public.job_assay_readings') IS NULL THEN RETURN; END IF;
  SELECT to_jsonb(b) INTO r FROM public.v_retained_projection_backfill b;
  r := r || jsonb_build_object('status', CASE r->>'status' WHEN 'stalled' THEN 'failed' WHEN 'paused_too_long' THEN 'failed'
                                                           WHEN 'paused' THEN 'paused' ELSE 'passed' END,
                               'backfill_status', r->>'status');
  INSERT INTO public.job_assay_readings (jobname, reading, assayed_at, elapsed_ms, attempted_at, attempt_error, refresh_every, fresh_for)
  VALUES ('retained-projection-grade', r, now(), greatest(0, round(extract(epoch FROM clock_timestamp() - p_started) * 1000))::integer,
          now(), NULL, interval '1 minute', interval '5 minutes')
  ON CONFLICT (jobname) DO UPDATE SET reading = EXCLUDED.reading, assayed_at = EXCLUDED.assayed_at, elapsed_ms = EXCLUDED.elapsed_ms,
         attempted_at = EXCLUDED.attempted_at, attempt_error = NULL, refresh_every = EXCLUDED.refresh_every, fresh_for = EXCLUDED.fresh_for;
END $f$;
REVOKE ALL ON FUNCTION public.retained_projection_record_assay(timestamptz) FROM PUBLIC, anon, authenticated;

-- No SET clause: a procedure with one cannot COMMIT. Every name below is schema-qualified.
CREATE OR REPLACE PROCEDURE public.retained_projection_grade_tick()
LANGUAGE plpgsql AS $f$
DECLARE
  cfg jsonb := coalesce((SELECT c.config_value FROM public.platform_config c WHERE c.config_key = 'retained_projection_verdicts'), '{}');
  budget_ms int := least(greatest(CASE WHEN cfg->>'budget_ms' ~ '^\d{1,5}$' THEN (cfg->>'budget_ms')::int END, 1000), 5000);
  chunk int := least(greatest(CASE WHEN cfg->>'chunk' ~ '^\d{1,4}$' THEN (cfg->>'chunk')::int END, 10), 500);
  sweep_min int := least(greatest(CASE WHEN cfg->>'sweep_rows_min' ~ '^\d{1,6}$' THEN (cfg->>'sweep_rows_min')::int END, 0), 100000);
  sweep_max int := least(greatest(CASE WHEN cfg->>'sweep_rows_max' ~ '^\d{1,6}$' THEN (cfg->>'sweep_rows_max')::int END, 0), 200000);
  target numeric := least(greatest(CASE WHEN cfg->>'target_miss_share' ~ '^0?\.\d{1,6}$' THEN (cfg->>'target_miss_share')::numeric END, 0.0001), 0.5);
  sweep_rows int;
  pause_min int := least(greatest(CASE WHEN cfg->>'pause_close_minutes' ~ '^\d{1,3}$' THEN (cfg->>'pause_close_minutes')::int END, 0), 240);
  -- watch rows: {"job": <cron jobname>, "max_run_seconds": n, "pause_on_failed_run": bool}; the signals are the job's
  -- own runs (a failed last run, a run longer than max_run_seconds or one still running past it), never its assay
  watch jsonb := CASE WHEN jsonb_typeof(cfg->'watch') = 'array' THEN cfg->'watch' ELSE '[]'::jsonb END;
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
  n_tail int := 0; n_backfill int := 0; n_census int := 0; n_cars int := 0; n_swept int := 0; n_stale int := 0; pause text;
  census_rows int := least(greatest(CASE WHEN cfg->>'census_rows' ~ '^\d{1,5}$' THEN (cfg->>'census_rows')::int END, 100), 10000);
  vids uuid[]; car uuid; n int;
BEGIN
  -- The role's 10 s statement_timeout covers the whole CALL (a COMMIT inside does not re-arm it). Work starts only
  -- inside a 5 s budget, and a step (a fingerprint batch, 0.85-1.4 s per 500 live; a chunk, 50 x 28 ms cold) starts
  -- only with 2.5 s of budget left, so the last one ends by about 7.5 s.
  IF budget_ms IS NULL THEN budget_ms := 5000; END IF;
  IF chunk IS NULL THEN chunk := 50; END IF;
  IF sweep_min IS NULL THEN sweep_min := 1000; END IF;
  IF sweep_max IS NULL OR sweep_max < sweep_min THEN sweep_max := greatest(sweep_min, 50000); END IF;
  IF target IS NULL THEN target := 0.01; END IF;
  IF pause_min IS NULL THEN pause_min := 15; END IF;
  until := t0 + make_interval(secs => budget_ms / 1000.0) - interval '2.5 seconds';   -- the last moment a step may start
  IF NOT pg_try_advisory_lock(hashtextextended('retained_projection_grade_tick', 0)) THEN RETURN; END IF;
  PERFORM set_config('lock_timeout', '2s', false);

  -- (each optional relation is tested in its own IF: plpgsql plans a whole condition, so a guard in the same
  --  expression would not stop a missing relation from failing the plan)
  IF coalesce(cfg->>'enabled', 'true') <> 'true' THEN
    pause := 'disabled';
  END IF;
  IF pause IS NULL AND pause_min > 0 AND to_regclass('public.monitored_auctions') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.monitored_auctions m
                WHERE m.is_live AND m.auction_end_time BETWEEN now() AND now() + make_interval(mins => pause_min)) THEN
      pause := format('lots closing within %s min', pause_min);
    END IF;
  END IF;
  IF pause IS NULL THEN
    SELECT format('%s: %s', w->>'job', CASE WHEN r.status = 'failed' THEN 'last run failed' ELSE 'run over max_run_seconds' END)
      INTO pause
      FROM jsonb_array_elements(watch) w
      JOIN cron.job j ON j.jobname = w->>'job'
      CROSS JOIN LATERAL (SELECT d.status, d.start_time, d.end_time FROM cron.job_run_details d
                           WHERE d.jobid = j.jobid ORDER BY d.runid DESC LIMIT 1) r
     WHERE (coalesce((w->>'pause_on_failed_run')::boolean, true) AND r.status = 'failed')
        OR (w->>'max_run_seconds' ~ '^\d{1,5}$'
            AND extract(epoch FROM coalesce(r.end_time, clock_timestamp()) - r.start_time) > (w->>'max_run_seconds')::int)
     LIMIT 1;
  END IF;
  IF pause IS NOT NULL THEN
    UPDATE public.retained_projection_grading_state
       SET last_run_at = t0, last_run = jsonb_build_object('paused', pause, 'ms', round(extract(epoch FROM clock_timestamp() - t0) * 1000)),
           paused_since = coalesce(paused_since, t0)
     WHERE id;
    PERFORM public.retained_projection_record_assay(t0);
    COMMIT;
    PERFORM pg_advisory_unlock(hashtextextended('retained_projection_grade_tick', 0));
    RETURN;
  END IF;

  fns := public.retained_projection_closure();
  key := public.retained_projection_body_key(fns);
  UPDATE public.retained_projection_grading_state SET closure = fns,
         tail_watermark = coalesce(tail_watermark, now() - interval '10 minutes'), paused_since = NULL
   WHERE id AND (closure IS DISTINCT FROM fns OR tail_watermark IS NULL OR paused_since IS NOT NULL);
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
    WHILE i <= coalesce(cardinality(batch), 0) AND clock_timestamp() < until LOOP
      n_tail := n_tail + public.retained_projection_grade_ids(batch[i:i + chunk - 1], key);
      COMMIT;
      i := i + chunk;
    END LOOP;
    EXIT WHEN i <= coalesce(cardinality(batch), 0);   -- out of budget inside the window: the next run redoes it (upsert)
    UPDATE public.retained_projection_grading_state SET tail_watermark = wm_hi WHERE id;
    COMMIT;
  END LOOP;

  -- 2. sweep: re-fingerprint stored verdicts in projection_id order; regrade the ones that no longer count. A read never
  --    serves a stale verdict (verdicts_for recomputes input_fp), so the sweep only keeps the hit rate up. It is sized by
  --    the measured miss rate: with s verdicts going stale a minute and a pass of P minutes, about s*P/2 of them wait
  --    stale; holding that under target_miss_share of the V verdicts takes V/P = s/(2*target) rows a minute.
  SELECT * INTO st FROM public.retained_projection_grading_state WHERE id;
  sweep_rows := least(greatest(sweep_min,
                  CASE WHEN st.last_pass_minutes > 0 AND st.last_pass_stale IS NOT NULL
                       THEN ceil(st.last_pass_stale / st.last_pass_minutes / (2 * target))::int END), sweep_max);
  IF st.sweep_pass_started_at IS NULL THEN
    UPDATE public.retained_projection_grading_state SET sweep_pass_started_at = clock_timestamp() WHERE id;
    COMMIT;
  END IF;
  WHILE n_swept < sweep_rows AND clock_timestamp() < until LOOP
    SELECT * INTO st FROM public.retained_projection_grading_state WHERE id;
    SELECT array_agg(x.projection_id ORDER BY x.projection_id) INTO batch FROM (
      SELECT d.projection_id FROM public.retained_projection_verdicts d
       WHERE st.sweep_cursor IS NULL OR d.projection_id > st.sweep_cursor
       ORDER BY d.projection_id LIMIT chunk * 10) x;
    IF batch IS NULL THEN
      UPDATE public.retained_projection_grading_state
         SET sweep_cursor = NULL, sweep_passes = sweep_passes + 1, last_pass_stale = sweep_stale_this_pass,
             last_pass_rows = sweep_rows_this_pass,
             last_pass_minutes = round(extract(epoch FROM clock_timestamp() - coalesce(sweep_pass_started_at, clock_timestamp())) / 60, 3),
             sweep_stale_this_pass = 0, sweep_rows_this_pass = 0, sweep_pass_started_at = clock_timestamp(),
             last_pass_completed_at = clock_timestamp() WHERE id;
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
    WHILE i <= coalesce(cardinality(ids), 0) AND clock_timestamp() < until LOOP
      PERFORM public.retained_projection_grade_ids(ids[i:i + chunk - 1], key);
      COMMIT;
      i := i + chunk;
    END LOOP;
    n_stale := n_stale + coalesce(cardinality(ids), 0);
    EXIT WHEN i <= coalesce(cardinality(ids), 0);   -- out of budget: the cursor stays, the next run re-reads this batch
    UPDATE public.retained_projection_grading_state
       SET sweep_cursor = batch[cardinality(batch)],
           sweep_stale_this_pass = sweep_stale_this_pass + coalesce(cardinality(ids), 0),
           sweep_rows_this_pass = sweep_rows_this_pass + cardinality(batch)
     WHERE id;
    COMMIT;
  END LOOP;

  -- 3a. census: count each car's projections once, by source_identifier keyset ('retained' .. 'retainee' bounds the
  --     prefix under the database collation; the LIKE and the method decide). 2,000 rows: 1.4 s cold, 18 ms warm.
  LOOP
    EXIT WHEN clock_timestamp() >= until;
    SELECT * INTO st FROM public.retained_projection_grading_state WHERE id;
    EXIT WHEN st.census_done;
    SELECT array_agg(x.vehicle_id), (array_agg(x.si ORDER BY x.si DESC, x.id DESC))[1], (array_agg(x.id ORDER BY x.si DESC, x.id DESC))[1], count(*)
      INTO vids, last_si, last_id, n
      FROM (SELECT o.id, o.source_identifier AS si, o.vehicle_id FROM public.vehicle_observations o
             WHERE o.source_identifier >= coalesce(st.census_si, 'retained') AND o.source_identifier < 'retainee'
               AND (st.census_si IS NULL OR (o.source_identifier, o.id) > (st.census_si, st.census_id))
               AND o.source_identifier LIKE 'retained\_listing\_%'
               AND o.extraction_method = 'retained_listing_property_projection_v1'
             ORDER BY o.source_identifier, o.id LIMIT census_rows) x;
    IF n = 0 THEN
      UPDATE public.retained_projection_grading_state SET census_done = true, backfill_progress_at = clock_timestamp() WHERE id;
      COMMIT;
      EXIT;
    END IF;
    INSERT INTO public.retained_projection_backfill_cars AS b (vehicle_id, projections, public_readable, censused_at)
    SELECT u.v, count(*), bool_or(v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'),
           clock_timestamp()
      FROM unnest(vids) u(v) JOIN public.vehicles v ON v.id = u.v
     GROUP BY u.v
    ON CONFLICT (vehicle_id) DO UPDATE SET projections = b.projections + EXCLUDED.projections, censused_at = EXCLUDED.censused_at;
    n_census := n_census + n;
    UPDATE public.retained_projection_grading_state
       SET census_si = last_si, census_id = last_id, backfill_progress_at = clock_timestamp() WHERE id;
    COMMIT;
  END LOOP;

  -- 3b. backfill: after the census, car by car in key order (publicly readable first, most projections first), a chunk
  --     of the car's ungraded projections per commit, superseded ones included (unmerge_vehicle can un-supersede a
  --     projection with its old ingested_at, which the tail never sees; its verdict, with o.is_superseded in input_fp,
  --     goes stale and the sweep regrades it); a car with none left is marked graded.
  LOOP
    EXIT WHEN clock_timestamp() >= until;
    SELECT * INTO st FROM public.retained_projection_grading_state WHERE id;
    EXIT WHEN NOT st.census_done OR st.backfill_done;
    SELECT b.vehicle_id INTO car FROM public.retained_projection_backfill_cars b
     WHERE b.graded_at IS NULL ORDER BY b.public_readable DESC, b.projections DESC, b.vehicle_id LIMIT 1;
    IF car IS NULL THEN
      UPDATE public.retained_projection_grading_state SET backfill_done = true, backfill_progress_at = clock_timestamp() WHERE id;
      COMMIT;
      EXIT;
    END IF;
    SELECT array_agg(x.id) INTO ids FROM (
      SELECT o.id FROM public.vehicle_observations o
       WHERE o.vehicle_id = car AND o.extraction_method = 'retained_listing_property_projection_v1'
         AND NOT EXISTS (SELECT 1 FROM public.retained_projection_verdicts d WHERE d.projection_id = o.id)
       LIMIT chunk) x;
    IF ids IS NULL THEN
      UPDATE public.retained_projection_backfill_cars SET graded_at = clock_timestamp() WHERE vehicle_id = car;
      n_cars := n_cars + 1;
    ELSE
      n_backfill := n_backfill + public.retained_projection_grade_ids(ids, key);
    END IF;
    UPDATE public.retained_projection_grading_state SET backfill_progress_at = clock_timestamp() WHERE id;
    COMMIT;
    car := NULL;
  END LOOP;

  UPDATE public.retained_projection_grading_state
     SET last_run_at = t0,
         last_run = jsonb_build_object('tail', n_tail, 'swept', n_swept, 'sweep_rows', sweep_rows, 'stale', n_stale,
                                       'census', n_census, 'backfill', n_backfill, 'cars_graded', n_cars,
                                       'ms', round(extract(epoch FROM clock_timestamp() - t0) * 1000))
   WHERE id;
  PERFORM public.retained_projection_record_assay(t0);
  COMMIT;
  PERFORM pg_advisory_unlock(hashtextextended('retained_projection_grade_tick', 0));
END $f$;

CREATE OR REPLACE FUNCTION public.retained_projection_verdict_gauge()
RETURNS jsonb LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $f$
  -- Four numbers: graded, remaining, newest write, share of reads served from a verdict. The last is derived from the
  -- job's own counts, never counted at read time: coverage (graded / projections, a pg_stats estimate) times the
  -- share of verdicts not waiting stale (stale per minute x pass minutes / 2, over graded).
  WITH g AS (SELECT * FROM public.retained_projection_grading_state WHERE id),
  n AS (SELECT count(*) AS graded, count(*) FILTER (WHERE admitted) AS admitted, max(graded_at) AS newest
          FROM public.retained_projection_verdicts),
  est AS (
    SELECT round(c.reltuples::numeric * coalesce(s.most_common_freqs[array_position(s.most_common_vals::text::text[],
                 'retained_listing_property_projection_v1')], 0)::numeric) AS projections
      FROM pg_class c LEFT JOIN pg_stats s
        ON s.schemaname = 'public' AND s.tablename = 'vehicle_observations' AND s.attname = 'extraction_method'
     WHERE c.oid = 'public.vehicle_observations'::regclass),
  r AS (
    SELECT CASE WHEN g.last_pass_minutes > 0 THEN g.last_pass_stale / g.last_pass_minutes END AS stale_per_min,
           CASE WHEN g.last_pass_rows > 0 THEN round(g.last_pass_stale::numeric / g.last_pass_rows, 4) END AS pass_miss_share
      FROM g)
  SELECT jsonb_build_object(
    'graded', n.graded,
    'remaining', CASE WHEN g.backfill_done THEN 0 ELSE greatest(est.projections - n.graded, 0) END,
    'remaining_is_estimate', NOT g.backfill_done,
    'backfill', (SELECT to_jsonb(b) FROM public.v_retained_projection_backfill b),
    'newest_graded_at', n.newest,
    'served_from_verdict_share_est', CASE WHEN est.projections > 0 AND n.graded > 0 THEN round(
        least(n.graded / est.projections, 1)
        * greatest(1 - coalesce(r.stale_per_min * g.last_pass_minutes / 2, 0) / n.graded, 0), 4) END,
    'admitted', n.admitted,
    'projections_est', est.projections,
    'last_pass_miss_share', r.pass_miss_share,
    'stale_per_minute', round(r.stale_per_min, 2),
    'last_pass_minutes', g.last_pass_minutes,
    'sweep_passes', g.sweep_passes,
    'last_pass_completed_at', g.last_pass_completed_at,
    'tail_watermark', g.tail_watermark,
    'tail_lag_minutes', round(extract(epoch FROM now() - g.tail_watermark) / 60),
    'backfill_done', g.backfill_done,
    'census_done', g.census_done,
    'closure_functions', cardinality(g.closure),
    'body_key_live', public.retained_projection_body_key(g.closure) IS NOT NULL,
    'last_run_at', g.last_run_at,
    'last_run', g.last_run)
  FROM g, n, est, r
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
        '{"enabled": true, "budget_ms": 5000, "chunk": 50, "sweep_rows_min": 1000, "sweep_rows_max": 50000, "target_miss_share": 0.01, "census_rows": 2000, "pause_close_minutes": 15, "tick_seconds": 60, "stall_minutes": 30, "stall_basis": "a step (2,000-row census step 1.4 s cold; a 50-projection chunk 1.4 s cold) fits every 60 s tick, so 30 ticks with no census or backfill movement is a stall, not a slow step", "max_paused_ticks": 60, "max_paused_basis": "lots close in bursts and pause_close_minutes is 15; 60 consecutive paused ticks (1 h) is a pause that will not clear by itself", "watch": [{"job": "bat-live-pull", "pause_on_failed_run": true, "max_run_seconds": 45, "basis": "cron.job_run_details, 24 h to 2026-11-25 13:40 UTC: 1,440 runs, p50 3.95 s, p95 44.87 s, max 63.09 s, 60 failed"}]}'::jsonb,
        'retained_projection_verdict_v1: retained_projection_grade_tick() (job retained-projection-grade, every minute). budget_ms caps a run (max 5000; a step starts only with 2.5 s of it left, under the 10 s role timeout that covers the whole CALL); chunk = projections graded per commit (50 x 28 ms cold = 1.4 s); sweep rows per run = stale per minute / (2 x target_miss_share), within sweep_rows_min..sweep_rows_max (0.1 ms a row warm); pauses while a live lot closes within pause_close_minutes, or while a watch job''s last run failed or ran (or runs) past its max_run_seconds; its coverage assay is not a signal. v_retained_projection_backfill reads stall_minutes and max_paused_ticks x tick_seconds. Migration 20261126063500.')
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

-- The read also restates the vehicle_observations read rule for anon on the source observation.
DO $copy2$
BEGIN
  IF to_regclass('public.private_row_policy_copies') IS NOT NULL THEN
    INSERT INTO public.private_row_policy_copies (reader, relation, policy_filter, recorded_hash, owner_lane, note)
    SELECT 'retained_projection_verdicts_for(uuid[])', 'vehicle_observations', 'p.cmd IN (''SELECT'', ''ALL'')', h.policy_hash,
           'ta-readers', '20261126063500 restates the anon read of the source observation (vo_authenticated_read public term, '
           || 'vo_public_broadcast_read, the four restrictive private-method policies)'
      FROM public.private_row_policy_hash('vehicle_observations', 'p.cmd IN (''SELECT'', ''ALL'')') h
     WHERE h.policy_hash = '16c9e48fc1fbfbe5dc4ae10fe8947c7c' OR current_database() LIKE 'dm_%'
    ON CONFLICT (reader, relation, policy_filter) DO NOTHING;
    IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM public.private_row_policy_copies
                                  WHERE reader = 'retained_projection_verdicts_for(uuid[])' AND relation = 'vehicle_observations') THEN
      RAISE EXCEPTION 'vehicle_observations read policies changed since 2026-11-25 (hash 16c9e48f...); re-read before recording the copy';
    END IF;
  END IF;
END $copy2$;

DO $job$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retained-projection-grade') THEN
      PERFORM cron.unschedule('retained-projection-grade');
    END IF;
    PERFORM cron.schedule('retained-projection-grade', '* * * * *', 'CALL public.retained_projection_grade_tick()');
  END IF;
END $job$;
