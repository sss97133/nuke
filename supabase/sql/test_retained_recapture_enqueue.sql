-- Arrival enqueue for retained listing projections: a word-for-word BaT description
-- re-capture of one listing page is not projected again; everything else enqueues as before.
-- The live trigger function and trigger definition are reproduced exactly so the
-- migration guard runs against the production owners. enqueue_retained_listing_properties
-- is a one-row stub: this contract decides only whether arrival enqueues.
-- The shared db-contracts runner discovers this file and gives it a fresh PG17 database.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() <> 'dm_refinement_retained_recapture_enqueue'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_observations') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable retained_recapture_enqueue PG17 database';
  END IF;
END $$;
CREATE TYPE public.observation_kind AS ENUM ('listing', 'specification');
CREATE TABLE public.vehicle_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source_id uuid, kind public.observation_kind,
  extraction_method text, source_url text, is_superseded boolean NOT NULL DEFAULT false,
  content_text text, structured_data jsonb, ingested_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ON public.vehicle_observations(vehicle_id, source_id, kind);
CREATE TABLE public.retained_listing_property_work (
  source_observation_id uuid NOT NULL REFERENCES public.vehicle_observations, property_id uuid NOT NULL, vehicle_id uuid,
  status text NOT NULL DEFAULT 'pending', PRIMARY KEY (source_observation_id, property_id)
);
CREATE FUNCTION public.enqueue_retained_listing_properties(p_source uuid) RETURNS integer LANGUAGE sql AS $$
  INSERT INTO public.retained_listing_property_work(source_observation_id, property_id, vehicle_id)
  SELECT o.id, md5('synthetic-property')::uuid, o.vehicle_id FROM public.vehicle_observations o WHERE o.id = p_source
  ON CONFLICT DO NOTHING RETURNING 1;
$$;
\ir fixtures/retained_enqueue_owner_20261015.sql
-- Exact live owner (hash xHctvFszU9qLfSOvsxFsM8FaGRLolR/n34qvRq49k1M=, read 2026-10-15).
CREATE OR REPLACE FUNCTION public.trg_enqueue_retained_listing_properties()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN PERFORM public.enqueue_retained_listing_properties(NEW.id);RETURN NEW;END $function$;
CREATE TRIGGER retained_listing_property_intake AFTER INSERT ON public.vehicle_observations FOR EACH ROW
  WHEN ((NEW.kind = 'listing'::public.observation_kind) AND ((NEW.extraction_method = ANY (ARRAY['html_match'::text, 'html_description_capture'::text]))
    OR ((NEW.extraction_method = 'html_parse'::text) AND (NEW.source_id = 'd7dad87c-0dc3-4b98-a31a-edf511618f8c'::uuid))))
  EXECUTE FUNCTION public.trg_enqueue_retained_listing_properties();

CREATE FUNCTION pg_temp.capture(p_key text, p_text text, p_url text DEFAULT 'https://bringatrailer.com/listing/synthetic-one/',
  p_method text DEFAULT 'html_description_capture', p_vehicle text DEFAULT 'vehicle-one', p_truncated boolean DEFAULT false,
  p_fields jsonb DEFAULT '{}'::jsonb) RETURNS uuid
LANGUAGE sql AS $$
  INSERT INTO public.vehicle_observations(id, vehicle_id, source_id, kind, extraction_method, source_url, content_text, structured_data)
  VALUES (md5(p_key)::uuid, md5(p_vehicle)::uuid, '4cdc735c-f117-42f2-889f-ba33805639a5', 'listing', p_method, p_url, p_text,
    jsonb_build_object('extractor', 'extract-bat-core', 'source_text_field', 'extract-bat-core.extractDescription', 'description_capture', true,
      'extractor_input_truncated', p_truncated, 'source_capture_basis', 'direct_fetch', 'observation_time_basis', 'source_capture',
      'source_event_time_status', 'unknown', 'source_captured_at', clock_timestamp()::text, 'source_capture_sha256', md5(p_key || clock_timestamp()::text))
      || p_fields)
  RETURNING id;
$$;
CREATE FUNCTION pg_temp.queued(p_key text) RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::integer FROM public.retained_listing_property_work WHERE source_observation_id = md5(p_key)::uuid;
$$;

-- Before: every identical re-capture is queued again.
SELECT pg_temp.capture('a', 'Synthetic description. The same words every capture.');
SELECT pg_temp.capture('b', 'Synthetic description. The same words every capture.');
DO $$ BEGIN
  IF pg_temp.queued('a') <> 1 OR pg_temp.queued('b') <> 1 THEN RAISE EXCEPTION 'Fixture did not reproduce the live duplicate enqueue'; END IF;
  RAISE NOTICE 'PASS before the repair, an identical re-capture is queued again (the measured defect)';
END $$;

\ir ../migrations/20261015193000_retained_recapture_enqueue.sql

