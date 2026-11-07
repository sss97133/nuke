-- Drift capture: live definitions of the photo-analysis yield functions, taken verbatim from
-- pg_get_functiondef on 2026-11-07 (read-only). They existed in no migration. Bodies are unchanged;
-- CREATE OR REPLACE with identical text is a no-op on prod and gives a fresh DB parity.
-- Review (no change made): daily_refresh is bounded by a p_hours window (served by
-- idx_vehicle_images_ai_completed_at, 20261111120000); snapshot_run is bounded by p_since/p_until and
-- upserts on image_id; by_day filters snapshot rows by user_id and a completed_at range. No unbounded scan
-- is visible in this SQL, and snapshot indexes could not be probed (no creds), so none is added here.
-- photo_analysis_yield() and the snapshot/daily tables are also in no migration; capture them separately.
SET lock_timeout = '10s';
SET statement_timeout = '60s';

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

CREATE OR REPLACE FUNCTION public.photo_analysis_yield_snapshot_run(p_user_id uuid, p_since timestamp with time zone, p_until timestamp with time zone, p_legacy boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare n int;
begin
  with src as (select * from public.photo_analysis_yield(p_user_id, p_since, p_until, p_legacy)),
  ins as (
    insert into public.photo_analysis_yield_snapshot select src.*, now() from src
    on conflict (image_id) do update set
      vehicle_id=excluded.vehicle_id, source=excluded.source, image_type=excluded.image_type, completed_at=excluded.completed_at, filed=excluded.filed,
      vision_gate_status=excluded.vision_gate_status, match_status=excluded.match_status, tables_touched=excluded.tables_touched, tables=excluded.tables,
      rows_by_table=excluded.rows_by_table, rows_total=excluded.rows_total, rows_beyond_status=excluded.rows_beyond_status, rows_analysis=excluded.rows_analysis,
      rows_bookkeeping=excluded.rows_bookkeeping, rows_qa=excluded.rows_qa, fields_applicable=excluded.fields_applicable, fields_extracted=excluded.fields_extracted,
      fields_landed=excluded.fields_landed, fields_populated=excluded.fields_populated, coverage_score=excluded.coverage_score, extraction_score=excluded.extraction_score,
      landing_rate=excluded.landing_rate, cited_evidence_count=excluded.cited_evidence_count, mean_confidence=excluded.mean_confidence,
      classifier_confidence=excluded.classifier_confidence, mismatch_rows=excluded.mismatch_rows, make_hint=excluded.make_hint, make_agrees=excluded.make_agrees,
      ext_keys=excluded.ext_keys, landed_keys=excluded.landed_keys, stranded_keys=excluded.stranded_keys, measured_at=now()
    returning 1)
  select count(*) into n from ins;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.photo_analysis_yield_by_day(p_user_id uuid, p_since timestamp with time zone DEFAULT (now() - '30 days'::interval), p_until timestamp with time zone DEFAULT now(), p_tz text DEFAULT 'America/Los_Angeles'::text)
 RETURNS TABLE(day date, photos integer, filed_photos integer, filed_pct numeric, median_rows_beyond_status numeric, pct_zero_beyond_status numeric, pct_zero_analysis numeric, rows_total bigint, rows_analysis bigint, mean_tables_touched numeric, mean_coverage numeric, mean_extraction numeric, landing_rate numeric, cited_evidence bigint, mean_confidence numeric, mismatch_rows bigint, make_agree_pct numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select (s.completed_at at time zone p_tz)::date, count(*)::int, (count(*) filter (where s.filed))::int,
    round(100.0*count(*) filter (where s.filed)/count(*),1),
    (percentile_cont(0.5) within group (order by s.rows_beyond_status))::numeric,
    round(100.0*count(*) filter (where s.rows_beyond_status=0)/count(*),1),
    round(100.0*count(*) filter (where s.rows_analysis=0)/count(*),1),
    sum(s.rows_total)::bigint, sum(s.rows_analysis)::bigint, round(avg(s.tables_touched),2),
    round(avg(s.coverage_score),3), round(avg(s.extraction_score),3),
    round(sum(s.fields_landed)::numeric/nullif(sum(s.fields_extracted),0),3),
    sum(s.cited_evidence_count)::bigint, round(avg(s.mean_confidence),3), sum(s.mismatch_rows)::bigint,
    round(100.0*count(*) filter (where s.make_agrees)/nullif(count(*) filter (where s.make_agrees is not null),0),1)
  from public.photo_analysis_yield_snapshot s
  where s.user_id=p_user_id and s.completed_at>=p_since and s.completed_at<p_until
  group by 1 order by 1 $function$;
