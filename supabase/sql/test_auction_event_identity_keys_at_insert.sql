-- Isolated PostgreSQL 17 contract: a BaT lot's winner and seller are keyed to external_identities by the database, for
-- every lander at once (the triggers 20261006213000 installed on prod 2026-10-06 21:55Z), and the seller is also keyed
-- through the lot's own seller-flagged comment when its text differs from the handle only in letter case
-- (20261007073000_key_lot_seller_by_flagged_comment.sql).
-- Synthetic rows only; never production. Run in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_auction_event_identity_keys_at_insert_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_auction_event_identity_keys_at_insert_ci -f supabase/sql/test_auction_event_identity_keys_at_insert.sql
-- Both migrations are applied, in order, by a non-superuser table owner, as prod's deploy role does (it is not a
-- superuser). Fixture shapes were read from prod 2026-10-07; the rule body 20261006213000 installs is compared with
-- prod's md5, so this contract and prod hold the same function before the second migration replaces it.
-- Sections: the trigger shape; the lander's insert and update; the Lane M rows (lower-cased feed handles) before and
-- after the second migration; the next write of the text, the extract-bat-core upsert and the backfill reach them;
-- re-applying the migration; a drifted function body is refused.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR to_regclass('public.auction_events') IS NOT NULL
     OR to_regclass('public.external_identities') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';
