-- Contract test for 20261018084500_family_keys_moto_collector_wave10.sql
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
  ('00000000-0000-4000-c000-000000000001'::uuid, 'Harley-Davidson', 'FL', NULL, NULL, ARRAY['fl']),
  ('00000000-0000-4000-c000-000000000002'::uuid, 'Kawasaki', 'KZ1000', NULL, NULL, ARRAY['kz1000'])
ON CONFLICT (id) DO NOTHING;

\ir ../migrations/20261018084500_family_keys_moto_collector_wave10.sql

DO $$
BEGIN
  -- 1. Verify Harley-Davidson FL gained pan america alias
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE make = 'Harley-Davidson'
      AND canonical_model = 'FL'
      AND 'pan america' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Harley-Davidson FL to include pan america alias';
  END IF;

  -- 2. Verify Kawasaki KZ1000 gained z900rs alias
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE make = 'Kawasaki'
      AND canonical_model = 'KZ1000'
      AND 'z900rs' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Kawasaki KZ1000 to include z900rs alias';
  END IF;

  -- 3. Verify Motobecane Mobylette 50V and Trabant 601 inserted
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE id = '00000000-0000-4000-f000-000000000992'::uuid
      AND make = 'Motobecane'
      AND canonical_model = 'Mobylette 50V'
      AND 'mobylette' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Motobecane Mobylette 50V family to be present';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE id = '00000000-0000-4000-f000-000000001052'::uuid
      AND make = 'Trabant'
      AND canonical_model = '601'
      AND '601' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Trabant 601 family to be present';
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
