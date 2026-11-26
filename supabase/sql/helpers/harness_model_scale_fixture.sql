-- Shared existing disposable source population; no observation/testimony intake.
-- Representative population and shared bus: exercise the complete producer and public cached read.
-- Synthetic source records remain inside this disposable database; no live source fixture is shipped.
DO $population$
DECLARE v uuid:=md5('harness scale vehicle')::uuid; o uuid:=md5('harness scale overlay')::uuid;
 d uuid:=md5('harness scale design')::uuid; net uuid:=md5('harness scale net')::uuid;
 a uuid:=md5('harness scale bus')::uuid; b uuid:=md5('harness scale connector')::uuid; r jsonb;
BEGIN
 INSERT INTO public.vehicles(id,is_public) VALUES(v,true);
 INSERT INTO public.vehicle_wiring_overlays(id,vehicle_id) VALUES(o,v);
 INSERT INTO public.harness_designs(id,vehicle_id) VALUES(d,v);
 INSERT INTO public.harness_endpoints(id,design_id,code,node_kind) VALUES(a,d,'SCALE-BUS','bus'),(b,d,'SCALE-PINS','terminals');
 INSERT INTO public.harness_nets(id,vehicle_id,net_code,source,method,observed_at,trust)
  VALUES(net,v,'scale','disposable fixture','synthetic shared-net population',now(),'T3');
 INSERT INTO public.vehicle_custom_circuits(id,overlay_id,circuit_code,circuit_name,design_status,build_state,wire_type,wire_gauge_awg,wire_color)
  SELECT md5('harness scale circuit '||i)::uuid,o,'SCALE-'||i,'synthetic fixture','decided','uncut','M22759/32',20,'red' FROM generate_series(1,500) i;
 INSERT INTO public.wire_termination_specs(id,vehicle_id,circuit_id,endpoint_id,cavity)
  SELECT md5('harness scale end '||i||side)::uuid,v,md5('harness scale circuit '||i)::uuid,
   CASE side WHEN 'from' THEN a ELSE b END,CASE side WHEN 'from' THEN 'bus' ELSE 'P'||i END
  FROM generate_series(1,500) i CROSS JOIN (VALUES('from'),('to')) s(side);
 INSERT INTO public.harness_segments(id,vehicle_id,vehicle_custom_circuit_id,net_id,from_termination_id,to_termination_id,
  wire_part_id,gauge_awg,colour,planned_length_ft,planned_length_method,build_state,design_status,source,method,observed_at,trust)
  SELECT md5('harness scale piece '||i)::uuid,v,md5('harness scale circuit '||i)::uuid,net,
   md5('harness scale end '||i||'from')::uuid,md5('harness scale end '||i||'to')::uuid,
   '00000000-0000-0000-0000-00000000c001',20,'red',1,'synthetic fixture plan','uncut','decided','disposable fixture','synthetic population',now(),'T3'
  FROM generate_series(1,500) i;
 -- Production tables have planner statistics; refresh the disposable bulk-loaded fixture before measuring its path.
 ANALYZE public.vehicles; ANALYZE public.vehicle_wiring_overlays; ANALYZE public.vehicle_custom_circuits;
 ANALYZE public.harness_designs; ANALYZE public.harness_endpoints; ANALYZE public.wire_termination_specs;
 ANALYZE public.harness_segments; ANALYZE public.harness_nets; ANALYZE public.catalog_parts;
 r:=public.harness_model_fold(v);
 IF r->>'status'<>'current' THEN RAISE EXCEPTION 'Population fold failed: %',r; END IF;
END $population$;
