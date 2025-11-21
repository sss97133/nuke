-- Automated BaT Price Fixing System
-- Detects and fixes price mismatches automatically

-- 1. Create table to track price fix history
CREATE TABLE IF NOT EXISTS vehicle_price_fixes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Before/after values
  old_sale_price NUMERIC,
  new_sale_price NUMERIC,
  old_bat_sold_price NUMERIC,
  new_bat_sold_price NUMERIC,
  old_bat_sale_date DATE,
  new_bat_sale_date DATE,
  
  -- Fix metadata
  bat_url TEXT,
  bat_lot_number TEXT,
  fix_method TEXT DEFAULT 'auto_scrape', -- auto_scrape, manual, batch_job
  confidence_score INTEGER DEFAULT 100,
  
  -- Status
  status TEXT DEFAULT 'fixed', -- fixed, failed, skipped
  error_message TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_price_fixes_vehicle ON vehicle_price_fixes(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_price_fixes_created ON vehicle_price_fixes(created_at DESC);

-- 2. Function to detect price issues
CREATE OR REPLACE FUNCTION detect_price_issues()
RETURNS TABLE (
  vehicle_id UUID,
  year INTEGER,
  make TEXT,
  model TEXT,
  bat_url TEXT,
  issue_type TEXT,
  current_value NUMERIC,
  expected_value NUMERIC,
  severity TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    v.id,
    v.year,
    v.make,
    v.model,
    v.bat_auction_url,
    CASE 
      WHEN v.sale_price = 0 AND v.bat_auction_url IS NOT NULL THEN 'sale_price_zero'
      WHEN v.bat_sold_price IS NULL AND v.bat_auction_url IS NOT NULL THEN 'bat_sold_price_missing'
      WHEN v.bat_sale_date IS NULL AND v.bat_auction_url IS NOT NULL THEN 'bat_sale_date_missing'
      ELSE 'unknown'
    END as issue_type,
    COALESCE(v.sale_price, v.bat_sold_price, 0) as current_value,
    NULL::NUMERIC as expected_value, -- Will be filled by scraper
    CASE 
      WHEN v.sale_price = 0 AND v.bat_auction_url IS NOT NULL THEN 'high'
      WHEN v.bat_sold_price IS NULL AND v.bat_auction_url IS NOT NULL THEN 'medium'
      ELSE 'low'
    END as severity
  FROM vehicles v
  WHERE v.bat_auction_url IS NOT NULL
    AND (
      v.sale_price = 0 
      OR v.bat_sold_price IS NULL 
      OR v.bat_sale_date IS NULL
    )
  ORDER BY 
    CASE 
      WHEN v.sale_price = 0 THEN 1
      WHEN v.bat_sold_price IS NULL THEN 2
      ELSE 3
    END,
    v.updated_at DESC;
END;
$$ LANGUAGE plpgsql;

-- 3. View for price issues dashboard
CREATE OR REPLACE VIEW price_issues_dashboard AS
SELECT 
  v.id,
  v.year,
  v.make,
  v.model,
  v.bat_auction_url,
  v.sale_price,
  v.bat_sold_price,
  v.bat_sale_date,
  CASE 
    WHEN v.sale_price = 0 AND v.bat_auction_url IS NOT NULL THEN 'sale_price_zero'
    WHEN v.bat_sold_price IS NULL AND v.bat_auction_url IS NOT NULL THEN 'bat_sold_price_missing'
    WHEN v.bat_sale_date IS NULL AND v.bat_auction_url IS NOT NULL THEN 'bat_sale_date_missing'
    ELSE 'ok'
  END as issue_type,
  CASE 
    WHEN v.sale_price = 0 THEN 'high'
    WHEN v.bat_sold_price IS NULL THEN 'medium'
    ELSE 'low'
  END as severity,
  v.updated_at,
  (SELECT COUNT(*) FROM vehicle_price_fixes vpf WHERE vpf.vehicle_id = v.id) as fix_count,
  (SELECT MAX(created_at) FROM vehicle_price_fixes vpf WHERE vpf.vehicle_id = v.id) as last_fix_attempt
FROM vehicles v
WHERE v.bat_auction_url IS NOT NULL
  AND (
    v.sale_price = 0 
    OR v.bat_sold_price IS NULL 
    OR v.bat_sale_date IS NULL
  );

-- 4. Function to log price fixes
CREATE OR REPLACE FUNCTION log_price_fix(
  p_vehicle_id UUID,
  p_old_sale_price NUMERIC,
  p_new_sale_price NUMERIC,
  p_old_bat_sold_price NUMERIC,
  p_new_bat_sold_price NUMERIC,
  p_old_bat_sale_date DATE,
  p_new_bat_sale_date DATE,
  p_bat_url TEXT,
  p_bat_lot_number TEXT,
  p_status TEXT DEFAULT 'fixed',
  p_error_message TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_fix_id UUID;
BEGIN
  INSERT INTO vehicle_price_fixes (
    vehicle_id,
    old_sale_price,
    new_sale_price,
    old_bat_sold_price,
    new_bat_sold_price,
    old_bat_sale_date,
    new_bat_sale_date,
    bat_url,
    bat_lot_number,
    status,
    error_message
  ) VALUES (
    p_vehicle_id,
    p_old_sale_price,
    p_new_sale_price,
    p_old_bat_sold_price,
    p_new_bat_sold_price,
    p_old_bat_sale_date,
    p_new_bat_sale_date,
    p_bat_url,
    p_bat_lot_number,
    p_status,
    p_error_message
  )
  RETURNING id INTO v_fix_id;
  
  RETURN v_fix_id;
END;
$$ LANGUAGE plpgsql;

-- 5. Schedule daily price fix check (if pg_cron extension is available)
-- This will run the edge function automatically
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'auto-fix-bat-prices-daily',
      '0 2 * * *', -- Daily at 2 AM
      $$
      SELECT net.http_post(
        url := current_setting('app.supabase_url') || '/functions/v1/auto-fix-bat-prices',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.service_role_key')
        ),
        body := jsonb_build_object(
          'action', 'fix_batch'
        )
      );
      $$
    );
  END IF;
END $$;

-- 6. RLS Policies
ALTER TABLE vehicle_price_fixes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view price fixes for their vehicles"
  ON vehicle_price_fixes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM vehicles 
      WHERE vehicles.id = vehicle_price_fixes.vehicle_id 
      AND vehicles.user_id = auth.uid()
    )
  );

CREATE POLICY "System can insert price fixes"
  ON vehicle_price_fixes FOR INSERT
  WITH CHECK (true); -- Edge function needs to insert

-- 7. Grant permissions
GRANT SELECT ON price_issues_dashboard TO authenticated;
GRANT EXECUTE ON FUNCTION detect_price_issues() TO authenticated;
GRANT EXECUTE ON FUNCTION log_price_fix(UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC, DATE, DATE, TEXT, TEXT, TEXT, TEXT) TO authenticated;

