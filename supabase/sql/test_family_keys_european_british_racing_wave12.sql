-- Contract test for 20261018091500_family_keys_european_british_racing_wave12.sql
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
  ('00000000-0000-4000-d000-000000000001'::uuid, 'Bimota', 'Tesi', 1973, NULL, ARRAY['tesi']),
  ('00000000-0000-4000-d000-000000000002'::uuid, 'Delage', 'D8', NULL, NULL, ARRAY['d8']),
  ('00000000-0000-4000-d000-000000000003'::uuid, 'Messerschmitt', 'KR200', 1953, NULL, ARRAY['kr200']),
  ('00000000-0000-4000-d000-000000000004'::uuid, 'TVR', 'Griffith', 1958, NULL, ARRAY['griffith'])
ON CONFLICT (id) DO NOTHING;

\ir ../migrations/20261018091500_family_keys_european_british_racing_wave12.sql

DO $$
BEGIN
  -- 1. Verify Bimota Tesi gained db1 alias and nulled year bounds
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE make = 'Bimota'
      AND canonical_model = 'Tesi'
      AND year_start IS NULL
      AND 'db1' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Bimota Tesi to include db1 alias with NULL year_start';
  END IF;

  -- 2. Verify Delage D8 gained di tourer alias
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE make = 'Delage'
      AND canonical_model = 'D8'
      AND 'di tourer' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Delage D8 to include di tourer alias';
  END IF;

  -- 3. Verify Messerschmitt KR200 gained kr201 alias and TVR Griffith gained 3000s alias
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE make = 'Messerschmitt'
      AND canonical_model = 'KR200'
      AND 'kr201' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Messerschmitt KR200 to include kr201 alias';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE make = 'TVR'
      AND canonical_model = 'Griffith'
      AND '3000s' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected TVR Griffith to include 3000s alias';
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
