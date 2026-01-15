-- ============================================================
-- AUCTION TIMER EXTENSION AUDIT TABLE
-- ============================================================
-- Tracks every time an auction timer is extended due to bids
-- Useful for monitoring live auction behavior and debugging

CREATE TABLE IF NOT EXISTS public.auction_timer_extensions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Listing reference
  listing_id UUID NOT NULL REFERENCES public.vehicle_listings(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  
  -- Extension details
  extension_type TEXT NOT NULL CHECK (extension_type IN ('live_auction_reset', 'soft_close_window')),
  sale_type TEXT NOT NULL CHECK (sale_type IN ('auction', 'live_auction')),
  
  -- Timing
  old_end_time TIMESTAMPTZ NOT NULL,
  new_end_time TIMESTAMPTZ NOT NULL,
  extension_seconds INTEGER NOT NULL,
  time_remaining_before_extension INTEGER, -- seconds remaining before extension
  bid_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Bid context
  bid_id UUID REFERENCES public.auction_bids(id) ON DELETE SET NULL,
  bidder_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  bid_amount_cents BIGINT,
  
  -- Configuration
  soft_close_enabled BOOLEAN,
  soft_close_window_seconds INTEGER,
  soft_close_reset_seconds INTEGER,
  sniping_protection_minutes INTEGER,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_timer_extensions_listing ON public.auction_timer_extensions(listing_id, created_at DESC);
CREATE INDEX idx_timer_extensions_vehicle ON public.auction_timer_extensions(vehicle_id);
CREATE INDEX idx_timer_extensions_bidder ON public.auction_timer_extensions(bidder_id);
CREATE INDEX idx_timer_extensions_type ON public.auction_timer_extensions(extension_type);
CREATE INDEX idx_timer_extensions_created ON public.auction_timer_extensions(created_at DESC);

COMMENT ON TABLE public.auction_timer_extensions IS 'Audit log of all auction timer extensions triggered by bids';

-- Helper function to get extension stats for a listing
CREATE OR REPLACE FUNCTION public.get_listing_timer_extension_stats(p_listing_id UUID)
RETURNS TABLE (
  total_extensions BIGINT,
  last_extension_at TIMESTAMPTZ,
  avg_extension_seconds NUMERIC,
  total_time_added_seconds BIGINT,
  extension_type_breakdown JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT as total_extensions,
    MAX(created_at) as last_extension_at,
    AVG(extension_seconds)::NUMERIC as avg_extension_seconds,
    SUM(extension_seconds)::BIGINT as total_time_added_seconds,
    jsonb_object_agg(extension_type, count) FILTER (WHERE extension_type IS NOT NULL) as extension_type_breakdown
  FROM (
    SELECT extension_type, COUNT(*) as count
    FROM public.auction_timer_extensions
    WHERE listing_id = p_listing_id
    GROUP BY extension_type
  ) sub
  CROSS JOIN (
    SELECT
      COUNT(*)::BIGINT,
      MAX(created_at),
      AVG(extension_seconds)::NUMERIC,
      SUM(extension_seconds)::BIGINT
    FROM public.auction_timer_extensions
    WHERE listing_id = p_listing_id
  ) stats;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.get_listing_timer_extension_stats IS 'Get statistics about timer extensions for a specific listing';
