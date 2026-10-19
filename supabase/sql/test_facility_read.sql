-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations.
-- facility_read (anon privacy, party detail, licenses without numbers, members by handle) and the
-- facility_reservation_to_confirm signature-queue kind.
\ir test_signature_queue_all_signs.sql
\ir helpers/facility_tables_live_20261019.sql
\ir ../migrations/20261019224000_facility_assets.sql
\ir ../migrations/20261019225000_facility_reservations.sql
\ir ../migrations/20261019226000_facility_read.sql

UPDATE organizations SET is_public=true, name='Fixture Shop' WHERE id='20000000-0000-0000-0000-000000000001';
INSERT INTO organizations(id,name,is_public) VALUES ('20000000-0000-0000-0000-000000000002','Private Garage',false);
INSERT INTO organization_contributors(organization_id,user_id,role,status) VALUES
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000d','technician','active'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000d','technician','active');
INSERT INTO shop_licenses(shop_id,license_type,license_number,issuing_authority,expiration_date,is_active,verified,document_id) VALUES
 ('20000000-0000-0000-0000-000000000001','paint_booth_permit','SECRET-LIC-123','County air district','2099-12-31',true,true,gen_random_uuid()),
 ('20000000-0000-0000-0000-000000000001','business_license','SECRET-LIC-456',NULL,'2020-01-01',true,false,NULL);
