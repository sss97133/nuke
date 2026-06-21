-- Move 3: Depreciation / value-over-time substrate
-- v_vehicle_monthly_basis: per (vehicle_id, month) cumulative receipts, payments_in/out, cost basis,
--   proceeds, holding status, estimated value, net position.
-- v_user_garage_value_timeseries: per (user_id, month) garage-level rollup.
--
-- Classic vehicles don't depreciate per IRS MACRS. These views answer:
--   "How did my cost basis and value move month-to-month?"
--   "What's my paper net position right now? On 2024-01-01? On any past month?"

BEGIN;

DROP VIEW IF EXISTS v_user_garage_value_timeseries CASCADE;
DROP VIEW IF EXISTS v_vehicle_monthly_basis CASCADE;

CREATE VIEW v_vehicle_monthly_basis AS
WITH
-- skeleton: month series per vehicle from earliest activity through current month
vehicle_first_activity AS (
  SELECT v.id AS vehicle_id, v.user_id,
    LEAST(
      (SELECT MIN(COALESCE(r.purchase_date, r.transaction_date, r.receipt_date, r.created_at::date))
         FROM receipts r
         WHERE r.vehicle_id = v.id
           AND COALESCE(r.is_active, true) = true
           AND COALESCE(r.is_superseded, false) = false),
      (SELECT MIN(pe.paid_at::date)
         FROM payment_events pe
         WHERE pe.scope_type = 'vehicle' AND pe.scope_id = v.id
           AND COALESCE(pe.is_superseded, false) = false),
      (SELECT MIN(vo.observed_at::date)
         FROM vehicle_observations vo
         WHERE vo.vehicle_id = v.id
           AND vo.kind = 'ownership'
           AND COALESCE(vo.is_superseded, false) = false)
    ) AS first_activity_date
  FROM vehicles v
  WHERE v.user_id IS NOT NULL
),
months AS (
  SELECT vfa.vehicle_id, vfa.user_id,
    date_trunc('month', gs)::date AS month
  FROM vehicle_first_activity vfa
  CROSS JOIN LATERAL generate_series(
    date_trunc('month', vfa.first_activity_date::timestamp),
    date_trunc('month', CURRENT_DATE::timestamp),
    interval '1 month'
  ) AS gs
  WHERE vfa.first_activity_date IS NOT NULL
),
-- cumulative receipts (out-of-pocket parts/labor — testimony of money spent) per vehicle through month_end
cum_receipts AS (
  SELECT m.vehicle_id, m.month,
    COALESCE(SUM(COALESCE(r.total, r.total_amount, r.subtotal)), 0)::numeric AS cumulative_receipts_usd
  FROM months m
  LEFT JOIN receipts r
    ON r.vehicle_id = m.vehicle_id
    AND COALESCE(r.is_active, true) = true
    AND COALESCE(r.is_superseded, false) = false
    AND COALESCE(r.purchase_date, r.transaction_date, r.receipt_date, r.created_at::date)
        <= (m.month + interval '1 month' - interval '1 day')::date
  GROUP BY m.vehicle_id, m.month
),
cum_pay_in AS (
  SELECT m.vehicle_id, m.month,
    COALESCE(SUM(pe.amount_usd), 0)::numeric AS cumulative_payments_in_usd
  FROM months m
  LEFT JOIN payment_events pe
    ON pe.scope_type = 'vehicle' AND pe.scope_id = m.vehicle_id
    AND pe.direction = 'in'
    AND COALESCE(pe.is_superseded, false) = false
    AND pe.paid_at::date <= (m.month + interval '1 month' - interval '1 day')::date
  GROUP BY m.vehicle_id, m.month
),
cum_pay_out AS (
  SELECT m.vehicle_id, m.month,
    COALESCE(SUM(pe.amount_usd), 0)::numeric AS cumulative_payments_out_usd
  FROM months m
  LEFT JOIN payment_events pe
    ON pe.scope_type = 'vehicle' AND pe.scope_id = m.vehicle_id
    AND pe.direction = 'out'
    AND COALESCE(pe.is_superseded, false) = false
    AND pe.paid_at::date <= (m.month + interval '1 month' - interval '1 day')::date
  GROUP BY m.vehicle_id, m.month
),
-- valuation observation as of month_end (latest valuation/market_value with a value_usd)
val_per_month AS (
  SELECT m.vehicle_id, m.month,
    (
      SELECT (vo.structured_data ->> 'value_usd')::numeric
        FROM vehicle_observations vo
        WHERE vo.vehicle_id = m.vehicle_id
          AND vo.kind = 'valuation'
          AND vo.structured_data ? 'value_usd'
          AND COALESCE(vo.is_superseded, false) = false
          AND vo.observed_at::date <= (m.month + interval '1 month' - interval '1 day')::date
        ORDER BY vo.observed_at DESC
        LIMIT 1
    ) AS observed_value_usd
  FROM months m
)
SELECT
  m.user_id,
  m.vehicle_id,
  m.month,
  v.year, v.make, v.model, v.vin,
  cr.cumulative_receipts_usd,
  cpi.cumulative_payments_in_usd,
  cpo.cumulative_payments_out_usd,
  -- cost basis = receipts (parts/labor outflows) + payment_events out (other money out)
  (cr.cumulative_receipts_usd + cpo.cumulative_payments_out_usd) AS cost_basis_usd,
  cpi.cumulative_payments_in_usd AS proceeds_usd,
  -- holding_status: 'sold' if vehicle.sale_status='sold' AND any payment_in OR vehicle has bat/canonical sold price as of month_end
  CASE
    WHEN COALESCE(v.sale_status, '') = 'sold'
         AND cpi.cumulative_payments_in_usd > 0 THEN 'sold'
    WHEN cpi.cumulative_payments_in_usd > 0 THEN 'sold'
    WHEN COALESCE(v.sale_status, '') = 'consigned' THEN 'consigned'
    WHEN cr.cumulative_receipts_usd > 0 OR cpo.cumulative_payments_out_usd > 0 THEN 'held'
    ELSE 'unknown'
  END AS holding_status,
  COALESCE(
    vpm.observed_value_usd,
    v.nuke_estimate,
    v.cz_estimated_value,
    v.current_value
  ) AS estimated_value_usd,
  CASE
    WHEN cpi.cumulative_payments_in_usd > 0 THEN
      cpi.cumulative_payments_in_usd - (cr.cumulative_receipts_usd + cpo.cumulative_payments_out_usd)
    ELSE
      COALESCE(vpm.observed_value_usd, v.nuke_estimate, v.cz_estimated_value, v.current_value, 0)
        - (cr.cumulative_receipts_usd + cpo.cumulative_payments_out_usd)
  END AS net_position_usd
