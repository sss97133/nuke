-- Actual migration, synthetic fixtures only. Never run in production.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.organizations') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable dm_refinement_* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE TABLE public.organizations(id uuid PRIMARY KEY, business_name text, slug text, is_public boolean,
  broadcast_evidence_state jsonb);
CREATE TABLE public.observation_sources(id uuid PRIMARY KEY, slug text UNIQUE);
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY, source_id uuid, source_identifier text, kind text,
  subject_organization_id uuid, observed_at timestamptz, ingested_at timestamptz DEFAULT now(),
  structured_data jsonb, property_id uuid);
CREATE INDEX idx_observations_source ON public.vehicle_observations(source_id);
CREATE INDEX idx_vehicle_observations_ingested_at ON public.vehicle_observations(ingested_at DESC);
CREATE TABLE public.auction_events(id uuid PRIMARY KEY, vehicle_id uuid, broadcast_publisher_organization_id uuid,
  broadcast_evidence_state jsonb, broadcast_evidence_last_observation_id uuid);
CREATE INDEX idx_auction_broadcast_publisher ON public.auction_events(broadcast_publisher_organization_id, id)
  WHERE broadcast_evidence_state IS NOT NULL;
CREATE FUNCTION public.observation_is_public(text, jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT NOT coalesce(($2->>'private')::boolean, false) $$;
CREATE FUNCTION public.broadcast_event_display_proxy(jsonb) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$ SELECT 1::numeric $$;
CREATE FUNCTION public.fixture_uid(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;

INSERT INTO public.organizations VALUES (fixture_uid(1), 'Synthetic House', 'synthetic-house', true, '{"covered":1}'),
  (fixture_uid(2), 'Private House', 'private-house', false, NULL);
INSERT INTO public.observation_sources VALUES (fixture_uid(10), 'youtube'), (fixture_uid(11), 'other-source');
INSERT INTO public.vehicle_observations(id, source_id, kind, subject_organization_id, ingested_at, structured_data) VALUES
  (fixture_uid(100), fixture_uid(10), 'media', fixture_uid(1), '2026-10-02', '{"kind_detail":"broadcast_profile_derived","n":1}'),
  (fixture_uid(101), NULL, 'media', fixture_uid(1), '2026-10-03', '{"kind_detail":"broadcast_profile_derived","n":2}'),
  (fixture_uid(102), fixture_uid(11), 'media', fixture_uid(1), '2026-10-04', '{"kind_detail":"broadcast_profile_derived","n":3}'),
  (fixture_uid(103), fixture_uid(10), 'media', fixture_uid(1), '2026-10-05', '{"kind_detail":"broadcast_claim","n":4}'),
  (fixture_uid(104), fixture_uid(10), 'media', fixture_uid(2), '2026-10-06', '{"kind_detail":"broadcast_profile_derived","n":5}');
-- The live new subject column has no statistics, and the generic source estimate is about
-- 320k rows. Reproduce that estimate with two sources and a smaller disposable table.
ALTER TABLE public.vehicle_observations ALTER COLUMN subject_organization_id SET STATISTICS 0;
-- Bulk rows under another source: the reader has to reach its claims without visiting these.
INSERT INTO public.vehicle_observations(id, source_id, kind, structured_data)
SELECT fixture_uid(1000 + n), fixture_uid(11), 'media', '{}' FROM generate_series(1, 640000) n;
INSERT INTO public.auction_events VALUES (fixture_uid(200), NULL, fixture_uid(1), '{"samples":1}', NULL);
ANALYZE public.vehicle_observations;

\ir ../migrations/20261019053000_broadcast_profile_reader_source_index.sql
\ir ../migrations/20261019053000_broadcast_profile_reader_source_index.sql

-- The derived-claim branch already exempts these rows from the general visibility check.
-- Its redundant OR still calls the JSON regex helper in production. Make that work observable:
-- the previous indexed reader reaches it, while the repair must keep the same rows without it.
CREATE OR REPLACE FUNCTION public.observation_is_public(text, jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN RAISE EXCEPTION 'redundant visibility scan evaluated'; END $$;
DO $$ BEGIN
  BEGIN
    PERFORM public.read_broadcast_entity_profile(fixture_uid(1), 20);
    RAISE EXCEPTION 'expected the previous reader to evaluate the redundant check';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'redundant visibility scan evaluated' THEN RAISE; END IF;
  END;
END $$;
\ir ../migrations/20261019074500_broadcast_profile_skip_redundant_privacy_scan.sql
\ir ../migrations/20261019074500_broadcast_profile_skip_redundant_privacy_scan.sql
\ir ../migrations/20261019080000_broadcast_profile_bound_generic_plan.sql
\ir ../migrations/20261019080000_broadcast_profile_bound_generic_plan.sql

DO $$ DECLARE r jsonb; ids uuid[]; plan text; function_query text; BEGIN
  r := public.read_broadcast_entity_profile(fixture_uid(1), 20);
  SELECT array_agg((c->>'id')::uuid ORDER BY c->>'ingested_at' DESC) INTO ids FROM jsonb_array_elements(r->'derived_subject_claims') c;
  ASSERT ids = ARRAY[fixture_uid(101), fixture_uid(100)], format('YouTube and source-less derived claims, newest first: %s', ids);
  ASSERT jsonb_array_length(r->'presentations') = 1 AND r->>'name' = 'Synthetic House', 'Presentations and identity unchanged';
  ASSERT public.read_broadcast_entity_profile(fixture_uid(2), 20) IS NULL, 'Private organization reads nothing';
  ASSERT jsonb_array_length(public.read_broadcast_entity_profile(fixture_uid(1), 1)->'derived_subject_claims') = 1, 'Limit applies';

  -- Exercise the parameterized function body, including its parameterized LIMIT. A literal
  -- LIMIT alone missed the live ingestion-index scan that walked unrelated source rows.
  function_query := split_part(split_part(pg_get_functiondef('public.read_broadcast_entity_profile(uuid,integer)'::regprocedure),
    'AS $function$', 2), '$function$', 1);
  function_query := replace(replace(function_query, 'p_organization_id', '$1::uuid'), 'p_limit', '$2::integer');
  EXECUTE 'EXPLAIN (GENERIC_PLAN true, FORMAT JSON) ' || function_query INTO plan;
  ASSERT plan NOT LIKE '%idx_vehicle_observations_ingested_at%',
    format('The actual parameterized reader must avoid the global time index: %s', plan);

  -- This fixture has two sources, so its generic source estimate covers half the table and
  -- can prefer a Seq Scan. With that priced out, prove the actual body is source-indexable.
  -- The measured production generic plan uses this source index without changing planner settings.
  SET LOCAL enable_seqscan = off;
  EXECUTE 'EXPLAIN (GENERIC_PLAN true, FORMAT JSON) ' || function_query INTO plan;
  ASSERT plan NOT LIKE '%"Seq Scan"%' AND plan LIKE '%idx_observations_source%'
    AND plan NOT LIKE '%idx_vehicle_observations_ingested_at%',
    format('The actual parameterized reader must use the available source index: %s', plan);
  ASSERT position('OR o.source_id IS NULL' IN pg_get_functiondef('public.read_broadcast_entity_profile(uuid,integer)'::regprocedure)) > 0,
    'The deployed reader carries the indexed filter that was planned above';
END $$;
SELECT 'broadcast profile reader index contract passed' AS result;
