-- Operator-approved product direction: customers pay Nuke; credentials stay on the server.
-- Atomic monetary writer proposal. No balances, plans, payment events or user grants are changed here.
BEGIN;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';

CREATE OR REPLACE FUNCTION public.reserve_ai_credit_hold(
  p_user_id uuid, p_cents bigint, p_ref text, p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public SET lock_timeout = '2s'
AS $function$
DECLARE v_id uuid; v_available bigint;
BEGIN
  IF p_user_id IS NULL OR p_cents IS NULL OR p_cents < 1 OR p_cents > 100000000
     OR p_ref IS NULL OR length(p_ref) NOT BETWEEN 1 AND 200
     OR jsonb_typeof(p_metadata) IS DISTINCT FROM 'object' OR octet_length(p_metadata::text)>16384 THEN
    RAISE EXCEPTION 'invalid credit reservation';
  END IF;
  -- Every debit writer takes this same per-account transaction lock. No dummy account rows.
  PERFORM pg_advisory_xact_lock(hashtextextended('ai-credit:'||p_user_id::text, 0));
  IF p_ref LIKE 'photo:v1:%' AND EXISTS (
    SELECT 1 FROM public.ai_credit_ledger h WHERE h.user_id=p_user_id AND h.entry_type='hold' AND h.ref=p_ref
      AND (h.status='open' OR EXISTS (
        SELECT 1 FROM public.ai_credit_ledger s WHERE s.hold_id=h.id AND s.entry_type='settle'
          AND s.metadata->>'provider_read' IN ('completed','unreadable','unknown')))
  ) THEN RETURN jsonb_build_object('status','duplicate'); END IF;
  SELECT public.ai_credit_available_cents(p_user_id) INTO v_available;
  IF v_available < p_cents THEN RETURN jsonb_build_object('status','insufficient_funds'); END IF;
  INSERT INTO public.ai_credit_ledger(user_id,entry_type,amount_cents,status,ref,metadata)
  VALUES(p_user_id,'hold',-p_cents,'open',p_ref,p_metadata) RETURNING id INTO v_id;
  RETURN jsonb_build_object('status','reserved','hold_id',v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_ai_credit_hold(
  p_user_id uuid, p_hold_id uuid, p_cents bigint, p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public SET lock_timeout = '2s'
AS $function$
DECLARE v_hold public.ai_credit_ledger%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR p_hold_id IS NULL OR p_cents IS NULL OR p_cents < 0
     OR jsonb_typeof(p_metadata) IS DISTINCT FROM 'object' OR octet_length(p_metadata::text)>16384 THEN
    RAISE EXCEPTION 'invalid credit settlement';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ai-credit:'||p_user_id::text, 0));
  SELECT * INTO v_hold FROM public.ai_credit_ledger WHERE id=p_hold_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND OR v_hold.entry_type<>'hold' OR v_hold.amount_cents>=0 THEN RAISE EXCEPTION 'credit hold not found'; END IF;
  IF v_hold.status='closed' THEN RETURN jsonb_build_object('status','already_settled'); END IF;
  IF p_cents > -v_hold.amount_cents THEN RAISE EXCEPTION 'charge exceeds reserved credit'; END IF;
  -- Closing and recording the charge are one transaction, including explicit zero-charge releases.
  INSERT INTO public.ai_credit_ledger(user_id,entry_type,amount_cents,hold_id,status,ref,metadata)
  VALUES(p_user_id,'settle',-p_cents,p_hold_id,'closed','settle',p_metadata);
  UPDATE public.ai_credit_ledger SET status='closed' WHERE id=p_hold_id;
  RETURN jsonb_build_object('status','settled');
END;
$function$;

REVOKE ALL ON FUNCTION public.reserve_ai_credit_hold(uuid,bigint,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.settle_ai_credit_hold(uuid,uuid,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_credit_hold(uuid,bigint,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_ai_credit_hold(uuid,uuid,bigint,jsonb) TO service_role;
COMMIT;
