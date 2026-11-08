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
CREATE TABLE public.external_identities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), platform text NOT NULL, handle text NOT NULL, profile_url text,
  display_name text, claimed_by_user_id uuid, claimed_at timestamptz, claim_confidence integer DEFAULT 0, first_seen_at timestamptz DEFAULT now(),
  last_seen_at timestamptz DEFAULT now(), metadata jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), user_id uuid,
  CONSTRAINT external_identities_platform_handle_key UNIQUE (platform, handle));
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_observations ENABLE ROW LEVEL SECURITY;

INSERT INTO public.observation_sources (id, slug, display_name, base_trust_score)
VALUES ('ad7104a3-48aa-486e-afff-f9f8af614883', 'bonhams', 'Bonhams', 0.90);

\ir ../migrations/20261108170000_asset_lots.sql
\ir ../migrations/20261108200000_asset_lot_walk.sql
\ir ../migrations/20261108230000_asset_creation_claims.sql
\ir ../migrations/20261108233000_asset_creation_fold_layouts.sql
\ir ../migrations/20261108234500_asset_creators_current_lot.sql
\ir ../migrations/20261108235500_asset_creators_materialized.sql
\ir ../migrations/20261109000000_asset_profile_read.sql

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

-- 6b. The walk takes the slice department furthest behind the house; names fall back to landed rows; health counts land.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
DO $$ DECLARE nxt text; h jsonb; aut record; BEGIN
  nxt := public.asset_lot_next_department('bonhams', ARRAY['PIC-PRT','PHO','MOT-AUT']);
  IF nxt <> 'PHO' THEN RAISE EXCEPTION 'PHO (0 of 9600) must come before PIC-PRT (1 of 86450): got %', nxt; END IF;
  nxt := public.asset_lot_next_department('bonhams', ARRAY['MOT-AUT']);
  IF nxt IS NOT NULL THEN RAISE EXCEPTION 'a department without a census row cannot be chosen: got %', nxt; END IF;
  SELECT * INTO aut FROM public.asset_lot_coverage('bonhams') WHERE department_code = 'MOT-AUT';
  IF aut.department_name <> 'Automobilia' THEN RAISE EXCEPTION 'department name must fall back to the landed rows: %', aut; END IF;
  h := public.asset_lot_walk_health('bonhams');
  IF (h->>'observations')::int <> 3 OR (h->>'assets')::int <> 2 OR (h->>'landed_last_hour')::int <> 3 THEN RAISE EXCEPTION 'health wrong: %', h; END IF;
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  IF public.asset_lot_next_department('bonhams', ARRAY['PHO']) IS NOT NULL THEN RAISE EXCEPTION 'anon must not steer the walk'; END IF;
  IF (public.asset_lot_walk_health('bonhams')->>'assets')::int <> 2 THEN RAISE EXCEPTION 'anon may read health counts'; END IF;
END $$;

-- 6c. An unsold lot keeps its high bid, and a later high bid is a new statement that supersedes.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
DO $$ DECLARE r jsonb; BEGIN
  r := public.record_asset_lots('bonhams', $j$[{"identity_key":"bonhams:7000003","asset_type":"memorabilia","title":"A race poster","source_identifier":"7000003",
    "observed_at":"2026-10-01T12:00:00Z","observed_at_basis":"hammer_time","department_code":"COL-ENT","department_name":"Popular Culture","result":"not_sold","high_bid":300,"currency":"GBP"}]$j$::jsonb);
  IF (r->>'observations_new')::int <> 1 THEN RAISE EXCEPTION 'high-bid lot must land: %', r; END IF;
  IF (SELECT structured_data->>'high_bid' FROM public.asset_observations WHERE source_identifier = '7000003' AND superseded_by IS NULL) <> '300' THEN
    RAISE EXCEPTION 'high_bid must be kept'; END IF;
  r := public.record_asset_lots('bonhams', $j$[{"identity_key":"bonhams:7000003","asset_type":"memorabilia","title":"A race poster","source_identifier":"7000003",
    "observed_at":"2026-10-01T12:00:00Z","observed_at_basis":"hammer_time","department_code":"COL-ENT","department_name":"Popular Culture","result":"not_sold","high_bid":320,"currency":"GBP"}]$j$::jsonb);
  IF (r->>'observations_new')::int <> 1 OR (r->>'observations_superseded')::int <> 1 THEN RAISE EXCEPTION 'a changed high bid supersedes: %', r; END IF;
END $$;

