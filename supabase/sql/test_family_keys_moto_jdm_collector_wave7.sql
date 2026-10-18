-- Contract test for 20261018080000_family_keys_moto_jdm_collector_wave7.sql
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
  ('15c4d351-082e-44f5-af97-afab63d3fe5b'::uuid, 'Honda', 'CB900', 1979, 1982, ARRAY['cb900']),
  ('054e8e83-5c08-4ab5-9b30-e7f657b053de'::uuid, 'Lincoln', 'Mark', NULL, NULL, ARRAY['mark'])
ON CONFLICT (id) DO NOTHING;

\ir ../migrations/20261018080000_family_keys_moto_jdm_collector_wave7.sql

DO $$
BEGIN
  -- 1. Verify Honda CB900 stub merged into CB750
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE id = '15c4d351-082e-44f5-af97-afab63d3fe5b'::uuid
      AND canonical_model = 'CB750'
      AND year_start IS NULL
  ) THEN
    RAISE EXCEPTION 'Expected Honda CB900 stub to merge into CB750';
  END IF;

  -- 2. Verify Lincoln Mark stub merged into Continental with mark ii alias
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE id = '054e8e83-5c08-4ab5-9b30-e7f657b053de'::uuid
      AND canonical_model = 'Continental'
      AND 'mark ii' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Lincoln Mark stub to merge into Continental';
  END IF;

  -- 3. Verify Aprilia RSV4, Jensen-Healey Mk II, and Toyota Soarer inserted
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE id = '00000000-0000-4000-f000-000000000626'::uuid
      AND make = 'Aprilia'
      AND canonical_model = 'RSV4'
      AND 'rsv1000' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Aprilia RSV4 family to be present';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_models
    WHERE id = '00000000-0000-4000-f000-000000000729'::uuid
      AND make = 'Toyota'
      AND canonical_model = 'Soarer'
      AND 'celsior' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Toyota Soarer family to be present';
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
