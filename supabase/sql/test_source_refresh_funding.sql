\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'disposable database required'; END IF;
END $$;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN EXECUTE format('CREATE ROLE %I',r); END IF;
 END LOOP;
END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.extraction_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source text,status text,
  started_at timestamptz DEFAULT now(),completed_at timestamptz,metadata jsonb DEFAULT '{}',vehicles_created integer,vehicles_updated integer);
CREATE TABLE public.payment_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id),
  direction text NOT NULL CHECK(direction IN ('in','out')),amount_usd numeric NOT NULL CHECK(amount_usd>=0),paid_at timestamptz NOT NULL,
  method text,scope_type text NOT NULL CHECK(scope_type IN ('vehicle','org','personal','tax')),description text,confirmation_number text,
  source_metadata jsonb NOT NULL DEFAULT '{}');
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON public.payment_events,public.extraction_runs TO service_role;
\ir ../migrations/20261030185600_source_refresh_funding.sql
BEGIN;
INSERT INTO auth.users(id) VALUES ('e7000000-0000-0000-0000-0000000000c1') ON CONFLICT DO NOTHING;
INSERT INTO public.extraction_runs(id,source,status,metadata)
VALUES ('e7000000-0000-0000-0000-0000000000c2','source-refresh-funding','awaiting_payment',
 '{"contract":"source_refresh_funding_v1","user_id":"e7000000-0000-0000-0000-0000000000c1","source":"fixture","provider":"anthropic","amount_cents":300,"expected_livemode":true}');
DO $$
DECLARE p jsonb := '{"request_id":"e7000000-0000-0000-0000-0000000000c2","user_id":"e7000000-0000-0000-0000-0000000000c1","session_id":"cs_live_fixture","payment_intent_id":"pi_fixture","event_id":"evt_fixture","paid_at":1793383200,"livemode":true,"amount_cents":300,"currency":"usd","payment_status":"paid"}';
        r jsonb; bad jsonb; refund jsonb; dispute jsonb; fn text; first_payment_id uuid;
