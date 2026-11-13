-- Disposable PG17 only. Synthetic fixtures; exercises 20261113210000_asset_lots_house_statements.sql on top of the v2 writer.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR to_regclass('public.assets') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable database required';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Live shapes (subset of columns), as of 2026-11-08.
CREATE TABLE public.observation_sources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE NOT NULL, display_name text,
  base_trust_score numeric);
CREATE TABLE public.assets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), asset_type text NOT NULL, title text, description text,
  creator_id uuid, owner_id uuid, organization_id uuid, status text DEFAULT 'active', visibility text DEFAULT 'private', vehicle_id uuid,
  attributes jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  CONSTRAINT assets_asset_type_check CHECK (asset_type = ANY (ARRAY['image','vehicle','garment','publication','issue','article','shoot',
    'equipment','tool','part','material','goods'])));
CREATE TABLE public.asset_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), asset_id uuid REFERENCES public.assets(id) ON DELETE CASCADE,
  source_id uuid, kind text NOT NULL, observed_at timestamptz NOT NULL, content_text text, structured_data jsonb DEFAULT '{}'::jsonb, content_hash text NOT NULL,
  confidence numeric DEFAULT 0.5, source_url text, source_identifier text, extraction_method text, agent_model text, superseded_by uuid,
  supersedes uuid, created_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX asset_observations_photo_sighting_uidx ON public.asset_observations (asset_id, source_identifier, extraction_method)
  WHERE kind = 'photo_sighting';
CREATE TABLE public.source_census(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid REFERENCES public.observation_sources(id),
  universe_total integer, universe_active integer, census_method text NOT NULL, census_confidence numeric, census_url text, census_notes text,
  census_at timestamptz NOT NULL DEFAULT now(), by_year jsonb DEFAULT '{}', by_make jsonb DEFAULT '{}', by_category jsonb DEFAULT '{}',
  raw_response jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.external_identities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), platform text NOT NULL, handle text NOT NULL, profile_url text,
  display_name text, claimed_by_user_id uuid, claimed_at timestamptz, claim_confidence integer DEFAULT 0, first_seen_at timestamptz DEFAULT now(),
  last_seen_at timestamptz DEFAULT now(), metadata jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), user_id uuid,
  CONSTRAINT external_identities_platform_handle_key UNIQUE (platform, handle));
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_observations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.profiles(id uuid PRIMARY KEY, username text, full_name text, is_public boolean DEFAULT true);
INSERT INTO public.profiles (id, username, full_name) VALUES ('0b9f107a-0000-4000-8000-000000000001', 'holder', 'A Working Photographer');
INSERT INTO public.observation_sources (id, slug, display_name, base_trust_score)
VALUES ('ad7104a3-48aa-486e-afff-f9f8af614883', 'bonhams', 'Bonhams', 0.90), ('ad7104a3-48aa-486e-afff-f9f8af614800', 'owner-input', 'Owner input', 0.95);

INSERT INTO public.observation_sources (id, slug, display_name, base_trust_score) VALUES ('ad7104a3-48aa-486e-afff-f9f8af614884', 'christies', 'Christie''s', 0.90);
\ir ../migrations/20261108170000_asset_lots.sql
\ir ../migrations/20261108200000_asset_lot_walk.sql

-- Before: a Bonhams lot lands under the v2 writer.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT public.record_asset_lots('bonhams', $j$[{"identity_key":"bonhams:hs-1","asset_type":"artwork","source_identifier":"hs-1","title":"A print",
  "observed_at":"2026-10-01T00:00:00Z","result":"sold","hammer_price":1000,"hammer_premium":1280,"currency":"GBP","symbols":["AR"]}]$j$::jsonb) IS NOT NULL AS landed;
CREATE TEMP TABLE bh AS SELECT content_hash FROM public.asset_observations WHERE source_identifier = 'hs-1';

\ir ../migrations/20261113210000_asset_lots_house_statements.sql

