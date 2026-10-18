-- Isolated PostgreSQL 17 contract for 20261018234500_external_auction_bids_cross_platform.sql and its follow-up
-- 20261019013000_external_auction_bids_follow_comment_lot.sql.
-- Synthetic rows and placeholder handles only; never production. Run in an empty disposable dm_refinement_* database:
--   scripts/ci/run-db-contracts.sh test_external_auction_bids_cross_platform.sql
-- Stub tables carry the columns, keys and foreign keys the migration reads, as read from the live catalog 2026-10-17:
-- auction_comments_vehicle_content_hash_key (vehicle_id, content_hash); idx_auction_events_vehicle_source_url;
-- bat_bids_unique_bid; external_identities (platform, handle); the legacy external_auction_bids key
-- (external_listing_id, bid_amount, bidder_username, bid_timestamp). trg_key_auction_comment_author is the live trigger.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR to_regclass('public.auction_comments') IS NOT NULL
     OR to_regclass('public.external_auction_bids') IS NOT NULL THEN
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

CREATE TABLE public.vehicles (id uuid PRIMARY KEY);
CREATE TABLE public.external_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), platform text NOT NULL, handle text NOT NULL, profile_url text,
  created_at timestamptz DEFAULT now(), CONSTRAINT external_identities_platform_handle_key UNIQUE (platform, handle));
CREATE TABLE public.auction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid REFERENCES public.vehicles(id), source text, source_url text,
  source_listing_id text, bid_history jsonb, scraped_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX idx_auction_events_vehicle_source_url ON public.auction_events (vehicle_id, source_url);
CREATE TABLE public.auction_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_event_id uuid REFERENCES public.auction_events(id) ON DELETE CASCADE, vehicle_id uuid NOT NULL,
  platform text, source_url text, content_hash text, sequence_number integer, posted_at timestamptz,
  author_username text, comment_type text, comment_text text, bid_amount numeric, bat_comment_id integer,
  external_identity_id uuid REFERENCES public.external_identities(id) ON DELETE SET NULL,
  author_external_identity_id uuid REFERENCES public.external_identities(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT auction_comments_vehicle_content_hash_key UNIQUE (vehicle_id, content_hash));
CREATE TABLE public.bat_listings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bat_listing_url text UNIQUE);
CREATE TABLE public.bat_bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bat_listing_id uuid NOT NULL, vehicle_id uuid, bat_username text NOT NULL,
  external_identity_id uuid, bid_amount numeric NOT NULL, bid_timestamp timestamptz NOT NULL, source text DEFAULT 'comment',
  auction_event_id uuid, metadata jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now(),
  CONSTRAINT bat_bids_unique_bid UNIQUE (bat_listing_id, bat_username, bid_amount, bid_timestamp));
CREATE TABLE public.external_auction_bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), external_listing_id uuid, vehicle_id uuid, platform text NOT NULL,
  bid_amount integer NOT NULL, bid_timestamp timestamptz NOT NULL, bidder_username text,
  bidder_external_identity_id uuid REFERENCES public.external_identities(id), bid_number integer,
  is_winning_bid boolean DEFAULT false, is_autobid boolean DEFAULT false, reserve_met_at_bid boolean,
  source text NOT NULL DEFAULT 'unknown', source_email_id text, raw_data jsonb, created_at timestamptz DEFAULT now(),
  CONSTRAINT external_auction_bids_external_listing_id_bid_amount_bidder_key UNIQUE (external_listing_id, bid_amount, bidder_username, bid_timestamp));
CREATE TABLE public.pipeline_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL, column_name text, owned_by text NOT NULL,
  description text NOT NULL, valid_values text[], do_not_write_directly boolean NOT NULL DEFAULT false, write_via text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (table_name, column_name));
-- live trigger (20261006090000), its function body the migration replaces
CREATE FUNCTION public.key_auction_comment_author_on_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trg_key_auction_comment_author BEFORE INSERT ON public.auction_comments FOR EACH ROW
  WHEN (NEW.external_identity_id IS NULL AND NEW.author_username IS NOT NULL) EXECUTE FUNCTION public.key_auction_comment_author_on_insert();

