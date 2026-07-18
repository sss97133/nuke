-- 20260622060000_get_vehicle_investment_timeline.sql
-- Applied to prod 2026-06-22 (new STABLE SECURITY DEFINER function + grants).
-- NEW: get_vehicle_investment_timeline(p_vehicle uuid) — the investment TRAJECTORY for the
-- iOS build. Returns an ordered jsonb array of points {date, delta, cumulative, kind, proven,
-- source} that draws a rising cumulative curve of real money put into a vehicle over time.
--
-- DON'T MINT: this is the time-series sibling of compute_vehicle_investment_proof (which returns
-- only the rolled-up totals, no per-point trajectory). Same substrate (receipts.superseded_at IS
-- NULL, coalesce(total_amount,total)), same date precedence (receipt_date→transaction_date→
-- purchase_date), same owner gate (auth.uid() IN owner_id/user_id/created_by_user_id), same
-- SECURITY DEFINER + grants. It does NOT duplicate the totals view; it adds the ordered curve.
--
-- FACTS SACRED:
--   * Baseline point = the purchase (vehicles.purchase_price). kind='purchase', proven=true.
--     vehicles.purchase_date is the date if present; when NULL it is ANCHORED to the earliest
--     dated receipt (never fabricated) and `source` records that the date is anchored, not stated.
--     If there is no purchase_price AND no dated receipt, no baseline point is emitted.
--   * Each DATED active receipt = one point. kind='parts' (receipts are parts/materials purchases;
--     we do not reclassify a receipt as labor from sparse line-item categories). proven=true.
--   * UNDATED active receipts are NEVER given a fabricated date. They are returned only as the
--     {n_undated, undated_total} summary so the curve stays honest while the grand total reconciles.
--   * Per-receipt vendor `source` is gated to the owner view; NULL for anon / non-owner.
--
-- cumulative is a running sum over the ordered (baseline, then receipts by effective date then id).
-- final_cumulative_dated = purchase + dated parts (the last point's cumulative).
-- total_with_undated = final_cumulative_dated + undated_total (reconciles to the proof total).
--
-- Granted to anon + authenticated + service_role so the public vehicle page and the iOS app render it.
-- Mirrors prod; CREATE OR REPLACE is idempotent.

CREATE OR REPLACE FUNCTION public.get_vehicle_investment_timeline(p_vehicle uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner boolean;
  v_purchase_price numeric;
  v_purchase_date date;
  v_min_receipt_date date;
  v_baseline_date date;
  v_baseline_anchored boolean := false;
  v_points jsonb := '[]'::jsonb;
  v_baseline jsonb := NULL;
  v_n_undated int;
  v_undated_total numeric;
  v_final numeric := 0;
BEGIN
  -- Owner gate mirrors compute_vehicle_investment_proof exactly.
  SELECT (auth.uid() IS NOT NULL AND auth.uid() IN (owner_id, user_id, created_by_user_id)),
         purchase_price, purchase_date
  INTO v_owner, v_purchase_price, v_purchase_date
  FROM vehicles WHERE id = p_vehicle;
  v_owner := COALESCE(v_owner, false);

  -- Earliest real receipt date — the only honest anchor for an undated purchase.
  SELECT min(coalesce(receipt_date, transaction_date, purchase_date))
  INTO v_min_receipt_date
  FROM receipts
  WHERE vehicle_id = p_vehicle AND superseded_at IS NULL
    AND coalesce(receipt_date, transaction_date, purchase_date) IS NOT NULL;

  -- Undated active receipts → summary only (NO fabricated dates).
  SELECT count(*), coalesce(sum(coalesce(total_amount, total)), 0)
  INTO v_n_undated, v_undated_total
  FROM receipts
  WHERE vehicle_id = p_vehicle AND superseded_at IS NULL
    AND coalesce(receipt_date, transaction_date, purchase_date) IS NULL;

  -- Baseline purchase point (if we have a real price).
  IF v_purchase_price IS NOT NULL AND v_purchase_price > 0 THEN
    IF v_purchase_date IS NOT NULL THEN
      v_baseline_date := v_purchase_date;
      v_baseline_anchored := false;
    ELSIF v_min_receipt_date IS NOT NULL THEN
      v_baseline_date := v_min_receipt_date;   -- anchored to a REAL observed date, not invented
      v_baseline_anchored := true;
    END IF;

    IF v_baseline_date IS NOT NULL THEN
      v_final := v_purchase_price;
      v_baseline := jsonb_build_object(
        'date', v_baseline_date,
        'delta', round(v_purchase_price, 2),
        'cumulative', round(v_purchase_price, 2),
        'kind', 'purchase',
        'proven', true,
        'anchored_date', v_baseline_anchored,
        'source', CASE WHEN v_owner THEN
                    CASE WHEN v_baseline_anchored
                         THEN 'vehicles.purchase_price (date anchored to first receipt)'
                         ELSE 'vehicles.purchase_price' END
                  ELSE NULL END
      );
    END IF;
  END IF;

  -- Dated receipt points, ordered, with running cumulative seeded by the baseline.
  SELECT coalesce(jsonb_agg(pt ORDER BY ord), '[]'::jsonb), coalesce(max(running), v_final)
  INTO v_points, v_final
  FROM (
    SELECT
      row_number() OVER w AS ord,
      v_final + sum(coalesce(r.total_amount, r.total)) OVER w AS running,
      jsonb_build_object(
        'date', coalesce(r.receipt_date, r.transaction_date, r.purchase_date),
        'delta', round(coalesce(r.total_amount, r.total), 2),
        'cumulative', round(v_final + sum(coalesce(r.total_amount, r.total)) OVER w, 2),
        'kind', 'parts',
        'proven', true,
        'source', CASE WHEN v_owner THEN coalesce(nullif(r.vendor_name, ''), 'receipts') ELSE NULL END
      ) AS pt
    FROM receipts r
    WHERE r.vehicle_id = p_vehicle AND r.superseded_at IS NULL
      AND coalesce(r.receipt_date, r.transaction_date, r.purchase_date) IS NOT NULL
    WINDOW w AS (
      ORDER BY coalesce(r.receipt_date, r.transaction_date, r.purchase_date), r.id
      ROWS UNBOUNDED PRECEDING
    )
  ) q;

  -- Prepend the baseline purchase point so the curve starts at the purchase.
  IF v_baseline IS NOT NULL THEN
    v_points := jsonb_build_array(v_baseline) || v_points;
  END IF;

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle,
    'is_owner_view', v_owner,
    'n_points', jsonb_array_length(v_points),
    'baseline', coalesce(v_baseline, jsonb_build_object('present', false,
                  'note', 'No purchase_price or no dated receipt to anchor a baseline.')),
    'points', v_points,
    'undated', jsonb_build_object('n_undated', v_n_undated, 'undated_total', round(v_undated_total, 2)),
    'final_cumulative_dated', round(v_final, 2),
    'total_with_undated', round(v_final + v_undated_total, 2)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_vehicle_investment_timeline(uuid) TO anon, authenticated, service_role;
