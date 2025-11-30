-- Add BaT scraping schedule and extend admin notifications for scraping alerts

-- Extend admin_notifications to support BaT scraping notifications
ALTER TABLE admin_notifications 
  DROP CONSTRAINT IF EXISTS admin_notifications_notification_type_check;

ALTER TABLE admin_notifications
  ADD CONSTRAINT admin_notifications_notification_type_check
  CHECK (notification_type IN (
    'ownership_verification_pending',
    'vehicle_verification_pending', 
    'user_verification_pending',
    'fraud_alert',
    'system_alert',
    'bat_scrape_error',
    'bat_scrape_complete'
  ));

-- Add BaT scraping job tracking table
CREATE TABLE IF NOT EXISTS bat_scrape_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_type TEXT NOT NULL DEFAULT 'full_scrape' CHECK (job_type IN ('full_scrape', 'incremental', 'comments_only')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  
  -- Job details
  listings_found INTEGER DEFAULT 0,
  listings_scraped INTEGER DEFAULT 0,
  comments_extracted INTEGER DEFAULT 0,
  users_created INTEGER DEFAULT 0,
  vehicles_matched INTEGER DEFAULT 0,
  
  -- Timing
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  
  -- Error tracking
  error_message TEXT,
  error_stack TEXT,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bat_scrape_jobs_status ON bat_scrape_jobs(status);
CREATE INDEX IF NOT EXISTS idx_bat_scrape_jobs_created ON bat_scrape_jobs(created_at DESC);

-- Function to create admin notification for BaT scrape errors
CREATE OR REPLACE FUNCTION notify_admin_bat_scrape_error(
  p_error_message TEXT,
  p_error_details JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID AS $$
DECLARE
  v_notification_id UUID;
BEGIN
  INSERT INTO admin_notifications (
    notification_type,
    title,
    message,
    priority,
    action_required,
    status,
    metadata
  ) VALUES (
    'bat_scrape_error',
    'BaT Scraping Error',
    p_error_message,
    4, -- High priority
    'system_action',
    'pending',
    jsonb_build_object(
      'error_details', p_error_details,
      'created_at', NOW()
    )
  )
  RETURNING id INTO v_notification_id;
  
  RETURN v_notification_id;
END;
$$ LANGUAGE plpgsql;

-- Function to create admin notification for BaT scrape completion
CREATE OR REPLACE FUNCTION notify_admin_bat_scrape_complete(
  p_listings_found INTEGER,
  p_listings_scraped INTEGER,
  p_comments_extracted INTEGER,
  p_vehicles_matched INTEGER
)
RETURNS UUID AS $$
DECLARE
  v_notification_id UUID;
BEGIN
  INSERT INTO admin_notifications (
    notification_type,
    title,
    message,
    priority,
    action_required,
    status,
    metadata
  ) VALUES (
    'bat_scrape_complete',
    'BaT Scraping Complete',
    format('Scraped %s listings, extracted %s comments, matched %s vehicles', 
           p_listings_scraped, p_comments_extracted, p_vehicles_matched),
    1, -- Low priority (success)
    'system_action',
    'pending',
    jsonb_build_object(
      'listings_found', p_listings_found,
      'listings_scraped', p_listings_scraped,
      'comments_extracted', p_comments_extracted,
      'vehicles_matched', p_vehicles_matched,
      'completed_at', NOW()
    )
  )
  RETURNING id INTO v_notification_id;
  
  RETURN v_notification_id;
END;
$$ LANGUAGE plpgsql;

-- Schedule evening scrape (runs daily at 8 PM PST / 11 PM EST)
-- Note: This requires pg_cron extension to be enabled
-- To enable: ALTER EXTENSION pg_cron SET SCHEMA extensions;
-- Then run: SELECT cron.schedule('bat-evening-scrape', '0 20 * * *', $$SELECT net.http_post(...)$$);

COMMENT ON TABLE bat_scrape_jobs IS 'Tracks BaT scraping job execution and results';
COMMENT ON FUNCTION notify_admin_bat_scrape_error IS 'Creates admin notification for BaT scraping errors';
COMMENT ON FUNCTION notify_admin_bat_scrape_complete IS 'Creates admin notification for successful BaT scraping';


