-- Per-party RUNG 2: the attributed / owner-stated cost rung.
-- Closes the proof's blind spot: paid-by-other (no receipt) + gifted/free value.
-- Stored as payment_events with method='owner_attestation' (no new table).

CREATE OR REPLACE FUNCTION public.record_owner_contribution(
  p_vehicle_id uuid, p_party text, p_amount numeric,
  p_direction text DEFAULT 'out', p_basis text DEFAULT NULL, p_evidence_image_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_owner boolean; v_id uuid;
BEGIN
  SELECT (auth.uid() IS NOT NULL AND auth.uid() IN (owner_id, user_id, created_by_user_id))
  INTO v_owner FROM vehicles WHERE id = p_vehicle_id;
  IF NOT COALESCE(v_owner,false) THEN RAISE EXCEPTION 'not authorized for this vehicle'; END IF;
  IF p_direction NOT IN ('in','out') THEN RAISE EXCEPTION 'direction must be in or out'; END IF;
  IF COALESCE(p_amount,0) <= 0 THEN RAISE EXCEPTION 'amount must be positive'; END IF;
  INSERT INTO payment_events(user_id, direction, amount_usd, paid_at, method,
    counterparty_name, scope_type, scope_id, description, source_metadata)
  VALUES (auth.uid(), p_direction, p_amount, now(), 'owner_attestation',
    nullif(p_party,''), 'vehicle', p_vehicle_id, p_basis,
    jsonb_build_object('trust','owner_stated','basis',p_basis,
      'evidence_image_id',p_evidence_image_id,'recorded_via','ios_attest'))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_owner_contribution(uuid,text,numeric,text,text,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.compute_vehicle_investment_proof(p_vehicle_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_owner boolean;
  v_parts numeric; v_parts_n int;
  v_in numeric; v_out numeric; v_pay_n int;
  v_attr_out numeric; v_attr_in numeric; v_attr_n int;
  v_labor_proj numeric; v_labor_conf numeric; v_labor_n int;
  v_market numeric;
  v_invested_proven numeric; v_invested_attr numeric; v_invested_total numeric;
  v_audit jsonb := '{}'::jsonb;
  v_by_party jsonb := '[]'::jsonb;
BEGIN
  SELECT (auth.uid() IS NOT NULL AND auth.uid() IN (owner_id, user_id, created_by_user_id))
  INTO v_owner FROM vehicles WHERE id = p_vehicle_id;
  v_owner := COALESCE(v_owner, false);

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

  SELECT coalesce(sum(total_job_cost) filter (where owner_confirmed_at IS NULL),0),
         coalesce(sum(total_job_cost) filter (where owner_confirmed_at IS NOT NULL),0), count(*)
  INTO v_labor_proj, v_labor_conf, v_labor_n
  FROM work_sessions WHERE vehicle_id = p_vehicle_id;

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
        'direction', direction,
        'count', count(*),
        'total', round(sum(amount_usd)),
        'trust', case when coalesce(method,'')='owner_attestation' then 'attributed' else 'proven' end,
        'source','payment_events'
      ) AS p
      FROM payment_events
      WHERE scope_type='vehicle' AND scope_id=p_vehicle_id AND NOT is_superseded
      GROUP BY coalesce(nullif(counterparty_name,''),'(unattributed)'), direction,
               case when coalesce(method,'')='owner_attestation' then 'attributed' else 'proven' end
    ) q;
  END IF;

  RETURN jsonb_build_object(
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
      'labor', jsonb_build_object('value', round(v_labor_proj), 'count', v_labor_n, 'source','work_sessions:unconfirmed', 'confidence','low')
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
END;
$function$;
