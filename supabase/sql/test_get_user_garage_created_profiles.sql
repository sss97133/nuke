-- Empty disposable PG17 only. Start with the real reader's existing viewer contract.
\ir test_get_user_garage_viewer.sql
ALTER TABLE public.vehicles ADD COLUMN user_id uuid;
ALTER TABLE public.vehicles ADD COLUMN merged_into_vehicle_id uuid;

-- Synthetic creator-only records: private, public, someone else's, deleted, merged.
-- Money exists on the public creator record but must not imply an assessed asset.
INSERT INTO public.vehicles (id, user_id, year, make, model, image_count, is_public, deleted_at, merged_into_vehicle_id, purchase_price) VALUES
 ('10000000-0000-0000-0000-000000000010','20000000-0000-0000-0000-000000000001',1973,'Fixture','Coupe',0,false,NULL,NULL,NULL),
 ('10000000-0000-0000-0000-000000000011','20000000-0000-0000-0000-000000000001',1974,'Fixture','Coupe',0,true,NULL,NULL,5000),
 ('10000000-0000-0000-0000-000000000012','20000000-0000-0000-0000-000000000009',1975,'Fixture','Other account',0,true,NULL,NULL,NULL),
 ('10000000-0000-0000-0000-000000000013','20000000-0000-0000-0000-000000000001',1976,'Fixture','Deleted',0,true,now(),NULL,NULL),
 ('10000000-0000-0000-0000-000000000014','20000000-0000-0000-0000-000000000001',1977,'Fixture','Merged',0,true,NULL,'10000000-0000-0000-0000-000000000002',NULL),
 ('10000000-0000-0000-0000-000000000015','20000000-0000-0000-0000-000000000001',1978,'Fixture','Owned',0,true,NULL,NULL,NULL),
 ('10000000-0000-0000-0000-000000000016','20000000-0000-0000-0000-000000000001',1979,'Fixture','Previous',0,true,NULL,NULL,NULL),
 ('10000000-0000-0000-0000-000000000017','20000000-0000-0000-0000-000000000001',1980,'Fixture','Contributed',0,true,NULL,NULL,NULL);
INSERT INTO public.nuke_estimates VALUES ('10000000-0000-0000-0000-000000000011','class_stratified',10000,now());
INSERT INTO public.vehicle_ownerships VALUES ('10000000-0000-0000-0000-000000000015','20000000-0000-0000-0000-000000000001',true);
INSERT INTO public.discovered_vehicles VALUES ('10000000-0000-0000-0000-000000000016','20000000-0000-0000-0000-000000000001',true,'previously_owned');
INSERT INTO public.vehicle_contributors VALUES ('10000000-0000-0000-0000-000000000017','20000000-0000-0000-0000-000000000001');

CREATE TEMP TABLE reader_before AS
 SELECT proacl,proowner,proconfig,prosecdef,provolatile FROM pg_proc WHERE oid='public.get_user_garage(uuid)'::regprocedure;
CREATE TEMP TABLE testimony_before AS
 SELECT (SELECT count(*) FROM public.vehicle_ownerships) ownerships,
        (SELECT count(*) FROM public.vehicle_contributors) contributions,
        (SELECT count(*) FROM public.discovered_vehicles) discoveries;

\ir ../migrations/20261030231035_include_created_profiles_in_own_garage.sql
\ir ../migrations/20261030231035_include_created_profiles_in_own_garage.sql
SELECT public.t_assert((SELECT (p.proacl,p.proowner,p.proconfig,p.prosecdef,p.provolatile) IS NOT DISTINCT FROM
 (b.proacl,b.proowner,b.proconfig,b.prosecdef,b.provolatile) FROM pg_proc p CROSS JOIN reader_before b
 WHERE p.oid='public.get_user_garage(uuid)'::regprocedure),'signature authorization and execution properties preserved on reapply');
SELECT public.t_assert((SELECT ownerships=(SELECT count(*) FROM public.vehicle_ownerships)
 AND contributions=(SELECT count(*) FROM public.vehicle_contributors)
 AND discoveries=(SELECT count(*) FROM public.discovered_vehicles) FROM testimony_before),'reader migration creates no ownership or contribution testimony');

SET ROLE authenticated;
SET test.auth_uid='20000000-0000-0000-0000-000000000001';
SET test.auth_role='authenticated';
DO $$ DECLARE rows jsonb;
BEGIN
 SELECT jsonb_agg(to_jsonb(g)) INTO rows FROM public.get_user_garage('20000000-0000-0000-0000-000000000001') g;
 PERFORM public.t_assert(jsonb_array_length(rows)=9,'existing four, three classified creator records and two creator-only profiles');
 PERFORM public.t_assert((SELECT count(*)=2 FROM jsonb_array_elements(rows) r WHERE r->>'relationship'='profile_record'),'creator-only records have their own relationship');
 PERFORM public.t_assert((SELECT count(*)=2 FROM jsonb_array_elements(rows) r WHERE r->>'relationship'='profile_record'
   AND r->>'image_count'='0' AND r->>'image_url' IS NULL AND r->>'current_value' IS NULL AND r->>'purchase_price' IS NULL),
   'zero-photo profiles remain discoverable without claimed value');
 PERFORM public.t_assert(NOT rows @> '[{"vehicle_id":"10000000-0000-0000-0000-000000000012"}]'
   AND NOT rows @> '[{"vehicle_id":"10000000-0000-0000-0000-000000000013"}]'
   AND NOT rows @> '[{"vehicle_id":"10000000-0000-0000-0000-000000000014"}]','other account, deleted and merged creator-only records excluded');
 PERFORM public.t_assert(rows @> '[{"vehicle_id":"10000000-0000-0000-0000-000000000015","relationship":"owner"},
  {"vehicle_id":"10000000-0000-0000-0000-000000000016","relationship":"previously_owned"},
  {"vehicle_id":"10000000-0000-0000-0000-000000000017","relationship":"contributor"}]','existing relationship priority wins without duplicate rows');
END $$;

-- A stranger still sees exactly the existing public permission/title projection.
SET test.auth_uid='20000000-0000-0000-0000-000000000009';
SELECT public.t_assert((SELECT count(*)=2 AND bool_and(relationship='owner' AND current_value IS NULL AND purchase_price IS NULL)
 FROM public.get_user_garage('20000000-0000-0000-0000-000000000001')),'stranger does not learn even public creator-only associations');
SELECT public.t_assert((SELECT count(*)=1 AND bool_and(vehicle_id='10000000-0000-0000-0000-000000000012' AND relationship='profile_record')
 FROM public.get_user_garage('20000000-0000-0000-0000-000000000009')),'other account gets only its own created profile');
SELECT public.t_assert((SELECT count(*)=0 FROM public.get_user_garage(NULL)),'null account returns no rows');

RESET ROLE;
SET ROLE service_role;
SET test.auth_uid='';
SET test.auth_role='service_role';
SELECT public.t_assert((SELECT count(*)=9 FROM public.get_user_garage('20000000-0000-0000-0000-000000000001')),'existing service reader receives same account association');
RESET ROLE;
SET ROLE anon;
SET test.auth_role='anon';
DO $$ BEGIN
 PERFORM * FROM public.get_user_garage('20000000-0000-0000-0000-000000000001');
 RAISE EXCEPTION 'anonymous Garage invocation accepted';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
SELECT 'get_user_garage creator visibility, relationship priority, no testimony writes and privacy: PASS' AS result;
