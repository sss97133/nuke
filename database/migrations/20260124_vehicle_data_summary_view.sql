-- =============================================================================
-- VEHICLE DATA SUMMARY VIEW
-- =============================================================================
-- Purpose: Single source of truth for "what data exists per vehicle"
-- Eliminates confusion about data distribution across tables
--
-- Usage:
--   SELECT * FROM vehicle_data_summary WHERE has_comments = true;
--   SELECT * FROM vehicle_data_summary ORDER BY comment_count DESC LIMIT 10;
--   SELECT COUNT(*) FROM vehicle_data_summary WHERE has_comments = true;
-- =============================================================================

-- Drop if exists (for idempotency)
DROP VIEW IF EXISTS vehicle_data_summary CASCADE;
DROP MATERIALIZED VIEW IF EXISTS vehicle_data_summary_mv CASCADE;

-- Create materialized view for performance
CREATE MATERIALIZED VIEW vehicle_data_summary_mv AS
SELECT
    v.id AS vehicle_id,
    v.year,
    v.make,
    v.model,
    v.vin,
    v.sale_price,
    v.created_at AS vehicle_created_at,

    -- Comment stats (from auction_comments)
    COALESCE(ac.comment_count, 0) AS comment_count,
    COALESCE(ac.comment_count, 0) > 0 AS has_comments,
    ac.first_comment_at,
    ac.last_comment_at,

    -- BaT listing stats
    COALESCE(bl.bat_listing_count, 0) AS bat_listing_count,
    bl.max_bat_comment_count AS bat_expected_comments,
    bl.comments_extracted AS bat_comments_extracted,

    -- Discovery stats
    COALESCE(cd.comment_discoveries, 0) AS comment_discoveries,
    COALESCE(dd.description_discoveries, 0) AS description_discoveries,
    cd.latest_sentiment,
    cd.sentiment_score,

    -- Image stats
    COALESCE(img.image_count, 0) AS image_count,

    -- Auction event stats
    COALESCE(ae.auction_event_count, 0) AS auction_event_count,

    -- Data completeness score (0-100)
    ROUND(
        (CASE WHEN v.year IS NOT NULL THEN 10 ELSE 0 END) +
        (CASE WHEN v.make IS NOT NULL THEN 10 ELSE 0 END) +
        (CASE WHEN v.model IS NOT NULL THEN 10 ELSE 0 END) +
        (CASE WHEN v.vin IS NOT NULL THEN 15 ELSE 0 END) +
        (CASE WHEN v.sale_price IS NOT NULL THEN 15 ELSE 0 END) +
        (CASE WHEN COALESCE(ac.comment_count, 0) > 0 THEN 15 ELSE 0 END) +
        (CASE WHEN COALESCE(img.image_count, 0) > 0 THEN 15 ELSE 0 END) +
        (CASE WHEN COALESCE(cd.comment_discoveries, 0) > 0 THEN 5 ELSE 0 END) +
        (CASE WHEN COALESCE(dd.description_discoveries, 0) > 0 THEN 5 ELSE 0 END)
    ) AS data_completeness_score

FROM vehicles v

-- Comment aggregates
LEFT JOIN LATERAL (
    SELECT
        COUNT(*) AS comment_count,
        MIN(posted_at) AS first_comment_at,
        MAX(posted_at) AS last_comment_at
    FROM auction_comments
    WHERE vehicle_id = v.id
) ac ON true

-- BaT listing aggregates
LEFT JOIN LATERAL (
    SELECT
        COUNT(*) AS bat_listing_count,
        MAX(comment_count) AS max_bat_comment_count,
        BOOL_OR((raw_data->>'comments_extracted_at') IS NOT NULL) AS comments_extracted
    FROM bat_listings
    WHERE vehicle_id = v.id
) bl ON true

-- Comment discoveries
LEFT JOIN LATERAL (
    SELECT
        COUNT(*) AS comment_discoveries,
        (SELECT overall_sentiment FROM comment_discoveries WHERE vehicle_id = v.id ORDER BY discovered_at DESC LIMIT 1) AS latest_sentiment,
        (SELECT sentiment_score FROM comment_discoveries WHERE vehicle_id = v.id ORDER BY discovered_at DESC LIMIT 1) AS sentiment_score
    FROM comment_discoveries
    WHERE vehicle_id = v.id
) cd ON true

-- Description discoveries
LEFT JOIN LATERAL (
    SELECT COUNT(*) AS description_discoveries
    FROM description_discoveries
    WHERE vehicle_id = v.id
) dd ON true

-- Image count
LEFT JOIN LATERAL (
    SELECT COUNT(*) AS image_count
    FROM vehicle_images
    WHERE vehicle_id = v.id
) img ON true

-- Auction events
LEFT JOIN LATERAL (
    SELECT COUNT(*) AS auction_event_count
    FROM auction_events
    WHERE vehicle_id = v.id
) ae ON true;

-- Index for common queries
CREATE INDEX idx_vehicle_data_summary_has_comments ON vehicle_data_summary_mv (has_comments) WHERE has_comments = true;
CREATE INDEX idx_vehicle_data_summary_comment_count ON vehicle_data_summary_mv (comment_count DESC);
CREATE INDEX idx_vehicle_data_summary_completeness ON vehicle_data_summary_mv (data_completeness_score DESC);
CREATE UNIQUE INDEX idx_vehicle_data_summary_vehicle_id ON vehicle_data_summary_mv (vehicle_id);

-- Create a simple view wrapper for API access
CREATE VIEW vehicle_data_summary AS SELECT * FROM vehicle_data_summary_mv;

-- Function to refresh the materialized view
CREATE OR REPLACE FUNCTION refresh_vehicle_data_summary()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY vehicle_data_summary_mv;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- QUICK STATS VIEW
-- =============================================================================
-- One-row summary of the entire database state
-- Usage: SELECT * FROM db_quick_stats;

DROP VIEW IF EXISTS db_quick_stats CASCADE;

CREATE VIEW db_quick_stats AS
SELECT
    (SELECT COUNT(*) FROM vehicles) AS total_vehicles,
    (SELECT COUNT(*) FROM auction_comments) AS total_comments,
    (SELECT COUNT(DISTINCT vehicle_id) FROM auction_comments WHERE vehicle_id IS NOT NULL) AS vehicles_with_comments,
    (SELECT COUNT(*) FROM bat_listings WHERE comment_count > 0) AS bat_listings_with_comments,
    (SELECT COUNT(*) FROM bat_listings WHERE (raw_data->>'comments_extracted_at') IS NOT NULL) AS bat_listings_extracted,
    (SELECT COUNT(*) FROM comment_discoveries) AS comment_discoveries,
    (SELECT COUNT(*) FROM description_discoveries) AS description_discoveries,
    (SELECT COUNT(*) FROM vehicle_images) AS total_images,
    (SELECT COUNT(*) FROM auction_events) AS total_auction_events;

-- =============================================================================
-- COMMENTS
-- =============================================================================
COMMENT ON MATERIALIZED VIEW vehicle_data_summary_mv IS
'Single source of truth for vehicle data distribution. Shows what data exists for each vehicle across all tables. Refresh with: SELECT refresh_vehicle_data_summary();';

COMMENT ON VIEW db_quick_stats IS
'One-row database state summary. Use this first to understand data distribution before querying individual tables.';
