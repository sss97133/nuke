-- Isolated PostgreSQL 17 contract for 20261018183000_cab_taxonomy_and_treemap_outcomes.sql.
-- Synthetic rows only; never production.

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $roles$;

CREATE TABLE public.canonical_makes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text UNIQUE NOT NULL,
  display_name text NOT NULL,
  short_name text,
  aliases text[] DEFAULT '{}'
);

CREATE TABLE public.canonical_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  make text NOT NULL,
  canonical_model text NOT NULL,
  year_start integer,
  year_end integer,
  aliases text[] DEFAULT '{}'
);

CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year integer,
  make text,
  model text,
  series text,
  trim text,
  body_style text,
  canonical_make_id uuid REFERENCES public.canonical_makes(id),
  title text,
  listing_title text,
  listing_url text,
  discovery_url text,
  discovery_source text,
  auction_source text,
  canonical_platform text,
  platform_source text,
  primary_image_url text,
  vin text,
  sale_price numeric,
  sold_price numeric,
  winning_bid numeric,
  sale_status text,
  auction_status text,
  auction_outcome text,
  sale_date date,
  auction_end_date timestamptz,
  is_public boolean DEFAULT false,
  status text DEFAULT 'active',
  deleted_at timestamptz
);

CREATE TABLE public.vehicle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES public.vehicles(id),
  final_price numeric,
  current_price numeric,
  sold_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.auction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES public.vehicles(id),
  winning_bid numeric,
  auction_end_date timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.mv_family_market (
  brand text,
  family_key text,
  family text
);

CREATE TABLE public.mv_family_sales (
  vehicle_id uuid,
  brand text,
  family_key text,
  sale_date date,
  usd numeric,
  source text,
  year integer,
  model text
);

-- Seed canonical makes & models
INSERT INTO public.canonical_makes (id, canonical_name, display_name, aliases) VALUES
  ('00000000-0000-4000-a000-000000000001', 'PORSCHE', 'Porsche', ARRAY['porsche']),
  ('00000000-0000-4000-a000-000000000002', 'FORD', 'Ford', ARRAY['ford']),
  ('00000000-0000-4000-a000-000000000003', 'BMW', 'BMW', ARRAY['bmw']);

INSERT INTO public.canonical_models (make, canonical_model, aliases) VALUES
  ('Ford', 'F-250', ARRAY['f250']),
  ('BMW', '2002', ARRAY['2002']);

-- Seed a Cars & Bids sold vehicle with trailing "Watch", missing sale_date, and series/trim/body_style facets
INSERT INTO public.vehicles (
  id, year, make, model, series, trim, body_style,
  title, listing_title, listing_url, discovery_source,
  sale_price, sale_status, auction_status, auction_outcome,
  auction_end_date, is_public
) VALUES (
  '00000000-0000-4000-b000-000000000001',
  2022, 'Porsche', '911', '992', 'GT3', 'Coupe',
  '2022 Porsche 911 GT3 Watch', '2022 Porsche 911 GT3 Watch',
  'https://carsandbids.com/auctions/rNa12345/2022-porsche-911-gt3',
  'carsandbids',
  215000, 'available', 'sold', NULL,
  '2026-06-01T18:00:00Z'::timestamptz, false
);

INSERT INTO public.mv_family_market (brand, family_key, family) VALUES
  ('Porsche', '911', '911');

INSERT INTO public.mv_family_sales (vehicle_id, brand, family_key, sale_date, usd, source, year, model) VALUES
  ('00000000-0000-4000-b000-000000000001', 'Porsche', '911', DATE '2026-06-01', 215000, 'Cars & Bids', 2022, '911');

-- Apply migration under test
\ir ../migrations/20261018183000_cab_taxonomy_and_treemap_outcomes.sql

-- Assertions
DO $$
DECLARE
  v_rec record;
  v_sales jsonb;
  v_model_desc text;
BEGIN
  SELECT title, listing_title, is_public, sale_status, auction_outcome, sale_date, canonical_make_id
    INTO v_rec
  FROM public.vehicles
  WHERE id = '00000000-0000-4000-b000-000000000001';

  IF v_rec.title <> '2022 Porsche 911 GT3' OR v_rec.listing_title <> '2022 Porsche 911 GT3' THEN
    RAISE EXCEPTION 'Expected trailing Watch stripped, got title=% listing_title=%', v_rec.title, v_rec.listing_title;
  END IF;

  IF v_rec.is_public IS DISTINCT FROM true OR v_rec.sale_status <> 'sold' OR v_rec.auction_outcome <> 'sold' THEN
    RAISE EXCEPTION 'Expected C&B sold normalization, got is_public=% sale_status=% auction_outcome=%',
      v_rec.is_public, v_rec.sale_status, v_rec.auction_outcome;
  END IF;

  IF v_rec.sale_date IS DISTINCT FROM DATE '2026-06-01' THEN
    RAISE EXCEPTION 'Expected derived sale_date 2026-06-01, got %', v_rec.sale_date;
  END IF;

  IF v_rec.canonical_make_id IS DISTINCT FROM '00000000-0000-4000-a000-000000000001'::uuid THEN
    RAISE EXCEPTION 'Expected canonical_make_id backfilled for Porsche, got %', v_rec.canonical_make_id;
  END IF;

  -- Check canonical_models aliases
  IF NOT EXISTS (
    SELECT 1 FROM public.canonical_models
    WHERE make = 'Ford' AND canonical_model = 'F-250' AND aliases @> ARRAY['super duty']
  ) THEN
    RAISE EXCEPTION 'Expected Ford F-250 to include alias super duty';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.canonical_models
    WHERE make = 'BMW' AND canonical_model = '2002' AND aliases @> ARRAY['02 series']
  ) THEN
    RAISE EXCEPTION 'Expected BMW 2002 to include alias 02 series';
  END IF;

  -- Check treemap_family_sales includes series, trim, body_style, and cleaned listing_title
  v_sales := public.treemap_family_sales('Porsche', '911', 100);
  v_model_desc := v_sales->0->>5;

  IF v_model_desc IS NULL OR position('992' in v_model_desc) = 0 OR position('GT3' in v_model_desc) = 0 OR position('Coupe' in v_model_desc) = 0 THEN
    RAISE EXCEPTION 'Expected treemap_family_sales element [5] to include series 992, trim GT3, body Coupe; got %', v_model_desc;
  END IF;
END $$;

SELECT 'cab taxonomy and treemap outcomes contract: all checks passed' AS status;