-- 6d. The creation fold: the party from the house's first line, the attribution word, the executor from "by <name>".
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
DO $$ DECLARE r jsonb; a record; e record; BEGIN
  PERFORM public.record_asset_lots('bonhams', $j$[
    {"identity_key":"bonhams:8000001","asset_type":"artwork","title":"After Marc Chagall (1887-1985) by Charles Sorlier (1921-1990) L'Oiseau bleu","source_identifier":"8000001",
     "observed_at":"2025-06-01T12:00:00Z","observed_at_basis":"hammer_time","department_code":"PIC-PRT","department_name":"Prints & Multiples","result":"sold","price_basis":"hammer",
     "hammer_price":2000,"currency":"GBP","lines":["After Marc Chagall","(1887-1985) by Charles Sorlier (1921-1990)","L'Oiseau bleu (The Blue Bird)"]},
    {"identity_key":"bonhams:8000002","asset_type":"artwork","title":"Andy Warhol (American, 1928-1987) Flowers","source_identifier":"8000002",
     "observed_at":"2025-06-01T12:05:00Z","observed_at_basis":"hammer_time","department_code":"PIC-PRT","department_name":"Prints & Multiples","result":"sold","price_basis":"hammer",
     "hammer_price":9000,"currency":"GBP","lines":["Andy Warhol","(American, 1928-1987)","Flowers"]},
    {"identity_key":"bonhams:8000003","asset_type":"artwork","title":"Andy Warhol (American, 1928-1987) Mao","source_identifier":"8000003",
     "observed_at":"2025-07-01T12:05:00Z","observed_at_basis":"hammer_time","department_code":"PIC-PRT","department_name":"Prints & Multiples","result":"sold","price_basis":"hammer",
     "hammer_price":11000,"currency":"USD","lines":["Andy Warhol","(American, 1928-1987)","Mao"]},
    {"identity_key":"bonhams:8000004","asset_type":"artwork","title":"A framed map","source_identifier":"8000004",
     "observed_at":"2025-07-01T12:06:00Z","observed_at_basis":"hammer_time","department_code":"PIC-GEN","department_name":"Fine Art","result":"not_sold","lines":["A framed map"]}
  ]$j$::jsonb);
  r := public.fold_asset_creation_claims('bonhams', 100);
  IF (r->>'lots_read')::int <> 5 OR (r->>'claims_new')::int <> 4 OR (r->>'no_party_printed')::int <> 1 OR (r->>'parties_new')::int <> 3 THEN
    RAISE EXCEPTION 'fold receipt wrong (5 artwork lots: Fontana, Chagall/Sorlier, Warhol x2, a map): %', r; END IF;
  r := public.fold_asset_creation_claims('bonhams', 100);
  IF (r->>'lots_read')::int <> 0 THEN RAISE EXCEPTION 'fold must be idempotent and the map (no party printed) must not be re-read: %', r; END IF;
  IF (SELECT structured_data->>'attribution' FROM public.asset_observations WHERE kind = 'creation_claim' AND source_identifier = '8000004') <> 'none_printed' THEN
    RAISE EXCEPTION 'the house''s silence is recorded once'; END IF;
  -- Layout B: the Copenhagen sales print "Name: description" and repeat the description on the second line.
  PERFORM public.record_asset_lots('bonhams', $j$[
    {"identity_key":"bonhams:8000005","asset_type":"artwork","title":"Anna Ancher: A mother in a garden in Skagen. Signed A. Ancher. Oil on panel. 46 x 37 cm.","source_identifier":"8000005",
     "observed_at":"2025-09-01T12:00:00Z","observed_at_basis":"hammer_time","department_code":"PIC-GEN","department_name":"Fine Art","result":"sold","price_basis":"hammer","hammer_price":40000,"currency":"DKK",
     "lines":["Anna Ancher: A mother in a garden in Skagen. Signed A. Ancher. Oil on panel. 46 x 37 cm.","A mother in a garden in Skagen. Signed A. Ancher. Oil on panel. 46 x 37 cm."]},
    {"identity_key":"bonhams:8000006","asset_type":"artwork","title":"Various Artists; Los Angeles Olympics Portfolio; (15)","source_identifier":"8000006",
     "observed_at":"2025-09-01T12:01:00Z","observed_at_basis":"hammer_time","department_code":"PIC-PRT","department_name":"Prints & Multiples","result":"sold","price_basis":"hammer","hammer_price":5000,"currency":"USD",
     "lines":["Various Artists","(American, 20th century)","Los Angeles Olympics Portfolio"]}
  ]$j$::jsonb);
  r := public.fold_asset_creation_claims('bonhams', 100);
  IF (r->>'lots_read')::int <> 2 OR (r->>'claims_new')::int <> 1 OR (r->>'no_party_printed')::int <> 1 OR (r->>'parties_new')::int <> 1 THEN
    RAISE EXCEPTION 'layout B and the Various Artists exclusion: %', r; END IF;
  IF (SELECT handle FROM public.external_identities WHERE display_name = 'Anna Ancher') <> 'anna ancher' THEN RAISE EXCEPTION 'layout B party key is the name alone'; END IF;
  IF (SELECT structured_data->>'layout' FROM public.asset_observations WHERE kind = 'creation_claim' AND source_identifier = '8000005') <> 'name_colon_description' THEN
    RAISE EXCEPTION 'layout must be recorded'; END IF;
  SELECT * INTO e FROM public.external_identities WHERE platform = 'art_catalogue' AND handle = 'andy warhol|1928-1987';
  IF e.id IS NULL OR e.display_name <> 'Andy Warhol' THEN RAISE EXCEPTION 'party row missing'; END IF;
  IF (SELECT count(*) FROM public.asset_observations WHERE kind = 'creation_claim' AND (structured_data->>'party_identity_id')::uuid = e.id) <> 2 THEN
    RAISE EXCEPTION 'two Warhol lots must point at one party'; END IF;
  SELECT * INTO a FROM public.asset_creators('bonhams', 10) WHERE name_as_printed = 'Andy Warhol';
  IF a.lots_direct <> 2 OR a.priced_lots <> 2 OR (a.by_currency->'GBP'->>'n')::int <> 1 OR (a.by_currency->'USD'->>'median')::numeric <> 11000 OR a.first_sale_year <> 2025 THEN
    RAISE EXCEPTION 'creators reader wrong for Warhol: %', a; END IF;
  SELECT * INTO a FROM public.asset_creators('bonhams', 10) WHERE name_as_printed = 'Marc Chagall';
  IF a.lots_direct <> 0 OR a.lots_after <> 1 THEN RAISE EXCEPTION 'After Chagall must count as after, not direct: %', a; END IF;
  IF (SELECT (x->'executor'->>'name_as_printed') FROM public.asset_creation_read((SELECT id FROM public.assets WHERE attributes->>'identity_key' = 'bonhams:8000001')) x) <> 'Charles Sorlier' THEN
    RAISE EXCEPTION 'the executor must be read from "by <name>"'; END IF;
  IF (SELECT handle FROM public.external_identities WHERE display_name = 'Charles Sorlier') <> 'charles sorlier|1921-1990' THEN RAISE EXCEPTION 'executor key wrong'; END IF;
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  IF (SELECT count(*) FROM public.asset_creators('bonhams', 10)) < 3 THEN RAISE EXCEPTION 'anon may read creators'; END IF;
  BEGIN
    PERFORM public.fold_asset_creation_claims('bonhams', 1);
    RAISE EXCEPTION 'anon fold must fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- 6e. A hammer published after the fold reaches the artist view: the claim reads the lot's current statement.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
