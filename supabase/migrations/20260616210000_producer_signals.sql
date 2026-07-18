-- Producer signals + true-recent "latest work" — the profile becomes proof-of-work,
-- not vanity counts.
--
-- (1) get_user_producer_signals: the profile header's live + lifetime producer read in
--     ONE call. A signal is a function over the user's atomic data, not a stored count.
--     active_today is capture-OR-work based (someone uploading 220 photos today is active
--     even with no work-session); confirmed-labor $ is intentionally NOT surfaced (all
--     sessions are unconfirmed → $0 would lie). Fast: work_sessions is indexed by user_id.
-- (2) get_user_understanding.latest: was ordered storied-days-first by created_at, which
--     surfaced narrated 2024 sessions above recent work → the profile's "Latest work"
--     showed 2024. Reordered to session_date DESC (true recency).

CREATE OR REPLACE FUNCTION public.get_user_producer_signals(p_user_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  WITH ws AS (
    SELECT session_date, duration_minutes
    FROM work_sessions WHERE user_id = p_user_id AND session_date IS NOT NULL
  ),
  days AS (SELECT DISTINCT session_date d FROM ws),
  islands AS (SELECT d, (d - (row_number() OVER (ORDER BY d))::int) grp FROM days),
  runs AS (SELECT grp, count(*) len, max(d) last_d FROM islands GROUP BY grp),
  cap AS (SELECT total_images, analyzed, uploaded_today FROM get_user_capture_stats(p_user_id) LIMIT 1)
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
    'images_analyzed', (SELECT analyzed FROM cap),
    'images_today',    (SELECT uploaded_today FROM cap),
    'active_today',    (EXISTS(SELECT 1 FROM days WHERE d = current_date)
                        OR coalesce((SELECT uploaded_today FROM cap), 0) > 0)
  )
$fn$;
GRANT EXECUTE ON FUNCTION public.get_user_producer_signals(uuid) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.get_user_understanding(p_user_id uuid, p_limit integer DEFAULT 12)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH ws AS (SELECT * FROM public.work_sessions WHERE user_id = p_user_id)
  SELECT jsonb_build_object(
    'is_owner_view',     (auth.uid() = p_user_id),
    'days_understood',   (SELECT count(*) FROM ws),
    'frames_understood', (SELECT coalesce(sum(image_count),0) FROM ws),
    'days_today',        (SELECT count(*) FROM ws
                          WHERE created_at::date = (now() AT TIME ZONE 'America/Los_Angeles')::date),
    'latest', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'date', w.session_date, 'vehicle_id', w.vehicle_id,
               'make', v.make, 'model', v.model, 'frames', w.image_count,
               'title', COALESCE(NULLIF(w.title,''), w.work_type, 'work session'),
               'story', NULLIF(w.work_description,''),
               'minutes', w.duration_minutes,
               'cost', CASE WHEN auth.uid() = p_user_id THEN w.total_job_cost ELSE NULL END
             ) ORDER BY w.session_date DESC NULLS LAST), '[]'::jsonb)
      FROM (SELECT * FROM ws ORDER BY session_date DESC NULLS LAST LIMIT GREATEST(p_limit,0)) w
      LEFT JOIN public.vehicles v ON v.id = w.vehicle_id
    )
  );
$function$;
