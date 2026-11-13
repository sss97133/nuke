\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%' OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='auth')
 OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
 RAISE EXCEPTION 'Requires empty disposable database'; END IF;
END $$;
CREATE TABLE listing_feeds(id uuid,source_slug text,search_criteria jsonb,updated_at timestamptz);
INSERT INTO listing_feeds VALUES('2b413532-64b4-4756-9840-7ec8ffd45f6e','purplewave',
 '{"fetch_strategy":"purplewave_public_json","native_page":1,"native_offset":17,"preserved":true}',now());
\ir ../migrations/20261108191600_replay_initial_purplewave_details.sql
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM listing_feeds WHERE search_criteria->>'native_offset'='0'
 AND search_criteria->>'native_detail_version'='1' AND search_criteria->>'preserved'='true') THEN RAISE EXCEPTION 'Replay not qualified'; END IF;
END $$;
UPDATE listing_feeds SET search_criteria=search_criteria||'{"native_offset":8}';
\ir ../migrations/20261108191600_replay_initial_purplewave_details.sql
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM listing_feeds WHERE search_criteria->>'native_offset'='8') THEN RAISE EXCEPTION 'Replay reset acknowledged progress'; END IF;
END $$;
