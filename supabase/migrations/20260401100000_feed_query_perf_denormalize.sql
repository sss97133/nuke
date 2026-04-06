-- Migration: Feed query performance optimization
-- Denormalizes has_photos onto vehicles table, adds primary_image_url to MV,
-- moves non-auto make exclusion into MV WHERE clause, adds composite index.
-- This eliminates 5 enrichment queries from feed-query edge function.

-- ============================================================================
-- 1. Add has_photos column to vehicles
-- ============================================================================
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS has_photos boolean DEFAULT false;

-- ============================================================================
-- 2. Create trigger function to maintain has_photos on vehicle_images changes
-- ============================================================================
CREATE OR REPLACE FUNCTION maintain_vehicle_has_photos()
RETURNS trigger AS $$
DECLARE
  target_vehicle_id uuid;
  photo_exists boolean;
BEGIN
  -- Determine which vehicle_id to check
  IF TG_OP = 'DELETE' THEN
    target_vehicle_id := OLD.vehicle_id;
  ELSIF TG_OP = 'UPDATE' THEN
    -- If vehicle_id changed, update both old and new
    IF OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id THEN
      UPDATE vehicles SET has_photos = EXISTS(
        SELECT 1 FROM vehicle_images WHERE vehicle_id = OLD.vehicle_id LIMIT 1
      ) WHERE id = OLD.vehicle_id;
      target_vehicle_id := NEW.vehicle_id;
    ELSE
      target_vehicle_id := NEW.vehicle_id;
    END IF;
  ELSE
    target_vehicle_id := NEW.vehicle_id;
  END IF;

  -- Fast EXISTS check
  photo_exists := EXISTS(
    SELECT 1 FROM vehicle_images WHERE vehicle_id = target_vehicle_id LIMIT 1
  );

  UPDATE vehicles SET has_photos = photo_exists WHERE id = target_vehicle_id AND has_photos IS DISTINCT FROM photo_exists;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 3. Attach triggers to vehicle_images
-- ============================================================================
DROP TRIGGER IF EXISTS trg_maintain_has_photos_insert ON vehicle_images;
CREATE TRIGGER trg_maintain_has_photos_insert
  AFTER INSERT ON vehicle_images
  FOR EACH ROW EXECUTE FUNCTION maintain_vehicle_has_photos();

DROP TRIGGER IF EXISTS trg_maintain_has_photos_delete ON vehicle_images;
CREATE TRIGGER trg_maintain_has_photos_delete
  AFTER DELETE ON vehicle_images
  FOR EACH ROW EXECUTE FUNCTION maintain_vehicle_has_photos();

DROP TRIGGER IF EXISTS trg_maintain_has_photos_update ON vehicle_images;
CREATE TRIGGER trg_maintain_has_photos_update
  AFTER UPDATE OF vehicle_id ON vehicle_images
  FOR EACH ROW EXECUTE FUNCTION maintain_vehicle_has_photos();

