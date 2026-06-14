-- get_user_understanding — the live "mesh growing" feed for the iOS Today screen
-- (BUILD_2 §G14). The day rollup (work_sessions) is the unit: fast (rides
-- work_sessions(user_id), ~50ms), narrative-bearing (vehicle · date · frames ·
-- classification), and sum(image_count) is a fast "frames understood" proxy that
-- never touches the 7.8M-row observations table. Owner-gates the cost field only.
CREATE OR REPLACE FUNCTION public.get_user_understanding(p_user_id uuid, p_limit int DEFAULT 12)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH ws AS (
    SELECT * FROM public.work_sessions WHERE user_id = p_user_id
  )
  SELECT jsonb_build_object(
    'is_owner_view',     (auth.uid() = p_user_id),
    'days_understood',   (SELECT count(*) FROM ws),
    'frames_understood', (SELECT coalesce(sum(image_count),0) FROM ws),
    'days_today',        (SELECT count(*) FROM ws
                          WHERE created_at::date = (now() AT TIME ZONE 'America/Los_Angeles')::date),
    'latest', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'date',       w.session_date,
               'vehicle_id', w.vehicle_id,
               'make',       v.make,
               'model',      v.model,
               'frames',     w.image_count,
               'title',      COALESCE(NULLIF(w.title,''), w.work_type, 'work session'),
               'story',      NULLIF(w.work_description,''),   -- the detective's day narrative
               'minutes',    w.duration_minutes,
               'cost',       CASE WHEN auth.uid() = p_user_id THEN w.total_job_cost ELSE NULL END
             ) ORDER BY w.created_at DESC), '[]'::jsonb)
      -- Storied days first: a day with a written narrative is genuinely
      -- "understood" (the detective's read), vs a thin classification-only
      -- rollup. Newest narrated days lead the feed; thin days fill only if needed.
      FROM (SELECT * FROM ws
            ORDER BY (NULLIF(work_description,'') IS NOT NULL) DESC, created_at DESC
            LIMIT GREATEST(p_limit,0)) w
      LEFT JOIN public.vehicles v ON v.id = w.vehicle_id
    )
  );
$$;
GRANT EXECUTE ON FUNCTION public.get_user_understanding(uuid,int) TO anon, authenticated, service_role;
