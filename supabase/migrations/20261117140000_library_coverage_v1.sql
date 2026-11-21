-- library_coverage_v1: an honest per-capture-month coverage metric.
--
-- Why (owner 2026-11-17): "are all images from the last 9 years sorted? Your metric is flawed." The ledger's
-- "unsorted = 0" only counted vehicle_images rows already owned by the user. The library itself (~76-80K images
-- counted on the phone, never reported) was never the denominator.
--
-- This migration adds:
--   1. library_inventory.cloud_identifier: PHCloudIdentifier, the id iCloud Photos shares across iPhone, Mac and
--      iCloud.com. Per-device localIdentifiers never join across devices (0 matches between relay and Mac ids on
--      2026-11-17).
--   2. library_inventory_census: one row per enumeration run per origin, with the device's own total and
--      per-capture-month counts. That is the denominator. It is reported by the source, never derived from Nuke rows.
--   3. library_inventory_record_census (owner, app), plus service-only _for variants of census and upsert for
--      the Mac Photos census script.
--   4. capture_library_coverage_v1(uid, tz, from, to): per capture month gives library count L (NULL until a census
--      exists), Nuke-side ledger states, inventory drain states, census freshness and coverage.
--
-- Read-only on vehicle_images. It does not change ledger states, privacy holds or any photo row.

SET LOCAL lock_timeout = '5s';

-- 1. cloud identifier -------------------------------------------------------------------------------------------
ALTER TABLE public.library_inventory ADD COLUMN IF NOT EXISTS cloud_identifier text;
COMMENT ON COLUMN public.library_inventory.cloud_identifier IS
  'PHCloudIdentifier.stringValue when the device could map it (iCloud Photos). Joins the same asset across iPhone, Mac Photos and iCloud. NULL when unavailable; never guessed.';
CREATE INDEX IF NOT EXISTS library_inventory_cloud_idx
  ON public.library_inventory (user_id, cloud_identifier) WHERE cloud_identifier IS NOT NULL;

