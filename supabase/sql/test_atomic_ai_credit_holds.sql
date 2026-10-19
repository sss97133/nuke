\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'disposable database required'; END IF;
END $$;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE TABLE public.ai_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  entry_type text NOT NULL, amount_cents bigint NOT NULL, hold_id uuid REFERENCES public.ai_credit_ledger,
  status text NOT NULL, ref text, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.ai_credit_ledger(user_id,created_at DESC);
GRANT SELECT,INSERT,UPDATE ON public.ai_credit_ledger TO service_role;
CREATE FUNCTION public.ai_credit_available_cents(p_user_id uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT coalesce(sum(amount_cents) FILTER(WHERE status='closed' AND entry_type IN('topup','settle')),0)
    - coalesce(sum(abs(amount_cents)) FILTER(WHERE status='open' AND entry_type='hold'),0)
  FROM public.ai_credit_ledger WHERE user_id=p_user_id;
$$;
\ir ../migrations/20261018221555_atomic_ai_credit_holds.sql
CREATE FUNCTION public.fixture_reject_settlement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.entry_type='settle' AND NEW.metadata->>'reject'='yes' THEN RAISE EXCEPTION 'fixture settlement failure'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fixture_settle_failure BEFORE INSERT ON public.ai_credit_ledger FOR EACH ROW EXECUTE FUNCTION public.fixture_reject_settlement();
INSERT INTO public.ai_credit_ledger(user_id,entry_type,amount_cents,status) VALUES
 ('00000000-0000-4000-8000-000000000001','topup',100,'closed'),
 ('00000000-0000-4000-8000-000000000003','topup',1,'closed');
SET ROLE service_role;
DO $$
DECLARE u uuid:='00000000-0000-4000-8000-000000000001'; h uuid; r jsonb;
BEGIN
  r:=public.reserve_ai_credit_hold(u,70,'regular-job'); h:=(r->>'hold_id')::uuid;
  IF r->>'status'<>'reserved' OR public.ai_credit_available_cents(u)<>30 THEN RAISE EXCEPTION 'reserve'; END IF;
  IF public.reserve_ai_credit_hold(u,40,'other-job')->>'status'<>'insufficient_funds' THEN RAISE EXCEPTION 'overdraw'; END IF;
  PERFORM public.settle_ai_credit_hold(u,h,20);
  IF public.ai_credit_available_cents(u)<>80 THEN RAISE EXCEPTION 'settlement difference'; END IF;
  PERFORM public.settle_ai_credit_hold(u,h,20);
  IF public.ai_credit_available_cents(u)<>80 OR (SELECT count(*) FROM public.ai_credit_ledger WHERE hold_id=h)<>1 THEN RAISE EXCEPTION 'double charge'; END IF;
  r:=public.reserve_ai_credit_hold(u,10,'photo:v1:fixture'); h:=(r->>'hold_id')::uuid;
  IF public.reserve_ai_credit_hold(u,10,'photo:v1:fixture')->>'status'<>'duplicate' THEN RAISE EXCEPTION 'parallel photo attempt'; END IF;
  PERFORM public.settle_ai_credit_hold(u,h,0,'{"provider_read":"not_started"}');
  r:=public.reserve_ai_credit_hold(u,10,'photo:v1:fixture'); h:=(r->>'hold_id')::uuid;
  IF r->>'status'<>'reserved' THEN RAISE EXCEPTION 'proven no-read retry'; END IF;
  PERFORM public.settle_ai_credit_hold(u,h,0,'{"provider_read":"unreadable"}');
  IF public.reserve_ai_credit_hold(u,10,'photo:v1:fixture')->>'status'<>'duplicate' THEN RAISE EXCEPTION 'unreadable repeat spend'; END IF;
  r:=public.reserve_ai_credit_hold(u,10,'rollback-job'); h:=(r->>'hold_id')::uuid;
  BEGIN
    PERFORM public.settle_ai_credit_hold(u,h,5,'{"reject":"yes"}');
    RAISE EXCEPTION 'expected failure';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'fixture settlement failure' THEN RAISE; END IF;
  END;
  IF NOT EXISTS(SELECT 1 FROM public.ai_credit_ledger WHERE id=h AND status='open')
     OR EXISTS(SELECT 1 FROM public.ai_credit_ledger WHERE hold_id=h) THEN RAISE EXCEPTION 'non-atomic failure'; END IF;
  BEGIN
    PERFORM public.settle_ai_credit_hold(u,h,11); RAISE EXCEPTION 'expected cap';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'charge exceeds reserved credit' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.settle_ai_credit_hold('00000000-0000-4000-8000-000000000002',h,0); RAISE EXCEPTION 'expected owner';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'credit hold not found' THEN RAISE; END IF; END;
  PERFORM public.settle_ai_credit_hold(u,h,0);
  IF public.ai_credit_available_cents(u)<>80 THEN RAISE EXCEPTION 'zero-charge release'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF has_function_privilege('anon','public.reserve_ai_credit_hold(uuid,bigint,text,jsonb)','EXECUTE')
     OR has_function_privilege('authenticated','public.reserve_ai_credit_hold(uuid,bigint,text,jsonb)','EXECUTE')
     OR has_function_privilege('authenticated','public.settle_ai_credit_hold(uuid,uuid,bigint,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'public monetary writer'; END IF;
END $$;
-- Two real concurrent sessions contend for the final cent. Only one may reserve it.
CREATE EXTENSION dblink;
SELECT dblink_connect('credit_a',format('dbname=%s host=%s port=%s user=postgres',current_database(),split_part(current_setting('unix_socket_directories'),',',1),current_setting('port')));
SELECT dblink_connect('credit_b',format('dbname=%s host=%s port=%s user=postgres',current_database(),split_part(current_setting('unix_socket_directories'),',',1),current_setting('port')));
SELECT dblink_send_query('credit_a',$$SELECT public.reserve_ai_credit_hold('00000000-0000-4000-8000-000000000003',1,'parallel-a'),pg_sleep(0.2)$$);
SELECT dblink_send_query('credit_b',$$SELECT public.reserve_ai_credit_hold('00000000-0000-4000-8000-000000000003',1,'parallel-b'),pg_sleep(0.2)$$);
CREATE TEMP TABLE concurrent_results(r jsonb);
INSERT INTO concurrent_results SELECT r FROM dblink_get_result('credit_a') AS t(r jsonb,slept text);
INSERT INTO concurrent_results SELECT r FROM dblink_get_result('credit_b') AS t(r jsonb,slept text);
SELECT dblink_disconnect('credit_a'),dblink_disconnect('credit_b');
DO $$ BEGIN
  IF (SELECT count(*) FROM concurrent_results WHERE r->>'status'='reserved')<>1
     OR (SELECT count(*) FROM concurrent_results WHERE r->>'status'='insufficient_funds')<>1
     OR public.ai_credit_available_cents('00000000-0000-4000-8000-000000000003')<>0 THEN RAISE EXCEPTION 'concurrent overdraw'; END IF;
END $$;
SELECT 'atomic AI credit holds: reserve, settle, rollback, dedupe, ACL and concurrent balance contracts passed' AS result;
