-- get_user_capture_stats: repointed to canonical vehicle_images.ai_scan_metadata.byok_deep_analysis
-- (was image_analysis_records fork). Applied live via psql 2026-06-14; this file repairs the drift.

CREATE OR REPLACE FUNCTION public.get_user_capture_stats(p_user_id uuid)
 RETURNS TABLE(total_images integer, uploaded_today integer, analyzed integer, contribution_days integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    base.total_images,
    base.uploaded_today,
    -- analyzed: understood frames from the canonical day rollup (work_sessions) —
    -- the SAME fast source as get_user_understanding (consistent + ~70ms), not a
    -- 22K-row jsonb scan and not the retired image_analysis_records fork.
    (SELECT coalesce(sum(image_count),0)::integer FROM work_sessions WHERE user_id = p_user_id) AS analyzed,
    base.contribution_days
  FROM (
    -- ONE pass over the user's images for the three count-based stats.
    SELECT
      count(*)::integer AS total_images,
      count(*) FILTER (
        WHERE vi.created_at::date
              = (now() AT TIME ZONE 'America/Los_Angeles')::date
      )::integer AS uploaded_today,
      count(DISTINCT coalesce(vi.taken_at, vi.created_at)::date)::integer
        AS contribution_days
    FROM vehicle_images vi
    WHERE vi.user_id = p_user_id
      AND vi.source NOT IN (
        'bat_import','bat_listing','external_import',
        'organization_import','scraper','scraped'
      )
  ) base;
$function$
;
