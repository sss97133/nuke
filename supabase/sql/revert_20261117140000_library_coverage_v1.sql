-- Revert 20261117140000 library_coverage_v1.
-- Refuses while census rows exist (they are reported testimony; keep them). Restores the 20261112000000 upsert.
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.library_inventory_census') IS NOT NULL THEN
    SELECT count(*) INTO n FROM public.library_inventory_census;
    IF n > 0 THEN RAISE EXCEPTION 'library_inventory_census has % reported rows; export them before reverting', n; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.library_inventory WHERE origin_source <> 'ios_photokit') THEN
    RAISE EXCEPTION 'library_inventory has non-phone rows written by library_inventory_upsert_for; export them first';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.capture_library_coverage_v1(uuid, text, date, date, text[]);
DROP FUNCTION IF EXISTS public.library_inventory_record_census_for(uuid, jsonb);
DROP FUNCTION IF EXISTS public.library_inventory_record_census(jsonb);
DROP FUNCTION IF EXISTS public._library_census_row(uuid, jsonb);
DROP FUNCTION IF EXISTS public.library_inventory_upsert_for(uuid, text, jsonb, uuid);
DROP TABLE IF EXISTS public.library_inventory_census;
DROP INDEX IF EXISTS public.library_inventory_cloud_idx;

-- Restore the 20261112000000 upsert body (without cloud_identifier) before dropping the column.
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
    content_sha256, origin_device_id, origin_scope, inventory_run_id)
  SELECT auth.uid(), r.asset_local_id, r.creation_date, COALESCE(r.media_type,'image'),
         COALESCE(r.media_subtypes,0), r.source_type, COALESCE(r.is_screenshot,false),
         r.pixel_width, r.pixel_height, COALESCE(r.has_location,false),
         round(r.loc_lat_coarse::numeric,2), round(r.loc_lon_coarse::numeric,2),
         COALESCE(r.gate_verdict,'unknown'), r.content_sha256, r.origin_device_id,
         COALESCE(r.origin_scope,'full'), p_run_id
  FROM jsonb_to_recordset(p_rows) AS r(
    asset_local_id text, creation_date timestamptz, media_type text, media_subtypes integer,
    source_type text, is_screenshot boolean, pixel_width integer, pixel_height integer,
    has_location boolean, loc_lat_coarse numeric, loc_lon_coarse numeric, gate_verdict text,
    content_sha256 text, origin_device_id text, origin_scope text)
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
    last_seen_at     = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER TABLE public.library_inventory DROP COLUMN IF EXISTS cloud_identifier;
