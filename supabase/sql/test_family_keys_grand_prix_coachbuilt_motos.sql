-- Contract test for 20261018065000_family_keys_grand_prix_coachbuilt_motos.sql.
-- Runs against a disposable local Postgres instance in CI.

\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE IF NOT EXISTS cron.job (
  jobid bigserial PRIMARY KEY,
  jobname text UNIQUE,
  schedule text,
  command text
);
CREATE OR REPLACE FUNCTION cron.schedule(p_name text, p_sched text, p_cmd text)
RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command)
  VALUES (p_name, p_sched, p_cmd)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING jobid;
$$;
CREATE OR REPLACE FUNCTION cron.unschedule(p_id bigint)
RETURNS boolean LANGUAGE sql AS $$
  DELETE FROM cron.job WHERE jobid = p_id RETURNING true;
$$;

CREATE TABLE public.canonical_makes (
  id uuid PRIMARY KEY,
  canonical_name text NOT NULL UNIQUE,
  display_name text NOT NULL,
  short_name text,
  aliases text[] DEFAULT '{}'::text[],
  country_of_origin text,
  founded_year integer,
  parent_company text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  brand_tier text DEFAULT 'Volume'
);

CREATE TABLE public.canonical_models (
  id uuid PRIMARY KEY,
  make_id uuid NOT NULL REFERENCES public.canonical_makes(id) ON DELETE CASCADE,
  canonical_name text NOT NULL,
  display_name text NOT NULL,
  generation_code text,
  year_start integer,
  year_end integer,
  body_styles text[],
  drivetrain text,
  engine_type text,
  transmission_types text[],
  market_segment text,
  is_collector_grade boolean DEFAULT true,
  notes text,
  aliases text[] DEFAULT '{}'::text[],
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX idx_canonical_models_unique
  ON public.canonical_models (make_id, canonical_name, COALESCE(generation_code, ''));

CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY,
  make text,
  model text,
  year int,
  current_bid numeric,
  end_time timestamptz,
  auction_status text
);

\ir ../migrations/20261015090000_model_family_names.sql
\ir ../migrations/20261016220000_family_keys_coverage.sql
\ir ../migrations/20261017020000_family_keys_long_tail.sql
\ir ../migrations/20261017060000_family_keys_canonical_seed.sql
\ir ../migrations/20261017083000_family_keys_squarebody_shelby.sql
\ir ../migrations/20261018061000_family_keys_gt40_syclone_pickup.sql
\ir ../migrations/20261018062000_family_keys_supercars_euro_icons.sql
\ir ../migrations/20261018063000_family_keys_year_gates_euro_wave.sql
\ir ../migrations/20261018064000_family_keys_jdm_muscle_classics.sql
\ir ../migrations/20261018065000_family_keys_grand_prix_coachbuilt_motos.sql

-- Test idempotency by re-running the migration
CREATE TEMP TABLE once AS
SELECT id, year_start, year_end, notes, aliases FROM public.canonical_models;

\ir ../migrations/20261018065000_family_keys_grand_prix_coachbuilt_motos.sql

DO $$
DECLARE
  v_diff int;
BEGIN
  SELECT count(*) INTO v_diff
  FROM (
    SELECT id, year_start, year_end, notes, aliases FROM public.canonical_models
    EXCEPT
    SELECT id, year_start, year_end, notes, aliases FROM once
  ) d;
  IF v_diff <> 0 THEN
    RAISE EXCEPTION 'Re-running 20261018065000_family_keys_grand_prix_coachbuilt_motos mutated % canonical_models rows', v_diff;
  END IF;
END $$;

REFRESH MATERIALIZED VIEW public.mv_model_family_names;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.mv_model_family_names
    WHERE brand_name = 'Mercedes-Benz' AND family_name = '540K' AND '540k' = ANY(aliases) AND '500k' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Mercedes-Benz 540K in mv_model_family_names';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.mv_model_family_names
    WHERE brand_name = 'Bugatti' AND family_name = 'Type 35' AND 'type 35b' = ANY(aliases) AND 'type 35c' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Bugatti Type 35 to include type 35b / type 35c aliases';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.mv_model_family_names
    WHERE brand_name = 'Ferrari' AND family_name = '857 S' AND '857 sport' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Ferrari 857 S to include 857 sport alias';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.mv_model_family_names
    WHERE brand_name = 'Spyker' AND family_name = 'C8' AND 'c8 laviolette' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Spyker C8 in mv_model_family_names';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.mv_model_family_names
    WHERE brand_name = 'Lancia' AND family_name = 'Delta Integrale' AND 'delta integrale evo' = ANY(aliases)
  ) THEN
    RAISE EXCEPTION 'Expected Lancia Delta Integrale in mv_model_family_names';
  END IF;
END $$;

ROLLBACK;
