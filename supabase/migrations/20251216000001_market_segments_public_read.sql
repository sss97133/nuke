-- =====================================================
-- MARKET SEGMENTS: PUBLIC READ (ANON)
-- =====================================================
-- Fixes empty /market/segments for logged-out viewers by allowing anon
-- to SELECT active segments (and optionally active funds).
--
-- Date: 2025-12-16

BEGIN;

-- Ensure RLS is enabled (safe if already enabled)
ALTER TABLE IF EXISTS public.market_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.market_funds ENABLE ROW LEVEL SECURITY;

-- Allow anon to browse active segments
DROP POLICY IF EXISTS market_segments_select_anon ON public.market_segments;
CREATE POLICY market_segments_select_anon
  ON public.market_segments
  FOR SELECT
  TO anon
  USING (status = 'active');

-- Allow anon to browse active funds (optional but expected for public market pages)
DROP POLICY IF EXISTS market_funds_select_anon ON public.market_funds;
CREATE POLICY market_funds_select_anon
  ON public.market_funds
  FOR SELECT
  TO anon
  USING (status = 'active');

COMMIT;


