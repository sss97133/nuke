-- 20260507120200_garage_summary_v2.sql
--
-- Rewrite v_garage_asset_summary so WHERE user_id = '...' is sargable.
--
-- Original v1 (in 20260507120000) pre-aggregated photos/observations/receipts
-- across the entire tables before joining vehicles. That meant a user-scoped
-- query had to scan 5M+ vehicle_images, 7M+ observations etc. just to compute
-- aggregates that would mostly be discarded.
--
-- v2 puts vehicles as the driving table and uses correlated lateral aggregates
-- so each (user, vehicle) row only computes its own aggregates from indexed
-- lookups (vehicle_id is the leftmost key in every relevant index). Filtering
-- by user_id then becomes "find 240 vehicles via idx_vehicles_user_id, then
-- run 240 indexed sub-aggregates" instead of "aggregate 12M rows globally."
--
-- For all-users analytics the view is also faster because each lateral keeps
-- its work scoped to one vehicle_id at a time, hitting indexes on vehicle_id.

CREATE OR REPLACE VIEW public.v_garage_asset_summary AS
SELECT
  v.user_id,
  v.id                                                    AS vehicle_id,
  v.year, v.make, v.model, v.vin, v.color,
  -- acquired_at: earliest of (first photo, first ownership obs, first receipt)
  LEAST(
    ps.first_photo_at,
    os.first_ownership_at::date,
    rs.first_receipt_at
  )                                                       AS acquired_at,
  -- disposed_at from sale event
  es.sold_at::date                                        AS disposed_at,
  CASE
    WHEN LEAST(ps.first_photo_at,
               os.first_ownership_at::date,
               rs.first_receipt_at) IS NULL
    THEN NULL
    ELSE (COALESCE(es.sold_at::date, CURRENT_DATE)
          - LEAST(ps.first_photo_at,
                  os.first_ownership_at::date,
                  rs.first_receipt_at))::int
  END                                                     AS days_held,
  COALESCE(ps.photo_count, 0)                             AS photo_count,
  COALESCE(os.observation_count, 0)                       AS observation_count,
  COALESCE(rs.receipt_count, 0)                           AS receipt_count,
  COALESCE(rs.total_receipts_usd, 0)                      AS total_receipts_usd,
  COALESCE(os.observed_purchase_price, v.purchase_price)  AS acquisition_cost_usd,
  COALESCE(es.final_sale_price, os.observed_sale_amount,
           v.bat_sold_price, v.canonical_sold_price, v.sold_price)
                                                          AS sale_proceeds_usd,
  COALESCE(v.nuke_estimate, v.cz_estimated_value, v.current_value,
           os.observed_valuation)                         AS estimated_current_value_usd,
  CASE
    WHEN es.sold_at IS NOT NULL
      THEN COALESCE(es.final_sale_price, os.observed_sale_amount,
                    v.bat_sold_price, v.canonical_sold_price, v.sold_price, 0)
           - COALESCE(rs.total_receipts_usd, 0)
    ELSE COALESCE(v.nuke_estimate, v.cz_estimated_value, v.current_value,
                  os.observed_valuation, 0)
         - COALESCE(rs.total_receipts_usd, 0)
  END                                                     AS net_position_usd,
  GREATEST(
    ps.last_photo_at,
    os.last_observation_at,
    rs.last_receipt_at,
    es.last_event_at
  )                                                       AS last_activity_at
FROM public.vehicles v
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)                                              AS photo_count,
    MIN(COALESCE(vi.taken_at, vi.created_at))::date       AS first_photo_at,
    MAX(COALESCE(vi.taken_at, vi.created_at))             AS last_photo_at
  FROM public.vehicle_images vi
  WHERE vi.vehicle_id = v.id
    AND COALESCE(vi.is_duplicate, false) = false
    AND COALESCE(vi.is_superseded, false) = false
) ps ON true
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)                                              AS observation_count,
    MAX(vo.observed_at)                                   AS last_observation_at,
    MAX((vo.structured_data->>'purchase_price')::numeric)
      FILTER (WHERE vo.kind::text IN ('ownership','provenance')
                AND (vo.structured_data ? 'purchase_price'))
                                                          AS observed_purchase_price,
    MAX((vo.structured_data->>'value_usd')::numeric)
      FILTER (WHERE vo.kind::text IN ('valuation','market_value')
                AND (vo.structured_data ? 'value_usd'))
                                                          AS observed_valuation,
    MAX((vo.structured_data->>'amount_usd')::numeric)
      FILTER (WHERE vo.kind::text = 'sale_result'
                AND (vo.structured_data ? 'amount_usd'))
                                                          AS observed_sale_amount,
    MIN(vo.observed_at) FILTER (WHERE vo.kind::text = 'ownership')
                                                          AS first_ownership_at
  FROM public.vehicle_observations vo
  WHERE vo.vehicle_id = v.id
    AND COALESCE(vo.is_superseded, false) = false
) os ON true
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)                                              AS receipt_count,
    SUM(COALESCE(r.total, r.total_amount, r.subtotal))    AS total_receipts_usd,
    MIN(COALESCE(r.purchase_date, r.transaction_date, r.receipt_date))
                                                          AS first_receipt_at,
    MAX(COALESCE(r.purchase_date::timestamptz,
                 r.transaction_date::timestamptz,
                 r.receipt_date::timestamptz,
                 r.created_at))                           AS last_receipt_at
  FROM public.receipts r
  WHERE r.vehicle_id = v.id
    AND COALESCE(r.is_active, true) = true
) rs ON true
LEFT JOIN LATERAL (
  SELECT
    MAX(ve.final_price) FILTER (WHERE ve.event_status = 'sold') AS final_sale_price,
    MAX(ve.sold_at)     FILTER (WHERE ve.event_status = 'sold') AS sold_at,
    MAX(COALESCE(ve.sold_at, ve.ended_at, ve.started_at))       AS last_event_at
  FROM public.vehicle_events ve
  WHERE ve.vehicle_id = v.id
) es ON true
WHERE v.user_id IS NOT NULL;

COMMENT ON VIEW public.v_garage_asset_summary IS
  'One row per (user_id, vehicle_id). Lifetime ledger: photos, observations, receipts, sale proceeds, estimated value, days held, net position. Uses LATERAL subqueries so WHERE user_id = ''...'' scopes to indexed-vehicle lookups.';

GRANT SELECT ON public.v_garage_asset_summary TO anon, authenticated, service_role;