-- Same signature and behaviour as 20261112000000, plus cloud_identifier (kept when a later page omits it).
CREATE OR REPLACE FUNCTION public.library_inventory_upsert(p_rows jsonb, p_run_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE n integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000'; END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 500 THEN
    RAISE EXCEPTION 'p_rows must be an array of at most 500 rows';
  END IF;
  INSERT INTO public.library_inventory AS li (
    user_id, asset_local_id, creation_date, media_type, media_subtypes, source_type, is_screenshot,
    pixel_width, pixel_height, has_location, loc_lat_coarse, loc_lon_coarse, gate_verdict,
    content_sha256, origin_device_id, origin_scope, inventory_run_id, cloud_identifier)
  SELECT auth.uid(), r.asset_local_id, r.creation_date, COALESCE(r.media_type,'image'),
         COALESCE(r.media_subtypes,0), r.source_type, COALESCE(r.is_screenshot,false),
         r.pixel_width, r.pixel_height, COALESCE(r.has_location,false),
         round(r.loc_lat_coarse::numeric,2), round(r.loc_lon_coarse::numeric,2),
         COALESCE(r.gate_verdict,'unknown'), r.content_sha256, r.origin_device_id,
         COALESCE(r.origin_scope,'full'), p_run_id, NULLIF(r.cloud_identifier,'')
  FROM jsonb_to_recordset(p_rows) AS r(
    asset_local_id text, creation_date timestamptz, media_type text, media_subtypes integer,
    source_type text, is_screenshot boolean, pixel_width integer, pixel_height integer,
    has_location boolean, loc_lat_coarse numeric, loc_lon_coarse numeric, gate_verdict text,
    content_sha256 text, origin_device_id text, origin_scope text, cloud_identifier text)
  WHERE r.asset_local_id IS NOT NULL AND r.asset_local_id <> ''
  ON CONFLICT (user_id, asset_local_id) DO UPDATE SET
    creation_date    = EXCLUDED.creation_date,
    media_subtypes   = EXCLUDED.media_subtypes,
    source_type      = EXCLUDED.source_type,
    is_screenshot    = EXCLUDED.is_screenshot,
    pixel_width      = EXCLUDED.pixel_width,
    pixel_height     = EXCLUDED.pixel_height,
    has_location     = EXCLUDED.has_location,
    loc_lat_coarse   = EXCLUDED.loc_lat_coarse,
    loc_lon_coarse   = EXCLUDED.loc_lon_coarse,
    gate_verdict     = CASE WHEN li.drain_state = 'pending' THEN EXCLUDED.gate_verdict ELSE li.gate_verdict END,
    content_sha256   = COALESCE(EXCLUDED.content_sha256, li.content_sha256),
    origin_device_id = EXCLUDED.origin_device_id,
    origin_scope     = EXCLUDED.origin_scope,
    inventory_run_id = EXCLUDED.inventory_run_id,
    cloud_identifier = COALESCE(EXCLUDED.cloud_identifier, li.cloud_identifier),
    last_seen_at     = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Service-only variant for origins that are not the phone (Mac Photos census script, archive walkers).
-- asset_local_id must carry an origin prefix (e.g. 'mac_photos:<uuid>') so it can never collide with a PHAsset id.
-- Settled drain states are never touched; rows arrive as pending with gate_verdict as reported.
CREATE OR REPLACE FUNCTION public.library_inventory_upsert_for(
  p_user uuid, p_origin_source text, p_rows jsonb, p_run_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE n integer;
BEGIN
  IF p_user IS NULL OR p_origin_source IS NULL OR p_origin_source = 'ios_photokit' THEN
    RAISE EXCEPTION 'library_inventory_upsert_for: user and a non-phone origin_source required';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 1000 THEN
    RAISE EXCEPTION 'p_rows must be an array of at most 1000 rows';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_rows) AS r(asset_local_id text)
             WHERE r.asset_local_id IS NULL OR r.asset_local_id NOT LIKE p_origin_source || ':%') THEN
    RAISE EXCEPTION 'library_inventory_upsert_for: every asset_local_id must start with "%:"', p_origin_source;
  END IF;
  INSERT INTO public.library_inventory AS li (
    user_id, asset_local_id, creation_date, media_type, media_subtypes, source_type, is_screenshot,
    pixel_width, pixel_height, has_location, loc_lat_coarse, loc_lon_coarse, gate_verdict,
    content_sha256, origin_source, origin_device_id, origin_scope, inventory_run_id, cloud_identifier)
  SELECT p_user, r.asset_local_id, r.creation_date, COALESCE(r.media_type,'image'),
         COALESCE(r.media_subtypes,0), r.source_type, COALESCE(r.is_screenshot,false),
         r.pixel_width, r.pixel_height, COALESCE(r.has_location,false),
         round(r.loc_lat_coarse::numeric,2), round(r.loc_lon_coarse::numeric,2),
         COALESCE(r.gate_verdict,'unknown'), r.content_sha256, p_origin_source, r.origin_device_id,
         COALESCE(r.origin_scope,'full'), p_run_id, NULLIF(r.cloud_identifier,'')
  FROM jsonb_to_recordset(p_rows) AS r(
    asset_local_id text, creation_date timestamptz, media_type text, media_subtypes integer,
    source_type text, is_screenshot boolean, pixel_width integer, pixel_height integer,
    has_location boolean, loc_lat_coarse numeric, loc_lon_coarse numeric, gate_verdict text,
    content_sha256 text, origin_device_id text, origin_scope text, cloud_identifier text)
  ON CONFLICT (user_id, asset_local_id) DO UPDATE SET
    creation_date    = EXCLUDED.creation_date,
    media_subtypes   = EXCLUDED.media_subtypes,
    source_type      = EXCLUDED.source_type,
    is_screenshot    = EXCLUDED.is_screenshot,
    pixel_width      = EXCLUDED.pixel_width,
    pixel_height     = EXCLUDED.pixel_height,
    has_location     = EXCLUDED.has_location,
    loc_lat_coarse   = EXCLUDED.loc_lat_coarse,
    loc_lon_coarse   = EXCLUDED.loc_lon_coarse,
    gate_verdict     = CASE WHEN li.drain_state = 'pending' THEN EXCLUDED.gate_verdict ELSE li.gate_verdict END,
    content_sha256   = COALESCE(EXCLUDED.content_sha256, li.content_sha256),
    origin_device_id = EXCLUDED.origin_device_id,
    origin_scope     = EXCLUDED.origin_scope,
    inventory_run_id = EXCLUDED.inventory_run_id,
    cloud_identifier = COALESCE(EXCLUDED.cloud_identifier, li.cloud_identifier),
    last_seen_at     = now()
  WHERE li.origin_source = p_origin_source;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- 2. census ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.library_inventory_census (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id          uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  run_id           uuid        NOT NULL,
  origin_source    text        NOT NULL,                 -- ios_photokit | mac_photos | archive:<label>
  origin_device_id text,
  origin_scope     text        NOT NULL CHECK (origin_scope IN ('full','limited')),
  media_type       text        NOT NULL DEFAULT 'image',
  total_count      integer     NOT NULL CHECK (total_count >= 0),  -- e.g. PHAsset.fetchAssets(image).count
  month_counts     jsonb       NOT NULL DEFAULT '{}'::jsonb,       -- {"2017-01": n, ...} by creation date, device tz
  undated_count    integer     NOT NULL DEFAULT 0 CHECK (undated_count >= 0),
  month_tz         text        NOT NULL DEFAULT 'America/Los_Angeles',
  started_at       timestamptz,
  finished_at      timestamptz NOT NULL,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  producer         text        NOT NULL,                 -- app build / script version
  UNIQUE (user_id, run_id, origin_source, media_type),
  CHECK (jsonb_typeof(month_counts) = 'object')
);
COMMENT ON TABLE public.library_inventory_census IS
  'Per-run library census reported by the source (phone PhotoKit, Mac Photos, archive walk): total and per-capture-month counts. The denominator for capture_library_coverage_v1. Never derived from vehicle_images.';