-- fixtures: one vehicle with a BaT lot, one with a C&B lot, one spare for a merge; the same handle on both houses
INSERT INTO public.vehicles VALUES ('10000000-0000-4000-8000-000000000001'), ('10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003');
INSERT INTO public.external_identities (id, platform, handle) VALUES
  ('20000000-0000-4000-8000-000000000001', 'bat', 'driver9'),
  ('20000000-0000-4000-8000-000000000002', 'cars_and_bids', 'driver9'),
  ('20000000-0000-4000-8000-000000000003', 'cars_and_bids', 'lister4');
INSERT INTO public.auction_events (id, vehicle_id, source, source_url, source_listing_id) VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'bat', 'https://bringatrailer.com/listing/test-lot/', 'test-lot'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'cars_and_bids', 'https://carsandbids.com/auctions/AbCd1234/test-car', 'AbCd1234');
INSERT INTO public.bat_listings (id, bat_listing_url) VALUES ('40000000-0000-4000-8000-000000000001', 'https://bringatrailer.com/listing/test-lot/');

-- a legacy C&B comment already held under the old key, and a legacy external_auction_bids row with a writer-made time
INSERT INTO public.auction_comments (id, auction_event_id, vehicle_id, platform, source_url, content_hash, posted_at, author_username, comment_type, comment_text, bid_amount, external_identity_id)
VALUES ('50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002',
  'cars_and_bids', 'https://carsandbids.com/auctions/AbCd1234/test-car', 'cab_10000000-0000-4000-8000-000000000002_Held0001',
  '2026-06-01T17:00:00Z', 'lister4', 'observation', 'Nice car', NULL, '20000000-0000-4000-8000-000000000003');
INSERT INTO public.external_auction_bids (id, vehicle_id, platform, bid_amount, bid_timestamp, bidder_username, bid_number, source, raw_data) VALUES
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'cars_and_bids', 21000, '2026-02-14T00:33:07Z', 'driver9', 2,
   'extract-cab-bids', '{"auction_url":"https://carsandbids.com/auctions/AbCd1234/test-car"}'),
  ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'cars_and_bids', 22000, '2026-02-14T00:34:07Z', 'lister4', 3,
   'extract-cab-bids', '{"auction_url":"https://carsandbids.com/auctions/AbCd1234/test-car"}'),
  ('60000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'cars_and_bids', 22000, '2026-02-15T00:34:07Z', 'lister4', 3,
   'extract-cab-bids-pw', '{"auction_url":"https://carsandbids.com/auctions/AbCd1234/test-car"}');

\ir ../migrations/20261018234500_external_auction_bids_cross_platform.sql
\ir ../migrations/20261019013000_external_auction_bids_follow_comment_lot.sql

-- 1. C&B comment keys: every writer converges on C&B's own id
INSERT INTO public.auction_comments (auction_event_id, vehicle_id, platform, source_url, content_hash, posted_at, author_username, comment_type, comment_text, bid_amount)
VALUES ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'cars_and_bids',
  'https://carsandbids.com/auctions/AbCd1234/test-car', 'cab_10000000-0000-4000-8000-000000000002_3vQXROVO',
  '2026-06-02T18:00:00Z', 'driver9', 'bid', 'Bid $20,000', 20000);
-- 46980fa4fc50… is the prefix batAuctionRecord.test.ts pins for cabCommentContentHash('3vQXROVO') (Web Crypto)
SELECT pg_temp.ok('a legacy-format key for a new comment becomes the shared C&B hash and keeps the id',
  (SELECT content_hash = encode(sha256(convert_to('cars_and_bids|native-comment:3vQXROVO', 'UTF8')), 'hex')
     AND left(content_hash, 12) = '46980fa4fc50' AND source_comment_id = '3vQXROVO'
   FROM public.auction_comments WHERE comment_text = 'Bid $20,000'));
SELECT pg_temp.ok('C&B authors are keyed by exact (cars_and_bids, handle), never to the BaT identity of the same handle',
  (SELECT external_identity_id = '20000000-0000-4000-8000-000000000002' FROM public.auction_comments WHERE comment_text = 'Bid $20,000'));
