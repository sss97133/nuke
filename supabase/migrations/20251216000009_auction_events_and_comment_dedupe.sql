-- Auction events backbone + idempotent comment ingestion
-- Goal:
-- - Ensure `auction_events` exists (referenced by auction_comments + receipts)
-- - Add a stable unique key for BaT events: (platform, listing_url)
-- - Prevent duplicate comment rows on repeated `extract-auction-comments` runs

-- 1) AUCTION EVENTS (minimal, extensible)
DO $$
BEGIN
  IF to_regclass('public.auction_events') IS NULL THEN
    CREATE TABLE public.auction_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE CASCADE,
      platform TEXT NOT NULL, -- 'bat', 'classic_com', etc
      listing_url TEXT NOT NULL,

      -- Auction state
      outcome TEXT, -- 'active' | 'sold' | 'ended' | 'reserve_not_met' | ...
      high_bid NUMERIC,
      reserve_price NUMERIC,
      reserve_met BOOLEAN,
      auction_start_at TIMESTAMPTZ,
      auction_end_at TIMESTAMPTZ,
      auction_duration_hours NUMERIC,

      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

      -- Receipt fields are added elsewhere via ALTER TABLE IF NOT EXISTS, but we include them here for new envs
      receipt_data JSONB,
      ai_summary TEXT,
      sentiment_arc JSONB,
      key_moments JSONB,
      top_contributors JSONB,

      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  END IF;
END
$$;

-- Best-effort: add missing columns in environments where auction_events exists but was created manually.
DO $$
BEGIN
  IF to_regclass('public.auction_events') IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE CASCADE;
  EXCEPTION WHEN undefined_column THEN NULL; END;

  BEGIN
    ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS platform TEXT;
  EXCEPTION WHEN undefined_column THEN NULL; END;

  BEGIN
    ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS listing_url TEXT;
  EXCEPTION WHEN undefined_column THEN NULL; END;

  BEGIN
    ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS outcome TEXT;
  EXCEPTION WHEN undefined_column THEN NULL; END;

  BEGIN
    ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS high_bid NUMERIC;
  EXCEPTION WHEN undefined_column THEN NULL; END;

  BEGIN
    ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS reserve_price NUMERIC;
  EXCEPTION WHEN undefined_column THEN NULL; END;

  BEGIN
    ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS reserve_met BOOLEAN;
  EXCEPTION WHEN undefined_column THEN NULL; END;

  BEGIN
    ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS auction_start_at TIMESTAMPTZ;
  EXCEPTION WHEN undefined_column THEN NULL; END;

  BEGIN
    ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS auction_end_at TIMESTAMPTZ;
  EXCEPTION WHEN undefined_column THEN NULL; END;

  BEGIN
    ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS auction_duration_hours NUMERIC;
  EXCEPTION WHEN undefined_column THEN NULL; END;

  BEGIN
    ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
  EXCEPTION WHEN undefined_column THEN NULL; END;

  BEGIN
    ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS receipt_data JSONB;
    ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS ai_summary TEXT;
    ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS sentiment_arc JSONB;
    ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS key_moments JSONB;
    ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS top_contributors JSONB;
  EXCEPTION WHEN undefined_column THEN NULL; END;

  BEGIN
    ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
    ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  EXCEPTION WHEN undefined_column THEN NULL; END;
END
$$;

-- Unique event identity (supports idempotent upserts)
DO $$
BEGIN
  IF to_regclass('public.auction_events') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_auction_events_platform_listing_url'
  ) THEN
    CREATE UNIQUE INDEX uq_auction_events_platform_listing_url
      ON public.auction_events(platform, listing_url);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_auction_events_vehicle
  ON public.auction_events(vehicle_id);

CREATE INDEX IF NOT EXISTS idx_auction_events_platform_time
  ON public.auction_events(platform, updated_at DESC);

-- 2) Comments: enforce idempotency for extract runs
DO $$
BEGIN
  IF to_regclass('public.auction_comments') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_auction_comments_event_seq'
  ) THEN
    CREATE UNIQUE INDEX uq_auction_comments_event_seq
      ON public.auction_comments(auction_event_id, sequence_number)
      WHERE auction_event_id IS NOT NULL AND sequence_number IS NOT NULL;
  END IF;
END
$$;

-- 3) RLS for auction_events (align with other auction intelligence tables)
DO $$
BEGIN
  IF to_regclass('public.auction_events') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE public.auction_events ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS "Public read auction events" ON public.auction_events;
  CREATE POLICY "Public read auction events"
    ON public.auction_events
    FOR SELECT
    USING (true);

  DROP POLICY IF EXISTS "Service role write auction events" ON public.auction_events;
  CREATE POLICY "Service role write auction events"
    ON public.auction_events
    FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role')
    WITH CHECK (auth.jwt() ->> 'role' = 'service_role');
END
$$;


