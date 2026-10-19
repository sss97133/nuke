-- Contract test for 20261018071000_family_keys_collector_marques_wave2.sql
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
  ('00000000-0000-4000-e000-000000000971'::uuid, 'Lamborghini', 'Sian', 2008, NULL, ARRAY['sian']),
  ('00000000-0000-4000-e000-000000000972'::uuid, 'Brabham', 'BT19', NULL, NULL, ARRAY['bt19']),
  ('00000000-0000-4000-e000-000000000973'::uuid, 'Cooper', 'T51', NULL, NULL, ARRAY['t51']),
  ('00000000-0000-4000-e000-000000000974'::uuid, 'Dallara', 'Stradale', NULL, NULL, ARRAY['stradale']),
  ('00000000-0000-4000-e000-000000000975'::uuid, 'Excalibur', 'RS', NULL, NULL, ARRAY['rs']),
  ('00000000-0000-4000-e000-000000000976'::uuid, 'Daimler', 'SP250', 1950, NULL, ARRAY['sp250'])
ON CONFLICT (id) DO NOTHING;

\ir ../migrations/20261018071000_family_keys_collector_marques_wave2.sql

DO $$
DECLARE
  v_count integer;
BEGIN
  -- 1. Verify new collector marque families exist with open year_end
  SELECT count(*) INTO v_count
  FROM public.canonical_models
  WHERE (lower(make), lower(canonical_model)) IN (
    ('osca', '1600 gt'),
    ('miller', 'model 91'),
    ('pope-hartford', 'model 29'),
    ('dallara', 'dw12'),
    ('march', '86c'),
    ('cooper', 'monaco'),
    ('williams', 'fw14b'),
    ('brabham', 'bt33'),
    ('scarab', 'mk i'),
    ('matra', 'ms670'),
    ('kurtis', '500s'),
    ('kurtis-kraft', '500s'),
    ('watson', 'indy roadster'),
    ('radical', 'sr3'),
    ('rover', 'mini'),
    ('tatra', 't87'),
    ('opel', 'gt'),
    ('ghia', '450 ss'),
    ('monteverdi', 'high speed 375'),
    ('healey', 'silverstone'),
    ('excalibur', 'phaeton'),
    ('devin', 'ss'),
    ('norton', 'commando'),
    ('bsa', 'gold star'),
    ('bultaco', 'pursang'),
    ('mv agusta', '750 s'),
    ('moto guzzi', 'v7 sport'),
    ('winnebago', 'revel'),
    ('peterbilt', '359'),
    ('kenworth', 'w900'),
    ('fiat', 'abarth 750'),
    ('mercury', 'capri')
  )
  AND year_end IS NULL;

  IF v_count < 32 THEN
    RAISE EXCEPTION 'Expected at least 32 collector marque families from Slice 18, found %', v_count;
  END IF;

  -- 2. Verify Lamborghini Sian includes accented sián fkp 37 alias
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE lower(make) = 'lamborghini'
      AND lower(canonical_model) = 'sian'
      AND 'sián fkp 37' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Lamborghini Sian to include sián fkp 37 alias';
  END IF;

  -- 3. Verify Brabham BT19 stub merged into BT33
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE lower(make) = 'brabham'
      AND lower(canonical_model) = 'bt33'
      AND 'bt19' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Brabham BT19 stub to merge into BT33';
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
