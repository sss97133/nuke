-- Empty disposable PG17 only, run from the repository root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_pulse_heat -f supabase/sql/test_market_pulse_live_heat.sql
-- Proves market_pulse_live v3: the verdict in the read (heat_of) reproduces the clients' shared fixture, the
-- 18th slot carries it, and the track record rides in the payload with its population and source.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;

CREATE TABLE public.canonical_makes (id uuid PRIMARY KEY, canonical_name text);
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, year integer, make text, model text, canonical_make_id uuid,
  high_bid numeric, sale_price numeric, auction_end_date timestamptz,
  updated_at timestamptz, created_at timestamptz, primary_image_url text,
  origin_metadata jsonb, listing_url text, title text,
  is_public boolean NOT NULL DEFAULT true, deleted_at timestamptz,
  listing_kind text, sale_status text, platform_source text);
CREATE TABLE public.hammer_predictions (
  vehicle_id uuid, model_version integer, predicted_low numeric, predicted_hammer numeric,
  predicted_high numeric, price_tier text, comp_count integer, predicted_at timestamptz);
CREATE TABLE public.market_indexes (id uuid PRIMARY KEY, index_code text);
CREATE TABLE public.market_index_values (
  index_id uuid, value_date date, components_snapshot jsonb, calculation_metadata jsonb);
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

INSERT INTO public.canonical_makes VALUES ('11111111-1111-1111-1111-111111111111', 'Porsche');
INSERT INTO public.vehicles (id, year, make, model, canonical_make_id, high_bid, auction_end_date, updated_at,
  created_at, primary_image_url, origin_metadata, listing_url, title, sale_status, platform_source)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 1973, 'PORSCHE', '911 Carrera RS', '11111111-1111-1111-1111-111111111111',
   650000, now() + interval '2 hours', now() - interval '5 minutes', now() - interval '6 days',
   'https://img.example/1.jpg', '{"no_reserve": true}', 'https://bringatrailer.com/listing/one/', '1973 Porsche 911 Carrera RS',
   'auction_live', 'bringatrailer'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 1990, 'BMW', 'M3', NULL,
   42000, now() + interval '1 day', now() - interval '10 minutes', now() - interval '3 days',
   NULL, NULL, 'https://bringatrailer.com/listing/two/', '1990 BMW M3',
   'auction_live', 'bringatrailer');
INSERT INTO public.hammer_predictions VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 31, 478000, 552000, 700000, 'd', 15, now() - interval '1 hour');

\ir ../migrations/20261013234500_market_pulse_live_columns.sql
\ir ../migrations/20261013235500_market_pulse_live_heat.sql

-- The payload.
DO $$
DECLARE j jsonb; r jsonb; heat jsonb; share double precision;
BEGIN
  j := public.market_pulse_live();
  IF (j->>'v')::int <> 3 THEN RAISE EXCEPTION 'v is %, expected 3', j->>'v'; END IF;
  IF jsonb_array_length(j->'columns') <> 18 OR j->'columns'->>17 <> 'heat' THEN RAISE EXCEPTION 'columns: %', j->'columns'; END IF;
  IF j->'thresholds' <> '{"hot": 1.25, "cold": 0.8, "max_hours": 120}'::jsonb THEN RAISE EXCEPTION 'thresholds: %', j->'thresholds'; END IF;
  IF j->'curve' <> public.bid_curve_v31() OR jsonb_array_length(j->'curve'->'d') <> 12 THEN RAISE EXCEPTION 'curve is not the shared constant'; END IF;
  IF jsonb_array_length(j->'backtest') <> 6 OR (j->'backtest'->0->>'horizon_hours')::int <> 120
     OR (j->'backtest'->5->>'hot_above')::float8 <> 0.915 OR (j->'backtest'->0->>'lots_sold')::int <> 10065
     OR j->'backtest'->0->>'source' NOT LIKE 'scripts/market/live-bands.sql%' THEN
    RAISE EXCEPTION 'backtest rows are wrong: %', j->'backtest';
  END IF;
  IF jsonb_array_length(j->'auctions') <> 2 THEN RAISE EXCEPTION '% rows', jsonb_array_length(j->'auctions'); END IF;
  r := j->'auctions'->0;
  IF jsonb_array_length(r) <> 18 OR r->>0 <> 'aaaaaaaa-0000-0000-0000-000000000001' THEN RAISE EXCEPTION 'first row: %', r; END IF;
  -- Two hours left, tier d: share between [3, 0.7738] and [1, 0.8041]; 650,000 against 552,000 x share is hot.
  heat := r->17;
  share := (heat->>'share')::float8;
  IF heat->>'state' <> 'hot' OR share < 0.7738 OR share > 0.8041
     OR abs((heat->>'ratio')::float8 - 650000.0 / (552000.0 * share)) > 1e-9
     OR (heat->>'hours_left')::float8 <= 1.99 OR (heat->>'hours_left')::float8 > 2.0 THEN
    RAISE EXCEPTION 'heat on the banded lot: %', heat;
  END IF;
  -- No band: no verdict, and the row keeps its 18 slots.
  r := j->'auctions'->1;
  IF jsonb_array_length(r) <> 18 OR (r->17) <> 'null'::jsonb THEN RAISE EXCEPTION 'bandless row: %', r; END IF;
  -- The edges of the verdict.
  IF public.heat_of(1000, 1000, 'a', now() + interval '121 hours', now()) IS NOT NULL THEN RAISE EXCEPTION 'past 120 h must be null'; END IF;
  IF public.heat_of(1000, 1000, 'a', now() - interval '1 minute', now()) IS NOT NULL THEN RAISE EXCEPTION 'after close must be null'; END IF;
  IF public.heat_of(0, 1000, 'a', now() + interval '1 hour', now()) IS NOT NULL THEN RAISE EXCEPTION 'no bid must be null'; END IF;
  IF public.heat_of(1000, 1000, 'z', now() + interval '1 hour', now()) IS NOT NULL THEN RAISE EXCEPTION 'unknown tier must be null'; END IF;
  IF public.heat_of(1000, 1000, 'a', now() + interval '200 hours', now() + interval '199 hours') IS NULL THEN RAISE EXCEPTION 'the clock is the fifth argument'; END IF;
  RAISE NOTICE 'market_pulse_live v3: 18 named slots, heat on the banded lot, backtest rows ride along';
