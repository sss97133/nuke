-- 20260623040000_fix_register_swap_and_investment_timeline.sql
-- Two surgical correctness fixes found in code review 2026-06-23. Additive
-- CREATE OR REPLACE; mirrors what is now applied to prod qkgaybvrernstplzjaam.
--
-- FIX 1 — register_make_model_subject (introduced 20260622220000):
--   The inverted-bounds guard used the uuid-typed v_id as a swap temp for two
--   integer years:  v_id := v_ys; v_ys := v_ye; v_ye := v_id; v_id := NULL;
--   Assigning an integer to a uuid variable raises 22P02 (invalid input syntax
--   for type uuid) and aborts the whole function. It never fires for the seeded
--   subjects (bounds already ordered) but ANY caller passing year_start>year_end
--   for a model/generation grain crashes instead of registering. Fixed with a
--   dedicated integer temp v_swap.
--
-- FIX 2 — get_vehicle_investment_timeline (introduced 20260622060000):
--   (a) final_cumulative_dated used coalesce(max(running), v_final) over a
--       running cumulative. With a negative dated receipt (refund/credit/
--       correcting entry) late in the curve the running sum peaks then dips, so
--       max() returns an intermediate peak — overstating the total and breaking
--       reconciliation with the proof. Replaced with baseline + sum(all dated
--       deltas), which is order- and sign-independent (the true final).
--   (b) The baseline purchase point was unconditionally prepended at index 0,
--       even when purchase_date falls AFTER the earliest receipt date — yielding
--       a non-monotonic time axis and a cumulative seeded out of order. The
--       baseline is now merged into the same date-ordered window as the receipts
--       (tie-break baseline-first on equal dates, preserving the normal case),
--       so points are chronological and cumulative is monotonic in real time.
--   No fabricated dates; an undated purchase still anchors only to the earliest
--   real receipt date. Output is byte-identical for normally-dated, all-positive
--   vehicles (verified against the K5 e08bf694: n_points 207, final 32808.25).

-- ── FIX 1 ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.register_make_model_subject(
  p_make text,
  p_model text,
  p_year integer DEFAULT NULL,
  p_grain text DEFAULT 'year',
  p_year_start integer DEFAULT NULL,
  p_year_end integer DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_id uuid;
  v_cm public.canonical_models%ROWTYPE;
  v_ys integer;
  v_ye integer;
  v_swap integer;                       -- [FIX] integer swap temp (was the uuid v_id)
  v_max_year integer := extract(year from now())::int + 1;
BEGIN
  IF p_make IS NULL OR length(trim(p_make)) < 1
     OR p_model IS NULL OR length(trim(p_model)) < 1 THEN
    RETURN NULL;
  END IF;
  IF p_grain NOT IN ('year','generation','model') THEN
    RETURN NULL;
  END IF;
  IF p_grain = 'year' AND (p_year IS NULL OR p_year < 1885 OR p_year > v_max_year) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_cm FROM public.canonical_models cm
   WHERE lower(cm.make) = lower(p_make)
     AND (lower(cm.canonical_model) = lower(p_model)
          OR lower(p_model) = ANY (SELECT lower(a) FROM unnest(cm.aliases) a))
   LIMIT 1;

  IF p_grain <> 'year' THEN
    v_ys := COALESCE(p_year_start, v_cm.year_start, 1885);
    v_ye := COALESCE(p_year_end, v_cm.year_end, v_max_year);
    IF v_ys > v_ye THEN
      v_swap := v_ys; v_ys := v_ye; v_ye := v_swap;   -- [FIX] integer swap, no uuid coercion
    END IF;
    IF v_ye > v_max_year THEN v_ye := v_max_year; END IF;
    IF v_ys < 1885 THEN v_ys := 1885; END IF;
  END IF;

  INSERT INTO public.make_model_profiles
    (canonical_make, canonical_model, grain, year, year_start, year_end, canonical_model_id)
  VALUES (
    upper(COALESCE(v_cm.make, p_make)),
    COALESCE(v_cm.canonical_model, p_model),
    p_grain,
    CASE WHEN p_grain = 'year' THEN p_year END,
    CASE WHEN p_grain <> 'year' THEN v_ys END,
    CASE WHEN p_grain <> 'year' THEN v_ye END,
    v_cm.id
  )
  ON CONFLICT (canonical_make, canonical_model, year, grain) DO UPDATE
    SET updated_at  = now(),
        year_start  = COALESCE(EXCLUDED.year_start, public.make_model_profiles.year_start),
        year_end    = COALESCE(EXCLUDED.year_end,   public.make_model_profiles.year_end),
        canonical_model_id = COALESCE(EXCLUDED.canonical_model_id, public.make_model_profiles.canonical_model_id)
  RETURNING subject_id INTO v_id;
  RETURN v_id;
END;
$function$;

-- ── FIX 2 ────────────────────────────────────────────────────────────────────
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

  -- Resolve the baseline purchase point (date only; the point itself is built in
  -- the merged window below so its cumulative respects real chronological order).
  IF v_purchase_price IS NOT NULL AND v_purchase_price > 0 THEN
    IF v_purchase_date IS NOT NULL THEN
      v_baseline_date := v_purchase_date;
      v_baseline_anchored := false;
    ELSIF v_min_receipt_date IS NOT NULL THEN
      v_baseline_date := v_min_receipt_date;   -- anchored to a REAL observed date, not invented
      v_baseline_anchored := true;
    END IF;
    IF v_baseline_date IS NOT NULL THEN
      v_has_baseline := true;
      v_final := v_purchase_price;
    END IF;
  END IF;

  -- Merge the baseline purchase and every dated receipt into ONE date-ordered
  -- window. Baseline sorts first on an equal date (is_baseline DESC) so the
  -- normal case is unchanged; when purchase_date is later than an early receipt
  -- the curve stays monotonic in real time. cumulative = running sum in that
  -- order; final = baseline + sum(all dated deltas) (order/sign independent).
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
    SELECT evt.*,
           row_number() OVER w AS ord,
           sum(amt) OVER w AS running
    FROM evt
    WINDOW w AS (ORDER BY d, is_baseline DESC, rid NULLS FIRST ROWS UNBOUNDED PRECEDING)
  )
  SELECT
    coalesce(jsonb_agg(
      CASE WHEN is_baseline THEN
        jsonb_build_object(
          'date', d, 'delta', round(amt, 2), 'cumulative', round(running, 2),
          'kind', 'purchase', 'proven', true, 'anchored_date', anchored,
          'source', CASE WHEN v_owner THEN
                      CASE WHEN anchored
                           THEN 'vehicles.purchase_price (date anchored to first receipt)'
                           ELSE 'vehicles.purchase_price' END
                    ELSE NULL END)
      ELSE
        jsonb_build_object(
          'date', d, 'delta', round(amt, 2), 'cumulative', round(running, 2),
          'kind', 'parts', 'proven', true,
          'source', CASE WHEN v_owner THEN coalesce(nullif(vn, ''), 'receipts') ELSE NULL END)
      END
      ORDER BY ord), '[]'::jsonb),
    v_final + coalesce(sum(amt) FILTER (WHERE NOT is_baseline), 0)
  INTO v_points, v_final
  FROM calc;

  -- Rebuild the baseline summary object (for the top-level 'baseline' field).
  IF v_has_baseline THEN
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
                ELSE NULL END);
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
