-- Setup cron job to process analysis queue every 5 minutes

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Note: The cron job will be set up manually via Supabase dashboard or CLI
-- This is because we need the actual Supabase URL and service role key
-- which are environment-specific

-- Alternative: Use Supabase Edge Function scheduler or external cron service
-- For now, the queue can be processed manually or via the edge function directly

-- Function to manually trigger queue processing (for testing)
CREATE OR REPLACE FUNCTION trigger_queue_processing()
RETURNS TEXT AS $$
BEGIN
  -- This would call the edge function, but requires http extension setup
  -- For now, returns instruction to call via API
  RETURN 'Queue processing should be triggered via: POST /functions/v1/process-analysis-queue with body: {"batchSize": 10}';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trigger_queue_processing IS 'Manual trigger for queue processing - use edge function directly or set up cron via Supabase dashboard';

-- Also schedule a cleanup job to remove old completed/failed analyses (older than 30 days)
SELECT cron.schedule(
  'cleanup-analysis-queue',
  '0 3 * * *', -- Daily at 3 AM
  $$
  DELETE FROM analysis_queue
  WHERE status IN ('completed', 'failed')
    AND completed_at < NOW() - INTERVAL '30 days';
  $$
);

COMMENT ON TABLE analysis_queue IS 'Analysis queue with automatic retry and cleanup';

