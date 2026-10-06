-- Isolated PostgreSQL 17 contract for 20261006213000_key_auction_event_identities.sql.
-- Synthetic rows only; never production. Run in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_auction_event_identity_keys_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_auction_event_identity_keys_ci -f supabase/sql/test_auction_event_identity_keys.sql
-- Fixtures: preserve_bat_live_projection() and its trigger are the live definitions; schema_proposals, pipeline_registry
-- and write_receipts carry the live columns and constraints (all read from prod 2026-10-06 21:20Z).
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

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

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
  bid_amount numeric, is_seller boolean, posted_at timestamptz DEFAULT now(), comment_text text
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
INSERT INTO public.schema_proposals (proposed_by_agent_key, proposal_type, payload)
VALUES ('earlier-agent', 'add_source', '{"slug": "earlier"}');

-- The live BEFORE UPDATE trigger on auction_events (body as on prod).
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

GRANT SELECT, INSERT, UPDATE ON public.auction_events TO service_role;

-- Identities. 'be' is parser junk that holds an identity here, to prove the stop list refuses it anyway.
INSERT INTO public.external_identities (platform, handle) VALUES
  ('bat', 'Alice'), ('bat', 'Bob'), ('bat', 'Carol'), ('bat', 'Dave'), ('bat', 'Erin'), ('bat', 'Frank'),
  ('bat', 'Grace'), ('bat', 'Heidi'), ('bat', 'Ivan'), ('bat', 'Judy'), ('bat', 'Mallory'), ('bat', 'be'),
  ('cars_and_bids', 'Alice');
CREATE TEMP TABLE ident AS SELECT handle, id FROM public.external_identities WHERE platform = 'bat';

-- The backfill population, written before the migration (no key columns, no key trigger yet). 1 KB of raw_data per
-- row spreads it over a few hundred heap blocks, so the block cursor is exercised.
CREATE FUNCTION pg_temp.lot(p_label text, p_source text, p_outcome text, p_winning_bid numeric, p_winner text,
                            p_seller text, p_raw jsonb DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.auction_events (vehicle_id, source, source_url, lot_number, outcome, winning_bid, high_bid,
                                     winning_bidder, seller_name, raw_data)
  VALUES (gen_random_uuid(), p_source, 'https://bringatrailer.com/listing/' || p_label, p_label, p_outcome,
          p_winning_bid, p_winning_bid, p_winner, p_seller,
          coalesce(p_raw, jsonb_build_object('extractor', 'extract-bat-core', 'pad', repeat('x', 1000))));
$$;

-- First straddling row: lands in heap block 0.
SELECT pg_temp.lot('straddle-first', 'bat', 'sold', 10000, 'Alice', 'Bob');
--   g%4 = 0: winner Alice, seller Bob                 -> both keyed
--   g%4 = 1: winner with no identity, seller Carol    -> winner no_identity, seller keyed
--   g%4 = 2: a mecum lot naming Alice and Bob         -> never keyed (not BaT)
--   g%4 = 3: no winner, seller 'be' (junk)            -> seller stop_word
INSERT INTO public.auction_events (vehicle_id, source, source_url, lot_number, outcome, winning_bid, winning_bidder,
                                   seller_name, raw_data)
SELECT gen_random_uuid(),
       CASE WHEN g % 4 = 2 THEN 'mecum' ELSE 'bat' END,
       'https://bringatrailer.com/listing/filler-' || g, 'filler-' || (g % 4),
       CASE WHEN g % 4 = 3 THEN 'reserve_not_met' ELSE 'sold' END,
       CASE WHEN g % 4 = 3 THEN NULL ELSE 1000 + g END,
       CASE g % 4 WHEN 0 THEN 'Alice' WHEN 1 THEN 'nobody_here' WHEN 2 THEN 'Alice' ELSE NULL END,
       CASE g % 4 WHEN 0 THEN 'Bob' WHEN 1 THEN 'Carol' WHEN 2 THEN 'Bob' ELSE 'be' END,
       jsonb_build_object('extractor', 'extract-bat-core', 'pad', repeat('x', 1000))
FROM generate_series(1, 2400) g;

SELECT pg_temp.lot('winner-contradicted', 'bat', 'sold', 50000, 'Dave', 'Mallory');
SELECT pg_temp.lot('winner-partial', 'bat', 'sold', 60000, 'Dave', 'Mallory');
SELECT pg_temp.lot('winner-topbid', 'bat', 'sold', 30000, 'Grace', NULL);
SELECT pg_temp.lot('winner-case-bid', 'bat', 'sold', 20000, 'Heidi', NULL);
SELECT pg_temp.lot('seller-contradicted', 'bat', 'reserve_not_met', NULL, NULL, 'Ivan');
SELECT pg_temp.lot('seller-flagged', 'bat', 'reserve_not_met', NULL, NULL, 'Judy');
SELECT pg_temp.lot('seller-flag-case', 'bat', 'reserve_not_met', NULL, NULL, 'Frank');
SELECT pg_temp.lot('seller-noflag', 'bat', 'reserve_not_met', NULL, NULL, 'Carol');
SELECT pg_temp.lot('case-mismatch', 'bat', 'sold', 5000, 'alice', 'BOB');
SELECT pg_temp.lot('blank', 'bat', 'sold', 5000, '   ', '');
SELECT pg_temp.lot('stop-upper', 'bat', 'sold', 5000, 'BE', 'Be');
SELECT pg_temp.lot('alias', 'bringatrailer', 'reserve_not_met', NULL, NULL, 'Bob');
SELECT pg_temp.lot('other-platform', 'cars_and_bids', 'sold', 5000, 'Alice', 'Bob');
SELECT pg_temp.lot('pre-keyed', 'bat', 'sold', 5000, 'Alice', 'Bob');
SELECT pg_temp.lot('live-backfill', 'bat', 'sold', 7000, 'Alice', 'Bob',
  jsonb_build_object('extractor', 'extract-bat-core',
                     'live_stream', jsonb_build_object('received_at', '2026-10-01T00:00:00Z')));
-- Second straddling row: lands in the last heap block.
SELECT pg_temp.lot('straddle-last', 'bat', 'sold', 10000, 'Alice', 'Bob');

-- The lots' own comments.
INSERT INTO public.auction_comments (auction_event_id, vehicle_id, platform, author_username, comment_type, bid_amount, is_seller)
SELECT a.id, a.vehicle_id, 'bat', c.author, c.kind, c.amount, c.flag
FROM public.auction_events a
JOIN (VALUES
  -- another handle bid the sale amount: the winner text is contradicted
  ('winner-contradicted', 'Erin', 'bid', 50000::numeric, false),
  ('winner-contradicted', 'Dave', 'bid', 45000, false),
  -- every captured bid below the sale: a partial capture, not a contradiction
  ('winner-partial', 'Erin', 'bid', 40000, false),
  ('winner-partial', 'Frank', 'bid', 45000, false),
  -- the winner holds the top bid
  ('winner-topbid', 'Grace', 'bid', 30000, false),
  ('winner-topbid', 'Erin', 'bid', 29000, false),
  -- the winner's bid under another letter case is the winner's
  ('winner-case-bid', 'heidi', 'bid', 20000, false),
  -- BaT flags another handle as the seller; the named seller only commented
  ('seller-contradicted', 'Judy', 'comment', NULL, true),
  ('seller-contradicted', 'Ivan', 'comment', NULL, false),
  ('seller-flagged', 'Judy', 'comment', NULL, true),
  ('seller-flag-case', 'FRANK', 'comment', NULL, true),
  ('seller-noflag', 'Erin', 'comment', NULL, false),
  ('seller-noflag', 'Dave', 'bid', 1000, NULL)
) AS c(label, author, kind, amount, flag) ON c.label = a.lot_number;

CREATE TEMP TABLE lots_before AS SELECT * FROM public.auction_events;
CREATE TEMP TABLE identities_before AS SELECT * FROM public.external_identities;
CREATE TEMP TABLE straddle_blocks AS
  SELECT id, ((ctid::text)::point)[0]::bigint AS blk FROM public.auction_events WHERE lot_number LIKE 'straddle-%';
-- Stale state the migration must overwrite, not skip.
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description)
VALUES ('auction_events', 'winning_bidder_external_identity_id', 'stale-owner', 'stale registration');
COMMENT ON COLUMN public.auction_events.winning_bidder IS 'stale: not keyed';
ANALYZE public.auction_events;

