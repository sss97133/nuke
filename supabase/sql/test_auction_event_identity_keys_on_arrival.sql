-- Isolated PostgreSQL 17 contract for 20261007091000_key_lots_on_identity_arrival.sql: a BaT lot whose winner or seller
-- text names an identity that does not exist yet is keyed when that identity arrives, through the same rule as the insert
-- and update triggers of 20261006213000.
-- Synthetic rows only; never production. Run in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_auction_event_identity_arrival_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_auction_event_identity_arrival_ci -f supabase/sql/test_auction_event_identity_keys_on_arrival.sql
-- Both migrations are applied, in order, by a non-superuser table owner, as prod's deploy role does. The dblink calls
-- (a second session that holds a lot row) run as the superuser that starts the script, before and after the owner's turns.
-- Sections: the migration's shape and cost objects; the arrival of a seller, a winner, both, a dealer's lots; what must not
-- be keyed (stop word, contradicted, a writer's key, another platform, another letter case, a non-BaT lot); the cap, the
-- bulk insert, ON CONFLICT DO NOTHING, a live lot, the lander's own role; a row another session holds, a failing rule;
-- the backfill picks up what the trigger skipped; the assay; re-applying the migration.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR to_regclass('public.auction_events') IS NOT NULL
     OR to_regclass('public.external_identities') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
SET TimeZone = 'UTC';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dm_contract_deployer') THEN CREATE ROLE dm_contract_deployer NOLOGIN; END IF;
END $$;
CREATE EXTENSION dblink;
-- Prod's deploy role owns the tables and is not a superuser (#722: a function-level SET of app.writer was refused).
GRANT CREATE ON SCHEMA public TO dm_contract_deployer;
SET ROLE dm_contract_deployer;
DO $$ BEGIN
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'the contract must run as a non-superuser after SET ROLE';
  END IF;
END $$;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

-- Live shapes (prod, 2026-10-07) -------------------------------------------------------------------------------------
CREATE TABLE public.external_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL, handle text NOT NULL, profile_url text,
  metadata jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now(),
  CONSTRAINT external_identities_platform_handle_key UNIQUE (platform, handle)
);
CREATE TABLE public.auction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid, source text NOT NULL, source_url text, lot_number text,
  auction_end_date timestamptz, outcome text NOT NULL,
  high_bid numeric, winning_bid numeric, winning_bidder text, seller_name text,
  total_bids integer, comments_count integer, page_views integer, watchers integer,
  raw_data jsonb, scraped_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX idx_auction_events_vehicle_source_url ON public.auction_events (vehicle_id, source_url);
CREATE INDEX idx_auction_events_vehicle ON public.auction_events (vehicle_id);
CREATE TABLE public.auction_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_event_id uuid REFERENCES public.auction_events(id) ON DELETE CASCADE,
  vehicle_id uuid, platform text, author_username text, comment_type text,
  bid_amount numeric, is_seller boolean, posted_at timestamptz DEFAULT now(), comment_text text,
  external_identity_id uuid REFERENCES public.external_identities(id) ON DELETE SET NULL
);
CREATE INDEX idx_auction_comments_auction ON public.auction_comments (auction_event_id);
CREATE TABLE public.vehicle_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, extraction_method text
);
CREATE TABLE public.pipeline_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL, column_name text,
  owned_by text NOT NULL, description text NOT NULL, valid_values text[],
  do_not_write_directly boolean NOT NULL DEFAULT false, write_via text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_name, column_name)
);
CREATE TABLE public.write_receipts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(), tbl text NOT NULL, op text NOT NULL,
  rows integer NOT NULL, writer text NOT NULL, db_role text NOT NULL,
  app_name text, txid bigint NOT NULL
);
CREATE TABLE public.schema_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposed_at timestamptz NOT NULL DEFAULT now(),
  proposed_by_user_id uuid, proposed_by_agent_key text,
  proposal_type text NOT NULL, payload jsonb NOT NULL, evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  motivating_observation_ids uuid[], motivating_pending_claim_ids uuid[],
  estimated_scope jsonb, backward_compatibility jsonb,
  status text NOT NULL DEFAULT 'open', claimed_by_user_id uuid, claimed_at timestamptz, resolved_at timestamptz,
  decision_rationale text, promoted_to_id uuid,
  supersedes_proposal_id uuid REFERENCES public.schema_proposals(id),
  superseded_by uuid REFERENCES public.schema_proposals(id),
  CONSTRAINT proposer_present CHECK (proposed_by_user_id IS NOT NULL OR proposed_by_agent_key IS NOT NULL),
  CONSTRAINT schema_proposals_status_check CHECK (status = ANY (ARRAY['open', 'under_review', 'approved', 'rejected',
    'needs_changes', 'superseded', 'withdrawn'])),
  CONSTRAINT schema_proposals_proposal_type_check CHECK (proposal_type = ANY (ARRAY['add_property', 'fork_property',
    'deprecate_property', 'modify_property', 'add_source', 'modify_trust_tier', 'add_observation_kind',
    'add_source_category', 'add_image_attribute']))
);
GRANT SELECT, INSERT, UPDATE ON public.auction_events TO service_role;
GRANT SELECT, INSERT ON public.external_identities TO service_role;
GRANT SELECT ON public.auction_comments TO service_role;