SET TimeZone = 'UTC';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dm_contract_deployer') THEN CREATE ROLE dm_contract_deployer NOLOGIN; END IF;
END $$;
-- Prod's deploy role owns the tables and is not a superuser. The fixture is built, and both migrations applied, as such
-- a role, so a statement only a superuser may run fails here as it would fail on prod (#722, run 37557001434).
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
GRANT SELECT ON public.auction_comments, public.external_identities TO service_role;

-- Identities. 'be' and 'MY' are parser junk (any letter case) that hold identities here, to prove the stop list refuses
-- them. Twin/TWIN and Frank/FRANK are members stored twice under two letter cases, as 983 BaT handles are on prod.
INSERT INTO public.external_identities (platform, handle) VALUES
  ('bat', 'Alice'), ('bat', 'Bob'), ('bat', 'Carol'), ('bat', 'Dave'), ('bat', 'Erin'), ('bat', 'Frank'), ('bat', 'FRANK'),
  ('bat', 'Grace'), ('bat', 'Heidi'), ('bat', 'Ivan'), ('bat', 'Judy'), ('bat', 'be'), ('bat', 'MY'),
  ('bat', 'ExampleCars'), ('bat', 'Keyless'), ('bat', 'Twin'), ('bat', 'TWIN'), ('bat', 'Other'), ('bat', 'Zed'),
  ('cars_and_bids', 'PlatformX'), ('cars_and_bids', 'Alice');

-- THE BASE: 20261006213000, as the deploy role ------------------------------------------------------------------------
\ir ../migrations/20261006213000_key_auction_event_identities.sql

CREATE FUNCTION pg_temp.ident(p_handle text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.external_identities WHERE platform = 'bat' AND handle = p_handle $$;
CREATE FUNCTION pg_temp.lot(p_label text, p_source text, p_outcome text, p_winning_bid numeric, p_winner text, p_seller text)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.auction_events (vehicle_id, source, source_url, lot_number, outcome, winning_bid, high_bid,
                                     winning_bidder, seller_name, raw_data)
  VALUES (gen_random_uuid(), p_source, 'https://bringatrailer.com/listing/' || p_label, p_label, p_outcome,
          p_winning_bid, p_winning_bid, p_winner, p_seller, jsonb_build_object('extractor', 'extract-bat-core')) $$;
-- The handles of the lot's two keys, '-' for NULL: 'Alice/Bob'.
CREATE FUNCTION pg_temp.keys(p_label text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT e.handle FROM public.external_identities e WHERE e.id = a.winning_bidder_external_identity_id), '-')
         || '/' ||
         coalesce((SELECT e.handle FROM public.external_identities e WHERE e.id = a.seller_external_identity_id), '-')
  FROM public.auction_events a WHERE a.lot_number = p_label $$;
-- A comment on the lot by p_author, keyed to the identity with handle p_key (NULL: an unkeyed comment).
CREATE FUNCTION pg_temp.say(p_label text, p_author text, p_is_seller boolean, p_key text, p_bid numeric DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.auction_comments (auction_event_id, vehicle_id, platform, author_username, comment_type, bid_amount,
                                       is_seller, external_identity_id)
  SELECT a.id, a.vehicle_id, 'bat', p_author, CASE WHEN p_bid IS NULL THEN 'comment' ELSE 'bid' END, p_bid, p_is_seller,
         pg_temp.ident(p_key)
  FROM public.auction_events a WHERE a.lot_number = p_label $$;
-- The rule's verdicts for the lot's own text: 'winner/seller', '-' for a NULL text.
CREATE FUNCTION pg_temp.verdicts(p_label text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(r.winning_bidder_verdict, '-') || '/' || coalesce(r.seller_verdict, '-')
  FROM public.auction_events a
  CROSS JOIN LATERAL public.resolve_auction_event_identities(a.id, a.source, a.winning_bidder, a.winning_bid, a.seller_name) r
  WHERE a.lot_number = p_label $$;
CREATE FUNCTION pg_temp.state() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.auction_events t $$;

-- THE TRIGGER SHAPE ----------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('the rule body on file equals the body prod held on 2026-10-07 (md5 starting ff6aeb85191dbfdc, 2,902 characters)',
  (SELECT left(md5(prosrc), 16) = 'ff6aeb85191dbfdc' AND length(prosrc) = 2902 FROM pg_proc
   WHERE oid = 'public.resolve_auction_event_identities(uuid, text, text, numeric, text)'::regprocedure));
SELECT pg_temp.ok('the insert trigger is BEFORE INSERT FOR EACH ROW and enabled, and fires on nothing else',
  (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.auction_events'::regclass AND NOT tgisinternal
     AND tgname = 'trg_key_auction_event_identities_ins' AND tgenabled = 'O'
     AND tgtype = 1 + 2 + 4) = 1);   -- ROW + BEFORE + INSERT
SELECT pg_temp.ok('the update trigger is BEFORE UPDATE OF winning_bidder, seller_name FOR EACH ROW and enabled, and fires on nothing else',
  (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.auction_events'::regclass AND NOT t.tgisinternal
     AND t.tgname = 'trg_key_auction_event_identities_upd' AND t.tgenabled = 'O'
     AND t.tgtype = 1 + 2 + 16      -- ROW + BEFORE + UPDATE
     AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM pg_attribute a
          WHERE a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[])) = ARRAY['seller_name', 'winning_bidder']) = 1);
SELECT pg_temp.ok('the table carries no other trigger in the fixture, so these two are the only writers of the key columns',
  (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.auction_events'::regclass AND NOT tgisinternal) = 2);

-- A LANDER'S INSERT ---------------------------------------------------------------------------------------------------
SELECT pg_temp.lot('ins-both', 'bat', 'sold', 8000, 'Alice', 'Bob');
SELECT pg_temp.ok('insert: a BaT lot whose winner and seller match identities exactly gets both keys', pg_temp.keys('ins-both') = 'Alice/Bob');
SELECT pg_temp.lot('ins-alias', 'bringatrailer', 'sold', 8000, 'Carol', 'Dave');
SELECT pg_temp.ok('insert: the bringatrailer spelling of the source is BaT', pg_temp.keys('ins-alias') = 'Carol/Dave');
SELECT pg_temp.lot('ins-other-platform', 'cars_and_bids', 'sold', 8000, 'Alice', 'Bob');
SELECT pg_temp.ok('insert: a lot of another platform gets no key although its text names BaT identities', pg_temp.keys('ins-other-platform') = '-/-');
RESET ROLE;
SET ROLE service_role;
INSERT INTO public.auction_events (vehicle_id, source, source_url, lot_number, outcome, winning_bid, winning_bidder, seller_name)
VALUES (gen_random_uuid(), 'bat', 'https://bringatrailer.com/listing/ins-service-role', 'ins-service-role', 'sold', 8000, 'Grace', 'Heidi');
RESET ROLE;
SET ROLE dm_contract_deployer;
SELECT pg_temp.ok('insert: the lander''s own database role, which cannot execute the trigger function, is keyed all the same',
  NOT has_function_privilege('service_role', 'public.key_auction_event_identities_on_write()', 'EXECUTE')
  AND pg_temp.keys('ins-service-role') = 'Grace/Heidi');
INSERT INTO public.auction_events (vehicle_id, source, source_url, lot_number, outcome, winning_bid, winning_bidder, seller_name,
                                   winning_bidder_external_identity_id)
VALUES (gen_random_uuid(), 'bat', 'https://bringatrailer.com/listing/ins-writer-key', 'ins-writer-key', 'sold', 8000, 'Alice', 'Bob',
        pg_temp.ident('Frank'));
SELECT pg_temp.ok('insert: a key the writer passed is never overwritten; the other key is still filled', pg_temp.keys('ins-writer-key') = 'Frank/Bob');
SELECT pg_temp.lot('ins-stopword', 'bat', 'sold', 8000, 'be', 'My');
SELECT pg_temp.ok('insert: a stop word stays NULL where an identity holds it (be) and where another letter case does (MY)',
  pg_temp.keys('ins-stopword') = '-/-');
SELECT pg_temp.lot('ins-unknown', 'bat', 'sold', 8000, 'Nobody', '   ');
SELECT pg_temp.ok('insert: an unknown handle and a blank text stay NULL, and the insert itself succeeds',
  pg_temp.keys('ins-unknown') = '-/-' AND (SELECT count(*) FROM public.auction_events WHERE lot_number = 'ins-unknown') = 1);
SELECT pg_temp.lot('ins-no-text', 'bat', 'reserve_not_met', NULL, NULL, NULL);
SELECT pg_temp.ok('insert: a lot with no text gets no key', pg_temp.keys('ins-no-text') = '-/-');
-- extract-bat-core writes the lot row first and the comments that mint the seller's identity after it.
SELECT pg_temp.lot('ins-late-identity', 'bat', 'reserve_not_met', NULL, NULL, 'Latecomer');
SELECT pg_temp.ok('insert: a seller whose identity does not exist yet is left NULL, never minted',
  pg_temp.keys('ins-late-identity') = '-/-' AND NOT EXISTS (SELECT 1 FROM public.external_identities WHERE handle = 'Latecomer'));

-- A LANDER'S UPDATE ----------------------------------------------------------------------------------------------------
INSERT INTO public.external_identities (platform, handle) VALUES ('bat', 'Latecomer');
UPDATE public.auction_events SET comments_count = 4, page_views = 10 WHERE lot_number = 'ins-late-identity';
SELECT pg_temp.ok('update: a write that does not name the text columns does not fire the key trigger; the open key stays open',
  pg_temp.keys('ins-late-identity') = '-/-');
UPDATE public.auction_events SET seller_name = seller_name WHERE lot_number = 'ins-late-identity';
SELECT pg_temp.ok('update: a write that names the text columns keys an open key once the identity exists', pg_temp.keys('ins-late-identity') = '-/Latecomer');
UPDATE public.auction_events SET seller_name = 'Carol' WHERE lot_number = 'ins-both';
SELECT pg_temp.ok('update: a changed text is keyed again; the key follows the text', pg_temp.keys('ins-both') = 'Alice/Carol');
UPDATE public.auction_events SET winning_bidder = winning_bidder, seller_name = seller_name WHERE lot_number = 'ins-writer-key';
SELECT pg_temp.ok('update: a set key whose text is unchanged is never overwritten (the writer''s Frank is not replaced by Alice)',
  pg_temp.keys('ins-writer-key') = 'Frank/Bob');
UPDATE public.auction_events SET seller_name = 'be' WHERE lot_number = 'ins-both';
SELECT pg_temp.ok('update: a text changed to a stop word leaves no key behind', pg_temp.keys('ins-both') = 'Alice/-');
-- A lot read live, then upserted at close (extract-bat-core: ON CONFLICT (vehicle_id, source_url)).
INSERT INTO public.auction_events (vehicle_id, source, source_url, lot_number, outcome, seller_name)
VALUES ('00000000-0000-4000-8000-000000000001', 'bat', 'https://bringatrailer.com/listing/upsert-close', 'upsert-close', 'live', 'Judy');
SELECT pg_temp.ok('insert: a live row is keyed to its seller, with no winner yet', pg_temp.keys('upsert-close') = '-/Judy');
INSERT INTO public.auction_events (vehicle_id, source, source_url, lot_number, outcome, winning_bid, high_bid, winning_bidder, seller_name)
VALUES ('00000000-0000-4000-8000-000000000001', 'bat', 'https://bringatrailer.com/listing/upsert-close', 'upsert-close', 'sold', 12000, 12000, 'Grace', 'Judy')
ON CONFLICT (vehicle_id, source_url) DO UPDATE SET
  outcome = EXCLUDED.outcome, winning_bid = EXCLUDED.winning_bid, high_bid = EXCLUDED.high_bid,
  winning_bidder = EXCLUDED.winning_bidder, seller_name = EXCLUDED.seller_name, updated_at = now();
SELECT pg_temp.ok('upsert: the closing read keys the winner on the update path and keeps the seller key; one row',
  pg_temp.keys('upsert-close') = 'Grace/Judy' AND (SELECT count(*) FROM public.auction_events WHERE lot_number = 'upsert-close') = 1);
-- Contradicted: the lot's own bids say another handle paid the sale price.
SELECT pg_temp.lot('upd-contradicted', 'bat', 'reserve_not_met', NULL, NULL, 'Judy');
SELECT pg_temp.say('upd-contradicted', 'Erin', false, 'Erin', 30000);
UPDATE public.auction_events SET outcome = 'sold', winning_bid = 30000, winning_bidder = 'Alice' WHERE lot_number = 'upd-contradicted';
SELECT pg_temp.ok('update: a winner text that the lot''s own bids contradict stays NULL; the seller key set at insert stays',
  pg_temp.keys('upd-contradicted') = '-/Judy' AND pg_temp.verdicts('upd-contradicted') = 'contradicted/keyed');
-- A seller BaT flags to another handle: the text is refused at its first keying (a first name, not the handle).
SELECT pg_temp.lot('upd-seller-contradicted', 'bat', 'reserve_not_met', NULL, NULL, 'Ivan');
SELECT pg_temp.say('upd-seller-contradicted', 'Judy', true, 'Judy');
UPDATE public.auction_events SET seller_name = 'Ivan', seller_external_identity_id = NULL, page_views = 1 WHERE lot_number = 'upd-seller-contradicted';
SELECT pg_temp.ok('update: the seller text that the lot''s flag contradicts stays NULL when the key is derived again',
  pg_temp.verdicts('upd-seller-contradicted') = '-/contradicted');

-- THE LANE M ROWS, BEFORE THE SECOND MIGRATION ---------------------------------------------------------------------
-- create_missing_bat_auction_events copied bat_listings.seller_username, the feed's lower-cased slug: 'examplecars' for the
-- member BaT shows as 'ExampleCars'. Each lot is inserted first (no comments can reference it yet), its comments after.
SELECT pg_temp.lot('fb-positive', 'bat', 'sold', 9000, NULL, 'examplecars');
SELECT pg_temp.say('fb-positive', 'ExampleCars', true, 'ExampleCars');
SELECT pg_temp.lot('fb-twice', 'bat', 'sold', 9000, NULL, 'EXAMPLECARS');
SELECT pg_temp.say('fb-twice', 'ExampleCars', true, 'ExampleCars');
SELECT pg_temp.say('fb-twice', 'ExampleCars', true, 'ExampleCars');
INSERT INTO public.auction_events (vehicle_id, source, source_url, lot_number, outcome, winning_bid, seller_name)
VALUES ('00000000-0000-4000-8000-000000000002', 'bat', 'https://bringatrailer.com/listing/fb-upsert', 'fb-upsert', 'sold', 9000, 'examplecars');
SELECT pg_temp.say('fb-upsert', 'ExampleCars', true, 'ExampleCars');
SELECT pg_temp.lot('fb-backfill-a', 'bat', 'sold', 9000, NULL, 'examplecars');
SELECT pg_temp.say('fb-backfill-a', 'ExampleCars', true, 'ExampleCars');
SELECT pg_temp.lot('fb-backfill-b', 'bat', 'sold', 9000, NULL, 'examplecars');
SELECT pg_temp.say('fb-backfill-b', 'ExampleCars', true, 'ExampleCars');
-- None of these may key:
SELECT pg_temp.lot('fb-not-flagged', 'bat', 'sold', 9000, NULL, 'examplecars');
SELECT pg_temp.say('fb-not-flagged', 'ExampleCars', false, 'ExampleCars');                  -- a comment by the member, not flagged
SELECT pg_temp.lot('fb-other-handle', 'bat', 'sold', 9000, NULL, 'ghost');
SELECT pg_temp.say('fb-other-handle', 'Zed', true, 'Zed');                               -- BaT flags another handle as the seller
SELECT pg_temp.lot('fb-no-key', 'bat', 'sold', 9000, NULL, 'keyless');
SELECT pg_temp.say('fb-no-key', 'Keyless', true, NULL);                                  -- the flagged comment carries no author key
SELECT pg_temp.lot('fb-twin', 'bat', 'sold', 9000, NULL, 'twin');
SELECT pg_temp.say('fb-twin', 'Twin', true, 'Twin');                                     -- two identities differ only in case
SELECT pg_temp.say('fb-twin', 'TWIN', true, 'TWIN');
SELECT pg_temp.lot('fb-handle-differs', 'bat', 'sold', 9000, NULL, 'mismatch');
SELECT pg_temp.say('fb-handle-differs', 'mismatch', true, 'Other');                      -- the comment's key is another member
SELECT pg_temp.lot('fb-wrong-platform', 'bat', 'sold', 9000, NULL, 'platformx');
INSERT INTO public.auction_comments (auction_event_id, vehicle_id, platform, author_username, comment_type, is_seller, external_identity_id)
SELECT a.id, a.vehicle_id, 'bat', 'PlatformX', 'comment', true,
       (SELECT e.id FROM public.external_identities e WHERE e.platform = 'cars_and_bids' AND e.handle = 'PlatformX')
FROM public.auction_events a WHERE a.lot_number = 'fb-wrong-platform';                  -- an identity of another platform
SELECT pg_temp.lot('fb-stop-word', 'bat', 'sold', 9000, NULL, 'My');
SELECT pg_temp.say('fb-stop-word', 'MY', true, 'MY');
SELECT pg_temp.lot('fb-non-bat', 'cars_and_bids', 'sold', 9000, NULL, 'examplecars');
SELECT pg_temp.say('fb-non-bat', 'ExampleCars', true, 'ExampleCars');
SELECT pg_temp.lot('fb-text-differs', 'bat', 'sold', 9000, NULL, 'examplecars');
SELECT pg_temp.say('fb-text-differs', 'Examplecarz', true, 'ExampleCars');                   -- comment text and its key disagree
SELECT pg_temp.lot('fb-winner-lower', 'bat', 'sold', 5000, 'alice', NULL);
SELECT pg_temp.say('fb-winner-lower', 'Alice', false, 'Alice', 5000);                    -- the winner has no such fallback
SELECT pg_temp.lot('fb-both', 'bat', 'sold', 5000, 'Dave', 'examplecars');
SELECT pg_temp.say('fb-both', 'ExampleCars', true, 'ExampleCars');
SELECT pg_temp.lot('fb-exact-wins', 'bat', 'sold', 5000, NULL, 'Frank');
SELECT pg_temp.say('fb-exact-wins', 'FRANK', true, 'FRANK');

SELECT pg_temp.ok('before: at insert the lower-cased rows are NULL (their lot had no comments, and no identity holds the exact text)',
  pg_temp.keys('fb-positive') = '-/-' AND pg_temp.keys('fb-twice') = '-/-' AND pg_temp.keys('fb-upsert') = '-/-'
  AND pg_temp.keys('fb-backfill-a') = '-/-' AND pg_temp.keys('fb-both') = 'Dave/-');
SELECT pg_temp.ok('before: the base rule calls every lower-cased seller no_identity',
  pg_temp.verdicts('fb-positive') = '-/no_identity' AND pg_temp.verdicts('fb-twice') = '-/no_identity'
  AND pg_temp.verdicts('fb-backfill-a') = '-/no_identity' AND pg_temp.verdicts('fb-both') = 'keyed/no_identity');

CREATE TEMP TABLE lots_before AS SELECT * FROM public.auction_events;
CREATE TEMP TABLE identities_before AS SELECT * FROM public.external_identities;
CREATE TEMP TABLE comments_before AS SELECT * FROM public.auction_comments;
CREATE TEMP TABLE shape_before AS
  SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind IN ('r', 'i', 'v', 'm', 'S')) AS relations,
         (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.auction_events'::regclass AND attnum > 0 AND NOT attisdropped) AS lot_columns,
         (SELECT string_agg(p.proname || ':' || md5(p.prosrc), ',' ORDER BY p.proname) FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace AND p.proname <> 'resolve_auction_event_identities') AS other_functions,
         (SELECT string_agg(tgname || ':' || pg_get_triggerdef(oid), '|' ORDER BY tgname) FROM pg_trigger
          WHERE tgrelid = 'public.auction_events'::regclass AND NOT tgisinternal) AS triggers,
         (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) AS functions,
         (SELECT string_agg(conname || ':' || pg_get_constraintdef(oid), '|' ORDER BY conname) FROM pg_constraint
          WHERE conrelid = 'public.auction_events'::regclass) AS constraints,
         (SELECT count(*) FROM public.schema_proposals) AS proposals,
         (SELECT count(*) FROM public.pipeline_registry) AS registry_rows,
         pg_temp.state() AS lots_state;

-- THE SECOND MIGRATION -------------------------------------------------------------------------------------------------
\ir ../migrations/20261007073000_key_lot_seller_by_flagged_comment.sql

SELECT pg_temp.ok('the migration changes no lot, identity or comment row',
  pg_temp.state() = (SELECT lots_state FROM shape_before)
  AND NOT EXISTS (SELECT 1 FROM public.external_identities e FULL JOIN identities_before b USING (id) WHERE e IS DISTINCT FROM b)
  AND (SELECT count(*) FROM public.auction_comments) = (SELECT count(*) FROM comments_before));
SELECT pg_temp.ok('the migration adds no table, index, view, column, function, trigger, constraint or proposal',
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'i', 'v', 'm', 'S')) = (SELECT relations FROM shape_before)
  AND (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.auction_events'::regclass AND attnum > 0 AND NOT attisdropped) = (SELECT lot_columns FROM shape_before)
  AND (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) = (SELECT functions FROM shape_before)
  AND (SELECT string_agg(tgname || ':' || pg_get_triggerdef(oid), '|' ORDER BY tgname) FROM pg_trigger
       WHERE tgrelid = 'public.auction_events'::regclass AND NOT tgisinternal) = (SELECT triggers FROM shape_before)
  AND (SELECT string_agg(conname || ':' || pg_get_constraintdef(oid), '|' ORDER BY conname) FROM pg_constraint
       WHERE conrelid = 'public.auction_events'::regclass) = (SELECT constraints FROM shape_before)
  AND (SELECT count(*) FROM public.schema_proposals) = (SELECT proposals FROM shape_before)
  AND (SELECT count(*) FROM public.pipeline_registry) = (SELECT registry_rows FROM shape_before));
SELECT pg_temp.ok('the other keying functions are untouched',
  (SELECT string_agg(p.proname || ':' || md5(p.prosrc), ',' ORDER BY p.proname) FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname <> 'resolve_auction_event_identities') = (SELECT other_functions FROM shape_before));
SELECT pg_temp.ok('the rule keeps its signature, OUT columns, volatility, search_path, owner and grants',
  (SELECT p.proargnames = ARRAY['p_lot_id', 'p_source', 'p_winning_bidder', 'p_winning_bid', 'p_seller_name',
                                'winning_bidder_identity_id', 'winning_bidder_verdict', 'seller_identity_id', 'seller_verdict']
          AND p.proargmodes = ARRAY['i', 'i', 'i', 'i', 'i', 'o', 'o', 'o', 'o']::"char"[]
          AND p.provolatile = 's' AND NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp']
          AND pg_get_userbyid(p.proowner) = 'dm_contract_deployer'
   FROM pg_proc p WHERE p.oid = 'public.resolve_auction_event_identities(uuid, text, text, numeric, text)'::regprocedure)
  AND NOT has_function_privilege('anon', 'public.resolve_auction_event_identities(uuid, text, text, numeric, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.resolve_auction_event_identities(uuid, text, text, numeric, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.resolve_auction_event_identities(uuid, text, text, numeric, text)', 'EXECUTE'));
SELECT pg_temp.ok('the registry row and the column comment name the fallback once; the winner key''s comment is untouched',
  (SELECT count(*) FROM public.pipeline_registry WHERE table_name = 'auction_events' AND column_name = 'seller_external_identity_id'
     AND description LIKE '%flags as the seller%' AND (length(description) - length(replace(description, 'flags as the seller', ''))) = length('flags as the seller')) = 1
  AND (SELECT count(*) FROM public.pipeline_registry WHERE table_name = 'auction_events' AND description LIKE '%flags as the seller%') = 1
  AND (SELECT length(d) - length(replace(d, 'flags as the seller', '')) = length('flags as the seller')
       FROM (SELECT col_description('public.auction_events'::regclass, a.attnum) AS d FROM pg_attribute a
             WHERE a.attrelid = 'public.auction_events'::regclass AND a.attname = 'seller_external_identity_id') x)
  AND (SELECT col_description('public.auction_events'::regclass, a.attnum) NOT LIKE '%flags as the seller%' FROM pg_attribute a
       WHERE a.attrelid = 'public.auction_events'::regclass AND a.attname = 'winning_bidder_external_identity_id'));
SELECT pg_temp.ok('the rule''s comment states the fallback and the verdicts',
  obj_description('public.resolve_auction_event_identities(uuid, text, text, numeric, text)'::regprocedure, 'pg_proc') LIKE '%Seller fallback%'
  AND obj_description('public.resolve_auction_event_identities(uuid, text, text, numeric, text)'::regprocedure, 'pg_proc') LIKE '%contradicted%');

-- THE RULE AFTER THE SECOND MIGRATION ----------------------------------------------------------------------------------
SELECT pg_temp.ok('rule: a lower-cased seller is keyed through the lot''s seller-flagged comment, in any letter case of the text',
  pg_temp.verdicts('fb-positive') = '-/keyed' AND pg_temp.verdicts('fb-twice') = '-/keyed'
  AND pg_temp.verdicts('fb-upsert') = '-/keyed' AND pg_temp.verdicts('fb-backfill-a') = '-/keyed');
SELECT pg_temp.ok('rule: the identity is the flagged comment''s author key, and two comments naming it twice are one identity',
  (SELECT r.seller_identity_id = pg_temp.ident('ExampleCars')
   FROM public.auction_events a CROSS JOIN LATERAL public.resolve_auction_event_identities(a.id, a.source, a.winning_bidder, a.winning_bid, a.seller_name) r
   WHERE a.lot_number = 'fb-twice'));
SELECT pg_temp.ok('rule: a comment that BaT does not flag as the seller''s does not key', pg_temp.verdicts('fb-not-flagged') = '-/no_identity');
SELECT pg_temp.ok('rule: a flag on another handle does not key', pg_temp.verdicts('fb-other-handle') = '-/no_identity');
SELECT pg_temp.ok('rule: a flagged comment with no author key does not key', pg_temp.verdicts('fb-no-key') = '-/no_identity');
SELECT pg_temp.ok('rule: flagged comments naming two identities (Twin, TWIN) do not key', pg_temp.verdicts('fb-twin') = '-/no_identity');
SELECT pg_temp.ok('rule: a flagged comment whose author key is a member with another handle does not key', pg_temp.verdicts('fb-handle-differs') = '-/no_identity');
SELECT pg_temp.ok('rule: an identity of another platform does not key', pg_temp.verdicts('fb-wrong-platform') = '-/no_identity');
SELECT pg_temp.ok('rule: a stop word is refused before any lookup, even with a flagged comment by an identity holding it', pg_temp.verdicts('fb-stop-word') = '-/stop_word');
SELECT pg_temp.ok('rule: a non-BaT lot is refused before any lookup', pg_temp.verdicts('fb-non-bat') = '-/not_bat');
SELECT pg_temp.ok('rule: the contradiction check still runs after the fallback (the comment text names another handle)', pg_temp.verdicts('fb-text-differs') = '-/contradicted');
SELECT pg_temp.ok('rule: the winner has no fallback; a lower-cased winner stays no_identity beside a bid by the identity', pg_temp.verdicts('fb-winner-lower') = 'no_identity/-');
SELECT pg_temp.ok('rule: both texts resolve in one call, the winner exactly and the seller through the fallback', pg_temp.verdicts('fb-both') = 'keyed/keyed');
SELECT pg_temp.ok('rule: an exact identity wins over the fallback (Frank, not the FRANK that the flagged comment carries)',
  (SELECT r.seller_identity_id = pg_temp.ident('Frank') AND r.seller_verdict = 'keyed'
   FROM public.auction_events a CROSS JOIN LATERAL public.resolve_auction_event_identities(a.id, a.source, a.winning_bidder, a.winning_bid, a.seller_name) r
   WHERE a.lot_number = 'fb-exact-wins'));
SELECT pg_temp.ok('rule: only the verdicts it always had are returned, for every lot of the fixture',
  NOT EXISTS (SELECT 1 FROM public.auction_events a
              CROSS JOIN LATERAL public.resolve_auction_event_identities(a.id, a.source, a.winning_bidder, a.winning_bid, a.seller_name) r
              WHERE r.winning_bidder_verdict IS NOT NULL AND r.winning_bidder_verdict NOT IN ('keyed', 'not_bat', 'blank', 'stop_word', 'no_identity', 'contradicted')
                 OR r.seller_verdict IS NOT NULL AND r.seller_verdict NOT IN ('keyed', 'not_bat', 'blank', 'stop_word', 'no_identity', 'contradicted')));
SELECT pg_temp.ok('rule: the exact-case behaviour of the base is unchanged for the lots the base keyed or refused at insert',
  pg_temp.verdicts('ins-stopword') = 'stop_word/stop_word' AND pg_temp.verdicts('ins-unknown') = 'no_identity/blank'
  AND pg_temp.verdicts('ins-other-platform') = 'not_bat/not_bat' AND pg_temp.verdicts('ins-no-text') = '-/-'
  AND pg_temp.verdicts('upd-contradicted') = 'contradicted/keyed' AND pg_temp.verdicts('upd-seller-contradicted') = '-/contradicted');

-- THE NEXT WRITE OF THE TEXT REACHES THEM ------------------------------------------------------------------------------
UPDATE public.auction_events SET seller_name = seller_name WHERE lot_number = 'fb-positive';
SELECT pg_temp.ok('update: the lot''s next write of its text keys the lower-cased seller', pg_temp.keys('fb-positive') = '-/ExampleCars');
INSERT INTO public.auction_events (vehicle_id, source, source_url, lot_number, outcome, winning_bid, high_bid, seller_name, winning_bidder)
VALUES ('00000000-0000-4000-8000-000000000002', 'bat', 'https://bringatrailer.com/listing/fb-upsert', 'fb-upsert', 'sold', 9000, 9000, 'examplecars', 'Erin')
ON CONFLICT (vehicle_id, source_url) DO UPDATE SET
  winning_bid = EXCLUDED.winning_bid, high_bid = EXCLUDED.high_bid,
  winning_bidder = EXCLUDED.winning_bidder, seller_name = EXCLUDED.seller_name, updated_at = now();
SELECT pg_temp.ok('upsert: the extract-bat-core re-read keys the lower-cased seller on the update path, and the winner by the way; one row',
  pg_temp.keys('fb-upsert') = 'Erin/ExampleCars' AND (SELECT count(*) FROM public.auction_events WHERE lot_number = 'fb-upsert') = 1);
UPDATE public.auction_events SET seller_name = seller_name, winning_bidder = winning_bidder
WHERE lot_number IN ('fb-not-flagged', 'fb-other-handle', 'fb-no-key', 'fb-twin', 'fb-handle-differs', 'fb-wrong-platform', 'fb-stop-word',
                     'fb-non-bat', 'fb-text-differs', 'fb-winner-lower');
SELECT pg_temp.ok('update: a write of the text keys none of the rows the rule refuses',
  pg_temp.keys('fb-not-flagged') = '-/-' AND pg_temp.keys('fb-other-handle') = '-/-' AND pg_temp.keys('fb-no-key') = '-/-'
  AND pg_temp.keys('fb-twin') = '-/-' AND pg_temp.keys('fb-handle-differs') = '-/-' AND pg_temp.keys('fb-wrong-platform') = '-/-'
  AND pg_temp.keys('fb-stop-word') = '-/-' AND pg_temp.keys('fb-non-bat') = '-/-' AND pg_temp.keys('fb-text-differs') = '-/-'
  AND pg_temp.keys('fb-winner-lower') = '-/-');
UPDATE public.auction_events SET page_views = 3 WHERE lot_number = 'fb-backfill-b';
SELECT pg_temp.ok('update: a write that does not name the text leaves the open key open (the backfill is what reaches it)',
  pg_temp.keys('fb-backfill-b') = '-/-');

-- THE BACKFILL REACHES THE REST -----------------------------------------------------------------------------------------
CREATE TEMP TABLE keys_before_backfill AS
  SELECT id, lot_number, winning_bidder_external_identity_id AS wk, seller_external_identity_id AS sk FROM public.auction_events;
CREATE TEMP TABLE backfill_result AS SELECT public.key_auction_event_identities(2000, 0) AS r;
SELECT pg_temp.ok('backfill: it keys the four lower-cased sellers still open, no winner, one receipt for the call',
  (SELECT (r->>'keyed')::int = 4 AND (r->>'keyed_seller')::int = 4 AND (r->>'keyed_winning_bidder')::int = 0 AND (r->>'done')::boolean FROM backfill_result)
  AND (SELECT count(*) FROM public.write_receipts WHERE writer = 'key-auction-event-identities' AND tbl = 'auction_events' AND rows = 4) = 1);
SELECT pg_temp.ok('backfill: the four keyed rows are the open lower-cased lots, each to the flagged comment''s identity; a winner key beside one is kept',
  pg_temp.keys('fb-twice') = '-/ExampleCars' AND pg_temp.keys('fb-backfill-a') = '-/ExampleCars' AND pg_temp.keys('fb-backfill-b') = '-/ExampleCars'
  AND pg_temp.keys('fb-both') = 'Dave/ExampleCars');
SELECT pg_temp.ok('backfill: no other key changed, and no key already set was touched',
  NOT EXISTS (SELECT 1 FROM public.auction_events a JOIN keys_before_backfill k USING (id)
              WHERE (a.winning_bidder_external_identity_id IS DISTINCT FROM k.wk OR a.seller_external_identity_id IS DISTINCT FROM k.sk)
                AND k.lot_number NOT IN ('fb-twice', 'fb-backfill-a', 'fb-backfill-b', 'fb-both')));
-- What stays open, by reason, over the whole fixture (BaT lots only):
--   seller no_identity 6: fb-not-flagged, fb-other-handle, fb-no-key, fb-twin, fb-handle-differs, fb-wrong-platform
--   seller stop_word 3: ins-stopword, fb-stop-word, ins-both (text changed to 'be');  blank 1: ins-unknown;
--   seller contradicted 2: upd-seller-contradicted, fb-text-differs;
--   winner no_identity 2: ins-unknown (Nobody), fb-winner-lower; stop_word 1: ins-stopword (be); contradicted 1: upd-contradicted.
SELECT pg_temp.ok('backfill: it reports what stays open by reason, each reason once per row',
  (SELECT (r->>'seller_no_identity')::int = 6 AND (r->>'seller_stop_word')::int = 3 AND (r->>'seller_blank')::int = 1
          AND (r->>'seller_contradicted')::int = 2 AND (r->>'winning_bidder_no_identity')::int = 2
          AND (r->>'winning_bidder_stop_word')::int = 1 AND (r->>'winning_bidder_contradicted')::int = 1
          AND (r->>'winning_bidder_blank')::int = 0 FROM backfill_result));
CREATE TEMP TABLE backfill_result_2 AS SELECT public.key_auction_event_identities(2000, 0) AS r;
SELECT pg_temp.ok('backfill: a second pass keys nothing and writes no receipt',
  (SELECT (r->>'keyed')::int = 0 FROM backfill_result_2)
  AND (SELECT count(*) FROM public.write_receipts WHERE writer = 'key-auction-event-identities') = 1);
SELECT pg_temp.ok('no identity was minted or changed by the rule, the triggers or the backfill',
  (SELECT count(*) FROM public.external_identities) = (SELECT count(*) FROM identities_before)
  AND NOT EXISTS (SELECT 1 FROM public.external_identities e FULL JOIN identities_before b USING (id) WHERE e IS DISTINCT FROM b));

-- RE-APPLYING THE MIGRATION IS A NO-OP -----------------------------------------------------------------------------------
CREATE TEMP TABLE reapply_before AS
  SELECT md5(prosrc) AS body, (SELECT string_agg(description, '|' ORDER BY id) FROM public.pipeline_registry) AS registry,
         (SELECT string_agg(coalesce(col_description('public.auction_events'::regclass, a.attnum), ''), '|' ORDER BY a.attnum)
          FROM pg_attribute a WHERE a.attrelid = 'public.auction_events'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS comments
  FROM pg_proc WHERE oid = 'public.resolve_auction_event_identities(uuid, text, text, numeric, text)'::regprocedure;
\ir ../migrations/20261007073000_key_lot_seller_by_flagged_comment.sql
SELECT pg_temp.ok('re-applying the migration changes neither the function, the registry nor a column comment',
  (SELECT left(md5(prosrc), 16) = '0938e28889802dfc' AND md5(prosrc) = (SELECT body FROM reapply_before)
   FROM pg_proc WHERE oid = 'public.resolve_auction_event_identities(uuid, text, text, numeric, text)'::regprocedure)
  AND (SELECT string_agg(description, '|' ORDER BY id) FROM public.pipeline_registry) = (SELECT registry FROM reapply_before)
  AND (SELECT string_agg(coalesce(col_description('public.auction_events'::regclass, a.attnum), ''), '|' ORDER BY a.attnum)
       FROM pg_attribute a WHERE a.attrelid = 'public.auction_events'::regclass AND a.attnum > 0 AND NOT a.attisdropped) = (SELECT comments FROM reapply_before));

-- A DRIFTED BODY IS REFUSED -------------------------------------------------------------------------------------------
-- Someone else's change to the rule since 2026-10-07 must not be overwritten. The migration is run once more with the
-- function replaced by another body; the error it raises is the expected one, and nothing it would have written lands.
CREATE OR REPLACE FUNCTION public.resolve_auction_event_identities(
  p_lot_id uuid, p_source text, p_winning_bidder text, p_winning_bid numeric, p_seller_name text,
  OUT winning_bidder_identity_id uuid, OUT winning_bidder_verdict text, OUT seller_identity_id uuid, OUT seller_verdict text)
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $drift$ BEGIN seller_verdict := 'drifted'; END $drift$;
UPDATE public.pipeline_registry SET description = description || ' [marker]'
WHERE table_name = 'auction_events' AND column_name = 'seller_external_identity_id';
DO $$ BEGIN RAISE NOTICE 'EXPECTED ERROR FOLLOWS: the migration refuses a drifted function body'; END $$;
\set ON_ERROR_STOP off
\ir ../migrations/20261007073000_key_lot_seller_by_flagged_comment.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('a drifted function body is refused: it is still the other body, and the migration wrote nothing',
  (SELECT left(md5(prosrc), 16) NOT IN ('ff6aeb85191dbfdc', '0938e28889802dfc') AND prosrc LIKE '%drifted%'
   FROM pg_proc WHERE oid = 'public.resolve_auction_event_identities(uuid, text, text, numeric, text)'::regprocedure)
  AND (SELECT description LIKE '% [marker]' FROM public.pipeline_registry
       WHERE table_name = 'auction_events' AND column_name = 'seller_external_identity_id'));

SELECT 'auction_event_identity_keys_at_insert contract complete' AS result;
