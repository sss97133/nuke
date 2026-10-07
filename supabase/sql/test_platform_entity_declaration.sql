-- Isolated PostgreSQL 17 contract for 20261007233000_declare_platform_entity_observation_sources.sql. Synthetic rows only;
-- never production. Run in an empty, disposable dm_refinement_* database:
--   createdb dm_refinement_platform_entity_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_platform_entity_ci -f supabase/sql/test_platform_entity_declaration.sql
-- Fixtures carry the live shapes read from prod on 2026-10-07: observation_sources with its two enums and the five column
-- comments that already exist, stack_substrates with its declaration-complete check, and the pipeline_registry row.
-- Covered: the declaration row (and the other substrate untouched); 22 of 22 columns described with the five existing
-- comments unchanged; the registry write_via extended once; no row written; a re-apply that changes nothing.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR to_regclass('public.observation_sources') IS NOT NULL
     OR to_regclass('public.stack_substrates') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';
SET TimeZone = 'UTC';

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

-- Live shapes ------------------------------------------------------------------------------------------------------------
CREATE TYPE public.source_category AS ENUM ('auction', 'marketplace', 'forum', 'social_media', 'registry', 'shop', 'documentation', 'owner', 'aggregator', 'media', 'event', 'internal', 'dealer', 'museum', 'agent');
CREATE TYPE public.observation_kind AS ENUM ('listing', 'sale_result', 'comment', 'bid', 'sighting', 'work_record', 'ownership', 'specification', 'provenance', 'valuation', 'condition', 'media', 'social_mention', 'expert_opinion', 'splice', 'activity', 'offer');
CREATE TABLE public.observation_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  category public.source_category NOT NULL,
  base_url text,
  url_patterns text[],
  base_trust_score numeric(3,2) DEFAULT 0.50,
  trust_factors jsonb DEFAULT '{}'::jsonb,
  supported_observations public.observation_kind[],
  requires_auth boolean DEFAULT false,
  rate_limit_per_hour integer,
  makes_covered text[],
  years_covered int4range,
  regions_covered text[],
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  business_id uuid,
  tier integer,
  decay_half_life_days integer,
  veracity numeric(3,2),
  consecration numeric(3,2));
COMMENT ON TABLE public.observation_sources IS 'Registry of data sources. Add new auction houses, forums, or other sources here.';
COMMENT ON COLUMN public.observation_sources.business_id IS 'Unified org: this source is represented as a business for display (fixture copy).';
COMMENT ON COLUMN public.observation_sources.tier IS 'Confidence tier (1-4) per book Chapter 3 (fixture copy).';
COMMENT ON COLUMN public.observation_sources.decay_half_life_days IS 'Half-life in days for testimony from this source (fixture copy).';
COMMENT ON COLUMN public.observation_sources.veracity IS 'How much we believe this source is honest/correct (fixture copy).';
COMMENT ON COLUMN public.observation_sources.consecration IS 'The field''s licensed authority to confer legitimate worth (fixture copy).';
INSERT INTO public.observation_sources (slug, display_name, category, base_url, tier, base_trust_score, supported_observations, notes) VALUES
  ('bat', 'Bring a Trailer', 'auction', 'https://bringatrailer.com', 2, 0.85, ARRAY['listing', 'sale_result', 'comment', 'bid']::public.observation_kind[], 'Legacy slug aliases in auction_events: ''bringatrailer''.'),
  ('agent-submission', 'External Agent Submission', 'agent', NULL, NULL, 0.55, NULL, NULL);
CREATE TABLE public.stack_substrates (
  substrate      text PRIMARY KEY CHECK (btrim(substrate) <> '' AND substrate = btrim(substrate)),
  declared_table text CHECK (declared_table ~ '^[a-z_][a-z0-9_]*$'),
  declared_at    timestamptz,
  declared_by    text,
  note           text NOT NULL,
  source         text NOT NULL,
  registered_at  timestamptz NOT NULL DEFAULT now(),
  registered_by  text NOT NULL,
  CONSTRAINT stack_substrates_declaration_complete
    CHECK ((declared_table IS NULL) = (declared_at IS NULL) AND (declared_table IS NULL) = (declared_by IS NULL)));
