-- Run only in a disposable, synthetic local Postgres database.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('test.user_id', true), '')::uuid
$$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('role', current_user)
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
CREATE TYPE public.observation_kind AS ENUM
  ('listing','sale_result','comment','bid','specification','condition','media','splice','work_record');
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, user_id uuid, owner_id uuid, uploaded_by uuid, is_public boolean);
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY, vehicle_id uuid, kind observation_kind, structured_data jsonb, content_text text);
ALTER TABLE public.vehicle_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY vo_authenticated_read ON public.vehicle_observations FOR SELECT USING (true);
CREATE POLICY vo_service_role_all ON public.vehicle_observations TO service_role USING (true);
GRANT SELECT ON public.vehicles, public.vehicle_observations TO anon, authenticated, service_role;
\ir ../../supabase/migrations/20260928233000_observation_privacy_marking.sql

CREATE FUNCTION pg_temp.assert_ok(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',label; END IF;
  RAISE NOTICE 'PASS %',label;
END $$;
SELECT pg_temp.assert_ok(public.observation_is_public('condition','{"total_paid":100,"balance_remaining":10}'), 'reproduce missing payment-key classification');

\ir ../../supabase/migrations/20261004175418_observation_private_fields_guard.sql

DO $$ DECLARE key text; BEGIN
  FOREACH key IN ARRAY ARRAY[
    'total_paid','totalPaid','balance_remaining','balanceRemaining',
    'full_name','fullName','first_name','firstName','last_name','lastName',
    'given_name','family_name','legal_name','buyer_name','seller_name',
    'owner_name','person_name','technician_name','participant_name','contact_name',
    'CUSTOMER_NAME','client_name','email','phone','paid_usd','payment_method',
    'invoice_number','line_items','file_url'
  ] LOOP
    PERFORM pg_temp.assert_ok(NOT public.observation_is_public('condition',jsonb_build_object(key,'synthetic')), 'private field '||key);
  END LOOP;
END $$;
SELECT pg_temp.assert_ok(NOT public.observation_is_public('comment','{"participants":[{"profile":{"fullName":"Synthetic Person"}}]}'), 'nested name is private');
SELECT pg_temp.assert_ok(NOT public.observation_is_public('media','{"text":"invoice $100"}'), 'receipt/OCR rule preserved');
SELECT pg_temp.assert_ok(NOT public.observation_is_public('work_record','{}'), 'private kind preserved');
SELECT pg_temp.assert_ok(public.observation_is_public('condition','{"completion_pct":75,"items_complete":11}'), 'technical measurements stay eligible');
SELECT pg_temp.assert_ok(public.observation_is_public('sale_result','{"final_price":10000,"currency":"USD"}'), 'public sold price stays eligible');
SELECT pg_temp.assert_ok(public.observation_is_public('comment','{"handle":"public-handle"}'), 'source handle eligibility unchanged');
SELECT pg_temp.assert_ok(public.observation_is_public('condition',null), 'null metadata behavior unchanged');

INSERT INTO public.vehicles VALUES (md5('vehicle')::uuid,md5('user')::uuid,md5('owner')::uuid,md5('uploader')::uuid,true);
INSERT INTO public.vehicle_observations VALUES
  (md5('private-money')::uuid,md5('vehicle')::uuid,'condition','{"total_paid":100,"balance_remaining":10}','Synthetic Person discussed work.'),
  (md5('private-name')::uuid,md5('vehicle')::uuid,'condition','{"person":{"fullName":"Synthetic Person"}}','Private name'),
  (md5('public-fact')::uuid,md5('vehicle')::uuid,'condition','{"completion_pct":75}','Technical fact');

SET ROLE anon;
SELECT pg_temp.assert_ok((SELECT count(*)=1 FROM public.vehicle_observations), 'anon sees only eligible fact');
SELECT pg_temp.assert_ok((SELECT count(*)=0 FROM public.vehicle_observations WHERE id=md5('private-money')::uuid), 'direct anon id lookup cannot recover named prose');
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('test.user_id',md5('stranger')::uuid::text,false);
SELECT pg_temp.assert_ok((SELECT count(*)=1 FROM public.vehicle_observations), 'unrelated authenticated user sees only eligible fact');
SELECT set_config('test.user_id',md5('user')::uuid::text,false);
SELECT pg_temp.assert_ok((SELECT count(*)=3 FROM public.vehicle_observations), 'vehicle user keeps original private testimony');
SELECT set_config('test.user_id',md5('owner')::uuid::text,false);
SELECT pg_temp.assert_ok((SELECT count(*)=3 FROM public.vehicle_observations), 'vehicle owner keeps original private testimony');
SELECT set_config('test.user_id',md5('uploader')::uuid::text,false);
SELECT pg_temp.assert_ok((SELECT count(*)=3 FROM public.vehicle_observations), 'vehicle uploader keeps original private testimony');
RESET ROLE;
SET ROLE service_role;
SELECT pg_temp.assert_ok((SELECT count(*)=3 FROM public.vehicle_observations), 'service role retains internal access');
RESET ROLE;
SELECT pg_temp.assert_ok((SELECT content_text='Synthetic Person discussed work.' FROM public.vehicle_observations WHERE id=md5('private-money')::uuid), 'original testimony unchanged');
