-- Contract test for 20261018070000_family_keys_stub_merges_and_year_gates.sql
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
  ('00000000-0000-4000-e000-000000000951'::uuid, 'Avions Voisin', 'C25', NULL, NULL, ARRAY['c25']),
  ('00000000-0000-4000-e000-000000000952'::uuid, 'Porsche', '917', 1969, 1973, ARRAY['917', '917k']),
  ('00000000-0000-4000-e000-000000000953'::uuid, 'Porsche', '956', 1982, 1984, ARRAY['956']),
  ('00000000-0000-4000-e000-000000000954'::uuid, 'Bugatti', 'Type 59', NULL, NULL, ARRAY['type 59']),
  ('00000000-0000-4000-e000-000000000955'::uuid, 'Bugatti', 'Mistral', NULL, NULL, ARRAY['mistral']),
  ('00000000-0000-4000-e000-000000000956'::uuid, 'Pontiac', 'Bonneville', 1957, 2005, ARRAY['bonneville'])
ON CONFLICT (id) DO NOTHING;

\ir ../migrations/20261018070000_family_keys_stub_merges_and_year_gates.sql

DO $$
DECLARE
  v_count integer;
BEGIN
  -- 1. Verify all 12 new canonical families exist with open year_end
  SELECT count(*) INTO v_count
  FROM public.canonical_models
  WHERE (lower(make), lower(canonical_model)) IN (
    ('ferrari', '312t'),
    ('aston martin', 'valkyrie'),
    ('aston martin', 'ulster'),
    ('mclaren', 'mp4'),
    ('lamborghini', 'sian'),
    ('alfa romeo', 'tipo 33'),
    ('lancia', 'lambda'),
    ('lancia', '037'),
    ('lotus', 'type 18'),
    ('mg', 'magnette'),
    ('packard', 'clipper'),
    ('sunbeam', '90')
  )
  AND year_end IS NULL;

  IF v_count < 12 THEN
    RAISE EXCEPTION 'Expected 12 new canonical families from Slice 17, found %', v_count;
  END IF;

  -- 2. Verify Avions Voisin C25 has expanded coachbuilt aliases
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE lower(make) = 'avions voisin'
      AND lower(canonical_model) = 'c25'
      AND 'c23' = ANY(aliases)
      AND 'c14' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Avions Voisin C25 to include c23 and c14 aliases';
  END IF;

  -- 3. Verify Porsche 956 stub row merged into 917 and year bounds widened
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE lower(make) = 'porsche'
      AND lower(canonical_model) = '917'
      AND '956' = ANY(aliases)
      AND year_end IS NULL
  ) THEN
    RAISE EXCEPTION 'Expected Porsche 917 to include 956 alias and open year_end';
  END IF;

  -- 4. Verify Pontiac Bonneville widened year_start to 1954 and year_end to NULL
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE lower(make) = 'pontiac'
      AND lower(canonical_model) = 'bonneville'
      AND year_start = 1954
      AND year_end IS NULL
  ) THEN
    RAISE EXCEPTION 'Expected Pontiac Bonneville to have year_start = 1954 and year_end IS NULL';
  END IF;

  -- 5. Verify every alias is 1..4 alphanumeric words
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
