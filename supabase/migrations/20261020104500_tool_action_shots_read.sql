-- Tool action shots: a person's photos in which the image analysis saw a tool at work, grouped by tool type.
--   user_tool_action_shots_read(p_user_id, p_label, p_per_label): walks the person's most recent 5,000 timed photos, keeps
--     approved, non-external, non-sensitive gallery photos (any vehicle for the person themself, public vehicles for everyone
--     else; the provider_profile_read rule), scans up to 1,000 of them, reads each photo's latest image_deep_byok analysis
--     and groups workshop_signals.tools_visible labels. Each group: label, photos, the newest p_per_label photos (image,
--     thumbnail, taken_at, vehicle label; vehicle id only where the vehicle is public or the viewer is the person).
--     A label is a tool type seen in the frame, not an identified tool from the person's toolbox; one photo counts once
--     per label.
-- Contract: supabase/sql/test_tool_action_shots_read.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.user_tool_action_shots_read(p_user_id uuid, p_label text DEFAULT NULL, p_per_label integer DEFAULT 6)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  self boolean := (auth.uid() IS NOT NULL AND auth.uid() = p_user_id) OR coalesce(auth.role(), '') = 'service_role';
  per_label integer := LEAST(GREATEST(COALESCE(p_per_label, 6), 1), 48);
  want text := NULLIF(regexp_replace(lower(btrim(p_label)), '^2-post\M', 'two-post'), '');
  result jsonb;
BEGIN
  WITH recent AS MATERIALIZED (
    SELECT vi.id, vi.taken_at, vi.vehicle_id, vi.image_url, vi.thumbnail_url, vi.medium_url,
      (vi.is_external IS NOT TRUE AND vi.vision_gate_status::text = 'approved' AND COALESCE(vi.is_sensitive, false) = false
        AND public.vehicle_image_gallery_eligible(vi)
        AND (self OR EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vi.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL))) AS eligible
    FROM public.vehicle_images vi
    WHERE vi.user_id = p_user_id AND vi.taken_at IS NOT NULL
    ORDER BY vi.taken_at DESC LIMIT 5000
  ), scanned AS MATERIALIZED (
    SELECT * FROM recent WHERE eligible ORDER BY taken_at DESC, id LIMIT 1000
  ), frames AS MATERIALIZED (
    SELECT s.*, o.tv FROM scanned s CROSS JOIN LATERAL (
      SELECT ob.structured_data#>'{workshop_signals,tools_visible}' AS tv FROM public.vehicle_observations ob
      WHERE (ob.structured_data->>'image_id') = s.id::text AND (ob.structured_data->>'analysis_kind') = 'image_deep_byok'
        AND ob.kind::text = 'condition' AND ob.is_superseded IS FALSE AND ob.source_id IS NOT NULL
      ORDER BY ob.observed_at DESC NULLS LAST, ob.id LIMIT 1) o
  ), sightings AS (
    SELECT DISTINCT f.id AS image_id, f.taken_at, f.vehicle_id, f.image_url, f.thumbnail_url, f.medium_url,
      regexp_replace(lower(btrim(CASE jsonb_typeof(e) WHEN 'string' THEN e#>>'{}' ELSE COALESCE(e->>'label', e->>'name', e->>'tool') END)),
        '^2-post\M', 'two-post') AS label
    FROM frames f, jsonb_array_elements(CASE WHEN jsonb_typeof(f.tv) = 'array' THEN f.tv ELSE '[]'::jsonb END) e
  ), kept AS (
    SELECT s.*, row_number() OVER (PARTITION BY s.label ORDER BY s.taken_at DESC, s.image_id) AS rn,
      count(*) OVER (PARTITION BY s.label) AS photos
    FROM sightings s WHERE NULLIF(s.label, '') IS NOT NULL AND (want IS NULL OR s.label = want)
  ), groups AS (
    SELECT k.label, max(k.photos) AS photos,
      jsonb_agg(jsonb_build_object('image_id', k.image_id, 'image_url', COALESCE(k.medium_url, k.image_url),
          'thumbnail_url', COALESCE(k.thumbnail_url, k.medium_url, k.image_url), 'taken_at', k.taken_at,
          'vehicle', (SELECT jsonb_build_object('label', NULLIF(concat_ws(' ', v.year, v.make, v.model), ''))
              || CASE WHEN self OR v.is_public IS TRUE THEN jsonb_build_object('vehicle_id', v.id) ELSE '{}'::jsonb END
            FROM public.vehicles v WHERE v.id = k.vehicle_id))
        ORDER BY k.taken_at DESC, k.image_id) FILTER (WHERE k.rn <= per_label) AS shots
    FROM kept k GROUP BY k.label
  )
  SELECT jsonb_build_object('user_id', p_user_id, 'as_of', statement_timestamp(), 'viewer', jsonb_build_object('self', self),
    'label_filter', want,
    'groups', COALESCE((SELECT jsonb_agg(jsonb_build_object('label', g.label, 'photos', g.photos, 'shots', g.shots)
      ORDER BY g.photos DESC, g.label) FROM groups g), '[]'::jsonb),
    'coverage', jsonb_build_object('recent_photos', (SELECT count(*) FROM recent), 'images_scanned', (SELECT count(*) FROM scanned),
      'frames_analyzed', (SELECT count(*) FROM frames),
      'photos_with_tools', (SELECT count(DISTINCT image_id) FROM sightings WHERE NULLIF(label, '') IS NOT NULL),
      'scan_cap', 1000, 'recent_cap', 5000, 'per_label', per_label),
    'basis', jsonb_build_object(
      'label', 'a tool type the image analysis saw in the frame (image_deep_byok workshop_signals); not an identified tool from the toolbox',
      'photos', 'distinct photos per label among the scanned photos; not distinct objects',
      'eligibility', 'approved, non-external, non-sensitive gallery photos; public vehicles only unless the viewer is the person'))
  INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.user_tool_action_shots_read(uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_tool_action_shots_read(uuid,text,integer) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.user_tool_action_shots_read(uuid,text,integer) IS 'A person''s photos where the image analysis saw a tool type at work, grouped by type; public-vehicle photos for visitors.';

NOTIFY pgrst, 'reload schema';
COMMIT;
