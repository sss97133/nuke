-- Exact live #3439 capture_ledger_states / capture_ledger_frames bodies
-- (migration 20261116242000). Parent of 20261116246000.
-- prosrc md5s: states c0c9ce009df4ba6eb6b991306008186b,
-- frames 1726cacaced4e3209b692b402178dd3d.

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
