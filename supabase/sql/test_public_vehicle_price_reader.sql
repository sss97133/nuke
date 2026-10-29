-- Disposable PG17 only. Compose the real profile reader with the measured
-- current price/trust functions and production-shaped column grants/RLS.
\set ON_ERROR_STOP on
\ir test_vehicle_profile_read.sql
ALTER TABLE public.vehicles ADD COLUMN entry_type text;
\ir ../migrations/20261019021500_profile_reader_contributor_role.sql
SET statement_timeout = '15s';
SELECT public.t_assert(md5(pg_get_functiondef('public.vehicle_profile_read(uuid)'::regprocedure))='3a52d01c3441d1bdb4423ffb68c3329a', -- gitleaks:allow (verified MD5 of a SQL function definition, not a credential)
  'profile is the measured live definition');

ALTER TABLE public.vehicles
  ADD COLUMN sale_status text, ADD COLUMN auction_outcome text, ADD COLUMN reserve_status text,
  ADD COLUMN sale_price numeric, ADD COLUMN sale_price_usd numeric, ADD COLUMN sale_price_currency text,
  ADD COLUMN bat_sold_price numeric, ADD COLUMN sold_price numeric, ADD COLUMN winning_bid numeric,
  ADD COLUMN high_bid numeric, ADD COLUMN asking_price numeric, ADD COLUMN sale_date date,
  ADD COLUMN bat_sale_date date, ADD COLUMN listing_updated_at timestamptz, ADD COLUMN listing_posted_at timestamptz,
  ADD COLUMN nuke_estimate numeric, ADD COLUMN nuke_estimate_confidence integer,
  ADD COLUMN valuation_calculated_at timestamptz, ADD COLUMN canonical_outcome text,
  ADD COLUMN canonical_platform text, ADD COLUMN listing_url text, ADD COLUMN bat_auction_url text,
  ADD COLUMN platform_url text, ADD COLUMN notes text, ADD COLUMN import_metadata jsonb,
  ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN auction_end_date text,
  ADD COLUMN purchase_price numeric, ADD COLUMN purchase_date date, ADD COLUMN purchase_location text,
  ADD COLUMN owner_name text, ADD COLUMN owner_contact text;
CREATE TABLE public.vehicle_events (id uuid PRIMARY KEY, vehicle_id uuid, final_price numeric,
  sale_truth_role text, price_verification text, source_suspect text[], sale_outcome text);
CREATE TABLE public.vehicle_event_trust (event_id uuid, retired_at timestamptz, trust text, writer text);
CREATE TABLE public.vehicle_sale_price_untrusted_marks (vehicle_id uuid, sale_price numeric,
  retired_at timestamptz, reason text, run_id text);
ALTER TABLE public.vehicle_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_events ON public.vehicle_events FOR SELECT USING (true);
ALTER TABLE public.vehicle_event_trust ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_sale_price_untrusted_marks ENABLE ROW LEVEL SECURITY;
-- Live trust is SELECT-granted but has no RLS policy. Marks have neither.
GRANT SELECT ON public.vehicle_events, public.vehicle_event_trust TO anon, authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
REVOKE SELECT ON public.vehicles FROM anon, authenticated;
DO $$ DECLARE cols text; BEGIN
  SELECT string_agg(quote_ident(attname), ',') INTO cols FROM pg_attribute
  WHERE attrelid='public.vehicles'::regclass AND attnum>0 AND NOT attisdropped
    AND attname <> ALL(ARRAY['sale_price_usd','sale_price_currency','purchase_price',
      'purchase_date','purchase_location','owner_name','owner_contact']);
  EXECUTE 'GRANT SELECT ('||cols||') ON public.vehicles TO anon, authenticated';
