-- BaT DOM Map Health: per-field coverage breakdown for admin dashboards
-- Consumes public.listing_extraction_health_latest (platform='bat').

CREATE OR REPLACE FUNCTION public.get_bat_dom_health_field_breakdown(p_hours INTEGER DEFAULT 168)
RETURNS TABLE (
  field_key TEXT,
  ok_listings INTEGER,
  missing_listings INTEGER,
  ok_pct NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH h AS (
    SELECT *
    FROM public.listing_extraction_health_latest
    WHERE platform = 'bat'
      AND extracted_at > NOW() - (p_hours || ' hours')::INTERVAL
  ),
  totals AS (
    SELECT COUNT(*)::int AS total FROM h
  ),
  rows AS (
    SELECT 'title'::text AS field_key, COUNT(*) FILTER (WHERE COALESCE((health->'fields'->'title'->>'ok')::boolean, false))::int AS ok_count FROM h
    UNION ALL
    SELECT 'identity'::text, COUNT(*) FILTER (WHERE COALESCE((health->'fields'->'identity'->>'ok')::boolean, false))::int FROM h
    UNION ALL
    SELECT 'lot_number'::text, COUNT(*) FILTER (WHERE COALESCE((health->'fields'->'lot_number'->>'ok')::boolean, false))::int FROM h
    UNION ALL
    SELECT 'location'::text, COUNT(*) FILTER (WHERE COALESCE((health->'fields'->'location'->>'ok')::boolean, false))::int FROM h
    UNION ALL
    SELECT 'seller'::text, COUNT(*) FILTER (WHERE COALESCE((health->'fields'->'seller'->>'ok')::boolean, false))::int FROM h
    UNION ALL
    SELECT 'buyer'::text, COUNT(*) FILTER (WHERE COALESCE((health->'fields'->'buyer'->>'ok')::boolean, false))::int FROM h
    UNION ALL
    SELECT 'auction_dates'::text, COUNT(*) FILTER (WHERE COALESCE((health->'fields'->'auction_dates'->>'ok')::boolean, false))::int FROM h
    UNION ALL
    SELECT 'sale'::text, COUNT(*) FILTER (WHERE COALESCE((health->'fields'->'sale'->>'ok')::boolean, false))::int FROM h
    UNION ALL
    SELECT 'images'::text, COUNT(*) FILTER (WHERE COALESCE((health->'counts'->>'images')::int, 0) > 0)::int FROM h
    UNION ALL
    SELECT 'description'::text, COUNT(*) FILTER (WHERE COALESCE((health->'fields'->'description'->>'ok')::boolean, false))::int FROM h
    UNION ALL
    SELECT 'comments'::text, COUNT(*) FILTER (WHERE COALESCE((health->'counts'->>'comments')::int, 0) > 0)::int FROM h
    UNION ALL
    SELECT 'bids'::text, COUNT(*) FILTER (WHERE COALESCE((health->'counts'->>'bids')::int, 0) > 0)::int FROM h
  )
  SELECT
    r.field_key,
    r.ok_count::int AS ok_listings,
    GREATEST(0, t.total - r.ok_count)::int AS missing_listings,
    CASE WHEN t.total > 0 THEN ROUND((r.ok_count::numeric / t.total::numeric) * 100, 2) ELSE 0 END AS ok_pct
  FROM rows r
  CROSS JOIN totals t
  ORDER BY missing_listings DESC, field_key ASC;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION public.get_bat_dom_health_field_breakdown(INTEGER) TO anon, authenticated;