INSERT INTO equipment(shop_id,name,category,status,source) VALUES ('20000000-0000-0000-0000-000000000001','Lift (from photos)','lift','in_service','photo_evidence_inferred');
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT declare_facility_asset('20000000-0000-0000-0000-000000000001','paint_booth','Booth',1)->>'asset_id' AS booth \gset
SELECT declare_facility_asset('20000000-0000-0000-0000-000000000001','lift','Lift A',2)->>'asset_id' AS lift \gset
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT date_trunc('day', now()) + interval '7 days 9 hours' AS wf, date_trunc('day', now()) + interval '7 days 12 hours' AS wu \gset
SELECT reserve_facility('30000000-0000-0000-0000-000000000001',:'booth',:'wf',:'wu','{"basis":"day_rate","amount":250,"currency":"USD"}') AS r1 \gset
SELECT t_assert((my_signature_queue()#>'{coverage,by_kind,facility_reservation_to_confirm}') @> '{"returned":0,"available":true}','requester has nothing to confirm');
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT t_assert((SELECT count(*) FROM jsonb_array_elements(my_signature_queue()->'items') i WHERE i->>'kind'='facility_reservation_to_confirm')=0,'stranger has nothing to confirm');
SELECT as_user('10000000-0000-0000-0000-00000000000d');
SELECT (SELECT i FROM jsonb_array_elements(my_signature_queue()->'items') i WHERE i->>'kind'='facility_reservation_to_confirm') AS vq \gset
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT (SELECT i FROM jsonb_array_elements(my_signature_queue()->'items') i WHERE i->>'kind'='facility_reservation_to_confirm') AS oq \gset
SELECT my_signature_queue()->'coverage' AS ocov \gset
RESET ROLE;
SELECT t_assert((:'oq'::jsonb) @> jsonb_build_object('ref_id',(:'r1'::jsonb)->>'reservation_id','work_order_id','30000000-0000-0000-0000-000000000001',
   'summary',jsonb_build_object('asset',jsonb_build_object('kind','paint_booth','label','Booth','capacity',1),'requester_role','customer','capacity_free',true,
     'terms',jsonb_build_object('basis','day_rate','amount',250,'currency','USD')),
   'sign',jsonb_build_object('rpc','confirm_facility_reservation','args_hint',jsonb_build_object('p_reservation_id',(:'r1'::jsonb)->>'reservation_id','p_hash',(:'r1'::jsonb)->>'reservation_hash')))
 AND jsonb_array_length((:'oq'::jsonb)#>'{sign,binds}')=2 AND jsonb_array_length((:'vq'::jsonb)#>'{sign,binds}')=1
 AND (:'ocov'::jsonb) @> '{"by_kind":{"facility_reservation_to_confirm":{"returned":1,"available":true}}}' AND (:'ocov'::jsonb)->'kinds' @> '["facility_reservation_to_confirm"]',
 'owner and member: reservation to confirm with exact args, open terms; owner''s Sign also binds the facility offer');
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT confirm_facility_reservation(((:'oq'::jsonb)#>>'{sign,args_hint,p_reservation_id}')::uuid,(:'oq'::jsonb)#>>'{sign,args_hint,p_hash}');
SELECT t_assert((my_signature_queue()#>'{coverage,by_kind,facility_reservation_to_confirm,returned}')::int=0,'confirmed reservation leaves the queue');
RESET ROLE;

SET ROLE anon;
SELECT as_user(NULL);
SELECT facility_read('20000000-0000-0000-0000-000000000001') AS fa \gset
SELECT t_assert(t_refused_with($q$SELECT facility_read('20000000-0000-0000-0000-000000000002')$q$,'Organization unavailable'),'anon refused on a non-public organization');
RESET ROLE;
SELECT t_assert((:'fa'::jsonb)->'assets_by_kind' @> jsonb_build_array(
   jsonb_build_object('kind','paint_booth','capacity_total',1,'assets',jsonb_build_array(jsonb_build_object('label','Booth','capacity',1,
     'busy',jsonb_build_array(jsonb_build_object('from',(:'wf')::timestamptz,'until',(:'wu')::timestamptz,'slot',1))))),
   jsonb_build_object('kind','lift','capacity_total',2))
 AND NOT (:'fa'::jsonb)::text ~ '(reservation_id|work_order_id|30000000-0000-0000-0000-000000000001|SECRET-LIC|document_id)'
 AND (:'fa'::jsonb)->'licenses' @> '[{"license_type":"paint_booth_permit","state":"active","verified":true,"issuing_authority":"County air district"},{"license_type":"business_license","state":"expired"}]'
 AND (:'fa'::jsonb)->'members' @> '[{"handle":"seller_handle","relation":"member","weight":1}]' AND ((:'fa'::jsonb)->>'members_unnamed')::int>=1
 AND (:'fa'::jsonb)->'coverage' @> '{"declared_assets":2,"photo_inferred_not_declared":1}' AND (:'fa'::jsonb)->'viewer' @> '{"party":false,"actions":[]}'
 AND NOT (:'fa'::jsonb)::text ~ '(Private Seller Name|10000000-0000-0000-0000-00000000000[ec])',
 'anon: assets by kind with busy windows only, licenses without numbers or documents, members by handle; no job details or private names');
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT facility_read('20000000-0000-0000-0000-000000000001') AS fo \gset
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT facility_read('20000000-0000-0000-0000-000000000001') AS fc \gset
SELECT as_user('10000000-0000-0000-0000-00000000000d');
SELECT t_assert(facility_read('20000000-0000-0000-0000-000000000002')->'viewer' @> '{"role":"organization_member","party":true}','member reads a non-public organization');
RESET ROLE;
SELECT t_assert((:'fo'::jsonb)->'viewer' @> '{"role":"organization_owner","party":true,"actions":[{"action":"declare_facility_asset"}]}'
 AND (:'fo'::jsonb)::text ~ (:'r1'::jsonb->>'reservation_id') AND (:'fc'::jsonb)::text ~ (:'r1'::jsonb->>'reservation_id')
 AND (:'fc'::jsonb)->'viewer' @> '{"party":false}','owner and the reservation''s requester see job references on the busy window');
SELECT t_assert(has_function_privilege('anon','facility_read(uuid)','EXECUTE') AND has_function_privilege('authenticated','facility_read(uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','signature_queue_facility_items(uuid)','EXECUTE')
 AND (SELECT count(*) FROM regexp_matches(pg_get_functiondef('signature_queue_extend(uuid,jsonb)'::regprocedure),'signature_queue_facility_items','g'))=3,
 'grants; queue extension carries the three facility insertions');