-- The live BEFORE UPDATE trigger on auction_events (body as on prod). Live lots are the ones that wait for a seller.
CREATE FUNCTION public.preserve_bat_live_projection()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE old_data jsonb; new_data jsonb; old_live jsonb; new_live jsonb; old_at timestamptz; new_at timestamptz;
BEGIN
  old_data:=CASE WHEN TG_TABLE_NAME='vehicle_events' THEN to_jsonb(OLD)->'metadata' ELSE to_jsonb(OLD)->'raw_data' END;
  new_data:=CASE WHEN TG_TABLE_NAME='vehicle_events' THEN to_jsonb(NEW)->'metadata' ELSE to_jsonb(NEW)->'raw_data' END;
  old_live:=old_data->'live_stream'; new_live:=new_data->'live_stream';
  IF old_live IS NULL THEN RETURN NEW; END IF;
  -- Organization/image metadata maintenance does not rewrite an auction fact.
  IF old_live IS NOT DISTINCT FROM new_live AND
    (SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(OLD)) WHERE key IN
      ('event_status','ended_at','sold_at','current_price','final_price','bid_count','view_count','watcher_count',
       'outcome','auction_end_date','high_bid','winning_bid','winning_bidder','total_bids','comments_count','page_views','watchers'))
    IS NOT DISTINCT FROM
    (SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(NEW)) WHERE key IN
      ('event_status','ended_at','sold_at','current_price','final_price','bid_count','view_count','watcher_count',
       'outcome','auction_end_date','high_bid','winning_bid','winning_bidder','total_bids','comments_count','page_views','watchers'))
    THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM public.vehicle_observations o WHERE o.id=coalesce(new_live->>'last_observation_id',new_live->>'observation_id')::uuid
      AND o.vehicle_id=NEW.vehicle_id AND o.extraction_method='bat_public_live_v1'
      AND o.xmin=(pg_current_xact_id()::text::bigint % 4294967296)::text::xid) THEN RETURN NEW; END IF;
  old_at:=coalesce(old_live->>'last_frame_received_at',old_live->>'received_at')::timestamptz;
  new_at:=(new_data#>>'{source_read,at}')::timestamptz;
  IF new_at IS NULL OR (old_at IS NOT NULL AND new_at<=old_at) THEN RETURN OLD; END IF;
  IF TG_TABLE_NAME='vehicle_events' THEN NEW.metadata:=NEW.metadata||jsonb_build_object('live_stream',old_live);
  ELSE NEW.raw_data:=NEW.raw_data||jsonb_build_object('live_stream',old_live); END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER preserve_bat_live_projection BEFORE UPDATE ON public.auction_events
FOR EACH ROW EXECUTE FUNCTION public.preserve_bat_live_projection();

-- Identities that exist before any lot. 'Judy' flags a seller, 'Erin' bids, 'Frank' is a writer's key. Not minted here
-- (they arrive in the test): Latecomer, Lateborn, Lateboth-W, Lateboth-S, Dealer3, My, Be, Ivan, Zed, Lateplat, LowerCased,
-- Livelate, Postgrest, Svc, Capped, Locked, Failing, and the Bulk and Cap lots' handles.
INSERT INTO public.external_identities (platform, handle) VALUES
  ('bat', 'Alice'), ('bat', 'Bob'), ('bat', 'Erin'), ('bat', 'Frank'), ('bat', 'Judy');

CREATE TEMP TABLE identities_initial AS SELECT * FROM public.external_identities;

-- THE BASE: 20261006213000, as the deploy role ------------------------------------------------------------------------
\ir ../migrations/20261006213000_key_auction_event_identities.sql

CREATE FUNCTION pg_temp.ident(p_handle text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.external_identities WHERE platform = 'bat' AND handle = p_handle $$;
CREATE FUNCTION pg_temp.lot(p_label text, p_source text, p_outcome text, p_winning_bid numeric, p_winner text, p_seller text,
                            p_raw jsonb DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.auction_events (vehicle_id, source, source_url, lot_number, outcome, winning_bid, high_bid,
                                     winning_bidder, seller_name, raw_data, updated_at)
  VALUES (gen_random_uuid(), p_source, 'https://bringatrailer.com/listing/' || p_label, p_label, p_outcome,
          p_winning_bid, p_winning_bid, p_winner, p_seller,
          coalesce(p_raw, jsonb_build_object('extractor', 'extract-bat-core')), '2026-10-01 00:00:00+00') $$;
-- The handles of the lot's two keys, '-' for NULL: 'Alice/Bob'.
CREATE FUNCTION pg_temp.keys(p_label text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT e.handle FROM public.external_identities e WHERE e.id = a.winning_bidder_external_identity_id), '-')
         || '/' ||
         coalesce((SELECT e.handle FROM public.external_identities e WHERE e.id = a.seller_external_identity_id), '-')
  FROM public.auction_events a WHERE a.lot_number = p_label $$;
CREATE FUNCTION pg_temp.say(p_label text, p_author text, p_is_seller boolean, p_key text, p_bid numeric DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.auction_comments (auction_event_id, vehicle_id, platform, author_username, comment_type, bid_amount,
                                       is_seller, external_identity_id)
  SELECT a.id, a.vehicle_id, 'bat', p_author, CASE WHEN p_bid IS NULL THEN 'comment' ELSE 'bid' END, p_bid, p_is_seller,
         pg_temp.ident(p_key)
  FROM public.auction_events a WHERE a.lot_number = p_label $$;
CREATE FUNCTION pg_temp.verdicts(p_label text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(r.winning_bidder_verdict, '-') || '/' || coalesce(r.seller_verdict, '-')
  FROM public.auction_events a
  CROSS JOIN LATERAL public.resolve_auction_event_identities(a.id, a.source, a.winning_bidder, a.winning_bid, a.seller_name) r
  WHERE a.lot_number = p_label $$;
CREATE FUNCTION pg_temp.state() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.auction_events t $$;
CREATE FUNCTION pg_temp.plan(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text; out text := '';
BEGIN
  FOR r IN EXECUTE 'EXPLAIN (COSTS OFF) ' || p_sql LOOP out := out || r || E'\n'; END LOOP;
  RETURN out;
END $$;
CREATE FUNCTION pg_temp.conninfo() RETURNS text LANGUAGE sql AS $$
  SELECT format('host=%s port=%s dbname=%s user=%s',
    CASE WHEN current_setting('unix_socket_directories') = '' THEN 'localhost'
         ELSE split_part(current_setting('unix_socket_directories'), ',', 1) END,
    current_setting('port'), current_database(), current_user);
$$;

-- THE LOTS THAT WAIT: written before their identity exists ---------------------------------------------------------------
SELECT pg_temp.lot('arr-seller', 'bat', 'reserve_not_met', NULL, NULL, 'Latecomer');
SELECT pg_temp.lot('arr-winner', 'bat', 'sold', 7000, 'Lateborn', NULL);
SELECT pg_temp.lot('arr-both', 'bat', 'sold', 7000, 'Lateboth-W', 'Lateboth-S');
SELECT pg_temp.lot('arr-dealer-1', 'bat', 'reserve_not_met', NULL, NULL, 'Dealer3');
SELECT pg_temp.lot('arr-dealer-2', 'bat', 'reserve_not_met', NULL, NULL, 'Dealer3');
SELECT pg_temp.lot('arr-dealer-3', 'bringatrailer', 'reserve_not_met', NULL, NULL, 'Dealer3');
SELECT pg_temp.lot('arr-dealer-nonbat', 'cars_and_bids', 'reserve_not_met', NULL, NULL, 'Dealer3');
INSERT INTO public.auction_events (vehicle_id, source, source_url, lot_number, outcome, seller_name, seller_external_identity_id)
VALUES (gen_random_uuid(), 'bat', 'https://bringatrailer.com/listing/arr-dealer-keyed', 'arr-dealer-keyed', 'reserve_not_met', 'Dealer3',
        pg_temp.ident('Frank'));
SELECT pg_temp.lot('arr-stop-seller', 'bat', 'reserve_not_met', NULL, NULL, 'My');
SELECT pg_temp.lot('arr-stop-winner', 'bat', 'sold', 7000, 'Be', NULL);
SELECT pg_temp.lot('arr-contradicted-seller', 'bat', 'reserve_not_met', NULL, NULL, 'Ivan');
SELECT pg_temp.say('arr-contradicted-seller', 'Judy', true, 'Judy');                    -- BaT flags Judy as the seller
SELECT pg_temp.lot('arr-contradicted-winner', 'bat', 'sold', 30000, 'Zed', NULL);
SELECT pg_temp.say('arr-contradicted-winner', 'Erin', false, 'Erin', 30000);            -- another handle bid the sale price
SELECT pg_temp.lot('arr-platform', 'bat', 'reserve_not_met', NULL, NULL, 'Lateplat');
SELECT pg_temp.lot('arr-case', 'bat', 'reserve_not_met', NULL, NULL, 'lowercased');
SELECT pg_temp.lot('arr-live', 'bat', 'live', NULL, NULL, 'Livelate',
  jsonb_build_object('extractor', 'extract-bat-core', 'live_stream', jsonb_build_object('received_at', '2026-10-01T00:00:00Z')));
SELECT pg_temp.lot('arr-conflict', 'bat', 'reserve_not_met', NULL, NULL, 'Postgrest');
SELECT pg_temp.lot('arr-service-role', 'bat', 'reserve_not_met', NULL, NULL, 'Svc');
SELECT pg_temp.lot('arr-fail', 'bat', 'reserve_not_met', NULL, NULL, 'Failing');
SELECT pg_temp.lot('arr-probe', 'bat', 'sold', 7000, 'ProbeW', 'ProbeS');
SELECT pg_temp.lot('arr-locked', 'bat', 'reserve_not_met', NULL, NULL, 'Locked');
SELECT pg_temp.lot('arr-unlocked', 'bat', 'reserve_not_met', NULL, NULL, 'Locked');
SELECT pg_temp.lot('arr-bulk-' || g, 'bat', 'reserve_not_met', NULL, NULL, 'Bulk' || g) FROM generate_series(1, 300) g;
SELECT pg_temp.lot('arr-cap-' || g, 'bat', 'reserve_not_met', NULL, NULL, 'Capped') FROM generate_series(1, 120) g;
-- A population for the planner: lots with their keys set, and lots with no text.
INSERT INTO public.auction_events (vehicle_id, source, source_url, lot_number, outcome, seller_name, winning_bidder,
                                   seller_external_identity_id, winning_bidder_external_identity_id)
SELECT gen_random_uuid(), 'bat', 'https://bringatrailer.com/listing/pop-' || g, 'pop-' || g, 'sold', 'Alice', 'Bob',
       pg_temp.ident('Alice'), pg_temp.ident('Bob')
FROM generate_series(1, 4000) g;
ANALYZE public.auction_events;

SELECT pg_temp.ok('the waiting lots are all open: the base trigger found no identity and minted none',
  (SELECT count(*) FROM public.auction_events
   WHERE lot_number LIKE 'arr-%' AND lot_number <> 'arr-dealer-keyed'
     AND (winning_bidder_external_identity_id IS NOT NULL OR seller_external_identity_id IS NOT NULL)) = 0
  AND pg_temp.keys('arr-dealer-keyed') = '-/Frank'
  AND (SELECT count(*) FROM public.external_identities) = 5);

CREATE TEMP TABLE lots_before AS SELECT * FROM public.auction_events;
CREATE TEMP TABLE shape_before AS
  SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind IN ('r', 'i', 'v', 'm', 'S')) AS relations,
         (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.auction_events'::regclass AND attnum > 0 AND NOT attisdropped) AS lot_columns,
         (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.external_identities'::regclass AND attnum > 0 AND NOT attisdropped) AS identity_columns,
         (SELECT string_agg(p.proname || ':' || md5(p.prosrc), ',' ORDER BY p.proname) FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace AND p.proname NOT LIKE 'dblink%') AS functions,
         (SELECT string_agg(tgname || ':' || pg_get_triggerdef(oid), '|' ORDER BY tgname) FROM pg_trigger
          WHERE tgrelid = 'public.auction_events'::regclass AND NOT tgisinternal) AS lot_triggers,
         (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.external_identities'::regclass AND NOT tgisinternal) AS identity_triggers,
         (SELECT count(*) FROM public.schema_proposals) AS proposals,
         (SELECT count(*) FROM public.pipeline_registry) AS registry_rows,
         (SELECT string_agg(description, '|' ORDER BY column_name) FROM public.pipeline_registry) AS registry_descriptions,
         pg_temp.state() AS lots_state;

-- THE MIGRATION ----------------------------------------------------------------------------------------------------------
\ir ../migrations/20261007091000_key_lots_on_identity_arrival.sql

SELECT pg_temp.ok('the migration changes no lot row, identity or comment',
  pg_temp.state() = (SELECT lots_state FROM shape_before) AND (SELECT count(*) FROM public.external_identities) = 5);
SELECT pg_temp.ok('the migration adds two indexes, one function and one trigger, and no table, column, proposal or registry row',
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'i', 'v', 'm', 'S')) = (SELECT relations FROM shape_before) + 2
  AND (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.auction_events'::regclass AND attnum > 0 AND NOT attisdropped) = (SELECT lot_columns FROM shape_before)
  AND (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.external_identities'::regclass AND attnum > 0 AND NOT attisdropped) = (SELECT identity_columns FROM shape_before)
  AND (SELECT count(*) FROM public.schema_proposals) = (SELECT proposals FROM shape_before)
  AND (SELECT count(*) FROM public.pipeline_registry) = (SELECT registry_rows FROM shape_before)
  AND (SELECT count(*) FROM pg_class c WHERE c.relname IN ('idx_auction_events_open_seller_text', 'idx_auction_events_open_winner_text')) = 2
  AND (SELECT count(*) FROM pg_proc WHERE proname = 'key_auction_events_on_identity_arrival') = 1
  AND (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.external_identities'::regclass AND NOT tgisinternal) = (SELECT identity_triggers FROM shape_before) + 1);
SELECT pg_temp.ok('every function that was there is untouched, and the triggers on auction_events are as they were',
  (SELECT string_agg(p.proname || ':' || md5(p.prosrc), ',' ORDER BY p.proname) FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname NOT LIKE 'dblink%' AND p.proname <> 'key_auction_events_on_identity_arrival')
      = (SELECT functions FROM shape_before)
  AND (SELECT string_agg(tgname || ':' || pg_get_triggerdef(oid), '|' ORDER BY tgname) FROM pg_trigger
       WHERE tgrelid = 'public.auction_events'::regclass AND NOT tgisinternal) = (SELECT lot_triggers FROM shape_before));
SELECT pg_temp.ok('both indexes are valid, btree, partial, on the one text column, with the open-key predicate',
  (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE i.indrelid = 'public.auction_events'::regclass AND i.indisvalid AND i.indpred IS NOT NULL AND NOT i.indisunique
     AND ((c.relname = 'idx_auction_events_open_seller_text' AND pg_get_indexdef(c.oid) LIKE '%USING btree (seller_name) WHERE%seller_external_identity_id IS NULL%')
       OR (c.relname = 'idx_auction_events_open_winner_text' AND pg_get_indexdef(c.oid) LIKE '%USING btree (winning_bidder) WHERE%winning_bidder_external_identity_id IS NULL%'))) = 2);
SELECT pg_temp.ok('the trigger is AFTER INSERT, FOR EACH ROW, enabled, only for platform bat, and fires on nothing else',
  (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.external_identities'::regclass AND NOT t.tgisinternal
     AND t.tgname = 'trg_key_auction_events_on_identity_arrival' AND t.tgenabled = 'O'
     AND t.tgtype = 1 + 4 AND pg_get_triggerdef(t.oid) LIKE '%WHEN ((new.platform = ''bat''::text))%') = 1);
SELECT pg_temp.ok('the function is SECURITY DEFINER with a fixed search_path, owned by the deploy role, executable by nobody else',
  (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'dm_contract_deployer'
   FROM pg_proc p WHERE p.proname = 'key_auction_events_on_identity_arrival')
  AND NOT has_function_privilege('anon', 'public.key_auction_events_on_identity_arrival()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.key_auction_events_on_identity_arrival()', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.key_auction_events_on_identity_arrival()', 'EXECUTE'));
SELECT pg_temp.ok('both keys name the arrival trigger once in the registry''s write_via and once in the column comment; descriptions are untouched',
  (SELECT count(*) FROM public.pipeline_registry WHERE table_name = 'auction_events'
     AND column_name IN ('winning_bidder_external_identity_id', 'seller_external_identity_id')
     AND write_via LIKE '%trg_key_auction_events_on_identity_arrival%'
     AND (length(write_via) - length(replace(write_via, 'identity_arrival', ''))) = length('identity_arrival')) = 2
  AND (SELECT string_agg(description, '|' ORDER BY column_name) FROM public.pipeline_registry) = (SELECT registry_descriptions FROM shape_before)
  AND (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = 'public.auction_events'::regclass
       AND a.attname IN ('winning_bidder_external_identity_id', 'seller_external_identity_id')
       AND col_description(a.attrelid, a.attnum) LIKE '%trg_key_auction_events_on_identity_arrival%'
       AND (length(col_description(a.attrelid, a.attnum)) - length(replace(col_description(a.attrelid, a.attnum), 'identity_arrival', ''))) = length('identity_arrival')) = 2);
SELECT pg_temp.ok('the function, the trigger and both indexes are described',
  obj_description('public.key_auction_events_on_identity_arrival()'::regprocedure, 'pg_proc') LIKE '%SKIP LOCKED%'
  AND obj_description((SELECT oid FROM pg_trigger WHERE tgname = 'trg_key_auction_events_on_identity_arrival'), 'pg_trigger') LIKE '%platform bat%'
  AND obj_description('public.idx_auction_events_open_seller_text'::regclass, 'pg_class') LIKE '%open seller keys%'
  AND obj_description('public.idx_auction_events_open_winner_text'::regclass, 'pg_class') LIKE '%open winner keys%');
SET enable_seqscan = off;
SELECT pg_temp.ok('the probes the function runs are served by the partial indexes (the predicates are provable)',
  pg_temp.plan('SELECT 1 FROM public.auction_events a WHERE a.seller_name = ''x'' AND a.seller_external_identity_id IS NULL AND a.source IN (''bat'', ''bringatrailer'')')
    LIKE '%idx_auction_events_open_seller_text%'
  AND pg_temp.plan('SELECT 1 FROM public.auction_events a WHERE a.winning_bidder = ''x'' AND a.winning_bidder_external_identity_id IS NULL AND a.source IN (''bat'', ''bringatrailer'')')
    LIKE '%idx_auction_events_open_winner_text%');
RESET enable_seqscan;
SELECT pg_temp.ok('the indexes hold only the open keys: the 4,000 keyed lots are not in them',
  (SELECT reltuples BETWEEN 100 AND 1000 FROM pg_class WHERE relname = 'idx_auction_events_open_seller_text')
  AND (SELECT reltuples BETWEEN 1 AND 100 FROM pg_class WHERE relname = 'idx_auction_events_open_winner_text'));

-- The plans of the statements the function actually runs: an arrival must read auction_events only through the two partial
-- indexes. A sequential scan of the table (the open-key predicate not provable, or an index dropped) would cost 139 ms
-- warm and 1.6 s cold on prod for every identity insert.
BEGIN; SELECT pg_stat_force_next_flush(); COMMIT;
CREATE TEMP TABLE scans_before AS
  SELECT (SELECT seq_scan FROM pg_stat_user_tables WHERE relid = 'public.auction_events'::regclass) AS seq,
         (SELECT idx_scan FROM pg_stat_user_indexes WHERE indexrelid = 'public.idx_auction_events_open_seller_text'::regclass) AS seller_idx,
         (SELECT idx_scan FROM pg_stat_user_indexes WHERE indexrelid = 'public.idx_auction_events_open_winner_text'::regclass) AS winner_idx;
BEGIN;
SELECT pg_stat_force_next_flush();
INSERT INTO public.external_identities (platform, handle) VALUES ('bat', 'ProbeW'), ('bat', 'ProbeS'), ('bat', 'NobodyWaitsForMe');
COMMIT;
CREATE TEMP TABLE scans_after AS
  SELECT (SELECT seq_scan FROM pg_stat_user_tables WHERE relid = 'public.auction_events'::regclass) AS seq,
         (SELECT idx_scan FROM pg_stat_user_indexes WHERE indexrelid = 'public.idx_auction_events_open_seller_text'::regclass) AS seller_idx,
         (SELECT idx_scan FROM pg_stat_user_indexes WHERE indexrelid = 'public.idx_auction_events_open_winner_text'::regclass) AS winner_idx;
SELECT pg_temp.ok('scans: three arrivals (a winner, a seller, a handle nobody waits for) read auction_events through the partial indexes only, never by a sequential scan',
  (SELECT a.seq = b.seq FROM scans_before b, scans_after a)
  AND (SELECT a.seller_idx - b.seller_idx >= 3 AND a.winner_idx - b.winner_idx >= 3 FROM scans_before b, scans_after a)
  AND pg_temp.keys('arr-probe') = 'ProbeW/ProbeS');

CREATE TEMP TABLE lots_pre_arrival AS SELECT a.id, to_jsonb(a) - 'winning_bidder_external_identity_id' - 'seller_external_identity_id' AS rest
FROM public.auction_events a;

-- THE ARRIVAL ------------------------------------------------------------------------------------------------------------
INSERT INTO public.external_identities (platform, handle) VALUES ('bat', 'Latecomer');
SELECT pg_temp.ok('arrival: a waiting seller is keyed when its identity is inserted', pg_temp.keys('arr-seller') = '-/Latecomer');
INSERT INTO public.external_identities (platform, handle) VALUES ('bat', 'Lateborn');
SELECT pg_temp.ok('arrival: a waiting winner is keyed when its identity is inserted', pg_temp.keys('arr-winner') = 'Lateborn/-');
INSERT INTO public.external_identities (platform, handle) VALUES ('bat', 'Lateboth-W');
SELECT pg_temp.ok('arrival: a lot waiting on two handles is keyed on the column the arriving handle names, and only that one',
  pg_temp.keys('arr-both') = 'Lateboth-W/-');
INSERT INTO public.external_identities (platform, handle) VALUES ('bat', 'Lateboth-S');
SELECT pg_temp.ok('arrival: the second handle keys the other column and leaves the first as it was', pg_temp.keys('arr-both') = 'Lateboth-W/Lateboth-S');
INSERT INTO public.external_identities (platform, handle) VALUES ('bat', 'Dealer3');
SELECT pg_temp.ok('arrival: every open BaT lot of the handle is keyed, the bringatrailer spelling included',
  pg_temp.keys('arr-dealer-1') = '-/Dealer3' AND pg_temp.keys('arr-dealer-2') = '-/Dealer3' AND pg_temp.keys('arr-dealer-3') = '-/Dealer3');
SELECT pg_temp.ok('arrival: a key the writer passed is never overwritten, and a non-BaT lot of the same text is never keyed',
  pg_temp.keys('arr-dealer-keyed') = '-/Frank' AND pg_temp.keys('arr-dealer-nonbat') = '-/-');

INSERT INTO public.external_identities (platform, handle) VALUES ('bat', 'My'), ('bat', 'Be');
SELECT pg_temp.ok('arrival: a stop word stays NULL although its identity now exists (My, Be)',
  pg_temp.keys('arr-stop-seller') = '-/-' AND pg_temp.keys('arr-stop-winner') = '-/-'
  AND pg_temp.verdicts('arr-stop-seller') = '-/stop_word' AND pg_temp.verdicts('arr-stop-winner') = 'stop_word/-');
INSERT INTO public.external_identities (platform, handle) VALUES ('bat', 'Ivan');
SELECT pg_temp.ok('arrival: a seller whom BaT flags to another handle stays NULL (contradicted)',
  pg_temp.keys('arr-contradicted-seller') = '-/-' AND pg_temp.verdicts('arr-contradicted-seller') = '-/contradicted');
INSERT INTO public.external_identities (platform, handle) VALUES ('bat', 'Zed');
SELECT pg_temp.ok('arrival: a winner whom another handle outbid at the sale price stays NULL (contradicted)',
  pg_temp.keys('arr-contradicted-winner') = '-/-' AND pg_temp.verdicts('arr-contradicted-winner') = 'contradicted/-');
INSERT INTO public.external_identities (platform, handle) VALUES ('cars_and_bids', 'Lateplat');
SELECT pg_temp.ok('arrival: an identity of another platform keys nothing', pg_temp.keys('arr-platform') = '-/-');
INSERT INTO public.external_identities (platform, handle) VALUES ('bat', 'LowerCased');
SELECT pg_temp.ok('arrival: the match is on the exact text; another letter case is left to the next write or the backfill',
  pg_temp.keys('arr-case') = '-/-');

-- A live lot: the key is set through preserve_bat_live_projection, with raw_data and updated_at as they were.
INSERT INTO public.external_identities (platform, handle) VALUES ('bat', 'Livelate');
SELECT pg_temp.ok('arrival: a live lot is keyed through preserve_bat_live_projection, raw_data and updated_at intact',
  pg_temp.keys('arr-live') = '-/Livelate'
  AND (SELECT a.raw_data = b.raw_data AND a.updated_at = b.updated_at
       FROM public.auction_events a JOIN lots_before b USING (id) WHERE a.lot_number = 'arr-live'));

-- ON CONFLICT DO NOTHING, as the lander's upsert writes it: fires for a row inserted, not for a conflict.
INSERT INTO public.external_identities (platform, handle) VALUES ('bat', 'Postgrest') ON CONFLICT (platform, handle) DO NOTHING;
SELECT pg_temp.ok('arrival: an upsert that inserts the identity keys the lot', pg_temp.keys('arr-conflict') = '-/Postgrest');
UPDATE public.auction_events SET seller_external_identity_id = NULL WHERE lot_number = 'arr-conflict';
INSERT INTO public.external_identities (platform, handle) VALUES ('bat', 'Postgrest') ON CONFLICT (platform, handle) DO NOTHING;
SELECT pg_temp.ok('arrival: an upsert that finds the identity already there inserts nothing and fires nothing', pg_temp.keys('arr-conflict') = '-/-');

-- The lander's own database role has no EXECUTE on the trigger function.
RESET ROLE;
SET ROLE service_role;
INSERT INTO public.external_identities (platform, handle) VALUES ('bat', 'Svc');
RESET ROLE;
SET ROLE dm_contract_deployer;
SELECT pg_temp.ok('arrival: the identity inserted by the lander''s own role, which cannot execute the trigger function, keys the lot',
  pg_temp.keys('arr-service-role') = '-/Svc');

-- Many lots, many identities.
INSERT INTO public.external_identities (platform, handle) SELECT 'bat', 'Bulk' || g FROM generate_series(1, 300) g;
SELECT pg_temp.ok('arrival: one statement that inserts 300 identities keys the 300 lots waiting for them',
  (SELECT count(*) FROM public.auction_events WHERE lot_number LIKE 'arr-bulk-%' AND seller_external_identity_id IS NOT NULL
     AND seller_external_identity_id = (SELECT e.id FROM public.external_identities e WHERE e.platform = 'bat' AND e.handle = seller_name)) = 300);
INSERT INTO public.external_identities (platform, handle) VALUES ('bat', 'Capped');
SELECT pg_temp.ok('arrival: at most 100 lots are keyed for one arrival; the rest stay open',
  (SELECT count(*) FILTER (WHERE seller_external_identity_id IS NOT NULL) = 100 AND count(*) FILTER (WHERE seller_external_identity_id IS NULL) = 20
   FROM public.auction_events WHERE lot_number LIKE 'arr-cap-%'));

-- A lot another session holds is skipped, not waited for.
RESET ROLE;
SELECT dblink_connect('holder', pg_temp.conninfo());
SELECT dblink_exec('holder', 'BEGIN');
SELECT dblink_exec('holder', 'UPDATE public.auction_events SET page_views = 1 WHERE lot_number = ''arr-locked''');
SET ROLE dm_contract_deployer;
SET lock_timeout = '1s';
CREATE TEMP TABLE locked_timing AS SELECT clock_timestamp() AS t0;
INSERT INTO public.external_identities (platform, handle) VALUES ('bat', 'Locked');
CREATE TEMP TABLE locked_timing_2 AS SELECT clock_timestamp() AS t1;
SET lock_timeout = '3s';
RESET ROLE;
SELECT dblink_exec('holder', 'COMMIT');
SELECT dblink_disconnect('holder');
SET ROLE dm_contract_deployer;
SELECT pg_temp.ok('skip locked: the identity insert did not wait for the held lot, the unheld lot of the same handle was keyed, and the held lot stays open',
  (SELECT t1 - t0 < interval '700 ms' FROM locked_timing, locked_timing_2)
  AND pg_temp.keys('arr-unlocked') = '-/Locked' AND pg_temp.keys('arr-locked') = '-/-'
  AND (SELECT page_views = 1 FROM public.auction_events WHERE lot_number = 'arr-locked'));

-- A failing rule must not fail the identity insert.
CREATE TEMP TABLE saved_rule AS
  SELECT pg_get_functiondef('public.resolve_auction_event_identities(uuid, text, text, numeric, text)'::regprocedure) AS def;
CREATE OR REPLACE FUNCTION public.resolve_auction_event_identities(
  p_lot_id uuid, p_source text, p_winning_bidder text, p_winning_bid numeric, p_seller_name text,
  OUT winning_bidder_identity_id uuid, OUT winning_bidder_verdict text, OUT seller_identity_id uuid, OUT seller_verdict text)
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $broken$ BEGIN RAISE EXCEPTION 'the rule failed on purpose'; END $broken$;
DO $$ BEGIN RAISE NOTICE 'EXPECTED WARNING FOLLOWS: the arrival trigger reports a failing rule and lets the insert through'; END $$;
INSERT INTO public.external_identities (platform, handle) VALUES ('bat', 'Failing');
SELECT pg_temp.ok('failure: a rule that raises does not fail the identity insert; the identity exists and the lot stays open',
  EXISTS (SELECT 1 FROM public.external_identities WHERE platform = 'bat' AND handle = 'Failing')
  AND pg_temp.keys('arr-fail') = '-/-');
SELECT def FROM saved_rule \gexec
SELECT pg_temp.ok('failure: the rule is restored and the lot is keyable again, so the next write of its text keys it',
  pg_temp.verdicts('arr-fail') = '-/keyed');
UPDATE public.auction_events SET seller_name = seller_name WHERE lot_number = 'arr-fail';
SELECT pg_temp.ok('failure: the next write of the text keys it (the update trigger is the second chance)', pg_temp.keys('arr-fail') = '-/Failing');

-- Only the key columns changed, anywhere, and no row was touched that was not named.
SELECT pg_temp.ok('only the two key columns changed on any lot, updated_at included',
  NOT EXISTS (SELECT 1 FROM public.auction_events a JOIN lots_pre_arrival b USING (id)
              WHERE to_jsonb(a) - 'winning_bidder_external_identity_id' - 'seller_external_identity_id' - 'page_views' IS DISTINCT FROM b.rest - 'page_views')
  AND (SELECT count(*) FROM public.auction_events a JOIN lots_pre_arrival b USING (id)
       WHERE a.page_views IS DISTINCT FROM (b.rest->>'page_views')::int) = 1);
SELECT pg_temp.ok('no identity was minted, changed or removed by the trigger: 5 at the start, the 320 this script inserted, nothing else',
  (SELECT count(*) FROM public.external_identities) = 5 + 320
  AND NOT EXISTS (SELECT 1 FROM public.external_identities e JOIN identities_initial i USING (id) WHERE e IS DISTINCT FROM i));

-- THE BACKFILL PICKS UP WHAT THE TRIGGER SKIPPED OR CAPPED ---------------------------------------------------------------
SELECT pg_temp.ok('the open keys the rule would fill today are exactly the 20 capped lots, the held lot and the lot whose key the script cleared',
  (SELECT count(*) FROM public.auction_events a
   CROSS JOIN LATERAL public.resolve_auction_event_identities(a.id, a.source, a.winning_bidder, a.winning_bid, a.seller_name) r
   WHERE (a.seller_name IS NOT NULL AND a.seller_external_identity_id IS NULL AND r.seller_verdict = 'keyed')
      OR (a.winning_bidder IS NOT NULL AND a.winning_bidder_external_identity_id IS NULL AND r.winning_bidder_verdict = 'keyed')) = 20 + 1 + 1);
CREATE TEMP TABLE backfill_result AS SELECT public.key_auction_event_identities(2000, 0) AS r;
SELECT pg_temp.ok('the existing backfill keys them: the 20 capped lots, the held lot and the cleared lot, nothing else; the lower-cased lot stays open',
  (SELECT (r->>'keyed')::int = 22 AND (r->>'keyed_seller')::int = 22 AND (r->>'keyed_winning_bidder')::int = 0 FROM backfill_result)
  AND (SELECT count(*) FILTER (WHERE seller_external_identity_id IS NOT NULL) = 120 FROM public.auction_events WHERE lot_number LIKE 'arr-cap-%')
  AND pg_temp.keys('arr-locked') = '-/Locked' AND pg_temp.keys('arr-conflict') = '-/Postgrest' AND pg_temp.keys('arr-case') = '-/-');

-- THE ASSAY: no open key whose verdict is keyed ---------------------------------------------------------------------------
SELECT pg_temp.ok('assay: after the backfill no open key has a keyed verdict; what stays open is stop words, contradicted text, another letter case, another platform and a non-BaT lot',
  (SELECT count(*) FROM public.auction_events a
   CROSS JOIN LATERAL public.resolve_auction_event_identities(a.id, a.source, a.winning_bidder, a.winning_bid, a.seller_name) r
   WHERE a.source IN ('bat', 'bringatrailer')
     AND ((a.seller_name IS NOT NULL AND a.seller_external_identity_id IS NULL AND r.seller_verdict = 'keyed')
       OR (a.winning_bidder IS NOT NULL AND a.winning_bidder_external_identity_id IS NULL AND r.winning_bidder_verdict = 'keyed'))) = 0
  AND (SELECT count(*) FROM public.auction_events
       WHERE lot_number IN ('arr-stop-seller', 'arr-stop-winner', 'arr-contradicted-seller', 'arr-contradicted-winner', 'arr-platform', 'arr-case', 'arr-dealer-nonbat')
         AND seller_external_identity_id IS NULL AND winning_bidder_external_identity_id IS NULL) = 7);

-- RE-APPLYING THE MIGRATION IS A NO-OP -----------------------------------------------------------------------------------
CREATE TEMP TABLE reapply_before AS
  SELECT (SELECT md5(prosrc) FROM pg_proc WHERE proname = 'key_auction_events_on_identity_arrival') AS body,
         (SELECT string_agg(coalesce(write_via, ''), '|' ORDER BY column_name) FROM public.pipeline_registry) AS write_via,
         (SELECT string_agg(coalesce(col_description('public.auction_events'::regclass, a.attnum), ''), '|' ORDER BY a.attnum)
          FROM pg_attribute a WHERE a.attrelid = 'public.auction_events'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS comments,
         (SELECT count(*) FROM pg_class WHERE relname LIKE 'idx_auction_events_open_%') AS indexes,
         pg_temp.state() AS lots_state;
\ir ../migrations/20261007091000_key_lots_on_identity_arrival.sql
SELECT pg_temp.ok('re-applying the migration changes no lot, function, registry row, column comment, index or trigger',
  pg_temp.state() = (SELECT lots_state FROM reapply_before)
  AND (SELECT md5(prosrc) FROM pg_proc WHERE proname = 'key_auction_events_on_identity_arrival') = (SELECT body FROM reapply_before)
  AND (SELECT string_agg(coalesce(write_via, ''), '|' ORDER BY column_name) FROM public.pipeline_registry) = (SELECT write_via FROM reapply_before)
  AND (SELECT string_agg(coalesce(col_description('public.auction_events'::regclass, a.attnum), ''), '|' ORDER BY a.attnum)
       FROM pg_attribute a WHERE a.attrelid = 'public.auction_events'::regclass AND a.attnum > 0 AND NOT a.attisdropped) = (SELECT comments FROM reapply_before)
  AND (SELECT count(*) FROM pg_class WHERE relname LIKE 'idx_auction_events_open_%') = (SELECT indexes FROM reapply_before)
  AND (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_key_auction_events_on_identity_arrival') = 1);

-- A SAME-NAMED INDEX THAT IS SOMETHING ELSE IS REFUSED ---------------------------------------------------------------------
DROP INDEX public.idx_auction_events_open_seller_text;
CREATE INDEX idx_auction_events_open_seller_text ON public.auction_events (seller_name);
DO $$ BEGIN RAISE NOTICE 'EXPECTED ERROR FOLLOWS: the migration refuses an index of the same name that is not the open-key index'; END $$;
\set ON_ERROR_STOP off
\ir ../migrations/20261007091000_key_lots_on_identity_arrival.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('a same-named index that is not the partial open-key index is refused, and the function is as it was',
  (SELECT pg_get_indexdef(c.oid) NOT LIKE '%WHERE%' FROM pg_class c WHERE c.relname = 'idx_auction_events_open_seller_text')
  AND (SELECT md5(prosrc) FROM pg_proc WHERE proname = 'key_auction_events_on_identity_arrival') = (SELECT body FROM reapply_before));

SELECT 'auction_event_identity_keys_on_arrival contract complete' AS result;