END $$;
-- Replace the inherited profile fixture's permissive access stand-in with the
-- current canonical owner/delegate helper, whose relations are all qualified.
CREATE TABLE public.admin_users(user_id uuid,is_active boolean);
CREATE TABLE public.vehicle_user_permissions(vehicle_id uuid,user_id uuid,is_active boolean,role text,granted_by uuid);
CREATE TABLE public.organization_vehicles(vehicle_id uuid,organization_id uuid,relationship_type text,status text,linked_by_user_id uuid);
CREATE TABLE public.organization_contributors(organization_id uuid,user_id uuid,status text,role text);
CREATE OR REPLACE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p_user_id IS NOT NULL AND p_vehicle_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.vehicles v
      WHERE v.id = p_vehicle_id AND p_user_id IN (v.user_id, v.owner_id, v.uploaded_by))
    OR EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = p_user_id AND au.is_active)
    OR EXISTS (SELECT 1 FROM public.ownership_verifications ov
      WHERE ov.vehicle_id = p_vehicle_id AND ov.user_id = p_user_id AND ov.status = 'approved')
    OR EXISTS (SELECT 1 FROM public.vehicle_user_permissions vup JOIN public.vehicles v ON v.id = vup.vehicle_id
      WHERE vup.vehicle_id = p_vehicle_id AND vup.user_id = p_user_id AND coalesce(vup.is_active, true)
        AND vup.role = ANY (ARRAY['owner', 'co_owner', 'mechanic', 'appraiser', 'moderator', 'contributor', 'photographer',
          'dealer_rep', 'sales_agent', 'restorer', 'consigner', 'board_member'])
        AND vup.granted_by <> vup.user_id AND vup.granted_by IN (v.user_id, v.owner_id, v.uploaded_by))
    OR EXISTS (SELECT 1 FROM public.vehicle_contributors vc
      WHERE vc.vehicle_id = p_vehicle_id AND vc.user_id = p_user_id AND coalesce(vc.status, 'active') = 'active'
        AND vc.role = ANY (ARRAY['owner', 'co_owner', 'restorer', 'moderator', 'consigner', 'mechanic', 'appraiser',
          'photographer', 'sales_agent']))
    OR EXISTS (SELECT 1 FROM public.organization_vehicles ov JOIN public.vehicles v ON v.id = ov.vehicle_id
      JOIN public.organization_contributors oc ON oc.organization_id = ov.organization_id
      WHERE ov.vehicle_id = p_vehicle_id AND ov.relationship_type IN ('owner', 'consigner') AND ov.status = 'active'
        AND (ov.linked_by_user_id IS NULL OR ov.linked_by_user_id IN (v.user_id, v.owner_id))
        AND oc.user_id = p_user_id AND oc.status = 'active'
        AND oc.role IN ('owner', 'co_founder', 'board_member', 'manager', 'employee')))
$function$;
SELECT public.t_assert((SELECT encode(sha256(convert_to(prosrc,'UTF8')),'base64')
  FROM pg_proc WHERE oid='public.vehicle_user_has_access(uuid,uuid)'::regprocedure)
  ='kAl3Z/lUqX+Vjwpuv8vaoTQsEAK57PqOpTY4sIlA7zA=', 'current canonical access helper');
