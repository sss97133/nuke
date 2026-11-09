-- Capture ledger: frames the classifier (or the phone) already judged stop counting as 'unsorted'. No new state.
--
-- Measured live 2026-11-09 (owner 0b9f107a, 29,749 frames): 5,517 'unsorted'; of the in-source ones about 1,660 carry the
-- classifier's image_type 'other' (people, places, drawings, screenshots, renders), 786 are is_duplicate, about 275 were
-- skipped by the pipeline because the phone's on-device vision read them as not a vehicle, often personal. The landing pipeline
-- correctly never files them, so under 20261111170000 they read 'unsorted' forever.
-- Change (readers only; nothing is written to any frame):
--   * an unfiled frame that would read 'unsorted' and that the phone's on-device vision marked is_personal  -> 'private',
--     reason 'personal_on_device' (counted, never thumbnailed; a personal reading is never folded into skipped).
--   * is_duplicate                                                                                   -> 'skipped', reason 'duplicate'
--   * classifier image_type 'other'                                                                  -> 'skipped', reason 'not_vehicle:classifier'
--   * no classifier answer and on-device is_vehicle false                                            -> 'skipped', reason 'not_vehicle:on_device'
--   Each reason names its producer. Filed, pulled, private, failed, waiting and held frames are unchanged (they win first).
--   'skipped' is the state the phone's skips already use; the day list now counts arrived skipped frames in both 'taken' and
--   'skipped', and skip_reasons carries these reasons beside the phone's.
-- Perf: capture_ledger_states stays index-only for every other frame; the judged frames come from a small partial index
-- (built CONCURRENTLY, one 57 GB heap scan, about 15 min at the 76 MB/s measured 2026-11-08) and read the heap for those rows only.
-- Revert: supabase/sql/revert_20261113110000_capture_ledger_classifier_skips.sql. Contract: supabase/sql/test_capture_ledger_classifier_skips.sql.
-- Lane: photo/document/library (Codex reviews). Not applied live.
SET statement_timeout = '3300s';
SET lock_timeout = '60s';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicle_images_ledger_classified
  ON public.vehicle_images (user_id, (COALESCE(taken_at, created_at)))
  WHERE user_id IS NOT NULL AND vehicle_id IS NULL
          AND (is_duplicate IS TRUE
               OR (ai_scan_metadata #>> '{classification,image_type}') = 'other'
               OR (ai_scan_metadata #>> '{on_device_vision,is_vehicle}') = 'false'
               OR (ai_scan_metadata #>> '{on_device_vision,is_personal}') = 'true');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
             WHERE c.relname = 'idx_vehicle_images_ledger_classified' AND NOT i.indisvalid) THEN
    RAISE EXCEPTION 'idx_vehicle_images_ledger_classified is INVALID; DROP INDEX CONCURRENTLY public.idx_vehicle_images_ledger_classified and re-run';
  END IF;
END $$;

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

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
  ), cls AS (
    -- Classifier/phone judgments on unfiled frames, from the partial index idx_vehicle_images_ledger_classified (heap rows
    -- for these frames only). Precedence: a personal reading always wins (never folded into skipped).
    SELECT vi.id AS image_id,
           CASE WHEN (vi.ai_scan_metadata #>> '{on_device_vision,is_personal}') = 'true' THEN 'personal_on_device'
                WHEN vi.is_duplicate IS TRUE THEN 'duplicate'
                WHEN (vi.ai_scan_metadata #>> '{classification,image_type}') = 'other' THEN 'not_vehicle:classifier'
                WHEN (vi.ai_scan_metadata #>> '{classification,image_type}') IS NULL
                     AND (vi.ai_scan_metadata #>> '{on_device_vision,is_vehicle}') = 'false' THEN 'not_vehicle:on_device'
           END AS kind
    FROM public.vehicle_images vi
    WHERE vi.user_id = p_uid AND vi.user_id IS NOT NULL AND vi.vehicle_id IS NULL
          AND (vi.is_duplicate IS TRUE
               OR (vi.ai_scan_metadata #>> '{classification,image_type}') = 'other'
               OR (vi.ai_scan_metadata #>> '{on_device_vision,is_vehicle}') = 'false'
               OR (vi.ai_scan_metadata #>> '{on_device_vision,is_personal}') = 'true')
      AND COALESCE(vi.taken_at, vi.created_at) >= COALESCE(p_from::timestamp AT TIME ZONE p_tz, '-infinity'::timestamptz)
      AND COALESCE(vi.taken_at, vi.created_at) < COALESCE((p_to + 1)::timestamp AT TIME ZONE p_tz, 'infinity'::timestamptz)
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
           WHEN c.kind = 'personal_on_device' THEN 'private'
           WHEN c.kind IS NOT NULL THEN 'skipped'
           ELSE 'unsorted'
         END,
         CASE
           WHEN vi.vision_gate_status::text IN ('rejected_personal','rejected_misattributed') THEN vi.vision_gate_status::text
           WHEN vi.vehicle_id IS NOT NULL THEN COALESCE(vi.vision_gate_status::text, 'ungated')
           WHEN f.image_id IS NOT NULL THEN COALESCE(f.error_class, 'failed')
           WHEN w.image_id IS NOT NULL THEN 'awaiting_gate'
           WHEN h.image_id IS NOT NULL THEN COALESCE(h.reason, 'held')
           WHEN c.kind IS NOT NULL THEN c.kind
           ELSE 'not_scored'
         END,
         vi.vehicle_id, vi.source, vi.file_name,
         CASE WHEN vi.vision_gate_status::text = 'rejected_personal' OR c.kind = 'personal_on_device' THEN NULL ELSE COALESCE(vi.thumbnail_url, vi.image_url) END,
         vi.exif_data->>'uuid',
         h.set_key
  FROM public.vehicle_images vi
  LEFT JOIN held h ON h.image_id = vi.id
  LEFT JOIN waiting w ON w.image_id = vi.id
  LEFT JOIN failed f ON f.image_id = vi.id
  LEFT JOIN cls c ON c.image_id = vi.id
  WHERE vi.user_id = p_uid
    AND COALESCE(vi.taken_at, vi.created_at) >= COALESCE(p_from::timestamp AT TIME ZONE p_tz, '-infinity'::timestamptz)
    AND COALESCE(vi.taken_at, vi.created_at) < COALESCE((p_to + 1)::timestamp AT TIME ZONE p_tz, 'infinity'::timestamptz)
$fn$;
REVOKE ALL ON FUNCTION public.capture_ledger_frames(uuid, text, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_ledger_frames(uuid, text, date, date) TO service_role;


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
  ), cls AS (
    -- Classifier/phone judgments on unfiled frames, from the partial index idx_vehicle_images_ledger_classified (heap rows
    -- for these frames only). Precedence: a personal reading always wins (never folded into skipped).
    SELECT vi.id AS image_id,
           CASE WHEN (vi.ai_scan_metadata #>> '{on_device_vision,is_personal}') = 'true' THEN 'personal_on_device'
                WHEN vi.is_duplicate IS TRUE THEN 'duplicate'
                WHEN (vi.ai_scan_metadata #>> '{classification,image_type}') = 'other' THEN 'not_vehicle:classifier'
                WHEN (vi.ai_scan_metadata #>> '{classification,image_type}') IS NULL
                     AND (vi.ai_scan_metadata #>> '{on_device_vision,is_vehicle}') = 'false' THEN 'not_vehicle:on_device'
           END AS kind
    FROM public.vehicle_images vi
    WHERE vi.user_id = p_uid AND vi.user_id IS NOT NULL AND vi.vehicle_id IS NULL
          AND (vi.is_duplicate IS TRUE
               OR (vi.ai_scan_metadata #>> '{classification,image_type}') = 'other'
               OR (vi.ai_scan_metadata #>> '{on_device_vision,is_vehicle}') = 'false'
               OR (vi.ai_scan_metadata #>> '{on_device_vision,is_personal}') = 'true')
      AND COALESCE(vi.taken_at, vi.created_at) >= COALESCE(p_from::timestamp AT TIME ZONE p_tz, '-infinity'::timestamptz)
      AND COALESCE(vi.taken_at, vi.created_at) < COALESCE((p_to + 1)::timestamp AT TIME ZONE p_tz, 'infinity'::timestamptz)
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
           WHEN c.kind = 'personal_on_device' THEN 'private'
           WHEN c.kind IS NOT NULL THEN 'skipped'
           ELSE 'unsorted'
         END,
         CASE
           WHEN vi.vision_gate_status::text IN ('rejected_personal','rejected_misattributed') THEN vi.vision_gate_status::text
           WHEN vi.vehicle_id IS NOT NULL THEN COALESCE(vi.vision_gate_status::text, 'ungated')
           WHEN f.image_id IS NOT NULL THEN COALESCE(f.error_class, 'failed')
           WHEN w.image_id IS NOT NULL THEN 'awaiting_gate'
           WHEN h.image_id IS NOT NULL THEN COALESCE(h.reason, 'held')
           WHEN c.kind IS NOT NULL THEN c.kind
           ELSE 'not_scored'
         END,
         vi.vehicle_id,
         h.set_key
  FROM public.vehicle_images vi
  LEFT JOIN held h ON h.image_id = vi.id
  LEFT JOIN waiting w ON w.image_id = vi.id
  LEFT JOIN failed f ON f.image_id = vi.id
  LEFT JOIN cls c ON c.image_id = vi.id
  WHERE vi.user_id = p_uid
    AND COALESCE(vi.taken_at, vi.created_at) >= COALESCE(p_from::timestamp AT TIME ZONE p_tz, '-infinity'::timestamptz)
    AND COALESCE(vi.taken_at, vi.created_at) < COALESCE((p_to + 1)::timestamp AT TIME ZONE p_tz, 'infinity'::timestamptz)
$fn$;
REVOKE ALL ON FUNCTION public.capture_ledger_states(uuid, text, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_ledger_states(uuid, text, date, date) TO service_role;

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
  -- a skip is either the phone's (capture_skips, the frame never arrived) or the classifier's (an arrived, unfiled frame the
  -- classifier or the phone judged a duplicate or not a vehicle; reason names which). Both count as skipped.
  sk_all AS (SELECT day, reason FROM sk UNION ALL SELECT day, reason FROM fr WHERE state = 'skipped'),
  day_skips AS (
    SELECT day, sum(n)::bigint AS skipped, jsonb_object_agg(reason, n) AS skip_reasons
    FROM (SELECT day, reason, count(*) AS n FROM sk_all GROUP BY 1, 2) x GROUP BY day
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
           (SELECT count(*) FROM sk_all) AS skipped
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
  IF position('personal_on_device' IN pg_get_functiondef('public.capture_ledger_states(uuid, text, date, date)'::regprocedure)) = 0
     OR position('personal_on_device'' THEN NULL' IN pg_get_functiondef('public.capture_ledger_frames(uuid, text, date, date)'::regprocedure)) = 0
     OR position('sk_all' IN pg_get_functiondef('public.get_capture_ledger(text, date, date, integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'capture ledger classifier skips: readers not replaced';
  END IF;
  IF has_function_privilege('anon', 'public.get_capture_ledger(text, date, date, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.capture_ledger_states(uuid, text, date, date)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.capture_ledger_frames(uuid, text, date, date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'capture ledger classifier skips: grants are wrong';
  END IF;
END $chk$;
COMMIT;