\ir ../migrations/20261006213000_key_auction_event_identities.sql

-- THE MIGRATION -------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('migration keys no row',
  NOT EXISTS (SELECT 1 FROM public.auction_events
              WHERE winning_bidder_external_identity_id IS NOT NULL OR seller_external_identity_id IS NOT NULL));
SELECT pg_temp.ok('two uuid key columns, each a NOT VALID foreign key to external_identities with ON DELETE SET NULL',
  (SELECT count(*) FROM pg_constraint c
   WHERE c.conrelid = 'public.auction_events'::regclass AND c.contype = 'f'
     AND c.confrelid = 'public.external_identities'::regclass AND NOT c.convalidated AND c.confdeltype = 'n'
     AND c.conname IN ('auction_events_winning_bidder_external_identity_id_fkey', 'auction_events_seller_external_identity_id_fkey')) = 2
  AND (SELECT count(*) FROM information_schema.columns WHERE table_name = 'auction_events' AND data_type = 'uuid'
       AND column_name IN ('winning_bidder_external_identity_id', 'seller_external_identity_id')) = 2);
SELECT pg_temp.ok('both keys carry a partial index for the delete check',
  (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE i.indrelid = 'public.auction_events'::regclass AND i.indpred IS NOT NULL
     AND c.relname IN ('idx_auction_events_winning_bidder_external_identity', 'idx_auction_events_seller_external_identity')) = 2);
SELECT pg_temp.ok('key triggers exist and sort after preserve_bat_live_projection',
  (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.auction_events'::regclass AND NOT tgisinternal
     AND tgname IN ('trg_key_auction_event_identities_ins', 'trg_key_auction_event_identities_upd')) = 2
  AND 'trg_key_auction_event_identities_ins' COLLATE "C" > 'preserve_bat_live_projection'
  AND 'trg_key_auction_event_identities_upd' COLLATE "C" > 'preserve_bat_live_projection');
