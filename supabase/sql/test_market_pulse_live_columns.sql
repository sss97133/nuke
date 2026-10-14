-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_pulse_columns -f this-file.sql
-- Proves market_pulse_live v2 names its 17 row slots in the order the rows carry them, so a slot
-- added or moved without bumping 'v' and 'columns' fails this file before it can shift a client.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;

-- The tables the read touches, with the columns it names.
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
   'auction_live', 'bringatrailer'),
  -- Not live: must not appear.
  ('aaaaaaaa-0000-0000-0000-000000000003', 2001, 'Mini', 'Cooper', NULL,
   12000, now() - interval '1 hour', now(), now(), NULL, NULL, NULL, 'closed', 'sold', 'bringatrailer');
INSERT INTO public.hammer_predictions VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 31, 478000, 552000, 700000, 'd', 15, now() - interval '1 hour'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 30, 1, 2, 3, 'a', 1, now());

\ir ../migrations/20261013234500_market_pulse_live_columns.sql

DO $$
DECLARE j jsonb; cols jsonb; rows jsonb; r jsonb;
  expected text[] := ARRAY['id','year','make','model','current_bid','ends_at','updated_at','listed_at',
                           'image_url','no_reserve','listing_url','title',
                           'band_p10','band_p50','band_p90','band_tier','band_comps'];
  i int;
BEGIN
  j := public.market_pulse_live();
  IF (j->>'v')::int <> 2 THEN RAISE EXCEPTION 'v is %, expected 2', j->>'v'; END IF;
  cols := j->'columns';
  IF jsonb_array_length(cols) <> 17 THEN RAISE EXCEPTION 'columns has % names, expected 17', jsonb_array_length(cols); END IF;
  FOR i IN 1..17 LOOP
    IF cols->>(i - 1) <> expected[i] THEN
      RAISE EXCEPTION 'column % is %, expected %', i - 1, cols->>(i - 1), expected[i];
    END IF;
  END LOOP;
  rows := j->'auctions';
  IF jsonb_array_length(rows) <> 2 THEN RAISE EXCEPTION '% live rows, expected 2', jsonb_array_length(rows); END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(rows) LOOP
    IF jsonb_array_length(r) <> 17 THEN RAISE EXCEPTION 'row has % slots, expected 17', jsonb_array_length(r); END IF;
  END LOOP;
  -- The slots carry what their names say, on the lot with a band (first by ends_at).
  r := rows->0;
  IF r->>0 <> 'aaaaaaaa-0000-0000-0000-000000000001' THEN RAISE EXCEPTION 'slot id: %', r->>0; END IF;
  IF (r->>1)::int <> 1973 THEN RAISE EXCEPTION 'slot year: %', r->>1; END IF;
  IF r->>2 <> 'Porsche' THEN RAISE EXCEPTION 'slot make should be the canonical name: %', r->>2; END IF;
  IF (r->>4)::numeric <> 650000 THEN RAISE EXCEPTION 'slot current_bid: %', r->>4; END IF;
  IF (r->>9)::boolean IS NOT TRUE THEN RAISE EXCEPTION 'slot no_reserve: %', r->>9; END IF;
  IF r->>11 <> '1973 Porsche 911 Carrera RS' THEN RAISE EXCEPTION 'slot title: %', r->>11; END IF;
  IF (r->>12)::numeric <> 478000 OR (r->>13)::numeric <> 552000 OR (r->>14)::numeric <> 700000 THEN
    RAISE EXCEPTION 'band slots must be model 31: % % %', r->>12, r->>13, r->>14;
  END IF;
  IF r->>15 <> 'd' OR (r->>16)::int <> 15 THEN RAISE EXCEPTION 'band tier/comps: % %', r->>15, r->>16; END IF;
  -- The lot without a band carries nulls in the band slots, not a shifted row.
  r := rows->1;
  IF r->>0 <> 'aaaaaaaa-0000-0000-0000-000000000002' OR r->>2 <> 'BMW' OR (r->12) <> 'null'::jsonb OR (r->16) <> 'null'::jsonb THEN
    RAISE EXCEPTION 'bandless row is wrong: %', r;
  END IF;
  RAISE NOTICE 'market_pulse_live v2: 17 named slots, rows match their names';
END $$;