INSERT INTO public.auction_comments (auction_event_id, vehicle_id, platform, source_url, content_hash, source_comment_id, posted_at, author_username, comment_type, comment_text, bid_amount)
VALUES ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'cars_and_bids',
  'https://carsandbids.com/auctions/AbCd1234/test-car', encode(sha256(convert_to('cars_and_bids|native-comment:3vQXROVO', 'UTF8')), 'hex'), '3vQXROVO',
  '2026-06-02T18:00:00Z', 'driver9', 'bid', 'Bid $20,000', 20000)
ON CONFLICT (vehicle_id, content_hash) DO NOTHING;
INSERT INTO public.auction_comments (auction_event_id, vehicle_id, platform, source_url, content_hash, source_comment_id, posted_at, author_username, comment_type, comment_text)
VALUES ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'cars_and_bids',
  'https://carsandbids.com/auctions/AbCd1234/test-car', 'whatever-the-reader-sent', 'Held0001', '2026-06-01T17:00:00Z', 'lister4', 'observation', 'Nice car')
ON CONFLICT (vehicle_id, content_hash) DO NOTHING;
SELECT pg_temp.ok('a re-read of a held comment, new-key or legacy-key, never forks it',
  (SELECT count(*) = 2 FROM public.auction_comments WHERE vehicle_id = '10000000-0000-4000-8000-000000000002'));
SELECT pg_temp.ok('the held legacy comment keeps its legacy key',
  EXISTS (SELECT 1 FROM public.auction_comments WHERE content_hash = 'cab_10000000-0000-4000-8000-000000000002_Held0001'));

-- 2. The C&B comment bid is in the record once, linked to its comment, with its source-posted time and USD
SELECT pg_temp.ok('a C&B bid comment writes one bid row with platform, lot, comment, identity, amount, currency and clocks',
  (SELECT count(*) = 1 AND bool_and(platform = 'cars_and_bids' AND auction_event_id = '30000000-0000-4000-8000-000000000002'
     AND auction_comment_id IS NOT NULL AND source_comment_id = '3vQXROVO' AND bidder_external_identity_id = '20000000-0000-4000-8000-000000000002'
     AND currency = 'USD' AND bid_timestamp = '2026-06-02T18:00:00Z' AND bid_timestamp_basis = 'source_posted'
     AND source = 'auction_comments' AND source_recorded_at IS NOT NULL AND created_at IS NOT NULL
     AND source_url = 'https://carsandbids.com/auctions/AbCd1234/test-car' AND source_listing_id = 'AbCd1234')
   FROM public.external_auction_bids WHERE bid_amount = 20000));

-- 3. BaT: the same handle, a bid in the comment stream twice (a sequence-shifted re-read), in bat_bids, and in EUR
INSERT INTO public.auction_comments (auction_event_id, vehicle_id, platform, source_url, content_hash, sequence_number, posted_at, author_username, comment_type, comment_text, bid_amount, bat_comment_id)
VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'bat', 'https://bringatrailer.com/listing/test-lot/', 'bat-hash-seq-1', 1,
   '2026-05-01T16:00:00Z', 'driver9', 'bid', 'USD $15,000 bid placed by driver9', 15000, 9001),
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'bat', 'https://bringatrailer.com/listing/test-lot/', 'bat-hash-seq-2', 2,
   '2026-05-01T16:00:00Z', 'driver9', 'bid', 'USD $15,000 bid placed by driver9', 15000, 9001),
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'bat', 'https://bringatrailer.com/listing/test-lot/', 'bat-hash-eur', 3,
   '2026-05-01T17:00:00Z', 'anonymous', 'bid', 'EUR €16,000 bid placed by anonymous', 16000, 9002);
INSERT INTO public.auction_comments (auction_event_id, vehicle_id, platform, source_url, content_hash, sequence_number, posted_at, author_username, comment_type, comment_text, bid_amount)
VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'bat', 'https://bringatrailer.com/listing/test-lot/', 'bat-hash-seq-4', 4,
   '2026-05-01T18:00:00Z', 'driver9', 'bid', 'USD $17,000 bid placed by driver9', 17000);
