-- Phase 3e: Merge trailing-slash URL variants
-- Find URLs where both `url` and `url/` have an active row
CREATE TEMP TABLE slash_keepers AS
WITH slash_pairs AS (
  SELECT
    v1.id as id_no_slash, v1.listing_url as url_no_slash,
    v2.id as id_with_slash, v2.listing_url as url_with_slash,
    -- Score each row
    (CASE WHEN v1.description IS NOT NULL AND v1.description != '' THEN 1 ELSE 0 END) +
    (CASE WHEN v1.vin IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN v1.sale_price IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN v1.primary_image_url IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN v1.bat_comments IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN v1.bat_seller IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN v1.mileage IS NOT NULL THEN 1 ELSE 0 END) as score_no_slash,
    (CASE WHEN v2.description IS NOT NULL AND v2.description != '' THEN 1 ELSE 0 END) +
    (CASE WHEN v2.vin IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN v2.sale_price IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN v2.primary_image_url IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN v2.bat_comments IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN v2.bat_seller IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN v2.mileage IS NOT NULL THEN 1 ELSE 0 END) as score_with_slash
  FROM vehicles v1
  JOIN vehicles v2 ON v2.listing_url = v1.listing_url || '/'
  WHERE v1.auction_source = 'bat' AND v1.status = 'active'
    AND v2.auction_source = 'bat' AND v2.status = 'active'
    AND v1.listing_url NOT LIKE '%/'
)
SELECT
  CASE WHEN score_no_slash >= score_with_slash THEN id_with_slash ELSE id_no_slash END as vehicle_to_merge,
  CASE WHEN score_no_slash >= score_with_slash THEN id_no_slash ELSE id_with_slash END as keeper_id
FROM slash_pairs;

SELECT COUNT(*) as slash_pairs_to_merge FROM slash_keepers;

-- Apply merges
UPDATE vehicles v
SET status = 'merged', merged_into_vehicle_id = sk.keeper_id
FROM slash_keepers sk
WHERE v.id = sk.vehicle_to_merge AND v.status = 'active';

DROP TABLE slash_keepers;
