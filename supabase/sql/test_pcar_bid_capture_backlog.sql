\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%' OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='auth')
 OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
 RAISE EXCEPTION 'Requires empty disposable database'; END IF;
END $$;
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE live_auction_sources(id uuid PRIMARY KEY,slug text);
CREATE TABLE vehicles(id uuid PRIMARY KEY,deleted_at timestamptz);
CREATE TABLE monitored_auctions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_id uuid,vehicle_id uuid,external_auction_url text,bid_count integer,is_live boolean,auction_end_time timestamptz);
CREATE TABLE vehicle_observations(vehicle_id uuid,kind text,source_identifier text,source_url text,is_superseded boolean DEFAULT false);
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %',label; END IF; RAISE NOTICE 'PASS %',label; END $$;
INSERT INTO live_auction_sources VALUES ('00000000-0000-0000-0000-000000000001','pcarmarket'),('00000000-0000-0000-0000-000000000002','other');
INSERT INTO vehicles SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,NULL FROM generate_series(1,12) i;
INSERT INTO monitored_auctions(source_id,vehicle_id,external_auction_url,bid_count,is_live,auction_end_time)
 SELECT '00000000-0000-0000-0000-000000000001',id,'https://pcarmarket.com/auction/'||id,2,true,now()+interval '1 day' FROM vehicles;
\ir ../migrations/20261108183800_pcar_bid_capture_backlog.sql
SELECT pg_temp.ok('default cap8',(SELECT count(*)=8 FROM pcarmarket_bid_capture_backlog()));
SELECT pg_temp.ok('failed/capped read remains eligible',(SELECT count(*)=12 FROM pcarmarket_bid_capture_backlog(32)));
INSERT INTO vehicle_observations(vehicle_id,kind,source_identifier,source_url) SELECT vehicle_id,'bid','pcarmarket-bid:one-'||vehicle_id,url FROM pcarmarket_bid_capture_backlog(32);
SELECT pg_temp.ok('partial admission still debt',(SELECT count(*)=12 AND min(retained_bids)=1 FROM pcarmarket_bid_capture_backlog(32)));
INSERT INTO vehicle_observations(vehicle_id,kind,source_identifier,source_url) SELECT vehicle_id,kind,source_identifier,source_url FROM vehicle_observations;
INSERT INTO vehicle_observations(vehicle_id,kind,source_identifier,source_url) SELECT id,'bid','pcarmarket-bid:other-'||id,'https://pcarmarket.com/auction/other' FROM vehicles;
SELECT pg_temp.ok('exact lot and distinct ids',(SELECT count(*)=12 AND max(retained_bids)=1 FROM pcarmarket_bid_capture_backlog(32)));
INSERT INTO vehicle_observations(vehicle_id,kind,source_identifier,source_url) SELECT vehicle_id,'bid','pcarmarket-bid:two-'||vehicle_id,replace(url,'https://','https://www.')||'/' FROM pcarmarket_bid_capture_backlog(8);
UPDATE vehicle_observations SET is_superseded=true WHERE source_identifier LIKE 'pcarmarket-bid:two-%';
SELECT pg_temp.ok('superseded evidence does not repay debt',(SELECT count(*)=12 FROM pcarmarket_bid_capture_backlog(32)));
UPDATE vehicle_observations SET is_superseded=false;
SELECT pg_temp.ok('next run drains remainder despite unchanged board count',(SELECT count(*)=4 FROM pcarmarket_bid_capture_backlog(32)));
UPDATE monitored_auctions SET is_live=false,auction_end_time=now()-interval '1 hour';
SELECT pg_temp.ok('recent close retains known debt',(SELECT count(*)=4 FROM pcarmarket_bid_capture_backlog(32)));
UPDATE monitored_auctions SET auction_end_time=now()-interval '8 days';
SELECT pg_temp.ok('bounded historical horizon',(SELECT count(*)=0 FROM pcarmarket_bid_capture_backlog(32)));
UPDATE monitored_auctions SET is_live=true;
UPDATE vehicles SET deleted_at=now();
SELECT pg_temp.ok('deleted cars excluded',(SELECT count(*)=0 FROM pcarmarket_bid_capture_backlog(32)));
UPDATE vehicles SET deleted_at=NULL;
UPDATE monitored_auctions SET source_id='00000000-0000-0000-0000-000000000002';
SELECT pg_temp.ok('source scoped',(SELECT count(*)=0 FROM pcarmarket_bid_capture_backlog(32)));
SELECT pg_temp.ok('public denied',NOT has_function_privilege('anon','public.pcarmarket_bid_capture_backlog(integer)','execute') AND NOT has_function_privilege('authenticated','public.pcarmarket_bid_capture_backlog(integer)','execute'));
SELECT pg_temp.ok('service only',has_function_privilege('service_role','public.pcarmarket_bid_capture_backlog(integer)','execute'));
\ir ../migrations/20261108183800_pcar_bid_capture_backlog.sql
