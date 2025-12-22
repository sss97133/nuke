-- Micro Scrape Bandaid System
-- Continuous, lightweight gap-filling for vehicles with source URLs
-- Goal: Automatically improve data quality until threshold is met

-- ============================================
-- 1. TRACKING TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS micro_scrape_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Run metadata
  run_type TEXT DEFAULT 'scheduled' CHECK (run_type IN ('scheduled', 'manual', 'triggered')),
  batch_size INTEGER DEFAULT 20,
  
  -- Results
  vehicles_analyzed INTEGER DEFAULT 0,
  vehicles_improved INTEGER DEFAULT 0,
  vehicles_marked_complete INTEGER DEFAULT 0,
  actions_executed INTEGER DEFAULT 0,
  actions_succeeded INTEGER DEFAULT 0,
  actions_failed INTEGER DEFAULT 0,
  
  -- Performance
  runtime_ms INTEGER,
  
  -- Status
  status TEXT DEFAULT 'completed' CHECK (status IN ('running', 'completed', 'failed', 'timeout')),
  error_message TEXT,
  
  -- Timestamps
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_micro_scrape_runs_status ON micro_scrape_runs(status, started_at DESC);
CREATE INDEX idx_micro_scrape_runs_completed ON micro_scrape_runs(completed_at DESC);

-- ============================================
-- 2. VEHICLE COMPLETION TRACKING
-- ============================================

-- Add completion flag to vehicles.origin_metadata (via trigger/function)
-- This is already handled in the function, but we can add a helper function

CREATE OR REPLACE FUNCTION mark_vehicle_micro_scrape_complete(p_vehicle_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE vehicles
  SET origin_metadata = COALESCE(origin_metadata, '{}'::jsonb) || jsonb_build_object(
    'micro_scrape_complete', true,
    'micro_scrape_completed_at', NOW()
  )
  WHERE id = p_vehicle_id;
END;
$$;

-- ============================================
-- 3. FIND VEHICLES NEEDING MICRO-SCRAPE
-- ============================================

CREATE OR REPLACE VIEW vehicles_needing_micro_scrape AS
SELECT 
  v.id,
  v.make,
  v.model,
  v.year,
  v.discovery_url,
  v.origin_metadata,
  COALESCE(qs.overall_score, 0) as quality_score,
  COUNT(vi.id) as image_count,
  CASE 
    WHEN v.vin IS NULL THEN true ELSE false
  END as missing_vin,
  CASE 
    WHEN v.sale_price IS NULL THEN true ELSE false
  END as missing_price,
  CASE 
    WHEN v.description IS NULL OR v.description = '' THEN true ELSE false
  END as missing_description,
  CASE 
    WHEN v.origin_metadata->'image_urls' IS NOT NULL 
     AND v.origin_metadata->'image_urls' != '[]'::jsonb
     AND COUNT(vi.id) = 0 THEN true
    ELSE false
  END as images_need_download,
  CASE 
    WHEN COALESCE(qs.overall_score, 0) < 85 THEN true
    ELSE false
  END as below_threshold,
  v.created_at,
  v.updated_at
FROM vehicles v
LEFT JOIN vehicle_quality_scores qs ON qs.vehicle_id = v.id
LEFT JOIN vehicle_images vi ON vi.vehicle_id = v.id
WHERE 
  v.discovery_url IS NOT NULL
  AND v.discovery_url != ''
  AND (
    -- Not marked complete
    (v.origin_metadata->>'micro_scrape_complete')::boolean IS NOT TRUE
    OR
    -- Below quality threshold
    COALESCE(qs.overall_score, 0) < 85
    OR
    -- Has stored image URLs but no downloaded images
    (v.origin_metadata->'image_urls' IS NOT NULL 
     AND v.origin_metadata->'image_urls' != '[]'::jsonb
     AND NOT EXISTS (SELECT 1 FROM vehicle_images WHERE vehicle_id = v.id))
  )
GROUP BY v.id, v.make, v.model, v.year, v.discovery_url, v.vin, v.sale_price, v.description, v.origin_metadata, qs.overall_score, v.created_at, v.updated_at
ORDER BY 
  COALESCE(qs.overall_score, 0) ASC, -- Lowest quality first
  v.created_at DESC; -- Recent first

-- ============================================
-- 4. AUTOMATED CRON JOB
-- ============================================

-- This will be set up via Supabase Dashboard or pg_cron extension
-- Runs every 5 minutes to continuously improve data quality

COMMENT ON VIEW vehicles_needing_micro_scrape IS 'Vehicles with source URLs that need gap-filling via micro-scrape';
COMMENT ON TABLE micro_scrape_runs IS 'Tracks all micro-scrape runs for monitoring and debugging';
COMMENT ON FUNCTION mark_vehicle_micro_scrape_complete IS 'Marks a vehicle as complete after micro-scrape reaches quality threshold';

