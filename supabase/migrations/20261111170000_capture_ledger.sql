-- The capture ledger: one record of every photo an owner took, from the phone's gate to the vehicle it landed on, read
-- the same way by the website and the capture app.
--
-- Why (owner, 2026-11-07): "why's the website so disconnected functionally [from iOS]? they are not well aligned". Measured on
-- origin/main 77c17a5f4: the website reads none of the capture tables (0 files touch capture_upload_status, capture_set_review,
-- capture_set_links, the gate or the backlog view); it renders only photos already on a vehicle. The phone shows four stages
-- (uploaded, classifying, classified, attached) and keeps its gate decisions (no_location, off_site, screenshot, not_library,
-- not_own_camera) in an on-device log that never reaches the server. So the owner's question, "did my photos land, and if not
-- why", has no surface anywhere; this week it was answerable only with service-role SQL. Owner's frames by state on 2026-11-07:
-- on a vehicle 13,932 · held in review 5,453 · not sorted 5,676 · pulled 1,925 · unchecked on a vehicle 1,642 · kept private 544
-- · waiting on a gate check 323; dropped on the phone: unknown (never recorded).
--
-- Change (one migration):
--   capture_skips           -- what the phone dropped and why: (user_id, asset_id) → reason, taken_at. No coordinates, no bytes.
--   report_capture_skips    -- the phone's writer (authenticated, own rows only, ≤500 per call, upsert).
--   capture_rescan_requests -- "Re-scan my library" as a request the owner makes from any surface and the phone honors.
--   request_capture_rescan / claim_capture_rescan / finish_capture_rescan -- owner-only writers for that table.
--   get_capture_ledger      -- per day: taken, on_vehicle, unverified, waiting, held, pulled, private, unsorted, failed, skipped,
--                              with the vehicles and the reasons, newest day first. Owner's own frames only (auth.uid()).
--   get_capture_ledger_day  -- one day's frames with state, reason, vehicle, thumbnail, and the day's skipped assets.
-- States (one word each, the same on both clients):
--   on_vehicle  vehicle_id set, vision_gate_status approved
--   unverified  vehicle_id set, gate pending / review_needed / null
--   pulled      vision_gate_status rejected_misattributed (filed once, taken back off)
--   private     vision_gate_status rejected_personal (never shown; the ledger carries the count, never the thumbnail)
--   waiting     in a clear set of a landing chunk that sits at awaiting_gate (a viewed sample decides it)
--   held        in an open capture_set_review row (reason: no_clear_lead, score_below_threshold, ...)
--   failed      capture_upload_status.stage = 'failed'
--   unsorted    none of the above and no vehicle (not scored yet, or scored and left)
--   skipped     a capture_skips row whose asset never arrived as a frame (reason from the phone's gate)
-- Nothing here writes vehicle_images, capture_set_links or any testimony table.
-- Revert: supabase/sql/revert_20261111170000_capture_ledger.sql.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- ── capture_skips ────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.capture_skips (
  user_id    uuid NOT NULL,
  asset_id   text NOT NULL,                      -- PHAsset localIdentifier; the frame's exif_data->>'uuid' when it does arrive
  reason     text NOT NULL CHECK (reason IN ('no_location','off_site','screenshot','not_library','not_own_camera','personal','gave_up')),
  taken_at   timestamptz,
  device     text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, asset_id)
);
CREATE INDEX IF NOT EXISTS idx_capture_skips_user_taken ON public.capture_skips (user_id, taken_at);
ALTER TABLE public.capture_skips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS capture_skips_select_own ON public.capture_skips;
CREATE POLICY capture_skips_select_own ON public.capture_skips FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.capture_skips FROM PUBLIC, anon;
GRANT SELECT ON public.capture_skips TO authenticated;
GRANT ALL ON public.capture_skips TO service_role;
COMMENT ON TABLE public.capture_skips IS
  'Photos the capture app decided not to upload, and why (its GPS site gate, screenshot/library/camera checks, the personal hold). One row per (owner, Photos asset id); no coordinates, no pixels. Written by report_capture_skips from the phone; superseded by a vehicle_images row with the same exif uuid.';

