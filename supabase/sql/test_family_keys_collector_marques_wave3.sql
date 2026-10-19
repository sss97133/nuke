-- Contract test for 20261018072000_family_keys_collector_marques_wave3.sql
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
  ('00000000-0000-4000-e000-000000000981'::uuid, 'Benetton', 'B194', NULL, NULL, ARRAY['b194']),
  ('00000000-0000-4000-e000-000000000982'::uuid, 'Callaway', 'C12', NULL, NULL, ARRAY['c12']),
  ('00000000-0000-4000-e000-000000000983'::uuid, 'Duesenberg', 'Model A/Y', NULL, NULL, ARRAY['model a/y']),
  ('00000000-0000-4000-e000-000000000984'::uuid, 'Hispano-Suiza', 'J12', 1919, NULL, ARRAY['j12']),
  ('00000000-0000-4000-e000-000000000985'::uuid, 'Hummer', 'H1', 1990, NULL, ARRAY['h1']),
  ('00000000-0000-4000-e000-000000000986'::uuid, 'Triumph', 'Bonneville', NULL, NULL, ARRAY['bonneville'])
ON CONFLICT (id) DO NOTHING;

\ir ../migrations/20261018072000_family_keys_collector_marques_wave3.sql

DO $$
DECLARE
  v_count integer;
BEGIN
  -- 1. Verify newly inserted specialist families exist with open year_end
  SELECT count(*) INTO v_count
  FROM public.canonical_models
  WHERE (lower(make), lower(canonical_model)) IN (
    ('local', 'rally fighter'),
    ('polaris', 'rzr'),
    ('iso grifo', 'gl'),
    ('srt', 'viper'),
    ('tyrrell', '008'),
    ('arnolt-bristol', 'bolide'),
    ('autokraft', 'mk iv'),
    ('vespa', '400'),
    ('vanderhall', 'venice'),
    ('lanchester', '40 hp'),
    ('divco', 'milk truck'),
    ('cushman', 'eagle'),
    ('hennessey', 'venom gt'),
    ('rezvani', 'tank'),
    ('franklin', 'airman'),
    ('amilcar', 'cgs'),
    ('scion', 'fr-s'),
    ('graham', 'hollywood'),
    ('pininfarina', 'azzurra'),
    ('moke', 'electric'),
    ('ligier', 'js p320'),
    ('simca', '8 sport'),
    ('mosler', 'mt900'),
    ('vector', 'm12'),
    ('smart', 'fortwo'),
    ('checker', 'marathon'),
    ('puch', '230ge'),
    ('bimota', 'tesi'),
    ('steyr-puch', 'pinzgauer'),
    ('marcos', '1600 gt'),
    ('autozam', 'az-1'),
    ('laverda', '750 sfc')
  )
  AND year_end IS NULL;

  IF v_count < 32 THEN
    RAISE EXCEPTION 'Expected at least 32 specialist families from Slice 19, found %', v_count;
  END IF;

  -- 2. Verify Duesenberg Model A/Y re-homed to Model A with model a alias
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE lower(make) = 'duesenberg'
      AND lower(canonical_model) = 'model a'
      AND 'model a' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Duesenberg Model A/Y to re-home to Model A';
  END IF;

  -- 3. Verify Hispano-Suiza J12 includes 15t and t49 aliases
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE lower(make) = 'hispano-suiza'
      AND lower(canonical_model) = 'j12'
      AND '15t' = ANY(aliases)
      AND 't49' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Hispano-Suiza J12 to include 15t and t49 aliases';
  END IF;

  -- 4. Verify every alias is 1..4 alphanumeric words
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
