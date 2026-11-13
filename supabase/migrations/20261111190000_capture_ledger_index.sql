-- The capture ledger reads a window from an index range, and its day list without the heap.
--
-- Measured live 2026-11-08 (PostgreSQL 17.6; vehicle_images 62.7M rows, 57 GB heap, 99.5% all-visible; the owner's 29,749
-- frames, 7,397 in the last 365 days):
--  1. capture_ledger_frames tests the window as "(p_from IS NULL OR ts >= p_from)". A SECURITY DEFINER SQL function is not
--     inlined, so the planner sees a Param and cannot bound the index: the generic plan reads every frame the person owns
--     (Index Only Scan on idx_vehicle_images_user_capture_stats, Filter, 29,346 rows removed, 7,906 heap fetches) for any
--     window, one day included. One day (403 frames): 24,956 buffers, 1.8 s warm, 42 s cold under I/O contention. The same
--     test as "ts >= COALESCE(p_from_ts, '-infinity')" is an Index Cond: 2,320 buffers.
--  2. The day list needs five columns a frame (id, taken_at, created_at, vehicle_id, vision_gate_status) and no existing
--     index carries them, so every frame costs a heap page, and the asset id (exif_data->>'uuid') for the skip test costs
--     its TOAST pages too. The window: 30,261 buffers, 0.23 s warm, 9.7-10.7 s cold. Every user_id index on the table also
--     carries the 99.95% of rows whose user_id is NULL (idx_vehicle_images_user_sync: 5,980 MB).
-- After:
--  * capture_ledger_frames bounds the window with COALESCE(..., '-infinity'/'infinity'). Same rows, same columns.
--  * idx_vehicle_images_capture_ledger (user_id, COALESCE(taken_at, created_at), exif_data->>'uuid') INCLUDE (id, taken_at,
--    created_at, vehicle_id, vision_gate_status) WHERE user_id IS NOT NULL: the rows a person owns (about 32,000, a few MB).
--  * capture_ledger_states (new, internal): the frame classifier reading only the index's columns, so the day list is an
--    index-only range; get_capture_ledger reads it, and tests a skip's arrival by one probe of the same index on
--    (user_id, exif uuid) instead of the asset id of every frame. get_capture_ledger_day keeps capture_ledger_frames (a
--    day's thumbnails and file names need the heap). Same JSON, same grants.
-- The index is built CONCURRENTLY by this file: two scans of the 57 GB heap at the 76 MB/s measured today, 25-30 min
-- (the deploy job allows 60; a hand pre-build was not done). Writes continue during the build. An interrupted build leaves
-- an INVALID index, which the check below names so the next run drops and rebuilds it.
-- Revert: supabase/sql/revert_20261111190000_capture_ledger_index.sql. Contract: supabase/sql/test_capture_ledger.sql.
SET statement_timeout = '3300s';
SET lock_timeout = '60s';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicle_images_capture_ledger
  ON public.vehicle_images (user_id, (COALESCE(taken_at, created_at)), (exif_data->>'uuid'))
  INCLUDE (id, taken_at, created_at, vehicle_id, vision_gate_status)
  WHERE user_id IS NOT NULL;

-- An interrupted concurrent build leaves an INVALID index that IF NOT EXISTS would then skip.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
             WHERE c.relname = 'idx_vehicle_images_capture_ledger' AND NOT i.indisvalid) THEN
    RAISE EXCEPTION 'idx_vehicle_images_capture_ledger is INVALID; DROP INDEX CONCURRENTLY public.idx_vehicle_images_capture_ledger and re-run';
  END IF;
END $$;

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

