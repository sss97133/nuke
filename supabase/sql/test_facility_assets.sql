-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations.
-- Facility assets: equipment/shop_licenses repoint to organizations and declare_facility_asset.
\ir test_work_order_offers_read.sql
\ir helpers/facility_tables_live_20261019.sql
INSERT INTO shops_archived_20260129 VALUES ('a1000000-0000-0000-0000-000000000001','archived-shop',true,'10000000-0000-0000-0000-00000000000e');
INSERT INTO shop_locations VALUES ('a2000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001');
INSERT INTO shop_licenses(id,shop_id,location_id,license_type,license_number,is_active,verified) VALUES
 ('a3000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','dealer_license','FIXTURE-0001',true,false);
INSERT INTO equipment(id,shop_id,name,category,status,source) VALUES
 ('a4000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Two-post lift (from photos)','lift','in_service','photo_evidence_inferred'),
 ('a4000000-0000-0000-0000-000000000002',NULL,'Compressor (from photos)','compressor','in_service','photo_evidence_inferred'),
 ('a4000000-0000-0000-0000-000000000003','a1000000-0000-0000-0000-000000000001','Archived-shop jack','support','in_service','photo_evidence_inferred');
INSERT INTO organization_images VALUES ('a5000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000e');
INSERT INTO organization_contributors(organization_id,user_id,role,status) VALUES
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000d','technician','active');
CREATE TRIGGER shop_licenses_update_shop_timestamp AFTER INSERT OR UPDATE ON public.shop_licenses FOR EACH ROW EXECUTE FUNCTION public.update_shop_timestamp();
CREATE TRIGGER trg_audit_shop_licenses AFTER INSERT OR DELETE OR UPDATE ON public.shop_licenses FOR EACH ROW EXECUTE FUNCTION public.trg_audit_shop_licenses();
SELECT t_assert(t_refused_with($q$UPDATE shop_licenses SET is_active=true$q$,'does not exist'),'as live: shop_licenses writes fail on dead triggers before the migration');
\ir ../migrations/20261019224000_facility_assets.sql

SELECT t_assert((SELECT shop_id='20000000-0000-0000-0000-000000000001' AND notes IS NULL FROM equipment WHERE id='a4000000-0000-0000-0000-000000000001')
 AND (SELECT shop_id IS NULL AND notes LIKE 'shop_id a1000000-0000-0000-0000-000000000001 did not resolve%' FROM equipment WHERE id='a4000000-0000-0000-0000-000000000003')
 AND (SELECT shop_id IS NULL AND notes IS NULL FROM equipment WHERE id='a4000000-0000-0000-0000-000000000002')
 AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='equipment_shop_id_fkey' AND confrelid='public.organizations'::regclass AND convalidated),
 'equipment: resolving shop kept, unresolved nulled with a note, FK to organizations validated');
SELECT t_assert((SELECT shop_id IS NULL AND legacy_archived_shop_id='a1000000-0000-0000-0000-000000000001' FROM shop_licenses)
 AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='shop_licenses_shop_id_fkey' AND confrelid='public.organizations'::regclass AND convalidated)
 AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='shop_licenses' AND (qual ~ 'shops_archived|is_shop_' OR with_check ~ 'shops_archived|is_shop_'))
 AND NOT has_table_privilege('anon','public.shop_licenses','SELECT'),'shop_licenses: archived reference kept aside, FK to organizations, archived-shop policies and anon grants gone');
INSERT INTO shop_licenses(shop_id,license_type,license_number,expiration_date,is_active) VALUES
 ('20000000-0000-0000-0000-000000000001','paint_booth_permit','FIXTURE-PB-9','2027-06-30',true);
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000d');
SELECT t_assert((SELECT count(*) FROM shop_licenses)=1,'org member reads the organization''s licenses');
SELECT t_assert(t_refused($q$INSERT INTO shop_licenses(shop_id,license_type,license_number) VALUES ('20000000-0000-0000-0000-000000000001','x','y')$q$),'member cannot write licenses');
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT t_assert((SELECT count(*) FROM shop_licenses)=0,'stranger reads no licenses');
SELECT as_user('10000000-0000-0000-0000-00000000000e');
INSERT INTO shop_licenses(shop_id,license_type,license_number) VALUES ('20000000-0000-0000-0000-000000000001','business_license','FIXTURE-BL-1');
SELECT t_assert((SELECT count(*) FROM shop_licenses)=2,'owner writes and reads licenses');
RESET ROLE;
SELECT t_assert((SELECT count(*) FROM org_audit_log WHERE entity_table='shop_licenses')>=3
 AND (SELECT count(*) FROM org_audit_log WHERE entity_table='shop_licenses' AND action='update' AND shop_id IS NULL)=1
 AND NOT has_table_privilege('authenticated','public.org_audit_log','SELECT'),'repaired triggers: license writes audited (repoint update included), audit table closed to users');

