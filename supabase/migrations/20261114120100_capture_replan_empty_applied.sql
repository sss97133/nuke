-- Re-arm days whose latest live plan is applied with 0 sets (20261114120100).
-- capture_landing_finalize_plan marks a chunk applied when n_clear=0, including when the scorer returned no sets
-- at all. arm_new only fires on new arrivals, and capture_day_replan_state already returns blocked=false for
-- applied, so nothing automatically re-enqueues those days. This function is the signed producer: it enqueues
-- days that still have eligible unfiled photos (URL required; empty-url privacy holds, sensitive, personal,
-- duplicates, and photos already in an open review are excluded). Loop-proof via capture_empty_applied_retry_epoch:
-- only plans created before the epoch are retried. Bump the epoch in a later signed migration to retry again.
-- Revert: supabase/sql/revert_20261114120100_capture_replan_empty_applied.sql

CREATE TABLE IF NOT EXISTS public.capture_empty_applied_retry_epoch (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  epoch timestamptz NOT NULL,
  note text
);
ALTER TABLE public.capture_empty_applied_retry_epoch ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.capture_empty_applied_retry_epoch FROM PUBLIC, anon, authenticated;
INSERT INTO public.capture_empty_applied_retry_epoch (id, epoch, note)
VALUES (true, now(), '20261114120100 initial empty-applied retry')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.capture_sets_arm_empty_applied(
  p_user uuid, p_limit integer DEFAULT 20, p_max_photos integer DEFAULT 50, p_dry boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_epoch timestamptz;
  v_days jsonb := '[]'::jsonb;
  v_photos integer := 0;
  v_n integer := 0;
  r record;
BEGIN
  IF p_user IS NULL THEN RAISE EXCEPTION 'capture_sets_arm_empty_applied: user required'; END IF;
  SELECT epoch INTO v_epoch FROM capture_empty_applied_retry_epoch WHERE id;
  IF v_epoch IS NULL THEN RAISE EXCEPTION 'capture_sets_arm_empty_applied: epoch not set'; END IF;

  FOR r IN
    WITH latest AS (
      SELECT DISTINCT ON ((c.t_from AT TIME ZONE 'America/Los_Angeles')::date)
             c.id, c.state, c.stats, c.created_at,
             (c.t_from AT TIME ZONE 'America/Los_Angeles')::date AS d
      FROM capture_landing_chunks c
      WHERE c.user_id = p_user AND NOT coalesce(c.dry, false)
      ORDER BY (c.t_from AT TIME ZONE 'America/Los_Angeles')::date, c.created_at DESC
    ),
    eligible AS (
      SELECT (vi.taken_at AT TIME ZONE 'America/Los_Angeles')::date AS d, count(*)::integer AS n
      FROM vehicle_images vi
      WHERE vi.user_id = p_user
        AND vi.vehicle_id IS NULL
        AND vi.taken_at IS NOT NULL
        AND nullif(vi.image_url, '') IS NOT NULL
        AND NOT coalesce(vi.is_sensitive, false)
        AND coalesce(vi.vision_gate_status, '') NOT IN ('rejected_personal', 'rejected_misattributed')
        AND NOT coalesce(vi.is_duplicate, false)
        AND NOT coalesce(vi.is_superseded, false)
        AND public.capture_set_photo_admits(vi.source, vi.vehicle_id, vi.exif_data)
        AND NOT EXISTS (
          SELECT 1 FROM capture_set_review rv
          WHERE rv.user_id = p_user AND rv.status = 'open' AND vi.id = ANY (rv.image_ids)
        )
      GROUP BY 1
    )
    SELECT l.d, e.n, l.id AS chunk
    FROM latest l
    JOIN eligible e ON e.d = l.d
    WHERE l.state = 'applied'
      AND coalesce((l.stats->>'sets')::integer, 0) = 0
      AND l.created_at < v_epoch
      AND NOT EXISTS (
        SELECT 1 FROM capture_set_rescore_queue q
        WHERE q.user_id = p_user AND q.day = l.d AND q.done_at IS NULL
      )
    ORDER BY l.d
  LOOP
    EXIT WHEN v_n >= greatest(1, p_limit);
    IF v_photos > 0 AND v_photos + r.n > greatest(1, p_max_photos) THEN
      EXIT;
    END IF;
    IF NOT p_dry THEN
      PERFORM capture_sets_enqueue(p_user, r.d, jsonb_build_object(
        'empty_applied_retry', true,
        'epoch', v_epoch,
        'prior_chunk', r.chunk,
        'photos', r.n));
    END IF;
    v_photos := v_photos + r.n;
    v_n := v_n + 1;
    v_days := v_days || jsonb_build_array(jsonb_build_object('day', r.d, 'photos', r.n, 'chunk', r.chunk));
    EXIT WHEN v_photos >= greatest(1, p_max_photos);
  END LOOP;

  RETURN jsonb_build_object('dry', p_dry, 'epoch', v_epoch, 'days', v_days, 'photos', v_photos, 'n_days', v_n);
END
$function$;

REVOKE ALL ON FUNCTION public.capture_sets_arm_empty_applied(uuid, integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_sets_arm_empty_applied(uuid, integer, integer, boolean) TO service_role;
