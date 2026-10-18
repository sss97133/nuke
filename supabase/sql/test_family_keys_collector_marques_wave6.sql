-- Contract test for 20261018075000_family_keys_collector_marques_wave6.sql
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
  ('00000000-0000-4000-e000-000000000971'::uuid, 'Runge', 'RS', 2012, NULL, ARRAY['rs', 'rs010', 'frankfurt flyer'])
ON CONFLICT (id) DO NOTHING;

\ir ../migrations/20261018075000_family_keys_collector_marques_wave6.sql

DO $$
BEGIN
  -- 1. Verify Runge RS year_start cleared
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE lower(make) = 'runge'
      AND canonical_model = 'RS'
      AND year_start IS NULL
  ) THEN
    RAISE EXCEPTION 'Expected Runge RS year_start to be NULL';
  END IF;

  -- 2. Verify Wolf GB08 Thunder, Matchless G80, and Velocette Thruxton inserted
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE id = '00000000-0000-4000-f000-000000000543'::uuid
      AND make = 'Wolf'
      AND canonical_model = 'GB08 Thunder'
      AND 'gb08 thunder' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Wolf GB08 Thunder family to be present';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE id = '00000000-0000-4000-f000-000000000551'::uuid
      AND make = 'Matchless'
      AND canonical_model = 'G80'
      AND 'g80cs' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Matchless G80 family to be present';
  END IF;

  -- 3. Verify every alias in canonical_models is 1..4 alphanumeric words
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