SELECT pg_temp.ok('a bid repeated in auction_comments is one bid row, not two',
  (SELECT count(*) FROM public.auction_comments WHERE platform = 'bat' AND bid_amount = 15000) = 2
  AND (SELECT count(*) FROM public.external_auction_bids WHERE platform = 'bat' AND bid_amount = 15000) = 1);
SELECT pg_temp.ok('BaT bids link the BaT identity of the shared handle and BaT''s own comment id',
  (SELECT bidder_external_identity_id = '20000000-0000-4000-8000-000000000001' AND source_comment_id = '9001' AND currency = 'USD'
   FROM public.external_auction_bids WHERE platform = 'bat' AND bid_amount = 15000));
SELECT pg_temp.ok('a EUR bid keeps EUR and an anonymous bidder stays unkeyed',
  (SELECT currency = 'EUR' AND bidder_external_identity_id IS NULL FROM public.external_auction_bids WHERE bid_amount = 16000));

INSERT INTO public.bat_bids (id, bat_listing_id, vehicle_id, bat_username, bid_amount, bid_timestamp, source, metadata) VALUES
  ('70000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   'driver9', 15000, '2026-05-01T16:00:00Z', 'comment', '{"comment_content_hash":"bat-hash-seq-1"}'),
  ('70000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   'driver9', 14000, '2026-05-01T15:00:00Z', 'bid_history', '{}');
SELECT pg_temp.ok('bat_bids merge onto the comment bid and add a bid only bat_bids holds',
  (public.record_external_auction_bids('bat_bids', ARRAY['70000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002']::uuid[])
     = '{"source":"bat_bids","ids":2,"candidates":2,"inserted":1,"merged":1}'::jsonb));
SELECT pg_temp.ok('the merged row carries both origins; the bat_bids-only bid keys its lot by slug and keeps its bid-list time',
  (SELECT bat_bid_id = '70000000-0000-4000-8000-000000000001' AND auction_comment_id IS NOT NULL AND source = 'auction_comments'
   FROM public.external_auction_bids WHERE platform = 'bat' AND bid_amount = 15000)
  AND (SELECT auction_event_id = '30000000-0000-4000-8000-000000000001' AND bid_timestamp_basis = 'source_bid_list' AND source = 'bat_bids'
       AND bidder_external_identity_id = '20000000-0000-4000-8000-000000000001'
       FROM public.external_auction_bids WHERE platform = 'bat' AND bid_amount = 14000));
SELECT pg_temp.ok('a repeat call changes nothing',
  (public.record_external_auction_bids('bat_bids', ARRAY['70000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002']::uuid[])
     = '{"source":"bat_bids","ids":2,"candidates":2,"inserted":0,"merged":0}'::jsonb));

-- 4. C&B bid_history: a bid also in the comments merges; one only the list holds is added with no invented time
UPDATE public.auction_events SET bid_history = '[{"id":"3vQXROVO","amount":20000,"bidder":"driver9","bid_number":1},
  {"amount":23000,"bidder":"lister4","bid_number":4},{"amount":"bad","bidder":"x"},{"amount":24000,"bidder":""}]'::jsonb,
  scraped_at = '2026-06-03T00:00:00Z' WHERE id = '30000000-0000-4000-8000-000000000002';
SELECT pg_temp.ok('bid_history merges its known bid and adds the other',
  (public.record_external_auction_bids('bid_history', ARRAY['30000000-0000-4000-8000-000000000002']::uuid[])
     = '{"source":"bid_history","ids":1,"candidates":2,"inserted":1,"merged":1}'::jsonb));
SELECT pg_temp.ok('the list-only bid has no time, no basis, its bid number, raw element and identity',
  (SELECT bid_timestamp IS NULL AND bid_timestamp_basis IS NULL AND bid_number = 4 AND raw_data->>'bidder' = 'lister4'
     AND bidder_external_identity_id = '20000000-0000-4000-8000-000000000003' AND source = 'auction_events.bid_history'
   FROM public.external_auction_bids WHERE bid_amount = 23000)
  AND (SELECT bid_number = 1 AND bid_timestamp_basis = 'source_posted' FROM public.external_auction_bids WHERE bid_amount = 20000));

-- 5. Legacy rows: a duplicate is superseded, the rest gain their lot key with an unverified time
SELECT pg_temp.ok('legacy rows are keyed or superseded, never deleted',
  (public.record_external_auction_bids('legacy', ARRAY['60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000002',
     '60000000-0000-4000-8000-000000000003']::uuid[])
     = '{"source":"legacy","ids":3,"candidates":3,"keyed":2,"superseded":1,"unresolved":0}'::jsonb));
SELECT pg_temp.ok('the keyed legacy bid says its time is unverified; the second copy points at the first',
  (SELECT auction_event_id = '30000000-0000-4000-8000-000000000002' AND bid_timestamp_basis = 'unverified' AND currency = 'USD'
     AND bidder_external_identity_id = '20000000-0000-4000-8000-000000000003'
   FROM public.external_auction_bids WHERE id = '60000000-0000-4000-8000-000000000002')
  AND (SELECT superseded_by = '60000000-0000-4000-8000-000000000002' FROM public.external_auction_bids WHERE id = '60000000-0000-4000-8000-000000000003'));
INSERT INTO public.auction_comments (auction_event_id, vehicle_id, platform, source_url, content_hash, source_comment_id, posted_at, author_username, comment_type, comment_text, bid_amount)
VALUES ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'cars_and_bids',
  'https://carsandbids.com/auctions/AbCd1234/test-car', 'x', 'Kq9xZ2aB', '2026-06-02T19:00:00Z', 'lister4', 'bid', 'Bid $22,000', 22000);
