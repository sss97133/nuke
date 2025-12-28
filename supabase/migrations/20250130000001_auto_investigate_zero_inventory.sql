-- ============================================================================
-- AUTO-INVESTIGATE ORGANIZATIONS WITH ZERO INVENTORY
-- ============================================================================
-- When an organization has zero inventory, automatically queue it for 
-- thorough investigation and extraction (especially easy targets)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ============================================================================
-- Function: Auto-queue organizations with zero inventory for investigation
-- ============================================================================
CREATE OR REPLACE FUNCTION auto_queue_zero_inventory_orgs()
RETURNS TABLE (
  queued_count INTEGER,
  sample_orgs JSONB
) AS $$
DECLARE
  v_queued INTEGER := 0;
  v_sample JSONB;
BEGIN
  -- Find organizations with zero inventory that aren't already queued
  WITH zero_inventory_orgs AS (
    SELECT 
      b.id,
      b.business_name,
      b.website,
      b.business_type,
      b.created_at,
      -- Prioritize "easy targets":
      -- 1. Have website (required)
      -- 2. Created more than 1 hour ago (not brand new, give it time)
      -- 3. Not already queued
      CASE 
        WHEN b.website IS NOT NULL 
          AND b.website != '' 
          AND b.created_at < NOW() - INTERVAL '1 hour'
          AND NOT EXISTS (
            SELECT 1 FROM organization_inventory_sync_queue q 
            WHERE q.organization_id = b.id 
            AND q.run_mode = 'both'
            AND q.status NOT IN ('failed', 'skipped')
          )
        THEN 1 
        ELSE 0 
      END as should_queue
    FROM businesses b
    WHERE b.is_public = true
      AND b.website IS NOT NULL
      AND b.website != ''
      -- Zero active vehicles
      AND (
        SELECT COUNT(*) 
        FROM organization_vehicles ov 
        WHERE ov.organization_id = b.id 
        AND ov.status = 'active'
      ) = 0
      -- Not already queued (or was failed/skipped)
      AND NOT EXISTS (
        SELECT 1 FROM organization_inventory_sync_queue q
        WHERE q.organization_id = b.id
        AND q.run_mode = 'both'
        AND q.status IN ('pending', 'processing', 'completed')
      )
    ORDER BY 
      -- Prioritize dealers (easier targets)
      CASE WHEN b.business_type = 'dealership' THEN 1 ELSE 2 END,
      b.created_at ASC
    LIMIT 50 -- Process in batches
  )
  INSERT INTO organization_inventory_sync_queue (
    organization_id,
    run_mode,
    status,
    attempts,
    created_at,
    updated_at
  )
  SELECT 
    id,
    'both'::text, -- Extract both current and sold inventory
    'pending',
    0,
    NOW(),
    NOW()
  FROM zero_inventory_orgs
  WHERE should_queue = 1
  ON CONFLICT (organization_id, run_mode) DO NOTHING;
  
  GET DIAGNOSTICS v_queued = ROW_COUNT;
  
  -- Get sample of queued orgs
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', id,
      'name', business_name,
      'website', website,
      'type', business_type
    )
  )
  INTO v_sample
  FROM (
    SELECT id, business_name, website, business_type
    FROM businesses
    WHERE id IN (
      SELECT organization_id 
      FROM organization_inventory_sync_queue 
      WHERE status = 'pending' 
      AND run_mode = 'both'
      ORDER BY created_at DESC
      LIMIT 10
    )
  ) subq;
  
  RETURN QUERY SELECT v_queued, COALESCE(v_sample, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Cron Job: Auto-investigate zero inventory orgs (every 30 minutes)
-- ============================================================================
SELECT cron.unschedule('auto-investigate-zero-inventory') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'auto-investigate-zero-inventory'
);

SELECT cron.schedule(
  'auto-investigate-zero-inventory',
  '*/30 * * * *', -- Every 30 minutes
  $$
  -- Auto-queue organizations with zero inventory
  SELECT auto_queue_zero_inventory_orgs();
  
  -- Also trigger the bulk enqueue function for comprehensive coverage
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/bulk-enqueue-inventory-extraction',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        current_setting('app.settings.service_role_key', true),
        current_setting('app.service_role_key', true)
      )
    ),
    body := jsonb_build_object(
      'run_mode', 'both',
      'min_inventory_threshold', 1, -- Only queue orgs with ZERO vehicles
      'only_with_website', true,
      'limit', 100,
      'requeue_failed', false -- Don't requeue failed ones automatically
    ),
    timeout_milliseconds := 60000
  ) AS request_id;
  $$
);

-- ============================================================================
-- Trigger: Auto-queue when org is created/updated with zero inventory
-- ============================================================================
CREATE OR REPLACE FUNCTION trigger_investigate_zero_inventory()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if org has zero inventory and a website
  IF NEW.website IS NOT NULL 
     AND NEW.website != ''
     AND NEW.is_public = true
     AND (
       SELECT COUNT(*) 
       FROM organization_vehicles 
       WHERE organization_id = NEW.id 
       AND status = 'active'
     ) = 0
  THEN
    -- Queue for investigation (async, don't block)
    INSERT INTO organization_inventory_sync_queue (
      organization_id,
      run_mode,
      status,
      attempts,
      created_at,
      updated_at
    )
    VALUES (
      NEW.id,
      'both',
      'pending',
      0,
      NOW(),
      NOW()
    )
    ON CONFLICT (organization_id, run_mode) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on businesses table
DROP TRIGGER IF EXISTS businesses_auto_investigate_zero_inventory ON businesses;

CREATE TRIGGER businesses_auto_investigate_zero_inventory
  AFTER INSERT OR UPDATE OF website, is_public ON businesses
  FOR EACH ROW
  WHEN (NEW.is_public = true AND NEW.website IS NOT NULL AND NEW.website != '')
  EXECUTE FUNCTION trigger_investigate_zero_inventory();

-- ============================================================================
-- Grant permissions
-- ============================================================================
GRANT EXECUTE ON FUNCTION auto_queue_zero_inventory_orgs() TO postgres, anon, authenticated, service_role;