INSERT INTO public.stack_substrates (substrate, note, source, registered_by) VALUES
  ('platform entity', 'Venues as an entity keyed from lots and listings. Live candidates, not declared: source_registry, live_auction_sources.', 't', 't'),
  ('text fold', 'The text fold.', 't', 't');
CREATE TABLE public.pipeline_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL, column_name text,
  owned_by text NOT NULL, description text NOT NULL, valid_values text[],
  do_not_write_directly boolean NOT NULL DEFAULT false, write_via text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_name, column_name));
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via) VALUES
  ('observation_sources', NULL, 'supabase/migrations', 'Registry of data sources with trust and agent tier.', false, 'Migrations; evaluate_agent_tier updates the agent tier. fn_schema_proposal_apply inserts the row when an add_source proposal is approved.');

CREATE TEMP TABLE before_apply AS
  SELECT a.attname, col_description(a.attrelid, a.attnum) AS cmt FROM pg_attribute a
  WHERE a.attrelid = 'public.observation_sources'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attname IN ('business_id', 'tier', 'decay_half_life_days', 'veracity', 'consecration');

\ir ../migrations/20261007233000_declare_platform_entity_observation_sources.sql

SELECT pg_temp.ok('platform entity is declared as observation_sources with its clock and author; the note keeps its history',
  (SELECT declared_table = 'observation_sources' AND declared_at IS NOT NULL AND declared_by LIKE 'migration 20261007233000%'
          AND note LIKE 'Venues as an entity%' AND note LIKE '%Declared 2026-10-07%'
   FROM public.stack_substrates WHERE substrate = 'platform entity'));
SELECT pg_temp.ok('the other substrate is untouched',
  (SELECT declared_table IS NULL AND note = 'The text fold.' FROM public.stack_substrates WHERE substrate = 'text fold'));
SELECT pg_temp.ok('all 22 columns are described and the table comment is the platform entity',
  (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = 'public.observation_sources'::regclass AND a.attnum > 0
     AND NOT a.attisdropped AND col_description(a.attrelid, a.attnum) IS NOT NULL) = 22
  AND obj_description('public.observation_sources'::regclass, 'pg_class') LIKE 'The platform entity:%');
SELECT pg_temp.ok('the five comments that existed are unchanged',
  NOT EXISTS (SELECT 1 FROM before_apply b
              WHERE b.cmt IS DISTINCT FROM col_description('public.observation_sources'::regclass,
                      (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.observation_sources'::regclass AND attname = b.attname))));
SELECT pg_temp.ok('the registry row names the declaration once and keeps its owner',
  (SELECT owned_by = 'supabase/migrations' AND write_via LIKE 'Migrations;%' AND write_via LIKE '%platform entity%'
          AND (length(write_via) - length(replace(write_via, 'migration 20261007233000', ''))) / length('migration 20261007233000') = 1
   FROM public.pipeline_registry WHERE table_name = 'observation_sources' AND column_name IS NULL));
SELECT pg_temp.ok('no row of observation_sources was written',
  (SELECT count(*) FROM public.observation_sources) = 2
  AND (SELECT notes FROM public.observation_sources WHERE slug = 'bat') LIKE 'Legacy slug aliases%');

CREATE TEMP TABLE before_reapply AS
  SELECT (SELECT declared_at::text || declared_by || note FROM public.stack_substrates WHERE substrate = 'platform entity') AS decl,
         (SELECT write_via FROM public.pipeline_registry WHERE table_name = 'observation_sources' AND column_name IS NULL) AS wv;
\ir ../migrations/20261007233000_declare_platform_entity_observation_sources.sql
SELECT pg_temp.ok('re-applying the migration changes nothing',
  (SELECT decl = (SELECT declared_at::text || declared_by || note FROM public.stack_substrates WHERE substrate = 'platform entity')
      AND wv = (SELECT write_via FROM public.pipeline_registry WHERE table_name = 'observation_sources' AND column_name IS NULL)
   FROM before_reapply)
  AND (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = 'public.observation_sources'::regclass AND a.attnum > 0
       AND NOT a.attisdropped AND col_description(a.attrelid, a.attnum) IS NOT NULL) = 22);

\echo 'platform entity declaration contract: all checks passed'
