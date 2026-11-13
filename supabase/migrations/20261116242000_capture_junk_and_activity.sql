-- 20261116242000 capture_junk_placeholder and activity-evidence blocks
-- 1) Terminal ledger state `junk` for placeholder / test URLs (example.com,
--    test-trigger, or any non-empty URL that is not a supabase storage object).
--    Rows are kept, never deleted. empty_url / the 276 class is never touched.
-- 2) Signed producer capture_junk_placeholder_v1: dry-default, cap 50,
--    granted_by, revert-by-run. Writes only the audit log (image_ids[]);
--    the ledger reads that log. Never files, never invents clocks.
-- 3) Ledger CASE adds junk after non_vehicle and before duplicate, and
--    dupmap walks to a junk root as copy_of_junk. Timeout fix kept intact
--    (plan_cache_mode=force_custom_plan, MATERIALIZE held/waiting/failed/
--    non_vehicle/junk/dupmap). Parent is the live #3316 body
--    (md5 ba4646ae / 52d8f857).
-- 4) capture_activity_blocks_v1: per user and LA day, time blocks from all
--    clocked photos including private, non_vehicle, junk and clocked
--    empty_url (content-free clock_only markers). Exposes only the time
--    block, category and photo count — never image content or ids.
-- Revert: supabase/sql/revert_20261116242000_capture_junk_and_activity.sql

SET statement_timeout = '30s';
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.capture_junk_placeholder_log (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL,
  user_id uuid NOT NULL,
  granted_by uuid NOT NULL,
  image_ids uuid[] NOT NULL,
  signature text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  UNIQUE (run_id)
);
CREATE INDEX IF NOT EXISTS capture_junk_placeholder_log_live_idx
  ON public.capture_junk_placeholder_log (user_id, run_id)
  WHERE reverted_at IS NULL;

REVOKE ALL ON public.capture_junk_placeholder_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.capture_junk_placeholder_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.capture_junk_placeholder_log_id_seq TO service_role;


CREATE OR REPLACE FUNCTION public.capture_junk_placeholder_v1(
  p_user uuid, p_run uuid, p_granted_by uuid, p_dry boolean DEFAULT true, p_cap integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  n_elig int := 0;
  n_take int := 0;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_sig text;
BEGIN
  IF p_user IS NULL OR p_run IS NULL OR p_granted_by IS NULL THEN
    RAISE EXCEPTION 'capture_junk_placeholder_v1: user, run, and granted_by required';
  END IF;
  IF p_cap IS NULL OR p_cap < 1 OR p_cap > 50 THEN
    RAISE EXCEPTION 'capture_junk_placeholder_v1: cap must be between 1 and 50';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('capture_junk_placeholder'));

  WITH already AS MATERIALIZED (
    SELECT DISTINCT x.image_id
    FROM public.capture_junk_placeholder_log g
    CROSS JOIN LATERAL unnest(g.image_ids) AS x(image_id)
    WHERE g.reverted_at IS NULL
  ), elig AS MATERIALIZED (
    SELECT v.id AS image_id
    FROM public.vehicle_images v
    WHERE v.user_id = p_user
      AND v.vehicle_id IS NULL
      AND nullif(btrim(v.image_url), '') IS NOT NULL
      AND (
        lower(v.image_url) ~ 'example\.com'
        OR lower(v.image_url) ~ 'test-trigger'
        OR v.image_url !~* 'supabase\.co/storage/'
      )
      AND coalesce(v.is_sensitive, false) IS NOT TRUE
      AND coalesce(v.vision_gate_status::text, '') NOT IN ('rejected_personal','rejected_misattributed')
      AND NOT EXISTS (SELECT 1 FROM already a WHERE a.image_id = v.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.capture_privacy_promote_exclude e WHERE e.image_id = v.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.capture_set_links sl
        WHERE sl.image_id = v.id AND sl.reverted_at IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM public.capture_document_pages dp
        WHERE dp.image_id = v.id AND dp.revoked_at IS NULL)
  ), take AS MATERIALIZED (
    SELECT image_id
    FROM elig
    ORDER BY image_id
    LIMIT p_cap
  )
  SELECT (SELECT count(*) FROM elig),
         (SELECT count(*) FROM take),
         coalesce((SELECT array_agg(image_id ORDER BY image_id) FROM take), ARRAY[]::uuid[])
    INTO n_elig, n_take, v_ids;

  v_sig := 'capture_junk_placeholder_v1 run=' || p_run::text || ' granted_by=' || p_granted_by::text;

  IF p_dry THEN
    RETURN jsonb_build_object(
      'run', p_run, 'dry_run', true, 'granted_by', p_granted_by, 'signature', v_sig,
      'eligible', n_elig, 'would_mark', n_take, 'cap', p_cap,
      'image_ids', to_jsonb(v_ids));
  END IF;

  IF n_take > 0 THEN
    INSERT INTO public.capture_junk_placeholder_log(
        run_id, user_id, granted_by, image_ids, signature)
    VALUES (p_run, p_user, p_granted_by, v_ids, v_sig);
  END IF;

  RETURN jsonb_build_object(
    'run', p_run, 'dry_run', false, 'granted_by', p_granted_by, 'signature', v_sig,
    'eligible', n_elig, 'marked', n_take, 'cap', p_cap,
    'image_ids', to_jsonb(v_ids),
    'revert', 'select capture_junk_placeholder_revert_v1('
              || quote_literal(p_user::text) || ', ' || quote_literal(p_run::text) || ')');
