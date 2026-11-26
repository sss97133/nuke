-- Empty disposable PG17 only; reuse the existing route-writer integration.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_route_writers_relink.sql
\i supabase/migrations/20261126080500_harness_topology_kind_revision.sql

DO $$
DECLARE v uuid:='e08bf694-970f-4cbe-8a74-8715158a0f2e'; old_id uuid; new_id uuid; r jsonb; rows_ jsonb;
BEGIN
 SELECT id INTO STRICT old_id FROM public.harness_topology_nodes WHERE vehicle_id=v AND node_code='RT_B' AND NOT is_superseded;
 rows_:='[{"node_code":"RT_B","kind":"grommet","x":1,"y":0,"z":0,"pos_source":"synthetic explicit route-point role correction","trust":"proposed"}]';
 r:=public.load_harness_topology_points(v,rows_,'synthetic role test');
 IF r->>'points_reclassified'<>'1' OR r->>'points_moved'<>'1' OR r->>'points_new'<>'0' THEN
  RAISE EXCEPTION 'Explicit same-position kind change was discarded: %',r;
 END IF;
 SELECT id INTO STRICT new_id FROM public.harness_topology_nodes WHERE vehicle_id=v AND node_code='RT_B' AND NOT is_superseded AND kind='grommet';
 IF new_id=old_id OR NOT EXISTS(SELECT FROM public.harness_topology_nodes WHERE id=old_id AND is_superseded AND superseded_by=new_id)
 THEN RAISE EXCEPTION 'Kind correction did not preserve keyed revision history'; END IF;
 r:=public.load_harness_topology_points(v,rows_,'synthetic repeat');
 IF r->>'points_reclassified'<>'0' OR r->>'points_unchanged'<>'1' THEN RAISE EXCEPTION 'Kind correction was not idempotent: %',r; END IF;
 r:=public.load_harness_topology_points(v,'[{"node_code":"RT_B","x":1,"y":0,"z":0,"pos_source":"changed words; kind omitted"}]','synthetic no role assertion');
 IF r->>'points_unchanged'<>'1' OR NOT EXISTS(SELECT FROM public.harness_topology_nodes WHERE id=new_id AND NOT is_superseded AND kind='grommet')
 THEN RAISE EXCEPTION 'Omitted kind reset an existing route point'; END IF;
 r:=public.load_harness_topology_points(v,'[{"node_code":"RT_B","kind":" ","x":1.2,"y":0,"z":0,"pos_source":"synthetic move, blank kind"}]','synthetic move');
 IF r->>'points_moved'<>'1' OR r->>'points_reclassified'<>'0'
 OR NOT EXISTS(SELECT FROM public.harness_topology_nodes WHERE vehicle_id=v AND node_code='RT_B' AND NOT is_superseded AND kind='grommet' AND pos_x_m=1.2)
 THEN RAISE EXCEPTION 'Geometry revision lost the omitted-kind source claim: %',r; END IF;
 r:=public.load_harness_topology_points(v,'[{"node_code":"ROLE-DEFAULT","x":2,"y":0,"z":0,"pos_source":"synthetic new point with no role assertion"}]','synthetic new point');
 IF r->>'points_new'<>'1' OR NOT EXISTS(SELECT FROM public.harness_topology_nodes WHERE vehicle_id=v AND node_code='ROLE-DEFAULT' AND NOT is_superseded AND kind='device')
 THEN RAISE EXCEPTION 'New point lost the existing default'; END IF;
 BEGIN
  PERFORM public.load_harness_topology_points(v,'[{"node_code":"RT_B","kind":"invented-role","x":1.2,"y":0,"z":0,"pos_source":"invalid role"}]','synthetic invalid');
  RAISE EXCEPTION 'Invalid role accepted' USING ERRCODE='XX001';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF NOT EXISTS(SELECT FROM public.harness_topology_nodes WHERE vehicle_id=v AND node_code='RT_B' AND NOT is_superseded AND kind='grommet')
 THEN RAISE EXCEPTION 'Rejected reclassification retired the live point'; END IF;
 IF has_function_privilege('anon','public.load_harness_topology_points(uuid,jsonb,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.load_harness_topology_points(uuid,jsonb,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Route writer public privilege changed'; END IF;
END $$;

-- The same normal branch load relinks the existing branch to the revised role
-- point. It does not create an extra cable or alter its predicted length.
DO $$
DECLARE r jsonb; v uuid:='e08bf694-970f-4cbe-8a74-8715158a0f2e';
BEGIN
 PERFORM public.load_harness_topology_points(v,'[{"node_code":"RT_B","kind":"breakout","x":1,"y":0,"z":0,"pos_source":"synthetic restore original geometry"}]','synthetic reset');
 PERFORM public.load_harness_topology_points(v,'[{"node_code":"RT_B","kind":"grommet","x":1,"y":0,"z":0,"pos_source":"synthetic kind-only revision before branch relink"}]','synthetic role relink');
 r:=public.load_harness_branches(v,'[{"code":"RTB_AB","from":"RT_A","to":"RT_B","polyline_m":[[0,0,0],[0.5,0.2,0],[1,0,0]],"length_in":45.0,"method":"fixture study"}]','synthetic role relink');
 IF r->>'branches_relinked'<>'1' OR r->>'branches_new'<>'0' OR r->>'branches_redrawn'<>'0'
 OR NOT EXISTS(SELECT FROM public.vehicle_harness_landmarks l JOIN public.harness_topology_nodes n ON n.id=l.to_node_id
  WHERE l.vehicle_id=v AND l.landmark_code='RTB_AB' AND NOT l.is_superseded AND NOT n.is_superseded AND n.kind='grommet' AND l.distance_in=45)
 THEN RAISE EXCEPTION 'Existing branch did not follow the explicit point revision: %',r; END IF;
END $$;
SELECT 'test_harness_topology_kind_revision: PASS' AS result;
