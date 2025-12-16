-- Vehicle location observations (time-sensitive, source-aware)
-- Goal:
-- - Location is NOT a timeless vehicle attribute; it is an observation with a timestamp + provenance.
-- - Provide a universal place to store "last known listing location" (and later EXIF/GPS/manual).
-- - Keep everything IF NOT EXISTS-safe for clean resets.

DO $$
BEGIN
  IF to_regclass('public.vehicles') IS NOT NULL THEN
    -- Canonical "current/last known listing location" snapshot columns (fast UI reads)
    BEGIN
      ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS listing_location_raw TEXT;
    EXCEPTION WHEN undefined_column THEN NULL; END;

    BEGIN
      ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS listing_location_observed_at TIMESTAMPTZ;
    EXCEPTION WHEN undefined_column THEN NULL; END;

    BEGIN
      ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS listing_location_source TEXT;
    EXCEPTION WHEN undefined_column THEN NULL; END;

    BEGIN
      ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS listing_location_confidence REAL;
    EXCEPTION WHEN undefined_column THEN NULL; END;

    CREATE INDEX IF NOT EXISTS idx_vehicles_listing_location_observed_at
      ON public.vehicles(listing_location_observed_at)
      WHERE listing_location_observed_at IS NOT NULL;
  END IF;
END
$$;

-- Universal time-series storage for location changes/observations
DO $$
BEGIN
  IF to_regclass('public.vehicle_location_observations') IS NULL THEN
    CREATE TABLE public.vehicle_location_observations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,

      -- observation classification
      source_type TEXT NOT NULL, -- 'listing' | 'exif' | 'gps' | 'manual' | 'inferred'
      source_platform TEXT,      -- 'bat' | 'craigslist' | 'classic_com' | etc (nullable)
      source_url TEXT,

      -- temporal truth
      observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

      -- raw + cleaned display
      location_text_raw TEXT,
      location_text_clean TEXT,

      -- optional structured components (best-effort)
      country_code TEXT,
      region_code TEXT,
      city TEXT,
      postal_code TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      precision TEXT, -- 'country' | 'region' | 'city' | 'point'
      confidence REAL,

      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX idx_vehicle_location_observations_vehicle_time
      ON public.vehicle_location_observations(vehicle_id, observed_at DESC);
    CREATE INDEX idx_vehicle_location_observations_source_type
      ON public.vehicle_location_observations(source_type);
  END IF;
END
$$;


