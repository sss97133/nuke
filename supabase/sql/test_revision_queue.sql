-- Isolated PostgreSQL 17 contract for 20261015120000_revision_queue.sql. Stand-in tables with the live column names; synthetic
-- rows only; never production. Run in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_revision && psql -X -v ON_ERROR_STOP=1 -d dm_refinement_revision -f supabase/sql/test_revision_queue.sql
-- Covered: the retrofit of failed rows (reason, next action, retained-capture rule) and its re-run; record_revision_item (insert,
-- merge of missing, no reopening of a resolved lot, URL spellings); claim (per source, leases, skip locked, actions, next_attempt);
-- release (escalation, retry time); resolve (outcomes, nothing deleted, bad outcome refused); record_lot_depth (raise, relink for an
-- unlinked lot, close landed_whole); the views; the ACL. Not covered: concurrent sessions (SKIP LOCKED is the database's).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.import_queue') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* PostgreSQL 17 database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
CREATE TABLE public.scrape_sources (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
CREATE TABLE public.import_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid, listing_url text NOT NULL UNIQUE, raw_data jsonb DEFAULT '{}',
  status text DEFAULT 'pending', priority integer DEFAULT 0, error_message text, vehicle_id uuid, attempts integer DEFAULT 0,
  max_attempts integer DEFAULT 3, created_at timestamptz DEFAULT now(), processed_at timestamptz, next_attempt_at timestamptz,
  locked_at timestamptz, locked_by text, last_attempt_at timestamptz, updated_at timestamptz, failure_category text,
  CONSTRAINT import_queue_status_check CHECK (status = ANY (ARRAY['pending','processing','complete','failed','skipped','duplicate','pending_review','pending_strategy'])) NOT VALID);
CREATE TABLE public.listing_page_snapshots (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), listing_url text, success boolean, html text, html_storage_path text);
CREATE TABLE public.derivation_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), extractor_slug text, status text, attempts integer, requested_by text,
  completed_at timestamptz, created_at timestamptz DEFAULT now(), source_snapshot_id uuid, source_vehicle_id uuid, next_attempt_at timestamptz);
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

INSERT INTO public.scrape_sources (id, name) VALUES ('00000000-0000-0000-0000-0000000000a1', 'Bonhams'), ('00000000-0000-0000-0000-0000000000a2', 'Mecum');
INSERT INTO public.import_queue (id, source_id, listing_url, status, failure_category, error_message) VALUES
 ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'https://example.test/lot/1', 'failed', 'extraction_failed', 'no price'),
 ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'https://example.test/lot/2', 'failed', 'extraction_failed', 'no price'),
 ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a2', 'https://example.test/lot/3', 'failed', 'billing', 'credits'),
 ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a2', 'https://example.test/lot/4', 'failed', 'identity_insufficient', NULL),
 ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000a2', 'https://example.test/lot/5', 'complete', NULL, NULL);
INSERT INTO public.listing_page_snapshots (listing_url, success, html) VALUES ('https://example.test/lot/1', true, '<html>x</html>'), ('https://example.test/lot/2', true, NULL);
INSERT INTO public.derivation_queue (extractor_slug, status, attempts, requested_by) VALUES ('ex-a', 'failed', 3, 'tester'), ('ex-a', 'done', 1, 'tester');

\ir ../migrations/20261015120000_revision_queue.sql
\ir ../migrations/20261015120000_revision_queue.sql

SELECT pg_temp.ok('retrofit: parser gap with a retained capture is re-parsed',
  (SELECT revision_reason = 'parser_gap' AND next_action = 'reparse_retained' AND revision_source = 'retrofit' FROM public.import_queue WHERE listing_url = 'https://example.test/lot/1'));
SELECT pg_temp.ok('retrofit: parser gap with no retained capture is re-fetched',
  (SELECT next_action = 'refetch' FROM public.import_queue WHERE listing_url = 'https://example.test/lot/2'));
SELECT pg_temp.ok('retrofit: billing waits, identity is relinked',
  (SELECT next_action = 'wait' AND revision_reason = 'billing' FROM public.import_queue WHERE listing_url = 'https://example.test/lot/3')
  AND (SELECT next_action = 'relink' AND revision_reason = 'quality_gate' FROM public.import_queue WHERE listing_url = 'https://example.test/lot/4'));
SELECT pg_temp.ok('retrofit leaves a complete lot alone and keeps the stored status of failed rows',
  (SELECT revision_reason IS NULL AND status = 'complete' FROM public.import_queue WHERE listing_url = 'https://example.test/lot/5')
  AND (SELECT count(*) = 4 FROM public.import_queue WHERE status = 'failed'));
SELECT pg_temp.ok('the list holds the 4 failed lots and the failed derivation, not the complete lot or the done derivation',
  (SELECT count(*) = 4 FROM public.v_revision_queue WHERE item_kind = 'lot') AND (SELECT count(*) = 1 FROM public.v_revision_queue WHERE item_kind = 'derivation'));

-- record_revision_item
SELECT public.record_revision_item('https://www.example.test/lot/5/', ARRAY['photos'], 'thin_landing', 'reparse_retained', 'writer-a');
SELECT pg_temp.ok('a complete lot reported thin becomes a revision item (URL spelling matched, no second row)',
  (SELECT status = 'revision' AND revision_missing = ARRAY['photos'] FROM public.import_queue WHERE listing_url = 'https://example.test/lot/5')
  AND (SELECT count(*) = 5 FROM public.import_queue));
