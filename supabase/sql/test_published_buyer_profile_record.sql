-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d
-- dm_refinement_published_buyer -f this-file.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.auction_comments') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;

CREATE TABLE public.external_identities (id uuid PRIMARY KEY,platform text,handle text,
  UNIQUE(platform,handle));
CREATE TABLE public.bat_user_profiles (
  username text PRIMARY KEY, total_comments integer DEFAULT 0,total_bids integer DEFAULT 0,
  total_wins integer DEFAULT 0,total_questions integer DEFAULT 0,
  avg_bid_amount numeric,max_bid_amount numeric,min_bid_amount numeric,win_rate numeric,
  bidding_strategy text,typical_price_range jsonb,community_trust_score numeric DEFAULT 0,
  avg_likes_received numeric,expertise_score numeric DEFAULT 0,
  first_seen timestamptz,last_seen timestamptz,updated_at timestamptz DEFAULT now(),
  metadata jsonb DEFAULT '{}'
);
CREATE TABLE public.auction_comments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,source_key text UNIQUE,
  platform text,author_username text,bat_author_id bigint,comment_type text,
  source_url text,vehicle_id uuid,bid_amount numeric,has_question boolean,
  hours_until_close numeric,author_total_likes integer,bat_author_likes integer,
  posted_at timestamptz,created_at timestamptz DEFAULT now(),comment_text text
);
CREATE INDEX ON public.auction_comments(platform,author_username);
CREATE TABLE public.bat_listings (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehicle_id uuid,bat_listing_url text UNIQUE,listing_status text,buyer_username text);
CREATE TABLE public.pipeline_registry (table_name text,column_name text,owned_by text,
  description text,do_not_write_directly boolean,write_via text,UNIQUE(table_name,column_name));
CREATE FUNCTION public.update_user_profile_from_comment() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trigger_update_user_profile AFTER INSERT ON public.auction_comments
FOR EACH ROW EXECUTE FUNCTION public.update_user_profile_from_comment();
\ir ../migrations/20261004031541_key_bat_profile_comment_fold.sql

INSERT INTO public.external_identities VALUES
 ('00000000-0000-0000-0000-000000000001','bat','winner'),
 ('00000000-0000-0000-0000-000000000002','carsandbids','winner');
INSERT INTO public.bat_listings(vehicle_id,bat_listing_url,listing_status,buyer_username)
VALUES
 ('10000000-0000-0000-0000-000000000001','https://bringatrailer.com/listing/first/','sold','winner'),
 ('10000000-0000-0000-0000-000000000001','https://bringatrailer.com/listing/first','sold','winner'),
 ('10000000-0000-0000-0000-000000000001','https://bringatrailer.com/listing/relist/','sold','winner'),
 ('10000000-0000-0000-0000-000000000002','https://bringatrailer.com/listing/unsold/','no_sale',NULL),
 ('10000000-0000-0000-0000-000000000003','https://bringatrailer.com/listing/unknown/','sold',NULL),
 ('10000000-0000-0000-0000-000000000004','https://bringatrailer.com/listing/open/','active','winner'),
 ('10000000-0000-0000-0000-000000000005','https://bringatrailer.com/listing/conflict/','sold','winner'),
 ('10000000-0000-0000-0000-000000000005','https://bringatrailer.com/listing/conflict','sold','other'),
 ('10000000-0000-0000-0000-000000000006','https://bringatrailer.com/listing/case/','sold','Case');

INSERT INTO public.auction_comments
 (source_key,platform,author_username,comment_type,source_url,vehicle_id,bid_amount,posted_at,comment_text)
