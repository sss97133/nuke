-- get_user_profile_photos: the owner's own photos for the iOS profile "Your photos" screen.
--
-- Presentation-only reader (no data changes). The phone needs, per photo, the fields it uses to show a tidy
-- record: file_hash (collapse copies), is_duplicate / is_superseded / duplicate_of (copies and replaced rows),
-- image_vehicle_match_status ('unrelated' rows stay out of vehicle groupings), taken_at (date sections) and
-- the vehicle's name (placeholder vehicles such as "UNRESOLVED / Intake Quarantine" are shown apart).
-- get_user_analyzed_photos returns none of these, and only analyzed iOS frames.
--
-- Same gate and security as get_user_analyzed_photos: SECURITY DEFINER, STABLE, rows only when
-- auth.uid() = p_user_id. Duplicates and superseded rows are dropped here; the phone also collapses by
-- file_hash in case copies are not flagged. Served by the existing user_id indexes on vehicle_images
-- (idx_vehicle_images_user_taken_at for the ORDER BY).
-- Until this is applied the phone falls back to get_user_analyzed_photos.

CREATE OR REPLACE FUNCTION public.get_user_profile_photos(p_user_id uuid, p_limit integer DEFAULT 1000, p_offset integer DEFAULT 0)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', vi.id,
    'url', vi.image_url,
    'thumb', COALESCE(vi.thumbnail_url, vi.image_url),
    'vehicle_id', vi.vehicle_id,
    'taken_at', vi.taken_at,
    'created_at', vi.created_at,
    'file_name', vi.file_name,
    'file_hash', vi.file_hash,
    'is_duplicate', COALESCE(vi.is_duplicate, false),
    'is_superseded', COALESCE(vi.is_superseded, false),
    'duplicate_of', vi.duplicate_of,
    'match_status', vi.image_vehicle_match_status,
    'source', vi.source,
    'vehicle_year', v.year,
    'vehicle_make', v.make,
    'vehicle_model', v.model,
    'vehicle_is_draft', v.is_draft)
  FROM public.vehicle_images vi
  LEFT JOIN public.vehicles v ON v.id = vi.vehicle_id
  WHERE vi.user_id = p_user_id
    AND auth.uid() = p_user_id
    AND COALESCE(vi.is_duplicate, false) = false
    AND COALESCE(vi.is_superseded, false) = false
  ORDER BY vi.taken_at DESC NULLS LAST, vi.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 0), 5000) OFFSET GREATEST(p_offset, 0);
$$;

COMMENT ON FUNCTION public.get_user_profile_photos(uuid, integer, integer) IS
  'Owner-only photo list for the iOS profile: dedupe/match/vehicle-name fields for presentation. No writes.';

REVOKE ALL ON FUNCTION public.get_user_profile_photos(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_profile_photos(uuid, integer, integer) TO authenticated, service_role;