END $$;

-- The verdict against the clients' shared fixture: every lot, the same state and ratio within 1e-6.
\set fixture `cat nuke_frontend/src/pages/market/__fixtures__/heat-fixture-20261013T2300Z.json`
CREATE TEMP TABLE fixture_json AS SELECT :'fixture'::jsonb AS f;
DO $$
DECLARE f jsonb; lot jsonb; exp jsonb; h jsonb; i int := 0; checked int := 0; nulls int := 0; t0 timestamptz;
BEGIN
  SELECT fixture_json.f INTO f FROM fixture_json;
  t0 := to_timestamp((f->>'now_ms')::double precision / 1000.0);
  IF f->'thresholds' <> public.heat_thresholds() THEN RAISE EXCEPTION 'fixture thresholds % differ from heat_thresholds()', f->'thresholds'; END IF;
  IF f->'curve' <> public.bid_curve_v31() THEN RAISE EXCEPTION 'fixture curve differs from bid_curve_v31()'; END IF;
  FOR lot IN SELECT * FROM jsonb_array_elements(f->'lots') LOOP
    exp := f->'expected'->i;
    h := public.heat_of((lot->>'currentBid')::float8, (lot->'band'->>'p50')::float8, lot->'band'->>'tier', (lot->>'endsAt')::timestamptz, t0);
    IF exp->>'state' IS NULL THEN
      IF h IS NOT NULL THEN RAISE EXCEPTION 'lot % (#%): expected no verdict, got %', lot->>'id', i, h; END IF;
      nulls := nulls + 1;
    ELSE
      IF h IS NULL THEN RAISE EXCEPTION 'lot % (#%): expected %, got no verdict', lot->>'id', i, exp->>'state'; END IF;
      IF h->>'state' <> exp->>'state' THEN RAISE EXCEPTION 'lot % (#%): state % vs %', lot->>'id', i, h->>'state', exp->>'state'; END IF;
      IF abs((h->>'ratio')::float8 - (exp->>'ratio')::float8) > 1e-6 THEN RAISE EXCEPTION 'lot % (#%): ratio % vs %', lot->>'id', i, h->>'ratio', exp->>'ratio'; END IF;
      checked := checked + 1;
    END IF;
    i := i + 1;
  END LOOP;
  IF checked <> (f->'counts'->>'hot')::int + (f->'counts'->>'cold')::int + (f->'counts'->>'in line')::int
     OR nulls <> (f->'counts'->>'none')::int THEN
    RAISE EXCEPTION 'tally % verdicts / % none differs from the fixture counts %', checked, nulls, f->'counts';
  END IF;
  RAISE NOTICE 'heat_of reproduces the fixture: % verdicts and % no-verdicts of % lots', checked, nulls, i;
END $$;
