-- organization_vehicles.vehicle_readable backfill: a self-unscheduling job and its gauge (step 2 of 3).
--
-- WHY. 20261126071500 stamps vehicle_readable on every new or moved link and relays car visibility changes, but the
-- ~892k links that existed before it are NULL. Step 3 (the read policy, NOT NULL) waits for a probe reading 0 NULLs.
-- Lead ruling 2026-11-25: fill them by a job, not by hand and not in a migration.
--
-- WHAT.
--   Rule row platform_config 'org_vehicles_readable_backfill' (an admin may edit it; the job clamps what it reads):
--     chunk_rows 1000 (1..5000): links per run, the next ids above the cursor in primary-key order;
--     pause_minutes_before_close 15 (0..120): no run while a monitored live auction ends within that many minutes (or
--       ended in the last 2); v_lots_near_close replaces monitored_auctions here once it exists (ta-matcher);
--     enabled true.
--   State row platform_config 'org_vehicles_readable_backfill_state': cursor, rows_written, runs, newest_write_at,
--     paused_at, passes, done_at. Written only by the job.
--   organization_vehicles_readable_backfill_run(): one run. It writes vehicle_readable on the NULL rows among the next
--     chunk_rows ids (the stamp trigger computes the value), advances the cursor, and at the end of a pass starts
--     another pass while any NULL remains; with none left it records done_at and unschedules its own job.
--   organization_vehicles_readable_backfill_gauge(): remaining ids above the cursor, NULL rows in a 1/256 primary-key
--     slice (rotating by hour) and, in the same slice, rows whose value differs from their car (the insert-vs-flip race
--     20261126071500 names), each with its denominator; rows written, runs, newest write, paused_at, done_at, whether
--     the job is scheduled.
--   cron job 'org-vehicles-readable-backfill', every minute, statement_timeout 30 s.
-- RATE. 1,000 links a minute: about 15 hours for 892k rows, plus pauses. Each run is 1,000 vehicles_pkey probes (67 us
--   warm each, measured 2026-11-25) and 1,000 row updates; every updated row also runs update_days_on_lot.
-- Requires 20261126071500 (guarded). Neither function is executable by PUBLIC, anon or authenticated.
-- CONTRACT: supabase/sql/test_organization_vehicles_readable_backfill_job.sql (PG17).
-- REVERSAL: supabase/sql/revert_20261126073000_organization_vehicles_readable_backfill_job.sql.
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.organization_vehicles'::regclass
                 AND tgname = 'trg_organization_vehicles_vehicle_readable' AND tgenabled = 'O') THEN
    RAISE EXCEPTION '20261126071500 (vehicle_readable and its stamp trigger) is not live';
  END IF;
END $guard$;

INSERT INTO public.platform_config (config_key, config_value, description)
VALUES ('org_vehicles_readable_backfill',
        '{"chunk_rows": 1000, "pause_minutes_before_close": 15, "enabled": true}'::jsonb,
        'org_vehicles_readable_backfill_v1: rules for the job org-vehicles-readable-backfill (20261126073000). chunk_rows: links per run (clamped 1..5000). pause_minutes_before_close: no run while a monitored live auction ends within that many minutes (clamped 0..120). enabled: false stops runs without unscheduling.'),
       ('org_vehicles_readable_backfill_state',
        '{"cursor": "00000000-0000-0000-0000-000000000000", "rows_written": 0, "runs": 0, "passes": 1}'::jsonb,
        'org_vehicles_readable_backfill_v1: state of the job org-vehicles-readable-backfill, written only by organization_vehicles_readable_backfill_run().')