DO $$ DECLARE a record; r jsonb; BEGIN
  PERFORM public.record_asset_lots('bonhams', $j$[{"identity_key":"bonhams:8000007","asset_type":"artwork","title":"Alex Katz (born 1927) Give Me Tomorrow","source_identifier":"8000007",
    "observed_at":"2026-11-08T12:00:00Z","observed_at_basis":"index_read","department_code":"PIC-PRT","department_name":"Prints & Multiples","result":"upcoming",
    "estimate_low":4000,"estimate_high":6000,"currency":"GBP","lines":["Alex Katz","(born 1927)","Give Me Tomorrow"]}]$j$::jsonb);
  PERFORM public.fold_asset_creation_claims('bonhams', 100);
  SELECT * INTO a FROM public.asset_creators('bonhams', 50) WHERE name_as_printed = 'Alex Katz';
  IF a.lots_direct <> 1 OR a.priced_lots <> 0 THEN RAISE EXCEPTION 'upcoming lot: one direct, none priced: %', a; END IF;
  r := public.record_asset_lots('bonhams', $j$[{"identity_key":"bonhams:8000007","asset_type":"artwork","title":"Alex Katz (born 1927) Give Me Tomorrow","source_identifier":"8000007",
    "observed_at":"2026-12-17T12:01:00Z","observed_at_basis":"hammer_time","department_code":"PIC-PRT","department_name":"Prints & Multiples","result":"sold","price_basis":"hammer",
    "hammer_price":5200,"hammer_premium":6656,"estimate_low":4000,"estimate_high":6000,"currency":"GBP","lines":["Alex Katz","(born 1927)","Give Me Tomorrow"]}]$j$::jsonb);
  IF (r->>'observations_superseded')::int <> 1 THEN RAISE EXCEPTION 'the hammer must supersede the upcoming row: %', r; END IF;
  SELECT * INTO a FROM public.asset_creators('bonhams', 50) WHERE name_as_printed = 'Alex Katz';
  IF a.priced_lots <> 1 OR (a.by_currency->'GBP'->>'median')::numeric <> 5200 THEN RAISE EXCEPTION 'the published hammer must reach the artist view: %', a; END IF;
