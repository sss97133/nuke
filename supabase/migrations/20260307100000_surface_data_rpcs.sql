-- Surface the Damn Data: RPCs for batch image/observation counts + primary image backfill
-- These enable search results and vehicle cards to show real data instead of hardcoded 0s

-- ============================================================
-- 1. Batch count vehicle images (non-duplicate) by vehicle IDs
-- ============================================================
CREATE OR REPLACE FUNCTION count_vehicle_images_batch(vehicle_ids uuid[])
RETURNS TABLE(vehicle_id uuid, count bigint)
LANGUAGE sql STABLE
AS $$
  SELECT vi.vehicle_id, count(*) as count
  FROM vehicle_images vi
  WHERE vi.vehicle_id = ANY(vehicle_ids)
    AND (vi.is_duplicate IS NOT TRUE)
  GROUP BY vi.vehicle_id;
$$;

-- ============================================================
-- 2. Batch count vehicle observations by vehicle IDs
-- ============================================================
CREATE OR REPLACE FUNCTION count_vehicle_observations_batch(vehicle_ids uuid[])
RETURNS TABLE(vehicle_id uuid, count bigint)
LANGUAGE sql STABLE
AS $$
  SELECT vo.vehicle_id, count(*) as count
  FROM vehicle_observations vo
  WHERE vo.vehicle_id = ANY(vehicle_ids)
  GROUP BY vo.vehicle_id;
$$;

-- ============================================================
-- 3. Backfill primary_image_url in batches
-- Selects the "best" image per vehicle using:
--   1. organization_status = 'organized' preferred
--   2. is_primary = true preferred
--   3. angle = 'front_3/4' or 'front' preferred (best hero shot)
--   4. Most recent image as tiebreaker
-- Returns count of updated rows.
-- ============================================================
CREATE OR REPLACE FUNCTION backfill_primary_image_url(batch_size int DEFAULT 500)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  updated_count int := 0;
BEGIN
  WITH candidates AS (
    -- Find vehicles missing primary_image_url that have images
    SELECT v.id as vehicle_id
    FROM vehicles v
    WHERE v.primary_image_url IS NULL
      AND v.is_public = true
      AND EXISTS (
        SELECT 1 FROM vehicle_images vi
        WHERE vi.vehicle_id = v.id
          AND vi.is_duplicate IS NOT TRUE
      )
    LIMIT batch_size
  ),
  best_image AS (
    SELECT DISTINCT ON (c.vehicle_id)
      c.vehicle_id,
      vi.image_url
    FROM candidates c
    JOIN vehicle_images vi ON vi.vehicle_id = c.vehicle_id
    WHERE vi.is_duplicate IS NOT TRUE
      AND vi.image_url IS NOT NULL
      AND vi.image_url != ''
    ORDER BY
      c.vehicle_id,
      -- Prefer organized images
      (CASE WHEN vi.organization_status = 'organized' THEN 0 ELSE 1 END),
      -- Prefer explicitly marked primary
      (CASE WHEN vi.is_primary = true THEN 0 ELSE 1 END),
      -- Prefer good hero shot angles
      (CASE
        WHEN vi.angle = 'front_3/4' THEN 0
        WHEN vi.angle = 'front' THEN 1
        WHEN vi.angle = 'side' THEN 2
        WHEN vi.angle = 'rear_3/4' THEN 3
        ELSE 4
      END),
      -- Prefer higher confidence
      vi.angle_confidence DESC NULLS LAST,
      -- Most recent as tiebreaker
      vi.created_at DESC NULLS LAST
  )
  UPDATE vehicles v
  SET primary_image_url = bi.image_url
  FROM best_image bi
  WHERE v.id = bi.vehicle_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

-- ============================================================
-- 4. Enhanced data quality score that accounts for images and observations
-- A vehicle with 50 images + 10 observations + VIN should be A/B tier, not F
-- ============================================================
CREATE OR REPLACE FUNCTION recalculate_quality_score(p_vehicle_id uuid)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  v_score int := 0;
  v_year int;
  v_make text;
  v_model text;
  v_vin text;
  v_description text;
  v_mileage int;
  v_sale_price numeric;
  v_listing_url text;
  v_image_count bigint;
  v_obs_count bigint;
  v_has_estimate boolean;
  v_has_timeline boolean;