ON CONFLICT (config_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.organization_vehicles_readable_backfill_run()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  cfg jsonb;
  st jsonb;
  v_chunk int;
  v_pause int;
  v_cursor uuid;
  v_last uuid;
  v_n int;
  v_near int;
BEGIN
  -- org_vehicles_readable_backfill_v1
  SELECT c.config_value INTO cfg FROM public.platform_config c WHERE c.config_key = 'org_vehicles_readable_backfill';
  SELECT c.config_value INTO st FROM public.platform_config c WHERE c.config_key = 'org_vehicles_readable_backfill_state'
    FOR UPDATE;
  IF st IS NULL THEN
    RAISE EXCEPTION 'org_vehicles_readable_backfill_state row is missing';
  END IF;
  IF st ? 'done_at' THEN
    RETURN jsonb_build_object('skipped', 'done') || st;
  END IF;
  IF coalesce((cfg ->> 'enabled')::boolean, true) IS NOT TRUE THEN
    RETURN jsonb_build_object('skipped', 'disabled');
  END IF;
  v_chunk := least(greatest(coalesce((cfg ->> 'chunk_rows')::int, 1000), 1), 5000);
  v_pause := least(greatest(coalesce((cfg ->> 'pause_minutes_before_close')::int, 15), 0), 120);

  SELECT count(*) INTO v_near FROM public.monitored_auctions m
   WHERE m.is_live AND m.auction_end_time BETWEEN now() - interval '2 minutes' AND now() + make_interval(mins => v_pause);
  IF v_near > 0 THEN
    UPDATE public.platform_config SET config_value = st || jsonb_build_object('paused_at', now(), 'paused_lots', v_near),
                                      updated_at = now()
     WHERE config_key = 'org_vehicles_readable_backfill_state';
    RETURN jsonb_build_object('skipped', 'lots_near_close', 'lots', v_near);
  END IF;

  v_cursor := coalesce((st ->> 'cursor')::uuid, '00000000-0000-0000-0000-000000000000');
  -- The stamp trigger (BEFORE UPDATE OF vehicle_readable) computes the value from the car; the SET only names the column.
  WITH c AS (
    SELECT ov.id FROM public.organization_vehicles ov WHERE ov.id > v_cursor ORDER BY ov.id LIMIT v_chunk
  ), u AS (
    UPDATE public.organization_vehicles ov SET vehicle_readable = NULL
      FROM c WHERE ov.id = c.id AND ov.vehicle_readable IS NULL
    RETURNING 1
  )
  SELECT (SELECT c.id FROM c ORDER BY c.id DESC LIMIT 1), (SELECT count(*) FROM u) INTO v_last, v_n;

  st := st || jsonb_build_object('runs', coalesce((st ->> 'runs')::bigint, 0) + 1,
                                 'rows_written', coalesce((st ->> 'rows_written')::bigint, 0) + v_n,
                                 'last_run_at', now());
  IF v_n > 0 THEN
    st := st || jsonb_build_object('newest_write_at', now());
  END IF;
  IF v_last IS NOT NULL THEN
    st := st || jsonb_build_object('cursor', v_last);
  ELSIF EXISTS (SELECT 1 FROM public.organization_vehicles ov WHERE ov.vehicle_readable IS NULL) THEN
    -- A pass ended with NULL rows left (a run failed mid-pass, or rows came back NULL): start another pass.
    st := st || jsonb_build_object('cursor', '00000000-0000-0000-0000-000000000000'::uuid,
                                   'passes', coalesce((st ->> 'passes')::int, 1) + 1);
  ELSE
    st := st || jsonb_build_object('done_at', now());
    PERFORM cron.unschedule(j.jobid) FROM cron.job j WHERE j.jobname = 'org-vehicles-readable-backfill';
  END IF;
  UPDATE public.platform_config SET config_value = st, updated_at = now()
   WHERE config_key = 'org_vehicles_readable_backfill_state';
  RETURN jsonb_build_object('written', v_n) || st;
END;
$function$;
REVOKE ALL ON FUNCTION public.organization_vehicles_readable_backfill_run() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.organization_vehicles_readable_backfill_gauge()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  st jsonb := (SELECT c.config_value FROM public.platform_config c WHERE c.config_key = 'org_vehicles_readable_backfill_state');
  v_slice int := extract(hour FROM now())::int * 10 % 256;
  v_lo uuid;
  v_hi uuid;
  r record;
BEGIN
  -- org_vehicles_readable_backfill_v1: a 1/256 primary-key slice, rotating by hour, for the NULL and drift counts.
  v_lo := (lpad(to_hex(v_slice), 2, '0') || '000000-0000-0000-0000-000000000000')::uuid;
  v_hi := CASE WHEN v_slice = 255 THEN 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid
               ELSE (lpad(to_hex(v_slice + 1), 2, '0') || '000000-0000-0000-0000-000000000000')::uuid END;
  SELECT count(*) AS slice_rows,
         count(*) FILTER (WHERE ov.vehicle_readable IS NULL) AS slice_null,
         count(*) FILTER (WHERE ov.vehicle_readable IS NOT NULL
                          AND ov.vehicle_readable IS DISTINCT FROM coalesce(
                                public.vehicle_publicly_readable(v.is_public, v.deleted_at, v.merged_into_vehicle_id), false)
                         ) AS slice_drift
    INTO r
    FROM public.organization_vehicles ov LEFT JOIN public.vehicles v ON v.id = ov.vehicle_id
   WHERE ov.id >= v_lo AND ov.id < v_hi;
  RETURN jsonb_build_object(
    'measured_at', now(),
    'remaining_ids_after_cursor', (SELECT count(*) FROM public.organization_vehicles ov
                                    WHERE ov.id > coalesce((st ->> 'cursor')::uuid, '00000000-0000-0000-0000-000000000000')),
    'slice', format('%s/256 [%s, %s)', v_slice, v_lo, v_hi),
    'slice_rows', r.slice_rows, 'slice_null', r.slice_null, 'slice_drift', r.slice_drift,
    'job_scheduled', EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = 'org-vehicles-readable-backfill'))
    || coalesce(st, '{}'::jsonb);
END;
$function$;
REVOKE ALL ON FUNCTION public.organization_vehicles_readable_backfill_gauge() FROM PUBLIC, anon, authenticated;

DO $sched$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'org-vehicles-readable-backfill')
     AND NOT EXISTS (SELECT 1 FROM public.platform_config WHERE config_key = 'org_vehicles_readable_backfill_state'
                     AND config_value ? 'done_at') THEN
    PERFORM cron.schedule('org-vehicles-readable-backfill', '* * * * *',
      $c$SET client_min_messages = error; SET statement_timeout = '30s'; SELECT public.organization_vehicles_readable_backfill_run()$c$);
  END IF;
END $sched$;

DO $check$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.oid IN ('public.organization_vehicles_readable_backfill_run()'::regprocedure,
                   'public.organization_vehicles_readable_backfill_gauge()'::regprocedure)
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND position('org_vehicles_readable_backfill_v1' in p.prosrc) > 0;
  IF n <> 2 THEN RAISE EXCEPTION 'backfill functions not as intended (% of 2)', n; END IF;
  IF (SELECT count(*) FROM public.platform_config WHERE config_key IN ('org_vehicles_readable_backfill',
      'org_vehicles_readable_backfill_state')) <> 2 THEN
    RAISE EXCEPTION 'rule and state rows missing';
  END IF;
END $check$;
COMMIT;
