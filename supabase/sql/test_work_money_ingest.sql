-- DISPOSABLE LOCAL DATABASE ONLY. Creates prerequisite stubs, never production.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF to_regclass('auth.users') IS NOT NULL OR to_regclass('public.work_orders') IS NOT NULL THEN
   RAISE EXCEPTION 'refusing nonempty database; use disposable local PostgreSQL';
 END IF;
END $$;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE public.work_orders(id uuid PRIMARY KEY,vehicle_id uuid,title text,customer_name text,customer_email text,estimated_total numeric,currency text,created_at timestamptz,status text);
CREATE TABLE public.vehicles(id uuid PRIMARY KEY,year integer,make text,model text);
CREATE FUNCTION public.work_order_viewer_slots(uuid,uuid,uuid) RETURNS TABLE(work_order_id uuid,slots text[]) LANGUAGE sql AS $$
 SELECT id,ARRAY['org_owner'] FROM public.work_orders WHERE $1='00000000-0000-0000-0000-000000000001'::uuid AND ($2 IS NULL OR id=$2)
$$;
CREATE FUNCTION public.job_reader_is_party(text[]) RETURNS boolean LANGUAGE sql AS $$ SELECT 'org_owner'=ANY($1) $$;
\ir ../migrations/20261110032236_work_money_ingest_staging.sql
\ir ../migrations/20261110032236_work_money_ingest_staging.sql
INSERT INTO auth.users VALUES('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
INSERT INTO work_orders VALUES('10000000-0000-0000-0000-000000000001',NULL,'Synthetic job','Example Customer','customer@example.com',125,'USD','2026-10-01','in_progress');
GRANT USAGE ON SCHEMA auth TO authenticated;
DO $$
DECLARE r uuid; s uuid; n integer; email jsonb; signal jsonb; proposals jsonb;
BEGIN
  r:=public.work_money_run_start('00000000-0000-0000-0000-000000000001','gmail','poll','2026-10-31','2026-11-02');
  email:='{"id":"synthetic","sender":"customer@example.com","receivedAt":"2026-11-01T00:00:00Z","subject":"Payment received","text":"Payment $125.00"}';
  signal:='{"kind":"payment_received","direction":"inbound_claim","amountCents":12500,"currency":"USD","confidence":0.75,"reasons":["source_claim_unverified"]}';
  proposals:='[{"work_order_id":"10000000-0000-0000-0000-000000000001","vehicle_id":null,"confidence":0.7,"status":"pending_confirmation"}]';
  s:=public.stage_work_money_email(r,email,signal,proposals,repeat('a',64),'work-money-v1');
  IF s IS NULL THEN RAISE EXCEPTION 'missing staged row'; END IF;
  IF public.stage_work_money_email(r,email,signal,proposals,repeat('a',64),'work-money-v1') IS NOT NULL THEN RAISE EXCEPTION 'duplicate replay'; END IF;
  BEGIN
    PERFORM public.stage_work_money_email(r,email,signal,'[{"work_order_id":"10000000-0000-0000-0000-000000000002","status":"pending_confirmation"}]',repeat('a',64),'work-money-v1');
    RAISE EXCEPTION 'expected bad proposal rejection';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='expected bad proposal rejection' THEN RAISE; END IF; END;
  PERFORM public.work_money_run_finish(r,true,1,1,'2026-11-01',NULL);
  r:=public.work_money_run_start('00000000-0000-0000-0000-000000000001','gmail','poll','2026-11-01','2026-11-03');
  PERFORM public.work_money_run_finish(r,false,0,0,NULL,'oauth_failed');
  IF (SELECT covered_through FROM public.work_money_source_health)<>'2026-11-02'::timestamptz THEN RAISE EXCEPTION 'failed run advanced freshness'; END IF;
  r:=public.work_money_run_start('00000000-0000-0000-0000-000000000001','gmail','backfill','2026-11-03','2026-11-04');
  PERFORM public.work_money_run_finish(r,true,0,0,NULL,NULL);
  IF (SELECT covered_through FROM public.work_money_source_health)<>'2026-11-02'::timestamptz THEN RAISE EXCEPTION 'backfill advanced poll'; END IF;
END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $$ BEGIN
 IF (SELECT count(*) FROM work_money_pending_confirmations)<>1 THEN RAISE EXCEPTION 'owner cannot read pending'; END IF;
 IF (SELECT count(*) FROM work_money_source_health)<>1 THEN RAISE EXCEPTION 'owner health missing'; END IF;
 BEGIN
   INSERT INTO work_money_staging DEFAULT VALUES;
   RAISE EXCEPTION 'client write allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
   PERFORM work_money_candidate_jobs('00000000-0000-0000-0000-000000000002');
   RAISE EXCEPTION 'client service RPC allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
DO $$ BEGIN
 IF (SELECT count(*) FROM work_money_pending_confirmations)<>0 OR (SELECT count(*) FROM work_money_source_health)<>0 THEN RAISE EXCEPTION 'cross owner leak'; END IF;
END $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM * FROM work_money_pending_confirmations; RAISE EXCEPTION 'anon leak'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE service_role;
DO $$ BEGIN
 BEGIN INSERT INTO work_money_staging DEFAULT VALUES; RAISE EXCEPTION 'raw service write allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF jsonb_array_length(work_money_candidate_jobs('00000000-0000-0000-0000-000000000002'))<>0 THEN RAISE EXCEPTION 'wrong owner scope'; END IF;
END $$;
RESET ROLE;
SELECT 'PASS: replay, migration idempotency, pending reader, scoped RPCs, RLS, grants, freshness' AS result;
