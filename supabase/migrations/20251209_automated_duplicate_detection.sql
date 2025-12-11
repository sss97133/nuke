-- Automated Duplicate Detection System
-- This creates triggers and functions to automatically run duplicate detection when vehicles are created/updated

-- Function to trigger duplicate detection for a vehicle
CREATE OR REPLACE FUNCTION trigger_duplicate_detection()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Only run duplicate detection for new vehicles (not updates)
  IF TG_OP = 'INSERT' THEN
    -- Schedule duplicate detection job to run asynchronously
    -- This prevents blocking the vehicle creation process
    INSERT INTO duplicate_detection_jobs (
      vehicle_id,
      status,
      scheduled_at,
      priority
    ) VALUES (
      NEW.id,
      'pending',
      NOW() + INTERVAL '30 seconds', -- Run 30 seconds after creation to allow image processing
      CASE
        WHEN NEW.images_count > 0 THEN 'high'
        ELSE 'medium'
      END
    );

    -- Log the job creation
    INSERT INTO system_logs (
      log_level,
      module,
      message,
      metadata
    ) VALUES (
      'info',
      'duplicate_detection',
      'Scheduled duplicate detection job for vehicle',
      jsonb_build_object(
        'vehicle_id', NEW.id,
        'vin', NEW.vin,
        'images_count', NEW.images_count
      )
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Job queue table for duplicate detection
CREATE TABLE IF NOT EXISTS duplicate_detection_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
  scheduled_at TIMESTAMP DEFAULT now(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  priority VARCHAR(10) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  error_message TEXT,
  results JSONB, -- Store detection results
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- System logs table for tracking operations
CREATE TABLE IF NOT EXISTS system_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  log_level VARCHAR(10) NOT NULL CHECK (log_level IN ('debug', 'info', 'warn', 'error')),
  module VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT now()
);

-- Create the trigger for automatic duplicate detection
CREATE TRIGGER trigger_auto_duplicate_detection
    AFTER INSERT ON vehicles
    FOR EACH ROW
    EXECUTE FUNCTION trigger_duplicate_detection();

-- Function to process duplicate detection jobs
CREATE OR REPLACE FUNCTION process_duplicate_detection_job(job_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  job_record RECORD;
  vehicle_record RECORD;
  detection_results JSONB;
  match_count INTEGER;
BEGIN
  -- Get job details
  SELECT * INTO job_record FROM duplicate_detection_jobs WHERE id = job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found: %', job_id;
  END IF;

  -- Mark job as processing
  UPDATE duplicate_detection_jobs
  SET status = 'processing', started_at = NOW(), updated_at = NOW()
  WHERE id = job_id;

  -- Get vehicle details
  SELECT * INTO vehicle_record FROM vehicles WHERE id = job_record.vehicle_id;

  -- Skip if vehicle has no images
  IF vehicle_record.images_count = 0 OR vehicle_record.images_count IS NULL THEN
    UPDATE duplicate_detection_jobs
    SET
      status = 'skipped',
      completed_at = NOW(),
      updated_at = NOW(),
      results = jsonb_build_object('reason', 'no_images', 'images_count', COALESCE(vehicle_record.images_count, 0))
    WHERE id = job_id;

    RETURN TRUE;
  END IF;

  -- Call the detection function
  SELECT jsonb_agg(
    jsonb_build_object(
      'duplicate_id', duplicate_id,
      'confidence', confidence,
      'method', method,
      'evidence', evidence
    )
  ) INTO detection_results
  FROM detect_vehicle_duplicates(job_record.vehicle_id);

  -- Count matches above threshold (70% confidence)
  SELECT COUNT(*) INTO match_count
  FROM jsonb_array_elements(detection_results) AS elem
  WHERE (elem->>'confidence')::decimal >= 0.7;

  -- Save detection results to database
  IF detection_results IS NOT NULL AND jsonb_array_length(detection_results) > 0 THEN
    -- Insert duplicate detection records
    INSERT INTO duplicate_detections (
      original_vehicle_id,
      duplicate_vehicle_id,
      detection_method,
      confidence_score,
      evidence,
      status
    )
    SELECT
      job_record.vehicle_id,
      (elem->>'duplicate_id')::uuid,
      elem->>'method',
      (elem->>'confidence')::decimal,
      elem->'evidence',
      CASE
        WHEN (elem->>'confidence')::decimal >= 0.9 THEN 'pending'
        WHEN (elem->>'confidence')::decimal >= 0.7 THEN 'pending'
        ELSE 'pending'
      END
    FROM jsonb_array_elements(detection_results) AS elem
    ON CONFLICT (original_vehicle_id, duplicate_vehicle_id) DO UPDATE SET
      confidence_score = EXCLUDED.confidence_score,
      evidence = EXCLUDED.evidence,
      updated_at = NOW();

    -- Send notifications for high-confidence matches
    PERFORM notify_duplicate_detection(
      job_record.vehicle_id,
      (elem->>'duplicate_id')::uuid,
      (elem->>'confidence')::decimal,
      elem->'evidence'
    )
    FROM jsonb_array_elements(detection_results) AS elem
    WHERE (elem->>'confidence')::decimal >= 0.7;
  END IF;

  -- Mark job as completed
  UPDATE duplicate_detection_jobs
  SET
    status = 'completed',
    completed_at = NOW(),
    updated_at = NOW(),
    results = jsonb_build_object(
      'total_matches', COALESCE(jsonb_array_length(detection_results), 0),
      'high_confidence_matches', match_count,
      'detections', detection_results
    )
  WHERE id = job_id;

  -- Log completion
  INSERT INTO system_logs (
    log_level,
    module,
    message,
    metadata
  ) VALUES (
    'info',
    'duplicate_detection',
    'Completed duplicate detection job',
    jsonb_build_object(
      'job_id', job_id,
      'vehicle_id', job_record.vehicle_id,
      'total_matches', COALESCE(jsonb_array_length(detection_results), 0),
      'high_confidence_matches', match_count
    )
  );

  RETURN TRUE;

EXCEPTION WHEN OTHERS THEN
  -- Mark job as failed and log error
  UPDATE duplicate_detection_jobs
  SET
    status = 'failed',
    completed_at = NOW(),
    updated_at = NOW(),
    error_message = SQLERRM,
    retry_count = retry_count + 1
  WHERE id = job_id;

  INSERT INTO system_logs (
    log_level,
    module,
    message,
    metadata
  ) VALUES (
    'error',
    'duplicate_detection',
    'Failed duplicate detection job',
    jsonb_build_object(
      'job_id', job_id,
      'vehicle_id', job_record.vehicle_id,
      'error', SQLERRM,
      'retry_count', job_record.retry_count + 1
    )
  );

  RETURN FALSE;
END;
$$;

-- Function to retry failed jobs
CREATE OR REPLACE FUNCTION retry_failed_duplicate_detection_jobs()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  retry_count INTEGER := 0;
  job_record RECORD;
BEGIN
  -- Find failed jobs that haven't exceeded max retries
  FOR job_record IN
    SELECT id FROM duplicate_detection_jobs
    WHERE status = 'failed'
    AND retry_count < max_retries
    AND completed_at < NOW() - INTERVAL '1 hour'
    ORDER BY priority DESC, created_at ASC
    LIMIT 10
  LOOP
    -- Reset job status to pending for retry
    UPDATE duplicate_detection_jobs
    SET
      status = 'pending',
      scheduled_at = NOW() + INTERVAL '5 minutes',
      started_at = NULL,
      completed_at = NULL,
      error_message = NULL,
      updated_at = NOW()
    WHERE id = job_record.id;

    retry_count := retry_count + 1;
  END LOOP;

  RETURN retry_count;
END;
$$;

-- Function to get pending jobs for processing
CREATE OR REPLACE FUNCTION get_pending_duplicate_detection_jobs(limit_count INTEGER DEFAULT 5)
RETURNS TABLE (
  job_id UUID,
  vehicle_id UUID,
  priority VARCHAR(10),
  scheduled_at TIMESTAMP,
  retry_count INTEGER
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    ddj.id,
    ddj.vehicle_id,
    ddj.priority,
    ddj.scheduled_at,
    ddj.retry_count
  FROM duplicate_detection_jobs ddj
  WHERE ddj.status = 'pending'
  AND ddj.scheduled_at <= NOW()
  ORDER BY
    CASE ddj.priority
      WHEN 'urgent' THEN 1
      WHEN 'high' THEN 2
      WHEN 'medium' THEN 3
      WHEN 'low' THEN 4
    END,
    ddj.scheduled_at ASC
  LIMIT limit_count;
END;
$$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_duplicate_detection_jobs_status ON duplicate_detection_jobs(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_duplicate_detection_jobs_priority ON duplicate_detection_jobs(priority, status);
CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON system_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_system_logs_module_level ON system_logs(module, log_level);

-- Enable RLS
ALTER TABLE duplicate_detection_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies (admin access only)
CREATE POLICY "Admin access to duplicate detection jobs" ON duplicate_detection_jobs
FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

CREATE POLICY "Admin access to system logs" ON system_logs
FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- Comments
COMMENT ON TABLE duplicate_detection_jobs IS 'Job queue for automated duplicate detection processing';
COMMENT ON TABLE system_logs IS 'System operation logs for debugging and monitoring';
COMMENT ON FUNCTION trigger_duplicate_detection() IS 'Trigger function to schedule duplicate detection jobs for new vehicles';
COMMENT ON FUNCTION process_duplicate_detection_job(UUID) IS 'Process a single duplicate detection job';
COMMENT ON FUNCTION get_pending_duplicate_detection_jobs(INTEGER) IS 'Get pending jobs for processing by worker';