BEGIN
  -- Get vehicle basics
  SELECT year, make, model, vin, description, mileage, sale_price, discovery_url
  INTO v_year, v_make, v_model, v_vin, v_description, v_mileage, v_sale_price, v_listing_url
  FROM vehicles WHERE id = p_vehicle_id;

  -- Get image count (non-duplicate)
  SELECT count(*) INTO v_image_count
  FROM vehicle_images
  WHERE vehicle_id = p_vehicle_id AND is_duplicate IS NOT TRUE;

  -- Get observation count
  SELECT count(*) INTO v_obs_count
  FROM vehicle_observations
  WHERE vehicle_id = p_vehicle_id;

  -- Check for nuke estimate
  SELECT EXISTS(SELECT 1 FROM nuke_estimates WHERE vehicle_id = p_vehicle_id)
  INTO v_has_estimate;

  -- Check for timeline events
  SELECT EXISTS(SELECT 1 FROM timeline_events WHERE vehicle_id = p_vehicle_id)
  INTO v_has_timeline;

  -- Base identification (30 pts)
  IF v_year IS NOT NULL AND v_year BETWEEN 1885 AND 2028 THEN v_score := v_score + 10; END IF;
  IF v_make IS NOT NULL AND length(v_make) > 0 THEN v_score := v_score + 10; END IF;
  IF v_model IS NOT NULL AND length(v_model) > 0 AND length(v_model) < 80 THEN v_score := v_score + 10; END IF;

  -- VIN (10 pts)
  IF v_vin IS NOT NULL AND length(v_vin) >= 4 THEN
    IF length(v_vin) = 17 THEN v_score := v_score + 10;
    ELSE v_score := v_score + 5;
    END IF;
  END IF;

  -- Images (20 pts) — the big one that was missing
  IF v_image_count >= 1 THEN v_score := v_score + 5; END IF;
  IF v_image_count >= 5 THEN v_score := v_score + 5; END IF;
  IF v_image_count >= 15 THEN v_score := v_score + 5; END IF;
  IF v_image_count >= 30 THEN v_score := v_score + 5; END IF;

  -- Observations (15 pts) — the other big one
  IF v_obs_count >= 1 THEN v_score := v_score + 5; END IF;
  IF v_obs_count >= 5 THEN v_score := v_score + 5; END IF;
  IF v_obs_count >= 15 THEN v_score := v_score + 5; END IF;

  -- Price info (5 pts)
  IF v_sale_price IS NOT NULL AND v_sale_price >= 100 THEN v_score := v_score + 5; END IF;

  -- Description (5 pts)
  IF v_description IS NOT NULL AND length(v_description) > 30 THEN v_score := v_score + 5; END IF;

  -- Mileage (5 pts)
  IF v_mileage IS NOT NULL THEN v_score := v_score + 5; END IF;

  -- Listing URL (5 pts)
  IF v_listing_url IS NOT NULL THEN v_score := v_score + 5; END IF;

  -- Nuke estimate bonus (5 pts)
  IF v_has_estimate THEN v_score := v_score + 5; END IF;

  -- Timeline events bonus (5 pts)
  IF v_has_timeline THEN v_score := v_score + 5; END IF;

  -- Cap at 100
  IF v_score > 100 THEN v_score := 100; END IF;

  -- Update the vehicle
  UPDATE vehicles SET data_quality_score = v_score WHERE id = p_vehicle_id;

  RETURN v_score;
END;
$$;

-- ============================================================
-- 5. Batch recalculate quality scores
-- ============================================================
CREATE OR REPLACE FUNCTION batch_recalculate_quality_scores(batch_size int DEFAULT 1000)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  v_count int := 0;
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT id FROM vehicles
    WHERE is_public = true
      AND year IS NOT NULL
      AND make IS NOT NULL
    ORDER BY
      -- Prioritize vehicles that likely have wrong scores
      -- (those with low scores but potentially rich data)
      data_quality_score ASC NULLS FIRST
    LIMIT batch_size
  LOOP
    PERFORM recalculate_quality_score(v_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- ============================================================
-- 6. Get vehicle profile enrichment (observation + image + timeline counts)
-- Single query to power the vehicle profile page
-- ============================================================
CREATE OR REPLACE FUNCTION get_vehicle_data_summary(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT jsonb_build_object(
    'image_count', (SELECT count(*) FROM vehicle_images WHERE vehicle_id = p_vehicle_id AND is_duplicate IS NOT TRUE),
    'observation_count', (SELECT count(*) FROM vehicle_observations WHERE vehicle_id = p_vehicle_id),
    'timeline_event_count', (SELECT count(*) FROM timeline_events WHERE vehicle_id = p_vehicle_id),
    'has_nuke_estimate', (SELECT EXISTS(SELECT 1 FROM nuke_estimates WHERE vehicle_id = p_vehicle_id)),
    'nuke_estimate', (SELECT jsonb_build_object(
      'estimated_value', estimated_value,
      'value_low', value_low,
      'value_high', value_high,
      'confidence_score', confidence_score,
      'deal_score', deal_score,
      'deal_score_label', deal_score_label,
      'heat_score', heat_score,
      'heat_score_label', heat_score_label,
      'calculated_at', calculated_at
    ) FROM nuke_estimates WHERE vehicle_id = p_vehicle_id),
    'auction_results', (
      SELECT jsonb_agg(jsonb_build_object(
        'source', ve.source_platform,
        'url', ve.source_url,
        'sale_price', ve.final_price,
        'event_date', COALESCE(ve.ended_at, ve.sold_at, ve.started_at),
        'event_type', ve.event_type,
        'bid_count', ve.bid_count
      ) ORDER BY COALESCE(ve.ended_at, ve.sold_at, ve.started_at) DESC NULLS LAST)
      FROM vehicle_events ve
      WHERE ve.vehicle_id = p_vehicle_id
        AND ve.event_type IN ('auction_ended', 'sold', 'listing_ended')
      LIMIT 10
    ),
    'observation_sources', (
      SELECT jsonb_agg(DISTINCT jsonb_build_object(
        'source', os.display_name,
        'category', os.category,
        'count', sub.cnt
      ))
      FROM (
        SELECT source_id, count(*) as cnt
        FROM vehicle_observations
        WHERE vehicle_id = p_vehicle_id
        GROUP BY source_id
      ) sub
      JOIN observation_sources os ON os.id = sub.source_id
    )
  );
$$;
