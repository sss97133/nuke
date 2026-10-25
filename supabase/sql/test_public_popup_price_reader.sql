-- Real popup + current USD/trust price reader under ordinary column grants.
-- Reuse the public-cohort contract and restore its final deliberate drift.
\set ON_ERROR_STOP on
\ir test_popup_vehicle_intel_public_cohort.sql
\ir helpers/popup_vehicle_intel_live_20261014.sql
\ir ../migrations/20261014052500_popup_vehicle_intel_public_cohort.sql
SET statement_timeout='15s';
ALTER TABLE public.vehicles ADD COLUMN user_id uuid, ADD COLUMN uploaded_by uuid,
  ADD COLUMN sale_price_usd numeric, ADD COLUMN purchase_price numeric;
CREATE FUNCTION public.vehicle_user_has_access(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
ALTER TABLE public.vehicle_events ADD COLUMN id uuid, ADD COLUMN sale_truth_role text,
  ADD COLUMN price_verification text, ADD COLUMN source_suspect text[], ADD COLUMN sale_outcome text;
CREATE TABLE public.vehicle_event_trust(event_id uuid,retired_at timestamptz,trust text);
CREATE TABLE public.vehicle_sale_price_untrusted_marks(vehicle_id uuid,sale_price numeric,retired_at timestamptz);
ALTER TABLE public.vehicle_event_trust ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_sale_price_untrusted_marks ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.vehicle_event_trust TO anon,authenticated;
REVOKE SELECT ON public.vehicles FROM anon,authenticated;
DO $$ DECLARE cols text; BEGIN
  SELECT string_agg(quote_ident(attname),',') INTO cols FROM pg_attribute
  WHERE attrelid='public.vehicles'::regclass AND attnum>0 AND NOT attisdropped
    AND attname NOT IN ('sale_price_usd','purchase_price');
  EXECUTE 'GRANT SELECT ('||cols||') ON public.vehicles TO anon,authenticated';
END $$;
\ir helpers/public_vehicle_price_readers_live_20261025.sql
UPDATE public.vehicles SET sale_price_usd=1250 WHERE id='20000000-0000-0000-0000-000000000001';
INSERT INTO public.vehicle_sale_price_untrusted_marks VALUES('20000000-0000-0000-0000-000000000002',1002,NULL);
CREATE FUNCTION pg_temp.denied(q text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
SET ROLE anon;
SELECT set_config('request.jwt.claim.role','anon',false),set_config('request.jwt.claim.sub','',false);
SELECT public.t_assert(pg_temp.denied($q$SELECT public.popup_vehicle_intel('10000000-0000-0000-0000-000000000001')$q$),
  'before: current public popup fails under ordinary grants');
RESET ROLE;
\ir ../migrations/20261025081041_public_vehicle_price_reader.sql
SELECT public.t_assert(md5(pg_get_functiondef('public.popup_vehicle_intel(uuid)'::regprocedure))='6c5bfe2b1bd81a6f0484530a1858574c', -- gitleaks:allow (verified MD5 of a SQL function definition, not a credential)
  'popup is the measured live definition, unchanged by repair');
SET ROLE anon;
DO $$ DECLARE d jsonb; BEGIN
  d:=public.popup_vehicle_intel('10000000-0000-0000-0000-000000000001');
  PERFORM public.t_assert(jsonb_array_length(d->'recent_comps')=5,'after: popup answers, marked comp excluded');
  PERFORM public.t_assert(EXISTS(SELECT FROM jsonb_array_elements(d->'recent_comps') c
    WHERE c->>'id'='20000000-0000-0000-0000-000000000001' AND (c->>'sale_price')::numeric=1250),
    'popup comp uses current USD price');
  PERFORM public.t_assert(public.popup_vehicle_intel('10000000-0000-0000-0000-000000000002') IS NULL,
    'private popup remains hidden');
END $$;
RESET ROLE;
SELECT 'public popup price reader: PASS' AS result;