END
$function$;

CREATE OR REPLACE FUNCTION public.capture_junk_placeholder_revert_v1(p_user uuid, p_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  n_log int := 0;
BEGIN
  IF p_user IS NULL OR p_run IS NULL THEN
    RAISE EXCEPTION 'capture_junk_placeholder_revert_v1: user and run required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('capture_junk_placeholder'));

  UPDATE public.capture_junk_placeholder_log
     SET reverted_at = now()
   WHERE user_id = p_user AND run_id = p_run AND reverted_at IS NULL;
  GET DIAGNOSTICS n_log = ROW_COUNT;

  RETURN jsonb_build_object('run_id', p_run, 'reverted_log', n_log);
END
$function$;

REVOKE ALL ON FUNCTION public.capture_junk_placeholder_v1(uuid, uuid, uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_junk_placeholder_revert_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_junk_placeholder_v1(uuid, uuid, uuid, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_junk_placeholder_revert_v1(uuid, uuid) TO service_role;


-- Activity-evidence projection. Clocked photos only; never invents a clock.
-- empty_url frames with taken_at are content-free clock_only markers (the 276
-- class is not updated). Categories: work, non_work, clock_only, unknown.
-- Adjacent photos on the same LA day stay in one block until the category
-- changes or the gap exceeds p_gap_minutes (default 60).
-- Receipt-work / evidence_judgment should consume these blocks to end a labor
-- window: receipt_work_lines today only cites vision-gate-approved, non-sensitive
-- frames already filed on the vehicle (receipt_work_frame_eligible), using
-- (taken_at AT TIME ZONE 'UTC')::date and, for labor, photos on anchor ±1 day.
-- It never sees private / non_vehicle / junk / empty_url frames, by design of
-- that eligibility rule. To bound labor ("work photos, then a family event"):
-- join this function on user and overlapping timestamptz, and treat the start
-- of the first non_work block after a work block as the end of the work window.
-- Do not pull image_ids from non_work, junk, private, or clock_only blocks into
-- citation lists. Compare block_start/block_end (timestamptz), not the UTC
-- date receipt_work_lines currently uses.
CREATE OR REPLACE FUNCTION public.capture_activity_blocks_v1(
  p_user uuid,
  p_tz text DEFAULT 'America/Los_Angeles',
  p_from date DEFAULT '1900-01-01',
  p_to date DEFAULT '2100-01-01',
  p_gap_minutes integer DEFAULT 60)
 RETURNS TABLE(
   user_id uuid,
   day date,
   block_start timestamp with time zone,
   block_end timestamp with time zone,
   category text,
   n_photos integer)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH params AS (
    SELECT p_user AS uid,
           coalesce(nullif(btrim(p_tz), ''), 'America/Los_Angeles') AS tz,
           coalesce(p_from, '1900-01-01'::date) AS d_from,
           coalesce(p_to, '2100-01-01'::date) AS d_to,
           greatest(coalesce(p_gap_minutes, 60), 1) AS gap_min
  ), nv AS MATERIALIZED (
    SELECT DISTINCT l.image_id
    FROM public.capture_non_vehicle_log l, params p
    WHERE l.user_id = p.uid AND l.reverted_at IS NULL AND l.verdict = 'non_vehicle'
  ), veh_look AS MATERIALIZED (
    SELECT DISTINCT l.image_id
    FROM public.capture_non_vehicle_log l, params p
    WHERE l.user_id = p.uid AND l.reverted_at IS NULL AND l.verdict = 'vehicle'
  ), junk AS MATERIALIZED (
    SELECT DISTINCT x.image_id
    FROM public.capture_junk_placeholder_log g
    CROSS JOIN LATERAL unnest(g.image_ids) AS x(image_id)
    , params p
    WHERE g.user_id = p.uid AND g.reverted_at IS NULL
  ), photos AS MATERIALIZED (
    SELECT v.id,
           v.user_id,
           v.taken_at,
           (v.taken_at AT TIME ZONE p.tz)::date AS day,
           CASE
             WHEN nullif(btrim(v.image_url), '') IS NULL THEN 'clock_only'
             WHEN v.vision_gate_status::text = 'rejected_personal' THEN 'non_work'
             WHEN v.is_sensitive IS TRUE THEN 'non_work'
             WHEN jk.image_id IS NOT NULL THEN 'non_work'
             WHEN nv.image_id IS NOT NULL THEN 'non_work'
             WHEN vl.image_id IS NOT NULL THEN 'work'
             WHEN v.vehicle_id IS NOT NULL THEN 'work'
             WHEN coalesce(v.ai_scan_metadata#>>'{classification,image_type}', '')
                    IN ('vehicle_exterior','vehicle_interior','engine_bay','part_closeup','progress_shot')
               THEN 'work'
             WHEN coalesce(v.ai_scan_metadata#>>'{classification,image_type}', '')
                    IN ('other','receipt_document')
               THEN 'non_work'
             ELSE 'unknown'
           END AS category
    FROM public.vehicle_images v
    CROSS JOIN params p
    LEFT JOIN nv ON nv.image_id = v.id
    LEFT JOIN veh_look vl ON vl.image_id = v.id
    LEFT JOIN junk jk ON jk.image_id = v.id
    WHERE v.user_id = p.uid
      AND v.taken_at IS NOT NULL
      AND (v.taken_at AT TIME ZONE p.tz)::date BETWEEN p.d_from AND p.d_to
  ), lagged AS (
    SELECT ph.*,
           lag(ph.category) OVER (PARTITION BY ph.day ORDER BY ph.taken_at, ph.id) AS prev_category,
           lag(ph.taken_at) OVER (PARTITION BY ph.day ORDER BY ph.taken_at, ph.id) AS prev_taken_at
    FROM photos ph
  ), marked AS (
    SELECT l.*,
           sum(CASE
                 WHEN l.prev_category IS DISTINCT FROM l.category
                   OR (l.prev_taken_at IS NOT NULL
                       AND l.taken_at - l.prev_taken_at
                             > make_interval(mins => (SELECT gap_min FROM params)))
                 THEN 1 ELSE 0
               END) OVER (PARTITION BY l.day ORDER BY l.taken_at, l.id) AS blk
    FROM lagged l
  )
  SELECT m.user_id,
         m.day,
         min(m.taken_at) AS block_start,
         max(m.taken_at) AS block_end,
         min(m.category) AS category,
         count(*)::int AS n_photos
  FROM marked m
  GROUP BY m.user_id, m.day, m.blk
  ORDER BY m.day, min(m.taken_at)
$function$;

REVOKE ALL ON FUNCTION public.capture_activity_blocks_v1(uuid, text, date, date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_activity_blocks_v1(uuid, text, date, date, integer) TO service_role;
COMMENT ON FUNCTION public.capture_activity_blocks_v1(uuid, text, date, date, integer) IS
  'Per-user LA-day activity time blocks from all clocked photos, including private, non_vehicle, junk and clocked empty_url (clock_only). Returns only time bounds, category and count — never image content. service_role only.';


CREATE OR REPLACE FUNCTION public.capture_ledger_states(p_uid uuid, p_tz text, p_from date, p_to date)
 RETURNS TABLE(image_id uuid, day date, state text, reason text, vehicle_id uuid, set_key text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
  WITH held AS MATERIALIZED (
    SELECT DISTINCT ON (x.image_id) x.image_id, r.reason, r.set_key
    FROM public.capture_set_review r CROSS JOIN LATERAL unnest(r.image_ids) AS x(image_id)
    WHERE r.user_id = p_uid AND r.status = 'open'
    ORDER BY x.image_id, r.created_at DESC
  ), waiting AS MATERIALIZED (
    SELECT DISTINCT x.image_id
    FROM public.capture_landing_chunks c
    JOIN public.capture_landing_sets s ON s.chunk_id = c.id AND s.decision = 'clear'
    CROSS JOIN LATERAL unnest(s.image_ids) AS x(image_id)
    WHERE c.user_id = p_uid AND c.state = 'awaiting_gate'
  ), failed AS MATERIALIZED (
    SELECT u.image_id, u.error_class FROM public.capture_upload_status u WHERE u.user_id = p_uid AND u.stage = 'failed'
  ), non_vehicle AS MATERIALIZED (
    SELECT l.image_id, l.reason
    FROM public.capture_non_vehicle_log l
    WHERE l.user_id = p_uid AND l.reverted_at IS NULL AND l.verdict = 'non_vehicle'
      AND NOT EXISTS (
        SELECT 1 FROM public.capture_non_vehicle_log l2
        WHERE l2.image_id = l.image_id AND l2.reverted_at IS NULL AND l2.verdict = 'non_vehicle' AND l2.applied_at > l.applied_at
      )
  ), junk AS MATERIALIZED (
    SELECT DISTINCT x.image_id, 'placeholder_url'::text AS reason
    FROM public.capture_junk_placeholder_log g
    CROSS JOIN LATERAL unnest(g.image_ids) AS x(image_id)
    WHERE g.user_id = p_uid AND g.reverted_at IS NULL
  ), dupmap AS MATERIALIZED (
    -- scoped to this user's unfiled duplicates; joining vehicle_images directly in the main query
    -- made the live ledger hit statement_timeout (2026-11-09).
    -- 20261115220000: walk duplicate_of chains to the first resolved root (filed, held,
    -- private, pulled, or non_vehicle), with cycle protection and a depth cap of 16.
    -- A missing original, a cycle, or an unresolved chain does not count.
    -- 20261116242000: a junk (placeholder/test URL) original also counts, as copy_of_junk.
    WITH RECURSIVE walk AS (
      SELECT c.id AS image_id,
             c.duplicate_of AS root_id,
             ARRAY[c.id] AS seen,
             1 AS depth
      FROM public.vehicle_images c
      WHERE c.user_id = p_uid AND c.vehicle_id IS NULL
        AND c.is_duplicate IS TRUE AND c.duplicate_of IS NOT NULL
      UNION ALL
      SELECT w.image_id,
             d.duplicate_of,
             w.seen || d.id,
             w.depth + 1
      FROM walk w
      JOIN public.vehicle_images d ON d.id = w.root_id
      WHERE w.depth < 16
        AND d.id <> ALL (w.seen)
        AND d.duplicate_of IS NOT NULL
        AND d.duplicate_of <> ALL (w.seen)
        AND d.vehicle_id IS NULL
        AND coalesce(d.vision_gate_status::text, '') NOT IN ('rejected_personal', 'rejected_misattributed')
        AND NOT EXISTS (SELECT 1 FROM non_vehicle nv WHERE nv.image_id = d.id)
        AND NOT EXISTS (SELECT 1 FROM junk j WHERE j.image_id = d.id)
        AND NOT EXISTS (SELECT 1 FROM held h WHERE h.image_id = d.id)
        AND d.is_duplicate IS TRUE
    ), root AS (
      SELECT DISTINCT ON (image_id) image_id, root_id
      FROM walk
      ORDER BY image_id, depth DESC
    )
    SELECT r.image_id, d.id, d.vehicle_id,
           CASE
             WHEN d.vision_gate_status::text = 'rejected_personal' THEN 'copy_of_private'
             WHEN d.vision_gate_status::text = 'rejected_misattributed' THEN 'copy_of_pulled'
             WHEN d.vehicle_id IS NOT NULL THEN 'copy_of_filed'
             WHEN nv_orig.image_id IS NOT NULL THEN 'copy_of_non_vehicle'
             WHEN j_orig.image_id IS NOT NULL THEN 'copy_of_junk'
             WHEN h_orig.image_id IS NOT NULL THEN 'copy_of_held'
           END AS reason
    FROM root r
    JOIN public.vehicle_images d ON d.id = r.root_id
    LEFT JOIN held h_orig ON h_orig.image_id = d.id
    LEFT JOIN non_vehicle nv_orig ON nv_orig.image_id = d.id
    LEFT JOIN junk j_orig ON j_orig.image_id = d.id
    WHERE d.vehicle_id IS NOT NULL
       OR d.vision_gate_status::text IN ('rejected_personal', 'rejected_misattributed')
       OR nv_orig.image_id IS NOT NULL
       OR j_orig.image_id IS NOT NULL
       OR h_orig.image_id IS NOT NULL
  )
  SELECT vi.id,
         (COALESCE(vi.taken_at, vi.created_at) AT TIME ZONE p_tz)::date,
         CASE
           WHEN vi.vision_gate_status::text = 'rejected_personal' THEN 'private'
           WHEN vi.vision_gate_status::text = 'rejected_misattributed' THEN 'pulled'
           WHEN vi.vehicle_id IS NOT NULL AND vi.vision_gate_status::text = 'approved' THEN 'on_vehicle'
           WHEN vi.vehicle_id IS NOT NULL THEN 'unverified'
           WHEN nv.image_id IS NOT NULL THEN 'non_vehicle'
           WHEN jk.image_id IS NOT NULL THEN 'junk'
           WHEN dup.id IS NOT NULL THEN 'duplicate'
           WHEN f.image_id IS NOT NULL THEN 'failed'
           WHEN w.image_id IS NOT NULL THEN 'waiting'
           WHEN h.image_id IS NOT NULL THEN 'held'
           ELSE 'unsorted'
         END,
         CASE
           WHEN vi.vision_gate_status::text IN ('rejected_personal','rejected_misattributed') THEN vi.vision_gate_status::text
           WHEN vi.vehicle_id IS NOT NULL THEN COALESCE(vi.vision_gate_status::text, 'ungated')
           WHEN nv.image_id IS NOT NULL THEN COALESCE(nv.reason, 'reviewed_non_vehicle')
           WHEN jk.image_id IS NOT NULL THEN COALESCE(jk.reason, 'placeholder_url')
           WHEN dup.id IS NOT NULL THEN COALESCE(dup.reason, 'copy_of_filed')
           WHEN f.image_id IS NOT NULL THEN COALESCE(f.error_class, 'failed')
           WHEN w.image_id IS NOT NULL THEN 'awaiting_gate'
           WHEN h.image_id IS NOT NULL THEN COALESCE(h.reason, 'held')
           ELSE 'not_scored'
         END,
         COALESCE(vi.vehicle_id, dup.vehicle_id),
         h.set_key
  FROM public.vehicle_images vi
  LEFT JOIN held h ON h.image_id = vi.id
  LEFT JOIN non_vehicle nv ON nv.image_id = vi.id
  LEFT JOIN junk jk ON jk.image_id = vi.id
  LEFT JOIN waiting w ON w.image_id = vi.id
  LEFT JOIN failed f ON f.image_id = vi.id
  -- 20261113120500 / 20261115180000 / 20261115220000: a byte-identical copy of a filed, held, private, pulled, or non_vehicle photo is a duplicate, including through other unfiled copies; a missing original, a cycle, or an unresolved chain is not
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
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
  WITH held AS MATERIALIZED (
    SELECT DISTINCT ON (x.image_id) x.image_id, r.reason, r.set_key
    FROM public.capture_set_review r CROSS JOIN LATERAL unnest(r.image_ids) AS x(image_id)
    WHERE r.user_id = p_uid AND r.status = 'open'
    ORDER BY x.image_id, r.created_at DESC
  ), waiting AS MATERIALIZED (
    SELECT DISTINCT x.image_id
    FROM public.capture_landing_chunks c
    JOIN public.capture_landing_sets s ON s.chunk_id = c.id AND s.decision = 'clear'
    CROSS JOIN LATERAL unnest(s.image_ids) AS x(image_id)
    WHERE c.user_id = p_uid AND c.state = 'awaiting_gate'
  ), failed AS MATERIALIZED (
    SELECT u.image_id, u.error_class FROM public.capture_upload_status u WHERE u.user_id = p_uid AND u.stage = 'failed'
  ), non_vehicle AS MATERIALIZED (
    SELECT l.image_id, l.reason
    FROM public.capture_non_vehicle_log l
    WHERE l.user_id = p_uid AND l.reverted_at IS NULL AND l.verdict = 'non_vehicle'
      AND NOT EXISTS (
        SELECT 1 FROM public.capture_non_vehicle_log l2
        WHERE l2.image_id = l.image_id AND l2.reverted_at IS NULL AND l2.verdict = 'non_vehicle' AND l2.applied_at > l.applied_at
      )
  ), junk AS MATERIALIZED (
    SELECT DISTINCT x.image_id, 'placeholder_url'::text AS reason
    FROM public.capture_junk_placeholder_log g
    CROSS JOIN LATERAL unnest(g.image_ids) AS x(image_id)
    WHERE g.user_id = p_uid AND g.reverted_at IS NULL
  ), dupmap AS MATERIALIZED (
    -- scoped to this user's unfiled duplicates; joining vehicle_images directly in the main query
    -- made the live ledger hit statement_timeout (2026-11-09).
    -- 20261115220000: walk duplicate_of chains to the first resolved root (filed, held,
    -- private, pulled, or non_vehicle), with cycle protection and a depth cap of 16.
    -- A missing original, a cycle, or an unresolved chain does not count.
    -- 20261116242000: a junk (placeholder/test URL) original also counts, as copy_of_junk.
    WITH RECURSIVE walk AS (
      SELECT c.id AS image_id,
             c.duplicate_of AS root_id,
             ARRAY[c.id] AS seen,
             1 AS depth
      FROM public.vehicle_images c
      WHERE c.user_id = p_uid AND c.vehicle_id IS NULL
        AND c.is_duplicate IS TRUE AND c.duplicate_of IS NOT NULL
      UNION ALL
      SELECT w.image_id,
             d.duplicate_of,
             w.seen || d.id,
             w.depth + 1
      FROM walk w
      JOIN public.vehicle_images d ON d.id = w.root_id
      WHERE w.depth < 16
        AND d.id <> ALL (w.seen)
        AND d.duplicate_of IS NOT NULL
        AND d.duplicate_of <> ALL (w.seen)
        AND d.vehicle_id IS NULL
        AND coalesce(d.vision_gate_status::text, '') NOT IN ('rejected_personal', 'rejected_misattributed')
        AND NOT EXISTS (SELECT 1 FROM non_vehicle nv WHERE nv.image_id = d.id)
        AND NOT EXISTS (SELECT 1 FROM junk j WHERE j.image_id = d.id)
        AND NOT EXISTS (SELECT 1 FROM held h WHERE h.image_id = d.id)
        AND d.is_duplicate IS TRUE
    ), root AS (
      SELECT DISTINCT ON (image_id) image_id, root_id
      FROM walk
      ORDER BY image_id, depth DESC
    )
    SELECT r.image_id, d.id, d.vehicle_id,
           CASE
             WHEN d.vision_gate_status::text = 'rejected_personal' THEN 'copy_of_private'
             WHEN d.vision_gate_status::text = 'rejected_misattributed' THEN 'copy_of_pulled'
             WHEN d.vehicle_id IS NOT NULL THEN 'copy_of_filed'
             WHEN nv_orig.image_id IS NOT NULL THEN 'copy_of_non_vehicle'
             WHEN j_orig.image_id IS NOT NULL THEN 'copy_of_junk'
             WHEN h_orig.image_id IS NOT NULL THEN 'copy_of_held'
           END AS reason
    FROM root r
    JOIN public.vehicle_images d ON d.id = r.root_id
    LEFT JOIN held h_orig ON h_orig.image_id = d.id
    LEFT JOIN non_vehicle nv_orig ON nv_orig.image_id = d.id
    LEFT JOIN junk j_orig ON j_orig.image_id = d.id
    WHERE d.vehicle_id IS NOT NULL
       OR d.vision_gate_status::text IN ('rejected_personal', 'rejected_misattributed')
       OR nv_orig.image_id IS NOT NULL
       OR j_orig.image_id IS NOT NULL
       OR h_orig.image_id IS NOT NULL
  )
  SELECT vi.id,
         (COALESCE(vi.taken_at, vi.created_at) AT TIME ZONE p_tz)::date,
         COALESCE(vi.taken_at, vi.created_at),
         CASE
           WHEN vi.vision_gate_status::text = 'rejected_personal' THEN 'private'
           WHEN vi.vision_gate_status::text = 'rejected_misattributed' THEN 'pulled'
           WHEN vi.vehicle_id IS NOT NULL AND vi.vision_gate_status::text = 'approved' THEN 'on_vehicle'
           WHEN vi.vehicle_id IS NOT NULL THEN 'unverified'
           WHEN nv.image_id IS NOT NULL THEN 'non_vehicle'
           WHEN jk.image_id IS NOT NULL THEN 'junk'
           WHEN dup.id IS NOT NULL THEN 'duplicate'
           WHEN f.image_id IS NOT NULL THEN 'failed'
           WHEN w.image_id IS NOT NULL THEN 'waiting'
           WHEN h.image_id IS NOT NULL THEN 'held'
           ELSE 'unsorted'
         END,
         CASE
           WHEN vi.vision_gate_status::text IN ('rejected_personal','rejected_misattributed') THEN vi.vision_gate_status::text
           WHEN vi.vehicle_id IS NOT NULL THEN COALESCE(vi.vision_gate_status::text, 'ungated')
           WHEN nv.image_id IS NOT NULL THEN COALESCE(nv.reason, 'reviewed_non_vehicle')
           WHEN jk.image_id IS NOT NULL THEN COALESCE(jk.reason, 'placeholder_url')
           WHEN dup.id IS NOT NULL THEN COALESCE(dup.reason, 'copy_of_filed')
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
  LEFT JOIN non_vehicle nv ON nv.image_id = vi.id
  LEFT JOIN junk jk ON jk.image_id = vi.id
  LEFT JOIN waiting w ON w.image_id = vi.id
  LEFT JOIN failed f ON f.image_id = vi.id
  -- 20261113120500 / 20261115180000 / 20261115220000: a byte-identical copy of a filed, held, private, pulled, or non_vehicle photo is a duplicate, including through other unfiled copies; a missing original, a cycle, or an unresolved chain is not
  LEFT JOIN dupmap dup ON dup.image_id = vi.id
  WHERE vi.user_id = p_uid
    AND COALESCE(vi.taken_at, vi.created_at) >= COALESCE(p_from::timestamp AT TIME ZONE p_tz, '-infinity'::timestamptz)
    AND COALESCE(vi.taken_at, vi.created_at) < COALESCE((p_to + 1)::timestamp AT TIME ZONE p_tz, 'infinity'::timestamptz)
$function$;
