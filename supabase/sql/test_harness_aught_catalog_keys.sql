-- Disposable PG17 only. Reuse current source, evaluation and visibility owners.
\set ON_ERROR_STOP on
\i supabase/sql/test_harness_component_requirements.sql
ALTER TABLE public.wiring_decision_links ADD COLUMN IF NOT EXISTS decision_id uuid,
 ADD COLUMN IF NOT EXISTS relation text, ADD COLUMN IF NOT EXISTS note text,
 ADD COLUMN IF NOT EXISTS source text, ADD COLUMN IF NOT EXISTS trust text;
CREATE TEMP TABLE aught_cases(name text PRIMARY KEY,gauge integer,wire_type text,colour text,
 expected_part text,may_key boolean,segment_state text,measured_ft numeric,circuit_state text,progressed boolean);
INSERT INTO aught_cases VALUES
 ('ordinary1',1,'M22759/16','red','M22759/16-1-2',true,'uncut',NULL,'uncut',false),
 ('one_aught',0,'M22759/16','red','M22759/16-01-2',true,'uncut',NULL,'uncut',false),
 ('two_aught',-1,'M22759/16','red','M22759/16-02-2',true,'uncut',NULL,'uncut',false),
 ('missing_stock',0,'M22759/16','white','M22759/16-01-9',false,'uncut',NULL,'uncut',false),
 ('unsupported_size',-2,'M22759/16','red',NULL,false,'uncut',NULL,'uncut',false),
 ('unsupported_family',0,'M22759/32','red',NULL,false,'uncut',NULL,'uncut',false),
 ('cut_piece',0,'M22759/16','red','M22759/16-01-2',false,'cut',NULL,'uncut',false),
 ('measured_piece',0,'M22759/16','red','M22759/16-01-2',false,'uncut',1.25,'uncut',false),
 ('unknown_circuit_state',0,'M22759/16','red','M22759/16-01-2',false,'uncut',NULL,NULL,false),
 ('progressed_circuit',0,'M22759/16','red','M22759/16-01-2',false,'uncut',NULL,'cut',false),
 ('recorded_progress',0,'M22759/16','red','M22759/16-01-2',false,'uncut',NULL,'uncut',true);
INSERT INTO public.catalog_parts(id,part_number) VALUES
 (md5('aught stock ordinary')::uuid,'M22759/16-1-2'),
 (md5('aught stock one')::uuid,'M22759/16-01-2'),
 (md5('aught stock two')::uuid,'M22759/16-02-2'),
 -- Malformed legacy tokens must never win merely because they exist.
 (md5('aught stock zero wrong')::uuid,'M22759/16-0-2'),
 (md5('aught stock negative wrong')::uuid,'M22759/16--1-2');
INSERT INTO public.vehicle_custom_circuits(id,overlay_id,circuit_code,circuit_name,wire_type,wire_gauge_awg,wire_color,
 design_status,build_state)
 SELECT md5('aught circuit:'||name)::uuid,'00000000-0000-0000-0000-0000000000f0',
 'AUGHT-'||name,'disposable size-code case',wire_type,gauge,colour,'decided',circuit_state FROM aught_cases;
INSERT INTO public.wire_termination_specs(id,vehicle_id,circuit_id,endpoint_id,cavity)
 SELECT md5('aught end:'||name||side)::uuid,'e08bf694-970f-4cbe-8a74-8715158a0f2e',md5('aught circuit:'||name)::uuid,
 CASE side WHEN 'from' THEN '00000000-0000-0000-0000-0000000000e1'::uuid ELSE '00000000-0000-0000-0000-0000000000ea'::uuid END,
 'AUGHT-'||name||side FROM aught_cases CROSS JOIN(VALUES('from'),('to')) s(side);
INSERT INTO public.harness_segments(id,vehicle_id,vehicle_custom_circuit_id,net_id,from_termination_id,to_termination_id,
 wire_part_id,gauge_awg,colour,build_state,measured_length_ft,measured_at,planned_length_ft,planned_length_method,design_status,source,method,observed_at,trust)
 SELECT md5('aught piece:'||name)::uuid,'e08bf694-970f-4cbe-8a74-8715158a0f2e',md5('aught circuit:'||name)::uuid,
 (SELECT id FROM public.harness_nets WHERE vehicle_id='e08bf694-970f-4cbe-8a74-8715158a0f2e' AND NOT is_superseded ORDER BY id LIMIT 1),
 md5('aught end:'||name||'from')::uuid,md5('aught end:'||name||'to')::uuid,
 md5('aught stock ordinary')::uuid,gauge,colour,segment_state,measured_ft,CASE WHEN measured_ft IS NOT NULL THEN now() END,
 2,'disposable plan','decided','fixture','fixture',now(),'T3'
 FROM aught_cases;
