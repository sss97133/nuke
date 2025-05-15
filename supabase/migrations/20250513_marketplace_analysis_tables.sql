-- Create tables to support Spectral Valuation's buyer community analysis

-- Table to store marketplace analysis results
CREATE TABLE IF NOT EXISTS public.marketplace_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace TEXT NOT NULL,
  analysis_date TIMESTAMPTZ DEFAULT now(),
  profile JSONB,
  raw_metrics JSONB,
  buyer_patterns JSONB,
  confidence_score INTEGER
);

-- Add indices for efficient querying
CREATE INDEX IF NOT EXISTS idx_marketplace_analysis_marketplace 
  ON public.marketplace_analysis(marketplace);
CREATE INDEX IF NOT EXISTS idx_marketplace_analysis_date 
  ON public.marketplace_analysis(analysis_date);

-- Add RLS policies
ALTER TABLE public.marketplace_analysis ENABLE ROW LEVEL SECURITY;

-- Public read access for marketplace analysis
CREATE POLICY "Anyone can view marketplace analysis" 
ON public.marketplace_analysis FOR SELECT 
USING (true);

-- Only authenticated users can insert analysis
CREATE POLICY "Only authenticated users can create marketplace analysis" 
ON public.marketplace_analysis FOR INSERT 
TO authenticated
WITH CHECK (true);

-- Add transaction event type to vehicle_timeline_events if not already supported
DO $$
BEGIN
  -- Add 'transaction' to possible event types if using an enum
  IF EXISTS (
    SELECT 1 
    FROM pg_type 
    WHERE typname = 'event_type_enum' 
  ) THEN
    ALTER TYPE event_type_enum ADD VALUE IF NOT EXISTS 'transaction';
  END IF;
  
  -- Ensure vehicle_timeline_events table has fields needed for transaction tracking
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name = 'vehicle_timeline_events'
  ) THEN
    -- Add data column if it doesn't exist (for storing transaction info)
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'vehicle_timeline_events'
      AND column_name = 'data'
    ) THEN
      ALTER TABLE public.vehicle_timeline_events
      ADD COLUMN data JSONB DEFAULT '{}'::jsonb;
    END IF;
  END IF;
END $$;

-- Grant permissions
GRANT ALL ON TABLE public.marketplace_analysis TO authenticated, service_role;
