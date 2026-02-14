-- Micro-Portal RPC functions
-- Supports MileagePortal, PricePortal (model price history), and SourcePortal

-- ============================================================================
-- 1. get_model_price_history(make, model, limit)
--    Returns recent sold prices for a make/model to power sparkline in ModelPortal
-- ============================================================================
CREATE OR REPLACE FUNCTION get_model_price_history(
  p_make text,
  p_model text,
  p_limit integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date', v.sale_date,
        'price', v.sale_price
      ) ORDER BY v.sale_date ASC
    ),
    '[]'::jsonb
  ) INTO result
  FROM (
    SELECT sale_date, sale_price
    FROM vehicles
    WHERE lower(make) = lower(p_make)
      AND (lower(coalesce(normalized_model, model)) = lower(p_model) OR lower(model) = lower(p_model))
      AND sale_price > 0
      AND sale_date IS NOT NULL
    ORDER BY sale_date DESC
    LIMIT p_limit
  ) v;

  RETURN result;
END;
$$;

-- ============================================================================
-- 2. get_vehicle_mileage_history(vehicle_id)
--    Returns mileage readings over time from timeline_events
-- ============================================================================
CREATE OR REPLACE FUNCTION get_vehicle_mileage_history(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date', te.event_date,
        'mileage', te.mileage_at_event,
        'type', coalesce(te.event_type, 'unknown'),
        'title', coalesce(te.title, '')
      ) ORDER BY te.event_date ASC
    ),
    '[]'::jsonb
  ) INTO result
  FROM timeline_events te
  WHERE te.vehicle_id = p_vehicle_id
    AND te.mileage_at_event IS NOT NULL;

  RETURN result;
END;
$$;

-- ============================================================================
-- 3. get_platform_vehicle_stats(vehicle_id, platform)
--    Aggregates engagement metrics for a vehicle on a specific platform,
--    plus platform-wide sell-through and average price
-- ============================================================================
CREATE OR REPLACE FUNCTION get_platform_vehicle_stats(
  p_vehicle_id uuid,
  p_platform text
)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  result jsonb;
  listing_row record;
  platform_stats record;
BEGIN
  -- Get this vehicle's listing engagement on the platform
  SELECT
    coalesce(sum(el.bid_count), 0) as total_bids,
    coalesce(sum(el.view_count), 0) as total_views,
    coalesce(sum(el.watcher_count), 0) as total_watchers
  INTO listing_row
  FROM external_listings el
  WHERE el.vehicle_id = p_vehicle_id
    AND lower(el.platform) LIKE '%' || lower(p_platform) || '%';

  -- Get platform-level stats from market_trends (most recent period)
  SELECT
    mt.avg_sale_price,
    mt.vehicle_count,
    -- Compute sell-through from demand signals
    CASE WHEN mt.vehicle_count > 0
      THEN round(mt.demand_high_pct, 1)
      ELSE NULL
    END as sell_through_proxy
  INTO platform_stats
  FROM market_trends mt
  WHERE lower(mt.platform) LIKE '%' || lower(p_platform) || '%'
    AND mt.model IS NULL  -- platform-level, not model-specific
  ORDER BY mt.period_end DESC NULLS LAST
  LIMIT 1;

  result := jsonb_build_object(
    'platform', p_platform,
    'bid_count', CASE WHEN listing_row.total_bids > 0 THEN listing_row.total_bids ELSE NULL END,
    'view_count', CASE WHEN listing_row.total_views > 0 THEN listing_row.total_views ELSE NULL END,
    'watcher_count', CASE WHEN listing_row.total_watchers > 0 THEN listing_row.total_watchers ELSE NULL END,
    'platform_avg_price', platform_stats.avg_sale_price,
    'platform_sell_through_pct', platform_stats.sell_through_proxy,
    'platform_vehicle_count', platform_stats.vehicle_count
  );

  RETURN result;
END;
$$;

-- Grant access
GRANT EXECUTE ON FUNCTION get_model_price_history(text, text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_vehicle_mileage_history(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_platform_vehicle_stats(uuid, text) TO anon, authenticated, service_role;

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_vehicles_make_model_sale
  ON vehicles (lower(make), sale_price)
  WHERE sale_price > 0 AND sale_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_timeline_events_vehicle_mileage
  ON timeline_events (vehicle_id, event_date)
  WHERE mileage_at_event IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_external_listings_vehicle_platform
  ON external_listings (vehicle_id, lower(platform));
