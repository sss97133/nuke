-- Migration: vehicle_valuation_feed materialized view
-- Pre-computed homepage feed ranking. Refreshed every 15 min via cron.

BEGIN;

-- ============================================================================
-- MATERIALIZED VIEW: vehicle_valuation_feed
-- ============================================================================
-- Joins vehicles + clean_vehicle_prices + nuke_estimates for homepage ranking.
-- feed_rank_score = deal_score * freshness_factor + heat_score * 0.3

DROP MATERIALIZED VIEW IF EXISTS vehicle_valuation_feed;

CREATE MATERIALIZED VIEW vehicle_valuation_feed AS
SELECT
    v.id AS vehicle_id,
    v.year,
    COALESCE(cm.canonical_name, v.make) AS make,
    v.model,
    v.series,
    v.trim,
    v.transmission,
    v.drivetrain,
    v.body_style,
    v.canonical_body_style,
    v.mileage,
    v.vin,
    v.is_for_sale,
    v.sale_status,
    v.sale_date,
    v.created_at,
    v.updated_at,
    v.discovery_url,
    v.discovery_source,
    v.profile_origin,
    v.origin_organization_id,

    -- Location columns
    v.city,
    v.state,
    v.listing_location,

    -- Vehicle type
    v.canonical_vehicle_type,

    -- Has photos flag
    EXISTS(SELECT 1 FROM vehicle_images vi WHERE vi.vehicle_id = v.id LIMIT 1) AS has_photos,

    -- Price data
    cvp.best_price AS display_price,
    cvp.price_source,
    cvp.is_sold,
    v.asking_price,
    v.sale_price,
    v.current_value,

    -- Valuation data
    ne.estimated_value AS nuke_estimate,
    ne.value_low AS nuke_estimate_low,
    ne.value_high AS nuke_estimate_high,
    ne.confidence_score AS nuke_estimate_confidence,
    ne.price_tier,
    ne.deal_score,
    ne.deal_score_label,
    ne.heat_score,
    ne.heat_score_label,
    ne.signal_weights,
    ne.model_version,
    ne.calculated_at AS valuation_calculated_at,

    -- Record price flag
    CASE WHEN rp.record_vehicle_id = v.id THEN true ELSE false END AS is_record_price,
    rp.record_price AS segment_record_price,

    -- Feed ranking: use GREATEST(created_at, updated_at) so fresh extractions bubble up
    COALESCE(ne.deal_score, 0) *
        CASE
            WHEN GREATEST(v.created_at, v.updated_at) > NOW() - INTERVAL '24 hours' THEN 1.0
            WHEN GREATEST(v.created_at, v.updated_at) > NOW() - INTERVAL '3 days' THEN 0.95
            WHEN GREATEST(v.created_at, v.updated_at) > NOW() - INTERVAL '7 days' THEN 0.85
            WHEN GREATEST(v.created_at, v.updated_at) > NOW() - INTERVAL '30 days' THEN 0.50
            ELSE 0.30
        END
    + COALESCE(ne.heat_score, 0) * 0.3
    AS feed_rank_score

FROM vehicles v
LEFT JOIN canonical_makes cm ON v.canonical_make_id = cm.id
LEFT JOIN clean_vehicle_prices cvp ON cvp.vehicle_id = v.id
LEFT JOIN nuke_estimates ne ON ne.vehicle_id = v.id
LEFT JOIN record_prices rp ON
    COALESCE(cm.canonical_name, v.make) = rp.make
    AND v.model = rp.model
    AND v.year BETWEEN rp.year_start AND rp.year_end
WHERE v.deleted_at IS NULL
  AND ne.id IS NOT NULL  -- Only vehicles with valuations
  AND ne.is_stale IS NOT true;

-- Indexes for fast feed queries
CREATE UNIQUE INDEX IF NOT EXISTS idx_vvf_vehicle_id ON vehicle_valuation_feed(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vvf_feed_rank ON vehicle_valuation_feed(feed_rank_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_vvf_deal_score ON vehicle_valuation_feed(deal_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_vvf_heat_score ON vehicle_valuation_feed(heat_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_vvf_make ON vehicle_valuation_feed(make);
CREATE INDEX IF NOT EXISTS idx_vvf_year ON vehicle_valuation_feed(year);
CREATE INDEX IF NOT EXISTS idx_vvf_is_record ON vehicle_valuation_feed(is_record_price) WHERE is_record_price = true;
CREATE INDEX IF NOT EXISTS idx_vvf_updated_at ON vehicle_valuation_feed(updated_at DESC NULLS LAST);

-- ============================================================================
-- CRON JOB: Refresh materialized view every 15 minutes
-- ============================================================================
SELECT cron.schedule(
    'refresh-vehicle-valuation-feed',
    '*/15 * * * *',
    $$REFRESH MATERIALIZED VIEW CONCURRENTLY vehicle_valuation_feed$$
);

COMMENT ON MATERIALIZED VIEW vehicle_valuation_feed IS 'Pre-computed homepage feed with deal/heat scoring. Refreshed every 15min.';

GRANT SELECT ON vehicle_valuation_feed TO authenticated, anon, service_role;

COMMIT;
