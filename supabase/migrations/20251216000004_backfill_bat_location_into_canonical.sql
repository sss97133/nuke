-- Backfill BaT listing location into canonical vehicle listing_location_* fields
-- Source of truth: external_listings.metadata->>'location' (populated by comprehensive-bat-extraction)
-- Goal: fill vehicles.listing_location for UI, with observed_at based on listing start_date if present.
-- Keep IF NOT EXISTS/WHERE guards so resets and partial environments are safe.

DO $$
BEGIN
  IF to_regclass('public.vehicles') IS NULL OR to_regclass('public.external_listings') IS NULL THEN
    RETURN;
  END IF;

  -- Only update rows missing canonical listing_location.
  UPDATE public.vehicles v
  SET
    listing_location = NULLIF(btrim(el.metadata->>'location'), ''),
    listing_location_raw = NULLIF(btrim(el.metadata->>'location'), ''),
    listing_location_observed_at = COALESCE(el.start_date, el.updated_at, now()),
    listing_location_source = 'bat',
    listing_location_confidence = 0.7
  FROM public.external_listings el
  WHERE el.platform = 'bat'
    AND el.vehicle_id = v.id
    AND v.listing_location IS NULL
    AND NULLIF(btrim(el.metadata->>'location'), '') IS NOT NULL;
END
$$;

-- Best-effort: also write observations for any rows we just filled.
DO $$
BEGIN
  IF to_regclass('public.vehicle_location_observations') IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.vehicle_location_observations (
    vehicle_id,
    source_type,
    source_platform,
    source_url,
    observed_at,
    location_text_raw,
    location_text_clean,
    precision,
    confidence,
    metadata
  )
  SELECT
    el.vehicle_id,
    'listing',
    'bat',
    el.listing_url,
    COALESCE(el.start_date, el.updated_at, now()),
    NULLIF(btrim(el.metadata->>'location'), ''),
    NULLIF(btrim(el.metadata->>'location'), ''),
    CASE WHEN position(',' in (el.metadata->>'location')) > 0 THEN 'region' ELSE 'country' END,
    0.7,
    jsonb_build_object('backfill', true, 'source', 'migration_20251216000004')
  FROM public.external_listings el
  JOIN public.vehicles v ON v.id = el.vehicle_id
  WHERE el.platform = 'bat'
    AND NULLIF(btrim(el.metadata->>'location'), '') IS NOT NULL
    AND v.listing_location_source = 'bat'
    AND v.listing_location_observed_at IS NOT NULL
  ON CONFLICT DO NOTHING;
END
$$;