BEGIN
  IF has_function_privilege('anon','public.record_source_refresh_payment(jsonb)','execute') OR
     has_function_privilege('authenticated','public.record_source_refresh_payment(jsonb)','execute') OR
     NOT has_function_privilege('service_role','public.record_source_refresh_payment(jsonb)','execute') THEN
    RAISE EXCEPTION 'payment writer permissions failed';
  END IF;
  FOREACH fn IN ARRAY ARRAY['record_source_refresh_refund','record_source_refresh_dispute'] LOOP
    IF has_function_privilege('anon','public.'||fn||'(jsonb)','execute') OR has_function_privilege('authenticated','public.'||fn||'(jsonb)','execute') THEN
      RAISE EXCEPTION 'reversal writer is publicly callable';
    END IF;
  END LOOP;
  FOREACH bad IN ARRAY ARRAY[
    p || '{"amount_cents":301}', p || '{"user_id":"e7000000-0000-0000-0000-0000000000c3"}',
    p || '{"livemode":false}', p || '{"payment_status":"unpaid"}', p || '{"currency":"eur"}',
    p - 'session_id', p - 'event_id', p - 'payment_intent_id'
  ] LOOP
    BEGIN
      PERFORM public.record_source_refresh_payment(bad);
      RAISE EXCEPTION 'bad payment accepted';
    EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '23514' THEN NULL;
    END;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.payment_events WHERE confirmation_number='cs_live_fixture') THEN RAISE EXCEPTION 'refused payment retained'; END IF;
  r := public.record_source_refresh_payment(p);
  IF r->>'duplicate' <> 'false' THEN RAISE EXCEPTION 'first payment was not recorded'; END IF;
  first_payment_id := (r->>'payment_event_id')::uuid;
  IF first_payment_id IS DISTINCT FROM (SELECT id FROM public.payment_events WHERE confirmation_number='cs_live_fixture') THEN
    RAISE EXCEPTION 'payment recorder did not return the retained payment';
  END IF;
  r := public.record_source_refresh_payment(p || '{"event_id":"evt_secondDelivery"}');
  IF r->>'duplicate' <> 'true' THEN RAISE EXCEPTION 'different event for same session duplicated'; END IF;
  IF (SELECT count(*) FROM public.payment_events WHERE confirmation_number='cs_live_fixture') <> 1 THEN RAISE EXCEPTION 'double payment'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.payment_events WHERE confirmation_number='cs_live_fixture'
    AND direction='out' AND amount_usd=3 AND source_metadata->>'source'='fixture') THEN RAISE EXCEPTION 'payment testimony mismatched'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.extraction_runs WHERE id=(p->>'request_id')::uuid AND status='funded'
    AND metadata->>'payment_event_id'=first_payment_id::text) THEN
    RAISE EXCEPTION 'payment did not queue refresh with the exact payment pointer';
  END IF;
  BEGIN
    PERFORM public.record_source_refresh_payment(p || '{"session_id":"cs_live_other"}');
    RAISE EXCEPTION 'second paid session was accepted for same request';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
  dispute := p || '{"dispute_id":"dp_fixture","dispute_status":"needs_response","event_created":1793383200}';
  r := public.record_source_refresh_dispute(dispute);
  r := public.record_source_refresh_dispute(dispute);
  IF r->>'duplicate'<>'true' OR NOT EXISTS(SELECT 1 FROM public.extraction_runs WHERE id=(p->>'request_id')::uuid AND status='payment_disputed') THEN
    RAISE EXCEPTION 'dispute did not hold work idempotently';
  END IF;
  refund := p || '{"refund_id":"re_partial","refund_status":"succeeded","amount_cents":100}';
  r := public.record_source_refresh_refund(refund);
  r := public.record_source_refresh_refund(refund || '{"event_id":"evt_refundRedelivery"}');
  IF r->>'duplicate'<>'true' OR NOT EXISTS(SELECT 1 FROM public.extraction_runs WHERE id=(p->>'request_id')::uuid AND status='partially_refunded') THEN
    RAISE EXCEPTION 'partial refund replay failed';
  END IF;
  PERFORM public.record_source_refresh_refund(refund || '{"refund_id":"re_remaining","amount_cents":200}');
  IF NOT EXISTS(SELECT 1 FROM public.extraction_runs WHERE id=(p->>'request_id')::uuid AND status='refunded' AND metadata->>'refunded_cents'='300') THEN
    RAISE EXCEPTION 'full refund did not stop queued work';
  END IF;
  IF (SELECT sum(amount_usd) FROM public.payment_events WHERE source_metadata->>'contract'='source_refresh_refund_v1' AND source_metadata->>'request_id'=p->>'request_id')<>3 THEN
    RAISE EXCEPTION 'refund money testimony duplicated';
  END IF;
  BEGIN
    PERFORM public.record_source_refresh_refund(refund || '{"refund_id":"re_excess"}');
    RAISE EXCEPTION 'over-refund accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
  PERFORM public.record_source_refresh_dispute(dispute || '{"event_id":"evt_disputeClosed","dispute_status":"won","event_created":1793383201}');
  PERFORM public.record_source_refresh_dispute(dispute || '{"event_id":"evt_lateDispute"}');
  IF NOT EXISTS(SELECT 1 FROM public.extraction_runs WHERE id=(p->>'request_id')::uuid AND status='refunded') THEN
    RAISE EXCEPTION 'closed dispute restarted refunded work';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.extraction_runs WHERE id=(p->>'request_id')::uuid AND metadata->>'dispute_status'='won'
    AND jsonb_array_length(metadata->'dispute_history')=3) THEN RAISE EXCEPTION 'late dispute lost history or changed source-clock outcome'; END IF;
END $$;
ROLLBACK;