VALUES
 ('w-first','bat','winner','bid','https://bringatrailer.com/listing/first/','10000000-0000-0000-0000-000000000001',100,'2026-10-01T12:00:00Z','preserved bid'),
 ('w-repeat','bat','winner','bid','https://bringatrailer.com/listing/first','10000000-0000-0000-0000-000000000001',200,'2026-10-01T13:00:00Z','preserved repeat'),
 ('loser','bat','loser','bid','https://bringatrailer.com/listing/first/','10000000-0000-0000-0000-000000000001',200,'2026-10-01T12:00:00Z','equal maximum is not an award'),
 ('w-relist','bat','winner','bid','https://bringatrailer.com/listing/relist/','10000000-0000-0000-0000-000000000001',300,'2026-10-02T12:00:00Z','same chassis, different presentation'),
 ('w-unsold','bat','winner','bid','https://bringatrailer.com/listing/unsold/','10000000-0000-0000-0000-000000000002',400,'2026-10-03T12:00:00Z','known no sale'),
 ('w-unknown','bat','winner','bid','https://bringatrailer.com/listing/unknown/','10000000-0000-0000-0000-000000000003',500,'2026-10-04T12:00:00Z','missing buyer'),
 ('unknown-only','bat','unknown_only','bid','https://bringatrailer.com/listing/unknown/','10000000-0000-0000-0000-000000000003',600,'2026-10-04T12:00:00Z','unknown is not a loss'),
 ('w-open','bat','winner','bid','https://bringatrailer.com/listing/open/','10000000-0000-0000-0000-000000000004',700,'2026-10-05T12:00:00Z','open is not a result'),
 ('w-conflict','bat','winner','bid','https://bringatrailer.com/listing/conflict/','10000000-0000-0000-0000-000000000005',800,'2026-10-06T12:00:00Z','conflicting published buyers'),
 ('w-wrong-vehicle','bat','winner','bid','https://bringatrailer.com/listing/first/','10000000-0000-0000-0000-000000000009',900,'2026-10-07T12:00:00Z','mismatched vehicle binding'),
 ('w-unlinked','bat','winner','bid','https://bringatrailer.com/listing/unlinked/','10000000-0000-0000-0000-000000000009',1000,'2026-10-07T12:00:00Z','no listing capture'),
 ('w-no-url','bat','winner','bid',NULL,'10000000-0000-0000-0000-000000000009',1100,NULL,'unkeyed source'),
 ('w-sold-summary','bat','winner','sold','https://bringatrailer.com/listing/first/','10000000-0000-0000-0000-000000000001',99999,'2026-10-08T12:00:00Z','result summary is not a bid'),
 ('w-other-platform','carsandbids','winner','bid','https://bringatrailer.com/listing/first/','10000000-0000-0000-0000-000000000001',999999,'2026-10-09T12:00:00Z','other platform'),
 ('observer','bat','observer','observation','https://bringatrailer.com/listing/first/','10000000-0000-0000-0000-000000000001',NULL,'2026-10-01T12:00:00Z','commenting is not bidding'),
 ('case','bat','case','bid','https://bringatrailer.com/listing/case/','10000000-0000-0000-0000-000000000006',100,'2026-10-01T12:00:00Z','preserve exact case');

UPDATE public.bat_user_profiles SET expertise_score=42,metadata='{"preserved":"yes"}',
  first_seen='1990-01-01T00:00:00Z',last_seen='2090-01-01T00:00:00Z',total_comments=999,total_bids=999
WHERE username='winner';

-- A captured NULL status is unknown evidence, even beside a known outcome.
-- An unmatched LEFT JOIN row is different: it is not a captured listing.
INSERT INTO public.bat_listings(vehicle_id,bat_listing_url,listing_status,buyer_username)
VALUES
 ('10000000-0000-0000-0000-000000000010','https://bringatrailer.com/listing/sold-null/','sold','sold_null'),
 ('10000000-0000-0000-0000-000000000010','https://bringatrailer.com/listing/sold-null',NULL,'sold_null'),
 ('10000000-0000-0000-0000-000000000011','https://bringatrailer.com/listing/no-sale-null/','no_sale',NULL),
 ('10000000-0000-0000-0000-000000000011','https://bringatrailer.com/listing/no-sale-null',NULL,NULL);
INSERT INTO public.auction_comments
 (source_key,platform,author_username,comment_type,source_url,vehicle_id,bid_amount,posted_at)
VALUES
 ('sold-null','bat','sold_null','bid','https://bringatrailer.com/listing/sold-null/',
  '10000000-0000-0000-0000-000000000010',100,'2026-10-01T12:00:00Z'),
 ('no-sale-null','bat','no_sale_null','bid','https://bringatrailer.com/listing/no-sale-null/',
  '10000000-0000-0000-0000-000000000011',100,'2026-10-01T12:00:00Z');

\ir ../migrations/20261004040743_published_buyer_profile_record.sql

DO $$ BEGIN
  IF (SELECT total_comments FROM public.bat_user_profiles WHERE username='winner') <> 999 THEN
    RAISE EXCEPTION 'Migration executed an unauthorized historical replay';
  END IF;