SELECT pg_temp.capture('c', 'Synthetic description. The same words every capture.');
SELECT pg_temp.capture('d', 'Synthetic description. The words changed.');
SELECT pg_temp.capture('e', 'Synthetic description. The same words every capture.', p_truncated => true);
SELECT pg_temp.capture('f', 'Synthetic description. The same words every capture.', p_url => 'https://bringatrailer.com/listing/synthetic-relisting/');
SELECT pg_temp.capture('g', 'Synthetic description. The same words every capture.', p_vehicle => 'vehicle-two');
SELECT pg_temp.capture('h', 'Synthetic description. The same words every capture.', p_method => 'html_match');
DO $$ BEGIN
  IF pg_temp.queued('c') <> 0 THEN RAISE EXCEPTION 'Identical re-capture was queued again'; END IF;
  IF pg_temp.queued('d') <> 1 THEN RAISE EXCEPTION 'Changed text must enqueue'; END IF;
  IF pg_temp.queued('e') <> 1 THEN RAISE EXCEPTION 'Changed qualification must enqueue'; END IF;
  IF pg_temp.queued('f') <> 1 THEN RAISE EXCEPTION 'Another listing page must enqueue'; END IF;
  IF pg_temp.queued('g') <> 1 THEN RAISE EXCEPTION 'Another vehicle must enqueue'; END IF;
  IF pg_temp.queued('h') <> 1 THEN RAISE EXCEPTION 'Other extraction methods are unchanged'; END IF;
  IF (SELECT count(*) FROM public.vehicle_observations WHERE id = md5('c')::uuid) <> 1 THEN RAISE EXCEPTION 'The re-capture must stay testimony'; END IF;
  RAISE NOTICE 'PASS a word-for-word re-capture is kept but not queued; changed text, qualification, page, vehicle and method enqueue';
END $$;

-- html_match parents carry no description text; their nine projected fields decide.
SELECT pg_temp.capture('m0', NULL, p_method => 'html_match', p_fields => '{"color":"Synthetic Red","year":"1990"}');
SELECT pg_temp.capture('m1', NULL, p_method => 'html_match', p_fields => '{"color":"Synthetic Red","year":"1990","current_bid":"5000"}');
DO $$ DECLARE k text; BEGIN
  IF pg_temp.queued('m0') <> 1 THEN RAISE EXCEPTION 'First html_match capture must enqueue'; END IF;
  IF pg_temp.queued('m1') <> 0 THEN RAISE EXCEPTION 'A change outside the projected fields is still the same assertion'; END IF;
  FOREACH k IN ARRAY ARRAY['interior_color','color','engine_size','transmission','drivetrain','year','make','model','vin'] LOOP
    PERFORM pg_temp.capture('m-' || k, NULL, 'https://bringatrailer.com/listing/synthetic-one/', 'html_match', 'vehicle-one', false,
      jsonb_build_object('color', 'Synthetic Red', 'year', '1990') || jsonb_build_object(k, 'Changed ' || k));
    IF pg_temp.queued('m-' || k) <> 1 THEN RAISE EXCEPTION 'A changed % must enqueue', k; END IF;
  END LOOP;
  PERFORM pg_temp.capture('m-vin-again', NULL, 'https://bringatrailer.com/listing/synthetic-one/', 'html_match', 'vehicle-one', false,
    '{"color":"Synthetic Red","year":"1990","vin":"Changed vin"}'::jsonb);
  IF pg_temp.queued('m-vin-again') <> 0 THEN RAISE EXCEPTION 'A repeated html_match assertion was queued again'; END IF;
  RAISE NOTICE 'PASS html_match: each of the nine projected fields re-enqueues when changed; other changes and repeats do not';
END $$;

-- A withdrawn or failed earlier capture no longer stands in for the assertion.
UPDATE public.vehicle_observations SET is_superseded = true WHERE id IN (md5('a')::uuid, md5('b')::uuid);
SELECT pg_temp.capture('i', 'Synthetic description. The same words every capture.');
UPDATE public.retained_listing_property_work SET status = 'failed' WHERE source_observation_id = md5('i')::uuid;
SELECT pg_temp.capture('j', 'Synthetic description. The same words every capture.');
SELECT pg_temp.capture('k', 'Synthetic description. The same words every capture.');
DO $$ BEGIN
  IF pg_temp.queued('i') <> 1 THEN RAISE EXCEPTION 'With every queued capture superseded, the next capture must enqueue'; END IF;
  IF pg_temp.queued('j') <> 1 THEN RAISE EXCEPTION 'Failed earlier work must not block the assertion'; END IF;
  IF pg_temp.queued('k') <> 0 THEN RAISE EXCEPTION 'A current queued capture again stands for the assertion'; END IF;
  RAISE NOTICE 'PASS superseded or failed earlier captures do not block; the next current queued capture does';
END $$;

-- Reapplication is idempotent; a drifted owner is refused.
DO $$ DECLARE before text := pg_get_functiondef('public.trg_enqueue_retained_listing_properties()'::regprocedure);
BEGIN PERFORM set_config('dm.before', before, false); END $$;
\ir ../migrations/20261015193000_retained_recapture_enqueue.sql
DO $$ BEGIN
  IF pg_get_functiondef('public.trg_enqueue_retained_listing_properties()'::regprocedure) <> current_setting('dm.before') THEN
    RAISE EXCEPTION 'Reapplication changed the definition'; END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.trg_enqueue_retained_listing_properties()'::regprocedure) THEN
    RAISE EXCEPTION 'SECURITY DEFINER lost'; END IF;
  RAISE NOTICE 'PASS reapplication is definition-idempotent';
END $$;
CREATE OR REPLACE FUNCTION public.trg_enqueue_retained_listing_properties() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp' AS $function$BEGIN RETURN NEW; END $function$;
\set ON_ERROR_STOP off
\ir ../migrations/20261015193000_retained_recapture_enqueue.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF pg_get_functiondef('public.trg_enqueue_retained_listing_properties()'::regprocedure) LIKE '%html_description_capture%' THEN
    RAISE EXCEPTION 'A drifted owner was overwritten'; END IF;
  RAISE NOTICE 'PASS a drifted arrival owner is refused, not overwritten';
END $$;
