-- Overnight Extraction Pulse + BaT extraction queue locking
-- Goal: run extractors all night on our targets (Classic sellers → inventory sync → import queue → BaT deep extraction),
-- safely (no overlapping double-work) and without hardcoding secrets in cron jobs.
--
-- NOTES:
-- - Uses CREATE/ALTER IF NOT EXISTS shims so `supabase db reset` stays clean.
-- - Uses `current_setting(..., true)` so the service role key is NOT stored in the migration or cron text.
--   You must set it once in Supabase Database settings:
--     ALTER DATABASE postgres SET app.settings.service_role_key = '<service_role_jwt_or_key>';
-- - Cron schedules use the database timezone (often UTC).

-- ============================================================================
-- 1) BaT extraction queue: add locking + claim RPC (concurrency-safe)
-- ============================================================================

-- Ensure the queue table exists (older migrations create it; keep this safe)
CREATE TABLE IF NOT EXISTS public.bat_extraction_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
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

-- Add concurrency/backoff columns (idempotent)
ALTER TABLE public.bat_extraction_queue ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;
ALTER TABLE public.bat_extraction_queue ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
ALTER TABLE public.bat_extraction_queue ADD COLUMN IF NOT EXISTS locked_by TEXT;
ALTER TABLE public.bat_extraction_queue ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_bat_extraction_queue_status_priority
  ON public.bat_extraction_queue(status, priority DESC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_bat_extraction_queue_next_attempt
  ON public.bat_extraction_queue(status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS idx_bat_extraction_queue_locked_at
  ON public.bat_extraction_queue(locked_at);

-- Updated-at trigger (best-effort; safe if it already exists elsewhere)
CREATE OR REPLACE FUNCTION public.update_bat_extraction_queue_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_bat_extraction_queue_updated_at ON public.bat_extraction_queue;
CREATE TRIGGER trg_update_bat_extraction_queue_updated_at
  BEFORE UPDATE ON public.bat_extraction_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.update_bat_extraction_queue_updated_at();

-- Claim RPC: atomically claim work for concurrent processors
CREATE OR REPLACE FUNCTION public.claim_bat_extraction_queue_batch(
  p_batch_size INTEGER DEFAULT 10,
  p_max_attempts INTEGER DEFAULT 3,
  p_worker_id TEXT DEFAULT NULL,
  p_lock_ttl_seconds INTEGER DEFAULT 900
)
RETURNS SETOF public.bat_extraction_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_lock_ttl INTERVAL := make_interval(secs => GREATEST(30, LEAST(COALESCE(p_lock_ttl_seconds, 900), 3600)));
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT q.id
    FROM public.bat_extraction_queue q
    WHERE q.status = 'pending'
      AND COALESCE(q.attempts, 0) < COALESCE(p_max_attempts, 3)
      AND (q.next_attempt_at IS NULL OR q.next_attempt_at <= v_now)
      AND (
        q.locked_at IS NULL OR
        q.locked_at < (v_now - v_lock_ttl)
      )
    ORDER BY
      COALESCE(q.priority, 0) DESC,
      q.created_at ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_batch_size, 10), 200))
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.bat_extraction_queue q
    SET
      status = 'processing',
      attempts = COALESCE(q.attempts, 0) + 1,
      locked_at = v_now,
      locked_by = COALESCE(p_worker_id, 'unknown'),
      last_attempt_at = v_now
    WHERE q.id IN (SELECT id FROM candidates)
    RETURNING q.*
  )
  SELECT * FROM claimed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_bat_extraction_queue_batch(INTEGER, INTEGER, TEXT, INTEGER) TO authenticated;

COMMENT ON FUNCTION public.claim_bat_extraction_queue_batch IS 'Atomically claims a batch of BaT extraction queue rows for concurrent processors.';

-- ============================================================================
-- 2) Cron: overnight pulse (runs extractors all night)
-- ============================================================================

-- Enable pg_cron if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove existing job if it exists
SELECT cron.unschedule('overnight-extraction-pulse') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'overnight-extraction-pulse'
);

-- Runs every 5 minutes during "night hours" (db timezone):
-- - 20:00–23:59 and 00:00–07:59
-- If you want a different window, adjust the hour field below.
SELECT cron.schedule(
  'overnight-extraction-pulse',
  '*/5 20-23,0-7 * * *',
  $$
  -- Classic seller indexing pipeline (if enabled): pending sellers -> businesses -> inventory sync queue
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-classic-seller-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        current_setting('app.settings.service_role_key', true),
        current_setting('app.service_role_key', true)
      )
    ),
    body := jsonb_build_object(
      'batch_size', 20,
      'max_attempts', 5,
      'reprocess_failed', false
    ),
    timeout_milliseconds := 60000
  ) AS request_id;

  -- Inventory sync queue: calls scrape-multi-source for org inventories (Classic + dealer websites)
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-inventory-sync-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        current_setting('app.settings.service_role_key', true),
        current_setting('app.service_role_key', true)
      )
    ),
    body := jsonb_build_object(
      'batch_size', 10,
      'max_attempts', 10,
      'max_results', 250,
      'max_results_sold', 250
    ),
    timeout_milliseconds := 120000
  ) AS request_id;

  -- Import queue: turns discovered listing URLs into vehicles (+ images) with robust locking
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-import-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        current_setting('app.settings.service_role_key', true),
        current_setting('app.service_role_key', true)
      )
    ),
    body := jsonb_build_object(
      'batch_size', 40,
      'priority_only', false,
      'fast_mode', true,
      'skip_image_upload', false
    ),
    timeout_milliseconds := 120000
  ) AS request_id;

  -- BaT deep extraction queue: fills missing comments/features/end dates for BaT vehicles
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-bat-extraction-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        current_setting('app.settings.service_role_key', true),
        current_setting('app.service_role_key', true)
      )
    ),
    body := jsonb_build_object(
      'batchSize', 10,
      'maxAttempts', 3
    ),
    timeout_milliseconds := 120000
  ) AS request_id;

  -- BaT grinder: keeps seeding BaT live auctions + importing listing pages
  -- Uses tiny per-invocation work and self-invokes to continue. Safe to call frequently.
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/go-grinder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        current_setting('app.settings.service_role_key', true),
        current_setting('app.service_role_key', true)
      )
    ),
    body := jsonb_build_object(
      'chain_depth', 6,
      'seed_every', 1,
      'bat_import_batch', 1,
      'max_listings', 250
    ),
    timeout_milliseconds := 60000
  ) AS request_id;
  $$
);

-- Separate hourly discovery of Classic sellers (fills classic_seller_queue)
SELECT cron.unschedule('overnight-discover-classic-sellers') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'overnight-discover-classic-sellers'
);

SELECT cron.schedule(
  'overnight-discover-classic-sellers',
  '0 20-23,0-7 * * *',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/discover-classic-sellers',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        current_setting('app.settings.service_role_key', true),
        current_setting('app.service_role_key', true)
      )
    ),
    body := jsonb_build_object(
      'filter', 'all',
      'start_page', 1,
      'max_pages', 5,
      'sleep_ms', 350
    ),
    timeout_milliseconds := 120000
  ) AS request_id;
  $$
);


