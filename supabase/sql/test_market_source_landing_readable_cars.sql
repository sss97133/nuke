-- Empty disposable PG17 only:
--   createdb dm_refinement_msl; psql -X -v ON_ERROR_STOP=1 -d dm_refinement_msl -f this-file.sql
-- ALLOW_RAW_TESTIMONY_WRITE: synthetic fixture rows in the disposable contract database.
-- Proves 20261126080000_market_source_landing_readable_cars.sql against the live definition (20261021004000, whose body
-- hashes to the live prosrc, 2026-11-25), called as anon:
--   before: the dealer-organization fallback lists a private car's link with its VIN and the link's price, and the event
--   paths show a private car's VIN and make;
--   after: the fallback lists only the readable car, priced from the car; every event is still listed with its own
--   testimony, and an event on a private car shows no car attributes (its metadata VIN stays); a re-run is a no-op; the
--   ACL and SECURITY DEFINER are unchanged; the hash guard refuses a drifted body.
-- Fixture: the shared profile fixture (vehicles, organization_vehicles as live), the predicate as live, and the five other
-- tables the function reads, columns, NOT NULL, defaults, primary, unique and foreign keys as read live on 2026-11-25
-- (enum and domain columns as text; check constraints left out: they constrain no row this test writes). organizations
-- is the FK target only (id): the function does not read it.
\set ON_ERROR_STOP on
\ir helpers/get_vehicle_profile_data_fixture_20261125.sql
CREATE FUNCTION public.vehicle_publicly_readable(p_is_public boolean, p_deleted_at timestamptz, p_merged_into_vehicle_id uuid)
 RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT coalesce(p_is_public, false) AND (p_deleted_at IS NULL OR p_merged_into_vehicle_id IS NOT NULL)
