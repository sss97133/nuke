-- Intelligent Crawler System Database Schema
-- Supports advanced crawling with caching, monitoring, and algorithmic overlay

-- Create crawler cache table
CREATE TABLE IF NOT EXISTS crawler_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cache_key TEXT NOT NULL UNIQUE,
  search_params JSONB NOT NULL,
  cached_data JSONB NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  hit_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_accessed TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create crawler results table
CREATE TABLE IF NOT EXISTS crawler_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  search_params JSONB NOT NULL,
  total_listings INTEGER DEFAULT 0,
  sources TEXT[],
  market_analysis JSONB,
  crawl_metadata JSONB,
  execution_time_ms INTEGER,
  success_rate NUMERIC(5,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create crawler monitoring table
CREATE TABLE IF NOT EXISTS crawler_monitoring (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_domain TEXT NOT NULL,
  request_url TEXT,
  status_code INTEGER,
  response_time_ms INTEGER,
  success BOOLEAN DEFAULT FALSE,
  error_message TEXT,
  user_agent TEXT,
  rate_limited BOOLEAN DEFAULT FALSE,
  blocked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create crawler schedule table
CREATE TABLE IF NOT EXISTS crawler_schedule (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  search_params JSONB NOT NULL,
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('immediate', 'hourly', 'daily', 'weekly')),
  next_run TIMESTAMP WITH TIME ZONE NOT NULL,
  last_run TIMESTAMP WITH TIME ZONE,
  run_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  priority INTEGER DEFAULT 5 CHECK (priority >= 1 AND priority <= 10),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create deduplication tracking table
CREATE TABLE IF NOT EXISTS listing_deduplication (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_hash TEXT NOT NULL,
  original_listing JSONB NOT NULL,
  duplicate_count INTEGER DEFAULT 1,
  first_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  sources TEXT[],
  UNIQUE(listing_hash)
);

-- Add crawler fields to vehicles table
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_crawled TIMESTAMP WITH TIME ZONE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS crawl_frequency TEXT DEFAULT 'daily';
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS crawler_priority INTEGER DEFAULT 5;

-- Create function to schedule vehicle crawling
CREATE OR REPLACE FUNCTION schedule_vehicle_crawl(
  p_vehicle_id UUID,
  p_schedule_type TEXT DEFAULT 'daily',
  p_priority INTEGER DEFAULT 5
)
RETURNS JSONB AS $$
DECLARE
  v_record RECORD;
  next_run_time TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Get vehicle data
  SELECT year, make, model INTO v_record
  FROM vehicles
  WHERE id = p_vehicle_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vehicle not found');
  END IF;
  
  -- Calculate next run time
  next_run_time := CASE p_schedule_type
    WHEN 'immediate' THEN NOW()
    WHEN 'hourly' THEN NOW() + INTERVAL '1 hour'
    WHEN 'daily' THEN NOW() + INTERVAL '1 day'
    WHEN 'weekly' THEN NOW() + INTERVAL '1 week'
    ELSE NOW() + INTERVAL '1 day'
  END;
  
  -- Insert or update schedule
  INSERT INTO crawler_schedule (
    vehicle_id,
    search_params,
    schedule_type,
    next_run,
    priority
  )
  VALUES (
    p_vehicle_id,
    jsonb_build_object(
      'make', v_record.make,
      'model', v_record.model,
      'year', v_record.year,
      'year_start', GREATEST(v_record.year - 10, 1950),
      'year_end', LEAST(v_record.year + 10, EXTRACT(YEAR FROM NOW())::INTEGER)
    ),
    p_schedule_type,
    next_run_time,
    p_priority
  )
  ON CONFLICT (vehicle_id) DO UPDATE SET
    schedule_type = EXCLUDED.schedule_type,
    next_run = EXCLUDED.next_run,
    priority = EXCLUDED.priority,
    is_active = TRUE,
    updated_at = NOW();
  
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Crawl scheduled',
    'next_run', next_run_time,
    'schedule_type', p_schedule_type
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to process crawler queue
CREATE OR REPLACE FUNCTION process_crawler_queue(p_batch_size INTEGER DEFAULT 10)
RETURNS JSONB AS $$
DECLARE
  scheduled_crawl RECORD;
  crawl_count INTEGER := 0;
  results JSONB[] := ARRAY[]::JSONB[];
BEGIN
  -- Process pending crawls
  FOR scheduled_crawl IN
    SELECT *
    FROM crawler_schedule
    WHERE is_active = TRUE
      AND next_run <= NOW()
    ORDER BY priority DESC, next_run ASC
    LIMIT p_batch_size
  LOOP
    -- Call the intelligent crawler
    BEGIN
      PERFORM net.http_post(
        url := current_setting('app.supabase_url') || '/functions/v1/intelligent-crawler',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.service_role_key')
        ),
        body := jsonb_build_object(
          'search_params', scheduled_crawl.search_params,
          'crawler_mode', 'comprehensive',
          'force_refresh', true
        )
      );
      
      -- Update schedule for next run
      UPDATE crawler_schedule SET
        last_run = NOW(),
        run_count = run_count + 1,
        next_run = CASE schedule_type
          WHEN 'hourly' THEN NOW() + INTERVAL '1 hour'
          WHEN 'daily' THEN NOW() + INTERVAL '1 day'
          WHEN 'weekly' THEN NOW() + INTERVAL '1 week'
          ELSE NOW() + INTERVAL '1 day'
        END,
        updated_at = NOW()
      WHERE id = scheduled_crawl.id;
      
      crawl_count := crawl_count + 1;
      results := array_append(results, jsonb_build_object(
        'vehicle_id', scheduled_crawl.vehicle_id,
        'status', 'success'
      ));
      
    EXCEPTION WHEN OTHERS THEN
      -- Log error and continue
      INSERT INTO crawler_monitoring (
        source_domain, 
        error_message, 
        success,
        created_at
      ) VALUES (
        'scheduler',
        SQLERRM,
        FALSE,
        NOW()
      );
      
      results := array_append(results, jsonb_build_object(
        'vehicle_id', scheduled_crawl.vehicle_id,
        'status', 'error',
        'error', SQLERRM
      ));
    END;
  END LOOP;
  
  RETURN jsonb_build_object(
    'processed_count', crawl_count,
    'results', results,
    'processed_at', NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to monitor crawler health
CREATE OR REPLACE FUNCTION get_crawler_health()
RETURNS JSONB AS $$
DECLARE
  health_data JSONB;
  source_stats RECORD;
BEGIN
  -- Get overall stats
  WITH recent_monitoring AS (
    SELECT *
    FROM crawler_monitoring
    WHERE created_at >= NOW() - INTERVAL '24 hours'
  ),
  source_health AS (
    SELECT 
      source_domain,
      COUNT(*) as total_requests,
      COUNT(*) FILTER (WHERE success = TRUE) as successful_requests,
      COUNT(*) FILTER (WHERE rate_limited = TRUE) as rate_limited_requests,
      COUNT(*) FILTER (WHERE blocked = TRUE) as blocked_requests,
      AVG(response_time_ms) as avg_response_time,
      MAX(created_at) as last_request
    FROM recent_monitoring
    GROUP BY source_domain
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'domain', source_domain,
      'success_rate', ROUND((successful_requests::NUMERIC / total_requests * 100), 2),
      'total_requests', total_requests,
      'rate_limited', rate_limited_requests,
      'blocked', blocked_requests,
      'avg_response_time', ROUND(avg_response_time),
      'last_request', last_request,
      'health_status', CASE
        WHEN successful_requests::NUMERIC / total_requests >= 0.9 THEN 'excellent'
        WHEN successful_requests::NUMERIC / total_requests >= 0.7 THEN 'good'
        WHEN successful_requests::NUMERIC / total_requests >= 0.5 THEN 'fair'
        ELSE 'poor'
      END
    )
  ) INTO health_data
  FROM source_health;
  
  RETURN jsonb_build_object(
    'overall_health', 'operational',
    'source_health', COALESCE(health_data, '[]'::jsonb),
    'cache_stats', (
      SELECT jsonb_build_object(
        'total_entries', COUNT(*),
        'active_entries', COUNT(*) FILTER (WHERE expires_at > NOW()),
        'hit_rate', CASE 
          WHEN SUM(hit_count) > 0 THEN ROUND(AVG(hit_count), 2)
          ELSE 0
        END
      )
      FROM crawler_cache
    ),
    'queue_stats', (
      SELECT jsonb_build_object(
        'pending_crawls', COUNT(*) FILTER (WHERE next_run <= NOW() AND is_active = TRUE),
        'scheduled_crawls', COUNT(*) FILTER (WHERE is_active = TRUE),
        'total_runs', SUM(run_count)
      )
      FROM crawler_schedule
    ),
    'generated_at', NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_crawler_cache_key ON crawler_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_crawler_cache_expires ON crawler_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_crawler_results_created ON crawler_results(created_at);
CREATE INDEX IF NOT EXISTS idx_crawler_monitoring_domain ON crawler_monitoring(source_domain);
CREATE INDEX IF NOT EXISTS idx_crawler_monitoring_created ON crawler_monitoring(created_at);
CREATE INDEX IF NOT EXISTS idx_crawler_schedule_next_run ON crawler_schedule(next_run) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_crawler_schedule_vehicle ON crawler_schedule(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_listing_dedup_hash ON listing_deduplication(listing_hash);

-- Enable RLS
ALTER TABLE crawler_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawler_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawler_monitoring ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawler_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_deduplication ENABLE ROW LEVEL SECURITY;

-- RLS Policies (admin/system access)
CREATE POLICY "Admins can view crawler data" ON crawler_cache
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

CREATE POLICY "Admins can view crawler results" ON crawler_results
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

CREATE POLICY "System can access crawler monitoring" ON crawler_monitoring
  FOR ALL USING (TRUE); -- System needs full access for monitoring

CREATE POLICY "Users can view their vehicle crawl schedules" ON crawler_schedule
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM vehicles WHERE id = crawler_schedule.vehicle_id AND user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- Create automated crawler cron job
SELECT cron.schedule(
  'intelligent-crawler-processor',
  '*/15 * * * *', -- Every 15 minutes
  'SELECT process_crawler_queue(5);' -- Process 5 crawls per batch
);

-- Create cache cleanup cron job
SELECT cron.schedule(
  'crawler-cache-cleanup',
  '0 2 * * *', -- Daily at 2 AM
  'DELETE FROM crawler_cache WHERE expires_at < NOW() - INTERVAL ''7 days'';'
);

-- Create monitoring cleanup cron job
SELECT cron.schedule(
  'crawler-monitoring-cleanup',
  '0 3 * * *', -- Daily at 3 AM
  'DELETE FROM crawler_monitoring WHERE created_at < NOW() - INTERVAL ''30 days'';'
);

-- Function to trigger immediate crawl for a vehicle
CREATE OR REPLACE FUNCTION crawl_vehicle_now(p_vehicle_id UUID)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
  v_record RECORD;
BEGIN
  -- Get vehicle data
  SELECT year, make, model INTO v_record
  FROM vehicles
  WHERE id = p_vehicle_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vehicle not found');
  END IF;
  
  -- Schedule immediate crawl
  PERFORM schedule_vehicle_crawl(p_vehicle_id, 'immediate', 10);
  
  -- Call crawler directly
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/intelligent-crawler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := jsonb_build_object(
      'search_params', jsonb_build_object(
        'make', v_record.make,
        'model', v_record.model,
        'year', v_record.year,
        'year_start', GREATEST(v_record.year - 10, 1950),
        'year_end', LEAST(v_record.year + 10, EXTRACT(YEAR FROM NOW())::INTEGER)
      ),
      'crawler_mode', 'comprehensive',
      'force_refresh', true
    )
  ) INTO result;
  
  -- Update vehicle crawl timestamp
  UPDATE vehicles SET
    last_crawled = NOW(),
    updated_at = NOW()
  WHERE id = p_vehicle_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Crawl initiated',
    'vehicle_id', p_vehicle_id,
    'crawler_response', result
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get crawler statistics
CREATE OR REPLACE FUNCTION get_crawler_stats()
RETURNS JSONB AS $$
BEGIN
  RETURN jsonb_build_object(
    'cache_stats', (
      SELECT jsonb_build_object(
        'total_entries', COUNT(*),
        'active_entries', COUNT(*) FILTER (WHERE expires_at > NOW()),
        'expired_entries', COUNT(*) FILTER (WHERE expires_at <= NOW()),
        'total_hits', SUM(hit_count),
        'cache_size_mb', ROUND(SUM(LENGTH(cached_data::text))::NUMERIC / 1024 / 1024, 2)
      )
      FROM crawler_cache
    ),
    'crawl_stats', (
      SELECT jsonb_build_object(
        'total_crawls', COUNT(*),
        'avg_listings_per_crawl', ROUND(AVG(total_listings), 1),
        'avg_sources_per_crawl', ROUND(AVG(array_length(sources, 1)), 1),
        'avg_execution_time_ms', ROUND(AVG(execution_time_ms)),
        'avg_success_rate', ROUND(AVG(success_rate), 2)
      )
      FROM crawler_results
      WHERE created_at >= NOW() - INTERVAL '7 days'
    ),
    'monitoring_stats', (
      SELECT jsonb_build_object(
        'total_requests', COUNT(*),
        'success_rate', ROUND((COUNT(*) FILTER (WHERE success = TRUE)::NUMERIC / COUNT(*) * 100), 2),
        'rate_limited_rate', ROUND((COUNT(*) FILTER (WHERE rate_limited = TRUE)::NUMERIC / COUNT(*) * 100), 2),
        'blocked_rate', ROUND((COUNT(*) FILTER (WHERE blocked = TRUE)::NUMERIC / COUNT(*) * 100), 2),
        'avg_response_time', ROUND(AVG(response_time_ms))
      )
      FROM crawler_monitoring
      WHERE created_at >= NOW() - INTERVAL '24 hours'
    ),
    'queue_stats', (
      SELECT jsonb_build_object(
        'pending_crawls', COUNT(*) FILTER (WHERE next_run <= NOW() AND is_active = TRUE),
        'scheduled_crawls', COUNT(*) FILTER (WHERE is_active = TRUE),
        'high_priority', COUNT(*) FILTER (WHERE priority >= 8 AND is_active = TRUE),
        'overdue_crawls', COUNT(*) FILTER (WHERE next_run < NOW() - INTERVAL '1 hour' AND is_active = TRUE)
      )
      FROM crawler_schedule
    ),
    'generated_at', NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to clean up stale data
CREATE OR REPLACE FUNCTION cleanup_crawler_data()
RETURNS JSONB AS $$
DECLARE
  cleanup_stats JSONB;
BEGIN
  -- Clean up expired cache entries
  WITH deleted_cache AS (
    DELETE FROM crawler_cache 
    WHERE expires_at < NOW() - INTERVAL '7 days'
    RETURNING id
  ),
  -- Clean up old monitoring data
  deleted_monitoring AS (
    DELETE FROM crawler_monitoring 
    WHERE created_at < NOW() - INTERVAL '30 days'
    RETURNING id
  ),
  -- Clean up old crawler results
  deleted_results AS (
    DELETE FROM crawler_results 
    WHERE created_at < NOW() - INTERVAL '90 days'
    RETURNING id
  ),
  -- Clean up old deduplication data
  deleted_dedup AS (
    DELETE FROM listing_deduplication 
    WHERE last_seen < NOW() - INTERVAL '30 days'
    RETURNING id
  )
  SELECT jsonb_build_object(
    'cache_entries_deleted', (SELECT COUNT(*) FROM deleted_cache),
    'monitoring_entries_deleted', (SELECT COUNT(*) FROM deleted_monitoring),
    'result_entries_deleted', (SELECT COUNT(*) FROM deleted_results),
    'dedup_entries_deleted', (SELECT COUNT(*) FROM deleted_dedup),
    'cleaned_at', NOW()
  ) INTO cleanup_stats;
  
  RETURN cleanup_stats;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to auto-schedule crawling for new vehicles
CREATE OR REPLACE FUNCTION trigger_auto_schedule_crawl()
RETURNS TRIGGER AS $$
BEGIN
  -- Schedule daily crawling for new vehicles
  IF TG_OP = 'INSERT' THEN
    PERFORM schedule_vehicle_crawl(NEW.id, 'daily', 5);
  END IF;
  
  -- Reschedule if year/make/model changes
  IF TG_OP = 'UPDATE' AND (
    OLD.year IS DISTINCT FROM NEW.year OR
    OLD.make IS DISTINCT FROM NEW.make OR
    OLD.model IS DISTINCT FROM NEW.model
  ) THEN
    PERFORM schedule_vehicle_crawl(NEW.id, 'immediate', 8);
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the auto-schedule trigger
DROP TRIGGER IF EXISTS auto_schedule_crawl_trigger ON vehicles;
CREATE TRIGGER auto_schedule_crawl_trigger
  AFTER INSERT OR UPDATE ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION trigger_auto_schedule_crawl();

-- Success message
DO $$
BEGIN
  RAISE NOTICE '🕷️ Intelligent Crawler System installed!';
  RAISE NOTICE 'Features:';
  RAISE NOTICE '  • Automated scheduling and rotation';
  RAISE NOTICE '  • Rate limiting and anti-detection';
  RAISE NOTICE '  • Intelligent caching and deduplication';
  RAISE NOTICE '  • Real-time monitoring and health checks';
  RAISE NOTICE '  • Algorithmic overlay for data processing';
  RAISE NOTICE '';
  RAISE NOTICE 'Cron jobs scheduled:';
  RAISE NOTICE '  • Crawler processor: Every 15 minutes';
  RAISE NOTICE '  • Cache cleanup: Daily at 2 AM';
  RAISE NOTICE '  • Monitoring cleanup: Daily at 3 AM';
END$$;