-- Add columns used by the scraping/import pipeline (process-import-queue).
-- These are required for the vehicle "form" to be populated correctly from scrapers.

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS discovery_url TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS origin_metadata JSONB DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS selling_organization_id UUID;

CREATE INDEX IF NOT EXISTS idx_vehicles_discovery_url
  ON public.vehicles(discovery_url)
  WHERE discovery_url IS NOT NULL;