CREATE OR REPLACE FUNCTION public.report_capture_skips(p_skips jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_n   integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'report_capture_skips: sign in' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_skips) <> 'array' THEN RAISE EXCEPTION 'report_capture_skips: p_skips must be an array'; END IF;
  IF jsonb_array_length(p_skips) > 500 THEN RAISE EXCEPTION 'report_capture_skips: at most 500 per call'; END IF;
  WITH rows AS (
    SELECT DISTINCT ON (s->>'asset_id')
           s->>'asset_id' AS asset_id, s->>'reason' AS reason,
           NULLIF(s->>'taken_at','')::timestamptz AS taken_at, NULLIF(s->>'device','') AS device,
           COALESCE(NULLIF(s->>'decided_at','')::timestamptz, now()) AS decided_at
    FROM jsonb_array_elements(p_skips) s
    WHERE COALESCE(s->>'asset_id','') <> ''
      AND s->>'reason' IN ('no_location','off_site','screenshot','not_library','not_own_camera','personal','gave_up')
    ORDER BY s->>'asset_id', COALESCE(NULLIF(s->>'decided_at','')::timestamptz, now()) DESC
  ), up AS (
    INSERT INTO public.capture_skips AS k (user_id, asset_id, reason, taken_at, device, decided_at)
    SELECT v_uid, asset_id, reason, taken_at, device, decided_at FROM rows
    ON CONFLICT (user_id, asset_id) DO UPDATE
      SET reason = EXCLUDED.reason, taken_at = COALESCE(EXCLUDED.taken_at, k.taken_at),
          device = COALESCE(EXCLUDED.device, k.device), decided_at = EXCLUDED.decided_at
      WHERE EXCLUDED.decided_at >= k.decided_at
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM up;
  RETURN jsonb_build_object('written', v_n);
END $fn$;
REVOKE ALL ON FUNCTION public.report_capture_skips(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_capture_skips(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.report_capture_skips(jsonb) IS
  'The capture app reports the photos it did not upload: [{asset_id, reason, taken_at?, device?, decided_at?}], own rows only, at most 500 per call, newest decision wins.';

-- ── capture_rescan_requests ──────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.capture_rescan_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  source       text NOT NULL DEFAULT 'web' CHECK (source IN ('web','ios','agent')),
  from_date    date,                           -- null: the whole library (the app's own cursor rule)
  acked_at     timestamptz,
  device       text,
  finished_at  timestamptz,
  result       jsonb
);
CREATE INDEX IF NOT EXISTS idx_capture_rescan_requests_user_open ON public.capture_rescan_requests (user_id, requested_at DESC) WHERE finished_at IS NULL;
ALTER TABLE public.capture_rescan_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS capture_rescan_requests_select_own ON public.capture_rescan_requests;
CREATE POLICY capture_rescan_requests_select_own ON public.capture_rescan_requests FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.capture_rescan_requests FROM PUBLIC, anon;
GRANT SELECT ON public.capture_rescan_requests TO authenticated;
GRANT ALL ON public.capture_rescan_requests TO service_role;
COMMENT ON TABLE public.capture_rescan_requests IS
  '"Re-scan my library" as a request: made from the website or the app (request_capture_rescan), claimed by the phone when it next runs (claim_capture_rescan), closed with its pass summary (finish_capture_rescan).';

CREATE OR REPLACE FUNCTION public.request_capture_rescan(p_from date DEFAULT NULL, p_source text DEFAULT 'web')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.capture_rescan_requests;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'request_capture_rescan: sign in' USING ERRCODE = '42501'; END IF;
  -- one open request at a time: a second ask widens the first instead of queueing
  SELECT * INTO v_row FROM public.capture_rescan_requests WHERE user_id = v_uid AND finished_at IS NULL ORDER BY requested_at DESC LIMIT 1;
  IF FOUND THEN
    IF v_row.acked_at IS NULL AND (p_from IS NULL OR v_row.from_date IS NULL OR p_from < v_row.from_date) THEN
      UPDATE public.capture_rescan_requests SET from_date = CASE WHEN p_from IS NULL OR v_row.from_date IS NULL THEN NULL ELSE least(p_from, v_row.from_date) END
       WHERE id = v_row.id RETURNING * INTO v_row;
    END IF;
    RETURN to_jsonb(v_row) || jsonb_build_object('reused', true);
  END IF;
  INSERT INTO public.capture_rescan_requests (user_id, from_date, source)
  VALUES (v_uid, p_from, CASE WHEN p_source IN ('web','ios','agent') THEN p_source ELSE 'web' END)
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row) || jsonb_build_object('reused', false);
END $fn$;
REVOKE ALL ON FUNCTION public.request_capture_rescan(date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_capture_rescan(date, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_capture_rescan(p_device text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.capture_rescan_requests;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'claim_capture_rescan: sign in' USING ERRCODE = '42501'; END IF;
  UPDATE public.capture_rescan_requests r SET acked_at = now(), device = COALESCE(p_device, r.device)
   WHERE r.id = (SELECT id FROM public.capture_rescan_requests WHERE user_id = v_uid AND finished_at IS NULL AND acked_at IS NULL
                 ORDER BY requested_at LIMIT 1 FOR UPDATE SKIP LOCKED)
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(v_row);
END $fn$;
REVOKE ALL ON FUNCTION public.claim_capture_rescan(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_capture_rescan(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.finish_capture_rescan(p_id uuid, p_result jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.capture_rescan_requests;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'finish_capture_rescan: sign in' USING ERRCODE = '42501'; END IF;
  UPDATE public.capture_rescan_requests SET finished_at = now(), acked_at = COALESCE(acked_at, now()), result = COALESCE(p_result, '{}'::jsonb)
   WHERE id = p_id AND user_id = v_uid AND finished_at IS NULL
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(v_row);
END $fn$;
REVOKE ALL ON FUNCTION public.finish_capture_rescan(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finish_capture_rescan(uuid, jsonb) TO authenticated, service_role;

-- ── the ledger ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- One frame → one state. Shared by both readers so a day's count and the day's list can never disagree.
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
    AND (p_from IS NULL OR COALESCE(vi.taken_at, vi.created_at) >= (p_from::timestamp AT TIME ZONE p_tz))
    AND (p_to IS NULL OR COALESCE(vi.taken_at, vi.created_at) < ((p_to + 1)::timestamp AT TIME ZONE p_tz))
$fn$;
REVOKE ALL ON FUNCTION public.capture_ledger_frames(uuid, text, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_ledger_frames(uuid, text, date, date) TO service_role;

-- Default window: the last 365 days. Measured 2026-11-07 on the owner's 29,749 frames (1,710 days): all time 6.7 s (exif_data
-- for the asset ids is the cost), the last 365 days (7,425 frames, 232 days) 143 ms. A page asks for earlier years by window.
CREATE OR REPLACE FUNCTION public.get_capture_ledger(p_tz text DEFAULT 'America/Los_Angeles', p_from date DEFAULT (current_date - 365),
                                                     p_to date DEFAULT NULL, p_limit integer DEFAULT 180)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH uid AS (SELECT auth.uid() AS id),
  fr AS (SELECT f.* FROM uid, LATERAL public.capture_ledger_frames(uid.id, p_tz, p_from, p_to) f WHERE uid.id IS NOT NULL),
  arrived AS (SELECT DISTINCT asset_id FROM fr WHERE asset_id IS NOT NULL),
  sk AS (
    SELECT (COALESCE(k.taken_at, k.decided_at) AT TIME ZONE p_tz)::date AS day, k.reason
    FROM public.capture_skips k, uid
    WHERE k.user_id = uid.id AND uid.id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM arrived a WHERE a.asset_id = k.asset_id)
      AND (p_from IS NULL OR COALESCE(k.taken_at, k.decided_at) >= (p_from::timestamp AT TIME ZONE p_tz))
      AND (p_to IS NULL OR COALESCE(k.taken_at, k.decided_at) < ((p_to + 1)::timestamp AT TIME ZONE p_tz))
  ),
  days AS (SELECT day FROM fr UNION SELECT day FROM sk),
  per_day AS (
    SELECT d.day,
      (SELECT count(*) FROM fr WHERE fr.day = d.day) AS taken,
      (SELECT count(*) FROM fr WHERE fr.day = d.day AND state = 'on_vehicle') AS on_vehicle,
      (SELECT count(*) FROM fr WHERE fr.day = d.day AND state = 'unverified') AS unverified,
      (SELECT count(*) FROM fr WHERE fr.day = d.day AND state = 'waiting') AS waiting,
      (SELECT count(*) FROM fr WHERE fr.day = d.day AND state = 'held') AS held,
      (SELECT count(*) FROM fr WHERE fr.day = d.day AND state = 'pulled') AS pulled,
      (SELECT count(*) FROM fr WHERE fr.day = d.day AND state = 'private') AS private,
      (SELECT count(*) FROM fr WHERE fr.day = d.day AND state = 'unsorted') AS unsorted,
      (SELECT count(*) FROM fr WHERE fr.day = d.day AND state = 'failed') AS failed,
      (SELECT count(*) FROM sk WHERE sk.day = d.day) AS skipped,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('vehicle_id', v.id, 'name', trim(concat_ws(' ', v.year::text, v.make, v.model)), 'n', x.n) ORDER BY x.n DESC, v.year, v.make), '[]'::jsonb)
         FROM (SELECT vehicle_id, count(*) n FROM fr WHERE fr.day = d.day AND state IN ('on_vehicle','unverified') GROUP BY vehicle_id) x
         JOIN public.vehicles v ON v.id = x.vehicle_id) AS vehicles,
      (SELECT COALESCE(jsonb_object_agg(reason, n), '{}'::jsonb)
         FROM (SELECT reason, count(*) n FROM fr WHERE fr.day = d.day AND state = 'held' GROUP BY reason) y) AS held_reasons,
      (SELECT COALESCE(jsonb_object_agg(reason, n), '{}'::jsonb)
         FROM (SELECT reason, count(*) n FROM sk WHERE sk.day = d.day GROUP BY reason) z) AS skip_reasons
    FROM days d
    ORDER BY d.day DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 180), 2000))
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'tz', p_tz,
    'days', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.day DESC) FROM per_day p), '[]'::jsonb),
    'days_total', (SELECT count(*) FROM days),
    'totals', jsonb_build_object(
      'taken', (SELECT count(*) FROM fr),
      'on_vehicle', (SELECT count(*) FROM fr WHERE state = 'on_vehicle'),
      'unverified', (SELECT count(*) FROM fr WHERE state = 'unverified'),
      'waiting', (SELECT count(*) FROM fr WHERE state = 'waiting'),
      'held', (SELECT count(*) FROM fr WHERE state = 'held'),
      'pulled', (SELECT count(*) FROM fr WHERE state = 'pulled'),
      'private', (SELECT count(*) FROM fr WHERE state = 'private'),
      'unsorted', (SELECT count(*) FROM fr WHERE state = 'unsorted'),
      'failed', (SELECT count(*) FROM fr WHERE state = 'failed'),
      'skipped', (SELECT count(*) FROM sk)),
    'rescan', (SELECT to_jsonb(r) FROM public.capture_rescan_requests r, uid
                WHERE r.user_id = uid.id AND r.finished_at IS NULL ORDER BY r.requested_at DESC LIMIT 1),
    'last_rescan', (SELECT to_jsonb(r) FROM public.capture_rescan_requests r, uid
                     WHERE r.user_id = uid.id AND r.finished_at IS NOT NULL ORDER BY r.finished_at DESC LIMIT 1)
  )
