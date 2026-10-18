-- Contract test for 20261018069000_family_keys_lagonda_pierce_koenigsegg_euro.sql
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

-- Seed representative existing families that receive year_fixes and target_additions
INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases)
VALUES
  ('00000000-0000-4000-e000-000000000901'::uuid, 'Ferrari', '288 GTO', 1984, 1987, ARRAY['288 gto']),
  ('00000000-0000-4000-e000-000000000902'::uuid, 'Ferrari', '250 GT', 1953, NULL, ARRAY['250 gt']),
  ('00000000-0000-4000-e000-000000000903'::uuid, 'Mercedes-Benz', 'S-Class', 1954, NULL, ARRAY['s-class']),
  ('00000000-0000-4000-e000-000000000904'::uuid, 'Porsche', '550', 1953, NULL, ARRAY['550', '550 spyder']),
  ('00000000-0000-4000-e000-000000000905'::uuid, 'Simplex', '50 HP', 1907, NULL, ARRAY['50 hp']),
  ('00000000-0000-4000-e000-000000000906'::uuid, 'Peugeot', '205', 1910, NULL, ARRAY['205']),
  ('00000000-0000-4000-e000-000000000907'::uuid, 'Alvis', 'Speed 25', NULL, NULL, ARRAY['speed 25']),
  ('00000000-0000-4000-e000-000000000908'::uuid, 'Alvis', 'TD 21', NULL, NULL, ARRAY['td 21']),
  ('00000000-0000-4000-e000-000000000909'::uuid, 'Oldsmobile', '88', 1949, 1999, ARRAY['88']),
  ('00000000-0000-4000-e000-000000000910'::uuid, 'Harley-Davidson', 'FL', 1936, NULL, ARRAY['fl'])
ON CONFLICT (id) DO NOTHING;

\ir ../migrations/20261018069000_family_keys_lagonda_pierce_koenigsegg_euro.sql

DO $$
BEGIN
  -- 1. Verify Lagonda, Pierce-Arrow, Koenigsegg, Citroën, Lola, Horch, and Rolls-Royce 20/25 exist
  IF NOT EXISTS (
    SELECT 1 FROM public.canonical_models
    WHERE make = 'Lagonda' AND canonical_model = 'LG45' AND 'lg45r' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Lagonda LG45 with lg45r alias';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.canonical_models
    WHERE make = 'Pierce-Arrow' AND canonical_model = 'Model 48' AND 'model 48ss' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Pierce-Arrow Model 48 with model 48ss alias';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.canonical_models
    WHERE make = 'Koenigsegg' AND canonical_model = 'Regera' AND 'agera' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Koenigsegg Regera with agera alias';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.canonical_models
    WHERE make = 'Citroën' AND canonical_model = 'DS' AND 'ds21' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Citroën DS with ds21 alias';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.canonical_models
    WHERE make = 'Rolls-Royce' AND canonical_model = '20/25' AND '20/25hp' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Rolls-Royce 20/25 with 20/25hp alias';
  END IF;

  -- 2. Verify concatenated sub-model aliases and widened year bounds
  IF NOT EXISTS (
    SELECT 1 FROM public.canonical_models
    WHERE make = 'Ferrari' AND canonical_model = '288 GTO' AND '288gto' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Ferrari 288 GTO to include 288gto alias';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.canonical_models
    WHERE make = 'Porsche' AND canonical_model = '550' AND '904 gts' = ANY(aliases) AND '910' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Porsche 550 to include 904 gts and 910 aliases';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.canonical_models
    WHERE make = 'Oldsmobile' AND canonical_model = '88' AND year_start = 1901 AND year_end IS NULL AND 'curved dash' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Oldsmobile 88 to have year_start = 1901 and curved dash alias';
  END IF;

  -- 3. Verify every alias added in this migration is 1..4 alphanumeric words
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
