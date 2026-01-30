-- =====================================================
-- PARTS PRICE REFRESH CRON JOB
-- Refreshes eBay prices every 4 hours
-- =====================================================

-- Enable pg_cron if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant usage to postgres user
GRANT USAGE ON SCHEMA cron TO postgres;

-- Function to call the price refresh edge function
CREATE OR REPLACE FUNCTION trigger_parts_price_refresh()
RETURNS void AS $$
DECLARE
  supabase_url TEXT;
  service_key TEXT;
BEGIN
  -- Get Supabase URL from environment or config
  -- In production, these would be stored securely
  supabase_url := current_setting('app.settings.supabase_url', true);
  service_key := current_setting('app.settings.service_role_key', true);

  -- If settings not available, log and exit
  IF supabase_url IS NULL OR service_key IS NULL THEN
    RAISE NOTICE 'Supabase URL or service key not configured for cron job';
    RETURN;
  END IF;

  -- Call the edge function via HTTP
  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/refresh-parts-prices',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );

  RAISE NOTICE 'Parts price refresh triggered at %', NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule the cron job to run every 4 hours
-- Note: pg_cron must be enabled in your Supabase project
DO $$
BEGIN
  -- Unschedule existing job if it exists
  PERFORM cron.unschedule('refresh-parts-prices');
EXCEPTION
  WHEN undefined_function THEN
    RAISE NOTICE 'pg_cron not available, skipping cron job creation';
    RETURN;
  WHEN OTHERS THEN
    NULL; -- Job might not exist, that's fine
END $$;

-- Create the scheduled job
DO $$
BEGIN
  PERFORM cron.schedule(
    'refresh-parts-prices',
    '0 */4 * * *',  -- Every 4 hours
    $$SELECT trigger_parts_price_refresh()$$
  );
  RAISE NOTICE 'Scheduled parts price refresh job to run every 4 hours';
EXCEPTION
  WHEN undefined_function THEN
    RAISE NOTICE 'pg_cron not available, skipping cron job creation. Enable pg_cron in Supabase dashboard.';
  WHEN OTHERS THEN
    RAISE NOTICE 'Could not schedule cron job: %', SQLERRM;
END $$;

-- Also create a manual refresh function that can be called directly
CREATE OR REPLACE FUNCTION manual_refresh_parts_prices()
RETURNS TABLE (
  parts_updated INTEGER,
  cache_cleared INTEGER,
  duration_ms INTEGER
) AS $$
DECLARE
  start_time TIMESTAMPTZ;
  parts_count INTEGER := 0;
  cache_count INTEGER := 0;
BEGIN
  start_time := clock_timestamp();

  -- Clean expired cache entries
  DELETE FROM ebay_api_cache WHERE expires_at < NOW();
  GET DIAGNOSTICS cache_count = ROW_COUNT;

  -- Update price stats from recent observations
  INSERT INTO part_price_stats (
    part_catalog_id,
    min_price_cents,
    max_price_cents,
    avg_price_cents,
    new_min_cents,
    new_max_cents,
    new_avg_cents,
    used_min_cents,
    used_max_cents,
    used_avg_cents,
    reman_min_cents,
    reman_max_cents,
    reman_avg_cents,
    observation_count,
    source_count,
    last_updated
  )
  SELECT
    part_catalog_id,
    MIN(price_cents),
    MAX(price_cents),
    AVG(price_cents)::INTEGER,
    MIN(CASE WHEN condition = 'new' THEN price_cents END),
    MAX(CASE WHEN condition = 'new' THEN price_cents END),
    AVG(CASE WHEN condition = 'new' THEN price_cents END)::INTEGER,
    MIN(CASE WHEN condition = 'used' THEN price_cents END),
    MAX(CASE WHEN condition = 'used' THEN price_cents END),
    AVG(CASE WHEN condition = 'used' THEN price_cents END)::INTEGER,
    MIN(CASE WHEN condition = 'remanufactured' THEN price_cents END),
    MAX(CASE WHEN condition = 'remanufactured' THEN price_cents END),
    AVG(CASE WHEN condition = 'remanufactured' THEN price_cents END)::INTEGER,
    COUNT(*),
    COUNT(DISTINCT source_name),
    NOW()
  FROM part_price_observations
  WHERE observed_at > NOW() - INTERVAL '7 days'
  GROUP BY part_catalog_id
  ON CONFLICT (part_catalog_id) DO UPDATE SET
    min_price_cents = EXCLUDED.min_price_cents,
    max_price_cents = EXCLUDED.max_price_cents,
    avg_price_cents = EXCLUDED.avg_price_cents,
    new_min_cents = EXCLUDED.new_min_cents,
    new_max_cents = EXCLUDED.new_max_cents,
    new_avg_cents = EXCLUDED.new_avg_cents,
    used_min_cents = EXCLUDED.used_min_cents,
    used_max_cents = EXCLUDED.used_max_cents,
    used_avg_cents = EXCLUDED.used_avg_cents,
    reman_min_cents = EXCLUDED.reman_min_cents,
    reman_max_cents = EXCLUDED.reman_max_cents,
    reman_avg_cents = EXCLUDED.reman_avg_cents,
    observation_count = EXCLUDED.observation_count,
    source_count = EXCLUDED.source_count,
    last_updated = NOW();

  GET DIAGNOSTICS parts_count = ROW_COUNT;

  -- Detect price trends
  UPDATE part_price_stats pps
  SET
    price_trend = CASE
      WHEN recent_avg > older_avg * 1.1 THEN 'rising'
      WHEN recent_avg < older_avg * 0.9 THEN 'falling'
      ELSE 'stable'
    END,
    trend_percent = CASE
      WHEN older_avg > 0 THEN ((recent_avg - older_avg) / older_avg * 100)::DECIMAL(5,2)
      ELSE 0
    END
  FROM (
    SELECT
      part_catalog_id,
      AVG(CASE WHEN observed_at > NOW() - INTERVAL '3 days' THEN price_cents END) as recent_avg,
      AVG(CASE WHEN observed_at BETWEEN NOW() - INTERVAL '7 days' AND NOW() - INTERVAL '3 days' THEN price_cents END) as older_avg
    FROM part_price_observations
    WHERE observed_at > NOW() - INTERVAL '7 days'
    GROUP BY part_catalog_id
  ) trend_data
  WHERE pps.part_catalog_id = trend_data.part_catalog_id
    AND trend_data.recent_avg IS NOT NULL
    AND trend_data.older_avg IS NOT NULL;

  RETURN QUERY SELECT
    parts_count,
    cache_count,
    EXTRACT(MILLISECONDS FROM clock_timestamp() - start_time)::INTEGER;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION manual_refresh_parts_prices() TO service_role;
GRANT EXECUTE ON FUNCTION trigger_parts_price_refresh() TO service_role;

COMMENT ON FUNCTION manual_refresh_parts_prices() IS 'Manually trigger parts price refresh and stats recalculation';
COMMENT ON FUNCTION trigger_parts_price_refresh() IS 'Trigger the edge function to refresh eBay prices (called by cron)';