-- Declaring assets.
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT t_assert(t_refused_with($q$SELECT declare_facility_asset('20000000-0000-0000-0000-000000000001','bay','Bay 1')$q$,'Only active owners or members'),'non-member refused');
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT t_assert(t_refused_with($q$SELECT declare_facility_asset('20000000-0000-0000-0000-000000000001','bay','Bay 1')$q$,'Only active owners or members'),'customer of a job there refused');
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT t_assert(t_refused_with($q$SELECT declare_facility_asset('20000000-0000-0000-0000-000000000001','spaceship','X')$q$,'Kind must be'),'unknown kind refused');
SELECT t_assert(t_refused_with($q$SELECT declare_facility_asset('20000000-0000-0000-0000-000000000001','bay','Bay 1',0)$q$,'Capacity'),'zero capacity refused');
SELECT t_assert(t_refused_with($q$SELECT declare_facility_asset('20000000-0000-0000-0000-000000000001','bay','Bay 1',1,'[{"kind":"url","url":"http://x"}]')$q$,'Evidence'),'non-https evidence refused');
SELECT t_assert(t_refused_with($q$SELECT declare_facility_asset('20000000-0000-0000-0000-000000000001','bay','Bay 1',1,'[{"kind":"image","id":"99999999-0000-0000-0000-000000000001"}]')$q$,'Evidence'),'unknown image refused');
SELECT declare_facility_asset('20000000-0000-0000-0000-000000000001','lift','Lift A',2,'[{"kind":"image","id":"a5000000-0000-0000-0000-000000000001"}]') AS d1 \gset
SELECT declare_facility_asset('20000000-0000-0000-0000-000000000001','lift','lift a',2,'[{"kind":"image","id":"a5000000-0000-0000-0000-000000000001"}]') AS d1dup \gset
SELECT as_user('10000000-0000-0000-0000-00000000000d');
SELECT declare_facility_asset('20000000-0000-0000-0000-000000000001','lift','Lift A',3) AS d2 \gset
SELECT declare_facility_asset('20000000-0000-0000-0000-000000000001','paint_booth','Booth',1) AS d3 \gset
SELECT t_assert((SELECT count(*) FROM equipment)=0,'equipment rows stay invisible to signed-in users (RLS, no policies, as live)');
RESET ROLE;
SELECT t_assert((:'d1'::jsonb) @> '{"kind":"lift","label":"Lift A","capacity":2,"declarer_role":"organization_owner","duplicate":false,"updated_existing":false,"evidence_count":1,"valuation":"not_recorded"}'
 AND (:'d1dup'::jsonb) @> '{"duplicate":true}' AND (:'d1dup'::jsonb)->>'asset_id'=(:'d1'::jsonb)->>'asset_id'
 AND (:'d2'::jsonb) @> '{"capacity":3,"declarer_role":"organization_member","updated_existing":true}' AND (:'d2'::jsonb)->>'asset_id'=(:'d1'::jsonb)->>'asset_id'
 AND (:'d3'::jsonb) @> '{"kind":"paint_booth","duplicate":false}','owner and member declare; same kind+label updates the one asset');
SELECT t_assert((SELECT capacity=3 AND source='member_declaration' AND asset_kind='lift' AND declared_by_user_id='10000000-0000-0000-0000-00000000000d'
   AND declaration_observation_id=((:'d2'::jsonb)->>'declaration_id')::uuid AND purchase_cost IS NULL AND current_value_computed IS NULL
   FROM equipment WHERE id=((:'d1'::jsonb)->>'asset_id')::uuid)
 AND (SELECT is_superseded FROM vehicle_observations WHERE id=((:'d1'::jsonb)->>'declaration_id')::uuid)
 AND EXISTS (SELECT 1 FROM vehicle_observations o WHERE o.id=((:'d2'::jsonb)->>'declaration_id')::uuid AND o.vehicle_id IS NULL AND o.subject_type='organization'
   AND o.subject_organization_id='20000000-0000-0000-0000-000000000001' AND o.kind='specification' AND o.submitted_by_user_id='10000000-0000-0000-0000-00000000000d'
   AND o.structured_data#>>'{facility_asset,kind}'='lift'),
 'asset row points at the current owner-input declaration about the organization; earlier declaration superseded; no valuation');
SELECT t_assert((SELECT count(*) FROM equipment WHERE source='member_declaration')=2 AND (SELECT count(*) FROM equipment WHERE source='photo_evidence_inferred')=3,
 'photo-inferred rows are untouched and are not declared assets');
SELECT t_assert(has_function_privilege('authenticated','declare_facility_asset(uuid,text,text,integer,jsonb)','EXECUTE')
 AND NOT has_function_privilege('anon','declare_facility_asset(uuid,text,text,integer,jsonb)','EXECUTE')
 AND NOT has_function_privilege('authenticated','facility_asset_evidence_valid(jsonb)','EXECUTE'),'grants');
