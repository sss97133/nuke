-- Image backfill helpers for "half-done" profiles created from scraped pages.
-- Goal: quickly find vehicles that have scraped image URLs stored but no vehicle_images yet,
-- and feed them to backfill-images.

CREATE OR REPLACE FUNCTION public.get_vehicle_image_backfill_candidates(p_limit INTEGER DEFAULT 200)
RETURNS TABLE (
  vehicle_id UUID,
  discovery_url TEXT,
  image_urls TEXT[]
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    v.id AS vehicle_id,
    v.discovery_url,
    ARRAY(
      SELECT jsonb_array_elements_text(v.origin_metadata->'image_urls')
    ) AS image_urls
  FROM public.vehicles v
  WHERE v.discovery_url IS NOT NULL
    AND jsonb_typeof(v.origin_metadata->'image_urls') = 'array'
    AND jsonb_array_length(v.origin_metadata->'image_urls') > 0
    AND NOT EXISTS (
      SELECT 1
      FROM public.vehicle_images vi
      WHERE vi.vehicle_id = v.id
    )
  ORDER BY v.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 2000));
$$;

GRANT EXECUTE ON FUNCTION public.get_vehicle_image_backfill_candidates(INTEGER) TO authenticated;


