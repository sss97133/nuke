-- Exact copies: a photo whose bytes equal a photo already on a vehicle is recorded as that photo's duplicate, and the
-- capture ledger shows it as 'duplicate' instead of leaving it unsorted.
--
-- Why (2026-11-09): run 5d77a812 passed the gate for 42 photos of the black 1966 Mustang and filed none: each is a byte-
-- identical copy (same file_hash) of a photo already on that car, so attribute_testimony answers file_hash_exists_on_target.
-- Nothing recorded that, so the copies sat in the ledger as unsorted forever (43 such photos library-wide from capture runs).
-- Change: (1) capture_exact_copy_v1 / capture_exact_copy_revert_v1 + capture_exact_copy_log (signed by run, revertible);
-- (2) capture_ledger_states / capture_ledger_frames: state 'duplicate' (reason copy_of_filed, vehicle = the original's) for an
-- unfiled photo marked is_duplicate whose duplicate_of is on a vehicle; private and pulled still win; (3) get_capture_ledger
-- counts it per day and in totals ('duplicate').
-- Refuses on drift (live bodies read 2026-11-09). Revert: supabase/sql/revert_20261113120500_capture_exact_copy.sql.
-- Contract: supabase/sql/test_capture_exact_copy.sql. Lane: photo/document/library (Codex reviews).
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.capture_ledger_states(uuid, text, date, date)'::regprocedure)) <> 'd381b3258388fe536fb202dd8b2cfae6' -- gitleaks:allow (function fingerprint)
  OR md5(pg_get_functiondef('public.capture_ledger_frames(uuid, text, date, date)'::regprocedure)) <> '5d0f98d8b680210bda09d23afa74fc49' -- gitleaks:allow (function fingerprint)
  OR md5(pg_get_functiondef('public.get_capture_ledger(text, date, date, integer)'::regprocedure)) <> 'faca100047084e3f1111765fb8b116a4' THEN -- gitleaks:allow (function fingerprint)
    RAISE EXCEPTION 'capture ledger functions drifted from the bodies read 2026-11-09; re-record before patching';
  END IF;
END $guard$;

-- The producer: capture_exact_copy_v1 records an unfiled photo whose bytes (file_hash) equal a photo of the same owner already
-- on a vehicle as that photo's duplicate (is_duplicate, duplicate_of). One log row per photo, signed by run, revertible by run.
-- It never files, unfiles or deletes. It skips: sensitive photos (either side), private (rejected_personal) photos, photos
-- already recorded as a duplicate, and hashes filed on more than one vehicle (which original is ambiguous).
CREATE TABLE IF NOT EXISTS public.capture_exact_copy_log (
  run_id uuid NOT NULL,
  image_id uuid NOT NULL,
  original_id uuid NOT NULL,
  user_id uuid NOT NULL,
  file_hash text NOT NULL,
  prior jsonb NOT NULL,
  signature text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  PRIMARY KEY (run_id, image_id)
);
ALTER TABLE public.capture_exact_copy_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.capture_exact_copy_log FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.capture_exact_copy_v1(p_user uuid, p_run uuid, p_only uuid[] DEFAULT NULL,
  p_dry boolean DEFAULT true, p_cap integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '120s'
AS $function$
DECLARE v jsonb; n_ok int; n_amb int; n_done int := 0;
BEGIN
  IF p_user IS NULL OR p_run IS NULL THEN RAISE EXCEPTION 'capture_exact_copy_v1: p_user and p_run are required'; END IF;
  IF EXISTS (SELECT 1 FROM capture_exact_copy_log WHERE run_id = p_run) THEN
    RAISE EXCEPTION 'capture_exact_copy_v1: run % already written; use a new run id', p_run;
  END IF;
  WITH c AS (
    SELECT vi.id, vi.file_hash, vi.is_duplicate, vi.duplicate_of
    FROM vehicle_images vi
    WHERE vi.user_id = p_user AND vi.vehicle_id IS NULL AND nullif(btrim(vi.file_hash), '') IS NOT NULL
      AND (p_only IS NULL OR vi.id = ANY (p_only))
      AND NOT coalesce(vi.is_sensitive, false)
      AND vi.vision_gate_status::text IS DISTINCT FROM 'rejected_personal'
      AND NOT (coalesce(vi.is_duplicate, false) AND vi.duplicate_of IS NOT NULL)
  ), o AS (
    SELECT c.*,
      (SELECT f.id FROM vehicle_images f
        WHERE f.user_id = p_user AND f.file_hash = c.file_hash AND f.vehicle_id IS NOT NULL AND f.id <> c.id
          AND NOT coalesce(f.is_sensitive, false) AND f.vision_gate_status::text IS DISTINCT FROM 'rejected_personal'
        ORDER BY (f.vision_gate_status::text = 'approved') DESC, f.created_at, f.id LIMIT 1) AS original_id,
      (SELECT count(DISTINCT f.vehicle_id) FROM vehicle_images f
        WHERE f.user_id = p_user AND f.file_hash = c.file_hash AND f.vehicle_id IS NOT NULL AND f.id <> c.id) AS n_vehicles
    FROM c
  )
  SELECT jsonb_build_object(
    'ok', coalesce(jsonb_agg(jsonb_build_object('image_id', id, 'original_id', original_id, 'file_hash', file_hash,
            'prior', jsonb_build_object('is_duplicate', is_duplicate, 'duplicate_of', duplicate_of)) ORDER BY id)
            FILTER (WHERE original_id IS NOT NULL AND n_vehicles = 1), '[]'::jsonb),
    'ambiguous', count(*) FILTER (WHERE original_id IS NOT NULL AND n_vehicles > 1))
  INTO v FROM o;
  n_ok := jsonb_array_length(v->'ok'); n_amb := (v->>'ambiguous')::int;
  IF p_dry THEN
    RETURN jsonb_build_object('run_id', p_run, 'dry', true, 'would_mark', n_ok, 'ambiguous_original', n_amb, 'sample', v->'ok'->0);
  END IF;
  IF n_ok > coalesce(p_cap, 0) THEN
    RETURN jsonb_build_object('run_id', p_run, 'halted', true, 'reason', 'over_cap', 'would_mark', n_ok, 'cap', p_cap);
  END IF;
  INSERT INTO capture_exact_copy_log (run_id, image_id, original_id, user_id, file_hash, prior, signature)
  SELECT p_run, (x->>'image_id')::uuid, (x->>'original_id')::uuid, p_user, x->>'file_hash', x->'prior',
         encode(sha256(convert_to(concat_ws('|', 'capture_exact_copy_v1', p_run, x->>'image_id', x->>'original_id', x->>'file_hash'), 'UTF8')), 'hex')
  FROM jsonb_array_elements(v->'ok') x;
  UPDATE vehicle_images vi SET is_duplicate = true, duplicate_of = l.original_id
  FROM capture_exact_copy_log l
  WHERE l.run_id = p_run AND vi.id = l.image_id AND vi.vehicle_id IS NULL;
  GET DIAGNOSTICS n_done = ROW_COUNT;
  RETURN jsonb_build_object('run_id', p_run, 'dry', false, 'marked', n_done, 'ambiguous_original', n_amb);
END $function$;

CREATE OR REPLACE FUNCTION public.capture_exact_copy_revert_v1(p_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE n int;
BEGIN
  UPDATE vehicle_images vi SET is_duplicate = (l.prior->>'is_duplicate')::boolean, duplicate_of = (l.prior->>'duplicate_of')::uuid
  FROM capture_exact_copy_log l
  WHERE l.run_id = p_run AND l.reverted_at IS NULL AND vi.id = l.image_id AND vi.duplicate_of = l.original_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE capture_exact_copy_log SET reverted_at = now() WHERE run_id = p_run AND reverted_at IS NULL;
  RETURN jsonb_build_object('run_id', p_run, 'restored', n);
END $function$;
REVOKE ALL ON FUNCTION public.capture_exact_copy_v1(uuid, uuid, uuid[], boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_exact_copy_revert_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_exact_copy_v1(uuid, uuid, uuid[], boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_exact_copy_revert_v1(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.capture_ledger_states(p_uid uuid, p_tz text, p_from date, p_to date)
 RETURNS TABLE(image_id uuid, day date, state text, reason text, vehicle_id uuid, set_key text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  ), dupmap AS MATERIALIZED (
    -- scoped to this user's unfiled duplicates; joining vehicle_images directly in the main query
    -- made the live ledger hit statement_timeout (2026-11-09)
    SELECT c.id AS image_id, d.id, d.vehicle_id
    FROM public.vehicle_images c
    JOIN public.vehicle_images d ON d.id = c.duplicate_of AND d.vehicle_id IS NOT NULL
    WHERE c.user_id = p_uid AND c.vehicle_id IS NULL AND c.is_duplicate IS TRUE AND c.duplicate_of IS NOT NULL
  )
  SELECT vi.id,
         (COALESCE(vi.taken_at, vi.created_at) AT TIME ZONE p_tz)::date,
         CASE
           WHEN vi.vision_gate_status::text = 'rejected_personal' THEN 'private'
           WHEN vi.vision_gate_status::text = 'rejected_misattributed' THEN 'pulled'
           WHEN vi.vehicle_id IS NOT NULL AND vi.vision_gate_status::text = 'approved' THEN 'on_vehicle'
           WHEN vi.vehicle_id IS NOT NULL THEN 'unverified'
           WHEN dup.id IS NOT NULL THEN 'duplicate'
           WHEN f.image_id IS NOT NULL THEN 'failed'
           WHEN w.image_id IS NOT NULL THEN 'waiting'
           WHEN h.image_id IS NOT NULL THEN 'held'
           ELSE 'unsorted'
         END,
         CASE
           WHEN vi.vision_gate_status::text IN ('rejected_personal','rejected_misattributed') THEN vi.vision_gate_status::text
           WHEN vi.vehicle_id IS NOT NULL THEN COALESCE(vi.vision_gate_status::text, 'ungated')
           WHEN dup.id IS NOT NULL THEN 'copy_of_filed'
           WHEN f.image_id IS NOT NULL THEN COALESCE(f.error_class, 'failed')
           WHEN w.image_id IS NOT NULL THEN 'awaiting_gate'
           WHEN h.image_id IS NOT NULL THEN COALESCE(h.reason, 'held')
           ELSE 'not_scored'
         END,
         COALESCE(vi.vehicle_id, dup.vehicle_id),
         h.set_key
  FROM public.vehicle_images vi
  LEFT JOIN held h ON h.image_id = vi.id
  LEFT JOIN waiting w ON w.image_id = vi.id
  LEFT JOIN failed f ON f.image_id = vi.id
  -- 20261113120500: a byte-identical copy of a photo already on a vehicle is recorded as that photo's duplicate
  LEFT JOIN dupmap dup ON dup.image_id = vi.id
  WHERE vi.user_id = p_uid
    AND COALESCE(vi.taken_at, vi.created_at) >= COALESCE(p_from::timestamp AT TIME ZONE p_tz, '-infinity'::timestamptz)
    AND COALESCE(vi.taken_at, vi.created_at) < COALESCE((p_to + 1)::timestamp AT TIME ZONE p_tz, 'infinity'::timestamptz)
$function$;

CREATE OR REPLACE FUNCTION public.capture_ledger_frames(p_uid uuid, p_tz text, p_from date, p_to date)
 RETURNS TABLE(image_id uuid, day date, taken_at timestamp with time zone, state text, reason text, vehicle_id uuid, source text, file_name text, thumb text, asset_id text, set_key text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  ), dupmap AS MATERIALIZED (
    -- scoped to this user's unfiled duplicates; joining vehicle_images directly in the main query
    -- made the live ledger hit statement_timeout (2026-11-09)
    SELECT c.id AS image_id, d.id, d.vehicle_id
    FROM public.vehicle_images c
    JOIN public.vehicle_images d ON d.id = c.duplicate_of AND d.vehicle_id IS NOT NULL
    WHERE c.user_id = p_uid AND c.vehicle_id IS NULL AND c.is_duplicate IS TRUE AND c.duplicate_of IS NOT NULL
  )
  SELECT vi.id,
         (COALESCE(vi.taken_at, vi.created_at) AT TIME ZONE p_tz)::date,
         COALESCE(vi.taken_at, vi.created_at),
         CASE
           WHEN vi.vision_gate_status::text = 'rejected_personal' THEN 'private'
           WHEN vi.vision_gate_status::text = 'rejected_misattributed' THEN 'pulled'
           WHEN vi.vehicle_id IS NOT NULL AND vi.vision_gate_status::text = 'approved' THEN 'on_vehicle'
           WHEN vi.vehicle_id IS NOT NULL THEN 'unverified'
           WHEN dup.id IS NOT NULL THEN 'duplicate'
           WHEN f.image_id IS NOT NULL THEN 'failed'
           WHEN w.image_id IS NOT NULL THEN 'waiting'
           WHEN h.image_id IS NOT NULL THEN 'held'
           ELSE 'unsorted'
         END,
         CASE
           WHEN vi.vision_gate_status::text IN ('rejected_personal','rejected_misattributed') THEN vi.vision_gate_status::text
           WHEN vi.vehicle_id IS NOT NULL THEN COALESCE(vi.vision_gate_status::text, 'ungated')
           WHEN dup.id IS NOT NULL THEN 'copy_of_filed'
           WHEN f.image_id IS NOT NULL THEN COALESCE(f.error_class, 'failed')
           WHEN w.image_id IS NOT NULL THEN 'awaiting_gate'
           WHEN h.image_id IS NOT NULL THEN COALESCE(h.reason, 'held')
           ELSE 'not_scored'
         END,
         COALESCE(vi.vehicle_id, dup.vehicle_id), vi.source, vi.file_name,
         CASE WHEN vi.vision_gate_status::text = 'rejected_personal' THEN NULL ELSE COALESCE(vi.thumbnail_url, vi.image_url) END,
         vi.exif_data->>'uuid',
         h.set_key
  FROM public.vehicle_images vi
  LEFT JOIN held h ON h.image_id = vi.id
  LEFT JOIN waiting w ON w.image_id = vi.id
  LEFT JOIN failed f ON f.image_id = vi.id
  -- 20261113120500: a byte-identical copy of a photo already on a vehicle is recorded as that photo's duplicate
  LEFT JOIN dupmap dup ON dup.image_id = vi.id
  WHERE vi.user_id = p_uid
    AND COALESCE(vi.taken_at, vi.created_at) >= COALESCE(p_from::timestamp AT TIME ZONE p_tz, '-infinity'::timestamptz)
    AND COALESCE(vi.taken_at, vi.created_at) < COALESCE((p_to + 1)::timestamp AT TIME ZONE p_tz, 'infinity'::timestamptz)
$function$;

CREATE OR REPLACE FUNCTION public.get_capture_ledger(p_tz text DEFAULT 'America/Los_Angeles'::text, p_from date DEFAULT (CURRENT_DATE - 365), p_to date DEFAULT NULL::date, p_limit integer DEFAULT 180)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
           count(*) FILTER (WHERE state = 'unsorted') AS unsorted, count(*) FILTER (WHERE state = 'failed') AS failed,
           count(*) FILTER (WHERE state = 'duplicate') AS duplicate
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
           COALESCE(f.unsorted, 0) AS unsorted, COALESCE(f.failed, 0) AS failed, COALESCE(f.duplicate, 0) AS duplicate, COALESCE(s.skipped, 0) AS skipped,
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
           count(*) FILTER (WHERE state = 'duplicate') AS duplicate,
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
$function$;
COMMIT;
