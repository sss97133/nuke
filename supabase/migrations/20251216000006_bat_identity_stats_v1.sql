-- ============================================================
-- BaT Identity Stats v1 (handles -> measurable profiles)
-- ============================================================
-- Builds a queryable view + RPC over:
-- - external_identities (platform='bat')
-- - auction_comments (author activity; bids)
-- - bat_listings (seller/buyer; purchases/wins)
-- - vehicles.listing_location_* (inferred location)
--
-- This does NOT claim "photographer user_id". It only attributes activity to a claimable handle.

-- 1) View: bat_identity_stats_v1
CREATE OR REPLACE VIEW public.bat_identity_stats_v1 AS
WITH
bat AS (
  SELECT
    ei.id AS external_identity_id,
    ei.handle AS bat_username,
    ei.profile_url,
    ei.display_name,
    ei.claimed_by_user_id,
    ei.claimed_at,
    ei.claim_confidence,
    ei.first_seen_at,
    ei.last_seen_at
  FROM public.external_identities ei
  WHERE ei.platform = 'bat'
),
comment_agg AS (
  SELECT
    ac.external_identity_id,
    COUNT(*)::int AS comments_count,
    COUNT(*) FILTER (WHERE ac.comment_type = 'bid')::int AS bids_count,
    COALESCE(SUM(ac.bid_amount) FILTER (WHERE ac.comment_type = 'bid' AND ac.bid_amount IS NOT NULL), 0)::numeric AS total_bid_amount_usd,
    COALESCE(AVG(ac.bid_amount) FILTER (WHERE ac.comment_type = 'bid' AND ac.bid_amount IS NOT NULL), NULL)::numeric AS avg_bid_amount_usd,
    COALESCE(AVG(ac.sentiment_score) FILTER (WHERE ac.sentiment_score IS NOT NULL), NULL)::numeric AS avg_sentiment_score,
    COALESCE(AVG(ac.toxicity_score) FILTER (WHERE ac.toxicity_score IS NOT NULL), NULL)::numeric AS avg_toxicity_score,
    MAX(ac.posted_at) AS last_comment_at
  FROM public.auction_comments ac
  WHERE ac.external_identity_id IS NOT NULL
  GROUP BY ac.external_identity_id
),
listing_agg AS (
  SELECT
    bl.seller_external_identity_id AS external_identity_id,
    COUNT(*)::int AS listings_as_seller,
    MAX(COALESCE(bl.last_updated_at, bl.updated_at, bl.created_at)) AS last_seller_seen_at
  FROM public.bat_listings bl
  WHERE bl.seller_external_identity_id IS NOT NULL
  GROUP BY bl.seller_external_identity_id
),
purchase_agg AS (
  SELECT
    bl.buyer_external_identity_id AS external_identity_id,
    COUNT(*) FILTER (WHERE bl.listing_status IN ('sold') AND COALESCE(bl.sale_price, bl.final_bid, 0) > 0)::int AS purchases_count,
    COALESCE(SUM(COALESCE(bl.sale_price, bl.final_bid, 0)) FILTER (WHERE bl.listing_status IN ('sold') AND COALESCE(bl.sale_price, bl.final_bid, 0) > 0), 0)::numeric AS total_spend_usd,
    COALESCE(AVG(COALESCE(bl.sale_price, bl.final_bid, NULL)) FILTER (WHERE bl.listing_status IN ('sold') AND COALESCE(bl.sale_price, bl.final_bid, 0) > 0), NULL)::numeric AS avg_purchase_usd,
    MAX(COALESCE(bl.sale_date::timestamptz, bl.auction_end_date::timestamptz, bl.last_updated_at, bl.updated_at, bl.created_at)) AS last_purchase_at
  FROM public.bat_listings bl
  WHERE bl.buyer_external_identity_id IS NOT NULL
  GROUP BY bl.buyer_external_identity_id
)
SELECT
  b.external_identity_id,
  b.bat_username,
  b.profile_url,
  b.display_name,
  b.claimed_by_user_id,
  b.claimed_at,
  b.claim_confidence,
  b.first_seen_at,
  b.last_seen_at,

  COALESCE(c.comments_count, 0) AS comments_count,
  COALESCE(c.bids_count, 0) AS bids_count,
  COALESCE(c.total_bid_amount_usd, 0) AS total_bid_amount_usd,
  c.avg_bid_amount_usd,
  c.avg_sentiment_score,
  c.avg_toxicity_score,
  c.last_comment_at,

  COALESCE(s.listings_as_seller, 0) AS listings_as_seller,
  s.last_seller_seen_at,

  COALESCE(p.purchases_count, 0) AS purchases_count,
  COALESCE(p.total_spend_usd, 0) AS total_spend_usd,
  p.avg_purchase_usd,
  p.last_purchase_at,

  -- Activity signal: best available "last seen" across sources
  GREATEST(
    COALESCE(b.last_seen_at, 'epoch'::timestamptz),
    COALESCE(c.last_comment_at, 'epoch'::timestamptz),
    COALESCE(s.last_seller_seen_at, 'epoch'::timestamptz),
    COALESCE(p.last_purchase_at, 'epoch'::timestamptz)
  ) AS last_activity_at,

  -- Inferred location (best-effort): top 3 listing locations for vehicles this user purchased.
  (
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('location', loc.location, 'count', loc.cnt) ORDER BY loc.cnt DESC),
      '[]'::jsonb
    )
    FROM (
      SELECT
        COALESCE(v.listing_location_raw, v.listing_location) AS location,
        COUNT(*)::int AS cnt
      FROM public.bat_listings bl2
      JOIN public.vehicles v ON v.id = bl2.vehicle_id
      WHERE bl2.buyer_external_identity_id = b.external_identity_id
        AND COALESCE(v.listing_location_raw, v.listing_location) IS NOT NULL
      GROUP BY COALESCE(v.listing_location_raw, v.listing_location)
      ORDER BY COUNT(*) DESC
      LIMIT 3
    ) loc
  ) AS top_purchase_locations,

  -- Simple "vibe" signal: sentiment + recency (neutral if no sentiment)
  (
    COALESCE(c.avg_sentiment_score, 0)
    + CASE
        WHEN GREATEST(
          COALESCE(b.last_seen_at, 'epoch'::timestamptz),
          COALESCE(c.last_comment_at, 'epoch'::timestamptz),
          COALESCE(s.last_seller_seen_at, 'epoch'::timestamptz),
          COALESCE(p.last_purchase_at, 'epoch'::timestamptz)
        ) > (now() - interval '30 days') THEN 10
        WHEN GREATEST(
          COALESCE(b.last_seen_at, 'epoch'::timestamptz),
          COALESCE(c.last_comment_at, 'epoch'::timestamptz),
          COALESCE(s.last_seller_seen_at, 'epoch'::timestamptz),
          COALESCE(p.last_purchase_at, 'epoch'::timestamptz)
        ) > (now() - interval '180 days') THEN 3
        ELSE 0
      END
  )::numeric AS vibe_score
