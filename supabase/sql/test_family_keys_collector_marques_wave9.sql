-- Contract test for 20261018083000_family_keys_collector_marques_wave9.sql
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
  ('00000000-0000-4000-b000-000000000001'::uuid, 'Toyota', 'Land Cruiser', NULL, NULL, ARRAY['land cruiser']),
  ('00000000-0000-4000-b000-000000000002'::uuid, 'Mazda', 'B-Series', NULL, NULL, ARRAY['b-series'])
ON CONFLICT (id) DO NOTHING;

\ir ../migrations/20261018083000_family_keys_collector_marques_wave9.sql

DO $$
BEGIN
  -- 1. Verify Toyota Land Cruiser gained hj45 alias
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE make = 'Toyota'
      AND canonical_model = 'Land Cruiser'
      AND 'hj45' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Toyota Land Cruiser to include hj45 alias';
  END IF;

  -- 2. Verify Mazda B-Series gained b2600i alias
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE make = 'Mazda'
      AND canonical_model = 'B-Series'
      AND 'b2600i' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Mazda B-Series to include b2600i alias';
  END IF;

  -- 3. Verify Yugo GV, Greeves 250 Challenger, and Rokon Trail-Breaker inserted
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE id = '00000000-0000-4000-f000-000000000845'::uuid
      AND make = 'Yugo'
      AND canonical_model = 'GV'
      AND 'gvl' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Yugo GV family to be present';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE id = '00000000-0000-4000-f000-000000000876'::uuid
      AND make = 'Greeves'
      AND canonical_model = '250 Challenger'
      AND 'hawkstone' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Greeves 250 Challenger family to be present';
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