$fn$;
REVOKE ALL ON FUNCTION public.get_capture_ledger(text, date, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_capture_ledger(text, date, date, integer) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_capture_ledger(text, date, date, integer) IS
  'The signed-in owner''s capture ledger by day (newest first): taken, on_vehicle, unverified, waiting, held, pulled, private, unsorted, failed, skipped; the vehicles per day; held and skip reasons; the open and last re-scan request. Grain: one calendar day in p_tz by the photo''s taken_at (created_at when none). Own frames only.';

CREATE OR REPLACE FUNCTION public.get_capture_ledger_day(p_day date, p_tz text DEFAULT 'America/Los_Angeles')
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH uid AS (SELECT auth.uid() AS id),
  fr AS (SELECT f.* FROM uid, LATERAL public.capture_ledger_frames(uid.id, p_tz, p_day, p_day) f WHERE uid.id IS NOT NULL),
  arrived AS (SELECT DISTINCT asset_id FROM fr WHERE asset_id IS NOT NULL),
  cand AS (
    -- what the scorer weighed for a held set: the top-3 vehicles and their scores, so the owner sees the near misses
    -- (the newest open row of a set speaks for it)
    SELECT DISTINCT ON (r.set_key) r.set_key,
           (SELECT jsonb_agg(jsonb_build_object('vehicle_id', t->>'vehicle_id',
                     'name', (SELECT trim(concat_ws(' ', v.year::text, v.make, v.model)) FROM public.vehicles v WHERE v.id = (t->>'vehicle_id')::uuid),
                     'score', (t->'signals'->>'score')::numeric) ORDER BY (t->>'rank')::int)
              FROM jsonb_array_elements(COALESCE(r.evidence->'top3', '[]'::jsonb)) t) AS top3
    FROM public.capture_set_review r, uid
    WHERE r.user_id = uid.id AND r.status = 'open' AND r.set_key IN (SELECT DISTINCT set_key FROM fr WHERE set_key IS NOT NULL)
    ORDER BY r.set_key, r.created_at DESC
  )
  SELECT jsonb_build_object(
    'day', p_day, 'tz', p_tz,
    'frames', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'image_id', f.image_id, 'taken_at', f.taken_at, 'state', f.state, 'reason', f.reason,
                 'vehicle_id', f.vehicle_id,
                 'vehicle', (SELECT trim(concat_ws(' ', v.year::text, v.make, v.model)) FROM public.vehicles v WHERE v.id = f.vehicle_id),
                 'source', f.source, 'file_name', f.file_name, 'thumb', f.thumb, 'set_key', f.set_key,
                 'candidates', (SELECT c.top3 FROM cand c WHERE c.set_key = f.set_key)) ORDER BY f.taken_at, f.image_id)
               FROM fr f), '[]'::jsonb),
    'skipped', COALESCE((SELECT jsonb_agg(jsonb_build_object('asset_id', k.asset_id, 'reason', k.reason, 'taken_at', k.taken_at, 'decided_at', k.decided_at, 'device', k.device)
                                          ORDER BY COALESCE(k.taken_at, k.decided_at))
               FROM public.capture_skips k, uid
               WHERE k.user_id = uid.id AND uid.id IS NOT NULL
                 AND (COALESCE(k.taken_at, k.decided_at) AT TIME ZONE p_tz)::date = p_day
                 AND NOT EXISTS (SELECT 1 FROM arrived a WHERE a.asset_id = k.asset_id)), '[]'::jsonb)
  )