SELECT pg_temp.ok('column comments name the rule and the writers; the text columns point at their keys',
  col_description('public.auction_events'::regclass, (SELECT attnum FROM pg_attribute
    WHERE attrelid = 'public.auction_events'::regclass AND attname = 'winning_bidder_external_identity_id'))
    LIKE '%at or above winning_bid%key_auction_event_identities()%'
  AND col_description('public.auction_events'::regclass, (SELECT attnum FROM pg_attribute
    WHERE attrelid = 'public.auction_events'::regclass AND attname = 'seller_external_identity_id'))
    LIKE '%seller flag%key_auction_event_identities()%'
  AND col_description('public.auction_events'::regclass, (SELECT attnum FROM pg_attribute
    WHERE attrelid = 'public.auction_events'::regclass AND attname = 'winning_bidder'))
    LIKE '%winning_bidder_external_identity_id%'
  AND col_description('public.auction_events'::regclass, (SELECT attnum FROM pg_attribute
    WHERE attrelid = 'public.auction_events'::regclass AND attname = 'seller_name'))
    LIKE '%seller_external_identity_id%');
SELECT pg_temp.ok('registry names the backfill as owner of both keys, replacing a stale owner',
  (SELECT count(*) FROM public.pipeline_registry WHERE table_name = 'auction_events'
     AND column_name IN ('winning_bidder_external_identity_id', 'seller_external_identity_id')
     AND owned_by = 'key_auction_event_identities' AND description <> 'stale registration'
     AND write_via LIKE 'At insert%') = 2);
SELECT pg_temp.ok('schema_proposals accepts add_column, records this change once, and still refuses an unknown type',
  (SELECT count(*) FROM public.schema_proposals WHERE proposal_type = 'add_column' AND status = 'approved'
     AND payload->>'table' = 'auction_events' AND jsonb_array_length(payload->'columns') = 2
     AND resolved_at IS NOT NULL) = 1
  AND (SELECT count(*) FROM public.schema_proposals) = 2);
DO $$ BEGIN
  INSERT INTO public.schema_proposals (proposed_by_agent_key, proposal_type, payload) VALUES ('x', 'add_table', '{}');
  RAISE EXCEPTION 'an unknown proposal_type was accepted';
EXCEPTION WHEN check_violation THEN NULL;
END $$;
SELECT pg_temp.ok('backfill and rule are callable by service_role only',
  NOT has_function_privilege('anon', 'public.key_auction_event_identities(integer, bigint)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.key_auction_event_identities(integer, bigint)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.key_auction_event_identities(integer, bigint)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.resolve_auction_event_identities(uuid, text, text, numeric, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.resolve_auction_event_identities(uuid, text, text, numeric, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.resolve_auction_event_identities(uuid, text, text, numeric, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.key_auction_event_identities_on_write()', 'EXECUTE'));
SELECT pg_temp.ok('the three functions run with a fixed search_path ending in pg_temp',
  (SELECT count(*) FROM pg_proc WHERE proconfig @> ARRAY['search_path=public, pg_temp']
     AND oid IN ('public.key_auction_event_identities(integer, bigint)'::regprocedure,
                 'public.key_auction_event_identities_on_write()'::regprocedure,
                 'public.resolve_auction_event_identities(uuid, text, text, numeric, text)'::regprocedure)) = 3);

