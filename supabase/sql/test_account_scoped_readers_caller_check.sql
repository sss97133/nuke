-- Disposable PG17 only. Random ids, synthetic rows; exercises the actual migration on live's function shapes.
-- Contract for 20261121191500_account_scoped_readers_caller_check.sql. Proves, for five functions that answer about
-- an account:
--   * before (live's definitions and grants): a logged-out caller reads every active consigned permission that has
--     no deal terms yet and any account's deal positions; another signed-in account reads the owner's vehicles (the ones that are not public and the
--     deleted ones too), the owner's export totals and, once the table resolves, the owner's stored credential;
--   * after: anon executes none of the five; another account, a JWT without a user and a session without a JWT
--     get 42501 from the two plpgsql readers and no row from the two sql readers; a signed-in caller cannot execute
--     the credential reader at all; the owner still reads their own rows and the service role reads everything;
--     arguments, defaults, return types, SECURITY DEFINER, settings and volatility are what they were.
-- get_user_api_key_info keeps search_path '' over an unqualified table, so with no table it can resolve every call
-- fails 42P01, as it does live. A session temp table stands in for a repaired search_path: pg_temp is searched
-- first even when search_path is ''.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR to_regprocedure('public.deals_needing_terms()') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable database required';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
-- auth.uid() and auth.jwt() as live defines them.
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- The tables the five bodies read, with the columns they name. No API role holds a grant on any of them: every
-- read below goes through a function that runs as its owner.
CREATE TABLE public.vehicles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), year integer, make text, model text,
  vin text, color text, mileage integer, created_at timestamptz DEFAULT now(), user_id uuid, uploaded_by uuid,
  discovery_url text, discovery_source text, profile_origin text, status text, is_public boolean,
  primary_image_url text, deleted_at timestamptz);
CREATE TABLE public.discovered_vehicles (user_id uuid, vehicle_id uuid, relationship_type text,
  discovery_source text, is_active boolean);
CREATE TABLE public.ownership_verifications (user_id uuid, vehicle_id uuid, status text);
CREATE TABLE public.vehicle_user_permissions (vehicle_id uuid, user_id uuid, role text, context text,
  is_active boolean, revoked_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.deal_jackets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, deal_type text,
  sold_date date, sale_price_inc_doc numeric, created_at timestamptz DEFAULT now());
CREATE TABLE public.deal_jacket_parties (deal_jacket_id uuid, user_id uuid, role text, threshold_amount numeric,
  split_pct numeric, flat_fee numeric, actual_amount numeric);
CREATE TABLE public.listing_exports (user_id uuid, platform text, status text, sold_price_cents bigint,
  commission_cents bigint);

