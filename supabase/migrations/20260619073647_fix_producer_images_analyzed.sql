-- Fix: get_user_producer_signals.images_analyzed bound to get_user_capture_stats.analyzed
-- (= sum(work_sessions.image_count) = 12,101 frames TOUCHED), inflating the profile-header
-- 'analyzed' stat 68x while its drill resolved to 176. Rebind to get_user_analyzed_count
-- (count of source='capture_relay_ios' AND ai_processing_status='analyzed'). Applied to prod 2026-06-19.
CREATE OR REPLACE FUNCTION public.get_user_producer_signals(p_user_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH ws AS (
    SELECT session_date, duration_minutes
    FROM work_sessions WHERE user_id = p_user_id AND session_date IS NOT NULL
  ),
  days AS (SELECT DISTINCT session_date d FROM ws),
  islands AS (SELECT d, (d - (row_number() OVER (ORDER BY d))::int) grp FROM days),
  runs AS (SELECT grp, count(*) len, max(d) last_d FROM islands GROUP BY grp),
  cap AS (SELECT total_images, uploaded_today FROM get_user_capture_stats(p_user_id) LIMIT 1)
  SELECT jsonb_build_object(
    'last_worked',     (SELECT max(d) FROM days),
    'worked_today',    EXISTS(SELECT 1 FROM days WHERE d = current_date),
    'work_days_total', (SELECT count(*) FROM days),
    'work_days_year',  (SELECT count(*) FROM days WHERE d >= date_trunc('year', now())::date),
    'hours_total',     round((SELECT coalesce(sum(duration_minutes),0) FROM ws) / 60.0),
    'hours_year',      round((SELECT coalesce(sum(duration_minutes),0) FROM ws WHERE session_date >= date_trunc('year', now())::date) / 60.0),
    'current_streak',  coalesce((SELECT len FROM runs WHERE last_d >= current_date - 1 ORDER BY last_d DESC LIMIT 1), 0),
    'longest_streak',  coalesce((SELECT max(len) FROM runs), 0),
    'images_total',    (SELECT total_images FROM cap),
    'images_analyzed', get_user_analyzed_count(p_user_id),
    'images_today',    (SELECT uploaded_today FROM cap),
    'active_today',    (EXISTS(SELECT 1 FROM days WHERE d = current_date)
                        OR coalesce((SELECT uploaded_today FROM cap), 0) > 0)
  )
$function$;