-- THE RULE, one lot at a time -----------------------------------------------------------------------------------------
CREATE FUNCTION pg_temp.verdicts(p_label text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(r.winning_bidder_verdict, '-') || '/' || coalesce(r.seller_verdict, '-')
  FROM public.auction_events a
  CROSS JOIN LATERAL public.resolve_auction_event_identities(a.id, a.source, a.winning_bidder, a.winning_bid, a.seller_name) r
  WHERE a.lot_number = p_label;
$$;
SELECT pg_temp.ok('rule: exact handles with no evidence are keyed', pg_temp.verdicts('straddle-first') = 'keyed/keyed');
SELECT pg_temp.ok('rule: another handle''s bid at the sale contradicts the winner; the seller still keys',
  pg_temp.verdicts('winner-contradicted') = 'contradicted/keyed');
SELECT pg_temp.ok('rule: a partial capture (every bid below the sale) is not a contradiction',
  pg_temp.verdicts('winner-partial') = 'keyed/keyed');
SELECT pg_temp.ok('rule: the winner''s own top bid, and its bid under another letter case, key the winner',
  pg_temp.verdicts('winner-topbid') = 'keyed/-' AND pg_temp.verdicts('winner-case-bid') = 'keyed/-');
SELECT pg_temp.ok('rule: a seller flag on another handle only contradicts the seller',
  pg_temp.verdicts('seller-contradicted') = '-/contradicted');
SELECT pg_temp.ok('rule: a flag on the seller (any letter case), or no flag at all, keys the seller',
  pg_temp.verdicts('seller-flagged') = '-/keyed' AND pg_temp.verdicts('seller-flag-case') = '-/keyed'
  AND pg_temp.verdicts('seller-noflag') = '-/keyed');
SELECT pg_temp.ok('rule: a case mismatch is not keyed (exact case, like the comment keyers)',
  pg_temp.verdicts('case-mismatch') = 'no_identity/no_identity');
SELECT pg_temp.ok('rule: blank text is never looked up', pg_temp.verdicts('blank') = 'blank/blank');
SELECT pg_temp.ok('rule: junk is refused in any letter case, even when an identity holds it',
  pg_temp.verdicts('stop-upper') = 'stop_word/stop_word' AND pg_temp.verdicts('filler-3') LIKE '-/stop_word');
SELECT pg_temp.ok('rule: non-BaT lots are never keyed, whatever identity the text matches',
  pg_temp.verdicts('other-platform') = 'not_bat/not_bat' AND pg_temp.verdicts('filler-2') = 'not_bat/not_bat');
SELECT pg_temp.ok('rule: the bringatrailer spelling is BaT', pg_temp.verdicts('alias') = '-/keyed');

-- An already-keyed row: the winner key points at another identity than the rule would pick; only the seller is open.
UPDATE public.auction_events SET winning_bidder_external_identity_id = (SELECT id FROM ident WHERE handle = 'Frank')
WHERE lot_number = 'pre-keyed';

-- GUARDS --------------------------------------------------------------------------------------------------------------
SET statement_timeout = 0;
DO $$ BEGIN
  PERFORM public.key_auction_event_identities(500, 0);
  RAISE EXCEPTION 'unbounded call was accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%caller must set statement_timeout%' THEN RAISE; END IF;
END $$;
SET statement_timeout = '61s';
DO $$ BEGIN
  PERFORM public.key_auction_event_identities(500, 0);
  RAISE EXCEPTION 'a statement_timeout above 60 s was accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%caller must set statement_timeout%' THEN RAISE; END IF;
END $$;
SET statement_timeout = '30s';
DO $$ BEGIN
  PERFORM public.key_auction_event_identities(0, 0);
  RAISE EXCEPTION 'p_batch 0 was accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%p_batch must be%' THEN RAISE; END IF;
END $$;
DO $$ BEGIN
  PERFORM public.key_auction_event_identities(500, -1);
  RAISE EXCEPTION 'a negative start block was accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%p_from_block must be%' THEN RAISE; END IF;
END $$;
SELECT pg_temp.ok('refused calls changed nothing',
  (SELECT count(*) FROM public.auction_events WHERE seller_external_identity_id IS NOT NULL) = 0
  AND NOT EXISTS (SELECT 1 FROM public.write_receipts));
SELECT pg_temp.ok('start blocks at or past the end, and past the tid range, return done without error',
  (SELECT bool_and((r->>'done')::boolean AND (r->>'keyed')::int = 0 AND (r->>'blocks_scanned')::int = 0)
   FROM (SELECT public.key_auction_event_identities(200, b) r
         FROM unnest(ARRAY[pg_relation_size('public.auction_events') / current_setting('block_size')::bigint,
                           1000000, 4294967294, 4294967295, 5000000000]) b) s)
  AND NOT EXISTS (SELECT 1 FROM public.write_receipts));

-- WALK THE WHOLE HEAP, ONE BLOCK PER CALL ------------------------------------------------------------------------------
-- p_batch 1 makes every call scan exactly one block whatever the planner statistics say
-- (greatest(1, ceil(1 / rows_per_page)) = 1), so the cursor arithmetic is asserted, not a batch count.
SELECT pg_temp.ok('the straddling rows sit in two different heap blocks, the first in block 0',
  (SELECT count(DISTINCT blk) FROM straddle_blocks) = 2 AND (SELECT min(blk) FROM straddle_blocks) = 0
  AND (SELECT max(blk) FROM straddle_blocks) > 100);
CREATE TEMP TABLE walk(run text, step int, result jsonb);
DO $$
DECLARE r jsonb; b bigint := 0; i int := 0;
BEGIN
  LOOP
    r := public.key_auction_event_identities(1, b);
    i := i + 1;
    INSERT INTO walk VALUES ('first', i, r);
    EXIT WHEN (r->>'done')::boolean OR i > 100000;
    b := (r->>'next_block')::bigint;
  END LOOP;
END $$;
CREATE FUNCTION pg_temp.total(p_run text, p_key text) RETURNS bigint LANGUAGE sql AS $$
  SELECT coalesce(sum((result->>p_key)::bigint), 0) FROM walk WHERE run = p_run;
$$;
SELECT pg_temp.ok('cursor: starts at block 0; each call starts where the last ended; one block per call',
  (SELECT (result->>'from_block')::bigint FROM walk WHERE run = 'first' AND step = 1) = 0
  AND NOT EXISTS (SELECT 1 FROM walk w JOIN walk p ON p.run = w.run AND p.step = w.step - 1
                  WHERE w.run = 'first' AND (w.result->>'from_block')::bigint <> (p.result->>'next_block')::bigint)
  AND NOT EXISTS (SELECT 1 FROM walk WHERE run = 'first'
                  AND ((result->>'next_block')::bigint - (result->>'from_block')::bigint <> 1
                       OR (result->>'blocks_scanned')::bigint
                          <> least((result->>'next_block')::bigint, (result->>'table_blocks')::bigint) - (result->>'from_block')::bigint
                       OR (result->>'remaining_blocks')::bigint
                          <> greatest(0, (result->>'table_blocks')::bigint - (result->>'next_block')::bigint))));
SELECT pg_temp.ok('cursor: only the last call reports done, at the table end, after the last straddling block',
  (SELECT count(*) FROM walk WHERE run = 'first' AND (result->>'done')::boolean) = 1
  AND (SELECT (result->>'done')::boolean AND (result->>'next_block')::bigint >= (result->>'table_blocks')::bigint
       FROM walk WHERE run = 'first' ORDER BY step DESC LIMIT 1)
  AND (SELECT count(*) FROM walk WHERE run = 'first') >= (SELECT max(blk) FROM straddle_blocks) + 1);
SELECT pg_temp.ok('the straddling rows are keyed by two different calls',
  (SELECT count(DISTINCT w.step) FROM straddle_blocks s JOIN walk w ON w.run = 'first'
     AND s.blk >= (w.result->>'from_block')::bigint AND s.blk < (w.result->>'next_block')::bigint
     AND (w.result->>'keyed')::int > 0) = 2
  AND (SELECT count(*) FROM public.auction_events a
       WHERE a.lot_number LIKE 'straddle-%'
         AND a.winning_bidder_external_identity_id = (SELECT id FROM ident WHERE handle = 'Alice')
         AND a.seller_external_identity_id = (SELECT id FROM ident WHERE handle = 'Bob')) = 2);

-- Expected, by construction:
--   winners keyed 606 = 600 fillers (Alice) + 2 straddling + partial + top bid + case bid + live-backfill
--   sellers keyed 1,210 = 600 (Bob) + 600 (Carol) + 2 straddling + 2 Mallory + flagged + flag case + no flag + alias
--                         + pre-keyed + live-backfill
--   rows updated 1,212 = every row above that gained at least one key
SELECT pg_temp.ok('counts: winners keyed, and every reason a winner stays NULL',
  pg_temp.total('first', 'keyed_winning_bidder') = 606
  AND pg_temp.total('first', 'winning_bidder_no_identity') = 601
  AND pg_temp.total('first', 'winning_bidder_contradicted') = 1
  AND pg_temp.total('first', 'winning_bidder_stop_word') = 1
  AND pg_temp.total('first', 'winning_bidder_blank') = 1);
SELECT pg_temp.ok('counts: sellers keyed, and every reason a seller stays NULL',
  pg_temp.total('first', 'keyed_seller') = 1210
  AND pg_temp.total('first', 'seller_stop_word') = 601
  AND pg_temp.total('first', 'seller_contradicted') = 1
  AND pg_temp.total('first', 'seller_no_identity') = 1
  AND pg_temp.total('first', 'seller_blank') = 1);
SELECT pg_temp.ok('counts: rows updated, one per row that gained a key (the hand-keyed row gained its seller)',
  pg_temp.total('first', 'keyed') = 1212
  AND (SELECT count(*) FROM public.auction_events a JOIN lots_before b USING (id)
       WHERE a.winning_bidder_external_identity_id IS NOT NULL OR a.seller_external_identity_id IS NOT NULL) = 1212);
SELECT pg_temp.ok('exact match keyed: every key the walk set names the identity with exactly that handle',
  NOT EXISTS (SELECT 1 FROM public.auction_events a JOIN public.external_identities e ON e.id = a.winning_bidder_external_identity_id
              WHERE a.lot_number <> 'pre-keyed' AND (e.platform <> 'bat' OR e.handle <> a.winning_bidder))
  AND NOT EXISTS (SELECT 1 FROM public.auction_events a JOIN public.external_identities e ON e.id = a.seller_external_identity_id
                  WHERE e.platform <> 'bat' OR e.handle <> a.seller_name));
SELECT pg_temp.ok('the rule held for every lot: contradicted, junk, blank, case-different and unknown texts stay NULL',
  (SELECT bool_and(winning_bidder_external_identity_id IS NULL) FROM public.auction_events
   WHERE lot_number IN ('winner-contradicted', 'case-mismatch', 'blank', 'stop-upper', 'filler-1'))
  AND (SELECT bool_and(seller_external_identity_id IS NULL) FROM public.auction_events
       WHERE lot_number IN ('seller-contradicted', 'case-mismatch', 'blank', 'stop-upper', 'filler-3')));
SELECT pg_temp.ok('a junk word is never keyed, even though an identity holds it',
  NOT EXISTS (SELECT 1 FROM public.auction_events a JOIN ident i ON i.handle = 'be'
              WHERE a.winning_bidder_external_identity_id = i.id OR a.seller_external_identity_id = i.id));
SELECT pg_temp.ok('non-BaT lots are never keyed',
  NOT EXISTS (SELECT 1 FROM public.auction_events WHERE source NOT IN ('bat', 'bringatrailer')
              AND (winning_bidder_external_identity_id IS NOT NULL OR seller_external_identity_id IS NOT NULL)));
SELECT pg_temp.ok('an already-keyed winner is untouched; the open seller key on that row is filled',
  (SELECT winning_bidder_external_identity_id = (SELECT id FROM ident WHERE handle = 'Frank')
          AND seller_external_identity_id = (SELECT id FROM ident WHERE handle = 'Bob')
   FROM public.auction_events WHERE lot_number = 'pre-keyed'));
SELECT pg_temp.ok('a lot carrying the live projection is keyed through preserve_bat_live_projection, raw_data intact',
  (SELECT a.winning_bidder_external_identity_id = (SELECT id FROM ident WHERE handle = 'Alice')
          AND a.raw_data = b.raw_data
   FROM public.auction_events a JOIN lots_before b USING (id) WHERE a.lot_number = 'live-backfill'));
SELECT pg_temp.ok('only the two key columns change; every other column, updated_at included, is as it was',
  NOT EXISTS (SELECT 1 FROM public.auction_events a JOIN lots_before b USING (id)
              WHERE (a.vehicle_id, a.source, a.source_url, a.lot_number, a.auction_end_date, a.outcome, a.high_bid,
                     a.winning_bid, a.winning_bidder, a.seller_name, a.total_bids, a.comments_count, a.page_views,
                     a.watchers, a.raw_data, a.scraped_at, a.created_at, a.updated_at)
                    IS DISTINCT FROM
                    (b.vehicle_id, b.source, b.source_url, b.lot_number, b.auction_end_date, b.outcome, b.high_bid,
                     b.winning_bid, b.winning_bidder, b.seller_name, b.total_bids, b.comments_count, b.page_views,
                     b.watchers, b.raw_data, b.scraped_at, b.created_at, b.updated_at))
  AND (SELECT count(*) FROM public.auction_events) = (SELECT count(*) FROM lots_before));
SELECT pg_temp.ok('no identity minted or changed',
  (SELECT count(*) FROM public.external_identities) = (SELECT count(*) FROM identities_before)
  AND NOT EXISTS (SELECT 1 FROM public.external_identities e JOIN identities_before b USING (id)
                  WHERE (e.platform, e.handle) IS DISTINCT FROM (b.platform, b.handle)));
SELECT pg_temp.ok('receipt: one declared UPDATE receipt per call that changed rows, summing to the rows updated',
  (SELECT count(*) FROM public.write_receipts) = (SELECT count(*) FROM walk WHERE run = 'first' AND (result->>'keyed')::int > 0)
  AND (SELECT sum(rows) FROM public.write_receipts) = 1212
  AND NOT EXISTS (SELECT 1 FROM public.write_receipts
                  WHERE tbl <> 'auction_events' OR op <> 'UPDATE' OR writer <> 'key-auction-event-identities' OR rows < 1));

-- Idempotent: a second full walk, with multi-block batches, changes nothing and writes no receipt.
DO $$
DECLARE r jsonb; b bigint := 0; i int := 0;
BEGIN
  LOOP
    r := public.key_auction_event_identities(200, b);
    i := i + 1;
    INSERT INTO walk VALUES ('again', i, r);
    EXIT WHEN (r->>'done')::boolean OR i > 1000;
    b := (r->>'next_block')::bigint;
  END LOOP;
END $$;
SELECT pg_temp.ok('second run keys 0 rows and writes no receipt',
  (SELECT count(*) FROM walk WHERE run = 'again') > 1
  AND pg_temp.total('again', 'keyed') = 0
  AND (SELECT sum(rows) FROM public.write_receipts) = 1212);

-- KEY AT INSERT -------------------------------------------------------------------------------------------------------
SELECT pg_temp.lot('ins-first-read', 'bat', 'sold', 8000, 'Alice', 'Bob');
SELECT pg_temp.ok('insert: a first read of a closed lot is keyed at insert (no comments yet, nothing contradicts)',
  (SELECT winning_bidder_external_identity_id = (SELECT id FROM ident WHERE handle = 'Alice')
          AND seller_external_identity_id = (SELECT id FROM ident WHERE handle = 'Bob')
   FROM public.auction_events WHERE lot_number = 'ins-first-read'));
SELECT pg_temp.lot('ins-junk', 'bat', 'sold', 8000, 'be', 'nobody_here');
SELECT pg_temp.ok('insert: junk and unknown handles stay NULL',
  (SELECT winning_bidder_external_identity_id IS NULL AND seller_external_identity_id IS NULL
   FROM public.auction_events WHERE lot_number = 'ins-junk'));
SELECT pg_temp.lot('ins-mecum', 'mecum', 'sold', 8000, 'Alice', 'Bob');
SELECT pg_temp.ok('insert: a non-BaT lot is not keyed',
  (SELECT winning_bidder_external_identity_id IS NULL AND seller_external_identity_id IS NULL
   FROM public.auction_events WHERE lot_number = 'ins-mecum'));
INSERT INTO public.auction_events (vehicle_id, source, source_url, lot_number, outcome, winning_bid, winning_bidder,
                                   seller_name, winning_bidder_external_identity_id)
SELECT gen_random_uuid(), 'bat', 'https://bringatrailer.com/listing/ins-writer-key', 'ins-writer-key', 'sold', 8000,
       'Alice', 'Bob', id FROM ident WHERE handle = 'Frank';
SELECT pg_temp.ok('insert: a key the writer passed is kept; the other key is still filled',
  (SELECT winning_bidder_external_identity_id = (SELECT id FROM ident WHERE handle = 'Frank')
          AND seller_external_identity_id = (SELECT id FROM ident WHERE handle = 'Bob')
   FROM public.auction_events WHERE lot_number = 'ins-writer-key'));
SET ROLE service_role;
INSERT INTO public.auction_events (vehicle_id, source, source_url, lot_number, outcome, winning_bid, winning_bidder, seller_name)
VALUES (gen_random_uuid(), 'bat', 'https://bringatrailer.com/listing/ins-service-role', 'ins-service-role', 'sold', 8000,
        'Grace', 'Heidi');
RESET ROLE;
SELECT pg_temp.ok('insert: a writer without EXECUTE on the trigger function is keyed all the same',
  NOT has_function_privilege('service_role', 'public.key_auction_event_identities_on_write()', 'EXECUTE')
  AND (SELECT winning_bidder_external_identity_id = (SELECT id FROM ident WHERE handle = 'Grace')
              AND seller_external_identity_id = (SELECT id FROM ident WHERE handle = 'Heidi')
       FROM public.auction_events WHERE lot_number = 'ins-service-role'));

-- The extract-bat-core path: a live row, then the upsert of the closed read (ON CONFLICT (vehicle_id, source_url)).
INSERT INTO public.auction_events (vehicle_id, source, source_url, lot_number, outcome, seller_name)
VALUES ('00000000-0000-4000-8000-000000000001', 'bat', 'https://bringatrailer.com/listing/upsert-lot', 'upsert-lot', 'live', 'Judy');
SELECT pg_temp.ok('insert: the live row is keyed to its seller at insert, with no winner yet',
  (SELECT seller_external_identity_id = (SELECT id FROM ident WHERE handle = 'Judy') AND winning_bidder_external_identity_id IS NULL
   FROM public.auction_events WHERE lot_number = 'upsert-lot'));
INSERT INTO public.auction_comments (auction_event_id, platform, author_username, comment_type, bid_amount, is_seller)
SELECT id, 'bat', 'Erin', 'bid', 9000, false FROM public.auction_events WHERE lot_number = 'upsert-lot';
INSERT INTO public.auction_events (vehicle_id, source, source_url, lot_number, outcome, winning_bid, high_bid, winning_bidder, seller_name)
VALUES ('00000000-0000-4000-8000-000000000001', 'bat', 'https://bringatrailer.com/listing/upsert-lot', 'upsert-lot', 'sold', 12000, 12000,
        'Grace', 'Judy')
ON CONFLICT (vehicle_id, source_url) DO UPDATE SET
  outcome = EXCLUDED.outcome, winning_bid = EXCLUDED.winning_bid, high_bid = EXCLUDED.high_bid,
  winning_bidder = EXCLUDED.winning_bidder, seller_name = EXCLUDED.seller_name, updated_at = now();
SELECT pg_temp.ok('upsert: the closing read keys the winner on the update path; the seller key stays',
  (SELECT winning_bidder_external_identity_id = (SELECT id FROM ident WHERE handle = 'Grace')
          AND seller_external_identity_id = (SELECT id FROM ident WHERE handle = 'Judy')
   FROM public.auction_events WHERE lot_number = 'upsert-lot')
  AND (SELECT count(*) FROM public.auction_events WHERE lot_number = 'upsert-lot') = 1);

-- KEY ON UPDATE OF THE TEXT -------------------------------------------------------------------------------------------
UPDATE public.auction_events SET seller_name = 'Carol' WHERE lot_number = 'ins-first-read';
SELECT pg_temp.ok('update: a changed seller text is keyed again to the identity it now names',
  (SELECT seller_external_identity_id = (SELECT id FROM ident WHERE handle = 'Carol')
   FROM public.auction_events WHERE lot_number = 'ins-first-read'));
UPDATE public.auction_events SET winning_bidder = NULL WHERE lot_number = 'ins-first-read';
SELECT pg_temp.ok('update: a winner text set to NULL leaves no key behind',
  (SELECT winning_bidder_external_identity_id IS NULL FROM public.auction_events WHERE lot_number = 'ins-first-read'));
UPDATE public.auction_events SET seller_name = 'be' WHERE lot_number = 'ins-first-read';
SELECT pg_temp.ok('update: a seller text changed to junk leaves no key behind',
  (SELECT seller_external_identity_id IS NULL FROM public.auction_events WHERE lot_number = 'ins-first-read'));
UPDATE public.auction_events
SET winning_bidder = 'Alice', winning_bidder_external_identity_id = (SELECT id FROM ident WHERE handle = 'Mallory')
WHERE lot_number = 'ins-first-read';
SELECT pg_temp.ok('update: a key the statement sets with its text is kept',
  (SELECT winning_bidder_external_identity_id = (SELECT id FROM ident WHERE handle = 'Mallory')
   FROM public.auction_events WHERE lot_number = 'ins-first-read'));
INSERT INTO public.auction_comments (auction_event_id, platform, author_username, comment_type, bid_amount, is_seller)
SELECT id, 'bat', 'Ivan', 'comment', NULL, true FROM public.auction_events WHERE lot_number = 'seller-flagged';
UPDATE public.auction_events SET seller_name = 'Judy', page_views = 5 WHERE lot_number = 'seller-flagged';
SELECT pg_temp.ok('update: a set key whose text is unchanged is never touched, even when later evidence disagrees',
  (SELECT seller_external_identity_id = (SELECT id FROM ident WHERE handle = 'Judy')
   FROM public.auction_events WHERE lot_number = 'seller-flagged'));

-- The live intake's close: frame comments land first, then the result, inside the transaction that admitted the frame's
-- observation; preserve_bat_live_projection fires first and lets the row through, then the key trigger sees it.
INSERT INTO public.auction_events (vehicle_id, source, source_url, lot_number, outcome, raw_data)
VALUES ('00000000-0000-4000-8000-000000000002', 'bat', 'https://bringatrailer.com/listing/live-close', 'live-close', 'live',
        jsonb_build_object('live_stream', jsonb_build_object('received_at', '2026-10-06T20:00:00Z')));
BEGIN;
INSERT INTO public.vehicle_observations (id, vehicle_id, extraction_method)
VALUES ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000002', 'bat_public_live_v1');
INSERT INTO public.auction_comments (auction_event_id, platform, author_username, comment_type, bid_amount)
SELECT id, 'bat', 'Dave', 'bid', 41000 FROM public.auction_events WHERE lot_number = 'live-close';
UPDATE public.auction_events SET raw_data = raw_data || jsonb_build_object('live_stream',
  jsonb_build_object('observation_id', '00000000-0000-4000-8000-0000000000a1', 'received_at', '2026-10-06T21:00:00Z'))
WHERE lot_number = 'live-close';
UPDATE public.auction_events SET outcome = 'sold', winning_bid = 41000, winning_bidder = 'Dave'
WHERE lot_number = 'live-close' AND outcome <> 'sold';
COMMIT;
SELECT pg_temp.ok('live close: the close frame''s winner is keyed after preserve_bat_live_projection lets the row through',
  (SELECT outcome = 'sold' AND winning_bidder = 'Dave'
          AND winning_bidder_external_identity_id = (SELECT id FROM ident WHERE handle = 'Dave')
   FROM public.auction_events WHERE lot_number = 'live-close'));
-- A stale replay on a live row: preserve_bat_live_projection returns the old row, so nothing changes and nothing keys.
INSERT INTO public.auction_events (vehicle_id, source, source_url, lot_number, outcome, raw_data)
VALUES (gen_random_uuid(), 'bat', 'https://bringatrailer.com/listing/live-stale', 'live-stale', 'live',
        jsonb_build_object('live_stream', jsonb_build_object('received_at', '2026-10-06T20:00:00Z')));
UPDATE public.auction_events SET winning_bidder = 'Erin' WHERE lot_number = 'live-stale';
SELECT pg_temp.ok('live replay: a write the live trigger refuses leaves neither text nor key',
  (SELECT winning_bidder IS NULL AND winning_bidder_external_identity_id IS NULL
   FROM public.auction_events WHERE lot_number = 'live-stale'));

-- ON DELETE SET NULL: removing an identity clears the keys that name it and nothing else.
DELETE FROM public.external_identities WHERE platform = 'bat' AND handle = 'Grace';
SELECT pg_temp.ok('delete: keys naming a removed identity become NULL; the text stays',
  (SELECT winning_bidder_external_identity_id IS NULL AND winning_bidder = 'Grace'
          AND seller_external_identity_id = (SELECT id FROM ident WHERE handle = 'Judy')
   FROM public.auction_events WHERE lot_number = 'upsert-lot')
  AND NOT EXISTS (SELECT 1 FROM public.auction_events a
                  WHERE a.winning_bidder_external_identity_id = (SELECT id FROM ident WHERE handle = 'Grace')
                     OR a.seller_external_identity_id = (SELECT id FROM ident WHERE handle = 'Grace')));

-- CONCURRENCY ---------------------------------------------------------------------------------------------------------
-- Another writer keys the winner after the backfill's snapshot saw both keys open. The backfill's UPDATE waits on that
-- row, re-reads it, keeps the writer's key and still fills the open seller key.
CREATE EXTENSION dblink;
SELECT pg_temp.lot('concurrent', 'bat', 'sold', 9000, 'Alice', 'Bob');
UPDATE public.auction_events SET winning_bidder_external_identity_id = NULL, seller_external_identity_id = NULL
WHERE lot_number = 'concurrent';
CREATE FUNCTION pg_temp.conninfo() RETURNS text LANGUAGE sql AS $$
  SELECT format('host=%s port=%s dbname=%s user=%s',
    CASE WHEN current_setting('unix_socket_directories') = '' THEN 'localhost'
         ELSE split_part(current_setting('unix_socket_directories'), ',', 1) END,
    current_setting('port'), current_database(), current_user);
$$;
SELECT dblink_connect('holder', pg_temp.conninfo());
SELECT dblink_connect('walker', pg_temp.conninfo());
SELECT dblink_exec('holder', 'BEGIN');
SELECT dblink_exec('holder', format(
  'UPDATE public.auction_events SET winning_bidder_external_identity_id = %L WHERE lot_number = %L',
  (SELECT id FROM ident WHERE handle = 'Mallory'), 'concurrent'));
SELECT dblink_exec('walker', 'SET statement_timeout = ''30s''');
SELECT dblink_send_query('walker', 'SELECT public.key_auction_event_identities(100000, 0)::text');
DO $$
DECLARE i int := 0;
BEGIN
  LOOP
    PERFORM pg_stat_clear_snapshot();
    EXIT WHEN EXISTS (SELECT 1 FROM pg_stat_activity
                      WHERE wait_event_type = 'Lock' AND query LIKE '%key_auction_event_identities(100000%');
    i := i + 1;
    IF i > 200 THEN RAISE EXCEPTION 'the backfill never waited on the held row'; END IF;
    PERFORM pg_sleep(0.02);
  END LOOP;
END $$;
SELECT dblink_exec('holder', 'COMMIT');
CREATE TEMP TABLE concurrent_result AS SELECT r::jsonb AS result FROM dblink_get_result('walker') AS t(r text);
SELECT dblink_disconnect('holder');
SELECT dblink_disconnect('walker');
SELECT pg_temp.ok('concurrency: the backfill keeps a key another writer set after its snapshot, and fills the open key',
  (SELECT winning_bidder_external_identity_id = (SELECT id FROM ident WHERE handle = 'Mallory')
          AND seller_external_identity_id = (SELECT id FROM ident WHERE handle = 'Bob')
   FROM public.auction_events WHERE lot_number = 'concurrent')
  AND (SELECT (result->>'keyed')::int = 1 AND (result->>'keyed_seller')::int = 1
              AND (result->>'keyed_winning_bidder')::int = 0 FROM concurrent_result));
