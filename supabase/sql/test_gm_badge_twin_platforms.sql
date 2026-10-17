-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_gm_twins -f this-file.sql
-- Contract for 20261015183000_gm_badge_twin_platforms.sql. Synthetic rows only; never production.
-- The GM badge twins share a platform key on every row of each make and model (duplicates and upper-case makes too);
-- a model with no twin keeps none; the self-check refuses a platform that lands on one badge only; the migration
-- applies twice.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.canonical_models') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

CREATE TABLE public.canonical_models (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), make text NOT NULL,
  canonical_model text NOT NULL, canonical_series text, year_start integer, year_end integer, body_styles text[],
  aliases text[] NOT NULL DEFAULT '{}', generation text, notes text, created_at timestamptz DEFAULT now());

-- Every twin of the migration on both badges (two Chevrolet K1500 rows, one with the make in capitals), plus a model
-- with no twin.
INSERT INTO public.canonical_models (make, canonical_model) VALUES
  ('Chevrolet', 'C1500'), ('GMC', 'C1500'),
  ('Chevrolet', 'K1500'), ('CHEVROLET', 'K1500'), ('GMC', 'K1500'),
  ('Chevrolet', 'Silverado'), ('GMC', 'Sierra'),
  ('Chevrolet', 'K5 Blazer'), ('CHEVROLET', 'Blazer'), ('GMC', 'Jimmy'), ('GMC', 'Jimmy'),
  ('Chevrolet', 'Suburban'), ('GMC', 'Suburban'), ('GMC', 'Yukon XL'),
  ('Chevrolet', 'Tahoe'), ('GMC', 'Yukon'),
  ('Chevrolet', 'S10'), ('Chevrolet', 'S-10 Pickup'), ('GMC', 'Sonoma'), ('GMC', 'S15 Pickup'),
  ('Chevrolet', 'S-10 Blazer'), ('GMC', 'S15 Utility'),
  ('Chevrolet', 'Astro'), ('Chevrolet', 'Astro Van'), ('GMC', 'Safari'),
  ('Chevrolet', 'Express'), ('GMC', 'Savana'),
  ('CHEVROLET', 'El Camino'), ('GMC', 'Caballero'),
  ('Chevrolet', 'Colorado'), ('GMC', 'Canyon'),
  ('Chevrolet', 'Trailblazer'), ('GMC', 'Envoy'),
  ('Chevrolet', 'Corvette');

\ir ../migrations/20261015183000_gm_badge_twin_platforms.sql
\ir ../migrations/20261015183000_gm_badge_twin_platforms.sql

SELECT pg_temp.ok('the GMC and both Chevrolet K1500 rows share gm-k1500',
  (SELECT count(*) FROM public.canonical_models WHERE platform = 'gm-k1500') = 3
  AND (SELECT count(DISTINCT lower(make)) FROM public.canonical_models WHERE platform = 'gm-k1500') = 2);
SELECT pg_temp.ok('every platform sits on both badges; both Jimmy rows and the capitalised Blazer row carry theirs',
  NOT EXISTS (SELECT 1 FROM public.canonical_models WHERE platform IS NOT NULL GROUP BY platform HAVING count(DISTINCT lower(make)) < 2)
  AND (SELECT count(*) FROM public.canonical_models WHERE platform = 'gm-k5-blazer-jimmy') = 4
  AND (SELECT count(DISTINCT platform) FROM public.canonical_models) = 13);
SELECT pg_temp.ok('a model with no twin keeps no platform',
  (SELECT platform FROM public.canonical_models WHERE canonical_model = 'Corvette') IS NULL);

-- The self-check refuses a platform on one badge only.
DELETE FROM public.canonical_models WHERE make = 'GMC' AND canonical_model = 'Envoy';
UPDATE public.canonical_models SET platform = NULL WHERE canonical_model = 'Trailblazer';
DO $$ BEGIN
  BEGIN
    INSERT INTO public.canonical_models (make, canonical_model, platform) VALUES ('GMC', 'Typhoon', 'gm-only-one');
    EXECUTE 'DO $check$ BEGIN IF EXISTS (SELECT 1 FROM public.canonical_models WHERE platform LIKE ''gm-%'' GROUP BY platform HAVING count(DISTINCT lower(make)) < 2) THEN RAISE EXCEPTION ''one badge''; END IF; END $check$';
    RAISE EXCEPTION 'Contract failed: the one-badge check did not refuse';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'one badge' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS a platform on one badge is refused';
END $$;