INSERT INTO public.harness_build_events(vehicle_id,circuit_id,to_state)
 SELECT 'e08bf694-970f-4cbe-8a74-8715158a0f2e',md5('aught circuit:'||name)::uuid,'cut' FROM aught_cases WHERE progressed;
DO $$ DECLARE g jsonb; r jsonb; BEGIN
 g:=public.harness_schematic_model('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(g->'segments') s
  WHERE s->>'circuit_code'='AUGHT-one_aught' AND s->>'expected_part_number' IS NULL)
 THEN RAISE EXCEPTION 'Baseline no longer reproduces missing aught expected key'; END IF;
 r:=public.harness_model_fold('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 IF r->>'status'<>'current' THEN RAISE EXCEPTION 'Baseline evaluation did not publish'; END IF;
END $$;
\i supabase/migrations/20261126195800_harness_aught_catalog_keys.sql
DO $$ BEGIN
 IF public.harness_manual_index('e08bf694-970f-4cbe-8a74-8715158a0f2e')->>'status'='current'
 THEN RAISE EXCEPTION 'Changed expected size interpretation left the old evaluation current'; END IF;
END $$;
DO $$ DECLARE g jsonb; s jsonb; row_ record; expected text; r jsonb; BEGIN
 r:=public.harness_model_fold('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 PERFORM public.key_harness_segments('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 g:=public.harness_schematic_model('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 FOR row_ IN SELECT * FROM aught_cases LOOP
  SELECT x INTO STRICT s FROM jsonb_array_elements(g->'segments') x WHERE x->>'id'=md5('aught piece:'||row_.name)::uuid::text;
  expected:=CASE WHEN row_.may_key THEN row_.expected_part ELSE 'M22759/16-1-2' END;
  IF s->>'keyed_part_number' IS DISTINCT FROM expected OR s->>'expected_part_number' IS DISTINCT FROM row_.expected_part
   OR (s->>'gauge_awg')::int IS DISTINCT FROM row_.gauge OR (s->>'circuit_gauge_awg')::int IS DISTINCT FROM row_.gauge
   OR (s->>'measured_length_ft')::numeric IS DISTINCT FROM row_.measured_ft
   OR s->>'build_state' IS DISTINCT FROM row_.segment_state
  THEN RAISE EXCEPTION 'Size key, gauge or physical outcome changed incorrectly for %: %',row_.name,s; END IF;
  IF NOT row_.may_key AND s->>'specification_state'='agrees'
   THEN RAISE EXCEPTION 'Held or protected aught identity appeared structurally agreed: %',row_.name; END IF;
 END LOOP;
 r:=public.key_harness_segments('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 IF (r->>'segments_keyed_to_a_part')::int<>0 OR (r->>'segments_rekeyed')::int<>0 OR (r->>'option_links_added')::int<>0
 THEN RAISE EXCEPTION 'Aught key repair is not idempotent: %',r; END IF;
 r:=public.harness_model_fold('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 IF r->>'status'<>'current' THEN RAISE EXCEPTION 'Key repair did not reach existing evaluation: %',r; END IF;
 IF NOT EXISTS(SELECT FROM public.harness_model_checks k JOIN public.harness_model_state st ON st.latest_evaluation_id=k.evaluation_id
  WHERE st.vehicle_id='e08bf694-970f-4cbe-8a74-8715158a0f2e' AND k.segment_id=md5('aught piece:one_aught')::uuid
   AND k.rule_key='wire_stock_key' AND k.result='pass')
 THEN RAISE EXCEPTION 'Canonical check did not consume exact aught stock identity'; END IF;
 IF has_function_privilege('anon','public.key_harness_segments(uuid)','EXECUTE')
  OR has_function_privilege('authenticated','public.key_harness_segments(uuid)','EXECUTE')
  OR (SELECT prosecdef FROM pg_proc WHERE oid='public.key_harness_segments(uuid)'::regprocedure)
 THEN RAISE EXCEPTION 'Catalog key repair changed writer permission boundary'; END IF;
END $$;
SET ROLE anon;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.harness_manual_index('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 IF r->>'status'<>'current' THEN RAISE EXCEPTION 'Anonymous current reader lost keyed revision: %',r; END IF;
END $$;
RESET ROLE;
SELECT 'test_harness_aught_catalog_keys: PASS' result;
