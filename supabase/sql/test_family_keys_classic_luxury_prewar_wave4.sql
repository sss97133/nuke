-- Contract test for 20261018073000_family_keys_classic_luxury_prewar_wave4.sql
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

-- Seed representative existing families and stub rows
INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases)
VALUES
  ('00000000-0000-4000-e000-000000000991'::uuid, 'Ferrari', '290 MM', NULL, NULL, ARRAY['290 mm']),
  ('00000000-0000-4000-e000-000000000992'::uuid, 'Bugatti', 'Type 41', NULL, NULL, ARRAY['type 41']),
  ('00000000-0000-4000-e000-000000000993'::uuid, 'Alfa Romeo', '8C 2900', NULL, NULL, ARRAY['8c 2900']),
  ('00000000-0000-4000-e000-000000000994'::uuid, 'Cadillac', 'Series 62', 1930, NULL, ARRAY['series 62']),
  ('00000000-0000-4000-e000-000000000995'::uuid, 'Packard', 'Super Eight', 1924, NULL, ARRAY['super eight']),
  ('00000000-0000-4000-e000-000000000996'::uuid, 'Aston Martin', 'Ulster', 1920, NULL, ARRAY['ulster']),
  ('00000000-0000-4000-e000-000000000997'::uuid, 'Maserati', 'Tipo 61 Birdcage', 1959, NULL, ARRAY['tipo 61']),
  ('00000000-0000-4000-e000-000000000998'::uuid, 'Shelby', 'Cobra', 1961, NULL, ARRAY['cobra']),
  ('00000000-0000-4000-e000-000000000999'::uuid, 'Studebaker', 'Commander', 1920, NULL, ARRAY['commander'])
ON CONFLICT (id) DO NOTHING;

\ir ../migrations/20261018073000_family_keys_classic_luxury_prewar_wave4.sql

DO $$
BEGIN
  -- 1. Verify Ferrari 290 MM stub row re-homed into 500 TRC
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE lower(make) = 'ferrari'
      AND lower(canonical_model) = '500 trc'
      AND '290 mm' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Ferrari 290 MM stub row to re-home to 500 TRC';
  END IF;

  -- 2. Verify Cadillac Series 62 includes 355c and model 30 with open year bounds
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE lower(make) = 'cadillac'
      AND lower(canonical_model) = 'series 62'
      AND year_start IS NULL
      AND '355c' = ANY(aliases)
      AND 'model 30' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Cadillac Series 62 to include 355c and model 30 with NULL year_start';
  END IF;

  -- 3. Verify Maserati Tipo 61 Birdcage includes 6cm and 8c 3000
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE lower(make) = 'maserati'
      AND lower(canonical_model) = 'tipo 61 birdcage'
      AND '6cm' = ANY(aliases)
      AND '8c 3000' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Maserati Tipo 61 Birdcage to include 6cm and 8c 3000';
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
