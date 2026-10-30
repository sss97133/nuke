-- Reuse the existing payment testimony and operational run store. No provider
-- balance, source switch, wallet grant or paid capacity is enabled by this migration.
-- CI uses psql -f without --single-transaction. Concurrent builds stay outside
-- the function transaction and allow the active run/payment writers to continue.
SET statement_timeout = '120s';
SET lock_timeout = '2s';
CREATE INDEX CONCURRENTLY IF NOT EXISTS extraction_runs_funded_source_refresh
ON public.extraction_runs((metadata->>'checked_at') ASC NULLS FIRST,started_at,id)
WHERE source='source-refresh-funding' AND status IN ('funded','dispatching');
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS payment_events_source_refresh_session
ON public.payment_events(confirmation_number)
WHERE source_metadata->>'contract'='source_refresh_funding_v1';
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS payment_events_source_refresh_refund
ON public.payment_events(confirmation_number)
WHERE source_metadata->>'contract'='source_refresh_refund_v1';
CREATE INDEX CONCURRENTLY IF NOT EXISTS payment_events_source_refresh_refund_parent
ON public.payment_events((source_metadata->>'payment_event_id'))
WHERE source_metadata->>'contract'='source_refresh_refund_v1';

BEGIN;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';

CREATE OR REPLACE FUNCTION public.record_source_refresh_payment(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE r public.extraction_runs%ROWTYPE; payment_id uuid;
BEGIN
  IF p->>'payment_status' IS DISTINCT FROM 'paid' OR p->>'currency' IS DISTINCT FROM 'usd'
     OR p->>'amount_cents' IS NULL OR p->>'amount_cents' !~ '^[0-9]{1,6}$'
     OR (p->>'amount_cents')::bigint NOT BETWEEN 100 AND 10000
     OR coalesce(p->>'session_id','') !~ '^cs_live_[A-Za-z0-9]{1,240}$'
     OR coalesce(p->>'event_id','') !~ '^evt_[A-Za-z0-9]{1,240}$'
     OR coalesce(p->>'payment_intent_id','') !~ '^pi_[A-Za-z0-9]{1,240}$'
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
      'stripe_event_id',p->>'event_id','stripe_session_id',p->>'session_id',
      'stripe_payment_intent_id',p->>'payment_intent_id','livemode',p->'livemode'))
  RETURNING id INTO payment_id;
  UPDATE public.extraction_runs SET status='funded',metadata=metadata || jsonb_build_object(
    'payment_event_id',payment_id,'stripe_session_id',p->>'session_id','funded_at',now()) WHERE id=r.id;
  RETURN jsonb_build_object('request_id',r.id,'duplicate',false,'payment_event_id',payment_id);