CREATE INDEX IF NOT EXISTS library_inventory_census_latest_idx
  ON public.library_inventory_census (user_id, origin_source, media_type, finished_at DESC);

ALTER TABLE public.library_inventory_census ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS library_inventory_census_owner_select ON public.library_inventory_census;
CREATE POLICY library_inventory_census_owner_select ON public.library_inventory_census
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS library_inventory_census_owner_insert ON public.library_inventory_census;
CREATE POLICY library_inventory_census_owner_insert ON public.library_inventory_census
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.library_inventory_census FROM anon, public;
GRANT SELECT, INSERT ON public.library_inventory_census TO authenticated;
GRANT ALL ON public.library_inventory_census TO service_role;

CREATE OR REPLACE FUNCTION public._library_census_row(p_user uuid, p_c jsonb)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE v_id bigint; v_sum bigint;
BEGIN
  IF p_c IS NULL OR jsonb_typeof(p_c) <> 'object' THEN RAISE EXCEPTION 'census must be an object'; END IF;
  IF (p_c->>'run_id') IS NULL OR (p_c->>'origin_source') IS NULL OR (p_c->>'total_count') IS NULL
     OR (p_c->>'finished_at') IS NULL OR (p_c->>'producer') IS NULL THEN
    RAISE EXCEPTION 'census needs run_id, origin_source, total_count, finished_at, producer';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(COALESCE(p_c->'month_counts','{}'::jsonb)) e
             WHERE e.key !~ '^[0-9]{4}-[0-9]{2}$' OR jsonb_typeof(e.value) <> 'number' OR (e.value)::text::bigint < 0) THEN
    RAISE EXCEPTION 'month_counts keys must be YYYY-MM with non-negative counts';
  END IF;
  SELECT COALESCE(sum((e.value)::text::bigint),0) INTO v_sum FROM jsonb_each(COALESCE(p_c->'month_counts','{}'::jsonb)) e;
  IF v_sum + COALESCE((p_c->>'undated_count')::bigint,0) <> (p_c->>'total_count')::bigint THEN
    RAISE EXCEPTION 'census does not add up: months % + undated % <> total %',
      v_sum, COALESCE((p_c->>'undated_count')::bigint,0), (p_c->>'total_count')::bigint;
  END IF;
  INSERT INTO public.library_inventory_census (user_id, run_id, origin_source, origin_device_id, origin_scope,
    media_type, total_count, month_counts, undated_count, month_tz, started_at, finished_at, producer)
  VALUES (p_user, (p_c->>'run_id')::uuid, p_c->>'origin_source', p_c->>'origin_device_id',
    COALESCE(p_c->>'origin_scope','full'), COALESCE(p_c->>'media_type','image'), (p_c->>'total_count')::integer,
    COALESCE(p_c->'month_counts','{}'::jsonb), COALESCE((p_c->>'undated_count')::integer,0),
    COALESCE(p_c->>'month_tz','America/Los_Angeles'), (p_c->>'started_at')::timestamptz,
    (p_c->>'finished_at')::timestamptz, p_c->>'producer')
  ON CONFLICT (user_id, run_id, origin_source, media_type) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public._library_census_row(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- The app reports its own census (owner only). Phone origin only.
CREATE OR REPLACE FUNCTION public.library_inventory_record_census(p_census jsonb)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000'; END IF;
  IF COALESCE(p_census->>'origin_source','') <> 'ios_photokit' THEN
    RAISE EXCEPTION 'the app may only report origin_source ios_photokit';
  END IF;
  RETURN public._library_census_row(auth.uid(), p_census);
END $$;

-- Service-only: Mac Photos / archive census scripts.
CREATE OR REPLACE FUNCTION public.library_inventory_record_census_for(p_user uuid, p_census jsonb)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_user IS NULL THEN RAISE EXCEPTION 'user required'; END IF;
  IF COALESCE(p_census->>'origin_source','') = 'ios_photokit' THEN
    RAISE EXCEPTION 'phone census comes from the app, not a service script';
  END IF;
  RETURN public._library_census_row(p_user, p_census);
END $$;

-- 3. coverage ---------------------------------------------------------------------------------------------------
-- Per capture month (p_tz) from p_from to p_to, plus one 'undated' row:
--   library_count      latest census per origin: the largest origin's month count. Cross-origin dedupe by
--                      cloud_identifier is not done yet, so this is a LOWER bound on distinct assets.
--                      NULL with status 'unknown_no_census' until any census exists.
--   nuke_rows          ledger rows (vehicle_images owned by p_uid) captured that month
--   sorted             ledger terminal: on_vehicle, private, pulled, non_vehicle, junk, duplicate, no_file
--   held_for_review    ledger held + unverified (decided-pending-review, not sorted)
--   in_nuke_unsorted   ledger unsorted, failed, waiting
--   kept_as_evidence   inventory held_private / off_site / not_own_camera (metadata kept, bytes stayed on device)
--   counted_elsewhere  inventory deduped
--   pending / gave_up  inventory drain states
--   unowned_linked_rows  vehicle_images from a library source with user_id NULL but tied to p_uid
--                      (documented_by / imported_by, or on p_uid's vehicles). Not in the ledger: an ingestion gap.
--   coverage_pct       (sorted + kept_as_evidence + counted_elsewhere) / library_count, NULL without a full census
CREATE OR REPLACE FUNCTION public.capture_library_coverage_v1(
  p_uid uuid,
  p_tz text DEFAULT 'America/Los_Angeles',
  p_from date DEFAULT '2017-01-01',
  p_to date DEFAULT NULL,
  p_library_sources text[] DEFAULT ARRAY['ssd_blast','ssd_export','hd_archive','hd_archive_unsorted','iphoto','iphoto_60d','user_upload',
    'agent_verified_iphoto','photo_auto_sync','capture_relay_ios','drop-folder','image_intake','library_recovery',
    'dropbox_import','daily_receipt','daily_receipt_cascade']
)
RETURNS TABLE (
  month text, library_count bigint, library_count_status text, census_origins integer,
  census_oldest_finished_at timestamptz, census_age_hours numeric,
  nuke_rows bigint, sorted bigint, sorted_on_vehicle bigint, held_for_review bigint, in_nuke_unsorted bigint,
  inventoried bigint, inv_uploaded bigint, kept_as_evidence bigint, counted_elsewhere bigint, pending bigint,
  gave_up bigint, unowned_linked_rows bigint, coverage_pct numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE v_to date := COALESCE(p_to, (now() AT TIME ZONE p_tz)::date);
BEGIN
  IF p_uid IS NULL THEN RAISE EXCEPTION 'capture_library_coverage_v1: uid required'; END IF;
  IF p_from IS NULL OR p_from > v_to THEN RAISE EXCEPTION 'capture_library_coverage_v1: bad range'; END IF;
  RETURN QUERY
  WITH months AS (
    SELECT to_char(d, 'YYYY-MM') AS m
    FROM generate_series(date_trunc('month', p_from::timestamp), date_trunc('month', v_to::timestamp), interval '1 month') d
    UNION ALL SELECT 'undated'
  ),
  led AS (
    SELECT COALESCE(to_char(vi.taken_at AT TIME ZONE p_tz, 'YYYY-MM'), 'undated') AS m, l.state
    FROM public.capture_ledger_states(p_uid, p_tz, '1900-01-01'::date, '2100-01-01'::date) l
    JOIN public.vehicle_images vi ON vi.id = l.image_id
  ),
  led_m AS (
    SELECT led.m, count(*) AS n,
      count(*) FILTER (WHERE led.state IN ('on_vehicle','private','pulled','non_vehicle','junk','duplicate','no_file')) AS s,
      count(*) FILTER (WHERE led.state = 'on_vehicle') AS sov,
      count(*) FILTER (WHERE led.state IN ('held','unverified')) AS h,
      count(*) FILTER (WHERE led.state IN ('unsorted','failed','waiting')) AS u
    FROM led GROUP BY led.m
  ),
  inv_m AS (
    SELECT COALESCE(to_char(li.creation_date AT TIME ZONE p_tz, 'YYYY-MM'), 'undated') AS m, count(*) AS n,
      count(*) FILTER (WHERE li.drain_state IN ('uploaded','already_on_server')) AS up,
      count(*) FILTER (WHERE li.drain_state IN ('held_private','off_site','not_own_camera')) AS kept,
      count(*) FILTER (WHERE li.drain_state = 'deduped') AS dd,
      count(*) FILTER (WHERE li.drain_state = 'pending') AS pe,
      count(*) FILTER (WHERE li.drain_state = 'gave_up') AS gu
    FROM public.library_inventory li
    WHERE li.user_id = p_uid AND li.media_type = 'image'
    GROUP BY 1
  ),
  latest AS (
    SELECT DISTINCT ON (c.origin_source) c.*
    FROM public.library_inventory_census c
    WHERE c.user_id = p_uid AND c.media_type = 'image'
    ORDER BY c.origin_source, c.finished_at DESC, c.id DESC
  ),
  cen AS (
    SELECT count(*)::int AS origins, min(latest.finished_at) AS oldest,
           bool_or(latest.origin_scope = 'limited') AS any_limited
    FROM latest
  ),
  cen_m AS (
    SELECT e.key AS m, max((e.value)::text::bigint) AS n FROM latest, jsonb_each(latest.month_counts) e GROUP BY e.key
    UNION ALL
    SELECT 'undated', max(latest.undated_count)::bigint FROM latest HAVING count(*) > 0
  ),
  own_veh AS (
    SELECT v.id FROM public.vehicles v
    WHERE v.user_id = p_uid OR v.owner_id = p_uid OR v.uploaded_by = p_uid
  ),
  unowned AS (
    SELECT COALESCE(to_char(vi.taken_at AT TIME ZONE p_tz, 'YYYY-MM'), 'undated') AS m, count(*) AS n
    FROM public.vehicle_images vi
    WHERE vi.source = ANY (p_library_sources)          -- idx_vehicle_images_source; never a 65M-row scan
      AND vi.user_id IS NULL
      AND COALESCE(vi.is_external, false) = false
      AND (vi.documented_by_user_id = p_uid OR vi.imported_by = p_uid
           OR vi.vehicle_id IN (SELECT own_veh.id FROM own_veh))
    GROUP BY 1
  )
  SELECT months.m AS month,
    CASE WHEN cen.origins = 0 THEN NULL ELSE COALESCE(cen_m.n, 0) END AS library_count,
    CASE WHEN cen.origins = 0 THEN 'unknown_no_census'
         WHEN cen.any_limited THEN 'limited_scope_lower_bound'
         WHEN cen.origins > 1 THEN 'max_of_origins_lower_bound'
         ELSE 'census' END AS library_count_status,
    cen.origins AS census_origins,
    cen.oldest AS census_oldest_finished_at,
    CASE WHEN cen.oldest IS NULL THEN NULL ELSE round(extract(epoch FROM now() - cen.oldest) / 3600.0, 1) END AS census_age_hours,
    COALESCE(led_m.n, 0) AS nuke_rows, COALESCE(led_m.s, 0) AS sorted, COALESCE(led_m.sov, 0) AS sorted_on_vehicle,
    COALESCE(led_m.h, 0) AS held_for_review, COALESCE(led_m.u, 0) AS in_nuke_unsorted,
    COALESCE(inv_m.n, 0) AS inventoried, COALESCE(inv_m.up, 0) AS inv_uploaded, COALESCE(inv_m.kept, 0) AS kept_as_evidence,
    COALESCE(inv_m.dd, 0) AS counted_elsewhere, COALESCE(inv_m.pe, 0) AS pending, COALESCE(inv_m.gu, 0) AS gave_up,
    COALESCE(unowned.n, 0) AS unowned_linked_rows,
    CASE WHEN cen.origins = 0 OR cen.any_limited OR COALESCE(cen_m.n, 0) = 0 THEN NULL
         ELSE round(100.0 * (COALESCE(led_m.s,0) + COALESCE(inv_m.kept,0) + COALESCE(inv_m.dd,0)) / cen_m.n, 1) END AS coverage_pct
  FROM months
  CROSS JOIN cen
  LEFT JOIN led_m ON led_m.m = months.m
  LEFT JOIN inv_m ON inv_m.m = months.m
  LEFT JOIN cen_m ON cen_m.m = months.m
  LEFT JOIN unowned ON unowned.m = months.m
  ORDER BY (months.m = 'undated'), months.m;
END $$;

COMMENT ON FUNCTION public.capture_library_coverage_v1(uuid, text, date, date, text[]) IS
  'Per capture month: library census count (NULL until a census exists, never derived from Nuke rows), ledger states, inventory drain states, census freshness, unowned-but-linked rows, coverage. Replaces bare "unsorted = 0" as the completion metric.';

REVOKE ALL ON FUNCTION public.library_inventory_upsert_for(uuid, text, jsonb, uuid),
  public.library_inventory_record_census_for(uuid, jsonb),
  public.capture_library_coverage_v1(uuid, text, date, date, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.library_inventory_upsert_for(uuid, text, jsonb, uuid),
  public.library_inventory_record_census_for(uuid, jsonb),
  public.capture_library_coverage_v1(uuid, text, date, date, text[]) TO service_role;
REVOKE ALL ON FUNCTION public.library_inventory_record_census(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.library_inventory_record_census(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.library_inventory_upsert(jsonb, uuid) TO authenticated, service_role;