BEGIN;
DO $$
DECLARE normal_run uuid:=gen_random_uuid(); funded_run uuid:=gen_random_uuid(); first_lease uuid:=gen_random_uuid(); next_lease uuid:=gen_random_uuid();
BEGIN
 ASSERT NOT has_function_privilege('anon','claim_source_refresh_feed_lease(text,uuid,uuid)','execute');
 ASSERT public.claim_source_refresh_feed_lease('shared-poll',normal_run,first_lease)=first_lease;
 ASSERT public.claim_source_refresh_feed_lease('shared-poll',funded_run,next_lease) IS NULL;
 BEGIN
   PERFORM public.finish_source_refresh_feed_lease(first_lease,funded_run,true);
   RAISE EXCEPTION 'wrong run released lease';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM='wrong run released lease' THEN RAISE; END IF;
 END;
 PERFORM public.finish_source_refresh_feed_lease(first_lease,normal_run,true);
 ASSERT public.claim_source_refresh_feed_lease('shared-poll',funded_run,next_lease)=next_lease;
 PERFORM public.finish_source_refresh_feed_lease(next_lease,funded_run,false);
 ASSERT public.claim_source_refresh_feed_lease('shared-poll',normal_run,gen_random_uuid()) IS NULL;
 ASSERT (SELECT count(*)=0 FROM public.payment_events), 'shared lease creates no payment';
END $$;
ROLLBACK;

-- Operational-only lease fixtures: no payment or provider call is created.
BEGIN;
INSERT INTO public.extraction_runs(id,source,status,metadata) VALUES
 ('e7000000-0000-0000-0000-0000000000d1','source-refresh-funding','funded','{"contract":"source_refresh_funding_v1","feed_source":"shared-feed"}'),
 ('e7000000-0000-0000-0000-0000000000d2','source-refresh-funding','funded','{"contract":"source_refresh_funding_v1","feed_source":"shared-feed"}'),
 ('e7000000-0000-0000-0000-0000000000d3','source-refresh-funding','funded','{"contract":"source_refresh_funding_v1","feed_source":"other-feed"}'),
 ('e7000000-0000-0000-0000-0000000000d4','source-refresh-funding',NULL,'{"contract":"source_refresh_funding_v1","feed_source":"malformed-feed"}');
DO $$ BEGIN
 ASSERT NOT has_function_privilege('anon','claim_source_refresh_dispatch(uuid,uuid)','execute');
 ASSERT NOT has_function_privilege('authenticated','claim_source_refresh_dispatch(uuid,uuid)','execute');
 ASSERT has_function_privilege('service_role','claim_source_refresh_dispatch(uuid,uuid)','execute');
 ASSERT public.claim_source_refresh_dispatch('e7000000-0000-0000-0000-0000000000d4',gen_random_uuid()) IS NULL;
 ASSERT public.claim_source_refresh_dispatch('e7000000-0000-0000-0000-0000000000d1',gen_random_uuid())->'dispatch_lease_held'='true'::jsonb;
 ASSERT public.claim_source_refresh_dispatch('e7000000-0000-0000-0000-0000000000d2',gen_random_uuid()) IS NULL;
 ASSERT public.claim_source_refresh_dispatch('e7000000-0000-0000-0000-0000000000d3',gen_random_uuid()) IS NOT NULL;
 -- Status changes from refund/dispute must not release an uncertain source call.
 UPDATE public.extraction_runs SET status='refunded' WHERE id='e7000000-0000-0000-0000-0000000000d1';
 ASSERT public.claim_source_refresh_dispatch('e7000000-0000-0000-0000-0000000000d2',gen_random_uuid()) IS NULL;
 BEGIN
   UPDATE public.extraction_runs SET metadata=metadata||'{"dispatch_lease_held":true}' WHERE id='e7000000-0000-0000-0000-0000000000d2';
   RAISE EXCEPTION 'duplicate source lease accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 UPDATE public.extraction_runs SET metadata=metadata||'{"dispatch_lease_held":false}' WHERE id='e7000000-0000-0000-0000-0000000000d1';
 ASSERT public.claim_source_refresh_dispatch('e7000000-0000-0000-0000-0000000000d2',gen_random_uuid()) IS NOT NULL;
 ASSERT (SELECT count(*)=0 FROM public.payment_events), 'lease checks create no payment testimony';
END $$;
ROLLBACK;
