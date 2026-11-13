-- Isolated synthetic PG17 only; reuses the existing privacy/supersession fixture.
\set ON_ERROR_STOP on
\ir ../../scripts/tests/garage-unresolved-source.sql
\ir ../migrations/20261030152329_garage_inventory_status.sql
SELECT set_config('fixture.user_id','00000000-0000-4000-8000-000000000001',false);
SELECT set_config('fixture.role','authenticated',false);
INSERT INTO vehicles(id,year,make,model,is_public) VALUES
 ('00000000-0000-4000-8000-000000000011',1971,'Example','Inventory',true),
 ('00000000-0000-4000-8000-000000000012',1985,'Example','Legacy',true);
CREATE TEMP TABLE inventory_result(id uuid);
INSERT INTO inventory_result SELECT record_garage_owner_correction(
 '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011',
 '00000000-0000-4000-8000-000000000070',
 '{"relationship":{"roles":["claimed_interest"],"ownership_denied":false,"title_status":"not_in_name","disputed":true,"start_date":null,"end_date":null,"inventory_status":"current"}}',
 'Current inventory with disputed ownership');
SELECT fixture_assert((SELECT correction->'relationship'->>'inventory_status'='current'
 AND correction->'relationship'->>'title_status'='not_in_name'
 AND correction->'relationship'->>'disputed'='true'
 FROM get_my_garage_owner_corrections() WHERE id=(SELECT id FROM inventory_result)),
 'current inventory reaches account reader without upgrading title');
SELECT fixture_assert((SELECT count(*) FROM vehicle_canonical)=0,'inventory statement stays private');
SELECT fixture_fails($q$SELECT record_garage_owner_correction(
 '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000012',
 '00000000-0000-4000-8000-000000000071',
 fixture_claim('business_handling') || '{"inventory_status":"current"}', 'Misplaced field')$q$,'23514');
SELECT fixture_fails($q$SELECT record_garage_owner_correction(
 '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000012',
 '00000000-0000-4000-8000-000000000071',
 jsonb_set(fixture_claim('business_handling'),'{relationship,inventory_status}','null'), 'Null status')$q$,'23514');
SELECT fixture_fails($q$SELECT record_garage_owner_correction(
 '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000012',
 '00000000-0000-4000-8000-000000000071',
 jsonb_set(fixture_claim('business_handling'),'{relationship,inventory_status}','"verified"'), 'Invented status')$q$,'23514');
SELECT fixture_fails($q$SELECT record_garage_owner_correction(
 '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000012',
 '00000000-0000-4000-8000-000000000071',
 jsonb_set(fixture_claim('business_handling') #- '{relationship,end_date}','{relationship,inventory_status}','"previous"'), 'Missing required date key')$q$,'23514');
SELECT record_garage_owner_correction(
 '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011',
 '00000000-0000-4000-8000-000000000072',
 jsonb_set(fixture_claim('business_handling',true),'{relationship,inventory_status}','"previous"'),
 'Previous business vehicle, never personal ownership',NULL,(SELECT id FROM inventory_result));
SELECT fixture_assert((SELECT is_superseded AND content_text='Current inventory with disputed ownership'
 FROM vehicle_observations WHERE id=(SELECT id FROM inventory_result)),'supersession preserves exact former testimony');
SELECT fixture_assert((SELECT correction->'relationship'->>'inventory_status'='previous'
 AND correction->'relationship'->>'ownership_denied'='true'
 FROM get_my_garage_owner_corrections() WHERE vehicle_id='00000000-0000-4000-8000-000000000011'),
 'previous inventory and personal ownership denial coexist');
SELECT record_garage_owner_correction(
 '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000012',
 '00000000-0000-4000-8000-000000000073',fixture_claim('owner_past'),'Legacy six-key correction still works');
SELECT 'PASS: independent inventory status, title qualifications, required keys, private reader and preserved supersession';
