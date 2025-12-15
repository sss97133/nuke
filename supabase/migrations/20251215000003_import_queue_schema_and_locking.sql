-- Import Queue: canonical ingestion job queue
-- This migration brings `public.import_queue` under version control and adds the primitives required
-- for safe high-throughput processing (locking, backoff, priority).
--
-- Notes:
-- - Uses CREATE TABLE IF NOT EXISTS + ALTER TABLE ADD COLUMN IF NOT EXISTS so it is safe to apply
--   to projects where import_queue already exists.
-- - Keep status values aligned with Edge function `process-import-queue`.

-- 1) Table (create if missing)
CREATE TABLE IF NOT EXISTS public.import_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Dedup key: canonical listing URL
  listing_url TEXT NOT NULL UNIQUE,

  -- Source context
  source_id UUID,

  -- Lightweight listing hints (for prioritization + UI)
  listing_title TEXT,
  listing_price NUMERIC,
  listing_year INTEGER,
  listing_make TEXT,
  listing_model TEXT,
  thumbnail_url TEXT,

  -- Processing state
  -- NOTE: legacy rows may include status='duplicate'. Keep it allowed for backwards compatibility.
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'complete', 'failed', 'skipped', 'duplicate')),
  attempts INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 0,

  -- Result / provenance
  vehicle_id UUID,
  processed_at TIMESTAMPTZ,
  error_message TEXT,

  -- Raw scrape payload / extraction metadata
  raw_data JSONB DEFAULT '{}'::jsonb,

  -- Backpressure / locking (added for concurrency safety)
  next_attempt_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  last_attempt_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2) Backfill missing columns (if table existed before this migration)
DO $$
BEGIN
  IF to_regclass('public.import_queue') IS NULL THEN
    RETURN;
  END IF;

  -- Source context
  ALTER TABLE public.import_queue ADD COLUMN IF NOT EXISTS source_id UUID;

  -- Listing hints
  ALTER TABLE public.import_queue ADD COLUMN IF NOT EXISTS listing_title TEXT;
  ALTER TABLE public.import_queue ADD COLUMN IF NOT EXISTS listing_price NUMERIC;
  ALTER TABLE public.import_queue ADD COLUMN IF NOT EXISTS listing_year INTEGER;
  ALTER TABLE public.import_queue ADD COLUMN IF NOT EXISTS listing_make TEXT;
  ALTER TABLE public.import_queue ADD COLUMN IF NOT EXISTS listing_model TEXT;
  ALTER TABLE public.import_queue ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

  -- State
  ALTER TABLE public.import_queue ADD COLUMN IF NOT EXISTS status TEXT;
  ALTER TABLE public.import_queue ADD COLUMN IF NOT EXISTS attempts INTEGER;
  ALTER TABLE public.import_queue ADD COLUMN IF NOT EXISTS priority INTEGER;

  -- Result
  ALTER TABLE public.import_queue ADD COLUMN IF NOT EXISTS vehicle_id UUID;
  ALTER TABLE public.import_queue ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
  ALTER TABLE public.import_queue ADD COLUMN IF NOT EXISTS error_message TEXT;

  -- Raw
  ALTER TABLE public.import_queue ADD COLUMN IF NOT EXISTS raw_data JSONB;

  -- Locking/backoff
  ALTER TABLE public.import_queue ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;
  ALTER TABLE public.import_queue ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
  ALTER TABLE public.import_queue ADD COLUMN IF NOT EXISTS locked_by TEXT;
  ALTER TABLE public.import_queue ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

  -- Timestamps
  ALTER TABLE public.import_queue ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
  ALTER TABLE public.import_queue ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

  -- Defaults for legacy rows
  UPDATE public.import_queue
  SET
    status = COALESCE(status, 'pending'),
    attempts = COALESCE(attempts, 0),
    priority = COALESCE(priority, 0),
    raw_data = COALESCE(raw_data, '{}'::jsonb),
    created_at = COALESCE(created_at, NOW()),
    updated_at = COALESCE(updated_at, NOW())
  WHERE status IS NULL OR attempts IS NULL OR priority IS NULL OR raw_data IS NULL OR created_at IS NULL OR updated_at IS NULL;

  -- Re-apply a strict status check constraint (drop-and-create is safest across unknown prior names)
  BEGIN
    ALTER TABLE public.import_queue DROP CONSTRAINT IF EXISTS import_queue_status_check;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  ALTER TABLE public.import_queue
    ADD CONSTRAINT import_queue_status_check
    CHECK (status IN ('pending', 'processing', 'complete', 'failed', 'skipped', 'duplicate'));
END
$$;

-- 3) Helpful indexes for scale
CREATE INDEX IF NOT EXISTS idx_import_queue_status_priority
  ON public.import_queue(status, priority DESC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_import_queue_next_attempt
  ON public.import_queue(status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS idx_import_queue_locked_at
  ON public.import_queue(locked_at);

CREATE INDEX IF NOT EXISTS idx_import_queue_source
  ON public.import_queue(source_id);

-- 4) Updated-at trigger
CREATE OR REPLACE FUNCTION public.update_import_queue_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_import_queue_updated_at ON public.import_queue;
CREATE TRIGGER trg_update_import_queue_updated_at
  BEFORE UPDATE ON public.import_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.update_import_queue_updated_at();

-- 5) Claim RPC: atomically claim work for concurrent processors
CREATE OR REPLACE FUNCTION public.claim_import_queue_batch(
  p_batch_size INTEGER DEFAULT 20,
  p_max_attempts INTEGER DEFAULT 3,
  p_priority_only BOOLEAN DEFAULT FALSE,
  p_source_id UUID DEFAULT NULL,
  p_worker_id TEXT DEFAULT NULL,
  p_lock_ttl_seconds INTEGER DEFAULT 900
)
RETURNS SETOF public.import_queue
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
    SELECT iq.id
    FROM public.import_queue iq
    WHERE iq.status = 'pending'
      AND COALESCE(iq.attempts, 0) < COALESCE(p_max_attempts, 3)
      AND (iq.next_attempt_at IS NULL OR iq.next_attempt_at <= v_now)
      AND (
        iq.locked_at IS NULL OR
        iq.locked_at < (v_now - v_lock_ttl)
      )
      AND (NOT COALESCE(p_priority_only, FALSE) OR COALESCE(iq.priority, 0) > 0)
      AND (p_source_id IS NULL OR iq.source_id = p_source_id)
    ORDER BY
      COALESCE(iq.priority, 0) DESC,
      iq.listing_year DESC NULLS LAST,
      iq.created_at ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_batch_size, 20), 200))
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.import_queue iq
    SET
      status = 'processing',
      attempts = COALESCE(iq.attempts, 0) + 1,
      locked_at = v_now,
      locked_by = COALESCE(p_worker_id, 'unknown'),
      last_attempt_at = v_now
    WHERE iq.id IN (SELECT id FROM candidates)
    RETURNING iq.*
  )
  SELECT * FROM claimed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_import_queue_batch(INTEGER, INTEGER, BOOLEAN, UUID, TEXT, INTEGER) TO authenticated;