SELECT pg_temp.ok('a source-posted comment time replaces the unverified one and the replaced value is kept',
  (SELECT bid_timestamp = '2026-06-02T19:00:00Z' AND bid_timestamp_basis = 'source_posted' AND auction_comment_id IS NOT NULL
     AND (raw_data->>'replaced_bid_timestamp')::timestamptz = '2026-02-14T00:34:07Z' AND raw_data->>'replaced_bid_timestamp_basis' = 'unverified'
   FROM public.external_auction_bids WHERE id = '60000000-0000-4000-8000-000000000002')
  AND (SELECT left(content_hash, 12) = '28a9eb357f90' FROM public.auction_comments WHERE source_comment_id = 'Kq9xZ2aB'));

-- 6. Platforms whose comment 'bid' rows are not placed bids are not admitted; rows are never deleted; lots carry bids on a merge
INSERT INTO public.auction_comments (auction_event_id, vehicle_id, platform, content_hash, posted_at, author_username, comment_type, comment_text, bid_amount)
VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'pcarmarket', 'pcar-sold', now(), 'someone', 'bid', 'Sold $99,000', 99000);
SELECT pg_temp.ok('a pcarmarket ''Sold'' row typed bid is not a bid on record',
  NOT EXISTS (SELECT 1 FROM public.external_auction_bids WHERE bid_amount = 99000));
DO $$ BEGIN
  DELETE FROM public.external_auction_bids WHERE platform = 'cars_and_bids';
  RAISE EXCEPTION 'delete was allowed';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%never deleted%' THEN RAISE; END IF;
END $$;
SELECT pg_temp.ok('delete is refused', (SELECT count(*) FROM public.external_auction_bids WHERE platform = 'cars_and_bids') = 5);
UPDATE public.auction_events SET vehicle_id = '10000000-0000-4000-8000-000000000003' WHERE id = '30000000-0000-4000-8000-000000000001';
SELECT pg_temp.ok('a lot moved to another vehicle carries its bids',
  (SELECT bool_and(vehicle_id = '10000000-0000-4000-8000-000000000003') FROM public.external_auction_bids WHERE auction_event_id = '30000000-0000-4000-8000-000000000001'));

