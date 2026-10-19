-- Contract test for 20261018090000_family_keys_european_british_moto_wave11.sql
\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS public.canonical_models (
  id uuid PRIMARY KEY,
  make text NOT NULL,
  canonical_model text NOT NULL,
  canonical_series text,
  year_start integer,
  year_end integer,
  body_styles text[],
  aliases text[],
  generation text,
  notes text,
  created_at timestamptz DEFAULT now()
);

INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases)
VALUES
  ('00000000-0000-4000-d000-000000000001'::uuid, 'Rover', 'Mini', 1904, NULL, ARRAY['mini']),
  ('00000000-0000-4000-d000-000000000002'::uuid, 'Rupp', 'Roadster', 1959, NULL, ARRAY['roadster']),
  ('00000000-0000-4000-d000-000000000003'::uuid, 'Moto Guzzi', 'V7 Sport', 1921, NULL, ARRAY['v7 sport']),
  ('00000000-0000-4000-d000-000000000004'::uuid, 'Vespa', '400', 1946, NULL, ARRAY['400'])
ON CONFLICT (id) DO NOTHING;

\ir ../migrations/20261018090000_family_keys_european_british_moto_wave11.sql

DO $$
BEGIN
  -- 1. Verify Rover Mini gained 12hp alias and nulled year bounds
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE make = 'Rover'
      AND canonical_model = 'Mini'
      AND year_start IS NULL
      AND '12hp' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Rover Mini to include 12hp alias with NULL year_start';
  END IF;

  -- 2. Verify Rupp Roadster gained dart kart alias
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE make = 'Rupp'
      AND canonical_model = 'Roadster'
      AND 'dart kart' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Rupp Roadster to include dart kart alias';
  END IF;

  -- 3. Verify Moto Guzzi V7 Sport gained lodola alias and Vespa 400 gained p200e alias
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE make = 'Moto Guzzi'
      AND canonical_model = 'V7 Sport'
      AND 'lodola' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Moto Guzzi V7 Sport to include lodola alias';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE make = 'Vespa'
      AND canonical_model = '400'
      AND 'p200e' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Vespa 400 to include p200e alias';
  END IF;

  -- 4. Verify every alias in canonical_models is 1..4 alphanumeric words
  IF EXISTS (
    SELECT 1
    FROM public.canonical_models cm,
         unnest(cm.aliases) AS a
    WHERE cardinality(
      regexp_split_to_array(
        trim(regexp_replace(lower(a), '[^a-z0-9]+', ' ', 'g')),
        '\s+'
      )
    ) > 4
  ) THEN
    RAISE EXCEPTION 'Found canonical_models alias exceeding 4 alphanumeric words';
  END IF;
END $$;

ROLLBACK;