SELECT public.record_revision_item('https://example.test/lot/5', ARRAY['description'], 'parser_gap', 'refetch', 'writer-b');
SELECT pg_temp.ok('missing fields merge', (SELECT revision_missing = ARRAY['description','photos'] AND next_action = 'refetch' FROM public.import_queue WHERE listing_url = 'https://example.test/lot/5'));
SELECT public.record_revision_item('https://example.test/lot/new', ARRAY['vehicle_link'], 'unlinked_capture', 'relink', 'writer-a');
SELECT pg_temp.ok('an unknown lot URL becomes a new revision row', (SELECT status = 'revision' FROM public.import_queue WHERE listing_url = 'https://example.test/lot/new'));

-- claim
CREATE TEMP TABLE c1 AS SELECT * FROM public.claim_revision_items('bonhams', 'worker-1', 10);
SELECT pg_temp.ok('claim by source returns only that source''s actionable lots', (SELECT count(*) = 2 FROM c1));
SELECT pg_temp.ok('a second claim finds nothing while the leases hold', (SELECT count(*) = 0 FROM public.claim_revision_items('bonhams', 'worker-2', 10)));
SELECT pg_temp.ok('wait items are not claimable by default actions',
  NOT EXISTS (SELECT 1 FROM public.claim_revision_items('mecum', 'worker-3', 10) c WHERE c.next_action = 'wait'));

-- release escalates and defers
SELECT public.release_revision_item('10000000-0000-0000-0000-000000000001', 'refetch', interval '2 hours', '{"tried":"reparse"}');
SELECT pg_temp.ok('release escalates the action, defers the retry, frees the lease and keeps it open',
  (SELECT next_action = 'refetch' AND next_attempt_at > now() + interval '1 hour' AND locked_by IS NULL AND outcome IS NULL AND revision_detail ? 'tried'
   FROM public.import_queue WHERE id = '10000000-0000-0000-0000-000000000001'));
SELECT pg_temp.ok('a deferred item is not claimable yet', NOT EXISTS (SELECT 1 FROM public.claim_revision_items('bonhams', 'worker-1', 10) c WHERE c.id = '10000000-0000-0000-0000-000000000001'));

-- resolve
SELECT public.resolve_revision_item('10000000-0000-0000-0000-000000000002', 'non_vehicle', '{"why":"model car"}');
SELECT pg_temp.ok('non_vehicle: resolved with the outcome recorded, row kept',
  (SELECT status = 'resolved' AND outcome = 'non_vehicle' AND outcome_at IS NOT NULL AND outcome_detail->>'why' = 'model car' AND locked_by IS NULL
   FROM public.import_queue WHERE id = '10000000-0000-0000-0000-000000000002'));
SELECT pg_temp.ok('a resolved lot leaves the list', NOT EXISTS (SELECT 1 FROM public.v_revision_queue WHERE item_id = '10000000-0000-0000-0000-000000000002'));
SELECT public.record_revision_item('https://example.test/lot/2', ARRAY['photos'], 'thin_landing', 'reparse_retained', 'writer-a');
SELECT pg_temp.ok('a new report does not reopen a resolved lot', (SELECT status = 'resolved' FROM public.import_queue WHERE id = '10000000-0000-0000-0000-000000000002'));
SELECT public.resolve_revision_item('10000000-0000-0000-0000-000000000004', 'landed_whole');
SELECT pg_temp.ok('landed_whole sets status complete', (SELECT status = 'complete' AND outcome = 'landed_whole' FROM public.import_queue WHERE id = '10000000-0000-0000-0000-000000000004'));
DO $$ BEGIN
  BEGIN PERFORM public.resolve_revision_item('10000000-0000-0000-0000-000000000001', 'deleted'); RAISE EXCEPTION 'accepted'; EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'accepted' THEN RAISE EXCEPTION 'Contract failed: an outcome outside the vocabulary was accepted'; END IF; END;
  RAISE NOTICE 'PASS an outcome outside the vocabulary is refused';
END $$;

-- record_lot_depth
SELECT public.record_lot_depth('https://example.test/lot/depth', ARRAY['description','vin'], NULL, NULL);
SELECT pg_temp.ok('a thin lot is raised as thin_landing / reparse_retained by landing_depth',
  (SELECT status = 'revision' AND revision_reason = 'thin_landing' AND next_action = 'reparse_retained' AND revision_source = 'landing_depth' FROM public.import_queue WHERE listing_url = 'https://example.test/lot/depth'));
SELECT public.record_lot_depth('https://example.test/lot/depth', ARRAY['vehicle_link'], NULL, NULL);
SELECT pg_temp.ok('an unlinked lot is raised as unlinked_capture / relink',
  (SELECT revision_reason = 'unlinked_capture' AND next_action = 'relink' FROM public.import_queue WHERE listing_url = 'https://example.test/lot/depth'));
SELECT public.record_lot_depth('https://example.test/lot/depth', ARRAY[]::text[], NULL, NULL);
SELECT pg_temp.ok('a whole reading closes it landed_whole, row kept',
  (SELECT status = 'complete' AND outcome = 'landed_whole' FROM public.import_queue WHERE listing_url = 'https://example.test/lot/depth'));

SELECT pg_temp.ok('nothing was deleted', (SELECT count(*) = 7 FROM public.import_queue));
SELECT pg_temp.ok('anon and authenticated cannot call the writers or read the views',
  NOT has_function_privilege('anon', 'public.record_revision_item(text,text[],text,text,text,uuid,jsonb,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.claim_revision_items(text,text,integer,text[])', 'EXECUTE')
  AND NOT has_table_privilege('anon', 'public.v_revision_queue', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.v_revision_summary', 'SELECT'));
