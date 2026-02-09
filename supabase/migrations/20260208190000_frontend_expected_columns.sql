-- Frontend-expected columns and tables
-- Adds columns that the app selects/filters on to avoid 400s when they are missing.
-- Safe to run multiple times (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS).

BEGIN;

-- 1) vehicles.listing_kind (used by homepage/listings; migration 20260120 may not be applied everywhere)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'listing_kind') THEN
    ALTER TABLE public.vehicles ADD COLUMN listing_kind TEXT NOT NULL DEFAULT 'vehicle' CHECK (listing_kind IN ('vehicle', 'non_vehicle_item'));
    CREATE INDEX idx_vehicles_listing_kind ON public.vehicles(listing_kind);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_vehicles_listing_kind ON public.vehicles(listing_kind);

-- 2) auction_events: columns the frontend selects (VehicleVideoSection, ValueProvenancePopup, VehicleTimeline, etc.)
DO $$
BEGIN
  IF to_regclass('public.auction_events') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS source TEXT;
  ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS source_url TEXT;
  ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS auction_name TEXT;
  ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS auction_start_date TIMESTAMPTZ;
  ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS auction_end_date TIMESTAMPTZ;
  ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS winning_bid NUMERIC;
  ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS lot_number TEXT;
  ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS broadcast_video_url TEXT;
  ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS broadcast_timestamp_start NUMERIC;
  ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS broadcast_timestamp_end NUMERIC;
  ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS estimate_low NUMERIC;
  ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS estimate_high NUMERIC;
  ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS seller_name TEXT;
  ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS winning_bidder TEXT;
  ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS total_bids INTEGER;
  ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS comments_count INTEGER;
  ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS page_views INTEGER;
  ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS watchers INTEGER;
END $$;

-- 3) live_streaming_sessions: ensure stream_provider and ordering columns exist
DO $$
BEGIN
  IF to_regclass('public.live_streaming_sessions') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE public.live_streaming_sessions ADD COLUMN IF NOT EXISTS stream_provider TEXT;
  ALTER TABLE public.live_streaming_sessions ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ DEFAULT NOW();
  ALTER TABLE public.live_streaming_sessions ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;
END $$;

-- 4) vehicle_research_items: ensure table exists (404 fix when migration 20260120130000 not applied)
CREATE TABLE IF NOT EXISTS public.vehicle_research_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('source', 'note', 'question', 'claim', 'event')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  title TEXT NOT NULL,
  summary TEXT,
  source_url TEXT,
  source_type TEXT,
  event_date DATE,
  date_precision TEXT NOT NULL DEFAULT 'unknown' CHECK (date_precision IN ('day', 'month', 'year', 'unknown')),
  confidence INTEGER CHECK (confidence >= 0 AND confidence <= 100),
  tags TEXT[],
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vehicle_research_items_vehicle ON public.vehicle_research_items(vehicle_id);

ALTER TABLE public.vehicle_research_items ENABLE ROW LEVEL SECURITY;

-- RLS: allow read for all (public research notes)
DROP POLICY IF EXISTS vehicle_research_items_read ON public.vehicle_research_items;
CREATE POLICY vehicle_research_items_read ON public.vehicle_research_items FOR SELECT USING (true);

-- Write: owner or contributor (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vehicle_research_items' AND policyname = 'vehicle_research_items_write_owner_or_contributor') THEN
    CREATE POLICY vehicle_research_items_write_owner_or_contributor ON public.vehicle_research_items FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.vehicles v
          WHERE v.id = vehicle_id
            AND (v.user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.vehicle_contributors vc WHERE vc.vehicle_id = vehicle_id AND vc.user_id = auth.uid()))
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vehicle_research_items' AND policyname = 'vehicle_research_items_update_owner_or_contributor') THEN
    CREATE POLICY vehicle_research_items_update_owner_or_contributor ON public.vehicle_research_items FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM public.vehicles v
          WHERE v.id = vehicle_id
            AND (v.user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.vehicle_contributors vc WHERE vc.vehicle_id = vehicle_id AND vc.user_id = auth.uid()))
        )
      );
  END IF;
END $$;

COMMIT;
