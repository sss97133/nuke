-- Owner status reads answer from per-user image counters and a per-user list of deep-analyzed images, kept by
-- statement triggers on vehicle_images, instead of scanning the user's vehicle_images rows on every call.
--
-- MEASURED 2026-10-15 13:50-14:40Z on prod for the owner's uid, statement_timeout 15 s (the authenticated role's):
--   get_user_sync_status       57014 at 15.5 s   counts all 28,271 of the uid's rows
--   get_user_capture_stats     57014 at 15.5 s   counts every source but scraped (~28K rows); the iOS app polls it
--   get_user_producer_signals  57014             calls get_user_capture_stats and get_user_analyzed_count
--   get_analysis_stream        57014 at 15.5 s   index scan of every uid row, heap + TOAST read of
--                                                ai_scan_metadata ? 'byok_deep_analysis', then a sort; polled every 4 s
--   get_user_analyzed_count    185 rows in 12.5 s
-- Cold 17.8 s, warm about 1 s: the uid's rows sit on pages no vacuum has cleared (vehicle_images has not been
-- vacuumed since the 2026-09-29 restart; its autovacuum thresholds are a separate migration).
-- pg_stats on vehicle_images.user_id (2026-10-15): null_frac 0.99945, n_distinct 3. Only about 29K of 52.5M rows carry
-- a user_id, so the triggers below do work only for those rows.
--
-- WHAT
-- 1. user_image_counts: signed count rows, grain (user_id, taken_day, created_day), appended by the triggers and
--    summed by the readers. Appending (never updating a shared row) keeps writers of the same user from waiting on
--    each other or deadlocking with the vehicles row locks the other vehicle_images triggers take. Several rows can
--    share a key; compact_user_image_counts() (cron compact-user-image-counts, every 15 minutes) merges them.
--      taken_day   = UTC date of coalesce(taken_at, created_at)  (the contribution day)
--      created_day = UTC date of created_at                      (the upload day)
--    The day columns are UTC because the database and every API session run in UTC (TimeZone = UTC, no role
--    override, read 2026-10-15); the live readers cast with the session time zone, so they agree under UTC.
--    Each count column is the FILTER the live reader used, so a sum equals the reader's count(*):
--      n_all               every row                                        all_sources_total
--      n_owned             source NOT IN (the six scraped sources)          capture_stats total_images, uploaded_today,
--                                                                           contribution_days
--      n_capture           source = 'capture_relay_ios'                     synced_total
--      n_capture_analyzed  ... AND ai_processing_status = 'analyzed'        analyzed_total, get_user_analyzed_count
--      n_capture_pending   ... AND ai_processing_status IN (pending, processing, queued)   pending_total
--      n_capture_filed     ... AND vehicle_id IS NOT NULL                   filed_total
--      n_capture_taken     ... AND taken_at IS NOT NULL                     which day holds the latest capture taken_at
-- 2. user_image_deep_reads: one row per image with user_id set, ai_scan_metadata ? 'byok_deep_analysis' and not
--    superseded, with that image's updated_at. get_analysis_stream walks it by (user_id, updated_at DESC) and joins
--    vehicle_images by id for at most p_limit rows, rechecking every original condition on the joined row. Its rows
--    are keyed by image, so writers never share one.
-- 3. Triggers: AFTER INSERT / UPDATE / DELETE ... FOR EACH STATEMENT with transition tables
--    (trg_user_image_counts_ins, _upd, _del), one function. Rows with user_id NULL are skipped, and a statement with
--    none returns after one EXISTS over its transition table. Local PG17, 3M-row fixture, median of 5 alternations,
--    triggers off -> on: 2,000 one-row UPDATEs of rows with no user 37.2 -> 42.2 ms; 2,000 one-row INSERTs with no
--    user 51.9 -> 47.0 ms (noise); 2,000 one-row INSERTs of owner rows 50.5 -> 69.1 ms; 2,000 one-row UPDATEs of owner
--    rows 39.9 -> 97.7 ms; one 1,000-row UPDATE of owner rows 15.3 -> 19.0 ms.
-- 4. Backfill, after the triggers exist: one statement per (user, 7-day band of taken_day), run through psql \gexec so
--    each band has its own statement_timeout. No statement reads vehicle_images by a full scan: users come from
--    one-row probes of a user_id index, bands from one-row probes of idx_vehicle_images_user_contrib_day, and each band
--    reads its rows through that index (prod EXPLAIN (GENERIC_PLAN), 2026-10-15: BitmapOr of two Bitmap Index Scans on
--    idx_vehicle_images_user_contrib_day). A band deletes the count rows of its keys and inserts the counts of its
--    rows in the same statement (one snapshot): a write committed before that snapshot is counted once, by the band; a
--    write committed after it keeps its trigger row. Bands with no rows are not run. The readers switch only after
--    every band has run, so a failed run leaves the old readers in place and can be run again.
-- 5. Readers, signatures, return shapes and grants unchanged (CREATE OR REPLACE keeps the ACLs). The owner gates are
--    what they were: get_user_sync_status reports is_owner_view = (auth.uid() = p_user_id) and returns counts to any
--    authenticated caller; get_user_capture_stats and get_user_analyzed_count have no gate; get_analysis_stream reads
--    only auth.uid()'s images (anon gets no rows). get_user_producer_signals is unchanged and gets faster through the
--    two readers it calls.
--      get_user_sync_status     sums of user_image_counts; last_synced_at = max(created_at) of the user's capture
--                               rows, the first entry of idx_vehicle_images_user_capture_stats; last_taken_at = the
--                               latest capture taken_at on the latest taken_day with n_capture_taken > 0, found by
--                               walking that day back from its end on idx_vehicle_images_user_taken_at
--      get_user_capture_stats   sums of n_owned (uploaded_today: created_day = the Los Angeles date, as before);
--                               contribution_days = taken days whose n_owned sums above 0; analyzed from work_sessions
--      get_user_analyzed_count  sum of n_capture_analyzed
--      get_analysis_stream      user_image_deep_reads -> vehicle_images (by id) -> vehicles
--    Pages read per call on the local fixture (28,300 owner rows, the capture rows rewritten since the last vacuum),
--    live -> new: sync_status 2,572 -> 132; capture_stats 2,575 -> 122; producer_signals 12,973 -> 187;
--    analyzed_count 10,391 -> 61; analysis_stream(NULL, 40) 4,499 -> 418.
-- No index is created on vehicle_images. Follow-up, not built here (a build scans 6.37M pages on this VM): an index
-- for sync_local_vision_tags' exif_data->>'uuid' lookup.
-- Revert: re-create the four changed readers as defined live on 2026-10-15 (the contract
-- supabase/sql/test_user_image_counts.sql re-creates them, comments trimmed), DROP the three triggers and unschedule
-- compact-user-image-counts; the two tables are then unused.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.user_image_counts (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id            uuid    NOT NULL,
  taken_day          date,
  created_day        date,
  n_all              integer NOT NULL DEFAULT 0,
  n_owned            integer NOT NULL DEFAULT 0,
  n_capture          integer NOT NULL DEFAULT 0,
  n_capture_analyzed integer NOT NULL DEFAULT 0,
  n_capture_pending  integer NOT NULL DEFAULT 0,
  n_capture_filed    integer NOT NULL DEFAULT 0,
  n_capture_taken    integer NOT NULL DEFAULT 0,
  recorded_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_image_counts_user_days ON public.user_image_counts (user_id, taken_day, created_day);
ALTER TABLE public.user_image_counts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_image_counts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.user_image_counts TO service_role;
COMMENT ON TABLE public.user_image_counts IS
'Signed counts of vehicle_images rows per user, appended by the statement triggers trg_user_image_counts_ins/_upd/_del (track_user_image_counts) and by backfill_user_image_counts(), merged by compact_user_image_counts() (grain: user_id + taken_day + created_day; several rows can share a key and the reader sums them). Rows with user_id NULL are not counted. Read by get_user_sync_status, get_user_capture_stats and get_user_analyzed_count. Migration 20261016201000.';
COMMENT ON COLUMN public.user_image_counts.id IS 'Row id, used by compaction. Unit: none (key). Source: identity. Grain: one appended row. Clock: n/a.';
COMMENT ON COLUMN public.user_image_counts.user_id IS 'vehicle_images.user_id of the counted rows. Unit: none (key). Source: vehicle_images.user_id. Grain: one user. Clock: n/a.';
COMMENT ON COLUMN public.user_image_counts.taken_day IS 'UTC date of coalesce(taken_at, created_at) of the counted rows (the contribution day); NULL when both are NULL. Unit: date (UTC). Source: vehicle_images.taken_at, created_at. Grain: one day. Clock: capture time.';
COMMENT ON COLUMN public.user_image_counts.created_day IS 'UTC date of created_at of the counted rows (the upload day); NULL when created_at is NULL. Unit: date (UTC). Source: vehicle_images.created_at. Grain: one day. Clock: upload time.';
COMMENT ON COLUMN public.user_image_counts.n_all IS 'Rows, any source (signed: + for a row entering this key, - for one leaving it). Unit: count of vehicle_images rows. Source: vehicle_images. Grain: one key. Clock: as of recorded_at.';
COMMENT ON COLUMN public.user_image_counts.n_owned IS 'Rows whose source is not one of bat_import, bat_listing, external_import, organization_import, scraper, scraped (NULL source is not counted). Unit: count (signed). Source: vehicle_images.source. Grain: one key. Clock: as of recorded_at.';
COMMENT ON COLUMN public.user_image_counts.n_capture IS 'Rows with source = capture_relay_ios (the phone). Unit: count (signed). Source: vehicle_images.source. Grain: one key. Clock: as of recorded_at.';
COMMENT ON COLUMN public.user_image_counts.n_capture_analyzed IS 'capture_relay_ios rows with ai_processing_status = analyzed. Unit: count (signed). Source: vehicle_images.ai_processing_status. Grain: one key. Clock: as of recorded_at.';
COMMENT ON COLUMN public.user_image_counts.n_capture_pending IS 'capture_relay_ios rows with ai_processing_status pending, processing or queued. Unit: count (signed). Source: vehicle_images.ai_processing_status. Grain: one key. Clock: as of recorded_at.';
COMMENT ON COLUMN public.user_image_counts.n_capture_filed IS 'capture_relay_ios rows with a vehicle_id. Unit: count (signed). Source: vehicle_images.vehicle_id. Grain: one key. Clock: as of recorded_at.';
COMMENT ON COLUMN public.user_image_counts.n_capture_taken IS 'capture_relay_ios rows with a taken_at (locates the day of the latest capture taken_at). Unit: count (signed). Source: vehicle_images.taken_at. Grain: one key. Clock: as of recorded_at.';
COMMENT ON COLUMN public.user_image_counts.recorded_at IS 'When the row was appended. Unit: timestamptz. Source: now(). Grain: one appended row. Clock: write time.';

CREATE TABLE IF NOT EXISTS public.user_image_deep_reads (
  image_id   uuid PRIMARY KEY,
  user_id    uuid NOT NULL,
  updated_at timestamptz
);
CREATE INDEX IF NOT EXISTS user_image_deep_reads_user_updated ON public.user_image_deep_reads (user_id, updated_at DESC);
ALTER TABLE public.user_image_deep_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_image_deep_reads FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.user_image_deep_reads TO service_role;
COMMENT ON TABLE public.user_image_deep_reads IS
'The vehicle_images rows with a user_id, ai_scan_metadata ? byok_deep_analysis and is_superseded not true, with their updated_at, kept by track_user_image_counts and backfill_user_image_counts() (grain: one image). Candidate list only: get_analysis_stream rechecks every condition on vehicle_images. Migration 20261016201000.';
COMMENT ON COLUMN public.user_image_deep_reads.image_id IS 'vehicle_images.id. Unit: none (key). Source: vehicle_images.id. Grain: one image. Clock: n/a.';
COMMENT ON COLUMN public.user_image_deep_reads.user_id IS 'vehicle_images.user_id of the image. Unit: none (key). Source: vehicle_images.user_id. Grain: one image. Clock: n/a.';
COMMENT ON COLUMN public.user_image_deep_reads.updated_at IS 'vehicle_images.updated_at of the image as last written (the stream''s landed_at and sort key). Unit: timestamptz. Source: vehicle_images.updated_at. Grain: one image. Clock: row update time.';

INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT 'user_image_counts', NULL, 'track_user_image_counts',
       'Signed per-user counts of vehicle_images rows (grain user_id + taken_day + created_day), summed by the owner status readers.',
       true, 'Statement triggers trg_user_image_counts_ins/_upd/_del on vehicle_images; backfill_user_image_counts(); compact_user_image_counts() (cron compact-user-image-counts). Migration 20261016201000.'
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry p WHERE p.table_name = 'user_image_counts' AND p.column_name IS NULL);
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT 'user_image_deep_reads', NULL, 'track_user_image_counts',
       'Per-image list of a user''s byok deep-analyzed, not superseded vehicle_images rows with updated_at; read by get_analysis_stream.',
       true, 'Statement triggers trg_user_image_counts_ins/_upd/_del on vehicle_images; backfill_user_image_counts(). Migration 20261016201000.'
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry p WHERE p.table_name = 'user_image_deep_reads' AND p.column_name IS NULL);

