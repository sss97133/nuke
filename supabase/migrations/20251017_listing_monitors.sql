-- Listing monitors to track external marketplace URLs and auto-update vehicles
-- Created: 2025-10-17

BEGIN;

CREATE TABLE IF NOT EXISTS public.listing_monitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  source_url text NOT NULL,
  source_platform text,             -- bring_a_trailer, facebook_marketplace, craigslist, autotrader, cars_com, hagerty, classic_com, generic
  status text DEFAULT 'active' CHECK (status IN ('active','sold','removed','expired','paused','unknown')),
  last_checked timestamptz,
  last_status text,
  last_content_hash text,
  sale_detected_at timestamptz,
  final_sale_price numeric(12,2),
  sale_date date,
  created_by uuid REFERENCES auth.users(id),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(vehicle_id, source_url)
);

ALTER TABLE public.listing_monitors ENABLE ROW LEVEL SECURITY;

-- Read access for now; tighten later if needed
CREATE POLICY IF NOT EXISTS listing_monitors_select_all ON public.listing_monitors
  FOR SELECT USING (true);

-- Inserts by anyone with a valid JWT (maps to their user id)
CREATE POLICY IF NOT EXISTS listing_monitors_insert_own ON public.listing_monitors
  FOR INSERT WITH CHECK (
    created_by IS NULL OR created_by = auth.uid()
  );

-- Updates allowed to owners; server-side service role bypasses RLS
CREATE POLICY IF NOT EXISTS listing_monitors_update_own ON public.listing_monitors
  FOR UPDATE USING (
    created_by IS NULL OR created_by = auth.uid()
  );

CREATE INDEX IF NOT EXISTS idx_listing_monitors_vehicle ON public.listing_monitors(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_listing_monitors_status ON public.listing_monitors(status);
CREATE INDEX IF NOT EXISTS idx_listing_monitors_last_checked ON public.listing_monitors(last_checked DESC);

COMMIT;