FROM months m
JOIN vehicles v ON v.id = m.vehicle_id
LEFT JOIN cum_receipts cr ON cr.vehicle_id = m.vehicle_id AND cr.month = m.month
LEFT JOIN cum_pay_in cpi ON cpi.vehicle_id = m.vehicle_id AND cpi.month = m.month
LEFT JOIN cum_pay_out cpo ON cpo.vehicle_id = m.vehicle_id AND cpo.month = m.month
LEFT JOIN val_per_month vpm ON vpm.vehicle_id = m.vehicle_id AND vpm.month = m.month;

COMMENT ON VIEW v_vehicle_monthly_basis IS
  'One row per (vehicle_id, month). Cumulative receipts (non-superseded), payments in/out (non-superseded), cost basis, estimated value, net position. Skeleton starts at vehicle''s first observed activity. Classic vehicles don''t MACRS-depreciate; this is for tax/insurance/sale-decision visibility.';

CREATE VIEW v_user_garage_value_timeseries AS
SELECT
  user_id,
  month,
  COUNT(*) AS vehicles_in_garage,
  COUNT(*) FILTER (WHERE holding_status = 'held') AS vehicles_held,
  COUNT(*) FILTER (WHERE holding_status = 'sold') AS vehicles_sold,
  COUNT(*) FILTER (WHERE holding_status = 'consigned') AS vehicles_consigned,
  SUM(cumulative_receipts_usd) AS total_cumulative_receipts_usd,
  SUM(cumulative_payments_in_usd) AS total_cumulative_payments_in_usd,
  SUM(cumulative_payments_out_usd) AS total_cumulative_payments_out_usd,
  SUM(cost_basis_usd) AS total_cost_basis_usd,
  SUM(proceeds_usd) AS total_proceeds_usd,
  SUM(COALESCE(estimated_value_usd, 0))
    FILTER (WHERE holding_status IN ('held','consigned','unknown')) AS held_estimated_value_usd,
  SUM(net_position_usd) AS total_net_position_usd
FROM v_vehicle_monthly_basis
WHERE user_id IS NOT NULL
GROUP BY user_id, month;

COMMENT ON VIEW v_user_garage_value_timeseries IS
  'Per-user per-month garage rollup of v_vehicle_monthly_basis. Single SELECT shows total cost basis, value, and net position over time.';

COMMIT;