END $$;

SELECT public.refresh_bat_user_profile('winner');
SELECT public.refresh_bat_user_profile('loser');
SELECT public.refresh_bat_user_profile('unknown_only');
SELECT public.refresh_bat_user_profile('observer');
SELECT public.refresh_bat_user_profile('case');
SELECT public.refresh_bat_user_profile('sold_null');
SELECT public.refresh_bat_user_profile('no_sale_null');
DO $$ BEGIN
  IF (SELECT count(*) FROM public.bat_user_profiles
      WHERE username IN ('sold_null','no_sale_null') AND total_wins IS NULL AND win_rate IS NULL
        AND metadata#>>'{bat_bidder_record,eligible_closed_presentations}' = '0'
        AND metadata#>>'{bat_bidder_record,unknown_outcome_presentations}' = '1') <> 2 THEN
    RAISE EXCEPTION 'Captured NULL duplicate outcomes became a published win or a loss';
  END IF;
END $$;
DO $$ DECLARE r public.bat_user_profiles%ROWTYPE; BEGIN
  SELECT * INTO r FROM public.bat_user_profiles WHERE username='winner';
  IF r.total_comments <> 11 OR r.total_bids <> 10 OR r.total_wins <> 2 OR r.win_rate <> 0.6667
    OR r.max_bid_amount <> 1100 OR r.min_bid_amount <> 100
    OR r.community_trust_score IS NOT NULL
    OR r.first_seen <> '2026-10-01T12:00:00Z' OR r.last_seen <> '2026-10-08T12:00:00Z'
    OR r.external_identity_id <> '00000000-0000-0000-0000-000000000001'
    OR r.expertise_score <> 42 OR r.metadata->>'preserved' <> 'yes' THEN
    RAISE EXCEPTION 'Published-award grain, counts, replay clocks, key or unrelated state failed: %',to_jsonb(r);
  END IF;
  IF r.metadata#>>'{bat_bidder_record,eligible_closed_presentations}' <> '3'
    OR r.metadata#>>'{bat_bidder_record,unknown_outcome_presentations}' <> '3'
    OR r.metadata#>>'{bat_bidder_record,unlinked_presentations}' <> '1'
    OR r.metadata#>>'{bat_bidder_record,unkeyed_bid_comments}' <> '1' THEN
    RAISE EXCEPTION 'Unknown and unlinked coverage must remain explicit: %',r.metadata;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bat_user_profiles WHERE username='loser' AND total_wins=0 AND win_rate=0)
    OR NOT EXISTS (SELECT 1 FROM public.bat_user_profiles WHERE username='unknown_only' AND total_wins IS NULL AND win_rate IS NULL)
    OR NOT EXISTS (SELECT 1 FROM public.bat_user_profiles WHERE username='observer' AND total_wins IS NULL AND win_rate IS NULL)
    OR NOT EXISTS (SELECT 1 FROM public.bat_user_profiles WHERE username='case' AND total_wins=0 AND win_rate=0)
    OR (SELECT comment_text FROM public.auction_comments WHERE source_key='w-first') <> 'preserved bid' THEN
    RAISE EXCEPTION 'Participant own-max, unknown result, observer, case or testimony contract failed';
  END IF;
END $$;

-- Refresh does not undo the forward count recipe: bid-kind NULL amounts count,
-- result summaries do not. A later replay returns the same counts and key.
INSERT INTO public.auction_comments
 (source_key,platform,author_username,comment_type,source_url,vehicle_id,bid_amount,posted_at)
VALUES ('new-null-amount','bat','winner','bid','https://bringatrailer.com/listing/relist/',
 '10000000-0000-0000-0000-000000000001',NULL,'2026-10-10T12:00:00Z');
SELECT public.refresh_bat_user_profile('winner');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.bat_user_profiles WHERE username='winner'
    AND total_comments=12 AND total_bids=11 AND total_wins=2 AND win_rate=0.6667
    AND external_identity_id='00000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'Forward and replay recipes disagree';
  END IF;
END $$;
SELECT public.refresh_bat_user_profile(NULL);
SELECT public.refresh_bat_user_profile('Unknown');
SELECT public.refresh_bat_user_profile('   ');
SELECT 'PASS: published awards, presentation grain, outcome coverage, exact source/author, NULL metrics, replay/forward compatibility' AS result;
