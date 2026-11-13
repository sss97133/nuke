-- Disposable only; reuse real existing tape and its privacy/clock tests.
\set ON_ERROR_STOP on
\ir test_live_bid_tape_receipts.sql
CREATE TABLE listing_feeds(source_slug text,enabled boolean,last_polled_at timestamptz,last_error text,feed_url text,search_criteria jsonb);
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE cron.job(jobname text,active boolean);
INSERT INTO cron.job VALUES ('cars-and-bids-15m',false),('SECRET_JOB',false);
INSERT INTO listing_feeds VALUES
 ('bat',true,now(),null,null,null),
 ('govdeals',true,now(),'parsed_zero: SECRET_ERROR','https://SECRET_FEED', '{"secret":"SECRET_CONFIG"}'),
 ('carsandbids',true,now(),null,null,null),
 ('barrettjackson',true,now(),null,null,null),
 ('barrettjackson',false,now(),'SECRET_DISABLED_ERROR',null,null),
 ('rmsothebys',true,now(),'fetch_failed: SECRET_ERROR',null,null),
 ('allcollectorcars',true,now(),'intake_backoff: billing',null,null),
 ('autohunter',false,now(),'SECRET_ERROR',null,null),
 ('private_customer_feed',true,now(),'SECRET_ERROR',null,null);
SET statement_timeout='3s';
SET lock_timeout='1s';
INSERT INTO live_auction_sources VALUES ('bat',jsonb_build_object('live_board',jsonb_build_object('last_run',jsonb_build_object('at',now(),'lots',123))),NULL);
\ir ../migrations/20261109003357_auction_source_status_catalog.sql
\ir ../migrations/20261109003357_auction_source_status_catalog.sql
DO $$ DECLARE r jsonb:=live_bid_tape(5); BEGIN
 IF current_setting('statement_timeout')<>'3s' OR current_setting('lock_timeout')<>'1s' THEN RAISE EXCEPTION 'Caller budgets changed'; END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(r->'source_status') s WHERE s->>'house'='bringatrailer' AND s->>'lots'='123' AND s->>'read_at' IS NOT NULL) THEN RAISE EXCEPTION 'Native BaT alias lost inventory clock'; END IF;
 IF r::text LIKE '%SECRET%' OR r::text LIKE '%private_customer%' THEN RAISE EXCEPTION 'Private status leaked'; END IF;
 IF jsonb_array_length(r->'bids')<>8 THEN RAISE EXCEPTION 'Existing receipts changed'; END IF;
 IF NOT (r->'sources' ? 'govdeals' AND r->'sources' ? 'rm-sothebys' AND r->'sources' ? 'allcollectorcars') THEN RAISE EXCEPTION 'Configured sources disappeared'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(r->'source_status') s WHERE s->>'house'='govdeals' AND (s->>'read_at' IS NOT NULL OR s->>'lots' IS NOT NULL)) THEN RAISE EXCEPTION 'Discovery clock became inventory'; END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(r->'source_status') s WHERE s->>'house'='govdeals' AND s->>'discovery_state'='no_listings_parsed' AND s->>'discovery_attempt_at' IS NOT NULL) THEN RAISE EXCEPTION 'Missing parse failure'; END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(r->'source_status') s WHERE s->>'house'='cars-and-bids' AND s->>'collection_state'='paused') THEN RAISE EXCEPTION 'Missing explicit collector pause'; END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(r->'source_status') s WHERE s->>'house'='barrett-jackson' AND s->>'discovery_state'='unverified') THEN RAISE EXCEPTION 'Disabled historical error mislabeled active source'; END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(r->'source_status') s WHERE s->>'house'='autohunter' AND s->>'discovery_state'='disabled') THEN RAISE EXCEPTION 'Disabled feed lost'; END IF;
 RAISE NOTICE 'PASS public source status allowlist, paused/disabled/error semantics, distinct discovery clocks and original receipt privacy';
END $$;

DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; END $$;
SET ROLE anon;
DO $$ BEGIN IF NOT (public.live_bid_tape(5)->'sources' ? 'govdeals') THEN RAISE EXCEPTION 'Anonymous status unavailable'; END IF; END $$;
RESET ROLE;
