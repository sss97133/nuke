-- =====================================================
-- MARKET SEGMENTS INDEX VIEW (QUERYABLE ANALYTICS)
-- =====================================================
-- One-call fetch for UI: segments + attached fund symbol (optional) + stats.
-- Date: 2025-12-14

BEGIN;

CREATE OR REPLACE VIEW public.market_segments_index AS
SELECT
  s.id AS segment_id,
  s.slug,
  s.name,
  s.description,
  s.manager_type,
  s.status,
  s.year_min,
  s.year_max,
  s.makes,
  s.model_keywords,
  s.created_at,
  s.updated_at,

  f.id AS fund_id,
  f.symbol AS fund_symbol,
  f.fund_type,
  f.nav_share_price,
  f.total_shares_outstanding,
  f.total_aum_usd,

  st.vehicle_count,
  st.market_cap_usd,
  st.change_7d_pct,
  st.change_30d_pct
FROM public.market_segments s
LEFT JOIN public.market_funds f
  ON f.segment_id = s.id
  AND f.status = 'active'
CROSS JOIN LATERAL public.market_segment_stats(s.id) st
WHERE s.status = 'active';

COMMENT ON VIEW public.market_segments_index IS 'Market segments + optional fund mapping + stats for browse/heatmap UIs.';

COMMIT;


