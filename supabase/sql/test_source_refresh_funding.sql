-- Disposable local/CI database only. Migration must be applied first.
BEGIN;
INSERT INTO auth.users(id) VALUES ('e7000000-0000-0000-0000-0000000000c1') ON CONFLICT DO NOTHING;
INSERT INTO public.extraction_runs(id,source,status,metadata)
VALUES ('e7000000-0000-0000-0000-0000000000c2','source-refresh-funding','awaiting_payment',
 '{"contract":"source_refresh_funding_v1","user_id":"e7000000-0000-0000-0000-0000000000c1","source":"fixture","provider":"anthropic","amount_cents":300,"expected_livemode":true}');
DO $$
DECLARE p jsonb := '{"request_id":"e7000000-0000-0000-0000-0000000000c2","user_id":"e7000000-0000-0000-0000-0000000000c1","session_id":"cs_live_fixture","event_id":"evt_fixture","paid_at":1793383200,"livemode":true,"amount_cents":300,"currency":"usd","payment_status":"paid"}';
        r jsonb; bad jsonb;
BEGIN
  IF has_function_privilege('anon','public.record_source_refresh_payment(jsonb)','execute') OR
     has_function_privilege('authenticated','public.record_source_refresh_payment(jsonb)','execute') OR
     NOT has_function_privilege('service_role','public.record_source_refresh_payment(jsonb)','execute') THEN
    RAISE EXCEPTION 'payment writer permissions failed';
  END IF;
  FOREACH bad IN ARRAY ARRAY[
    p || '{"amount_cents":301}', p || '{"user_id":"e7000000-0000-0000-0000-0000000000c3"}',
    p || '{"livemode":false}', p || '{"payment_status":"unpaid"}', p || '{"currency":"eur"}',
    p - 'session_id', p - 'event_id'
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
  r := public.record_source_refresh_payment(p || '{"event_id":"evt_secondDelivery"}');
  IF r->>'duplicate' <> 'true' THEN RAISE EXCEPTION 'different event for same session duplicated'; END IF;
  IF (SELECT count(*) FROM public.payment_events WHERE confirmation_number='cs_live_fixture') <> 1 THEN RAISE EXCEPTION 'double payment'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.payment_events WHERE confirmation_number='cs_live_fixture'
    AND direction='out' AND amount_usd=3 AND source_metadata->>'source'='fixture') THEN RAISE EXCEPTION 'payment testimony mismatched'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.extraction_runs WHERE id=(p->>'request_id')::uuid AND status='funded'
    AND metadata->>'payment_event_id'=r->>'payment_event_id') THEN
    -- Duplicate receipt intentionally carries no money amount or second ledger id.
    IF NOT EXISTS(SELECT 1 FROM public.extraction_runs WHERE id=(p->>'request_id')::uuid AND status='funded' AND metadata ? 'payment_event_id') THEN
      RAISE EXCEPTION 'payment did not queue refresh atomically';
    END IF;
  END IF;
  BEGIN
    PERFORM public.record_source_refresh_payment(p || '{"session_id":"cs_live_other"}');
    RAISE EXCEPTION 'second paid session was accepted for same request';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
END $$;
ROLLBACK;
