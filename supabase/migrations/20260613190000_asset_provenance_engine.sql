-- Asset-provenance engine — deployed via MCP this session; captured here for
-- drift-repair (prod SQL belongs in committed migrations).
--
-- 1) get_user_day_receipt was enriched (separate deploy) to join money
--    (payment_events: direction/amount/counterparty) + events (component_events),
--    each item carrying its source row id. See migration ...surface_image_atoms...
--    plus the money/people/events deploy.
-- 2) This file captures the VEHICLE investment proof + the work-session
--    confirmation that flips projected labor → proven.

-- work_sessions owner-confirmation = the proven/projected boundary for labor.
ALTER TABLE work_sessions ADD COLUMN IF NOT EXISTS owner_confirmed_at timestamptz;
ALTER TABLE work_sessions ADD COLUMN IF NOT EXISTS owner_confirmed_by uuid;

-- The asset-provenance core: a vehicle's whole investment file, PROVEN
-- (receipts + scoped payments + owner-confirmed labor) vs PROJECTED
-- (unconfirmed labor) + MARKET (nuke_estimate) + ROI. Every cell carries its
-- source table; owner sees the raw rows (PII counterparties), everyone sees
-- the aggregate proof. Reuses receipts / payment_events / work_sessions /
-- nuke_estimates — no new value machinery.
CREATE OR REPLACE FUNCTION public.compute_vehicle_investment_proof(p_vehicle_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_owner boolean;
  v_parts numeric; v_parts_n int;
  v_in numeric; v_out numeric; v_pay_n int;
  v_labor_proj numeric; v_labor_conf numeric; v_labor_n int;
  v_market numeric;
  v_invested_proven numeric; v_invested_total numeric;
  v_audit jsonb := '{}'::jsonb;
BEGIN
  SELECT (auth.uid() IS NOT NULL AND auth.uid() IN (owner_id, user_id, created_by_user_id))
  INTO v_owner FROM vehicles WHERE id = p_vehicle_id;
  v_owner := COALESCE(v_owner, false);

  SELECT coalesce(sum(coalesce(total_amount, total)),0), count(*) INTO v_parts, v_parts_n
  FROM receipts WHERE vehicle_id = p_vehicle_id AND superseded_at IS NULL;

  SELECT coalesce(sum(amount_usd) filter (where direction='in'),0),
         coalesce(sum(amount_usd) filter (where direction='out'),0), count(*)
  INTO v_in, v_out, v_pay_n
  FROM payment_events WHERE scope_type='vehicle' AND scope_id = p_vehicle_id AND NOT is_superseded;

  SELECT coalesce(sum(total_job_cost) filter (where owner_confirmed_at IS NULL),0),
         coalesce(sum(total_job_cost) filter (where owner_confirmed_at IS NOT NULL),0), count(*)
  INTO v_labor_proj, v_labor_conf, v_labor_n
  FROM work_sessions WHERE vehicle_id = p_vehicle_id;

  SELECT estimated_value INTO v_market FROM nuke_estimates
  WHERE vehicle_id = p_vehicle_id ORDER BY confidence_score DESC NULLS LAST LIMIT 1;

  v_invested_proven := v_parts + v_out + v_labor_conf;
  v_invested_total  := v_invested_proven + v_labor_proj;

  IF v_owner THEN
    SELECT jsonb_build_object(
      'receipts', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'vendor',vendor_name,
          'amount',round(coalesce(total_amount,total)),'date',coalesce(receipt_date,transaction_date,purchase_date),
          'source','receipts') ORDER BY coalesce(total_amount,total) DESC NULLS LAST),'[]'::jsonb)
        FROM receipts WHERE vehicle_id=p_vehicle_id AND superseded_at IS NULL),
      'payments', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'direction',direction,'amount',round(amount_usd),
          'counterparty',counterparty_name,'confirmation',confirmation_number,'description',description,
          'source','payment_events') ORDER BY paid_at),'[]'::jsonb)
        FROM payment_events WHERE scope_type='vehicle' AND scope_id=p_vehicle_id AND NOT is_superseded),
      'work_sessions', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'date',session_date,
          'cost',round(total_job_cost),'confirmed',owner_confirmed_at IS NOT NULL,'source','work_sessions')
          ORDER BY session_date),'[]'::jsonb)
        FROM work_sessions WHERE vehicle_id=p_vehicle_id)
    ) INTO v_audit;
  END IF;

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id, 'is_owner_view', v_owner,
    'proven', jsonb_build_object(
      'parts',           jsonb_build_object('value', round(v_parts),      'count', v_parts_n, 'source','receipts',                    'confidence','high'),
      'confirmed_labor', jsonb_build_object('value', round(v_labor_conf),                     'source','work_sessions:owner_confirmed','confidence','high'),
      'money_in',        jsonb_build_object('value', round(v_in),         'count', v_pay_n,   'source','payment_events',              'confidence','high'),
      'money_out',       jsonb_build_object('value', round(v_out),                            'source','payment_events',              'confidence','high')),
    'projected', jsonb_build_object(
      'labor', jsonb_build_object('value', round(v_labor_proj), 'count', v_labor_n, 'source','work_sessions:unconfirmed', 'confidence','low')),
    'market', jsonb_build_object('value', round(coalesce(v_market,0)), 'source','nuke_estimates',
              'confidence', CASE WHEN v_market IS NULL THEN 'none' ELSE 'modeled' END),
    'totals', jsonb_build_object(
      'invested_proven', round(v_invested_proven), 'invested_with_projected', round(v_invested_total),
      'proven_income', round(v_in), 'net_proven', round(v_in - v_invested_proven),
      'roi_proven_pct', CASE WHEN v_invested_proven > 0 THEN round((v_in - v_invested_proven)/v_invested_proven*100) ELSE NULL END),
    'audit', v_audit);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.compute_vehicle_investment_proof(uuid) TO authenticated, anon;

-- Owner confirms a session was real labor → projected becomes proven.
CREATE OR REPLACE FUNCTION public.confirm_work_session(p_session_id uuid, p_confirm boolean DEFAULT true)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_owner uuid;
BEGIN
  SELECT user_id INTO v_owner FROM work_sessions WHERE id = p_session_id;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  IF p_confirm THEN
    UPDATE work_sessions SET owner_confirmed_at = now(), owner_confirmed_by = auth.uid() WHERE id = p_session_id;
  ELSE
    UPDATE work_sessions SET owner_confirmed_at = NULL, owner_confirmed_by = NULL WHERE id = p_session_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'session_id', p_session_id, 'confirmed', p_confirm);
END;
$function$;
REVOKE ALL ON FUNCTION public.confirm_work_session(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirm_work_session(uuid, boolean) TO authenticated;
