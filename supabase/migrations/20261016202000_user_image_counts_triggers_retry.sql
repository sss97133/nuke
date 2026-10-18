-- Finish 20261016201000_user_image_counts: create its three statement triggers with a retried lock, then run its
-- backfill, switch the four readers and schedule compaction. Same definitions as 20261016201000; only the trigger step
-- changes.
--
-- WHY. Deploy run 38758882844 (2026-10-15) applied 20261016201000 up to its trigger block, which failed with
-- "canceling statement due to lock timeout" (3 s): writers held vehicle_images the whole time (the Mecum walk and the
-- BaT lane; at 15:2xZ a PostgREST INSERT into vehicle_images had held RowExclusiveLock for 28 s). Read on prod after
-- the run: user_image_counts and user_image_deep_reads exist and are empty, track_user_image_counts(),
-- backfill_user_image_counts() and compact_user_image_counts() exist, no trg_user_image_counts_* trigger, no
-- compact-user-image-counts job, and the four readers are still the live ones. Nothing is counted yet, so nothing is
-- wrong yet.
--
-- WHAT.
-- 1. Stop unless the tables and functions 20261016201000 created are present.
-- 2. Triggers: up to 30 attempts within 95 s. Each attempt takes SHARE ROW EXCLUSIVE on vehicle_images with a 2 s
--    lock_timeout (it waits for in-flight writers, holds new ones behind it for at most 2 s, and never blocks readers),
--    then CREATE OR REPLACE TRIGGER for the three. On lock_not_available it rolls the attempt back and sleeps 1 to 2 s
--    (random) before the next. If every attempt fails the migration stops here, before the backfill, and leaves the
--    live readers in place. No DROP TRIGGER: dropping an existing trigger takes ACCESS EXCLUSIVE, which waits on readers.
--    The DO block is one statement, so it runs under statement_timeout 110 s (below the deploy session's 120 s). Worst
--    case: the last check of the 95 s deadline comes after at most one more sleep (2 s) and lock wait (2 s), so the
--    block raises by about 99 s; 30 attempts at 2 s + 1.5 s average take about 105 s, so the deadline usually ends it
--    first (about 27 attempts).
-- 3. Stop unless all three triggers exist.
-- 4. The backfill, the readers and the compaction job of 20261016201000, unchanged: the backfill runs only after the
--    triggers exist, one indexed statement per (user, 7-day band) with its own 30 s timeout, and the readers switch only
--    after every band has run.
-- Re-running this file is safe, so a run that raises is re-dispatched as the same file
-- (gh workflow run supabase-deploy.yml -f migration_file=<this file>): CREATE OR REPLACE TRIGGER keeps the triggers,
-- each band replaces its own counts, the readers are CREATE OR REPLACE and the job is unscheduled before it is
-- scheduled.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

DO $$
BEGIN
  IF to_regclass('public.user_image_counts') IS NULL OR to_regclass('public.user_image_deep_reads') IS NULL
     OR to_regprocedure('public.track_user_image_counts()') IS NULL
     OR to_regprocedure('public.backfill_user_image_counts(uuid,date,date)') IS NULL
     OR to_regprocedure('public.compact_user_image_counts(integer)') IS NULL THEN
    RAISE EXCEPTION 'user_image_counts: the tables and functions of 20261016201000 are missing';
  END IF;
END $$;

SET statement_timeout = '110s';
DO $$
DECLARE
  v_deadline timestamptz := clock_timestamp() + interval '95 seconds';
  v_try integer := 0;
BEGIN
  LOOP
    v_try := v_try + 1;
    BEGIN
      PERFORM set_config('lock_timeout', '2s', true);
      LOCK TABLE public.vehicle_images IN SHARE ROW EXCLUSIVE MODE;
      EXECUTE 'CREATE OR REPLACE TRIGGER trg_user_image_counts_ins AFTER INSERT ON public.vehicle_images '
              'REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.track_user_image_counts()';
      EXECUTE 'CREATE OR REPLACE TRIGGER trg_user_image_counts_upd AFTER UPDATE ON public.vehicle_images '
              'REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT '
              'EXECUTE FUNCTION public.track_user_image_counts()';
      EXECUTE 'CREATE OR REPLACE TRIGGER trg_user_image_counts_del AFTER DELETE ON public.vehicle_images '
              'REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.track_user_image_counts()';
      RAISE NOTICE 'user_image_counts triggers created on attempt %', v_try;
      RETURN;
    EXCEPTION WHEN lock_not_available THEN
      IF v_try >= 30 OR clock_timestamp() >= v_deadline THEN
        RAISE EXCEPTION 'user_image_counts: no SHARE ROW EXCLUSIVE lock on vehicle_images in % attempts', v_try;
      END IF;
      PERFORM pg_sleep(1 + random());
    END;
  END LOOP;
END $$;
SET statement_timeout = '30s';

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.vehicle_images'::regclass AND NOT tgisinternal
        AND tgname IN ('trg_user_image_counts_ins', 'trg_user_image_counts_upd', 'trg_user_image_counts_del')) <> 3 THEN
    RAISE EXCEPTION 'user_image_counts: the three triggers are not all present; the backfill would undercount';
  END IF;