$function$;
REVOKE ALL ON FUNCTION public.vehicle_publicly_readable(boolean, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_publicly_readable(boolean, timestamptz, uuid) TO anon, authenticated;
CREATE TABLE public.organizations (id uuid PRIMARY KEY);
-- The vehicles read policies verbatim (live 2026-11-25), for the registered copy's hash (vehicle_user_has_access comes
-- from the shared fixture; the definer reader runs as the table owner, so the policies decide nothing here).
CREATE POLICY vehicles_private_select ON public.vehicles FOR SELECT USING ((is_public = false) AND (( SELECT auth.uid() AS uid) IS NOT NULL) AND ((( SELECT auth.uid() AS uid) = user_id) OR (( SELECT auth.uid() AS uid) = owner_id) OR (( SELECT auth.uid() AS uid) = uploaded_by) OR vehicle_user_has_access(id, ( SELECT auth.uid() AS uid))));
CREATE POLICY vehicles_public_select ON public.vehicles FOR SELECT USING ((is_public = true) OR (auth.role() = 'service_role'::text));
-- private_row_policy_copies and its hash function as live (20261125204500, first_recorded_at from 20261126013700).
CREATE TABLE public.private_row_policy_copies (
  reader        text NOT NULL CHECK (reader ~ '^[a-z_][a-z0-9_]*\(([a-z_][a-z0-9_ ]*(\[\])?(, *[a-z_][a-z0-9_ ]*(\[\])?)*)?\)$'),
  relation      text NOT NULL CHECK (relation ~ '^[a-z_][a-z0-9_]*$'),
  policy_filter text NOT NULL CHECK (policy_filter <> '' AND position(';' IN policy_filter) = 0),
  recorded_hash text NOT NULL CHECK (recorded_hash ~ '^[0-9a-f]{32}$'),
  owner_lane    text NOT NULL,
  note          text NOT NULL CHECK (note <> ''),
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  active        boolean NOT NULL DEFAULT true,
  first_recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reader, relation, policy_filter)
);
CREATE FUNCTION public.private_row_policy_hash(p_relation text, p_policy_filter text)
RETURNS TABLE (policy_hash text, policies int) LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $f$
BEGIN
  IF p_relation !~ '^[a-z_][a-z0-9_]*$' OR position(';' IN p_policy_filter) > 0 THEN
    RAISE EXCEPTION 'private_row_policy_hash: bad relation or filter';
  END IF;
  RETURN QUERY EXECUTE format(
    'SELECT md5(string_agg(p.policyname || '':'' || p.permissive || '':'' || p.cmd || '':'' || p.roles::text || '':'' || coalesce(p.qual, ''''),
                           ''|'' ORDER BY p.policyname)), count(*)::int
       FROM pg_catalog.pg_policies p WHERE p.schemaname = ''public'' AND p.tablename = %L AND (%s)', p_relation, p_policy_filter);
END $f$;
DO $$ BEGIN
  ASSERT (SELECT h.policy_hash FROM public.private_row_policy_hash('vehicles', 'p.cmd IN (''SELECT'', ''ALL'')') h)
         = '7773d11e280e80abad0422000a1ff9cc', 'fixture vehicles read policies hash as live';
END $$;
CREATE TABLE public.market_source_days (
  day date NOT NULL,
  source_slug text NOT NULL,
  display_name text NOT NULL,
  category text,
  house text,
  landed_lots bigint,
  landed_at timestamp with time zone,
  population bigint,
  population_method text,
  population_confidence numeric,
  population_at timestamp with time zone,
  map_sales bigint,
  map_usd numeric,
  sales_12m bigint,
  usd_12m numeric,
  sales_prior_12m bigint,
  usd_prior_12m numeric,
  months jsonb,
  recorded_at timestamp with time zone DEFAULT now() NOT NULL,
  venue_lots bigint,
  venue_slug text,
  members integer,
  species text,
  PRIMARY KEY (day, source_slug)
);
CREATE TABLE public.market_source_hours (
  hour timestamp with time zone NOT NULL,
  source_key text NOT NULL,
  records integer NOT NULL,
  recorded_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (hour, source_key)
);
CREATE TABLE public.source_alias_mapping (
  raw_value text NOT NULL,
  canonical_slug text NOT NULL,
  notes text,
  PRIMARY KEY (raw_value)
);
CREATE TABLE public.observation_sources (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  slug text NOT NULL,
  display_name text NOT NULL,
  category text NOT NULL,
  base_url text,
  url_patterns text[],
  base_trust_score numeric(3,2) DEFAULT 0.50,
  trust_factors jsonb DEFAULT '{}'::jsonb,
  supported_observations text[],
  requires_auth boolean DEFAULT false,
  rate_limit_per_hour integer,
  makes_covered text[],
  years_covered int4range,
  regions_covered text[],
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  business_id uuid,
  tier integer,
  decay_half_life_days integer,
  veracity numeric(3,2),
  consecration numeric(3,2),
  market_slug text,
  species text,
  species_set text[],
  species_evidence jsonb,
  FOREIGN KEY (business_id) REFERENCES public.organizations(id) ON DELETE SET NULL,
  PRIMARY KEY (id),
  UNIQUE (slug)
);
CREATE TABLE public.vehicle_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  vehicle_id uuid NOT NULL,
  source_organization_id uuid,
  source_platform text NOT NULL,
  source_url text,
  source_listing_id text,
  event_type text DEFAULT 'auction'::text NOT NULL,
  event_status text DEFAULT 'active'::text NOT NULL,
  started_at timestamp with time zone,
  ended_at timestamp with time zone,
  sold_at timestamp with time zone,
  starting_price numeric,
  current_price numeric,
  final_price numeric,
  reserve_price numeric,
  buy_now_price numeric,
  bid_count integer DEFAULT 0,
  comment_count integer DEFAULT 0,
  view_count integer DEFAULT 0,
  watcher_count integer DEFAULT 0,
  seller_identifier text,
  buyer_identifier text,
  seller_external_identity_id uuid,
  buyer_external_identity_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  extracted_at timestamp with time zone DEFAULT now(),
  extraction_method text,
  extraction_source text,
  extractor_version text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  merged_from_vehicle_id uuid,
  sale_truth_role text,
  sold_at_precision text,
  sale_date_recovery_rule text,
  sale_date_recovery_at timestamp with time zone,
  currency_code text,
  currency_source text,
  price_basis text,
  hammer_price numeric,
  hammer_price_source text,
  hammer_price_confidence text,
  buyer_premium_amount numeric,
  buyer_premium_rate numeric,
  buyer_premium_source text,
  buyer_premium_confidence text,
  gross_price numeric,
  gross_price_source text,
  gross_price_confidence text,
  seller_fee_amount numeric,
  seller_fee_source text,
  seller_fee_confidence text,
  net_to_owner numeric,
  net_to_owner_source text,
  net_to_owner_confidence text,
  price_basis_run_id text,
  fx_to_usd numeric,
  fx_to_usd_source text,
  price_basis_conflict boolean,
  price_kind text,
  price_kind_source text,
  lot_category text,
  lot_category_source text,
  sale_type text,
  sale_type_source text,
  charity_lot boolean,
  charity_lot_source text,
  extraction_run_id text,
  price_verification text,
  price_verification_source text,
  price_verification_run_id text,
  price_verification_at timestamp with time zone,
  source_suspect text[],
  source_suspect_reason text,
  source_suspect_run_id text,
  source_suspect_at timestamp with time zone,
  duplicate_of_event_id uuid,
  high_bid_currency text,
  high_bid_fx_to_usd numeric,
  high_bid_fx_source text,
  high_bid_usd numeric,
  identity_check text,
  identity_check_lot_id text,
  identity_check_vehicle_vin text,
  identity_check_source text,
  identity_check_run_id text,
  identity_check_at timestamp with time zone,
  lot_number text,
  lot_number_source_url text,
  lot_number_run_id text,
  lot_number_read_at timestamp with time zone,
  sale_outcome text,
  sale_outcome_source_url text,
  sale_outcome_evidence text,
  sale_outcome_run_id text,
  sale_outcome_observed_at timestamp with time zone,
  high_bid numeric,
  FOREIGN KEY (duplicate_of_event_id) REFERENCES public.vehicle_events(id) ON DELETE SET NULL,
  PRIMARY KEY (id),
  FOREIGN KEY (source_organization_id) REFERENCES public.organizations(id),
  FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE RESTRICT NOT VALID
);
\ir ../migrations/20261021004000_market_source_window_starts_at_first_bar.sql
REVOKE ALL ON FUNCTION public.market_source_landing_read(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.market_source_landing_read(text, timestamptz) TO anon, authenticated, service_role;

-- Made-up rows. Cars: 1111 public, 2222 private, 3333 public but deleted (not merged).
INSERT INTO public.organizations (id) VALUES ('0a000000-0000-4000-8000-00000000000a');
INSERT INTO public.vehicles (id, is_public, deleted_at, make, model, year, vin, sale_price) VALUES
  ('11111111-1111-4111-8111-111111111111', true,  NULL,  'Pubmake',  'Public',  1970, 'FIXTUREVINPUBLIC1', 100),
  ('22222222-2222-4222-8222-222222222222', false, NULL,  'Privmake', 'Private', 1971, 'FIXTUREVINPRIVATE', 200),
  ('33333333-3333-4333-8333-333333333333', true,  now(), 'Delmake',  'Deleted', 1972, 'FIXTUREVINDELETED', 300);
INSERT INTO public.observation_sources (slug, display_name, category, business_id)
VALUES ('fixturedealer', 'Fixture Dealer', 'dealer', '0a000000-0000-4000-8000-00000000000a');
INSERT INTO public.organization_vehicles (id, organization_id, vehicle_id, relationship_type, status, asking_price, sale_price, created_at)
VALUES ('01000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'consigner', 'active', 555, NULL, now() - interval '3 minutes'),
       ('02000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-00000000000a', '22222222-2222-4222-8222-222222222222', 'consigner', 'active', 777, NULL, now() - interval '2 minutes'),
       ('03000000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-00000000000a', '33333333-3333-4333-8333-333333333333', 'consigner', 'sold', NULL, 888, now() - interval '1 minute');
INSERT INTO public.vehicle_events (id, vehicle_id, source_platform, event_type, event_status, final_price, metadata, created_at)
VALUES ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'fixtureauction', 'auction', 'sold', 1000, '{}', now() - interval '5 minutes'),
       ('e2000000-0000-4000-8000-0000000000e2', '22222222-2222-4222-8222-222222222222', 'fixtureauction', 'auction', 'sold', 2000,
        '{"vin": "FIXTUREVINEVENT02"}', now() - interval '4 minutes');

CREATE FUNCTION pg_temp.recent(p_source text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE anon;
  r := public.market_source_landing_read(p_source, NULL) -> 'recent';
  RESET ROLE;
  RETURN coalesce(r, '[]'::jsonb);
END $$;

-- 0. The leak, reproduced on the live definition.
DO $$
DECLARE d jsonb := pg_temp.recent('fixturedealer'); a jsonb := pg_temp.recent(NULL);
BEGIN
  ASSERT jsonb_array_length(d) = 3, format('0 fallback lists all 3 links: %s', d);
  ASSERT d::text LIKE '%FIXTUREVINPRIVATE%' AND d::text LIKE '%777%', '0 fallback shows the private car and the link price';
  ASSERT a::text LIKE '%FIXTUREVINPRIVATE%' AND a::text LIKE '%Privmake%', '0 event path shows the private car';
END $$;

\ir ../migrations/20261126080000_market_source_landing_readable_cars.sql

-- 1. The fallback lists only the readable car, priced from the car.
DO $$
DECLARE d jsonb := pg_temp.recent('fixturedealer');
BEGIN
  ASSERT jsonb_array_length(d) = 1, format('1 one readable link: %s', d);
  ASSERT d -> 0 ->> 'vehicle_id' = '11111111-1111-4111-8111-111111111111', '1 the public car';
  ASSERT (d -> 0 ->> 'price')::numeric = 100, format('1 price from the car, not the link: %s', d -> 0 ->> 'price');
  ASSERT d::text NOT LIKE '%FIXTUREVINPRIVATE%' AND d::text NOT LIKE '%FIXTUREVINDELETED%'
     AND d::text NOT LIKE '%555%' AND d::text NOT LIKE '%777%' AND d::text NOT LIKE '%888%', '1 nothing of the others';
END $$;

-- 2. Both event paths keep every event; a private car's attributes are gone, the event's own VIN stays.
DO $$
DECLARE src text; r jsonb; e1 jsonb; e2 jsonb;
BEGIN
  FOREACH src IN ARRAY ARRAY[NULL, 'fixtureauction'] LOOP
    r := pg_temp.recent(src);
    ASSERT jsonb_array_length(r) = 2, format('2 [%s] both events listed: %s', src, r);
    SELECT x INTO e1 FROM jsonb_array_elements(r) x WHERE x ->> 'id' = 'e1000000-0000-4000-8000-0000000000e1';
    SELECT x INTO e2 FROM jsonb_array_elements(r) x WHERE x ->> 'id' = 'e2000000-0000-4000-8000-0000000000e2';
    ASSERT e1 ->> 'make' = 'Pubmake' AND e1 ->> 'vin' = 'FIXTUREVINPUBLIC1', format('2 [%s] public car attributes kept: %s', src, e1);
    ASSERT e2 ->> 'make' IS NULL AND e2 ->> 'year' IS NULL AND e2 ->> 'model' IS NULL, format('2 [%s] private car attributes gone: %s', src, e2);
    ASSERT e2 ->> 'vin' = 'FIXTUREVINEVENT02' AND (e2 ->> 'price')::numeric = 2000, format('2 [%s] event testimony kept: %s', src, e2);
    ASSERT r::text NOT LIKE '%FIXTUREVINPRIVATE%' AND r::text NOT LIKE '%Privmake%', format('2 [%s] no private car value', src);
  END LOOP;
END $$;

-- 3. A re-run is a no-op; ACL and SECURITY DEFINER unchanged.
\ir ../migrations/20261126080000_market_source_landing_readable_cars.sql
DO $$
DECLARE f oid := 'public.market_source_landing_read(text,timestamp with time zone)'::regprocedure; src text;
BEGIN
  SELECT prosrc INTO src FROM pg_proc WHERE oid = f;
  ASSERT (length(src) - length(replace(src, 'market_source_landing_readable_cars_v1', ''))) / length('market_source_landing_readable_cars_v1') = 1,
    '3 one marker after a re-run';
  ASSERT has_function_privilege('anon', f, 'EXECUTE') AND has_function_privilege('authenticated', f, 'EXECUTE'), '3 ACL kept';
  ASSERT (SELECT prosecdef FROM pg_proc WHERE oid = f), '3 still SECURITY DEFINER';
END $$;

-- 4. The hash guard refuses a body that drifted from the 2026-11-25 read.
\ir ../migrations/20261021004000_market_source_window_starts_at_first_bar.sql
DO $$
DECLARE def text := pg_get_functiondef('public.market_source_landing_read(text,timestamp with time zone)'::regprocedure);
BEGIN
  EXECUTE replace(def, 'LIMIT 30000', 'LIMIT 30001');
END $$;
\set ON_ERROR_STOP off
\ir ../migrations/20261126080000_market_source_landing_readable_cars.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  ASSERT position('market_source_landing_readable_cars_v1' IN (SELECT prosrc FROM pg_proc
           WHERE oid = 'public.market_source_landing_read(text,timestamp with time zone)'::regprocedure)) = 0,
    '4 drifted body refused, not edited';
END $$;
-- 5. The copy is registered once, with the live hash; a changed vehicles read policy refuses the registration.
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.private_row_policy_copies
           WHERE reader = 'market_source_landing_read(text,timestamp with time zone)' AND relation = 'vehicles'
             AND recorded_hash = '7773d11e280e80abad0422000a1ff9cc' AND active AND owner_lane = 'ta-provenance') = 1,
    '5 copy registered';
  ASSERT to_regprocedure((SELECT reader FROM public.private_row_policy_copies
                           WHERE reader LIKE 'market_source_landing_read(%')) IS NOT NULL, '5 the reader name resolves';
END $$;
DELETE FROM public.private_row_policy_copies WHERE reader LIKE 'market_source_landing_read(%';
\ir ../migrations/20261021004000_market_source_window_starts_at_first_bar.sql
ALTER POLICY vehicles_public_select ON public.vehicles USING (true);
\set ON_ERROR_STOP off
\ir ../migrations/20261126080000_market_source_landing_readable_cars.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.private_row_policy_copies WHERE reader LIKE 'market_source_landing_read(%'),
    '5 registration refused on changed policies';
  ASSERT position('market_source_landing_readable_cars_v1' IN (SELECT prosrc FROM pg_proc
           WHERE oid = 'public.market_source_landing_read(text,timestamp with time zone)'::regprocedure)) = 0,
    '5 the whole migration rolled back';
END $$;
SELECT 'PASS: market_source_landing_read lists only readable cars and reads car attributes only from them' AS result;
