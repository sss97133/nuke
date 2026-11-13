-- Disposable PG17 only; reuse the existing anonymous reader/privacy contracts.
\set ON_ERROR_STOP on
\ir test_bat_board_locator_correlation.sql
ALTER TABLE vehicles ADD COLUMN merged_into_vehicle_id uuid;
ALTER TABLE vehicle_events ADD COLUMN id uuid DEFAULT gen_random_uuid(), ADD COLUMN sold_at timestamptz,
 ADD COLUMN duplicate_of_event_id uuid, ADD COLUMN ended_at timestamptz DEFAULT now()+interval '3 days';
UPDATE vehicle_events SET event_status='active' WHERE right(vehicle_id::text,6)='000200';
UPDATE vehicle_observations SET ingested_at=now()-interval '2 days',
 structured_data=structured_data||jsonb_build_object('received_at',now()-interval '2 days');
UPDATE vehicle_events SET ended_at=now()-interval '1 day' WHERE right(vehicle_id::text,6)='000209';
UPDATE vehicle_events SET sold_at=now() WHERE right(vehicle_id::text,6)='000210';
UPDATE vehicle_events SET event_status='ended' WHERE right(vehicle_id::text,6)='000211';
UPDATE vehicles SET merged_into_vehicle_id=md5('merged')::uuid WHERE right(id::text,6)='000323';
UPDATE vehicle_observations SET ingested_at=now(),structured_data=structured_data||
 jsonb_build_object('received_at',now(),'native_post_id',100201) WHERE right(vehicle_id::text,6)='000201';
UPDATE auction_events SET raw_data=jsonb_set(raw_data,'{source_read,at}',to_jsonb(now()-interval '1 minute')) WHERE right(vehicle_id::text,6)='000201';
-- Preserve duplicate inventory rows without multiplying them in the alias join.
UPDATE market_pulse_live_snapshot SET payload=jsonb_set(payload,'{auctions}',(payload->'auctions')||
 (SELECT jsonb_agg(jsonb_set(a,'{4}','12345')) FROM jsonb_array_elements(payload->'auctions') a WHERE right(a->>0,6)='000317'));
CREATE TEMP TABLE stable_before AS SELECT market_pulse_live() p;
GRANT SELECT ON stable_before TO anon;
\ir ../migrations/20261109032705_bat_stable_board_identity.sql
\ir ../migrations/20261109032705_bat_stable_board_identity.sql
SELECT assert_contract(current_setting('statement_timeout')='3s' AND current_setting('lock_timeout')='1s','inherited stricter budgets restored');
SELECT assert_contract(NOT EXISTS(SELECT FROM previous_acl a JOIN pg_proc p ON p.oid=a.oid WHERE p.proacl IS DISTINCT FROM a.proacl),'grants unchanged');
SET ROLE anon;
SELECT assert_contract((SELECT count(*)=0 FROM observation_sources),'private source registry not exposed');
SELECT assert_contract(EXISTS(SELECT FROM jsonb_array_elements(market_pulse_live()->'auctions')a
 WHERE a->>0='00000000-0000-0000-0000-000000000217' AND a->>10='https://bringatrailer.com/listing/relisted-217'),
 'old exact retained witness links current canonical episode beyond thirty minutes');
SELECT assert_contract((SELECT jsonb_agg(a-0 ORDER BY (a-0)::text)
 FROM jsonb_array_elements((SELECT p->'auctions' FROM stable_before)) a)
 IS NOT DISTINCT FROM (SELECT jsonb_agg(a-0 ORDER BY (a-0)::text)
 FROM jsonb_array_elements(market_pulse_live()->'auctions') a),
 'entire row multiset is exactly equal except vehicle link, including duplicate multiplicity and every quote field');
SELECT assert_contract((SELECT count(*)=2 FROM jsonb_array_elements(market_pulse_live()->'auctions') a
 WHERE a->>10='https://bringatrailer.com/listing/relisted-217'),'two cached payloads retain two rows without alias join multiplication');
SELECT assert_contract(market_pulse_live()#>>'{identity_links,https://bringatrailer.com/listing/relisted-217,basis}'='retained_native_current_episode'
 AND market_pulse_live()#>'{native_state,00000000-0000-0000-0000-000000000217}' IS NULL,'identity provenance never claims native freshness');
SELECT assert_contract(EXISTS(SELECT FROM jsonb_array_elements(market_pulse_live()->'auctions')a WHERE right(a->>0,6)='000201' AND a->>4='9000')
 AND market_pulse_live()#>'{identity_links,https://bringatrailer.com/listing/relisted-201}' IS NULL,'fresh native overlay keeps priority');
SELECT assert_contract(market_pulse_live()#>>'{identity_links,https://bringatrailer.com/listing/relisted-200,refusal_reason}'='multiple_lot_presentations'
 AND EXISTS(SELECT FROM jsonb_array_elements(market_pulse_live()->'auctions')a WHERE right(a->>0,6)='000300'),
 'different cached lot using canonical ID refuses alias and retains locator');
SELECT assert_contract(NOT EXISTS(SELECT FROM jsonb_object_keys(market_pulse_live()->'identity_links') url
 WHERE url NOT IN('https://bringatrailer.com/listing/relisted-200','https://bringatrailer.com/listing/relisted-217')),
 'wrong source/post/url/monitor, private/deleted/merged, ambiguous auction/episode, expired/sold/terminal, withdrawn/unqualified witnesses fail closed');
RESET ROLE;
UPDATE vehicle_events SET vehicle_id='00000000-0000-0000-0000-000000000217',ended_at=now()+interval '3 days' WHERE right(vehicle_id::text,6)='000209';
UPDATE auction_events SET vehicle_id='00000000-0000-0000-0000-000000000217' WHERE right(vehicle_id::text,6)='000209';
UPDATE vehicle_observations SET vehicle_id='00000000-0000-0000-0000-000000000217' WHERE right(vehicle_id::text,6)='000209';
SET ROLE anon;
SELECT assert_contract(market_pulse_live()#>>'{identity_links,https://bringatrailer.com/listing/relisted-217,refusal_reason}'='multiple_lot_presentations'
 AND market_pulse_live()#>>'{identity_links,https://bringatrailer.com/listing/relisted-209,refusal_reason}'='multiple_lot_presentations',
 'two proposed distinct-lot aliases both refuse rather than collapsing cards');
RESET ROLE;
UPDATE market_pulse_live_snapshot SET payload=jsonb_set(payload,'{auctions}',(payload->'auctions')||
 (SELECT jsonb_agg(jsonb_set(a,'{0}','"00000000-0000-0000-0000-000000000399"')) FROM jsonb_array_elements(payload->'auctions') a WHERE right(a->>0,6)='000317'));
SET ROLE anon;
SELECT assert_contract(market_pulse_live()#>>'{identity_links,https://bringatrailer.com/listing/relisted-217,refusal_reason}'='ambiguous_inventory_locator',
 'different cached locators for one URL refuse ambiguous attribution');
RESET ROLE;
UPDATE market_pulse_live_snapshot SET payload=jsonb_set(payload,'{auctions}',
 (SELECT jsonb_agg(CASE WHEN a->>10='https://bringatrailer.com/listing/relisted-217'
 THEN jsonb_set(a,'{5}',to_jsonb(now()-interval '1 day')) ELSE a END) FROM jsonb_array_elements(payload->'auctions') a));
SET ROLE anon;
SELECT assert_contract(market_pulse_live()#>'{identity_links,https://bringatrailer.com/listing/relisted-217}' IS NULL,
 'expired inventory presentation never claims applied attribution despite future canonical end');
RESET ROLE;
