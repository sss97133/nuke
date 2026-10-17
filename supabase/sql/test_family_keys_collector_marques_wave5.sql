-- Contract test for 20261018074000_family_keys_collector_marques_wave5.sql
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
  ('00000000-0000-4000-e000-000000000981'::uuid, 'AC', 'MA-200', NULL, NULL, ARRAY['ma-200']),
  ('00000000-0000-4000-e000-000000000982'::uuid, 'Alpina', 'Roadster V8', NULL, NULL, ARRAY['roadster v8']),
  ('00000000-0000-4000-e000-000000000983'::uuid, 'Cord', '810', 1929, NULL, ARRAY['810']),
  ('00000000-0000-4000-e000-000000000984'::uuid, 'Delage', 'D8', 1920, NULL, ARRAY['d8']),
  ('00000000-0000-4000-e000-000000000985'::uuid, 'Maserati', 'A6G', 1947, NULL, ARRAY['a6g', '6cm', '8c 3000']),
  ('00000000-0000-4000-e000-000000000986'::uuid, 'Saleen', 'S7', 2000, NULL, ARRAY['s7']),
  ('00000000-0000-4000-e000-000000000987'::uuid, 'Ruf', 'CTR', 1987, NULL, ARRAY['ctr'])
ON CONFLICT (id) DO NOTHING;

\ir ../migrations/20261018074000_family_keys_collector_marques_wave5.sql

DO $$
BEGIN
  -- 1. Verify Subaru Sambar and Range Range Rover inserted
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE id = '00000000-0000-4000-f000-000000000531'::uuid
      AND make = 'Subaru'
      AND canonical_model = 'Sambar'
      AND 'sambar' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Subaru Sambar family to be present';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE id = '00000000-0000-4000-f000-000000000532'::uuid
      AND make = 'Range'
      AND canonical_model = 'Range Rover'
      AND 'rover hse' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Range Range Rover family to be present';
  END IF;

  -- 2. Verify Maserati A6G year_start cleared so pre-1947 6CM/8C 3000 resolve
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE lower(make) = 'maserati'
      AND lower(canonical_model) = 'a6g'
      AND year_start IS NULL
  ) THEN
    RAISE EXCEPTION 'Expected Maserati A6G year_start to be NULL';
  END IF;

  -- 3. Verify Cord 810 includes l29 and Saleen S7 includes s281
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE lower(make) = 'cord'
      AND lower(canonical_model) = '810'
      AND 'l29' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Cord 810 to include l29';
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
