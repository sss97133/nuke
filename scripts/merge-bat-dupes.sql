-- Phase 3: Merge remaining BaT active URL duplicates
DO $$
DECLARE
  rec RECORD;
  keeper_id UUID;
  affected INT;
  total_merged INT := 0;
BEGIN
  FOR rec IN
    SELECT RTRIM(COALESCE(listing_url, platform_url, bat_auction_url), '/') as norm_url
    FROM vehicles
    WHERE auction_source = 'bat' AND status = 'active'
      AND COALESCE(listing_url, platform_url, bat_auction_url) IS NOT NULL
    GROUP BY RTRIM(COALESCE(listing_url, platform_url, bat_auction_url), '/')
    HAVING COUNT(*) > 1
  LOOP
    SELECT id INTO keeper_id
    FROM vehicles
    WHERE auction_source = 'bat' AND status = 'active'
      AND RTRIM(COALESCE(listing_url, platform_url, bat_auction_url), '/') = rec.norm_url
    ORDER BY (
      (CASE WHEN description IS NOT NULL AND description != '' THEN 1 ELSE 0 END) +
      (CASE WHEN vin IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN sale_price IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN primary_image_url IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN bat_comments IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN bat_seller IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN mileage IS NOT NULL THEN 1 ELSE 0 END)
    ) DESC, created_at ASC
    LIMIT 1;

    UPDATE vehicles
    SET status = 'merged', merged_into_vehicle_id = keeper_id
    WHERE auction_source = 'bat' AND status = 'active'
      AND RTRIM(COALESCE(listing_url, platform_url, bat_auction_url), '/') = rec.norm_url
      AND id != keeper_id;

    GET DIAGNOSTICS affected = ROW_COUNT;
    total_merged := total_merged + affected;
  END LOOP;
  RAISE NOTICE 'Merged % BaT active duplicates', total_merged;
END $$;
