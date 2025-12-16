-- Cleanup bad canonical listing_location values that were backfilled from polluted metadata.
-- We only target clearly-non-location strings (URLs/JSON/JS blobs / known tokens).

DO $$
BEGIN
  IF to_regclass('public.vehicles') IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.vehicles
  SET
    listing_location = NULL,
    listing_location_raw = NULL,
    listing_location_observed_at = NULL,
    listing_location_source = NULL,
    listing_location_confidence = NULL
  WHERE listing_location IS NOT NULL
    AND (
      listing_location ~* 'https?://'
      OR listing_location ~ '[\\{\\}\\[\\]\"]'
      OR listing_location ~* 'wp-admin|newrelic|commentRatingUri|StorageKey'
      OR char_length(listing_location) > 80
    );
END
$$;