-- The trigger function. Each count is the live readers' FILTER, so count(*) FILTER (...) treats a NULL condition as
-- not counted, as they did.
CREATE OR REPLACE FUNCTION public.track_user_image_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Most statements touch only rows with no user (scrapers); they return here. Measured on a local PG17 fixture:
  -- 500 one-row UPDATEs took 7 ms with no trigger and with this check, 76 ms when the queries below ran every time.
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM new_rows WHERE user_id IS NOT NULL) THEN RETURN NULL; END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NOT EXISTS (SELECT 1 FROM new_rows WHERE user_id IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM old_rows WHERE user_id IS NOT NULL) THEN RETURN NULL; END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM old_rows WHERE user_id IS NOT NULL) THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.user_image_counts (user_id, taken_day, created_day, n_all, n_owned, n_capture,
      n_capture_analyzed, n_capture_pending, n_capture_filed, n_capture_taken)
    SELECT n.user_id,
           (coalesce(n.taken_at, n.created_at) AT TIME ZONE 'UTC')::date,
           (n.created_at AT TIME ZONE 'UTC')::date,
           count(*),
           count(*) FILTER (WHERE n.source NOT IN ('bat_import','bat_listing','external_import','organization_import','scraper','scraped')),
           count(*) FILTER (WHERE n.source = 'capture_relay_ios'),
           count(*) FILTER (WHERE n.source = 'capture_relay_ios' AND n.ai_processing_status = 'analyzed'),
           count(*) FILTER (WHERE n.source = 'capture_relay_ios' AND n.ai_processing_status IN ('pending','processing','queued')),
           count(*) FILTER (WHERE n.source = 'capture_relay_ios' AND n.vehicle_id IS NOT NULL),
           count(*) FILTER (WHERE n.source = 'capture_relay_ios' AND n.taken_at IS NOT NULL)
    FROM new_rows n
    WHERE n.user_id IS NOT NULL
    GROUP BY 1, 2, 3;

    INSERT INTO public.user_image_deep_reads AS d (image_id, user_id, updated_at)
    SELECT n.id, n.user_id, n.updated_at
    FROM new_rows n
    WHERE n.user_id IS NOT NULL AND n.is_superseded IS NOT TRUE AND n.ai_scan_metadata ? 'byok_deep_analysis'
    ON CONFLICT (image_id) DO UPDATE SET user_id = excluded.user_id, updated_at = excluded.updated_at;

  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.user_image_counts (user_id, taken_day, created_day, n_all, n_owned, n_capture,
      n_capture_analyzed, n_capture_pending, n_capture_filed, n_capture_taken)
    SELECT c.user_id, c.taken_day, c.created_day, sum(c.n_all), sum(c.n_owned), sum(c.n_capture),
           sum(c.n_capture_analyzed), sum(c.n_capture_pending), sum(c.n_capture_filed), sum(c.n_capture_taken)
    FROM (
      SELECT n.user_id,
             (coalesce(n.taken_at, n.created_at) AT TIME ZONE 'UTC')::date AS taken_day,
             (n.created_at AT TIME ZONE 'UTC')::date AS created_day,
             count(*) AS n_all,
             count(*) FILTER (WHERE n.source NOT IN ('bat_import','bat_listing','external_import','organization_import','scraper','scraped')) AS n_owned,
             count(*) FILTER (WHERE n.source = 'capture_relay_ios') AS n_capture,
             count(*) FILTER (WHERE n.source = 'capture_relay_ios' AND n.ai_processing_status = 'analyzed') AS n_capture_analyzed,
             count(*) FILTER (WHERE n.source = 'capture_relay_ios' AND n.ai_processing_status IN ('pending','processing','queued')) AS n_capture_pending,
             count(*) FILTER (WHERE n.source = 'capture_relay_ios' AND n.vehicle_id IS NOT NULL) AS n_capture_filed,
             count(*) FILTER (WHERE n.source = 'capture_relay_ios' AND n.taken_at IS NOT NULL) AS n_capture_taken
      FROM new_rows n WHERE n.user_id IS NOT NULL GROUP BY 1, 2, 3
      UNION ALL
      SELECT o.user_id,
             (coalesce(o.taken_at, o.created_at) AT TIME ZONE 'UTC')::date,
             (o.created_at AT TIME ZONE 'UTC')::date,
             -count(*),
             -count(*) FILTER (WHERE o.source NOT IN ('bat_import','bat_listing','external_import','organization_import','scraper','scraped')),
             -count(*) FILTER (WHERE o.source = 'capture_relay_ios'),
             -count(*) FILTER (WHERE o.source = 'capture_relay_ios' AND o.ai_processing_status = 'analyzed'),
             -count(*) FILTER (WHERE o.source = 'capture_relay_ios' AND o.ai_processing_status IN ('pending','processing','queued')),
             -count(*) FILTER (WHERE o.source = 'capture_relay_ios' AND o.vehicle_id IS NOT NULL),
             -count(*) FILTER (WHERE o.source = 'capture_relay_ios' AND o.taken_at IS NOT NULL)
      FROM old_rows o WHERE o.user_id IS NOT NULL GROUP BY 1, 2, 3
    ) c
    GROUP BY 1, 2, 3
    HAVING sum(c.n_all) <> 0 OR sum(c.n_owned) <> 0 OR sum(c.n_capture) <> 0 OR sum(c.n_capture_analyzed) <> 0
        OR sum(c.n_capture_pending) <> 0 OR sum(c.n_capture_filed) <> 0 OR sum(c.n_capture_taken) <> 0;

    INSERT INTO public.user_image_deep_reads AS d (image_id, user_id, updated_at)
    SELECT n.id, n.user_id, n.updated_at
    FROM new_rows n
    WHERE n.user_id IS NOT NULL AND n.is_superseded IS NOT TRUE AND n.ai_scan_metadata ? 'byok_deep_analysis'
    ON CONFLICT (image_id) DO UPDATE SET user_id = excluded.user_id, updated_at = excluded.updated_at;

    DELETE FROM public.user_image_deep_reads d
    USING new_rows n
    WHERE d.image_id = n.id
      AND (n.user_id IS NULL OR n.is_superseded IS TRUE OR NOT coalesce(n.ai_scan_metadata ? 'byok_deep_analysis', false));

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.user_image_counts (user_id, taken_day, created_day, n_all, n_owned, n_capture,
      n_capture_analyzed, n_capture_pending, n_capture_filed, n_capture_taken)
    SELECT o.user_id,
           (coalesce(o.taken_at, o.created_at) AT TIME ZONE 'UTC')::date,
           (o.created_at AT TIME ZONE 'UTC')::date,
           -count(*),
           -count(*) FILTER (WHERE o.source NOT IN ('bat_import','bat_listing','external_import','organization_import','scraper','scraped')),
           -count(*) FILTER (WHERE o.source = 'capture_relay_ios'),
           -count(*) FILTER (WHERE o.source = 'capture_relay_ios' AND o.ai_processing_status = 'analyzed'),
           -count(*) FILTER (WHERE o.source = 'capture_relay_ios' AND o.ai_processing_status IN ('pending','processing','queued')),
           -count(*) FILTER (WHERE o.source = 'capture_relay_ios' AND o.vehicle_id IS NOT NULL),
           -count(*) FILTER (WHERE o.source = 'capture_relay_ios' AND o.taken_at IS NOT NULL)
    FROM old_rows o
    WHERE o.user_id IS NOT NULL
    GROUP BY 1, 2, 3;

    DELETE FROM public.user_image_deep_reads d USING old_rows o WHERE d.image_id = o.id;
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.track_user_image_counts() FROM PUBLIC, anon, authenticated;