END $$;

-- 6f. The profile read: one typed document for the page, public, with the house's footnotes as headed sections.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
DO $$ DECLARE p jsonb; sec jsonb; BEGIN
  PERFORM public.record_asset_lots('bonhams', $j$[{"identity_key":"bonhams:8000008","asset_type":"artwork","title":"BRIDGET RILEY (B. 1931) Ka 4","source_identifier":"8000008",
    "source_url":"https://www.bonhams.com/auction/32184/lot/7/x","observed_at":"2026-10-15T22:59:59Z","observed_at_basis":"hammer_time","department_code":"PIC-CON","department_name":"Post-War and Contemporary Art",
    "lot_number":"7","sale_key":"bonhams-32184","result":"sold","price_basis":"hammer","hammer_price":720000,"hammer_premium":915500,"estimate_low":550000,"estimate_high":750000,"currency":"GBP",
    "lines":["BRIDGET RILEY","(B. 1931)","Ka 4"],"catalog_text":"oil on linen\n76.2 x 67.3cm","image_url":"https://images1.bonhams.com/image?src=x.jpg",
    "footnotes":"Provenance\nJuda Rowan Gallery, London\nPrivate Collection, London\n\nLiterature\nRobert Kudielka (ed.), Bridget Riley, The Complete Paintings, no. BR207\n\nWith the Ka paintings of 1980, Riley gave the stripe a new chromatic intensity."}]$j$::jsonb);
  PERFORM public.fold_asset_creation_claims('bonhams', 100);
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  p := public.asset_profile_read((SELECT id FROM public.assets WHERE attributes->>'identity_key' = 'bonhams:8000008'));
  IF p IS NULL THEN RAISE EXCEPTION 'anon must read a public artwork profile'; END IF;
  IF p->'asset'->>'asset_type' <> 'artwork' OR p->'asset'->>'house_category' <> 'Post-War and Contemporary Art' THEN RAISE EXCEPTION 'asset block wrong: %', p->'asset'; END IF;
  IF p->>'image_url' <> 'https://images1.bonhams.com/image?src=x.jpg' THEN RAISE EXCEPTION 'image url wrong'; END IF;
  IF jsonb_array_length(p->'lots') <> 1 OR (p->'lots'->0->>'hammer_price')::numeric <> 720000 OR p->'lots'->0->>'result' <> 'sold' OR p->'lots'->0->'source'->>'slug' <> 'bonhams' THEN
    RAISE EXCEPTION 'lot block wrong: %', p->'lots'; END IF;
  sec := p->'lots'->0->'printed_sections';
  IF jsonb_array_length(sec) <> 3 OR sec->0->>'heading' <> 'Provenance' OR jsonb_array_length(sec->0->'lines') <> 2 OR sec->0->'lines'->>0 <> 'Juda Rowan Gallery, London'
     OR sec->1->>'heading' <> 'Literature' OR (sec->2 ? 'heading') THEN RAISE EXCEPTION 'printed sections wrong: %', sec; END IF;
  IF jsonb_array_length(p->'creation') <> 1 OR p->'creation'->0->>'attribution' <> 'direct' OR p->'creation'->0->'party'->>'display_name' <> 'BRIDGET RILEY'
     OR (p->'creation'->0->'party'->>'claimed')::boolean OR (p->'creation'->0->'party'->>'lots_direct')::int <> 1 OR (p->'creation'->0->'party'->>'priced_lots')::int <> 1 THEN
    RAISE EXCEPTION 'creation block wrong: %', p->'creation'; END IF;
  IF (p->'coverage'->>'presentations')::int <> 1 OR (p->'coverage'->>'statements')::int <> 1 OR (p->'coverage'->>'claims')::int <> 1 THEN RAISE EXCEPTION 'coverage wrong: %', p->'coverage'; END IF;
  -- The Katz lot above has two statements (upcoming, then the hammer): history keeps both, lots shows the current one.
  p := public.asset_profile_read((SELECT id FROM public.assets WHERE attributes->>'identity_key' = 'bonhams:8000007'));
  IF jsonb_array_length(p->'history') <> 2 OR (p->'history'->0->>'superseded')::boolean IS NOT TRUE OR jsonb_array_length(p->'lots') <> 1 OR (p->'lots'->0->>'hammer_price')::numeric <> 5200 THEN
    RAISE EXCEPTION 'history must keep the superseded statement: %', p->'history'; END IF;
  IF public.asset_profile_read('00000000-0000-0000-0000-000000000000') IS NOT NULL THEN RAISE EXCEPTION 'unknown id must be null'; END IF;
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