-- 7. One handle on both houses is two bidders; the cross-house reader counts each bid once per platform
SELECT pg_temp.ok('driver9 is two identities with platform kept, each with its own house''s bids',
  (SELECT array_agg(platform || ':' || n ORDER BY platform) = ARRAY['bat:3', 'cars_and_bids:2']
   FROM (SELECT xi.platform, count(*) n FROM public.external_auction_bids b
         JOIN public.external_identities xi ON xi.id = b.bidder_external_identity_id
         WHERE xi.handle = 'driver9' AND b.superseded_by IS NULL AND b.auction_event_id IS NOT NULL
           AND b.platform = xi.platform GROUP BY xi.platform) s));
SELECT pg_temp.ok('a comment row backs at most one current bid row',
  NOT EXISTS (SELECT auction_comment_id FROM public.external_auction_bids WHERE auction_comment_id IS NOT NULL AND superseded_by IS NULL
              GROUP BY auction_comment_id HAVING count(*) > 1));
SELECT pg_temp.ok('the writer is not callable by anon or authenticated',
  NOT has_function_privilege('anon', 'public.record_external_auction_bids(text, uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.record_external_auction_bids(text, uuid[])', 'EXECUTE'));
SELECT pg_temp.ok('the record is registered with its writer',
  EXISTS (SELECT 1 FROM public.pipeline_registry WHERE table_name = 'external_auction_bids' AND owned_by = 'record_external_auction_bids'));

-- 8. A bid comment re-pointed to a second lot row of the same auction takes its bid along, never counting it twice
INSERT INTO public.auction_events (id, vehicle_id, source, source_url, source_listing_id, bid_history) VALUES
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'cars_and_bids',
   'https://carsandbids.com/auctions/AbCd1234/test-car-2', 'AbCd1234', '[{"amount":22000,"bidder":"lister4"}]');
SELECT pg_temp.ok('the second lot row''s list records its copy of a bid the first lot holds',
  (public.record_external_auction_bids('bid_history', ARRAY['30000000-0000-4000-8000-000000000003']::uuid[]))->>'inserted' = '1');
UPDATE public.auction_comments SET auction_event_id = '30000000-0000-4000-8000-000000000003'
WHERE source_comment_id IN ('3vQXROVO', 'Kq9xZ2aB');
SELECT pg_temp.ok('a moved bid comment''s bid row moves to the new lot',
  (SELECT count(*) = 1 AND bool_and(auction_event_id = '30000000-0000-4000-8000-000000000003'
     AND source_url = 'https://carsandbids.com/auctions/AbCd1234/test-car-2' AND vehicle_id = '10000000-0000-4000-8000-000000000002')
   FROM public.external_auction_bids WHERE bid_amount = 20000 AND superseded_by IS NULL));
SELECT pg_temp.ok('where the new lot already holds the bid, the old row is superseded and the holder gains the comment',
  (SELECT count(*) = 1 FROM public.external_auction_bids WHERE bid_amount = 22000 AND bidder_username = 'lister4' AND superseded_by IS NULL)
  AND (SELECT superseded_by IS NOT NULL FROM public.external_auction_bids WHERE id = '60000000-0000-4000-8000-000000000002')
  AND (SELECT auction_comment_id = (SELECT id FROM public.auction_comments WHERE source_comment_id = 'Kq9xZ2aB')
       AND auction_event_id = '30000000-0000-4000-8000-000000000003'
       FROM public.external_auction_bids WHERE bid_amount = 22000 AND bidder_username = 'lister4' AND superseded_by IS NULL));
SELECT pg_temp.ok('the repair source finds nothing left to move',
  (public.record_external_auction_bids('comment_lot_moves', ARRAY(SELECT id FROM public.auction_comments WHERE platform = 'cars_and_bids')))
    @> '{"moved":0,"superseded":0,"inserted":0,"merged":0}'::jsonb);
SELECT pg_temp.ok('after the moves every comment still backs at most one current bid row',
  NOT EXISTS (SELECT auction_comment_id FROM public.external_auction_bids WHERE auction_comment_id IS NOT NULL AND superseded_by IS NULL
              GROUP BY auction_comment_id HAVING count(*) > 1));