-- One band of the backfill: the user's rows whose taken_day is in [p_from, p_to), or, with both NULL, the rows whose
-- taken_at and created_at are both NULL. The advisory lock keeps it apart from compaction; the statement after it
-- takes its own snapshot.
CREATE OR REPLACE FUNCTION public.backfill_user_image_counts(p_user_id uuid, p_from date, p_to date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lo timestamptz := p_from::timestamp AT TIME ZONE 'UTC';
  v_hi timestamptz := p_to::timestamp AT TIME ZONE 'UTC';
  v_rows integer;
BEGIN
  IF p_user_id IS NULL OR (p_from IS NULL) <> (p_to IS NULL) THEN
    RAISE EXCEPTION 'backfill_user_image_counts: a user and both band ends (or neither) are required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('public.user_image_counts'));

  WITH src AS MATERIALIZED (
    SELECT vi.id, vi.user_id, vi.created_at, vi.taken_at, vi.source, vi.ai_processing_status, vi.vehicle_id,
           vi.updated_at, (vi.is_superseded IS NOT TRUE AND vi.ai_scan_metadata ? 'byok_deep_analysis') AS deep
    FROM public.vehicle_images vi
    WHERE vi.user_id = p_user_id
      AND ((p_from IS NULL AND coalesce(vi.taken_at, vi.created_at) IS NULL)
        OR (coalesce(vi.taken_at, vi.created_at) >= v_lo AND coalesce(vi.taken_at, vi.created_at) < v_hi))
  ),
  cleared AS (
    DELETE FROM public.user_image_counts c
    WHERE c.user_id = p_user_id
      AND ((p_from IS NULL AND c.taken_day IS NULL) OR (c.taken_day >= p_from AND c.taken_day < p_to))
  ),
  counted AS (
    INSERT INTO public.user_image_counts (user_id, taken_day, created_day, n_all, n_owned, n_capture,
      n_capture_analyzed, n_capture_pending, n_capture_filed, n_capture_taken)
    SELECT s.user_id,
           (coalesce(s.taken_at, s.created_at) AT TIME ZONE 'UTC')::date,
           (s.created_at AT TIME ZONE 'UTC')::date,
           count(*),
           count(*) FILTER (WHERE s.source NOT IN ('bat_import','bat_listing','external_import','organization_import','scraper','scraped')),
           count(*) FILTER (WHERE s.source = 'capture_relay_ios'),
           count(*) FILTER (WHERE s.source = 'capture_relay_ios' AND s.ai_processing_status = 'analyzed'),
           count(*) FILTER (WHERE s.source = 'capture_relay_ios' AND s.ai_processing_status IN ('pending','processing','queued')),
           count(*) FILTER (WHERE s.source = 'capture_relay_ios' AND s.vehicle_id IS NOT NULL),
           count(*) FILTER (WHERE s.source = 'capture_relay_ios' AND s.taken_at IS NOT NULL)
    FROM src s
    GROUP BY 1, 2, 3
  ),
  listed AS (
    -- a row a trigger already wrote is as new as this snapshot or newer
    INSERT INTO public.user_image_deep_reads (image_id, user_id, updated_at)
    SELECT s.id, s.user_id, s.updated_at FROM src s WHERE s.deep
    ON CONFLICT (image_id) DO NOTHING
  )
  SELECT count(*) INTO v_rows FROM src;
  RETURN v_rows;
END
$$;
REVOKE ALL ON FUNCTION public.backfill_user_image_counts(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_user_image_counts(uuid, date, date) TO service_role;

-- Merge rows that share a key into one, and drop keys that sum to zero. At most p_limit rows per run; a key split
-- across runs still sums correctly. Skips when a backfill holds the lock.
CREATE OR REPLACE FUNCTION public.compact_user_image_counts(p_limit integer DEFAULT 50000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_merged integer;
  v_written integer;
BEGIN
  SET LOCAL lock_timeout = '2s';
  IF NOT pg_try_advisory_xact_lock(hashtext('public.user_image_counts')) THEN
    RETURN jsonb_build_object('skipped', 'backfill running');
  END IF;

  WITH grp AS (
    SELECT array_agg(c.id) AS ids
    FROM public.user_image_counts c
    GROUP BY c.user_id, c.taken_day, c.created_day
    HAVING count(*) > 1
        OR (sum(c.n_all) = 0 AND sum(c.n_owned) = 0 AND sum(c.n_capture) = 0 AND sum(c.n_capture_analyzed) = 0
            AND sum(c.n_capture_pending) = 0 AND sum(c.n_capture_filed) = 0 AND sum(c.n_capture_taken) = 0)
  ),
  pick AS (
    SELECT unnest(g.ids) AS id FROM grp g LIMIT greatest(coalesce(p_limit, 50000), 1)
  ),
  gone AS (
    DELETE FROM public.user_image_counts c USING pick p WHERE c.id = p.id RETURNING c.*
  ),
  merged AS (
    INSERT INTO public.user_image_counts (user_id, taken_day, created_day, n_all, n_owned, n_capture,
      n_capture_analyzed, n_capture_pending, n_capture_filed, n_capture_taken)
    SELECT g.user_id, g.taken_day, g.created_day, sum(g.n_all), sum(g.n_owned), sum(g.n_capture),
           sum(g.n_capture_analyzed), sum(g.n_capture_pending), sum(g.n_capture_filed), sum(g.n_capture_taken)
    FROM gone g
    GROUP BY 1, 2, 3
    HAVING sum(g.n_all) <> 0 OR sum(g.n_owned) <> 0 OR sum(g.n_capture) <> 0 OR sum(g.n_capture_analyzed) <> 0
        OR sum(g.n_capture_pending) <> 0 OR sum(g.n_capture_filed) <> 0 OR sum(g.n_capture_taken) <> 0
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM gone), (SELECT count(*) FROM merged) INTO v_merged, v_written;
  RETURN jsonb_build_object('rows_merged', v_merged, 'rows_written', v_written);
END
$$;
REVOKE ALL ON FUNCTION public.compact_user_image_counts(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compact_user_image_counts(integer) TO service_role;

-- The triggers, in one transaction so vehicle_images' SHARE ROW EXCLUSIVE lock is taken once (it waits for in-flight
-- writers and holds new ones for the length of this block, a few milliseconds).
BEGIN;
SET LOCAL lock_timeout = '3s';
DROP TRIGGER IF EXISTS trg_user_image_counts_ins ON public.vehicle_images;
DROP TRIGGER IF EXISTS trg_user_image_counts_upd ON public.vehicle_images;
DROP TRIGGER IF EXISTS trg_user_image_counts_del ON public.vehicle_images;
CREATE TRIGGER trg_user_image_counts_ins AFTER INSERT ON public.vehicle_images
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.track_user_image_counts();
CREATE TRIGGER trg_user_image_counts_upd AFTER UPDATE ON public.vehicle_images
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.track_user_image_counts();
CREATE TRIGGER trg_user_image_counts_del AFTER DELETE ON public.vehicle_images
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.track_user_image_counts();
COMMIT;

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
