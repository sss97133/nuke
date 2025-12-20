-- Auto-extract BaT data for vehicles missing critical fields
-- This ensures all BaT vehicles automatically get comprehensive data extraction

CREATE OR REPLACE FUNCTION auto_extract_bat_data_if_needed()
RETURNS TRIGGER AS $$
DECLARE
  needs_extraction BOOLEAN := FALSE;
  bat_url TEXT;
BEGIN
  -- Only process BaT vehicles
  bat_url := COALESCE(NEW.bat_auction_url, NEW.discovery_url);
  IF bat_url IS NULL OR bat_url !~* 'bringatrailer\.com' THEN
    RETURN NEW;
  END IF;

  -- Check if vehicle needs comprehensive extraction
  -- Missing any of: bat_comments, bat_features, auction_end_date
  needs_extraction := (
    NEW.bat_comments IS NULL OR
    (NEW.origin_metadata->>'bat_features' IS NULL) OR
    (NEW.origin_metadata->>'bat_features' = '[]') OR
    NEW.auction_end_date IS NULL
  );

  -- If needs extraction and we have a URL, queue it
  IF needs_extraction AND bat_url IS NOT NULL THEN
    -- Insert into a queue table (create if doesn't exist)
    INSERT INTO bat_extraction_queue (vehicle_id, bat_url, priority, created_at)
    VALUES (NEW.id, bat_url, 100, NOW())
    ON CONFLICT (vehicle_id) DO UPDATE
    SET priority = GREATEST(bat_extraction_queue.priority, EXCLUDED.priority),
        updated_at = NOW()
    WHERE bat_extraction_queue.status = 'pending';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create queue table if it doesn't exist
CREATE TABLE IF NOT EXISTS bat_extraction_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  bat_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  priority INTEGER NOT NULL DEFAULT 100,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE(vehicle_id)
);

CREATE INDEX IF NOT EXISTS idx_bat_extraction_queue_status_priority ON bat_extraction_queue(status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_bat_extraction_queue_vehicle_id ON bat_extraction_queue(vehicle_id);

-- Create trigger to auto-queue extraction on insert/update
DROP TRIGGER IF EXISTS trigger_auto_extract_bat_data ON vehicles;
CREATE TRIGGER trigger_auto_extract_bat_data
  AFTER INSERT OR UPDATE ON vehicles
  FOR EACH ROW
  WHEN (
    (NEW.bat_auction_url IS NOT NULL OR NEW.discovery_url ~* 'bringatrailer\.com') AND
    (
      NEW.bat_comments IS NULL OR
      (NEW.origin_metadata->>'bat_features' IS NULL) OR
      (NEW.origin_metadata->>'bat_features' = '[]') OR
      NEW.auction_end_date IS NULL
    )
  )
  EXECUTE FUNCTION auto_extract_bat_data_if_needed();

-- Backfill: Queue all existing BaT vehicles missing data
INSERT INTO bat_extraction_queue (vehicle_id, bat_url, priority, created_at)
SELECT 
  v.id,
  COALESCE(v.bat_auction_url, v.discovery_url),
  50, -- Lower priority for backfill
  NOW()
FROM vehicles v
WHERE (v.bat_auction_url IS NOT NULL OR v.discovery_url ~* 'bringatrailer\.com')
  AND (
    v.bat_comments IS NULL OR
    (v.origin_metadata->>'bat_features' IS NULL) OR
    (v.origin_metadata->>'bat_features' = '[]') OR
    v.auction_end_date IS NULL
  )
ON CONFLICT (vehicle_id) DO NOTHING;

COMMENT ON TABLE bat_extraction_queue IS 'Queue for automatic BaT comprehensive data extraction';
COMMENT ON FUNCTION auto_extract_bat_data_if_needed() IS 'Automatically queues BaT vehicles for comprehensive extraction when critical fields are missing';

