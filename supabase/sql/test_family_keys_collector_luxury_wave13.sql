-- Contract test for 20261018093000_family_keys_collector_luxury_wave13.sql
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
  ('00000000-0000-4000-d000-000000000001'::uuid, 'Continental', 'Mark II', 1955, NULL, ARRAY['mark ii']),
  ('00000000-0000-4000-d000-000000000002'::uuid, 'Westfield', 'Eleven', 1982, NULL, ARRAY['eleven']),
  ('00000000-0000-4000-d000-000000000003'::uuid, 'Meyers', 'Manx', 1960, NULL, ARRAY['manx']),
  ('00000000-0000-4000-d000-000000000004'::uuid, 'Porsche', '356', 1948, NULL, ARRAY['356'])
ON CONFLICT (id) DO NOTHING;

\ir ../migrations/20261018093000_family_keys_collector_luxury_wave13.sql

DO $$
BEGIN
  -- 1. Verify Continental Mark II gained mkii alias and nulled year bounds
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE make = 'Continental'
      AND canonical_model = 'Mark II'
      AND year_start IS NULL
      AND 'mkii' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Continental Mark II to include mkii alias with NULL year_start';
  END IF;

  -- 2. Verify Westfield Eleven gained seiw alias
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE make = 'Westfield'
      AND canonical_model = 'Eleven'
      AND 'seiw' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Westfield Eleven to include seiw alias';
  END IF;

  -- 3. Verify Meyers Manx gained manxter alias and Porsche 356 gained 928gt alias
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE make = 'Meyers'
      AND canonical_model = 'Manx'
      AND 'manxter' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Meyers Manx to include manxter alias';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE make = 'Porsche'
      AND canonical_model = '356'
      AND '928gt' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Porsche 356 to include 928gt alias';
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
