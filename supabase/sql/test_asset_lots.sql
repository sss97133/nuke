-- Disposable PG17 only. Synthetic fixtures; exercises the actual migration 20261108170000_asset_lots.sql.
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
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_observations ENABLE ROW LEVEL SECURITY;

INSERT INTO public.observation_sources (id, slug, display_name, base_trust_score)
VALUES ('ad7104a3-48aa-486e-afff-f9f8af614883', 'bonhams', 'Bonhams', 0.90);

\ir ../migrations/20261108170000_asset_lots.sql

-- 1. Anon cannot write.
DO $$ BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  BEGIN
    PERFORM public.record_asset_lots('bonhams', '[]'::jsonb);
    RAISE EXCEPTION 'anon call must fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- 2. Two lots land: a sold print and an upcoming automobilia lot. A bad type and a foreign identity key are refused.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
CREATE TEMP TABLE r1 AS SELECT public.record_asset_lots('bonhams', $j$[
  {"identity_key":"bonhams:6211694","asset_type":"artwork","title":"Lucio Fontana (Italian, 1899-1968) Concetto Spaziale","source_identifier":"6211694",
   "source_url":"https://www.bonhams.com/auction/32241/lot/0/x","observed_at":"2025-03-20T14:01:00Z","observed_at_basis":"hammer_time",
   "department_code":"PIC-PRT","department_name":"Prints & Multiples","lot_number":"12","sale_key":"bonhams-32241","sale_ends_at":"2025-03-20T14:00:00Z",
   "result":"sold","price_basis":"hammer","hammer_price":4200,"hammer_premium":5376,"estimate_low":3000,"estimate_high":5000,"currency":"GBP",
   "lines":["Lucio Fontana","(Italian, 1899-1968)","Concetto Spaziale"],"catalog_text":"Screenprint in purple, 1965","image_url":"https://images1.bonhams.com/x.jpg","ts_page":3,"ts_pass":0},
  {"identity_key":"bonhams:7000001","asset_type":"automobilia","title":"A Ferrari dealership sign","source_identifier":"7000001",
   "observed_at":"2026-11-08T12:00:00Z","observed_at_basis":"index_read","department_code":"MOT-AUT","department_name":"Automobilia",
   "result":"upcoming","estimate_low":800,"estimate_high":1200,"currency":"GBP","ts_page":1,"ts_pass":0},
  {"identity_key":"bonhams:7000002","asset_type":"vehicle","title":"a car","source_identifier":"7000002","observed_at":"2026-11-08T12:00:00Z"},
  {"identity_key":"mecum:1","asset_type":"artwork","title":"wrong source","source_identifier":"1","observed_at":"2026-11-08T12:00:00Z"}
]$j$::jsonb) AS r;
DO $$ DECLARE r jsonb; BEGIN
  SELECT r1.r INTO r FROM r1;
  IF (r->>'in')::int <> 4 OR (r->>'assets_new')::int <> 2 OR (r->>'observations_new')::int <> 2 OR (r->>'refused')::int <> 2 THEN
    RAISE EXCEPTION 'first landing receipt wrong: %', r;
  END IF;
  IF (SELECT count(*) FROM public.assets WHERE asset_type IN ('artwork','automobilia')) <> 2 THEN RAISE EXCEPTION 'two assets expected'; END IF;
  IF (SELECT visibility FROM public.assets WHERE attributes->>'identity_key' = 'bonhams:6211694') <> 'public' THEN RAISE EXCEPTION 'lot assets are public'; END IF;
  IF (SELECT attributes->>'house_category' FROM public.assets WHERE attributes->>'identity_key' = 'bonhams:6211694') <> 'Prints & Multiples' THEN
    RAISE EXCEPTION 'house category is a claim in attributes'; END IF;
  IF (SELECT observed_at FROM public.asset_observations WHERE source_identifier = '6211694') <> '2025-03-20T14:01:00Z'::timestamptz THEN
    RAISE EXCEPTION 'observed_at is the hammer clock'; END IF;
  IF (SELECT confidence FROM public.asset_observations WHERE source_identifier = '6211694') <> 0.90 THEN RAISE EXCEPTION 'confidence is the source trust'; END IF;
END $$;

-- 3. The same lots again: nothing new, nothing refused, no duplicate rows.
DO $$ DECLARE r jsonb; BEGIN
  r := public.record_asset_lots('bonhams', $j$[
    {"identity_key":"bonhams:6211694","asset_type":"artwork","title":"Lucio Fontana (Italian, 1899-1968) Concetto Spaziale","source_identifier":"6211694",
     "observed_at":"2025-03-20T14:01:00Z","observed_at_basis":"hammer_time","department_code":"PIC-PRT","department_name":"Prints & Multiples",
     "sale_ends_at":"2025-03-20T14:00:00Z","result":"sold","price_basis":"hammer","hammer_price":4200,"hammer_premium":5376,"estimate_low":3000,"estimate_high":5000,"currency":"GBP","ts_page":3}
  ]$j$::jsonb);
  IF (r->>'assets_new')::int <> 0 OR (r->>'assets_existing')::int <> 1 OR (r->>'observations_new')::int <> 0 OR (r->>'observations_same')::int <> 1 THEN
    RAISE EXCEPTION 'idempotent landing receipt wrong: %', r;
  END IF;
  IF (SELECT count(*) FROM public.asset_observations WHERE kind = 'auction_lot') <> 2 THEN RAISE EXCEPTION 'no duplicate observations'; END IF;
