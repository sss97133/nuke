-- The investment proof and the investment timeline carry the owner's money only to the owner.
--
-- Measured 2026-10-13 16:40Z as an anonymous caller: compute_vehicle_investment_proof (SECURITY DEFINER,
-- EXECUTE for anon) returned proven parts, projected labor and three invested totals for a public vehicle
-- (only its audit and by_party detail sat behind the owner check), and get_vehicle_investment_timeline
-- returned every receipt's delta and running total plus the undated and overall totals. The iOS app
-- rendered these to anonymous viewers; the web masked them client-side since #1001. Neither function
-- checked that the vehicle is public.
--
-- Both now resolve the caller once (owner, uploader or a contributor with access, the rule of #1001 and
-- #1037) and, for everyone else, return the same record with the owner's figures set to null
-- (jsonb_mask_keys, recursive, by key list) and money_masked = true; counts, dates, kinds and the modeled
-- market estimate stay. A private vehicle reads as NULL for anyone its policies exclude. Same signatures,
-- grants and SECURITY DEFINER. Built from the live definitions (supabase/sql/helpers/*_live_20261013.sql),
-- guarded by their source hashes and by this migration's own result.
BEGIN;
SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='1s';

DO $guard$
DECLARE a text; b text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO a FROM pg_proc WHERE oid = 'public.compute_vehicle_investment_proof(uuid)'::regprocedure;
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO b FROM pg_proc WHERE oid = 'public.get_vehicle_investment_timeline(uuid)'::regprocedure;
  IF a NOT IN ('IUK6Mq03wXdR8rq+xhWVNoKCKYimIjDG6Ji972DxZ/U=', '7bR1LqCWsVFSs4t8IGAViy+LsPD+ux8e/KUJb8wP4Qc=')
     OR b NOT IN ('VRjB64U3TbTzrl4/xsZtUWykLxwzx/5gtj4VGQQ6yxc=', 'g7lgMoeskrbqLENUnS7muxtL6dX8Lq7XYCtrUHj7L44=') THEN
    RAISE EXCEPTION 'compute_vehicle_investment_proof or get_vehicle_investment_timeline differs from the reviewed definition';
  END IF;
  IF to_regprocedure('public.vehicle_user_has_access(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'vehicle_user_has_access is missing';
  END IF;
END $guard$;

-- The named keys set to null at any depth; everything else unchanged.
CREATE OR REPLACE FUNCTION public.jsonb_mask_keys(j jsonb, p_keys text[])
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE jsonb_typeof(j)
    WHEN 'object' THEN coalesce((
      SELECT jsonb_object_agg(e.k, CASE WHEN e.k = ANY (p_keys) THEN 'null'::jsonb ELSE public.jsonb_mask_keys(e.v, p_keys) END)
      FROM jsonb_each(j) AS e(k, v)), '{}'::jsonb)
    WHEN 'array' THEN coalesce((
      SELECT jsonb_agg(public.jsonb_mask_keys(a.e, p_keys) ORDER BY a.o)
      FROM jsonb_array_elements(j) WITH ORDINALITY AS a(e, o)), '[]'::jsonb)
    ELSE j END;
$$;
COMMENT ON FUNCTION public.jsonb_mask_keys(jsonb, text[]) IS
  'Returns the document with the named keys set to null at any depth and everything else unchanged. Readers that serve one record to owners and readers alike mask the owner''s figures with it.';
REVOKE ALL ON FUNCTION public.jsonb_mask_keys(jsonb, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.jsonb_mask_keys(jsonb, text[]) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.compute_vehicle_investment_proof(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner boolean;
  v_visible boolean;
  v_doc jsonb;
  v_parts numeric; v_parts_n int;
  v_in numeric; v_out numeric; v_pay_n int;
  v_attr_out numeric; v_attr_in numeric; v_attr_n int;
  v_labor_proj numeric; v_labor_conf numeric; v_labor_n int;
  v_burst_min bigint;
  v_rate_info jsonb; v_rate_usd numeric; v_rate_conf text;
  v_market numeric;
  v_invested_proven numeric; v_invested_attr numeric; v_invested_total numeric;
  v_audit jsonb := '{}'::jsonb;
  v_by_party jsonb := '[]'::jsonb;
BEGIN
  -- Money is the owner's (owner rule, 2026-09-28): the signed-in owner, uploader or a contributor with
  -- access sees it; every other caller gets the same record with its money masked. A private vehicle
  -- reads as NULL for anyone its policies exclude.
  SELECT (auth.uid() IS NOT NULL AND (auth.uid() IN (owner_id, user_id, created_by_user_id, uploaded_by)
            OR public.vehicle_user_has_access(id, auth.uid()))),
         coalesce(is_public, false)
  INTO v_owner, v_visible FROM vehicles WHERE id = p_vehicle_id;
  v_owner := COALESCE(v_owner, false);
  IF NOT (coalesce(v_visible, false) OR v_owner) THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(sum(coalesce(total_amount, total)),0), count(*) INTO v_parts, v_parts_n
  FROM receipts WHERE vehicle_id = p_vehicle_id AND superseded_at IS NULL;

  SELECT coalesce(sum(amount_usd) filter (where direction='in'  and coalesce(method,'') <> 'owner_attestation'),0),
         coalesce(sum(amount_usd) filter (where direction='out' and coalesce(method,'') <> 'owner_attestation'),0),
         count(*) filter (where coalesce(method,'') <> 'owner_attestation')
  INTO v_in, v_out, v_pay_n
  FROM payment_events WHERE scope_type='vehicle' AND scope_id = p_vehicle_id AND NOT is_superseded;

  SELECT coalesce(sum(amount_usd) filter (where direction='out'),0),
         coalesce(sum(amount_usd) filter (where direction='in'),0), count(*)
  INTO v_attr_out, v_attr_in, v_attr_n
  FROM payment_events WHERE scope_type='vehicle' AND scope_id = p_vehicle_id
    AND NOT is_superseded AND method='owner_attestation';

  SELECT coalesce(sum(total_job_cost) filter (where owner_confirmed_at IS NOT NULL),0), count(*)
  INTO v_labor_conf, v_labor_n
  FROM work_sessions WHERE vehicle_id = p_vehicle_id;

  -- One honest rate source: reported facts win, else market-derived spitball.
  v_rate_info := resolve_labor_rate(p_vehicle_id := p_vehicle_id);
  v_rate_usd  := (v_rate_info->>'rate')::numeric;
  v_rate_conf := v_rate_info->>'rate_confidence';
  v_burst_min := compute_active_minutes_burst_total(p_vehicle_id, 30);
  v_labor_proj := greatest(0, (v_burst_min::numeric / 60) * v_rate_usd * 0.92 - v_labor_conf);

  SELECT estimated_value INTO v_market FROM nuke_estimates
  WHERE vehicle_id = p_vehicle_id ORDER BY confidence_score DESC NULLS LAST LIMIT 1;

  v_invested_proven := v_parts + v_out + v_labor_conf;
  v_invested_attr   := v_invested_proven + v_attr_out;
  v_invested_total  := v_invested_attr + v_labor_proj;

  IF v_owner THEN
    SELECT jsonb_build_object(
      'receipts', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'vendor',vendor_name,
          'amount',round(coalesce(total_amount,total)),'date',coalesce(receipt_date,transaction_date,purchase_date),
          'source','receipts') ORDER BY coalesce(total_amount,total) DESC NULLS LAST),'[]'::jsonb)
        FROM receipts WHERE vehicle_id=p_vehicle_id AND superseded_at IS NULL),
      'payments', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'direction',direction,'amount',round(amount_usd),
          'counterparty',counterparty_name,'method',method,'confirmation',confirmation_number,'description',description,
          'source','payment_events') ORDER BY paid_at),'[]'::jsonb)
        FROM payment_events WHERE scope_type='vehicle' AND scope_id=p_vehicle_id AND NOT is_superseded),
      'work_sessions', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'date',session_date,
          'cost',round(total_job_cost),'confirmed',owner_confirmed_at IS NOT NULL,'source','work_sessions')
          ORDER BY session_date),'[]'::jsonb)
        FROM work_sessions WHERE vehicle_id=p_vehicle_id)
    ) INTO v_audit;

    SELECT coalesce(jsonb_agg(p ORDER BY (p->>'total')::numeric DESC),'[]'::jsonb)
    INTO v_by_party
    FROM (
      SELECT jsonb_build_object(
        'party', coalesce(nullif(counterparty_name,''),'(unattributed)'),
        'direction', direction, 'count', count(*), 'total', round(sum(amount_usd)),
        'trust', case when coalesce(method,'')='owner_attestation' then 'attributed' else 'proven' end,
        'source','payment_events'
      ) AS p
      FROM payment_events
      WHERE scope_type='vehicle' AND scope_id=p_vehicle_id AND NOT is_superseded
      GROUP BY coalesce(nullif(counterparty_name,''),'(unattributed)'), direction,
               case when coalesce(method,'')='owner_attestation' then 'attributed' else 'proven' end
    ) q;
  END IF;

  v_doc := jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'is_owner_view', v_owner,
    'proven', jsonb_build_object(
      'parts',           jsonb_build_object('value', round(v_parts),      'count', v_parts_n, 'source','receipts',                  'confidence','high'),
      'confirmed_labor', jsonb_build_object('value', round(v_labor_conf),                     'source','work_sessions:owner_confirmed','confidence','high'),
      'money_in',        jsonb_build_object('value', round(v_in),         'count', v_pay_n,   'source','payment_events',            'confidence','high'),
      'money_out',       jsonb_build_object('value', round(v_out),                            'source','payment_events',            'confidence','high')
    ),
    'attributed', jsonb_build_object(
      'cost',   jsonb_build_object('value', round(v_attr_out), 'count', v_attr_n, 'source','payment_events:owner_attestation', 'confidence','owner_stated'),
      'income', jsonb_build_object('value', round(v_attr_in),                     'source','payment_events:owner_attestation', 'confidence','owner_stated')
    ),
    'projected', jsonb_build_object(
      'labor', jsonb_build_object('value', round(v_labor_proj), 'count', v_labor_n,
               'source','work_sessions + vehicle_images burst clustering',
               'method', format('burst %s min ÷ 60 × $%s/hr (%s) × 0.92, net of confirmed', v_burst_min, v_rate_usd, v_rate_info->>'source'),
               'rate_note', v_rate_info->>'note',
               'confidence', coalesce(v_rate_conf, CASE WHEN v_burst_min = 0 THEN 'none' ELSE 'spitball' END))
    ),
    'market', jsonb_build_object('value', round(coalesce(v_market,0)), 'source','nuke_estimates',
              'confidence', CASE WHEN v_market IS NULL THEN 'none' ELSE 'modeled' END),
    'totals', jsonb_build_object(
      'invested_proven',         round(v_invested_proven),
      'invested_with_attributed',round(v_invested_attr),
      'invested_with_projected', round(v_invested_total),
      'proven_income',           round(v_in),
      'net_proven',              round(v_in - v_invested_proven),
      'roi_proven_pct',          CASE WHEN v_invested_proven > 0 THEN round((v_in - v_invested_proven)/v_invested_proven*100) ELSE NULL END
    ),
    'by_party', v_by_party,
    'audit', v_audit
  );
  IF NOT v_owner THEN
    -- Every figure of the owner's money masked; the modeled market estimate is not the owner's money and stays.
    v_doc := public.jsonb_mask_keys(v_doc - 'market',
               ARRAY['value', 'invested_proven', 'invested_with_attributed', 'invested_with_projected',
                     'proven_income', 'net_proven', 'roi_proven_pct', 'method', 'rate_note'])
             || jsonb_build_object('market', v_doc->'market');
  END IF;
  RETURN v_doc || jsonb_build_object('money_masked', NOT v_owner);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_vehicle_investment_timeline(p_vehicle uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner boolean;
  v_visible boolean;
  v_doc jsonb;
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
  -- Money is the owner's (owner rule, 2026-09-28): the signed-in owner, uploader or a contributor with
  -- access sees it; every other caller gets the same curve with its amounts masked. A private vehicle
  -- reads as NULL for anyone its policies exclude.
  SELECT (auth.uid() IS NOT NULL AND (auth.uid() IN (owner_id, user_id, created_by_user_id, uploaded_by)
            OR public.vehicle_user_has_access(id, auth.uid()))),
         coalesce(is_public, false), purchase_price, purchase_date
  INTO v_owner, v_visible, v_purchase_price, v_purchase_date
  FROM vehicles WHERE id = p_vehicle;
  v_owner := COALESCE(v_owner, false);
  IF NOT (coalesce(v_visible, false) OR v_owner) THEN
    RETURN NULL;
  END IF;

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

  v_doc := jsonb_build_object('vehicle_id', p_vehicle, 'is_owner_view', v_owner,
    'n_points', jsonb_array_length(v_points),
    'baseline', coalesce(v_baseline, jsonb_build_object('present', false,
                  'note', 'No purchase_price or no dated receipt to anchor a baseline.')),
    'points', v_points,
    'undated', jsonb_build_object('n_undated', v_n_undated, 'undated_total', round(v_undated_total, 2)),
    'final_cumulative_dated', round(v_final, 2),
    'total_with_undated', round(v_final + v_undated_total, 2));
  IF NOT v_owner THEN
    v_doc := public.jsonb_mask_keys(v_doc, ARRAY['delta', 'cumulative', 'undated_total', 'final_cumulative_dated', 'total_with_undated']);
  END IF;
  RETURN v_doc || jsonb_build_object('money_masked', NOT v_owner);
END;
$function$;

COMMIT;
