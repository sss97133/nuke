-- Disposable PG17 only. Fixtures are read-only JSON views, never testimony DML.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int/10000<>17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable PG17';
  END IF;
  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END $$;
CREATE FUNCTION public.header_fixture() RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT current_setting('test.header_fixture')::jsonb $$;
CREATE VIEW public.vehicles WITH(security_invoker=true) AS
 SELECT * FROM jsonb_to_recordset(header_fixture()->'vehicles')
 AS v(id uuid,is_public boolean,deleted_at timestamptz,listing_kind text,year int,make text,model text);
CREATE VIEW public.vehicle_events WITH(security_invoker=true) AS
 SELECT * FROM jsonb_to_recordset(header_fixture()->'events')
 AS e(id uuid,vehicle_id uuid,source_platform text,event_type text,event_status text,
   source_organization_id uuid,duplicate_of_event_id uuid,source_listing_id text,
   source_url text,ended_at timestamptz,metadata jsonb);
CREATE VIEW public.vehicle_observations WITH(security_invoker=true) AS
 SELECT * FROM jsonb_to_recordset(header_fixture()->'observations')
 AS o(id uuid,vehicle_id uuid,source_id uuid,source_identifier text,kind text,is_superseded boolean,
   source_url text,structured_data jsonb,observed_at timestamptz,ingested_at timestamptz);
CREATE VIEW public.organizations WITH(security_invoker=true) AS
 SELECT * FROM jsonb_to_recordset(header_fixture()->'organizations')
 AS o(id uuid,business_name text,logo_url text,is_public boolean,is_active boolean);
CREATE VIEW public.observation_sources WITH(security_invoker=true) AS
 SELECT (header_fixture()->>'publisher_source_id')::uuid id, 'mccormicks'::text slug;
CREATE VIEW public.listing_feeds WITH(security_invoker=true) AS
 SELECT 1 id,'mccormicks'::text source_slug,'https://www.classic-carauction.com/Home'::text feed_url,
   jsonb_build_object('organization_id',header_fixture()#>>'{organizations,0,id}',
     'fetch_strategy','mccormick_live') search_criteria,
   (header_fixture()->>'checked_at')::timestamptz last_polled_at,
   CASE WHEN (header_fixture()->>'refresh_failed')::boolean THEN 'fixture error' END last_error;
CREATE VIEW public.source_census WITH(security_invoker=true) AS
 SELECT '70000000-0000-0000-0000-000000000001'::uuid id,
   (header_fixture()->>'publisher_source_id')::uuid source_id,
   'house_roster_facet'::text census_method,
   (CASE WHEN (header_fixture()->>'stale')::boolean THEN now()-interval '2 hours'
     ELSE (header_fixture()->>'checked_at')::timestamptz END) census_at,
   jsonb_build_object('method','mccormick_live_v1','organization_id',header_fixture()#>>'{organizations,0,id}',
     'inventory',header_fixture()->'inventory','sales',
       (SELECT jsonb_object_agg(s->>'sale_key',s) FROM jsonb_array_elements(header_fixture()->'sales') s)) raw_response;

