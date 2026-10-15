-- Arrival enqueue for retained listing projections: a BaT re-capture whose projection
-- inputs equal the same page's immediately preceding capture is not projected again;
-- everything else enqueues as before. The live trigger function, trigger definition
-- and enqueue owner are reproduced exactly so the migration guard runs against the
-- production owners. enqueue_retained_listing_properties(uuid) is a one-row stub: this
-- contract decides only whether arrival enqueues.
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
  content_text text, structured_data jsonb, observed_at timestamptz DEFAULT clock_timestamp(),
  ingested_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ON public.vehicle_observations(vehicle_id, source_id, kind);
CREATE INDEX idx_observations_vehicle_time ON public.vehicle_observations(vehicle_id, observed_at DESC) WHERE vehicle_id IS NOT NULL;
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
CREATE FUNCTION public.trg_enqueue_retained_listing_properties()
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
CREATE FUNCTION pg_temp.same(p_key text) RETURNS uuid LANGUAGE sql AS $$
  SELECT pg_temp.capture(p_key, 'Synthetic description. The same words every capture.');
$$;

-- Before: every identical re-capture is queued again.
SELECT pg_temp.same('a');
SELECT pg_temp.same('b');
DO $$ BEGIN
  IF pg_temp.queued('a') <> 1 OR pg_temp.queued('b') <> 1 THEN RAISE EXCEPTION 'Fixture did not reproduce the live duplicate enqueue'; END IF;
  RAISE NOTICE 'PASS before the repair, an identical re-capture is queued again (the measured defect)';
END $$;

\ir ../migrations/20261015193000_retained_recapture_enqueue.sql

SELECT pg_temp.same('c');
SELECT pg_temp.same('c2');
SELECT pg_temp.capture('d', 'Synthetic description. The words changed.');
SELECT pg_temp.capture('e', 'Synthetic description. The words changed.', p_truncated => true);
SELECT pg_temp.capture('f', 'Synthetic description. The same words every capture.', p_url => 'https://bringatrailer.com/listing/synthetic-relisting/');
SELECT pg_temp.capture('g', 'Synthetic description. The same words every capture.', p_vehicle => 'vehicle-two');
DO $$ BEGIN
  IF pg_temp.queued('c') <> 0 THEN RAISE EXCEPTION 'A repeat of a queued capture was queued again'; END IF;
  IF pg_temp.queued('c2') <> 0 THEN RAISE EXCEPTION 'A repeat of a skipped repeat was queued again'; END IF;
  IF pg_temp.queued('d') <> 1 THEN RAISE EXCEPTION 'Changed text must enqueue'; END IF;
  IF pg_temp.queued('e') <> 1 THEN RAISE EXCEPTION 'Changed qualification must enqueue'; END IF;
  IF pg_temp.queued('f') <> 1 THEN RAISE EXCEPTION 'Another listing page must enqueue'; END IF;
  IF pg_temp.queued('g') <> 1 THEN RAISE EXCEPTION 'Another vehicle must enqueue'; END IF;
  IF (SELECT count(*) FROM public.vehicle_observations WHERE id IN (md5('c')::uuid, md5('c2')::uuid)) <> 2 THEN RAISE EXCEPTION 'Repeats must stay testimony'; END IF;
  RAISE NOTICE 'PASS repeats of a queued or skipped predecessor are kept but not queued; changed text, qualification, page and vehicle enqueue';
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

-- A superseded or only-failed predecessor no longer stands in for the assertion.
SELECT pg_temp.capture('s1', 'Synthetic description. Third wording.');
UPDATE public.vehicle_observations SET is_superseded = true WHERE id = md5('s1')::uuid;
SELECT pg_temp.capture('s2', 'Synthetic description. Third wording.');
UPDATE public.retained_listing_property_work SET status = 'failed' WHERE source_observation_id = md5('s2')::uuid;
SELECT pg_temp.capture('s3', 'Synthetic description. Third wording.');
SELECT pg_temp.capture('s4', 'Synthetic description. Third wording.');
DO $$ BEGIN
  IF pg_temp.queued('s2') <> 1 THEN RAISE EXCEPTION 'A superseded predecessor must not block'; END IF;
  IF pg_temp.queued('s3') <> 1 THEN RAISE EXCEPTION 'An only-failed predecessor must not block'; END IF;
  IF pg_temp.queued('s4') <> 0 THEN RAISE EXCEPTION 'A current queued predecessor again stands for the assertion'; END IF;
  RAISE NOTICE 'PASS superseded or only-failed predecessors do not block; the next current queued one does';
END $$;

-- Only the immediately preceding capture of the page decides (documented limit: A,B,A re-queues).
SELECT pg_temp.capture('alt-a', 'Synthetic description. Alternating A.');
SELECT pg_temp.capture('alt-b', 'Synthetic description. Alternating B.');
SELECT pg_temp.capture('alt-a2', 'Synthetic description. Alternating A.');
DO $$ BEGIN
  IF pg_temp.queued('alt-a') <> 1 OR pg_temp.queued('alt-b') <> 1 OR pg_temp.queued('alt-a2') <> 1 THEN
    RAISE EXCEPTION 'Alternating inputs must each enqueue against their immediate predecessor'; END IF;
  RAISE NOTICE 'PASS only the immediately preceding capture of the page is compared';
END $$;

-- The walk is bounded: a predecessor beyond the vehicle's latest 200 observations enqueues.
SELECT pg_temp.capture('far-1', 'Synthetic description. Far wording.', p_vehicle => 'vehicle-busy');
INSERT INTO public.vehicle_observations(vehicle_id, source_id, kind, extraction_method, source_url, structured_data)
  SELECT md5('vehicle-busy')::uuid, '4cdc735c-f117-42f2-889f-ba33805639a5', 'listing', 'bat_public_live_v1',
    'https://bringatrailer.com/listing/synthetic-one/', '{}'::jsonb FROM generate_series(1, 200);
SELECT pg_temp.capture('far-2', 'Synthetic description. Far wording.', p_vehicle => 'vehicle-busy');
SELECT pg_temp.capture('far-3', 'Synthetic description. Far wording.', p_vehicle => 'vehicle-busy');
DO $$ BEGIN
  IF pg_temp.queued('far-2') <> 1 THEN RAISE EXCEPTION 'A predecessor beyond the bounded walk must not block'; END IF;
  IF pg_temp.queued('far-3') <> 0 THEN RAISE EXCEPTION 'A near predecessor must still be found past other rows'; END IF;
  RAISE NOTICE 'PASS the predecessor walk is bounded to 200 observations and skips unrelated rows';
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