END $$;

-- Backfill: one statement per (user, 7-day band of taken_day) that holds rows, plus each user's NULL band. Users are
-- found by a loose scan of the user_id indexes and bands by probes of idx_vehicle_images_user_contrib_day
-- (user_id, COALESCE(taken_at, created_at)); a band with no rows costs one index probe and is not run.
-- Read on prod 2026-10-15 (index probes only): five users hold images; the widest span is 1981-01-20 to 2026-09-26
-- (about 2,400 weekly bands to probe). A user whose span is not finite (an infinity clock) would fall outside every
-- band, so the migration stops instead of leaving those rows uncounted.
DO $$
DECLARE v_user uuid;
BEGIN
  WITH RECURSIVE u AS (
    SELECT (SELECT vi.user_id FROM public.vehicle_images vi WHERE vi.user_id IS NOT NULL ORDER BY vi.user_id LIMIT 1) AS user_id
    UNION ALL
    SELECT (SELECT vi.user_id FROM public.vehicle_images vi WHERE vi.user_id > u.user_id ORDER BY vi.user_id LIMIT 1)
    FROM u WHERE u.user_id IS NOT NULL
  )
  SELECT u.user_id INTO v_user FROM u  -- not printed: the deploy log is public
  WHERE u.user_id IS NOT NULL
    AND (NOT isfinite((SELECT min(coalesce(vi.taken_at, vi.created_at)) FROM public.vehicle_images vi WHERE vi.user_id = u.user_id))
      OR NOT isfinite((SELECT max(coalesce(vi.taken_at, vi.created_at)) FROM public.vehicle_images vi WHERE vi.user_id = u.user_id)))
  LIMIT 1;
  IF v_user IS NOT NULL THEN
    RAISE EXCEPTION 'user_image_counts backfill: a user has an infinite taken_at or created_at; count those rows before switching the readers';
  END IF;
END $$;
\o /dev/null
WITH RECURSIVE u AS (
  SELECT (SELECT vi.user_id FROM public.vehicle_images vi WHERE vi.user_id IS NOT NULL ORDER BY vi.user_id LIMIT 1) AS user_id
  UNION ALL
  SELECT (SELECT vi.user_id FROM public.vehicle_images vi WHERE vi.user_id > u.user_id ORDER BY vi.user_id LIMIT 1)
  FROM u WHERE u.user_id IS NOT NULL
), span AS (
  SELECT u.user_id,
         (SELECT min(coalesce(vi.taken_at, vi.created_at)) FROM public.vehicle_images vi WHERE vi.user_id = u.user_id) AS lo,
         (SELECT max(coalesce(vi.taken_at, vi.created_at)) FROM public.vehicle_images vi WHERE vi.user_id = u.user_id) AS hi
  FROM u WHERE u.user_id IS NOT NULL
), band AS (
  SELECT s.user_id, b::date AS d0, b::date + 7 AS d1
  FROM span s,
       generate_series((s.lo AT TIME ZONE 'UTC')::date::timestamp, (s.hi AT TIME ZONE 'UTC')::date::timestamp,
                       interval '7 days') AS b
  WHERE s.lo IS NOT NULL
)
SELECT format('SELECT public.backfill_user_image_counts(%L, %L, %L)', b.user_id, b.d0, b.d1)
FROM band b
WHERE EXISTS (
  SELECT 1 FROM public.vehicle_images vi
  WHERE vi.user_id = b.user_id
    AND coalesce(vi.taken_at, vi.created_at) >= (b.d0::timestamp AT TIME ZONE 'UTC')
    AND coalesce(vi.taken_at, vi.created_at) < (b.d1::timestamp AT TIME ZONE 'UTC'))