-- Existing-owner signatures and replacement anchors; the migration's entire header
-- query is executed, not a separately rewritten classifier. Unrelated profile facets
-- stay in test_vehicle_profile_read.sql / test_native_listing_profile_evidence.sql.
\ir helpers/organization_source_inventory_header_baseline.sql
CREATE FUNCTION public.vehicle_listing_state(uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT NULL::jsonb $$;
CREATE FUNCTION public.vehicle_profile_read(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=public,pg_temp SET timezone='UTC' AS $$
WITH v AS (SELECT * FROM public.vehicles WHERE id=p_vehicle_id AND is_public AND deleted_at IS NULL)
SELECT jsonb_build_object('sections',jsonb_build_array(jsonb_build_object(
 'kind','masthead','listing', public.vehicle_listing_state(v.id)))) FROM v $$;
REVOKE ALL ON public.organizations FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.vehicle_profile_read(uuid),public.organization_source_inventory_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_profile_read(uuid),public.organization_source_inventory_read(uuid) TO anon;
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT ON public.vehicles,public.vehicle_events,public.vehicle_observations TO anon;

\ir ../migrations/20261113161000_vehicle_auction_header_form.sql
\ir ../migrations/20261113161000_vehicle_auction_header_form.sql

CREATE FUNCTION public.header_base() RETURNS jsonb LANGUAGE sql STABLE AS $$
SELECT jsonb_build_object(
 'publisher_source_id','30000000-0000-0000-0000-000000000001',
 'vehicles',jsonb_build_array(jsonb_build_object('id','10000000-0000-0000-0000-000000000001',
   'is_public',true,'year',2008,'make','Synthetic','model','Convertible')),
 'organizations','[{"id":"20000000-0000-0000-0000-000000000001","business_name":"Fixture Auctions","logo_url":null,"is_public":true,"is_active":true}]'::jsonb,
 'observations','[{"id":"40000000-0000-0000-0000-000000000001","vehicle_id":"10000000-0000-0000-0000-000000000001","source_id":"30000000-0000-0000-0000-000000000001","source_identifier":"auctionid:123:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","kind":"listing","is_superseded":false,"source_url":"https://www.classic-carauction.com/auction-cars?auctionid=123","structured_data":{"source_id":"123","source_claims_only":true,"title":"Synthetic Convertible"}}]'::jsonb,
 'events',jsonb_build_array(jsonb_build_object('id','50000000-0000-0000-0000-000000000001',
   'vehicle_id','10000000-0000-0000-0000-000000000001','source_organization_id','20000000-0000-0000-0000-000000000001',
   'source_platform','mccormicks','source_listing_id','mccormicks-99:123','event_type','auction','event_status','upcoming',
   'source_url','https://www.classic-carauction.com/auction-cars?auctionid=123',
   'ended_at',(current_date+9)::timestamptz+interval '12 hours',
   'metadata',jsonb_build_object('sale_key','mccormicks-99','native_id','123','lot_number','1',
     'projection_method','mccormick_live_v1','ended_at_precision','day','ended_at_method','scheduled_run_day',
     'source_catalog_snapshot_id','60000000-0000-0000-0000-000000000001',
     'source_catalog_sha256',repeat('a',64),'source_observation_id','40000000-0000-0000-0000-000000000001',
     'source_observed_at',now()))),
 'inventory',jsonb_build_array(jsonb_build_object('vehicle_id','10000000-0000-0000-0000-000000000001',
   'native_id','123','sale_key','mccormicks-99','inventory_kind','auction','source_status','scheduled',
   'source_url','https://www.classic-carauction.com/auction-cars?auctionid=123','run_on',current_date+9,
   'title','Synthetic Convertible')),
 'sales',jsonb_build_array(jsonb_build_object('sale_key','mccormicks-99','name','Fixture sale',
   'starts_on',current_date+9,'ends_on',current_date+11,'source_url','https://www.classic-carauction.com/Auction-99')),
 'checked_at',now(),'stale',false,'refresh_failed',false) $$;
CREATE FUNCTION public.header_set(p_doc jsonb) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('test.header_fixture',p_doc::text,false)::text IS NOT NULL; $$;
CREATE FUNCTION public.header_read() RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT nullif(vehicle_profile_read('10000000-0000-0000-0000-000000000001')#>'{sections,0,header_form}','null'::jsonb) $$;
CREATE FUNCTION public.header_item(k text) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT i FROM jsonb_array_elements(header_read()->'items') i WHERE i->>'key'=k $$;

SELECT header_set(header_base());
SET ROLE anon;
DO $$ BEGIN
 ASSERT header_read()->>'form'='auction_acquisition','source appearance chooses existing header form';
 ASSERT header_item('auctioneer')#>>'{value,name}'='Fixture Auctions','brand via approved reader';
 ASSERT NOT has_table_privilege('anon','public.organizations','SELECT'),'no org grant expansion';
 ASSERT NOT has_function_privilege('public','public.vehicle_profile_read(uuid)','EXECUTE'),'function ACL preserved';
 ASSERT NOT has_function_privilege('public','public.organization_source_inventory_read(uuid,text)','EXECUTE'),'scoped reader does not gain PUBLIC access';
 ASSERT NOT EXISTS(SELECT grantee,is_grantable FROM pg_proc p,
   LATERAL aclexplode(p.proacl) a WHERE p.oid='public.organization_source_inventory_read(uuid,text)'::regprocedure
   EXCEPT SELECT grantee,is_grantable FROM pg_proc p,LATERAL aclexplode(p.proacl) a
     WHERE p.oid='public.organization_source_inventory_read(uuid)'::regprocedure),'scoped signature has no additional grantees';
 ASSERT jsonb_array_length(organization_source_inventory_read('20000000-0000-0000-0000-000000000001','123')->'inventory')=1,'native scope returns addressed roster row';
 ASSERT jsonb_array_length(organization_source_inventory_read('20000000-0000-0000-0000-000000000001','999')->'inventory')=0,'native scope cannot substitute a different lot';
 ASSERT (SELECT NOT prosecdef AND provolatile='s' FROM pg_proc
   WHERE oid='public.vehicle_profile_read(uuid)'::regprocedure),'profile stays stable security invoker';
 ASSERT header_item('auctioneer')#>>'{value,role}'='auctioneer','representation never ownership';
 ASSERT header_item('schedule')#>>'{value,days_until}'='9','calendar countdown, not noon hammer timer';
 ASSERT header_item('schedule')#>'{value,exact_lot_time}'='null'::jsonb,'no fabricated exact clock';
 ASSERT header_item('primary_action')#>>'{action,route}'='/valuation','existing internal comparison tool';
 ASSERT header_item('primary_action')#>>'{action,parameters,model}'='Convertible','preserve model key';
 ASSERT header_item('hammer_estimate')->>'status'='not_established','not an invented numeric band';
 ASSERT header_item('hammer_estimate')->'value'='null'::jsonb,'comparison is not a hammer estimate';
 ASSERT header_read()->>'price_scope'='appearance_only','old physical sale cannot price new offer';
END $$;
RESET ROLE;
DO $$ DECLARE b jsonb:=header_base(); f jsonb; s text; BEGIN
 -- Retraction is association invalidation, not withdrawal/sale of the car.
 PERFORM header_set(jsonb_set(b,'{events,0,metadata,withdrawn_at}',to_jsonb(now())));
 ASSERT header_read() IS NULL,'retracted physical binding cannot advertise';
 PERFORM header_set(jsonb_set(b,'{events,0,duplicate_of_event_id}','"50000000-0000-0000-0000-000000000009"'));
 ASSERT header_read() IS NULL,'superseded duplicate excluded';
 PERFORM header_set(jsonb_set(b,'{observations,0,is_superseded}','true'));
 ASSERT header_read() IS NULL,'superseded source excluded';
 PERFORM header_set(jsonb_set(b,'{observations,0,vehicle_id}','"10000000-0000-0000-0000-000000000002"'));
 ASSERT header_read() IS NULL,'source must witness addressed parent';
 PERFORM header_set(jsonb_set(b,'{observations,0,source_id}','"30000000-0000-0000-0000-000000000002"'));
 ASSERT header_read() IS NULL,'witness must come from independently identified publisher';
 PERFORM header_set(jsonb_set(b,'{events,0,metadata,source_observation_id}','"invalid"'));
 ASSERT header_read() IS NULL,'malformed lineage fails closed without breaking profile';
 PERFORM header_set(jsonb_set(b,'{vehicles,0,is_public}','false'));
 ASSERT header_read() IS NULL,'private parent excluded';
 PERFORM header_set(jsonb_set(b,'{vehicles,0,deleted_at}',to_jsonb(now())));
 ASSERT header_read() IS NULL,'deleted parent excluded';
 PERFORM header_set(jsonb_set(b,'{vehicles,0,listing_kind}','"non_vehicle_item"'));
 ASSERT header_read() IS NULL,'nonvehicle excluded';
 PERFORM header_set(jsonb_set(b,'{organizations,0,is_public}','false'));
 ASSERT header_read() IS NULL,'private source organization cannot brand public header';
 PERFORM header_set(jsonb_set(b,'{stale}','true'));
 ASSERT header_item('auction_state')#>>'{value,freshness}'='recheck_required','stale evidence survives qualified';
 PERFORM header_set(jsonb_set(b,'{refresh_failed}','true'));
 ASSERT header_item('auction_state')#>>'{value,freshness}'='recheck_required','failed refresh never freshens';
 PERFORM header_set(jsonb_set(b,'{inventory}','[]'));
 ASSERT header_read()->>'form'='auction_context','disappearance is not a sale';
 ASSERT header_item('auction_state')#>>'{value,offer}'='not_established','missing roster is not current offer';
 f:=jsonb_set(b,'{events,0,ended_at}',to_jsonb(current_date::timestamptz+interval '12 hours'));
 f:=jsonb_set(f,'{inventory,0,run_on}',to_jsonb(current_date));
 PERFORM header_set(f);
 ASSERT header_read()->>'form'='auction_day','calendar day alone never live bidding';
 ASSERT header_item('schedule')#>'{value,days_until}'='null'::jsonb,'no negative/zero live countdown';
 f:=jsonb_set(b,'{events,0,ended_at}',to_jsonb((current_date-1)::timestamptz));
 PERFORM header_set(f);
 ASSERT header_read()->>'form'='auction_awaiting_result','elapsed date never establishes sold';
 FOREACH s IN ARRAY ARRAY['sold','unsold','not sold','bid-goes-on','cancelled','ended'] LOOP
   PERFORM header_set(jsonb_set(f,'{events,0,event_status}',to_jsonb(s)));
   ASSERT header_read()->>'form'='auction_result_context','explicit statuses do not remain acquisition';
   ASSERT header_item('auction_state')#>>'{value,reported}'=s,'native result preserved without coercion';
   ASSERT header_item('auction_state')#>>'{value,offer}'='not_established','result is not new bid invitation';
 END LOOP;
 -- Older sale refreshed later must not outrank the newer unresolved appearance.
 f:=jsonb_set(f,'{events,0,event_status}','"sold"');
 f:=jsonb_set(f,'{events,0,ended_at}',to_jsonb((current_date-10)::timestamptz));
 f:=jsonb_set(f,'{events}',(f->'events')||jsonb_set(jsonb_set(b#>'{events,0}',
   '{id}','"50000000-0000-0000-0000-000000000002"'),'{ended_at}',to_jsonb((current_date-1)::timestamptz)));
 PERFORM header_set(f);
 ASSERT header_read()->>'form'='auction_awaiting_result','appearance chronology, never update clock';
 -- Three equally ranked rows: inspect the entire set, not first two statuses.
 f:=jsonb_set(b,'{events}',(b->'events')||jsonb_set(b#>'{events,0}','{id}','"50000000-0000-0000-0000-000000000002"')
   ||jsonb_set(b#>'{events,0}','{id}','"50000000-0000-0000-0000-000000000003"'));
 PERFORM header_set(f);
 ASSERT header_read()->>'form'='appearance_selection','no arbitrary tie winner';
 ASSERT jsonb_array_length(header_item('appearance')->'candidates')=3,'all tied appearances retained';
 ASSERT header_item('hammer_estimate') IS NULL,'no price context on ambiguous appearance';
 f:=jsonb_set(jsonb_set(f,'{events,0,event_status}','"sold"'),'{events,1,event_status}','"sold"');
 PERFORM header_set(f);
 ASSERT header_read()->>'form'='appearance_selection','two sold rows cannot hide a third upcoming conflict';
 -- Identifier prefilter preserves the original legacy path and parent ambiguity.
 PERFORM header_set(jsonb_set(b,'{observations,0,source_identifier}','"legacy-identifier"'));
 ASSERT header_read()->>'form'='auction_acquisition','legacy identifier retains complete matching';
 f:=jsonb_set(b,'{observations}',(b->'observations')||jsonb_set(jsonb_set(b#>'{observations,0}',
   '{id}','"40000000-0000-0000-0000-000000000002"'),'{vehicle_id}','"10000000-0000-0000-0000-000000000002"'));
 PERFORM header_set(f);
 ASSERT header_read()->>'form'='auction_context','other parent binding cannot establish current offer';
 ASSERT organization_source_inventory_read('20000000-0000-0000-0000-000000000001','123')#>'{inventory,0,vehicle_id}'='null'::jsonb,'scoped reader preserves cross-parent ambiguity';
 PERFORM header_set(jsonb_set(b,'{events,0,event_status}','"unknown"'));
 ASSERT header_read()->>'form'='auction_context','unsupported status never becomes acquisition';
 PERFORM header_set(jsonb_set(b,'{events,0,event_status}','"bid-goes-on"'));
 ASSERT header_item('auction_state')#>>'{value,result_kind}'='continued_offer','continued offer differs from unsuccessful';
 PERFORM header_set(jsonb_set(b,'{events,0,event_status}','"not sold"'));
 ASSERT header_item('auction_state')#>>'{value,result_kind}'='reported_unsuccessful','native unsuccessful status supported';
END $$;
SELECT 'vehicle auction header machine rules: PASS' result;