-- Live before the migration (pg_get_functiondef and proacl, 2026-11-21), verbatim apart from trailing whitespace.
CREATE OR REPLACE FUNCTION public.deals_needing_terms()
 RETURNS TABLE(vehicle_id uuid, user_id uuid, permission_role text, permission_context text, deal_jacket_id uuid, has_parties boolean, gap text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '10s'
AS $function$
  SELECT
    vup.vehicle_id,
    vup.user_id,
    vup.role,
    vup.context,
    dj.id,
    EXISTS (SELECT 1 FROM deal_jacket_parties p WHERE p.deal_jacket_id = dj.id),
    CASE
      WHEN dj.id IS NULL THEN 'no_deal_jacket'
      WHEN NOT EXISTS (SELECT 1 FROM deal_jacket_parties p WHERE p.deal_jacket_id = dj.id) THEN 'no_structured_parties'
      ELSE 'complete'
    END
  FROM vehicle_user_permissions vup
  LEFT JOIN deal_jackets dj ON dj.vehicle_id = vup.vehicle_id
    AND dj.deal_type = 'consignment'
    AND dj.sold_date IS NULL
  WHERE vup.role = 'consigned'
    AND vup.revoked_at IS NULL
    AND COALESCE(vup.is_active, true)
    AND (dj.id IS NULL OR NOT EXISTS (SELECT 1 FROM deal_jacket_parties p WHERE p.deal_jacket_id = dj.id))
  ORDER BY vup.created_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.user_deal_positions(p_user_id uuid DEFAULT auth.uid())
 RETURNS TABLE(deal_jacket_id uuid, vehicle_id uuid, deal_type text, your_role text, threshold_amount numeric, split_pct numeric, expected_take numeric, actual_amount numeric, deal_status text, sale_price numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '10s'
AS $function$
  SELECT
    dj.id,
    dj.vehicle_id,
    dj.deal_type,
    p.role,
    p.threshold_amount,
    p.split_pct,
    CASE
      WHEN dj.sale_price_inc_doc IS NOT NULL AND p.split_pct IS NOT NULL THEN
        GREATEST(0, (dj.sale_price_inc_doc - COALESCE(p.threshold_amount, 0)) * p.split_pct / 100)
      WHEN p.flat_fee IS NOT NULL THEN p.flat_fee
      ELSE NULL
    END as expected_take,
    p.actual_amount,
    CASE
      WHEN dj.sold_date IS NOT NULL THEN 'closed'
      ELSE 'active'
    END,
    dj.sale_price_inc_doc
  FROM deal_jacket_parties p
  JOIN deal_jackets dj ON dj.id = p.deal_jacket_id
  WHERE p.user_id = p_user_id
  ORDER BY dj.created_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_vehicle_relationships(p_user_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'user_added_vehicles', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'vehicle', json_build_object(
            'id', v.id, 'year', v.year, 'make', v.make, 'model', v.model,
            'vin', v.vin, 'color', v.color, 'mileage', v.mileage,
            'created_at', v.created_at, 'user_id', v.user_id,
            'uploaded_by', v.uploaded_by, 'discovery_url', v.discovery_url,
            'discovery_source', v.discovery_source, 'profile_origin', v.profile_origin,
            'status', v.status, 'is_public', v.is_public,
            'primary_image_url', v.primary_image_url
          ),
          'images', CASE
            WHEN v.primary_image_url IS NOT NULL
            THEN json_build_array(json_build_object(
              'image_url', v.primary_image_url,
              'is_primary', true,
              'variants', NULL
            ))
            ELSE '[]'::json
          END
        )
        ORDER BY v.created_at DESC
      ), '[]'::json)
      FROM vehicles v
      WHERE v.user_id = p_user_id OR v.uploaded_by = p_user_id
    ),
    'discovered_vehicles', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'relationship_type', COALESCE(dv.relationship_type, 'interested'),
          'discovery_source', dv.discovery_source,
          'vehicle', json_build_object(
            'id', v.id, 'year', v.year, 'make', v.make, 'model', v.model,
            'vin', v.vin, 'color', v.color, 'mileage', v.mileage,
            'created_at', v.created_at, 'status', v.status, 'is_public', v.is_public,
            'discovery_url', v.discovery_url, 'discovery_source', v.discovery_source,
            'primary_image_url', v.primary_image_url
          ),
          'images', CASE
            WHEN v.primary_image_url IS NOT NULL
            THEN json_build_array(json_build_object(
              'image_url', v.primary_image_url, 'is_primary', true, 'variants', NULL
            ))
            ELSE '[]'::json
          END
        )
        ORDER BY v.created_at DESC
      ), '[]'::json)
      FROM discovered_vehicles dv
      JOIN vehicles v ON v.id = dv.vehicle_id
      WHERE dv.user_id = p_user_id AND dv.is_active = true
    ),
    'verified_ownerships', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'vehicle_id', ov.vehicle_id,
          'vehicle', json_build_object(
            'id', v.id, 'year', v.year, 'make', v.make, 'model', v.model,
            'vin', v.vin, 'color', v.color, 'mileage', v.mileage,
            'created_at', v.created_at, 'status', v.status, 'is_public', v.is_public,
            'primary_image_url', v.primary_image_url
          ),
          'images', CASE
            WHEN v.primary_image_url IS NOT NULL
            THEN json_build_array(json_build_object(
              'image_url', v.primary_image_url, 'is_primary', true, 'variants', NULL
            ))
            ELSE '[]'::json
          END
        )
      ), '[]'::json)
      FROM ownership_verifications ov
      JOIN vehicles v ON v.id = ov.vehicle_id
      WHERE ov.user_id = p_user_id AND ov.status = 'approved'
    ),
    'permission_ownerships', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'vehicle_id', vup.vehicle_id,
          'role', vup.role,
          'vehicle', json_build_object(
            'id', v.id, 'year', v.year, 'make', v.make, 'model', v.model,
            'vin', v.vin, 'color', v.color, 'mileage', v.mileage,
            'created_at', v.created_at, 'status', v.status, 'is_public', v.is_public,
            'primary_image_url', v.primary_image_url
          ),
          'images', CASE
            WHEN v.primary_image_url IS NOT NULL
            THEN json_build_array(json_build_object(
              'image_url', v.primary_image_url, 'is_primary', true, 'variants', NULL
            ))
            ELSE '[]'::json
          END
        )
      ), '[]'::json)
      FROM vehicle_user_permissions vup
      JOIN vehicles v ON v.id = vup.vehicle_id
      WHERE vup.user_id = p_user_id
        AND COALESCE(vup.is_active, true) = true
        AND vup.role IN ('owner', 'co_owner')
    )
  ) INTO result;

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_export_analytics(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_exports', COUNT(*),
    'by_platform', jsonb_object_agg(COALESCE(platform, 'unknown'), platform_count),
    'by_status', jsonb_object_agg(COALESCE(status, 'unknown'), status_count),
    'total_sold', SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END),
    'total_revenue_cents', SUM(CASE WHEN status = 'sold' THEN sold_price_cents ELSE 0 END),
    'total_commission_cents', SUM(CASE WHEN commission_cents IS NOT NULL THEN commission_cents ELSE 0 END),
    'conversion_rate', ROUND(
      (SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END)::DECIMAL / NULLIF(COUNT(*), 0)) * 100, 2
    )
  ) INTO v_result
  FROM (
    SELECT platform, status, sold_price_cents, commission_cents,
      COUNT(*) OVER (PARTITION BY platform) as platform_count,
      COUNT(*) OVER (PARTITION BY status) as status_count
    FROM listing_exports WHERE user_id = p_user_id
  ) exports;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_api_key_info(p_user_id uuid, p_provider text)
 RETURNS TABLE(api_key_encrypted text, model_name text, is_default boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    uap.api_key_encrypted,
    uap.model_name,
    uap.is_default
  FROM user_ai_providers uap
  WHERE uap.user_id = p_user_id
    AND uap.provider = p_provider
    AND uap.is_active = true
  ORDER BY uap.is_default DESC, uap.created_at DESC
  LIMIT 1;
END;
$function$;

-- Live's grants: the two deal readers keep the default EXECUTE for PUBLIC; the other three have it revoked.
GRANT EXECUTE ON FUNCTION public.deals_needing_terms(), public.user_deal_positions(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_user_vehicle_relationships(uuid), public.get_export_analytics(uuid),
  public.get_user_api_key_info(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_vehicle_relationships(uuid), public.get_export_analytics(uuid),
  public.get_user_api_key_info(uuid, text) TO authenticated, service_role;
CREATE TEMP TABLE shape_before AS
  SELECT p.proname, p.prosecdef, p.proconfig, p.provolatile, p.prolang, pg_get_function_arguments(p.oid) AS args,
         pg_get_function_result(p.oid) AS result
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('deals_needing_terms', 'user_deal_positions', 'get_user_vehicle_relationships',
                       'get_export_analytics', 'get_user_api_key_info');

CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
CREATE FUNCTION public.t_sqlstate(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_sqlstate(text) TO authenticated, anon, service_role;

SELECT gen_random_uuid() AS owner, gen_random_uuid() AS other, gen_random_uuid() AS third \gset
SELECT json_build_object('sub', :'owner', 'role', 'authenticated') AS owner_jwt,
       json_build_object('sub', :'other', 'role', 'authenticated') AS other_jwt,
       json_build_object('sub', :'third', 'role', 'authenticated') AS third_jwt \gset
SELECT format('SELECT count(*) FROM public.deals_needing_terms()') AS deals_q,
       format('SELECT count(*) FROM public.user_deal_positions(%L)', :'owner') AS positions_q,
       format('SELECT public.get_user_vehicle_relationships(%L)', :'owner') AS rel_q,
       format('SELECT public.get_export_analytics(%L)', :'owner') AS export_q,
       format('SELECT count(*) FROM public.get_user_api_key_info(%L, %L)', :'owner', 'anthropic') AS key_q \gset

-- The owner has four vehicles (two public, one not public, one deleted), one consigned permission with no deal terms
-- yet, one deal position and two exports. A third account has one consigned permission of its own.
INSERT INTO public.vehicles (id, year, make, model, vin, mileage, user_id, is_public, deleted_at) VALUES
  ('a0000000-0000-4000-8000-000000000001', 1973, 'Test', 'Public', 'VINPUBLIC', 100, :'owner', true, NULL),
  ('a0000000-0000-4000-8000-000000000002', 1974, 'Test', 'Private', 'VINPRIVATE', 200, :'owner', false, NULL),
  ('a0000000-0000-4000-8000-000000000003', 1975, 'Test', 'Deleted', 'VINDELETED', 300, :'owner', false, now()),
  ('a0000000-0000-4000-8000-000000000004', 1976, 'Test', 'Thirds', 'VINTHIRD', 400, :'third', true, NULL),
  ('a0000000-0000-4000-8000-000000000005', 1977, 'Test', 'Dealt', 'VINDEALT', 500, :'owner', true, NULL);
INSERT INTO public.vehicle_user_permissions (vehicle_id, user_id, role, context) VALUES
  ('a0000000-0000-4000-8000-000000000001', :'owner', 'consigned', 'owner note'),
  ('a0000000-0000-4000-8000-000000000004', :'third', 'consigned', 'third note');
INSERT INTO public.deal_jackets (id, vehicle_id, deal_type, sale_price_inc_doc) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000005', 'consignment', 10000);
INSERT INTO public.deal_jacket_parties (deal_jacket_id, user_id, role, threshold_amount, split_pct) VALUES
  ('d0000000-0000-4000-8000-000000000001', :'owner', 'consignee', 1000, 50);
INSERT INTO public.listing_exports (user_id, platform, status, sold_price_cents, commission_cents) VALUES
  (:'owner', 'bat', 'sold', 5000, 100), (:'owner', 'ebay', 'listed', NULL, NULL);

-- 1. Before. A logged-out caller reads every open consignment and the owner's deal position.
SET ROLE anon; SET request.jwt.claims = '{"role": "anon"}';
SELECT (SELECT count(*) FROM public.deals_needing_terms()) AS before_anon_deals,
       (SELECT string_agg(permission_context, ',' ORDER BY permission_context) FROM public.deals_needing_terms()) AS before_anon_notes,
       (SELECT count(*) FROM public.user_deal_positions(:'owner')) AS before_anon_positions \gset
RESET ROLE;
--    Another signed-in account reads the owner's vehicles and export totals; the credential reader resolves no table.
SET ROLE authenticated; SET request.jwt.claims = :'other_jwt';
SELECT json_array_length(public.get_user_vehicle_relationships(:'owner') -> 'user_added_vehicles') AS before_other_vehicles,
       (SELECT string_agg(e -> 'vehicle' ->> 'vin', ',' ORDER BY e -> 'vehicle' ->> 'vin')
          FROM json_array_elements(public.get_user_vehicle_relationships(:'owner') -> 'user_added_vehicles') e) AS before_other_vins,
       public.get_export_analytics(:'owner') ->> 'total_exports' AS before_other_exports,
       t_sqlstate(:'key_q') AS before_key_no_table \gset
RESET ROLE;
--    Once the table resolves, the same account reads the owner's stored credential.
CREATE TEMP TABLE user_ai_providers (user_id uuid, provider text, api_key_encrypted text, model_name text,
  is_default boolean, is_active boolean, created_at timestamptz DEFAULT now());
INSERT INTO user_ai_providers (user_id, provider, api_key_encrypted, model_name, is_default, is_active)
VALUES (:'owner', 'anthropic', 'enc:v1:synthetic', 'synthetic-model', true, true);
SET ROLE authenticated; SET request.jwt.claims = :'other_jwt';
SELECT (SELECT api_key_encrypted FROM public.get_user_api_key_info(:'owner', 'anthropic')) AS before_other_key \gset
RESET ROLE;
SELECT t_assert(:before_anon_deals = 2 AND :'before_anon_notes' = 'owner note,third note',
  'before: a logged-out caller reads every open consignment and its note');
SELECT t_assert(:before_anon_positions = 1, 'before: a logged-out caller reads the owner''s deal position');
SELECT t_assert(:before_other_vehicles = 4 AND :'before_other_vins' = 'VINDEALT,VINDELETED,VINPRIVATE,VINPUBLIC',
  'before: another account reads the owner''s vehicles, the private and the deleted ones too');
SELECT t_assert(:'before_other_exports' = '2', 'before: another account reads the owner''s export totals');
SELECT t_assert(:'before_key_no_table' = '42P01', 'before: the credential reader fails 42P01 with no table it can resolve, as live');
SELECT t_assert(:'before_other_key' = 'enc:v1:synthetic', 'before: once the table resolves, another account reads the owner''s stored credential');

-- 2. The migration, twice: a second application changes nothing and passes its own check.
\ir ../migrations/20261121191500_account_scoped_readers_caller_check.sql
\ir ../migrations/20261121191500_account_scoped_readers_caller_check.sql

-- 3. After: a logged-out caller executes none of the five.
SET ROLE anon; SET request.jwt.claims = '{"role": "anon"}';
SELECT t_sqlstate(:'deals_q') AS anon_deals, t_sqlstate(:'positions_q') AS anon_positions, t_sqlstate(:'rel_q') AS anon_rel,
       t_sqlstate(:'export_q') AS anon_export, t_sqlstate(:'key_q') AS anon_key \gset
RESET ROLE;
SELECT t_assert(:'anon_deals' = '42501' AND :'anon_positions' = '42501' AND :'anon_rel' = '42501'
  AND :'anon_export' = '42501' AND :'anon_key' = '42501', 'after: a logged-out caller is refused by all five with 42501');

-- 4. After: another account gets 42501 from the plpgsql readers and the credential reader, no row from the sql readers.
SET ROLE authenticated; SET request.jwt.claims = :'other_jwt';
SELECT t_sqlstate(:'rel_q') AS other_rel, t_sqlstate(:'export_q') AS other_export, t_sqlstate(:'key_q') AS other_key,
       (SELECT count(*) FROM public.deals_needing_terms()) AS other_deals,
       (SELECT count(*) FROM public.user_deal_positions(:'owner')) AS other_positions,
       (SELECT count(*) FROM public.user_deal_positions()) AS other_own_positions \gset
--    A JWT without a user.
SET request.jwt.claims = '{"role": "authenticated"}';
SELECT t_sqlstate(:'rel_q') AS no_user_rel, t_sqlstate(:'export_q') AS no_user_export,
       (SELECT count(*) FROM public.deals_needing_terms()) AS no_user_deals,
       (SELECT count(*) FROM public.user_deal_positions(:'owner')) AS no_user_positions \gset
--    A session without a JWT.
RESET request.jwt.claims;
SELECT t_sqlstate(:'rel_q') AS no_jwt_rel, t_sqlstate(:'export_q') AS no_jwt_export,
       (SELECT count(*) FROM public.deals_needing_terms()) AS no_jwt_deals,
       (SELECT count(*) FROM public.user_deal_positions(:'owner')) AS no_jwt_positions \gset
--    A null account id, and an account whose own metadata says service_role: only the token's top-level role counts.
SET request.jwt.claims = :'other_jwt';
SELECT t_sqlstate('SELECT public.get_user_vehicle_relationships(NULL::uuid)') AS other_null_rel,
       t_sqlstate('SELECT public.get_export_analytics(NULL::uuid)') AS other_null_export \gset
SELECT json_build_object('sub', :'other', 'role', 'authenticated',
         'user_metadata', json_build_object('role', 'service_role'),
         'app_metadata', json_build_object('role', 'service_role')) AS metadata_jwt \gset
SET request.jwt.claims = :'metadata_jwt';
SELECT t_sqlstate(:'rel_q') AS metadata_rel, t_sqlstate(:'export_q') AS metadata_export,
       (SELECT count(*) FROM public.deals_needing_terms()) AS metadata_deals,
       (SELECT count(*) FROM public.user_deal_positions(:'owner')) AS metadata_positions \gset
RESET ROLE;
SELECT t_assert(:'other_rel' = '42501' AND :'other_export' = '42501', 'after: another account is refused with 42501');
SELECT t_assert(:'other_key' = '42501', 'after: a signed-in account cannot execute the credential reader');
SELECT t_assert(:other_deals = 0 AND :other_positions = 0 AND :other_own_positions = 0,
  'after: another account reads no consignment and no deal position of the owner');
SELECT t_assert(:'no_user_rel' = '42501' AND :'no_user_export' = '42501' AND :no_user_deals = 0 AND :no_user_positions = 0,
  'after: a JWT without a user is refused or reads no row');
SELECT t_assert(:'no_jwt_rel' = '42501' AND :'no_jwt_export' = '42501' AND :no_jwt_deals = 0 AND :no_jwt_positions = 0,
  'after: a session without a JWT is refused or reads no row');
SELECT t_assert(:'other_null_rel' = '42501' AND :'other_null_export' = '42501', 'after: a null account id is refused');
SELECT t_assert(:'metadata_rel' = '42501' AND :'metadata_export' = '42501' AND :metadata_deals = 0 AND :metadata_positions = 0,
  'after: service_role written in an account''s own metadata changes nothing');

-- 5. After: the owner reads their own rows, unchanged; a third account reads only its own consignment.
SET ROLE authenticated; SET request.jwt.claims = :'owner_jwt';
SELECT json_array_length(public.get_user_vehicle_relationships(:'owner') -> 'user_added_vehicles') AS owner_vehicles,
       public.get_export_analytics(:'owner') ->> 'total_exports' AS owner_exports,
       public.get_export_analytics(:'owner') ->> 'total_revenue_cents' AS owner_revenue,
       (SELECT string_agg(permission_context, ',') FROM public.deals_needing_terms()) AS owner_deals,
       (SELECT expected_take FROM public.user_deal_positions(:'owner')) AS owner_take,
       (SELECT count(*) FROM public.user_deal_positions()) AS owner_default_positions,
       t_sqlstate(:'key_q') AS owner_key \gset
SET request.jwt.claims = :'third_jwt';
SELECT (SELECT string_agg(permission_context, ',') FROM public.deals_needing_terms()) AS third_deals \gset
RESET ROLE;
SELECT t_assert(:owner_vehicles = 4 AND :'owner_exports' = '2' AND :'owner_revenue' = '5000',
  'after: the owner reads their own vehicles and export totals');
SELECT t_assert(:'owner_deals' = 'owner note' AND :'third_deals' = 'third note',
  'after: each account lists only its own open consignment');
SELECT t_assert(:owner_take = 4500 AND :owner_default_positions = 1,
  'after: the owner reads their own deal position, by id and by the default argument');
SELECT t_assert(:'owner_key' = '42501', 'after: the owner, signed in, cannot execute the credential reader either');

-- 6. After: the service role reads everything, the credential reader included.
SET ROLE service_role; SET request.jwt.claims = '{"role": "service_role"}';
SELECT (SELECT count(*) FROM public.deals_needing_terms()) AS service_deals,
       (SELECT count(*) FROM public.user_deal_positions(:'owner')) AS service_positions,
       json_array_length(public.get_user_vehicle_relationships(:'owner') -> 'user_added_vehicles') AS service_vehicles,
       public.get_export_analytics(:'owner') ->> 'total_exports' AS service_exports,
       (SELECT api_key_encrypted FROM public.get_user_api_key_info(:'owner', 'anthropic')) AS service_key \gset
RESET ROLE;
RESET request.jwt.claims;
SELECT t_assert(:service_deals = 2 AND :service_positions = 1 AND :service_vehicles = 4 AND :'service_exports' = '2',
  'after: the service role reads every consignment, position, vehicle and export total');
SELECT t_assert(:'service_key' = 'enc:v1:synthetic', 'after: the service role still executes the credential reader');

-- 7. The credential reader's body is live's: with no table it can resolve, the service role's call fails 42P01.
DROP TABLE pg_temp.user_ai_providers;
SET ROLE service_role; SET request.jwt.claims = '{"role": "service_role"}';
SELECT t_sqlstate(:'key_q') AS service_key_no_table \gset
RESET ROLE;
RESET request.jwt.claims;
SELECT t_assert(:'service_key_no_table' = '42P01', 'after: the credential reader still resolves no table under search_path '''', as live');

-- 8. Arguments, defaults, return types, language, SECURITY DEFINER, settings and volatility are what they were.
SELECT t_assert((SELECT count(*) = 5 AND bool_and(p.prosecdef = b.prosecdef AND p.proconfig IS NOT DISTINCT FROM b.proconfig
      AND p.provolatile = b.provolatile AND p.prolang = b.prolang AND pg_get_function_arguments(p.oid) = b.args
      AND pg_get_function_result(p.oid) = b.result)
    FROM pg_proc p JOIN shape_before b USING (proname) WHERE p.pronamespace = 'public'::regnamespace),
  'arguments, defaults, return types, language, SECURITY DEFINER, settings and volatility are unchanged');
SELECT t_assert((SELECT bool_and(p.prosecdef) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('deals_needing_terms', 'user_deal_positions', 'get_user_vehicle_relationships',
                      'get_export_analytics', 'get_user_api_key_info')), 'all five still run as their owner');

-- 9. EXECUTE: never PUBLIC or anon; authenticated on the four readers only; the service role on all five.
SELECT t_assert((SELECT bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('deals_needing_terms', 'user_deal_positions', 'get_user_vehicle_relationships',
                       'get_export_analytics', 'get_user_api_key_info')),
  'no EXECUTE for PUBLIC or anon on any of the five; the service role keeps all five');
SELECT t_assert(has_function_privilege('authenticated', 'public.deals_needing_terms()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.user_deal_positions(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.get_user_vehicle_relationships(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.get_export_analytics(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.get_user_api_key_info(uuid, text)', 'EXECUTE'),
  'authenticated executes the four readers and not the credential reader');
SELECT 'account scoped readers caller check contract: PASS' AS result;
