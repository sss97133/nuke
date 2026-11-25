-- Two cron pacing fixes measured after 20261124193600 (S1 settle) and 20261124193700 (grade backfill).
--
-- 1. field_evidence_rank_settle_due_v1: the settle reaches the vehicles that hold legacy photo readings.
--    WHY. run_field_consensus_sweep calls the settle for its 150 vehicles per 3 minutes in cursor order, which reaches the
--    whole fleet in about 10 days. The settle only has work where field_evidence holds legacy photo readings
--    (source_type ai_visual, still written: 2,010 rows in 30 days). Measured 2026-11-25 03:25 UTC: 119 vehicles hold them;
--    the sweep settled 0 fields between deploy and then; a dry run over the 119 settles 107 fields / 444 rows in 9.5 s.
--    WHAT. A cursor over the distinct vehicles with non-rejected ai_visual rows (platform_config 'field_evidence_settle_due'),
--    40 vehicles a run, guard 40 s, wrapping at the end; cron 'field-evidence-settle-due' every 10 minutes. Writes only
--    through field_evidence_rank_settle_v1 (correct_field_evidence). A vehicle with nothing to settle costs one read.
-- 2. data-set-grades-backfill paced to 600 vehicles a run (was 1,500).
--    WHY. Since the backfill started (02:27 UTC) field-consensus-sweep went from about 1 s to 10-30 s a run, with one
--    statement timeout inside apply_field_consensus_safe (02:47), and data-set-public-counts from about 25 s to 43 s average
--    (75 s max of its 90 s budget). model-fold-tick held (116 of 116, 1.0 s average). At 600 a run (about 6 s a minute)
--    the lap of ~711k vehicles takes about 20 h instead of 8 h.
-- REVERT: unschedule field-evidence-settle-due; reschedule data-set-grades-backfill with (1500).
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.field_evidence_rank_settle_due_v1(p_limit integer DEFAULT 40)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE cfg jsonb; cur uuid; v uuid; r jsonb; n int := 0; nf int := 0; nr int := 0; last uuid; t0 timestamptz := clock_timestamp();
  run uuid := gen_random_uuid();
BEGIN
  SELECT config_value INTO cfg FROM public.platform_config WHERE config_key = 'field_evidence_settle_due' FOR UPDATE;
  cur := coalesce((cfg->>'cursor')::uuid, '00000000-0000-0000-0000-000000000000');
  FOR v IN SELECT DISTINCT f.vehicle_id FROM public.field_evidence f
            WHERE f.source_type = 'ai_visual' AND f.status IS DISTINCT FROM 'rejected' AND f.vehicle_id > cur
            ORDER BY f.vehicle_id LIMIT greatest(1, least(coalesce(p_limit, 40), 200)) LOOP
    EXIT WHEN clock_timestamp() - t0 > interval '40 seconds';
    r := public.field_evidence_rank_settle_v1(v, false, run);
    n := n + 1; nf := nf + coalesce((r->>'fields')::int, 0); nr := nr + coalesce((r->>'rows_rejected')::int, 0); last := v;
  END LOOP;
  cfg := jsonb_build_object('cursor', last, 'run_id', run,
    'last_run', jsonb_build_object('at', now(), 'vehicles', n, 'fields', nf, 'rows_rejected', nr,
                                   'ms', round(extract(epoch FROM clock_timestamp() - t0) * 1000)),
    'fields_total', coalesce((cfg->>'fields_total')::int, 0) + nf, 'rows_total', coalesce((cfg->>'rows_total')::int, 0) + nr);
  INSERT INTO public.platform_config (config_key, config_value, description, updated_at)
  VALUES ('field_evidence_settle_due', cfg, 'Cursor of field_evidence_rank_settle_due_v1 (20261124194600); a null cursor wraps to the start.', now())
  ON CONFLICT (config_key) DO UPDATE SET config_value = excluded.config_value, updated_at = now();
  RETURN cfg;
END;
$$;
REVOKE ALL ON FUNCTION public.field_evidence_rank_settle_due_v1(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_evidence_rank_settle_due_v1(integer) TO service_role;
COMMENT ON FUNCTION public.field_evidence_rank_settle_due_v1(integer) IS
  'Settle (field_evidence_rank_settle_v1) the vehicles holding legacy ai_visual readings, 40 a run from a cursor. 20261124194600.';

DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.schedule('field-evidence-settle-due', '7-59/10 * * * *',
      $cmd$SET statement_timeout = '55s'; SET lock_timeout = '5s'; SELECT public.field_evidence_rank_settle_due_v1(40);$cmd$);
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'data-set-grades-backfill') THEN
      PERFORM cron.schedule('data-set-grades-backfill', '* * * * *',
        $cmd$SET statement_timeout = '55s'; SET lock_timeout = '5s'; SELECT public.data_set_grades_backfill_v1(600);$cmd$);
    END IF;
  END IF;
END $cron$;