END $$;

-- 4. The automobilia lot's result is published: a new row supersedes the upcoming one; the upcoming row stays.
DO $$ DECLARE r jsonb; up record; cur record; BEGIN
  r := public.record_asset_lots('bonhams', $j$[
    {"identity_key":"bonhams:7000001","asset_type":"automobilia","title":"A Ferrari dealership sign","source_identifier":"7000001",
     "observed_at":"2026-11-20T15:00:00Z","observed_at_basis":"hammer_time","department_code":"MOT-AUT","department_name":"Automobilia",
     "result":"sold","price_basis":"hammer","hammer_price":950,"hammer_premium":1216,"estimate_low":800,"estimate_high":1200,"currency":"GBP","ts_page":2,"ts_pass":1}
  ]$j$::jsonb);
  IF (r->>'observations_new')::int <> 1 OR (r->>'observations_superseded')::int <> 1 OR (r->>'assets_existing')::int <> 1 THEN
    RAISE EXCEPTION 'supersession receipt wrong: %', r;
  END IF;
  SELECT * INTO up FROM public.asset_observations WHERE source_identifier = '7000001' AND structured_data->>'result' = 'upcoming';
  SELECT * INTO cur FROM public.asset_observations WHERE source_identifier = '7000001' AND structured_data->>'result' = 'sold';
  IF up.superseded_by IS DISTINCT FROM cur.id OR cur.supersedes IS DISTINCT FROM up.id THEN RAISE EXCEPTION 'supersession chain not linked'; END IF;
  IF (SELECT count(*) FROM public.assets WHERE attributes->>'identity_key' = 'bonhams:7000001') <> 1 THEN RAISE EXCEPTION 'one asset per presentation'; END IF;
END $$;

-- 5. The walk cursor is the furthest page of the newest pass per department; anon gets nothing.
DO $$ DECLARE c jsonb; BEGIN
  c := public.asset_lot_walk_cursor('bonhams', 'MOT-AUT');
  IF (c->>'last_page')::int <> 2 OR (c->>'pass')::int <> 1 THEN RAISE EXCEPTION 'cursor wrong: %', c; END IF;
  c := public.asset_lot_walk_cursor('bonhams', 'PIC-PRT');
  IF (c->>'last_page')::int <> 3 THEN RAISE EXCEPTION 'cursor wrong: %', c; END IF;
  c := public.asset_lot_walk_cursor('bonhams', 'PHO');
  IF (c->>'last_page')::int <> 0 THEN RAISE EXCEPTION 'empty department cursor must be 0: %', c; END IF;
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  IF public.asset_lot_walk_cursor('bonhams', 'MOT-AUT') IS NOT NULL THEN RAISE EXCEPTION 'anon must not read the cursor'; END IF;
END $$;

-- 6. Coverage against the house's own department facet; a landed department without a census row keeps null house counts.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
INSERT INTO public.source_census (source_id, universe_total, census_method, census_confidence, census_at, by_category, raw_response)
VALUES ('ad7104a3-48aa-486e-afff-f9f8af614883', 3482440, 'house_department_facet', 0.9, '2026-11-08T13:00:00Z',
  '{"PIC-PRT": 86450, "PHO": 9600}'::jsonb, '{"priced": {"PIC-PRT": 61399, "PHO": 6124}, "names": {"PIC-PRT": "Prints & Multiples", "PHO": "Photographs"}}'::jsonb);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
DO $$ DECLARE prt record; pho record; aut record; BEGIN
  SELECT * INTO prt FROM public.asset_lot_coverage('bonhams') WHERE department_code = 'PIC-PRT';
  SELECT * INTO pho FROM public.asset_lot_coverage('bonhams') WHERE department_code = 'PHO';
  SELECT * INTO aut FROM public.asset_lot_coverage('bonhams') WHERE department_code = 'MOT-AUT';
  IF prt.house_lots <> 86450 OR prt.house_priced_lots <> 61399 OR prt.landed_lots <> 1 OR prt.landed_priced_lots <> 1
     OR prt.first_sale_year <> 2025 OR prt.department_name <> 'Prints & Multiples' THEN RAISE EXCEPTION 'PIC-PRT coverage wrong: %', prt; END IF;
  IF pho.house_lots <> 9600 OR pho.landed_lots <> 0 THEN RAISE EXCEPTION 'PHO coverage wrong: %', pho; END IF;
  IF aut.house_lots IS NOT NULL OR aut.landed_lots <> 1 OR aut.landed_priced_lots <> 1 THEN RAISE EXCEPTION 'MOT-AUT coverage wrong: %', aut; END IF;
END $$;

-- 7. The type list admits the three new types and still refuses an unknown one.
DO $$ BEGIN
  BEGIN
    INSERT INTO public.assets (asset_type, title) VALUES ('sculpture', 'x');
    RAISE EXCEPTION 'unknown type must fail';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO public.assets (asset_type, title) VALUES ('memorabilia', 'a race poster');
END $$;

SELECT 'test_asset_lots: ok' AS result;