UNION ALL
SELECT format('SELECT public.backfill_user_image_counts(%L, NULL, NULL)', u.user_id) FROM u WHERE u.user_id IS NOT NULL
\gexec
\o

-- The readers.
CREATE OR REPLACE FUNCTION public.get_user_sync_status(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Sums of user_image_counts (20261016201000) instead of a count over the user's vehicle_images rows.
  WITH last_capture_day AS (
    SELECT max(t.taken_day) AS d FROM (
      SELECT k.taken_day FROM public.user_image_counts k
      WHERE k.user_id = p_user_id AND k.taken_day IS NOT NULL
      GROUP BY k.taken_day HAVING sum(k.n_capture_taken) > 0) t
  )
  SELECT jsonb_build_object(
    'is_owner_view',     (auth.uid() = p_user_id),
    'synced_total',      coalesce(sum(c.n_capture), 0)::bigint,
    'analyzed_total',    coalesce(sum(c.n_capture_analyzed), 0)::bigint,
    'pending_total',     coalesce(sum(c.n_capture_pending), 0)::bigint,
    'filed_total',       coalesce(sum(c.n_capture_filed), 0)::bigint,
    'all_sources_total', coalesce(sum(c.n_all), 0)::bigint,
    'last_synced_at',    (SELECT max(vi.created_at) FROM public.vehicle_images vi
                          WHERE vi.user_id = p_user_id AND vi.source = 'capture_relay_ios'),
    -- the latest capture taken_at lies on the latest taken_day holding one: walk that day back from its end on
    -- idx_vehicle_images_user_taken_at to the first capture row. (... IS TRUE) keeps source out of the index
    -- condition, so the planner cannot choose to read every capture entry of the user instead.
    'last_taken_at',     (SELECT vi.taken_at FROM public.vehicle_images vi
                          WHERE vi.user_id = p_user_id AND (vi.source = 'capture_relay_ios') IS TRUE
                            AND vi.taken_at >= ((SELECT d FROM last_capture_day)::timestamp AT TIME ZONE 'UTC')
                            AND vi.taken_at <  (((SELECT d FROM last_capture_day) + 1)::timestamp AT TIME ZONE 'UTC')
                          ORDER BY vi.taken_at DESC LIMIT 1)
  )
  FROM public.user_image_counts c
  WHERE c.user_id = p_user_id;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_capture_stats(p_user_id uuid)
 RETURNS TABLE(total_images integer, uploaded_today integer, analyzed integer, contribution_days integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    coalesce(sum(c.n_owned), 0)::integer AS total_images,
    coalesce(sum(c.n_owned) FILTER (
      WHERE c.created_day = (now() AT TIME ZONE 'America/Los_Angeles')::date), 0)::integer AS uploaded_today,
    -- analyzed: understood frames from the canonical day rollup (work_sessions) —
    -- the SAME fast source as get_user_understanding (consistent + ~70ms), not a
    -- 22K-row jsonb scan and not the retired image_analysis_records fork.
    (SELECT coalesce(sum(image_count),0)::integer FROM work_sessions WHERE user_id = p_user_id) AS analyzed,
    (SELECT count(*)::integer FROM (
       SELECT k.taken_day FROM public.user_image_counts k
       WHERE k.user_id = p_user_id AND k.taken_day IS NOT NULL
       GROUP BY k.taken_day HAVING sum(k.n_owned) > 0) d) AS contribution_days
  -- the three count-based stats are sums of user_image_counts (20261016201000), not a pass over the user's images
  FROM public.user_image_counts c
  WHERE c.user_id = p_user_id;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_analyzed_count(p_user_id uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(sum(n_capture_analyzed), 0)::bigint
  FROM public.user_image_counts
  WHERE user_id = p_user_id;
$function$;

CREATE OR REPLACE FUNCTION public.get_analysis_stream(p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 40)
 RETURNS TABLE(image_id uuid, vehicle_id uuid, vehicle text, thumbnail_url text, image_url text, landed_at timestamp with time zone, scene_type text, build_phase text, narrative text, components jsonb, text_regions jsonb, state jsonb, hashed boolean, sessioned boolean, is_duplicate boolean, match_status text, intent text, needs_clarification boolean, attribution_doubt text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    vi.id,
    vi.vehicle_id,
    nullif(trim(concat_ws(' ', v.year, v.make, v.model, v.trim)), '') AS vehicle,
    coalesce(vi.thumbnail_url, vi.medium_url, vi.image_url) AS thumbnail_url,
    vi.image_url,
    vi.updated_at AS landed_at,
    vi.ai_scan_metadata->'byok_deep_analysis'->>'scene_type'         AS scene_type,
    vi.ai_scan_metadata->'byok_deep_analysis'->>'build_phase_guess'  AS build_phase,
    vi.ai_scan_metadata->'byok_deep_analysis'->>'narrative_one_line' AS narrative,
    vi.ai_scan_metadata->'byok_deep_analysis'->'components_seen'     AS components,
    vi.ai_scan_metadata->'byok_deep_analysis'->'text_regions'        AS text_regions,
    vi.ai_scan_metadata->'byok_deep_analysis'->'state_observations'  AS state,
    (vi.phash IS NOT NULL)                  AS hashed,
    (vi.work_session_id IS NOT NULL)        AS sessioned,
    coalesce(vi.is_duplicate, false)        AS is_duplicate,
    vi.image_vehicle_match_status           AS match_status,
    vi.ai_scan_metadata->'byok_deep_analysis'->>'intent' AS intent,
    coalesce((vi.ai_scan_metadata->'byok_deep_analysis'->>'needs_clarification')::boolean, false) AS needs_clarification,
    case
      when vi.ai_scan_metadata->'byok_deep_analysis'->>'scene_type' in ('product_screenshot','spreadsheet')
        then 'screen material (saved listing / document), not a frame of the attributed vehicle'
      when vi.ai_scan_metadata->'byok_deep_analysis'->>'scene_type' = 'cross_reference'
       and vi.ai_scan_metadata->'byok_deep_analysis'->>'intent' = 'acquisition'
        then 'reference material for a candidate purchase, not the attributed build'
      else null
    end AS attribution_doubt
  -- candidates from user_image_deep_reads (20261016201000) in updated_at order, joined by id until p_limit rows pass.
  -- OFFSET 0 and (... IS TRUE) keep the user_id recheck out of any index condition on vehicle_images, so the planner
  -- reaches vehicle_images only through its primary key, never through the user's rows.
  FROM (SELECT dr.image_id, dr.updated_at
        FROM user_image_deep_reads dr
        WHERE dr.user_id = auth.uid()
          AND (p_since IS NULL OR dr.updated_at > p_since)
        ORDER BY dr.updated_at DESC
        OFFSET 0) d
  JOIN vehicle_images vi ON vi.id = d.image_id
  JOIN vehicles v ON v.id = vi.vehicle_id
  WHERE (vi.user_id = auth.uid()) IS TRUE
    AND vi.ai_scan_metadata ? 'byok_deep_analysis'
    AND coalesce(vi.is_superseded, false) = false
    AND (p_since IS NULL OR vi.updated_at > p_since)
  ORDER BY d.updated_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 40), 100));
$function$;

DO $$
BEGIN
  PERFORM cron.unschedule('compact-user-image-counts') FROM cron.job WHERE jobname = 'compact-user-image-counts';
  PERFORM cron.schedule('compact-user-image-counts', '*/15 * * * *', 'SELECT public.compact_user_image_counts()');
END
$$;