-- ============================================================================
-- 4. Backfill has_photos in batches of 1000 (Hard Rule #8)
-- ============================================================================
DO $$
DECLARE
  batch_size INT := 1000;
  affected INT;
  total_updated INT := 0;
BEGIN
  -- Set has_photos = true for vehicles that have images
  LOOP
    UPDATE vehicles SET has_photos = true
    WHERE id IN (
      SELECT v.id FROM vehicles v
      WHERE v.has_photos = false
        AND v.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM vehicle_images vi WHERE vi.vehicle_id = v.id LIMIT 1)
      LIMIT batch_size
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    total_updated := total_updated + affected;
    EXIT WHEN affected = 0;
    PERFORM pg_sleep(0.1);
  END LOOP;
  RAISE NOTICE 'Backfilled has_photos=true for % vehicles', total_updated;
END $$;

-- ============================================================================
-- 5. Rebuild materialized view with denormalized fields
--    - v.has_photos replaces correlated EXISTS subquery (2x in old def)
--    - LEFT JOIN vehicle_images for primary_image_url + thumbnail variants
--    - Non-auto make exclusion in WHERE clause
--    - Description snippet (first 300 chars) denormalized
-- ============================================================================

-- Drop old MV and its indexes (will recreate)
DROP MATERIALIZED VIEW IF EXISTS vehicle_valuation_feed_with_finds;
DROP MATERIALIZED VIEW IF EXISTS vehicle_valuation_feed CASCADE;

CREATE MATERIALIZED VIEW vehicle_valuation_feed AS
SELECT
  v.id AS vehicle_id,
  v.year,
  COALESCE(cm.canonical_name, v.make) AS make,
  v.model,
  v.series,
  v."trim",
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
  COALESCE(v.platform_source, v.discovery_source) AS discovery_source,
  v.profile_origin,
  v.origin_organization_id,
  v.city,
  v.state,
  v.listing_location,
  v.canonical_vehicle_type,
  v.has_photos,
  -- Denormalized primary image fields (eliminates 3 enrichment queries)
  COALESCE(pi.thumbnail_url, pi.medium_url, pi.image_url, v.primary_image_url) AS primary_image_url,
  pi.thumbnail_url,
  pi.medium_url,
  pi.image_url AS full_image_url,
  -- Description snippet (eliminates description enrichment query)
  LEFT(v.description, 300) AS description_snippet,
  -- Observation stats
  COALESCE(os.observation_count, 0::bigint) AS observation_count,
  COALESCE(os.source_count, 0::bigint) AS source_count,
  COALESCE(os.photo_count, 0::bigint) AS photo_count,
  -- Pricing
  cvp.best_price AS display_price,
  cvp.price_source,
  cvp.is_sold,
  v.asking_price,
  v.sale_price,
  v.current_value,
  -- Nuke estimates
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
  -- Record price
  CASE WHEN rp.record_vehicle_id = v.id THEN true ELSE false END AS is_record_price,
  rp.record_price AS segment_record_price,
  -- Feed rank score (uses v.has_photos instead of correlated subquery)
  COALESCE(ne.deal_score, 50::numeric) *
    CASE
      WHEN GREATEST(v.created_at, v.updated_at) > (now() - '1 day'::interval) THEN 1.0
      WHEN GREATEST(v.created_at, v.updated_at) > (now() - '3 days'::interval) THEN 0.95
      WHEN GREATEST(v.created_at, v.updated_at) > (now() - '7 days'::interval) THEN 0.85
      WHEN GREATEST(v.created_at, v.updated_at) > (now() - '30 days'::interval) THEN 0.50
      ELSE 0.30
    END
  + COALESCE(ne.heat_score, 0::numeric) * 0.3
  + CASE
      WHEN v.sale_status = 'auction_live' THEN 200
      WHEN v.is_for_sale = true THEN 80
      ELSE 0
    END::numeric
  + CASE
      WHEN COALESCE(v.platform_source, v.discovery_source) = ANY(ARRAY['bringatrailer','bat']) THEN 100
      WHEN COALESCE(v.platform_source, v.discovery_source) = ANY(ARRAY['cars-and-bids','cars_and_bids','collecting-cars','collecting_cars','mecum','barrett-jackson','barrett_jackson','rmsothebys','gooding','bonhams']) THEN 80
      WHEN COALESCE(v.platform_source, v.discovery_source) = ANY(ARRAY['pcarmarket','hagerty','hemmings']) THEN 60
      WHEN COALESCE(v.platform_source, v.discovery_source) = ANY(ARRAY['facebook_marketplace','facebook']) THEN -30
      ELSE 20
    END::numeric
  + CASE WHEN v.has_photos THEN 20 ELSE 0 END::numeric
  + LEAST(COALESCE(os.source_count, 0::bigint) * 10, 50::bigint)::numeric
  AS feed_rank_score
FROM vehicles v
  LEFT JOIN canonical_makes cm ON v.canonical_make_id = cm.id
  LEFT JOIN clean_vehicle_prices cvp ON cvp.vehicle_id = v.id
  LEFT JOIN nuke_estimates ne ON ne.vehicle_id = v.id
  LEFT JOIN record_prices rp
    ON COALESCE(cm.canonical_name, v.make) = rp.make
    AND v.model = rp.model
    AND v.year >= rp.year_start
    AND v.year <= rp.year_end
  -- Denormalize primary image (picks is_primary=true, falls back to first image)
  LEFT JOIN LATERAL (
    SELECT vi.thumbnail_url, vi.medium_url, vi.image_url
    FROM vehicle_images vi
    WHERE vi.vehicle_id = v.id AND vi.is_primary = true
    LIMIT 1
  ) pi ON true
  -- Observation stats
  LEFT JOIN LATERAL (
    SELECT
      count(*) AS observation_count,
      count(DISTINCT vo.source_id) AS source_count,
      count(*) FILTER (WHERE vo.kind = 'media'::observation_kind) AS photo_count
    FROM vehicle_observations vo
    WHERE vo.vehicle_id = v.id
  ) os ON true
WHERE
  v.deleted_at IS NULL
  AND v.status NOT IN ('deleted', 'merged', 'duplicate')
  AND (ne.is_stale IS NOT TRUE OR ne.id IS NULL)
  AND v.year IS NOT NULL
  AND v.make IS NOT NULL
  -- Non-auto make exclusion baked into MV (eliminates runtime query)
  AND UPPER(COALESCE(cm.canonical_name, v.make)) NOT IN (
    SELECT UPPER(make) FROM non_auto_makes_excluded
  );

-- ============================================================================
-- 6. Create indexes on MV
-- ============================================================================
CREATE UNIQUE INDEX idx_vvf_vehicle_id ON vehicle_valuation_feed (vehicle_id);
CREATE INDEX idx_vvf_feed_rank ON vehicle_valuation_feed (feed_rank_score DESC);
CREATE INDEX idx_vvf_feed_rank_vid ON vehicle_valuation_feed (feed_rank_score DESC, vehicle_id);
CREATE INDEX idx_vvf_created ON vehicle_valuation_feed (created_at DESC);
CREATE INDEX idx_vvf_updated ON vehicle_valuation_feed (updated_at DESC);
CREATE INDEX idx_vvf_has_photos ON vehicle_valuation_feed (has_photos);
CREATE INDEX idx_vvf_source ON vehicle_valuation_feed (discovery_source);
CREATE INDEX idx_vvf_make ON vehicle_valuation_feed (make);
CREATE INDEX idx_vvf_year ON vehicle_valuation_feed (year);
CREATE INDEX idx_vvf_vehicle_type ON vehicle_valuation_feed (canonical_vehicle_type);
CREATE INDEX idx_vvf_display_price ON vehicle_valuation_feed (display_price);

-- ============================================================================
-- 7. Recreate the finds view if it existed
-- ============================================================================
-- Check if vehicle_finds table exists before recreating
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vehicle_finds' AND table_schema = 'public') THEN
    EXECUTE '
      CREATE MATERIALIZED VIEW vehicle_valuation_feed_with_finds AS
      SELECT
        vvf.*,
        vf.find_score,
        vf.signal_breakdown AS find_signal_breakdown,
        vf.model_total AS find_model_total,
        vf.red_flag_count AS find_red_flag_count,
        vf.mod_count AS find_mod_count,
        vf.cross_platform_count AS find_cross_platform_count,
        vf.condition_grade AS find_condition_grade
      FROM vehicle_valuation_feed vvf
      JOIN vehicle_finds vf ON vf.vehicle_id = vvf.vehicle_id;
    ';
    EXECUTE 'CREATE UNIQUE INDEX idx_vvf_finds_vid ON vehicle_valuation_feed_with_finds (vehicle_id)';
    EXECUTE 'CREATE INDEX idx_vvf_finds_score ON vehicle_valuation_feed_with_finds (find_score DESC)';
  END IF;
END $$;

-- ============================================================================
-- 8. Create index on vehicle_images for faster primary image lookup (if missing)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_vehicle_images_primary
  ON vehicle_images (vehicle_id) WHERE is_primary = true;

-- ============================================================================
-- 9. Notify PostgREST to reload schema
-- ============================================================================
NOTIFY pgrst, 'reload schema';