-- 1. The full frame reader (day detail): the same body as 20261111170000 with the window bounded for the planner.
CREATE OR REPLACE FUNCTION public.capture_ledger_frames(p_uid uuid, p_tz text, p_from date, p_to date)
RETURNS TABLE (image_id uuid, day date, taken_at timestamptz, state text, reason text, vehicle_id uuid, source text,
               file_name text, thumb text, asset_id text, set_key text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH held AS (
    SELECT DISTINCT ON (x.image_id) x.image_id, r.reason, r.set_key
    FROM public.capture_set_review r CROSS JOIN LATERAL unnest(r.image_ids) AS x(image_id)
    WHERE r.user_id = p_uid AND r.status = 'open'
    ORDER BY x.image_id, r.created_at DESC
  ), waiting AS (
    SELECT DISTINCT x.image_id
    FROM public.capture_landing_chunks c
    JOIN public.capture_landing_sets s ON s.chunk_id = c.id AND s.decision = 'clear'
    CROSS JOIN LATERAL unnest(s.image_ids) AS x(image_id)
    WHERE c.user_id = p_uid AND c.state = 'awaiting_gate'
  ), failed AS (
    SELECT u.image_id, u.error_class FROM public.capture_upload_status u WHERE u.user_id = p_uid AND u.stage = 'failed'
  )
  SELECT vi.id,
         (COALESCE(vi.taken_at, vi.created_at) AT TIME ZONE p_tz)::date,
         COALESCE(vi.taken_at, vi.created_at),
         CASE
           WHEN vi.vision_gate_status::text = 'rejected_personal' THEN 'private'
           WHEN vi.vision_gate_status::text = 'rejected_misattributed' THEN 'pulled'
           WHEN vi.vehicle_id IS NOT NULL AND vi.vision_gate_status::text = 'approved' THEN 'on_vehicle'
           WHEN vi.vehicle_id IS NOT NULL THEN 'unverified'
           WHEN f.image_id IS NOT NULL THEN 'failed'
           WHEN w.image_id IS NOT NULL THEN 'waiting'
           WHEN h.image_id IS NOT NULL THEN 'held'
           ELSE 'unsorted'
         END,
         CASE
           WHEN vi.vision_gate_status::text IN ('rejected_personal','rejected_misattributed') THEN vi.vision_gate_status::text
           WHEN vi.vehicle_id IS NOT NULL THEN COALESCE(vi.vision_gate_status::text, 'ungated')
           WHEN f.image_id IS NOT NULL THEN COALESCE(f.error_class, 'failed')
           WHEN w.image_id IS NOT NULL THEN 'awaiting_gate'
           WHEN h.image_id IS NOT NULL THEN COALESCE(h.reason, 'held')
           ELSE 'not_scored'
         END,
         vi.vehicle_id, vi.source, vi.file_name,
         CASE WHEN vi.vision_gate_status::text = 'rejected_personal' THEN NULL ELSE COALESCE(vi.thumbnail_url, vi.image_url) END,
         vi.exif_data->>'uuid',
         h.set_key
  FROM public.vehicle_images vi
  LEFT JOIN held h ON h.image_id = vi.id
  LEFT JOIN waiting w ON w.image_id = vi.id
  LEFT JOIN failed f ON f.image_id = vi.id
  WHERE vi.user_id = p_uid
    AND COALESCE(vi.taken_at, vi.created_at) >= COALESCE(p_from::timestamp AT TIME ZONE p_tz, '-infinity'::timestamptz)
    AND COALESCE(vi.taken_at, vi.created_at) < COALESCE((p_to + 1)::timestamp AT TIME ZONE p_tz, 'infinity'::timestamptz)
$fn$;
REVOKE ALL ON FUNCTION public.capture_ledger_frames(uuid, text, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_ledger_frames(uuid, text, date, date) TO service_role;

-- 2. The lean classifier (day list): the same states from the index's columns alone. Internal, like capture_ledger_frames.
CREATE OR REPLACE FUNCTION public.capture_ledger_states(p_uid uuid, p_tz text, p_from date, p_to date)
RETURNS TABLE (image_id uuid, day date, state text, reason text, vehicle_id uuid, set_key text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH held AS (
    SELECT DISTINCT ON (x.image_id) x.image_id, r.reason, r.set_key
    FROM public.capture_set_review r CROSS JOIN LATERAL unnest(r.image_ids) AS x(image_id)
    WHERE r.user_id = p_uid AND r.status = 'open'
    ORDER BY x.image_id, r.created_at DESC
  ), waiting AS (
    SELECT DISTINCT x.image_id
    FROM public.capture_landing_chunks c
    JOIN public.capture_landing_sets s ON s.chunk_id = c.id AND s.decision = 'clear'
    CROSS JOIN LATERAL unnest(s.image_ids) AS x(image_id)
    WHERE c.user_id = p_uid AND c.state = 'awaiting_gate'
  ), failed AS (
    SELECT u.image_id, u.error_class FROM public.capture_upload_status u WHERE u.user_id = p_uid AND u.stage = 'failed'
  )
  SELECT vi.id,
         (COALESCE(vi.taken_at, vi.created_at) AT TIME ZONE p_tz)::date,
         CASE
           WHEN vi.vision_gate_status::text = 'rejected_personal' THEN 'private'
           WHEN vi.vision_gate_status::text = 'rejected_misattributed' THEN 'pulled'
           WHEN vi.vehicle_id IS NOT NULL AND vi.vision_gate_status::text = 'approved' THEN 'on_vehicle'
           WHEN vi.vehicle_id IS NOT NULL THEN 'unverified'
           WHEN f.image_id IS NOT NULL THEN 'failed'
           WHEN w.image_id IS NOT NULL THEN 'waiting'
           WHEN h.image_id IS NOT NULL THEN 'held'
           ELSE 'unsorted'
         END,
         CASE
           WHEN vi.vision_gate_status::text IN ('rejected_personal','rejected_misattributed') THEN vi.vision_gate_status::text
           WHEN vi.vehicle_id IS NOT NULL THEN COALESCE(vi.vision_gate_status::text, 'ungated')
           WHEN f.image_id IS NOT NULL THEN COALESCE(f.error_class, 'failed')
           WHEN w.image_id IS NOT NULL THEN 'awaiting_gate'
           WHEN h.image_id IS NOT NULL THEN COALESCE(h.reason, 'held')
           ELSE 'not_scored'
         END,
         vi.vehicle_id,
         h.set_key
  FROM public.vehicle_images vi
  LEFT JOIN held h ON h.image_id = vi.id
  LEFT JOIN waiting w ON w.image_id = vi.id
  LEFT JOIN failed f ON f.image_id = vi.id
  WHERE vi.user_id = p_uid
    AND COALESCE(vi.taken_at, vi.created_at) >= COALESCE(p_from::timestamp AT TIME ZONE p_tz, '-infinity'::timestamptz)
    AND COALESCE(vi.taken_at, vi.created_at) < COALESCE((p_to + 1)::timestamp AT TIME ZONE p_tz, 'infinity'::timestamptz)
$fn$;
REVOKE ALL ON FUNCTION public.capture_ledger_states(uuid, text, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_ledger_states(uuid, text, date, date) TO service_role;
COMMENT ON FUNCTION public.capture_ledger_states(uuid, text, date, date) IS
  'Internal: one ledger state per frame for the day list, read from idx_vehicle_images_capture_ledger alone (no thumbnails, file names or asset ids; those are capture_ledger_frames, for one day). Same states, same rules.';

-- 3. The day list reads the lean classifier; a skip is tested for arrival by its asset id, one index probe each.
CREATE OR REPLACE FUNCTION public.get_capture_ledger(p_tz text DEFAULT 'America/Los_Angeles', p_from date DEFAULT (current_date - 365),
                                                     p_to date DEFAULT NULL, p_limit integer DEFAULT 180)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH uid AS (SELECT auth.uid() AS id),
  fr AS MATERIALIZED (SELECT f.* FROM uid, LATERAL public.capture_ledger_states(uid.id, p_tz, p_from, p_to) f WHERE uid.id IS NOT NULL),
  sk AS MATERIALIZED (
    SELECT (COALESCE(k.taken_at, k.decided_at) AT TIME ZONE p_tz)::date AS day, k.reason
    FROM public.capture_skips k, uid
    WHERE k.user_id = uid.id AND uid.id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.vehicle_images vi WHERE vi.user_id = k.user_id AND (vi.exif_data->>'uuid') = k.asset_id)
      AND COALESCE(k.taken_at, k.decided_at) >= COALESCE(p_from::timestamp AT TIME ZONE p_tz, '-infinity'::timestamptz)
      AND COALESCE(k.taken_at, k.decided_at) < COALESCE((p_to + 1)::timestamp AT TIME ZONE p_tz, 'infinity'::timestamptz)
  ),
  day_frames AS (
    SELECT day, count(*) AS taken,
           count(*) FILTER (WHERE state = 'on_vehicle') AS on_vehicle, count(*) FILTER (WHERE state = 'unverified') AS unverified,
           count(*) FILTER (WHERE state = 'waiting') AS waiting, count(*) FILTER (WHERE state = 'held') AS held,
           count(*) FILTER (WHERE state = 'pulled') AS pulled, count(*) FILTER (WHERE state = 'private') AS private,
           count(*) FILTER (WHERE state = 'unsorted') AS unsorted, count(*) FILTER (WHERE state = 'failed') AS failed
    FROM fr GROUP BY day
  ),
  day_skips AS (
    SELECT day, sum(n)::bigint AS skipped, jsonb_object_agg(reason, n) AS skip_reasons
    FROM (SELECT day, reason, count(*) AS n FROM sk GROUP BY 1, 2) x GROUP BY day
  ),
  day_vehicles AS (
    SELECT x.day, jsonb_agg(jsonb_build_object('vehicle_id', v.id, 'name', trim(concat_ws(' ', v.year::text, v.make, v.model)), 'n', x.n)
                            ORDER BY x.n DESC, v.year, v.make) AS vehicles
    FROM (SELECT day, vehicle_id, count(*) AS n FROM fr WHERE state IN ('on_vehicle', 'unverified') GROUP BY 1, 2) x
    JOIN public.vehicles v ON v.id = x.vehicle_id
    GROUP BY x.day
  ),
  day_held AS (
    SELECT day, jsonb_object_agg(reason, n) AS held_reasons
    FROM (SELECT day, reason, count(*) AS n FROM fr WHERE state = 'held' GROUP BY 1, 2) y GROUP BY day
  ),
  days AS (SELECT day FROM day_frames UNION SELECT day FROM day_skips),
  per_day AS (
    SELECT d.day, COALESCE(f.taken, 0) AS taken, COALESCE(f.on_vehicle, 0) AS on_vehicle, COALESCE(f.unverified, 0) AS unverified,
           COALESCE(f.waiting, 0) AS waiting, COALESCE(f.held, 0) AS held, COALESCE(f.pulled, 0) AS pulled, COALESCE(f.private, 0) AS private,
           COALESCE(f.unsorted, 0) AS unsorted, COALESCE(f.failed, 0) AS failed, COALESCE(s.skipped, 0) AS skipped,
           COALESCE(v.vehicles, '[]'::jsonb) AS vehicles, COALESCE(h.held_reasons, '{}'::jsonb) AS held_reasons, COALESCE(s.skip_reasons, '{}'::jsonb) AS skip_reasons
    FROM days d
    LEFT JOIN day_frames f USING (day) LEFT JOIN day_skips s USING (day) LEFT JOIN day_vehicles v USING (day) LEFT JOIN day_held h USING (day)
    ORDER BY d.day DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 180), 2000))
  ),
  tot AS (
    SELECT count(*) AS taken,
           count(*) FILTER (WHERE state = 'on_vehicle') AS on_vehicle, count(*) FILTER (WHERE state = 'unverified') AS unverified,
           count(*) FILTER (WHERE state = 'waiting') AS waiting, count(*) FILTER (WHERE state = 'held') AS held,
           count(*) FILTER (WHERE state = 'pulled') AS pulled, count(*) FILTER (WHERE state = 'private') AS private,
           count(*) FILTER (WHERE state = 'unsorted') AS unsorted, count(*) FILTER (WHERE state = 'failed') AS failed,
           (SELECT count(*) FROM sk) AS skipped
    FROM fr
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'tz', p_tz,
    'days', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.day DESC) FROM per_day p), '[]'::jsonb),
    'days_total', (SELECT count(*) FROM days),
    'totals', (SELECT to_jsonb(t) FROM tot t),
    'rescan', (SELECT to_jsonb(r) FROM public.capture_rescan_requests r, uid
                WHERE r.user_id = uid.id AND r.finished_at IS NULL ORDER BY r.requested_at DESC LIMIT 1),
    'last_rescan', (SELECT to_jsonb(r) FROM public.capture_rescan_requests r, uid
                     WHERE r.user_id = uid.id AND r.finished_at IS NOT NULL ORDER BY r.finished_at DESC LIMIT 1)
  )
$fn$;
REVOKE ALL ON FUNCTION public.get_capture_ledger(text, date, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_capture_ledger(text, date, date, integer) TO authenticated, service_role;

DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                 WHERE c.relname = 'idx_vehicle_images_capture_ledger' AND i.indisvalid AND i.indisready) THEN
    RAISE EXCEPTION 'capture ledger: idx_vehicle_images_capture_ledger is not valid';
  END IF;
  IF position('capture_ledger_states' IN pg_get_functiondef('public.get_capture_ledger(text, date, date, integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'capture ledger: the day list does not read the lean classifier';
  END IF;
  IF position('-infinity' IN pg_get_functiondef('public.capture_ledger_frames(uuid, text, date, date)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'capture ledger: the frame reader window is not bounded for the planner';
  END IF;
  IF has_function_privilege('anon', 'public.get_capture_ledger(text, date, date, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.capture_ledger_states(uuid, text, date, date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'capture ledger: grants are wrong';
  END IF;
END $chk$;
COMMIT;