END $$;
REVOKE ALL ON FUNCTION public.record_source_refresh_payment(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_source_refresh_payment(jsonb) TO service_role;
COMMENT ON FUNCTION public.record_source_refresh_payment(jsonb) IS
  'Stripe webhook owner: validate a stored source-refresh quote; atomically retain payer testimony and queue bounded shared source work. Session-idempotent; no provider-credit transfer is asserted.';

CREATE OR REPLACE FUNCTION public.record_source_refresh_refund(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE r public.extraction_runs%ROWTYPE; original public.payment_events%ROWTYPE;
        existing public.payment_events%ROWTYPE; refund_id uuid; refunded numeric;
BEGIN
  IF p->>'refund_status' IS DISTINCT FROM 'succeeded' OR p->>'currency' IS DISTINCT FROM 'usd'
     OR coalesce(p->>'amount_cents','') !~ '^[0-9]{1,6}$' OR (p->>'amount_cents')::bigint < 1
     OR coalesce(p->>'refund_id','') !~ '^re_[A-Za-z0-9]{1,240}$'
     OR coalesce(p->>'payment_intent_id','') !~ '^pi_[A-Za-z0-9]{1,240}$'
     OR coalesce(p->>'event_id','') !~ '^evt_[A-Za-z0-9]{1,240}$'
     OR coalesce(p->>'paid_at','') !~ '^[0-9]{1,12}$' OR p->'livemode' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'invalid source funding refund' USING ERRCODE='22023';
  END IF;
  SELECT * INTO r FROM public.extraction_runs WHERE id=(p->>'request_id')::uuid
    AND source='source-refresh-funding' FOR UPDATE;
  SELECT * INTO original FROM public.payment_events WHERE id=(r.metadata->>'payment_event_id')::uuid;
  -- A refund arriving before the paid event is retried, never acknowledged as recorded.
  IF original.id IS NULL OR original.user_id::text IS DISTINCT FROM p->>'user_id'
     OR original.source_metadata->>'contract' IS DISTINCT FROM 'source_refresh_funding_v1'
     OR original.source_metadata->>'request_id' IS DISTINCT FROM r.id::text
     OR original.source_metadata->>'stripe_payment_intent_id' IS DISTINCT FROM p->>'payment_intent_id' THEN
    RAISE EXCEPTION 'refund does not match a recorded source payment' USING ERRCODE='23514';
  END IF;
  SELECT * INTO existing FROM public.payment_events WHERE confirmation_number=p->>'refund_id'
    AND source_metadata->>'contract'='source_refresh_refund_v1';
  IF FOUND THEN
    IF existing.source_metadata->>'payment_event_id' IS DISTINCT FROM original.id::text
       OR existing.amount_usd IS DISTINCT FROM (p->>'amount_cents')::numeric/100 THEN
      RAISE EXCEPTION 'refund identity mismatch' USING ERRCODE='23514';
    END IF;
    RETURN jsonb_build_object('refund_event_id',existing.id,'duplicate',true);
  END IF;
  SELECT coalesce(sum(amount_usd),0) INTO refunded FROM public.payment_events
    WHERE source_metadata->>'contract'='source_refresh_refund_v1' AND source_metadata->>'payment_event_id'=original.id::text;
  refunded := refunded+(p->>'amount_cents')::numeric/100;
  IF refunded>original.amount_usd THEN RAISE EXCEPTION 'refund exceeds paid amount' USING ERRCODE='23514'; END IF;
  INSERT INTO public.payment_events(user_id,direction,amount_usd,paid_at,method,scope_type,
    description,confirmation_number,source_metadata)
  VALUES (original.user_id,'in',(p->>'amount_cents')::numeric/100,to_timestamp((p->>'paid_at')::bigint),
    'stripe','personal','Shared source API funding refund',p->>'refund_id',jsonb_build_object(
      'contract','source_refresh_refund_v1','request_id',r.id,'payment_event_id',original.id,
      'stripe_event_id',p->>'event_id','stripe_payment_intent_id',p->>'payment_intent_id','livemode',true)) RETURNING id INTO refund_id;
  UPDATE public.extraction_runs SET status=CASE WHEN refunded=original.amount_usd THEN 'refunded' ELSE 'partially_refunded' END,
    completed_at=now(),metadata=metadata||jsonb_build_object('refunded_cents',round(refunded*100),'refund_event_id',refund_id) WHERE id=r.id;
  RETURN jsonb_build_object('refund_event_id',refund_id,'duplicate',false);
END $$;
REVOKE ALL ON FUNCTION public.record_source_refresh_refund(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_source_refresh_refund(jsonb) TO service_role;
COMMENT ON FUNCTION public.record_source_refresh_refund(jsonb) IS
  'Stripe webhook owner: append confirmed refund testimony once, preserve the original payment and stop queued source work. Already captured source evidence is never removed.';

CREATE OR REPLACE FUNCTION public.record_source_refresh_dispute(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE r public.extraction_runs%ROWTYPE; original public.payment_events%ROWTYPE;
BEGIN
  IF coalesce(p->>'dispute_id','') !~ '^dp_[A-Za-z0-9]{1,240}$'
     OR coalesce(p->>'dispute_status','') !~ '^[a-z_]{1,64}$'
     OR coalesce(p->>'event_created','') !~ '^[0-9]{1,12}$'
     OR coalesce(p->>'event_id','') !~ '^evt_[A-Za-z0-9]{1,240}$' OR p->'livemode' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'invalid source payment dispute' USING ERRCODE='22023';
  END IF;
  SELECT * INTO r FROM public.extraction_runs WHERE id=(p->>'request_id')::uuid AND source='source-refresh-funding' FOR UPDATE;
  SELECT * INTO original FROM public.payment_events WHERE id=(r.metadata->>'payment_event_id')::uuid;
  IF original.id IS NULL OR original.user_id::text IS DISTINCT FROM p->>'user_id'
     OR original.source_metadata->>'contract' IS DISTINCT FROM 'source_refresh_funding_v1'
     OR original.source_metadata->>'request_id' IS DISTINCT FROM r.id::text
     OR original.source_metadata->>'stripe_payment_intent_id' IS DISTINCT FROM p->>'payment_intent_id' THEN
    RAISE EXCEPTION 'dispute does not match a recorded source payment' USING ERRCODE='23514';
  END IF;
  IF coalesce(r.metadata->'dispute_events','[]'::jsonb) @> jsonb_build_array(p->>'event_id') THEN
    RETURN jsonb_build_object('duplicate',true);
  END IF;
  -- A dispute is not itself proof that a payer received a refund. Preserve the
  -- payment and source evidence; hold future work even after a closed dispute.
  UPDATE public.extraction_runs SET status=CASE WHEN status IN ('refunded','partially_refunded') THEN status ELSE 'payment_disputed' END,
    completed_at=now(),metadata=metadata||jsonb_build_object('dispute_events',coalesce(metadata->'dispute_events','[]'::jsonb)||jsonb_build_array(p->>'event_id'),
      'dispute_history',coalesce(metadata->'dispute_history','[]'::jsonb)||jsonb_build_array(jsonb_build_object(
        'event_id',p->>'event_id','dispute_id',p->>'dispute_id','status',p->>'dispute_status','event_created',p->'event_created')))
      || CASE WHEN (p->>'event_created')::bigint>=coalesce((metadata->>'dispute_event_created')::bigint,0)
        THEN jsonb_build_object('dispute_id',p->>'dispute_id','dispute_status',p->>'dispute_status','dispute_event_created',p->'event_created') ELSE '{}'::jsonb END WHERE id=r.id;
  RETURN jsonb_build_object('duplicate',false);
END $$;
REVOKE ALL ON FUNCTION public.record_source_refresh_dispute(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_source_refresh_dispute(jsonb) TO service_role;
COMMENT ON FUNCTION public.record_source_refresh_dispute(jsonb) IS
  'Stripe webhook owner: retain source payment dispute history and hold further work; no invented cash movement or automatic paid replay.';
COMMIT;
RESET statement_timeout;
RESET lock_timeout;
