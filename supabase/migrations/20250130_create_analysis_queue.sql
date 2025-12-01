-- Analysis Queue System for Bulletproof AI Analysis
-- Tracks all analysis requests, retries, and failures

CREATE TABLE IF NOT EXISTS public.analysis_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  analysis_type TEXT NOT NULL DEFAULT 'expert_valuation' CHECK (analysis_type IN ('expert_valuation', 'image_analysis', 'condition_assessment')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'retrying')),
  priority INTEGER DEFAULT 5 CHECK (priority BETWEEN 1 AND 10), -- 1 = highest, 10 = lowest
  llm_provider TEXT CHECK (llm_provider IN ('openai', 'anthropic', 'google')),
  llm_model TEXT,
  analysis_tier TEXT CHECK (analysis_tier IN ('tier1', 'tier2', 'tier3', 'expert')),
  analysis_config JSONB, -- Store full config for transparency
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  last_attempt_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  error_message TEXT,
  error_details JSONB,
  triggered_by TEXT, -- 'user', 'auto', 'cron', 'trigger'
  triggered_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  result_id UUID, -- ID of resulting valuation/analysis record
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queue processing
CREATE INDEX IF NOT EXISTS idx_analysis_queue_status ON public.analysis_queue(status, priority, next_retry_at) WHERE status IN ('pending', 'retrying');
CREATE INDEX IF NOT EXISTS idx_analysis_queue_vehicle ON public.analysis_queue(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_analysis_queue_retry ON public.analysis_queue(next_retry_at) WHERE status = 'retrying';
CREATE INDEX IF NOT EXISTS idx_analysis_queue_created ON public.analysis_queue(created_at);

-- Function to queue analysis request
CREATE OR REPLACE FUNCTION queue_analysis(
  p_vehicle_id UUID,
  p_analysis_type TEXT DEFAULT 'expert_valuation',
  p_priority INTEGER DEFAULT 5,
  p_triggered_by TEXT DEFAULT 'auto',
  p_llm_provider TEXT DEFAULT NULL,
  p_llm_model TEXT DEFAULT NULL,
  p_analysis_tier TEXT DEFAULT NULL,
  p_analysis_config JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_queue_id UUID;
  v_existing_id UUID;
BEGIN
  -- Check if there's already a pending/processing analysis for this vehicle
  SELECT id INTO v_existing_id
  FROM public.analysis_queue
  WHERE vehicle_id = p_vehicle_id
    AND analysis_type = p_analysis_type
    AND status IN ('pending', 'processing', 'retrying')
  ORDER BY created_at DESC
  LIMIT 1;
  
  -- If exists, return existing ID (don't duplicate)
  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;
  
  -- Create new queue entry
  INSERT INTO public.analysis_queue (
    vehicle_id,
    analysis_type,
    priority,
    triggered_by,
    status,
    llm_provider,
    llm_model,
    analysis_tier,
    analysis_config
  ) VALUES (
    p_vehicle_id,
    p_analysis_type,
    p_priority,
    p_triggered_by,
    'pending',
    p_llm_provider,
    p_llm_model,
    p_analysis_tier,
    p_analysis_config
  ) RETURNING id INTO v_queue_id;
  
  RETURN v_queue_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get next batch of analyses to process
CREATE OR REPLACE FUNCTION get_analysis_batch(
  p_batch_size INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  vehicle_id UUID,
  analysis_type TEXT,
  priority INTEGER,
  retry_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    aq.id,
    aq.vehicle_id,
    aq.analysis_type,
    aq.priority,
    aq.retry_count
  FROM public.analysis_queue aq
  WHERE aq.status IN ('pending', 'retrying')
    AND (aq.next_retry_at IS NULL OR aq.next_retry_at <= NOW())
  ORDER BY 
    aq.priority ASC, -- Higher priority first
    aq.created_at ASC -- Older requests first
  LIMIT p_batch_size
  FOR UPDATE SKIP LOCKED; -- Prevent concurrent processing
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to mark analysis as processing
CREATE OR REPLACE FUNCTION mark_analysis_processing(p_queue_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.analysis_queue
  SET 
    status = 'processing',
    last_attempt_at = NOW(),
    updated_at = NOW()
  WHERE id = p_queue_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to mark analysis as completed
CREATE OR REPLACE FUNCTION mark_analysis_completed(
  p_queue_id UUID,
  p_result_id UUID DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE public.analysis_queue
  SET 
    status = 'completed',
    completed_at = NOW(),
    result_id = p_result_id,
    updated_at = NOW()
  WHERE id = p_queue_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to mark analysis as failed (with retry logic)
CREATE OR REPLACE FUNCTION mark_analysis_failed(
  p_queue_id UUID,
  p_error_message TEXT,
  p_error_details JSONB DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_retry_count INTEGER;
  v_max_retries INTEGER;
  v_next_retry_at TIMESTAMPTZ;
BEGIN
  -- Get current retry info
  SELECT retry_count, max_retries INTO v_retry_count, v_max_retries
  FROM public.analysis_queue
  WHERE id = p_queue_id;
  
  v_retry_count := COALESCE(v_retry_count, 0) + 1;
  
  -- Check if we should retry
  IF v_retry_count < v_max_retries THEN
    -- Exponential backoff: 1min, 5min, 15min, 30min
    v_next_retry_at := NOW() + (
      CASE v_retry_count
        WHEN 1 THEN INTERVAL '1 minute'
        WHEN 2 THEN INTERVAL '5 minutes'
        WHEN 3 THEN INTERVAL '15 minutes'
        ELSE INTERVAL '30 minutes'
      END
    );
    
    UPDATE public.analysis_queue
    SET 
      status = 'retrying',
      retry_count = v_retry_count,
      next_retry_at = v_next_retry_at,
      error_message = p_error_message,
      error_details = p_error_details,
      updated_at = NOW()
    WHERE id = p_queue_id;
  ELSE
    -- Max retries reached, mark as failed
    UPDATE public.analysis_queue
    SET 
      status = 'failed',
      retry_count = v_retry_count,
      error_message = p_error_message,
      error_details = p_error_details,
      updated_at = NOW()
    WHERE id = p_queue_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get analysis status for a vehicle
CREATE OR REPLACE FUNCTION get_analysis_status(p_vehicle_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_status JSONB;
BEGIN
  SELECT jsonb_build_object(
    'has_pending', EXISTS(SELECT 1 FROM public.analysis_queue WHERE vehicle_id = p_vehicle_id AND status IN ('pending', 'processing', 'retrying')),
    'has_completed', EXISTS(SELECT 1 FROM public.analysis_queue WHERE vehicle_id = p_vehicle_id AND status = 'completed'),
    'has_failed', EXISTS(SELECT 1 FROM public.analysis_queue WHERE vehicle_id = p_vehicle_id AND status = 'failed'),
    'latest_status', (
      SELECT status
      FROM public.analysis_queue
      WHERE vehicle_id = p_vehicle_id
      ORDER BY created_at DESC
      LIMIT 1
    ),
    'queue_position', (
      SELECT COUNT(*) + 1
      FROM public.analysis_queue
      WHERE status IN ('pending', 'retrying')
        AND (
          priority < (SELECT priority FROM public.analysis_queue WHERE vehicle_id = p_vehicle_id AND status IN ('pending', 'retrying') ORDER BY created_at DESC LIMIT 1)
          OR (
            priority = (SELECT priority FROM public.analysis_queue WHERE vehicle_id = p_vehicle_id AND status IN ('pending', 'retrying') ORDER BY created_at DESC LIMIT 1)
            AND created_at < (SELECT created_at FROM public.analysis_queue WHERE vehicle_id = p_vehicle_id AND status IN ('pending', 'retrying') ORDER BY created_at DESC LIMIT 1)
          )
        )
    ),
    'retry_count', (
      SELECT retry_count
      FROM public.analysis_queue
      WHERE vehicle_id = p_vehicle_id
      ORDER BY created_at DESC
      LIMIT 1
    ),
    'next_retry_at', (
      SELECT next_retry_at
      FROM public.analysis_queue
      WHERE vehicle_id = p_vehicle_id
      ORDER BY created_at DESC
      LIMIT 1
    )
  ) INTO v_status;
  
  RETURN v_status;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS Policies
ALTER TABLE public.analysis_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their vehicle analyses"
  ON public.analysis_queue FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.vehicles
      WHERE vehicles.id = analysis_queue.vehicle_id
        AND (vehicles.uploaded_by = auth.uid() OR vehicles.user_id = auth.uid())
    )
  );

CREATE POLICY "System can manage analysis queue"
  ON public.analysis_queue FOR ALL
  USING (true) -- Service role can do everything
  WITH CHECK (true);

COMMENT ON TABLE public.analysis_queue IS 'Queue system for AI analysis requests with automatic retry and failure handling';
COMMENT ON FUNCTION queue_analysis IS 'Queue a new analysis request (prevents duplicates)';
COMMENT ON FUNCTION get_analysis_batch IS 'Get next batch of analyses to process (with locking)';
COMMENT ON FUNCTION mark_analysis_processing IS 'Mark analysis as currently processing';
COMMENT ON FUNCTION mark_analysis_completed IS 'Mark analysis as successfully completed';
COMMENT ON FUNCTION mark_analysis_failed IS 'Mark analysis as failed with automatic retry logic';
COMMENT ON FUNCTION get_analysis_status IS 'Get current analysis status for a vehicle';

