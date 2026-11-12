-- Disposable PostgreSQL17 fixture only. Reuses the actual existing board/activity contracts.
\set ON_ERROR_STOP on
\ir test_market_lot_activity.sql
-- Reproduce the later canonical-reader migration's sole activity-body change.
CREATE VIEW public.auction_events_canonical AS SELECT * FROM public.auction_events;
GRANT SELECT ON public.auction_events_canonical TO anon,authenticated,service_role;
DO $canonical$
BEGIN
 EXECUTE replace(pg_get_functiondef('public.market_lot_activity(uuid[],integer)'::regprocedure),
   'FROM public.auction_events e','FROM public.auction_events_canonical e');
END $canonical$;
\ir ../migrations/20261013234500_market_pulse_live_columns.sql
\ir ../migrations/20261013235500_market_pulse_live_heat.sql
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigserial PRIMARY KEY,jobname text UNIQUE,schedule text,command text,active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job(jobname,schedule,command) VALUES($1,$2,$3) RETURNING jobid $$;
\ir ../migrations/20261016171000_market_pulse_live_snapshot.sql
CREATE TABLE vehicle_events(vehicle_id uuid,source_platform text,source_url text,event_status text);
GRANT SELECT ON vehicle_events TO anon,authenticated,service_role;

UPDATE vehicles SET platform_source='barrett-jackson',high_bid=75000,sale_price=121000,
 origin_metadata=jsonb_build_object('platform','bringatrailer','source','bat_auctions_page','last_sync',now())
 WHERE right(id::text,6)::int BETWEEN 6 AND 16;
INSERT INTO vehicle_events SELECT id,'bat',listing_url||'/','active' FROM vehicles WHERE right(id::text,6)::int BETWEEN 6 AND 16;
UPDATE vehicle_events SET source_url='https://bringatrailer.com/listing/prior-episode' WHERE right(vehicle_id::text,6)='000007';
UPDATE vehicle_events SET event_status='ended' WHERE right(vehicle_id::text,6)='000008';
UPDATE vehicles SET origin_metadata=jsonb_set(origin_metadata,'{last_sync}','"not a time"') WHERE right(id::text,6)='000009';
UPDATE vehicles SET origin_metadata=jsonb_set(origin_metadata,'{source}','"unrelated"') WHERE right(id::text,6)='000010';
UPDATE vehicles SET is_public=false WHERE right(id::text,6)='000011';
UPDATE vehicles SET deleted_at=now() WHERE right(id::text,6)='000012';
UPDATE vehicles SET listing_kind='non_vehicle_item' WHERE right(id::text,6)='000013';
UPDATE vehicles SET origin_metadata=jsonb_set(origin_metadata,'{last_sync}',to_jsonb(now()-interval '7 hours')) WHERE right(id::text,6)='000014';
UPDATE vehicles SET origin_metadata=jsonb_set(origin_metadata,'{last_sync}',to_jsonb(now()+interval '1 day')) WHERE right(id::text,6)='000015';
UPDATE vehicles SET high_bid=NULL WHERE right(id::text,6)='000016';
SELECT refresh_market_pulse_live_snapshot();
SELECT assert_contract(NOT EXISTS(SELECT FROM jsonb_array_elements(market_pulse_live()->'auctions') a WHERE right(a->>0,6)='000006'),'mixed-source episode was hidden before the repair');
\ir ../migrations/20261108185556_bat_episode_board_identity.sql
\ir ../migrations/20261108185556_bat_episode_board_identity.sql
SET ROLE anon;
SELECT assert_contract(EXISTS(SELECT FROM jsonb_array_elements(market_pulse_live()->'auctions') a WHERE right(a->>0,6)='000006' AND a->>4='75000'),'anonymous board shows witnessed current BaT episode');
SELECT assert_contract(EXISTS(SELECT FROM jsonb_array_elements(market_pulse_live()->'auctions') a WHERE right(a->>0,6)='000016' AND a->4='null'::jsonb),'historical sale cannot fill unknown current bid');
SELECT assert_contract(NOT EXISTS(SELECT FROM jsonb_array_elements(market_pulse_live()->'auctions') a WHERE right(a->>0,6)::int IN (7,8,9,10,11,12,13,15)),'wrong episode, closed, malformed/future witness, private/deleted/nonvehicle stay excluded');
SELECT assert_contract(jsonb_array_length(market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000006'::uuid])->'lots')=1,'same witnessed episode opens existing evidence reader');
SELECT assert_contract(EXISTS(SELECT FROM jsonb_array_elements(market_pulse_live()->'auctions') a WHERE right(a->>0,6)='000014'),'unchanged native state older than six hours retains episode identity without asserting source freshness');
RESET ROLE;
SELECT assert_contract((SELECT platform_source='barrett-jackson' AND sale_price=121000 FROM vehicles WHERE right(id::text,6)='000006'),'vehicle source identity and historical sale remain unchanged');
