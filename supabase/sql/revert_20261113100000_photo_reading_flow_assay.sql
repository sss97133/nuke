-- Revert of 20261113100000_photo_reading_flow_assay.sql: the watch cron and the assay go; the yield refresh and its cron
-- return to the definitions read from production on 2026-11-10 (the refresh then times out again at the role default).
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $$
DECLARE j bigint;
BEGIN
  IF to_regnamespace('cron') IS NULL THEN RETURN; END IF;
  FOR j IN SELECT jobid FROM cron.job WHERE jobname IN ('photo-reading-flow-watch', 'photo-analysis-yield-hourly') LOOP
    PERFORM cron.unschedule(j);
  END LOOP;
  PERFORM cron.schedule('photo-analysis-yield-hourly', '17 * * * *', $cmd$select public.photo_analysis_yield_daily_refresh(2)$cmd$);
END $$;
DROP FUNCTION IF EXISTS public.assay_photo_reading_flow(boolean);

CREATE OR REPLACE FUNCTION public.photo_analysis_yield_daily_refresh(p_hours integer DEFAULT 2)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '280s'
AS $function$
declare u record; n int := 0; d date;
begin
  for u in select distinct vi.user_id from public.vehicle_images vi where vi.ai_processing_status='completed' and vi.ai_processing_completed_at >= now() - make_interval(hours => p_hours) loop
    n := n + public.photo_analysis_yield_snapshot_run(u.user_id, now() - make_interval(hours => p_hours), now());
    insert into public.photo_analysis_yield_daily (user_id, day, photos, filed_photos, filed_pct, median_rows_beyond_status, pct_zero_beyond_status, pct_zero_analysis, rows_total, rows_analysis, mean_tables_touched, mean_coverage, mean_extraction, landing_rate, cited_evidence, mean_confidence, mismatch_rows, make_agree_pct)
    select u.user_id, b.day, b.photos, b.filed_photos, b.filed_pct, b.median_rows_beyond_status, b.pct_zero_beyond_status, b.pct_zero_analysis, b.rows_total, b.rows_analysis, b.mean_tables_touched, b.mean_coverage, b.mean_extraction, b.landing_rate, b.cited_evidence, b.mean_confidence, b.mismatch_rows, b.make_agree_pct
    from public.photo_analysis_yield_by_day(u.user_id, now() - interval '3 days', now() + interval '1 hour') b
    on conflict (user_id, day) do update set photos=excluded.photos, filed_photos=excluded.filed_photos, filed_pct=excluded.filed_pct, median_rows_beyond_status=excluded.median_rows_beyond_status, pct_zero_beyond_status=excluded.pct_zero_beyond_status, pct_zero_analysis=excluded.pct_zero_analysis, rows_total=excluded.rows_total, rows_analysis=excluded.rows_analysis, mean_tables_touched=excluded.mean_tables_touched, mean_coverage=excluded.mean_coverage, mean_extraction=excluded.mean_extraction, landing_rate=excluded.landing_rate, cited_evidence=excluded.cited_evidence, mean_confidence=excluded.mean_confidence, mismatch_rows=excluded.mismatch_rows, make_agree_pct=excluded.make_agree_pct, computed_at=now();
  end loop;
  return n;
end $function$;
COMMENT ON FUNCTION public.photo_analysis_yield_daily_refresh(integer) IS NULL;
