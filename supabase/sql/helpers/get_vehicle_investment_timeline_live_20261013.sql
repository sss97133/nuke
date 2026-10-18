-- The live definition of public.get_vehicle_investment_timeline(uuid) as read from production on
-- 2026-10-13 16:45Z (source hash VRjB64U3TbTzrl4/xsZtUWykLxwzx/5gtj4VGQQ6yxc=), kept so the contract
-- can start from the deployed state before applying 20261013170000_investment_readers_money_owner_only.sql.
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
  v_has_baseline boolean := false;
BEGIN
  SELECT (auth.uid() IS NOT NULL AND auth.uid() IN (owner_id, user_id, created_by_user_id)),
         purchase_price, purchase_date
  INTO v_owner, v_purchase_price, v_purchase_date
  FROM vehicles WHERE id = p_vehicle;
  v_owner := COALESCE(v_owner, false);

  SELECT min(coalesce(receipt_date, transaction_date, purchase_date))
  INTO v_min_receipt_date
  FROM receipts
  WHERE vehicle_id = p_vehicle AND superseded_at IS NULL
    AND coalesce(receipt_date, transaction_date, purchase_date) IS NOT NULL;

  SELECT count(*), coalesce(sum(coalesce(total_amount, total)), 0)
  INTO v_n_undated, v_undated_total
  FROM receipts
  WHERE vehicle_id = p_vehicle AND superseded_at IS NULL
    AND coalesce(receipt_date, transaction_date, purchase_date) IS NULL;

  IF v_purchase_price IS NOT NULL AND v_purchase_price > 0 THEN
    IF v_purchase_date IS NOT NULL THEN
      v_baseline_date := v_purchase_date; v_baseline_anchored := false;
    ELSIF v_min_receipt_date IS NOT NULL THEN
      v_baseline_date := v_min_receipt_date; v_baseline_anchored := true;
    END IF;
    IF v_baseline_date IS NOT NULL THEN
      v_has_baseline := true; v_final := v_purchase_price;
    END IF;
  END IF;

  WITH evt AS (
    SELECT v_baseline_date AS d, NULL::uuid AS rid, true AS is_baseline,
           v_purchase_price AS amt, NULL::text AS vn, v_baseline_anchored AS anchored
    WHERE v_has_baseline
    UNION ALL
    SELECT coalesce(r.receipt_date, r.transaction_date, r.purchase_date) AS d,
           r.id AS rid, false AS is_baseline,
           coalesce(r.total_amount, r.total) AS amt, r.vendor_name AS vn, false AS anchored
    FROM receipts r
    WHERE r.vehicle_id = p_vehicle AND r.superseded_at IS NULL
      AND coalesce(r.receipt_date, r.transaction_date, r.purchase_date) IS NOT NULL
  ),
  calc AS (
    SELECT evt.*, row_number() OVER w AS ord, sum(amt) OVER w AS running
    FROM evt
    WINDOW w AS (ORDER BY d, is_baseline DESC, rid NULLS FIRST ROWS UNBOUNDED PRECEDING)
  )
  SELECT
    coalesce(jsonb_agg(
      CASE WHEN is_baseline THEN
        jsonb_build_object('date', d, 'delta', round(amt, 2), 'cumulative', round(running, 2),
          'kind', 'purchase', 'proven', true, 'anchored_date', anchored,
          'source', CASE WHEN v_owner THEN
                      CASE WHEN anchored THEN 'vehicles.purchase_price (date anchored to first receipt)'
                           ELSE 'vehicles.purchase_price' END ELSE NULL END)
      ELSE
        jsonb_build_object('date', d, 'delta', round(amt, 2), 'cumulative', round(running, 2),
          'kind', 'parts', 'proven', true,
          'source', CASE WHEN v_owner THEN coalesce(nullif(vn, ''), 'receipts') ELSE NULL END)
      END
      ORDER BY ord), '[]'::jsonb),
    v_final + coalesce(sum(amt) FILTER (WHERE NOT is_baseline), 0)
  INTO v_points, v_final
  FROM calc;

  IF v_has_baseline THEN
    v_baseline := jsonb_build_object('date', v_baseline_date,
      'delta', round(v_purchase_price, 2), 'cumulative', round(v_purchase_price, 2),
      'kind', 'purchase', 'proven', true, 'anchored_date', v_baseline_anchored,
      'source', CASE WHEN v_owner THEN
                  CASE WHEN v_baseline_anchored THEN 'vehicles.purchase_price (date anchored to first receipt)'
                       ELSE 'vehicles.purchase_price' END ELSE NULL END);
  END IF;

  RETURN jsonb_build_object('vehicle_id', p_vehicle, 'is_owner_view', v_owner,
    'n_points', jsonb_array_length(v_points),
    'baseline', coalesce(v_baseline, jsonb_build_object('present', false,
                  'note', 'No purchase_price or no dated receipt to anchor a baseline.')),
    'points', v_points,
    'undated', jsonb_build_object('n_undated', v_n_undated, 'undated_total', round(v_undated_total, 2)),
    'final_cumulative_dated', round(v_final, 2),
    'total_with_undated', round(v_final + v_undated_total, 2));
END;
$function$
;