$fn$;
REVOKE ALL ON FUNCTION public.get_capture_ledger_day(date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_capture_ledger_day(date, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_capture_ledger_day(date, text) IS
  'One day of the signed-in owner''s capture ledger: every frame with its state, reason, vehicle, thumbnail (none for a private frame), the scorer''s top-3 for a held set, and the assets the phone skipped that day with their reasons.';

-- ── check ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
DO $chk$
BEGIN
  IF to_regclass('public.capture_skips') IS NULL OR to_regclass('public.capture_rescan_requests') IS NULL THEN
    RAISE EXCEPTION 'capture ledger: tables missing';
  END IF;
  IF to_regprocedure('public.get_capture_ledger(text, date, date, integer)') IS NULL
     OR to_regprocedure('public.get_capture_ledger_day(date, text)') IS NULL
     OR to_regprocedure('public.report_capture_skips(jsonb)') IS NULL
     OR to_regprocedure('public.request_capture_rescan(date, text)') IS NULL
     OR to_regprocedure('public.claim_capture_rescan(text)') IS NULL
     OR to_regprocedure('public.finish_capture_rescan(uuid, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'capture ledger: functions missing';
  END IF;
  IF has_function_privilege('anon', 'public.get_capture_ledger(text, date, date, integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.report_capture_skips(jsonb)', 'EXECUTE')
     OR has_table_privilege('anon', 'public.capture_skips', 'SELECT') THEN
    RAISE EXCEPTION 'capture ledger: anon must not reach the ledger';
  END IF;
END $chk$;
