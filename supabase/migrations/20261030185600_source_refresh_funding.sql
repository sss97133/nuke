-- Reuse the existing payment testimony and operational run store. No provider
-- balance, source switch, wallet grant or paid capacity is enabled by this migration.
BEGIN;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';

CREATE INDEX IF NOT EXISTS extraction_runs_funded_source_refresh
ON public.extraction_runs(started_at,id)
WHERE source='source-refresh-funding' AND status IN ('funded','dispatching');
CREATE UNIQUE INDEX IF NOT EXISTS payment_events_source_refresh_session
ON public.payment_events(confirmation_number)
WHERE source_metadata->>'contract'='source_refresh_funding_v1';

CREATE OR REPLACE FUNCTION public.record_source_refresh_payment(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE r public.extraction_runs%ROWTYPE; payment_id uuid;
BEGIN
  IF p->>'payment_status' IS DISTINCT FROM 'paid' OR p->>'currency' IS DISTINCT FROM 'usd'
     OR p->>'amount_cents' IS NULL OR p->>'amount_cents' !~ '^[0-9]{1,6}$'
     OR (p->>'amount_cents')::bigint NOT BETWEEN 100 AND 10000
     OR coalesce(p->>'session_id','') !~ '^cs_live_[A-Za-z0-9]{1,240}$'
     OR coalesce(p->>'event_id','') !~ '^evt_[A-Za-z0-9]{1,240}$'
     OR p->>'paid_at' IS NULL OR p->>'paid_at' !~ '^[0-9]{1,12}$'
     OR p->'livemode' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'invalid source funding payment' USING ERRCODE='22023';
  END IF;
  SELECT * INTO r FROM public.extraction_runs WHERE id=(p->>'request_id')::uuid
    AND source='source-refresh-funding' FOR UPDATE;
  IF NOT FOUND OR r.metadata->>'contract' IS DISTINCT FROM 'source_refresh_funding_v1'
     OR r.metadata->>'user_id' IS DISTINCT FROM p->>'user_id'
     OR r.metadata->>'amount_cents' IS DISTINCT FROM p->>'amount_cents'
     OR r.metadata->'expected_livemode' IS DISTINCT FROM p->'livemode' THEN
    RAISE EXCEPTION 'payment does not match stored source quote' USING ERRCODE='23514';
  END IF;
  IF r.metadata ? 'stripe_session_id' THEN
    IF r.metadata->>'stripe_session_id' IS DISTINCT FROM p->>'session_id' THEN
      RAISE EXCEPTION 'request already funded by another session' USING ERRCODE='23514';
    END IF;
    RETURN jsonb_build_object('request_id',r.id,'duplicate',true);
  END IF;
  IF r.status IS DISTINCT FROM 'awaiting_payment' THEN RAISE EXCEPTION 'request is not payable'; END IF;
  -- Payer's own cash-out testimony, never a personal AI-wallet credit and never
  -- a claim that Stripe moved money into the provider account.
  INSERT INTO public.payment_events(user_id,direction,amount_usd,paid_at,method,scope_type,
    description,confirmation_number,source_metadata)
  VALUES ((p->>'user_id')::uuid,'out',(p->>'amount_cents')::numeric/100,
    to_timestamp((p->>'paid_at')::bigint),'stripe','personal','Shared source API funding',p->>'session_id',
    jsonb_build_object('contract','source_refresh_funding_v1','request_id',r.id,
      'source',r.metadata->>'source','provider',r.metadata->>'provider',
      'stripe_event_id',p->>'event_id','stripe_session_id',p->>'session_id','livemode',p->'livemode'))
  RETURNING id INTO payment_id;
  UPDATE public.extraction_runs SET status='funded',metadata=metadata || jsonb_build_object(
    'payment_event_id',payment_id,'stripe_session_id',p->>'session_id','funded_at',now()) WHERE id=r.id;
  RETURN jsonb_build_object('request_id',r.id,'duplicate',false,'payment_event_id',payment_id);
END $$;
REVOKE ALL ON FUNCTION public.record_source_refresh_payment(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_source_refresh_payment(jsonb) TO service_role;
COMMENT ON FUNCTION public.record_source_refresh_payment(jsonb) IS
  'Stripe webhook owner: validate a stored source-refresh quote; atomically retain payer testimony and queue bounded shared source work. Session-idempotent; no provider-credit transfer is asserted.';
COMMIT;