DROP FUNCTION public.vehicle_price_facts(uuid[]);
\ir helpers/public_vehicle_price_readers_live_20261025.sql
REVOKE ALL ON FUNCTION public.vehicle_price_facts(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_price_facts(uuid[]) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.vehicle_price_facts(uuid[]) IS 'Fixture comment must survive';
CREATE TEMP TABLE original_reader_properties AS
SELECT proowner, proacl, prosecdef, proconfig, provolatile, proparallel, proargnames, proallargtypes,
  obj_description(oid, 'pg_proc') AS description FROM pg_proc
WHERE oid='public.vehicle_price_facts(uuid[])'::regprocedure;
CREATE TEMP TABLE original_policies AS SELECT * FROM pg_policy;
CREATE TEMP TABLE original_column_access AS
SELECT r,attname,has_column_privilege(r,'public.vehicles',attname,'SELECT') AS allowed
FROM unnest(ARRAY['anon','authenticated']) r CROSS JOIN pg_attribute
WHERE attrelid='public.vehicles'::regclass AND attnum>0 AND NOT attisdropped;

-- All synthetic; the production testimony tables are never written by this contract.
INSERT INTO public.vehicles(id,make,model,year,sale_status,sale_price,sale_price_usd,sale_date,
  canonical_platform,listing_url,is_public,deleted_at,owner_id,user_id,uploaded_by)
SELECT md5('public-price-'||n)::uuid,'Synthetic','Reader',1990,'sold',n*1000,
  CASE WHEN n=1 THEN 1250 END,'2026-01-01','bat','https://bringatrailer.com/listing/synthetic-'||n,
  n<>6,CASE WHEN n=7 THEN now() END,
  CASE WHEN n=6 THEN md5('price-owner')::uuid END,
  CASE WHEN n=6 THEN md5('price-user')::uuid END,
  CASE WHEN n=6 THEN md5('price-uploader')::uuid END
FROM generate_series(1,13) n;
UPDATE public.vehicles SET sale_price=NULL WHERE id=md5('public-price-9')::uuid;
INSERT INTO public.vehicle_sale_price_untrusted_marks VALUES
 (md5('public-price-2')::uuid,2000,NULL,'private reason','private run'),
 (md5('public-price-3')::uuid,3000,now(),'retired reason','private run'),
 (md5('public-price-6')::uuid,6000,NULL,'private vehicle reason','private run'),
 (md5('public-price-7')::uuid,7000,NULL,'deleted vehicle reason','private run'),
 (md5('public-price-10')::uuid,999,NULL,'old amount reason','private run');
INSERT INTO public.vehicle_events(id,vehicle_id,final_price,sale_truth_role,price_verification,sale_outcome) VALUES
 (md5('event-4')::uuid,md5('public-price-4')::uuid,4000,NULL,NULL,'sold'),
 (md5('event-5')::uuid,md5('public-price-5')::uuid,5000,NULL,NULL,'sold'),
 (md5('event-5-ok')::uuid,md5('public-price-5')::uuid,5000,NULL,'verified','sold'),
 (md5('event-11')::uuid,md5('public-price-11')::uuid,11000,NULL,NULL,'no_sale'),
 (md5('event-12')::uuid,md5('public-price-12')::uuid,12000,NULL,'contradicted','sold'),
 (md5('event-13')::uuid,md5('public-price-13')::uuid,13001,NULL,'verified','sold');
INSERT INTO public.vehicle_event_trust VALUES
 (md5('event-4')::uuid,NULL,'low','private writer'),
 (md5('event-5')::uuid,NULL,'low','private writer');
CREATE TEMP TABLE expected_prices AS
SELECT to_jsonb(f) AS fact FROM public.vehicle_price_facts(
  ARRAY(SELECT md5('public-price-'||n)::uuid FROM generate_series(1,13) n)) f;
GRANT SELECT ON expected_prices TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.denied(q text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
SET ROLE anon;
SELECT set_config('test.auth_role','anon',false),set_config('test.auth_uid','',false);
SELECT public.t_assert(pg_temp.denied($q$SELECT * FROM public.vehicle_price_facts(ARRAY[md5('public-price-1')::uuid])$q$),
  'preimage: real price reader fails under explicit column grants');
SELECT public.t_assert(NOT public.vehicle_event_low_trust(md5('event-4')::uuid),
  'preimage: RLS silently hides low-trust evidence from invoker');
RESET ROLE;
-- Show that the column grant alone cannot fix the private marks dependency.
GRANT SELECT(sale_price_usd) ON public.vehicles TO anon;
SET ROLE anon;
SELECT public.t_assert(pg_temp.denied($q$SELECT * FROM public.vehicle_price_facts(ARRAY[md5('public-price-1')::uuid])$q$),
  'preimage: price reader still fails after USD grant alone');
RESET ROLE;
REVOKE SELECT(sale_price_usd) ON public.vehicles FROM anon;

\ir ../migrations/20261025081041_public_vehicle_price_reader.sql
\ir ../migrations/20261025081041_public_vehicle_price_reader.sql
SELECT public.t_assert(NOT EXISTS(
  SELECT * FROM original_reader_properties EXCEPT SELECT proowner,proacl,prosecdef,proconfig,
    provolatile,proparallel,proargnames,proallargtypes,obj_description(oid,'pg_proc') FROM pg_proc
  WHERE oid='public.vehicle_price_facts(uuid[])'::regprocedure), 'reader ACL/invoker/signature/comment retained');
SELECT public.t_assert(NOT EXISTS(SELECT * FROM original_policies EXCEPT SELECT * FROM pg_policy)
  AND NOT EXISTS(SELECT * FROM pg_policy EXCEPT SELECT * FROM original_policies), 'no policy changed');
SELECT public.t_assert(NOT EXISTS(SELECT 1 FROM original_column_access
  WHERE attname<>'sale_price_usd' AND allowed IS DISTINCT FROM has_column_privilege(r,'public.vehicles',attname,'SELECT')),
  'only USD column admission changes');
SELECT public.t_assert(md5(pg_get_functiondef('public.vehicle_sale_price_untrusted(uuid,numeric)'::regprocedure))
  ='c86d59bd086f693f201e7d6f2dc4d863','canonical untrusted guard remains byte-identical'); -- gitleaks:allow (verified MD5 of a SQL function definition, not a credential)
SELECT public.t_assert(NOT has_function_privilege('public','public.vehicle_sale_price_untrusted_read(uuid)','execute'),
  'PUBLIC cannot execute narrow reader');

CREATE FUNCTION pg_temp.compare_prices(label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE differences integer;
BEGIN
  WITH expected AS (SELECT fact FROM expected_prices e JOIN public.vehicles v
    ON v.id=(e.fact->>'vehicle_id')::uuid WHERE v.deleted_at IS NULL),
  actual AS (SELECT to_jsonb(f) AS fact FROM public.vehicle_price_facts(
    ARRAY(SELECT md5('public-price-'||n)::uuid FROM generate_series(1,13) n)) f)
  SELECT count(*) INTO differences FROM
    ((SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
     UNION ALL (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)) d;
  PERFORM public.t_assert(differences=0,label||': all twenty fields match privileged baseline for visible rows');
END $$;

SET ROLE anon;
SELECT pg_temp.compare_prices('anon');
SELECT public.t_assert((SELECT price_amount FROM public.vehicle_price_facts(ARRAY[md5('public-price-1')::uuid]))=1250,
  'native sale uses existing converted USD basis');
SELECT public.t_assert((public.vehicle_profile_read(md5('public-price-1')::uuid)->'sections'->0->'price'->>'value')::numeric=1250,
  'real profile composes with repaired current price reader');
SELECT public.t_assert(public.vehicle_profile_read(md5('public-price-2')::uuid)->'sections'->0->'price'='null'::jsonb,
  'real profile does not show marked sale');
SELECT public.t_assert(public.vehicle_sale_price_untrusted_read(md5('public-price-4')::uuid)
  AND NOT public.vehicle_sale_price_untrusted_read(md5('public-price-5')::uuid), 'low-trust and corroborated rules retained');
SELECT public.t_assert(public.vehicle_sale_price_untrusted_read(md5('public-price-6')::uuid) IS NULL
  AND public.vehicle_sale_price_untrusted_read(md5('public-price-7')::uuid) IS NULL
  AND public.vehicle_sale_price_untrusted_read(md5('missing-price')::uuid) IS NULL
  AND public.vehicle_sale_price_untrusted_read(NULL) IS NULL, 'private/deleted/missing/null indistinguishable');
SELECT public.t_assert(NOT public.vehicle_sale_price_untrusted_read(md5('public-price-9')::uuid), 'visible null price is not marked');
SELECT public.t_assert(pg_temp.denied('SELECT * FROM public.vehicle_sale_price_untrusted_marks')
  AND NOT EXISTS(SELECT FROM public.vehicle_event_trust)
  AND pg_temp.denied('SELECT purchase_price FROM public.vehicles')
  AND pg_temp.denied('SELECT owner_contact FROM public.vehicles')
  AND pg_temp.denied('SELECT sale_price_currency FROM public.vehicles'), 'private audit/owner/unrequested fields stay closed');
-- An attacker temp relation must not shadow the private source in a nested helper.
CREATE TEMP TABLE vehicle_event_trust(event_id uuid,retired_at timestamptz,trust text);
SELECT public.t_assert(public.vehicle_sale_price_untrusted_read(md5('public-price-4')::uuid), 'temp trust table cannot hide low-trust mark');
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('test.auth_role','authenticated',false),set_config('test.auth_uid',md5('price-stranger')::uuid::text,false);
SELECT pg_temp.compare_prices('signed-in stranger');
SELECT public.t_assert(public.vehicle_sale_price_untrusted_read(md5('public-price-6')::uuid) IS NULL,'stranger private projection hidden');
DO $$ DECLARE u text; BEGIN
  FOREACH u IN ARRAY ARRAY['price-owner','price-user','price-uploader'] LOOP
    PERFORM set_config('test.auth_uid',md5(u)::uuid::text,false);
    PERFORM pg_temp.compare_prices(u);
    PERFORM public.t_assert(public.vehicle_sale_price_untrusted_read(md5('public-price-6')::uuid),u||': private current price guard allowed');
  END LOOP;
END $$;
RESET ROLE;
INSERT INTO public.vehicle_contributors VALUES(md5('public-price-6')::uuid,md5('price-delegate')::uuid,'mechanic','active');
SET ROLE authenticated;
SELECT set_config('test.auth_uid',md5('price-delegate')::uuid::text,false);
SELECT pg_temp.compare_prices('active delegate');
SELECT public.t_assert(public.vehicle_sale_price_untrusted_read(md5('public-price-6')::uuid),'active access sees private guard');
RESET ROLE;
UPDATE public.vehicle_contributors SET status='revoked' WHERE user_id=md5('price-delegate')::uuid;
SET ROLE authenticated;
SELECT pg_temp.compare_prices('revoked delegate');
SELECT public.t_assert(public.vehicle_sale_price_untrusted_read(md5('public-price-6')::uuid) IS NULL,'revoked access hides private guard immediately');
SELECT public.t_assert(pg_temp.denied('SELECT * FROM public.vehicle_sale_price_untrusted_marks')
  AND NOT EXISTS(SELECT FROM public.vehicle_event_trust),'signed-in audit details stay closed');
RESET ROLE;

-- ALLOW_RAW_TESTIMONY_WRITE: synthetic fixture in an empty disposable local PG17 database, never production.
INSERT INTO public.vehicle_user_permissions VALUES(md5('public-price-6')::uuid,md5('price-self-grant')::uuid,true,'co_owner',md5('price-self-grant')::uuid);
SET ROLE authenticated;
SELECT set_config('test.auth_uid',md5('price-self-grant')::uuid::text,false);
SELECT public.t_assert(public.vehicle_sale_price_untrusted_read(md5('public-price-6')::uuid) IS NULL,
  'self-granted permission does not admit the private guard');
RESET ROLE;

SET ROLE service_role;
SELECT set_config('test.auth_role','service_role',false),set_config('test.auth_uid','',false);
SELECT pg_temp.compare_prices('service role');
SELECT public.t_assert(public.vehicle_sale_price_untrusted_read(md5('public-price-6')::uuid), 'service role retains private current price guard');
SELECT public.t_assert(public.vehicle_sale_price_untrusted_read(md5('public-price-7')::uuid) IS NULL, 'service role still excludes deleted rows');
RESET ROLE;
SELECT 'public vehicle price reader: PASS' AS result;