FROM bat b
LEFT JOIN comment_agg c ON c.external_identity_id = b.external_identity_id
LEFT JOIN listing_agg s ON s.external_identity_id = b.external_identity_id
LEFT JOIN purchase_agg p ON p.external_identity_id = b.external_identity_id;

-- 2) RPC: get_bat_identity_stats_v1
CREATE OR REPLACE FUNCTION public.get_bat_identity_stats_v1(
  p_limit INT DEFAULT 100,
  p_offset INT DEFAULT 0,
  p_sort TEXT DEFAULT 'last_activity',
  p_active_within_days INT DEFAULT NULL
)
RETURNS SETOF public.bat_identity_stats_v1
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := LEAST(500, GREATEST(1, COALESCE(p_limit, 100)));
  v_offset INT := GREATEST(0, COALESCE(p_offset, 0));
  v_sort TEXT := COALESCE(p_sort, 'last_activity');
BEGIN
  RETURN QUERY
  SELECT *
  FROM public.bat_identity_stats_v1 s
  WHERE
    p_active_within_days IS NULL
    OR s.last_activity_at >= (now() - make_interval(days => p_active_within_days))
  ORDER BY
    CASE WHEN v_sort = 'comments' THEN s.comments_count END DESC NULLS LAST,
    CASE WHEN v_sort = 'purchases' THEN s.purchases_count END DESC NULLS LAST,
    CASE WHEN v_sort = 'spend' THEN s.total_spend_usd END DESC NULLS LAST,
    CASE WHEN v_sort = 'vibe' THEN s.vibe_score END DESC NULLS LAST,
    CASE WHEN v_sort = 'last_activity' THEN s.last_activity_at END DESC NULLS LAST,
    s.last_activity_at DESC
  LIMIT v_limit
  OFFSET v_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_bat_identity_stats_v1(INT, INT, TEXT, INT) TO anon, authenticated;


