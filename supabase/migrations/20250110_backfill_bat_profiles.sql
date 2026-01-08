-- Backfill BaT profiles with incomplete or incorrect data
-- This identifies vehicles that need re-extraction with the fixed sale status logic

-- Function to find and queue BaT vehicles needing backfilling
CREATE OR REPLACE FUNCTION queue_bat_backfill_vehicles(
  p_limit INTEGER DEFAULT 100,
  p_priority INTEGER DEFAULT 75
)
RETURNS TABLE(
  vehicle_id UUID,
  reason TEXT,
  bat_url TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH vehicles_to_backfill AS (
    -- 1. Vehicles with wrong sale status: marked as sold but should be "bid_to" or "no_sale"
    --    (have high_bid/winning_bid but no actual sale_price, or auction_outcome='sold' but no sale_price)
    SELECT DISTINCT
      v.id as vehicle_id,
      'Wrong sale status: marked as sold but should be bid_to/no_sale' as reason,
      COALESCE(v.bat_auction_url, v.discovery_url) as bat_url
    FROM vehicles v
    LEFT JOIN auction_events ae ON ae.vehicle_id = v.id AND ae.source_url ~* 'bringatrailer\.com'
    WHERE (v.bat_auction_url IS NOT NULL OR v.discovery_url ~* 'bringatrailer\.com')
      AND (
        -- Has high_bid/winning_bid but no sale_price (wrongly marked as sold)
        (
          (v.sale_price IS NULL OR v.sale_price = 0)
          AND (
            (ae.outcome = 'sold' AND (ae.high_bid IS NOT NULL OR ae.winning_bid IS NOT NULL) AND ae.winning_bid IS NULL)
            OR (v.asking_price > 0 AND v.sale_price IS NULL)
          )
        )
        -- OR auction_outcome is 'sold' but no sale_price
        OR (ae.outcome = 'sold' AND (v.sale_price IS NULL OR v.sale_price = 0))
      )
    
    UNION
    
    -- 2. Vehicles missing critical data (VIN, mileage, specs)
    SELECT DISTINCT
      v.id as vehicle_id,
      'Missing critical data: ' || 
      CASE 
        WHEN v.vin IS NULL THEN 'VIN, '
        ELSE ''
      END ||
      CASE 
        WHEN v.mileage IS NULL THEN 'mileage, '
        ELSE ''
      END ||
      CASE 
        WHEN v.color IS NULL THEN 'color, '
        ELSE ''
      END ||
      CASE 
        WHEN v.transmission IS NULL THEN 'transmission, '
        ELSE ''
      END ||
      CASE 
        WHEN v.drivetrain IS NULL THEN 'drivetrain'
        ELSE ''
      END as reason,
      COALESCE(v.bat_auction_url, v.discovery_url) as bat_url
    FROM vehicles v
    WHERE (v.bat_auction_url IS NOT NULL OR v.discovery_url ~* 'bringatrailer\.com')
      AND (
        v.vin IS NULL OR
        v.mileage IS NULL OR
        v.color IS NULL OR
        v.transmission IS NULL OR
        v.drivetrain IS NULL
      )
    
    UNION
    
    -- 3. Vehicles with incorrect price data (high_bid stored as sale_price)
    SELECT DISTINCT
      v.id as vehicle_id,
      'Incorrect price: high_bid may be stored as sale_price' as reason,
      COALESCE(v.bat_auction_url, v.discovery_url) as bat_url
    FROM vehicles v
    LEFT JOIN auction_events ae ON ae.vehicle_id = v.id AND ae.source_url ~* 'bringatrailer\.com'
    WHERE (v.bat_auction_url IS NOT NULL OR v.discovery_url ~* 'bringatrailer\.com')
      AND v.sale_price IS NOT NULL
      AND v.sale_price > 0
      AND (
        -- Has sale_price but auction_outcome is not 'sold'
        (ae.outcome IS NOT NULL AND ae.outcome != 'sold')
        -- OR has sale_price but no buyer/winning_bidder
        OR (v.sale_price > 0 AND (ae.winning_bidder IS NULL OR ae.winning_bidder = ''))
      )
    
    UNION
    
    -- 4. Vehicles missing auction outcome data
    SELECT DISTINCT
      v.id as vehicle_id,
      'Missing auction outcome data' as reason,
      COALESCE(v.bat_auction_url, v.discovery_url) as bat_url
    FROM vehicles v
    LEFT JOIN auction_events ae ON ae.vehicle_id = v.id AND ae.source_url ~* 'bringatrailer\.com'
    WHERE (v.bat_auction_url IS NOT NULL OR v.discovery_url ~* 'bringatrailer\.com')
      AND ae.id IS NULL  -- No auction_event at all
      AND v.created_at < NOW() - INTERVAL '7 days'  -- Older than 7 days (give initial extraction time)
  )
  SELECT 
    vtb.vehicle_id,
    vtb.reason,
    vtb.bat_url
  FROM vehicles_to_backfill vtb
  WHERE vtb.bat_url IS NOT NULL
    AND vtb.bat_url ~* 'bringatrailer\.com'
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to automatically queue backfill vehicles
CREATE OR REPLACE FUNCTION auto_queue_bat_backfills(
  p_batch_size INTEGER DEFAULT 50,
  p_priority INTEGER DEFAULT 75
)
RETURNS TABLE(
  queued_count INTEGER,
  skipped_count INTEGER
) AS $$
DECLARE
  v_queued INTEGER := 0;
  v_skipped INTEGER := 0;
  v_item RECORD;
BEGIN
  -- Get vehicles needing backfill
  FOR v_item IN 
    SELECT * FROM queue_bat_backfill_vehicles(p_limit := p_batch_size, p_priority := p_priority)
  LOOP
    -- Insert into queue (skip if already queued with status 'pending' or 'processing')
    INSERT INTO bat_extraction_queue (vehicle_id, bat_url, priority, created_at, status)
    VALUES (v_item.vehicle_id, v_item.bat_url, p_priority, NOW(), 'pending')
    ON CONFLICT (vehicle_id) 
    DO UPDATE SET
      priority = GREATEST(bat_extraction_queue.priority, p_priority),
      updated_at = NOW(),
      -- Reset to pending if it was previously failed
      status = CASE 
        WHEN bat_extraction_queue.status = 'failed' THEN 'pending'
        ELSE bat_extraction_queue.status
      END
    WHERE bat_extraction_queue.status IN ('failed', 'pending');
    
    IF FOUND THEN
      v_queued := v_queued + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT v_queued, v_skipped;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION queue_bat_backfill_vehicles IS 'Identifies BaT vehicles that need backfilling due to incorrect sale status or missing data';
COMMENT ON FUNCTION auto_queue_bat_backfills IS 'Automatically queues BaT vehicles for backfill extraction';

