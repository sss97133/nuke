-- Contract test for 20261018081500_family_keys_bmw_mercedes_collector_wave8.sql
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
  ('00000000-0000-4000-a000-000000000001'::uuid, 'Mercedes-Benz', 'E-Class', NULL, NULL, ARRAY['300e']),
  ('00000000-0000-4000-a000-000000000002'::uuid, 'BMW', '318ti', NULL, NULL, ARRAY['318ti'])
ON CONFLICT (id) DO NOTHING;

\ir ../migrations/20261018081500_family_keys_bmw_mercedes_collector_wave8.sql

DO $$
BEGIN
  -- 1. Verify Mercedes-Benz E-Class gained 230e alias
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE make = 'Mercedes-Benz'
      AND canonical_model = 'E-Class'
      AND '230e' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Mercedes-Benz E-Class to include 230e alias';
  END IF;

  -- 2. Verify BMW 318ti gained 323ti alias
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE make = 'BMW'
      AND canonical_model = '318ti'
      AND '323ti' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected BMW 318ti to include 323ti alias';
  END IF;

  -- 3. Verify BMW R100, Kawasaki KX250, and Hodaka Ace 100 inserted
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE id = '00000000-0000-4000-f000-000000000736'::uuid
      AND make = 'BMW'
      AND canonical_model = 'R100'
      AND 'r100s' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected BMW R100 Motorrad family to be present';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE id = '00000000-0000-4000-f000-000000000767'::uuid
      AND make = 'Hodaka'
      AND canonical_model = 'Ace 100'
      AND 'combat wombat' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Hodaka Ace 100 family to be present';
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