DO $$ DECLARE r jsonb; o record; sd jsonb; ps jsonb; sch jsonb; BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  -- 1. A lot without the new statements hashes exactly as before: a re-read lands nothing.
  r := public.record_asset_lots('bonhams', $j$[{"identity_key":"bonhams:hs-1","asset_type":"artwork","source_identifier":"hs-1","title":"A print",
    "observed_at":"2026-10-01T00:00:00Z","result":"sold","hammer_price":1000,"hammer_premium":1280,"currency":"GBP","symbols":["AR"]}]$j$::jsonb);
  IF (r->>'observations_same')::int <> 1 OR (r->>'observations_new')::int <> 0 THEN RAISE EXCEPTION '1: Bonhams re-read must be a no-op: %', r; END IF;
  IF (SELECT content_hash FROM public.asset_observations WHERE source_identifier = 'hs-1') <> (SELECT content_hash FROM bh) THEN RAISE EXCEPTION '1: hash unchanged'; END IF;

  -- 2. A Christie's lot keeps its price semantics and premium schedule as stated; nothing is derived.
  ps := '{"label_as_printed":"Price realised","reading":"hammer_plus_buyers_premium","source_url":"https://press.christies.com/62b-projected-global-sales-in-2025/","source_date":"2025-12-17","source_quote":"Sales totals are hammer price plus buyer''s premium."}';
  sch := '{"schedule":"all_collecting_categories_except_wine_and_gooding","effective_from":"2026-09-01","site":"London","rates":["28.0%","22.0%","15.0%"],"thresholds":["Up to £1,500,000","£1,500,001 to £6,000,000","£6,000,001 and Above"],"basis":"on_hammer_price_in_bands_excluding_local_taxes","source_url":"https://www.christies.com/en/help/buying-guide-important-information/financial-information"}';
  r := public.record_asset_lots('christies', jsonb_build_array(jsonb_build_object('identity_key','christies:6609196','asset_type','artwork','source_identifier','6609196',
    'title','A painting','observed_at','2026-10-14T00:00:00Z','result','unresolved:PRICE_REALISED','price_basis','price_realised','hammer_premium',3262000,
    'currency','GBP','extraction_method','christies_results_json_v1','price_semantics',ps,'premium_schedule',sch)));
  IF (r->>'observations_new')::int <> 1 THEN RAISE EXCEPTION '2: landed: %', r; END IF;
  SELECT * INTO o FROM public.asset_observations WHERE source_identifier = '6609196' AND superseded_by IS NULL;
  sd := o.structured_data;
  IF sd->'price_semantics'->>'reading' <> 'hammer_plus_buyers_premium' OR sd->'premium_schedule'->>'site' <> 'London'
     OR sd->'premium_schedule'->'rates'->>0 <> '28.0%' OR sd ? 'hammer_price' OR (sd->>'hammer_premium')::numeric <> 3262000 THEN
    RAISE EXCEPTION '2: statements kept as stated, no hammer derived: %', sd; END IF;

  -- 3. The same lot re-read is a no-op; the lot page's printed symbols then land as a new version superseding it.
  r := public.record_asset_lots('christies', jsonb_build_array(jsonb_build_object('identity_key','christies:6609196','asset_type','artwork','source_identifier','6609196',
    'title','A painting','observed_at','2026-10-14T00:00:00Z','result','unresolved:PRICE_REALISED','price_basis','price_realised','hammer_premium',3262000,
    'currency','GBP','extraction_method','christies_results_json_v1','price_semantics',ps,'premium_schedule',sch)));
  IF (r->>'observations_same')::int <> 1 THEN RAISE EXCEPTION '3: same statement re-read: %', r; END IF;
  r := public.record_asset_lots('christies', jsonb_build_array(jsonb_build_object('identity_key','christies:6609196','asset_type','artwork','source_identifier','6609196',
    'title','A painting','observed_at','2026-10-14T00:00:00Z','result','unresolved:PRICE_REALISED','price_basis','price_realised','hammer_premium',3262000,
    'currency','GBP','extraction_method','christies_results_json_v1','price_semantics',ps,'premium_schedule',sch,
    'symbols', '["S02 ○♦ Third party guarantee","S06 λ Artist''s Resale Right"]'::jsonb,
    'symbols_printed', '[{"code":"S02","version":"1","symbol":"○♦","name":"Third party guarantee","description":"Christie''s has provided a minimum price guarantee ..."},{"code":"S06","version":"1","symbol":"λ","name":"Artist''s Resale Right","description":null}]'::jsonb,
    'symbols_basis','lot_page_symbols_list')));
  IF (r->>'observations_new')::int <> 1 OR (r->>'observations_superseded')::int <> 1 THEN RAISE EXCEPTION '3: symbols are a new version: %', r; END IF;
  SELECT structured_data INTO sd FROM public.asset_observations WHERE source_identifier = '6609196' AND superseded_by IS NULL;
  IF sd->'symbols_printed'->0->>'code' <> 'S02' OR sd->'symbols_printed'->0->>'name' <> 'Third party guarantee' OR sd->>'symbols_basis' <> 'lot_page_symbols_list'
     OR sd->'symbols'->>0 <> 'S02 ○♦ Third party guarantee' THEN RAISE EXCEPTION '3: symbols as printed: %', sd; END IF;
  IF (SELECT count(*) FROM public.asset_observations WHERE source_identifier = '6609196') <> 2 THEN RAISE EXCEPTION '3: history kept'; END IF;
END $$;
SELECT 'test_asset_lots_house_statements: statements kept as printed, old hashes unchanged' AS result;
