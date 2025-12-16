-- =====================================================
-- MARKET SEGMENTS: VIEW + RPC GRANTS (PUBLIC BROWSE)
-- =====================================================
-- Ensures the market segments browse pages can read:
-- - public.market_segments_index (VIEW)
-- - public.market_segment_stats(uuid) (RPC used by the view and UI)
--
-- Without explicit GRANTs, anon/authenticated may see empty pages or permission errors
-- even if RLS policies allow row visibility.
--
-- Date: 2025-12-16

BEGIN;

-- View used by /market/segments
GRANT SELECT ON public.market_segments_index TO anon, authenticated;

-- RPC used by the view + MarketExchange tiles
GRANT EXECUTE ON FUNCTION public.market_segment_stats(UUID) TO anon, authenticated;

-- RPC used by MarketFundDetail "Invest" flow (keep explicit)
GRANT EXECUTE ON FUNCTION public.market_fund_buy(UUID, BIGINT) TO authenticated;

COMMIT;


