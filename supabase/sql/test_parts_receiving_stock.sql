\set ON_ERROR_STOP on
-- Empty disposable PostgreSQL17 only. Every source and physical claim is synthetic.
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int<170000
 OR to_regclass('public.vehicle_observations') IS NOT NULL THEN RAISE EXCEPTION 'Requires empty disposable PG17'; END IF;
END $$;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('test.jwt',true),'')::jsonb,'{}'::jsonb) $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT auth.jwt()->>'role' $$;
GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon,authenticated,service_role;
CREATE TABLE public.vehicles(id uuid PRIMARY KEY,user_id uuid,owner_id uuid,is_public boolean,deleted_at timestamptz);
CREATE TABLE public.parts_reception(id uuid PRIMARY KEY,part_number text,quantity_received integer,quality_check_passed boolean DEFAULT true,supplier_id uuid);
CREATE TABLE public.receipts(id uuid PRIMARY KEY,user_id uuid,vehicle_id uuid REFERENCES public.vehicles(id),is_active boolean DEFAULT true,is_superseded boolean DEFAULT false,duplicate_of uuid);
CREATE TABLE public.receipt_items(id uuid PRIMARY KEY,receipt_id uuid REFERENCES public.receipts,line_number integer,description text,part_number text,vendor_sku text,quantity numeric,line_source text);
CREATE TABLE public.catalog_parts(id uuid PRIMARY KEY,catalog_id uuid,part_number text,supplier_url text);
CREATE TABLE public.observation_sources(id uuid PRIMARY KEY,slug text UNIQUE);
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY,source_id uuid REFERENCES public.observation_sources,source_identifier text,vehicle_id uuid REFERENCES public.vehicles(id),
 subject_type text,subject_id uuid,kind text,observed_at timestamptz,observed_at_basis text,source_event_at timestamptz,source_event_time_precision text,
 content_text text,content_hash text UNIQUE,structured_data jsonb,submitted_by_user_id uuid,observer_raw jsonb,extraction_method text,confidence_score numeric,
 analysis_deferred boolean,is_superseded boolean DEFAULT false,superseded_by uuid,superseded_at timestamptz,ingested_at timestamptz DEFAULT statement_timestamp());
CREATE TABLE public.catalog_supply_properties(observation_id uuid PRIMARY KEY REFERENCES public.vehicle_observations(id),catalog_part_id uuid REFERENCES public.catalog_parts,quantity numeric,purchasing_eligible boolean DEFAULT false);
ALTER TABLE public.vehicle_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY base_observation_read ON public.vehicle_observations FOR SELECT USING(true);
GRANT SELECT ON public.vehicle_observations TO anon,authenticated;
CREATE TABLE public.harness_segments(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES public.vehicles);
CREATE TABLE public.harness_model_evaluations(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES public.vehicles,input_hash text,logic_key text,UNIQUE(id,vehicle_id));
CREATE TABLE public.harness_model_wire_requirements(evaluation_id uuid REFERENCES public.harness_model_evaluations,segment_id uuid REFERENCES public.harness_segments,
 catalog_part_id uuid,planned_quantity numeric,unit text,state text,PRIMARY KEY(evaluation_id,segment_id));
CREATE TABLE public.harness_model_component_requirements(evaluation_id uuid REFERENCES public.harness_model_evaluations,id uuid,role text,
 termination_id uuid,endpoint_id uuid,splice_id uuid,catalog_part_id uuid,quantity numeric,unit text,state text,PRIMARY KEY(evaluation_id,id));
CREATE TABLE public.harness_model_component_contributors(evaluation_id uuid,requirement_id uuid,segment_id uuid,termination_id uuid,circuit_id uuid,
 FOREIGN KEY(evaluation_id,requirement_id) REFERENCES public.harness_model_component_requirements(evaluation_id,id));
CREATE TABLE public.harness_model_state(vehicle_id uuid PRIMARY KEY REFERENCES public.vehicles,latest_evaluation_id uuid REFERENCES public.harness_model_evaluations,
 current_fixture boolean DEFAULT true);
CREATE FUNCTION public.harness_evaluated_model(p_vehicle uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('current',s.current_fixture,'model',jsonb_build_object('evaluation_id',s.latest_evaluation_id,
 'wire_requirements',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM public.harness_model_wire_requirements r WHERE r.evaluation_id=s.latest_evaluation_id),
 'component_requirements',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM public.harness_model_component_requirements r WHERE r.evaluation_id=s.latest_evaluation_id)))
 FROM public.harness_model_state s WHERE s.vehicle_id=p_vehicle
$$;
CREATE TABLE public.test_receipt_catalog(item_id uuid PRIMARY KEY REFERENCES public.receipt_items,part_id uuid REFERENCES public.catalog_parts);
CREATE FUNCTION public.receipt_item_product_card(p_item uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('catalog_part_id',t.part_id,'part_number',c.part_number,'page_url',c.supplier_url,
  'captured_at','2026-11-20T00:00:00Z','quote_price',999,'name','Synthetic product')
 FROM public.test_receipt_catalog t JOIN public.catalog_parts c ON c.id=t.part_id WHERE item_id=p_item
$$;
\i supabase/migrations/20261126005947_account_work_admission.sql
\i supabase/migrations/20261126010017_parts_receiving_stock.sql

CREATE FUNCTION pg_temp.ok(v boolean,m text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION '%',m; END IF; END $$;
CREATE FUNCTION pg_temp.refuse(q text,m text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE q; EXCEPTION WHEN OTHERS THEN RETURN; END; RAISE EXCEPTION 'Expected refusal: %',m; END $$;
CREATE TEMP TABLE fixture(k text PRIMARY KEY,v jsonb);
GRANT SELECT,INSERT,UPDATE ON fixture TO authenticated;
INSERT INTO auth.users VALUES('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
INSERT INTO public.vehicles VALUES('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001',NULL,true,NULL),
 ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000002',NULL,false,NULL);
INSERT INTO public.parts_reception(id,part_number,quantity_received) VALUES('00000000-0000-0000-0000-000000000030','FIXTURE-PART',999);
UPDATE public.parts_reception SET supplier_id='00000000-0000-0000-0000-000000000099'; -- conflicting supplier identity is deliberately not promoted
INSERT INTO public.receipts(id,user_id,vehicle_id) VALUES
 ('00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010'),
 ('00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000020');
INSERT INTO public.receipt_items(id,receipt_id,line_number,description,part_number,quantity) VALUES
 ('00000000-0000-0000-0000-000000000050','00000000-0000-0000-0000-000000000040',1,'Synthetic arrival line','FIXTURE-PART',2),
 ('00000000-0000-0000-0000-000000000051','00000000-0000-0000-0000-000000000041',1,'Other owner line','FIXTURE-PART',4),
 ('00000000-0000-0000-0000-000000000052','00000000-0000-0000-0000-000000000040',2,'Separate witnessed arrival','FIXTURE-PART',1);
INSERT INTO public.catalog_parts VALUES('00000000-0000-0000-0000-000000000060',gen_random_uuid(),'FIXTURE-PART','https://example.com/part');
INSERT INTO public.test_receipt_catalog VALUES('00000000-0000-0000-0000-000000000050','00000000-0000-0000-0000-000000000060'),
 ('00000000-0000-0000-0000-000000000051','00000000-0000-0000-0000-000000000060'),
 ('00000000-0000-0000-0000-000000000052','00000000-0000-0000-0000-000000000060');
INSERT INTO public.observation_sources VALUES('00000000-0000-0000-0000-000000000080','owner-input');
INSERT INTO public.vehicle_observations(id,source_id,kind,content_text) VALUES('00000000-0000-0000-0000-000000000070','00000000-0000-0000-0000-000000000080','specification','Synthetic unverified package claim; no quantity conversion');
INSERT INTO public.catalog_supply_properties VALUES('00000000-0000-0000-0000-000000000070','00000000-0000-0000-0000-000000000060',100,false);
INSERT INTO public.harness_model_evaluations VALUES('00000000-0000-0000-0000-000000000100','00000000-0000-0000-0000-000000000010','input1','logic1'),
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000020','input2','logic1');
INSERT INTO public.harness_model_state(vehicle_id,latest_evaluation_id) SELECT vehicle_id,id FROM public.harness_model_evaluations;
INSERT INTO public.harness_segments VALUES('00000000-0000-0000-0000-000000000120','00000000-0000-0000-0000-000000000020');
INSERT INTO public.harness_model_wire_requirements VALUES('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000120',
 '00000000-0000-0000-0000-000000000060',4.5,'ft','provisional');
INSERT INTO public.harness_model_component_requirements VALUES('00000000-0000-0000-0000-000000000100','00000000-0000-0000-0000-000000000110','terminal_contact',NULL,gen_random_uuid(),NULL,'00000000-0000-0000-0000-000000000060',6,'each','provisional'),
 ('00000000-0000-0000-0000-000000000100','00000000-0000-0000-0000-000000000111','connector_housing',NULL,gen_random_uuid(),NULL,'00000000-0000-0000-0000-000000000060',6,'each','provisional');
INSERT INTO public.harness_model_component_contributors SELECT evaluation_id,id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
 FROM public.harness_model_component_requirements WHERE id='00000000-0000-0000-0000-000000000110';
INSERT INTO fixture VALUES('arrival',jsonb_build_object('receipt_item_id','00000000-0000-0000-0000-000000000050','catalog_part_id','00000000-0000-0000-0000-000000000060',
 'quantity',12,'unit','ea','received_at','2026-11-24T12:00:00Z','receipt_line_is_this_arrival',true,
 'package_property_observation_id','00000000-0000-0000-0000-000000000070'));

SELECT pg_temp.ok(NOT has_function_privilege('anon','public.record_parts_arrival(uuid,jsonb)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.record_parts_arrival(uuid,jsonb)','EXECUTE')
 AND NOT has_table_privilege('authenticated','public.parts_reception_lots','INSERT'),'No service signature or direct lot writes');
SET ROLE authenticated;
SELECT set_config('test.uid','00000000-0000-0000-0000-000000000001',false),set_config('test.jwt','{"role":"authenticated","is_anonymous":false}',false);
DO $$ DECLARE identity jsonb; BEGIN
 identity:=public.parts_receipt_stock_identity('00000000-0000-0000-0000-000000000050');
 PERFORM pg_temp.ok(identity->>'identity_state'='qualified' AND identity->>'part_number'='FIXTURE-PART'
 AND identity->>'source_page_url'='https://example.com/part' AND NOT identity ? 'quote_price' AND NOT identity ? 'name',
 'Exact owned-line wrapper uses qualified product identity without prose or price');
 PERFORM pg_temp.ok(public.parts_receipt_stock_identity('00000000-0000-0000-0000-000000000051') IS NULL
 AND public.parts_receipt_stock_identity(gen_random_uuid()) IS NULL,'Foreign and absent receipt lines share null result');
END $$;
DO $$ DECLARE a jsonb; s jsonb; repeat_read jsonb; lot uuid; BEGIN
 SELECT v INTO a FROM fixture WHERE k='arrival';
 PERFORM pg_temp.refuse(format('SELECT public.record_parts_arrival(gen_random_uuid(),%L::jsonb)',a||'{"actor_user_id":"00000000-0000-0000-0000-000000000002"}'),'caller cannot supply signer');
 PERFORM pg_temp.refuse(format('SELECT public.record_parts_arrival(gen_random_uuid(),%L::jsonb)',a||'{"reception_id":"00000000-0000-0000-0000-000000000030"}'),'same SKU legacy reception cannot create unowned context edge');
 PERFORM pg_temp.refuse(format('SELECT public.record_parts_arrival(gen_random_uuid(),%L::jsonb)',a||'{"unit":"pack"}'),'unverified pack cannot normalize');
 PERFORM pg_temp.refuse(format('SELECT public.record_parts_arrival(gen_random_uuid(),%L::jsonb)',a||'{"quantity":1.5}'),'fractional each refused');
 PERFORM pg_temp.refuse(format('SELECT public.record_parts_arrival(gen_random_uuid(),%L::jsonb)',a||'{"receipt_item_id":"00000000-0000-0000-0000-000000000051"}'),'other owner receipt');
 s:=public.record_parts_arrival('00000000-0000-0000-0000-000000000090',a); lot:=(s->>'lot_id')::uuid;
 INSERT INTO fixture VALUES('lot',to_jsonb(lot));
 PERFORM pg_temp.ok(s->>'received_quantity'='12' AND s->>'available_quantity' IS NULL AND s->>'accepted_quantity' IS NULL
 AND s->>'inspection_state'='not_recorded','Receipt/invoice/legacy true/package100 never imply usable stock');
 PERFORM pg_temp.ok(s->>'reception_id' IS NULL AND s->>'reception_link_state'='not_linked' AND NOT s ? 'supplier_id','Legacy supplier context stays unlinked');
 repeat_read:=public.record_parts_arrival('00000000-0000-0000-0000-000000000090',a);
 PERFORM pg_temp.ok(repeat_read->>'lot_id'=lot::text AND repeat_read->>'duplicate'='true','Retry is same lot');
 PERFORM pg_temp.refuse(format('SELECT public.record_parts_arrival(gen_random_uuid(),%L::jsonb)',a),'same line cannot double credit');
 PERFORM pg_temp.refuse(format('SELECT public.record_parts_arrival(%L,%L::jsonb)','00000000-0000-0000-0000-000000000090',a||'{"quantity":24}'),'request cannot rewrite counted quantity');
 PERFORM pg_temp.refuse(format('SELECT public.reserve_parts_stock(gen_random_uuid(),%L,%L,%L,NULL,%L,1)',lot,
 '00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000100','00000000-0000-0000-0000-000000000110'),'no default inspection allocation');
 s:=public.record_parts_inspection('00000000-0000-0000-0000-000000000091',lot,8,1,'2026-11-24T13:00:00Z');
 INSERT INTO fixture VALUES('inspection1',s->'inspection_observation_id');
 PERFORM pg_temp.ok(s->>'available_quantity'='8' AND s->>'not_assessed_quantity'='3','Partial inspection is distinct from arrival');
 PERFORM pg_temp.refuse(format('SELECT public.record_parts_inspection(gen_random_uuid(),%L,8,1,%L)',lot,'2026-11-24T14:00:00Z'),'inspection requires predecessor');
 s:=public.record_parts_inspection('00000000-0000-0000-0000-000000000092',lot,9,1,'2026-11-24T14:00:00Z',(s->>'inspection_observation_id')::uuid);
 INSERT INTO fixture VALUES('inspection2',s->'inspection_observation_id');
 PERFORM pg_temp.ok(s->>'available_quantity'='9','Cumulative reinspection does not add8+9');
 PERFORM pg_temp.refuse(format('SELECT public.parts_stock_lot_status(%L)',lot),'private helper unavailable');
 PERFORM pg_temp.refuse(format('UPDATE public.parts_reception_lots SET received_quantity=24 WHERE id=%L',lot),'immutable receiving quantity');
END $$;

DO $$ DECLARE lot uuid; s jsonb; a uuid; t timestamptz:=statement_timestamp(); BEGIN
 SELECT(v#>>'{}')::uuid INTO lot FROM fixture WHERE k='lot';
 s:=public.reserve_parts_stock('00000000-0000-0000-0000-000000000130',lot,'00000000-0000-0000-0000-000000000010',
 '00000000-0000-0000-0000-000000000100',NULL,'00000000-0000-0000-0000-000000000110',6);
 a:=(s->>'allocation_id')::uuid; INSERT INTO fixture VALUES('allocation1',to_jsonb(a));
 PERFORM pg_temp.ok(s->>'remaining_reservation'='6' AND s->>'pulled_quantity'='0' AND s->>'cut_ready'='false','Reservation does not imply physical pull or cut release');
 PERFORM pg_temp.ok(public.reserve_parts_stock('00000000-0000-0000-0000-000000000130',lot,'00000000-0000-0000-0000-000000000010',
 '00000000-0000-0000-0000-000000000100',NULL,'00000000-0000-0000-0000-000000000110',6)->>'duplicate'='true','Reservation retry does not allocate twice');
 PERFORM pg_temp.refuse(format('SELECT public.reserve_parts_stock(gen_random_uuid(),%L,%L,%L,NULL,%L,1)',lot,
 '00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000100','00000000-0000-0000-0000-000000000110'),'requirement cannot be allocated twice');
 PERFORM pg_temp.refuse(format('SELECT public.reserve_parts_stock(gen_random_uuid(),%L,%L,%L,NULL,%L,4)',lot,
 '00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000100','00000000-0000-0000-0000-000000000111'),'lot cannot be overallocated across requirements');
 PERFORM pg_temp.refuse(format('SELECT public.reserve_parts_stock(gen_random_uuid(),%L,%L,%L,%L,NULL,1)',lot,
 '00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000120'),'other vehicle ownership required');
 s:=public.record_parts_stock_event('00000000-0000-0000-0000-000000000131',a,'pull',4,t);
 INSERT INTO fixture VALUES('component_pull',s->'observation_id');
 PERFORM pg_temp.ok(s->>'pulled_quantity'='4' AND s->>'remaining_reservation'='2' AND s#>>'{lot,available_quantity}'='3','Pull spends reservation, never frees lot');
 PERFORM pg_temp.ok(public.record_parts_stock_event('00000000-0000-0000-0000-000000000131',a,'pull',4,t)->>'duplicate'='true','Pull retry preserves one debit');
 s:=public.record_parts_stock_event('00000000-0000-0000-0000-000000000132',a,'release',1,t);
 INSERT INTO fixture VALUES('release1',s->'observation_id');
 PERFORM pg_temp.ok(s->>'remaining_reservation'='1' AND s#>>'{lot,available_quantity}'='4','Only separately signed release returns quantity');
 PERFORM pg_temp.refuse(format('SELECT public.record_parts_stock_event(gen_random_uuid(),%L,%L,2,%L)',a,'release',t),'pulled units cannot also release');
 PERFORM pg_temp.refuse(format('SELECT public.record_parts_stock_event(gen_random_uuid(),%L,%L,2,%L)',a,'pull',t),'remaining reservation conserved');
END $$;
RESET ROLE;
-- A computed requirement identifier can change when a recorded cavity receives
-- its typed library key. The retained physical contributor still owns its credit.
INSERT INTO public.harness_model_evaluations VALUES('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000010','input-rekey','logic1');
INSERT INTO public.harness_model_component_requirements SELECT '00000000-0000-0000-0000-000000000102',
 CASE WHEN id='00000000-0000-0000-0000-000000000110' THEN '00000000-0000-0000-0000-000000000112'::uuid ELSE id END,
 role,termination_id,endpoint_id,splice_id,catalog_part_id,quantity,unit,state FROM public.harness_model_component_requirements
 WHERE evaluation_id='00000000-0000-0000-0000-000000000100';
INSERT INTO public.harness_model_component_contributors SELECT '00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000112',segment_id,termination_id,circuit_id
 FROM public.harness_model_component_contributors WHERE requirement_id='00000000-0000-0000-0000-000000000110';
UPDATE public.harness_model_state SET latest_evaluation_id='00000000-0000-0000-0000-000000000102' WHERE vehicle_id='00000000-0000-0000-0000-000000000010';
SET ROLE authenticated;
DO $$ DECLARE refused boolean:=false; s jsonb; lot uuid; BEGIN
 SELECT(v#>>'{}')::uuid INTO lot FROM fixture WHERE k='lot';
 BEGIN PERFORM public.reserve_parts_stock(gen_random_uuid(),lot,'00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000102',NULL,'00000000-0000-0000-0000-000000000112',2);
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='Requirement already reserved or consumed' THEN refused:=true; ELSE RAISE; END IF; END;
 PERFORM pg_temp.ok(refused,'New computed ID cannot double credit its unchanged physical contributor');
 -- Distinct receipt line supports a distinct arrival; it is not inferred from
 -- the same invoice line or from a PO's ordered amount.
 s:=public.record_parts_arrival('00000000-0000-0000-0000-000000000160',jsonb_build_object('receipt_item_id','00000000-0000-0000-0000-000000000052',
 'catalog_part_id','00000000-0000-0000-0000-000000000060','quantity',10,'unit','ea','received_at','2026-11-20T10:00:00Z','receipt_line_is_this_arrival',true));
 lot:=(s->>'lot_id')::uuid; INSERT INTO fixture VALUES('historical_lot',to_jsonb(lot));
 s:=public.record_parts_inspection('00000000-0000-0000-0000-000000000161',lot,5,0,'2026-11-21T10:00:00Z');
 INSERT INTO fixture VALUES('earlier_inspection',s->'inspection_observation_id');
 PERFORM public.record_parts_inspection('00000000-0000-0000-0000-000000000162',lot,10,0,'2026-11-25T10:00:00Z',(s->>'inspection_observation_id')::uuid);
 refused:=false;
 BEGIN PERFORM public.reserve_parts_stock(gen_random_uuid(),lot,'00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000102',NULL,'00000000-0000-0000-0000-000000000112',2);
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='Requirement already reserved or consumed' THEN refused:=true; ELSE RAISE; END IF; END;
 PERFORM pg_temp.ok(refused,'A second stock lot cannot double reserve the same physical component');
END $$;
RESET ROLE;
-- Synthetic historical reservation timestamps let the test exercise a late
-- report without changing database clocks or any production record.
INSERT INTO public.parts_stock_allocations(id,lot_id,custodian_user_id,request_id,vehicle_id,evaluation_id,component_requirement_id,component_role,catalog_part_id,quantity,unit,recorded_at)
 SELECT '00000000-0000-0000-0000-000000000163',(v#>>'{}')::uuid,'00000000-0000-0000-0000-000000000001',gen_random_uuid(),
 '00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000111','connector_housing',
 '00000000-0000-0000-0000-000000000060',4,'ea','2026-11-21T11:00:00Z' FROM fixture WHERE k='historical_lot';
INSERT INTO public.parts_stock_allocations(id,lot_id,custodian_user_id,request_id,vehicle_id,evaluation_id,component_requirement_id,component_role,catalog_part_id,quantity,unit,recorded_at)
 SELECT '00000000-0000-0000-0000-000000000165',(v#>>'{}')::uuid,'00000000-0000-0000-0000-000000000001',gen_random_uuid(),
 '00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000111','connector_housing',
 '00000000-0000-0000-0000-000000000060',2,'ea','2026-11-21T11:01:00Z' FROM fixture WHERE k='historical_lot';
SET ROLE authenticated;
DO $$ DECLARE s jsonb; refused boolean:=false; BEGIN
 s:=public.record_parts_stock_event('00000000-0000-0000-0000-000000000164','00000000-0000-0000-0000-000000000163','pull',2,'2026-11-23T10:00:00Z');
 PERFORM pg_temp.ok((SELECT basis_inspection_id=(SELECT(v#>>'{}')::uuid FROM fixture WHERE k='earlier_inspection') FROM public.parts_stock_events
 WHERE observation_id=(s->>'observation_id')::uuid),'Late report uses earlier actual inspection, not current later inspection');
 PERFORM public.record_parts_stock_event('00000000-0000-0000-0000-000000000166','00000000-0000-0000-0000-000000000165','pull',2,'2026-11-23T10:01:00Z');
 -- Current accepted count is10. Each pull2 fits old accepted5 separately, but
 -- this proposed prefix would be6. Reservation balances alone would allow it.
 BEGIN PERFORM public.record_parts_stock_event(gen_random_uuid(),'00000000-0000-0000-0000-000000000163','pull',2,'2026-11-23T10:02:00Z');
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='Pull history exceeds its contemporaneous inspected quantity' THEN refused:=true; ELSE RAISE; END IF; END;
 PERFORM pg_temp.ok(refused,'Later inspection increase cannot backfill cumulative historical pull shortage');
END $$;
RESET ROLE;
UPDATE public.vehicle_observations SET is_superseded=true,superseded_at=now() WHERE id=(SELECT(v#>>'{}')::uuid FROM fixture WHERE k='earlier_inspection');
SET ROLE authenticated;
DO $$ DECLARE refused boolean:=false; BEGIN
 BEGIN PERFORM public.record_parts_stock_event(gen_random_uuid(),'00000000-0000-0000-0000-000000000163','pull',1,'2026-11-23T11:00:00Z');
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='No qualified inspection precedes this physical pull' THEN refused:=true; ELSE RAISE; END IF; END;
 PERFORM pg_temp.ok(refused,'Later valid inspection cannot qualify a past pull when contemporaneous witness is withdrawn');
END $$;
SELECT set_config('test.jwt','{"role":"service_role","is_anonymous":false}',false);
SELECT pg_temp.refuse($q$SELECT public.record_parts_arrival(gen_random_uuid(),(SELECT v FROM fixture WHERE k='arrival'))$q$,'service JWT cannot impersonate owner uid');
SELECT set_config('test.jwt','{"role":"authenticated","is_anonymous":true}',false);
SELECT pg_temp.refuse($q$SELECT public.parts_stock_lot((SELECT(v#>>'{}')::uuid FROM fixture WHERE k='lot'))$q$,'anonymous account cannot inspect private stock');
SELECT set_config('test.jwt','{"role":"authenticated","is_anonymous":false}',false),set_config('test.uid','00000000-0000-0000-0000-000000000002',false);
SELECT pg_temp.ok(public.parts_stock_lot((SELECT(v#>>'{}')::uuid FROM fixture WHERE k='lot')) IS NULL,'other owner cannot read lot');
SELECT pg_temp.ok((SELECT count(*) FROM public.parts_reception_lots)=0 AND (SELECT count(*) FROM public.vehicle_observations WHERE extraction_method LIKE 'parts_%')=0,'RLS hides typed and canonical stock source rows');
-- Same generic path supports a second vehicle/custodian and nonintegral feet.
DO $$ DECLARE s jsonb; lot uuid; a uuid; t timestamptz:=statement_timestamp(); BEGIN
 s:=public.record_parts_arrival('00000000-0000-0000-0000-000000000140',jsonb_build_object('receipt_item_id','00000000-0000-0000-0000-000000000051',
 'catalog_part_id','00000000-0000-0000-0000-000000000060','quantity',10.5,'unit','ft','received_at','2026-11-24T10:00:00Z','receipt_line_is_this_arrival',true));
 lot:=(s->>'lot_id')::uuid; INSERT INTO fixture VALUES('lot2',to_jsonb(lot));
 PERFORM public.record_parts_inspection('00000000-0000-0000-0000-000000000141',lot,10.5,0,'2026-11-24T11:00:00Z');
 s:=public.reserve_parts_stock('00000000-0000-0000-0000-000000000142',lot,'00000000-0000-0000-0000-000000000020',
 '00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000120',NULL,4.5);
 a:=(s->>'allocation_id')::uuid; INSERT INTO fixture VALUES('wire_allocation',to_jsonb(a));
 s:=public.record_parts_stock_event('00000000-0000-0000-0000-000000000143',a,'pull',4.5,t);
 INSERT INTO fixture VALUES('wire_pull',s->'observation_id');
 PERFORM pg_temp.ok(s#>>'{lot,available_quantity}'='6.0' OR (s#>>'{lot,available_quantity}')::numeric=6,'Feet conserve without unit or pack substitution');
END $$;
RESET ROLE;
-- Simulates the private call from the separately authorized physical-operation owner.
CREATE FUNCTION public.test_stock_pull_binding(p_obs uuid,p_vehicle uuid,p_segment uuid,p_quantity numeric) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT public.parts_stock_pull_status(p_obs,p_vehicle,p_segment,p_quantity) $$;
SET ROLE authenticated;
DO $$ DECLARE s jsonb; BEGIN
 s:=public.test_stock_pull_binding((SELECT(v#>>'{}')::uuid FROM fixture WHERE k='wire_pull'),'00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000120',4);
 PERFORM pg_temp.ok(s->>'binding_valid'='true' AND s->>'allocation_revision_current'='true' AND s->>'basis_inspection_id' IS NOT NULL,'Exact source-backed pull binds a prototype quantity');
 s:=public.test_stock_pull_binding((SELECT(v#>>'{}')::uuid FROM fixture WHERE k='wire_pull'),'00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000120',5);
 PERFORM pg_temp.ok(s->>'binding_valid'='false' AND s->'holds' ? 'pull_quantity_insufficient','One pull cannot supply more footage than witnessed');
END $$;
RESET ROLE;
UPDATE public.harness_model_state SET current_fixture=false WHERE vehicle_id='00000000-0000-0000-0000-000000000020';
SET ROLE authenticated;
DO $$ DECLARE s jsonb; BEGIN
 s:=public.test_stock_pull_binding((SELECT(v#>>'{}')::uuid FROM fixture WHERE k='wire_pull'),'00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000120',4);
 PERFORM pg_temp.ok(s->>'binding_valid'='true' AND s->>'allocation_revision_current'='false','Physical progress can stale current plan without erasing historical debit');
END $$;
RESET ROLE;
UPDATE public.vehicle_observations SET is_superseded=true,superseded_at=now() WHERE id=(SELECT(v#>>'{}')::uuid FROM fixture WHERE k='inspection2');
SELECT pg_temp.refuse($q$UPDATE public.vehicle_observations SET is_superseded=false,superseded_at=NULL WHERE id=(SELECT(v#>>'{}')::uuid FROM fixture WHERE k='inspection2')$q$,'Retired inspection cannot be silently revived');
SELECT pg_temp.refuse($q$UPDATE public.vehicle_observations SET structured_data=jsonb_set(structured_data,'{quantity}','999') WHERE id=(SELECT(v#>>'{}')::uuid FROM fixture WHERE k='wire_pull')$q$,'Physical pull source cannot be rewritten');
SET ROLE authenticated;
SELECT set_config('test.uid','00000000-0000-0000-0000-000000000001',false);
DO $$ DECLARE s jsonb; BEGIN
 s:=public.parts_stock_lot((SELECT(v#>>'{}')::uuid FROM fixture WHERE k='lot'));
 PERFORM pg_temp.ok(s->>'accepted_quantity' IS NULL AND s->>'available_quantity' IS NULL
 AND s->'holds' ? 'inspection_source_withdrawn_or_changed','Withdrawn latest inspection cannot fall back to older acceptance');
 PERFORM pg_temp.ok(s->>'pulled_quantity'='4' AND s->>'reserved_quantity'='6','Source withdrawal preserves physical debit and reservation history');
END $$;
RESET ROLE;
UPDATE public.vehicle_observations SET is_superseded=true,superseded_at=now() WHERE id=(SELECT(v#>>'{}')::uuid FROM fixture WHERE k='release1');
SET ROLE authenticated;
SELECT pg_temp.ok((public.parts_stock_lot((SELECT(v#>>'{}')::uuid FROM fixture WHERE k='lot'))->>'released_quantity')::numeric=0,'Withdrawn release cannot free stock');
DO $$ DECLARE first_page jsonb; second_page jsonb; BEGIN
 first_page:=public.parts_stock_inventory('00000000-0000-0000-0000-000000000010',NULL,1);
 second_page:=public.parts_stock_inventory('00000000-0000-0000-0000-000000000010',(first_page->>'next_after')::uuid,1);
 PERFORM pg_temp.ok(first_page->>'recorded_lot_count'='2' AND jsonb_array_length(first_page->'rows')=1
 AND first_page->>'next_after' IS NOT NULL AND jsonb_array_length(second_page->'rows')=1 AND second_page->>'next_after' IS NULL,
 'Owner inventory is discoverable and paged without dropping held lots');
 PERFORM pg_temp.ok(first_page#>>'{rows,0,lot_id}' IS DISTINCT FROM second_page#>>'{rows,0,lot_id}'
 AND first_page->>'unreceipted_stock'='not_assessed','No repeated page or false absence of unreceipted stock');
 PERFORM pg_temp.ok(public.parts_stock_inventory('00000000-0000-0000-0000-000000000020') IS NULL,'Other account vehicle cannot browse own-or-foreign stock through its key');
 PERFORM pg_temp.ok(first_page::text NOT LIKE '%content_text%' AND first_page::text NOT LIKE '%unit_price%','Inventory does not project receipt prose or money');
END $$;
RESET ROLE;
DELETE FROM public.test_receipt_catalog WHERE item_id='00000000-0000-0000-0000-000000000052';
SET ROLE authenticated;
SELECT pg_temp.ok(public.parts_receipt_stock_identity('00000000-0000-0000-0000-000000000052')->>'identity_state'='unqualified'
 AND public.parts_receipt_stock_identity('00000000-0000-0000-0000-000000000052')->>'catalog_part_id' IS NULL,
 'An owned receipt line without qualified product identity stays unknown');
RESET ROLE;
INSERT INTO public.test_receipt_catalog VALUES('00000000-0000-0000-0000-000000000052','00000000-0000-0000-0000-000000000060');
-- Retain the owner's historical arrival without exposing a receipt's new owner
-- or a new foreign parent when source records move after admission.
UPDATE public.receipts SET user_id='00000000-0000-0000-0000-000000000002',vehicle_id='00000000-0000-0000-0000-000000000020'
 WHERE id='00000000-0000-0000-0000-000000000040';
SET ROLE authenticated;
DO $$ DECLARE row jsonb; BEGIN
 PERFORM pg_temp.ok(public.parts_receipt_stock_identity('00000000-0000-0000-0000-000000000050') IS NULL,
 'Identity wrapper no longer exposes source after ownership changes');
 SELECT r INTO row FROM jsonb_array_elements(public.parts_stock_inventory('00000000-0000-0000-0000-000000000010')->'rows') r
 WHERE r->>'receipt_item_id'='00000000-0000-0000-0000-000000000050';
 PERFORM pg_temp.ok(row IS NOT NULL AND row->>'receipt_id' IS NULL AND row->>'receipt_vehicle_id' IS NULL
 AND row->>'receipt_source_visible'='false' AND row->'holds' ? 'receipt_source_withdrawn_or_changed',
 'Foreign receipt ownership masks locators without deleting historical lot');
END $$;
RESET ROLE;
UPDATE public.receipts SET user_id='00000000-0000-0000-0000-000000000001',vehicle_id='00000000-0000-0000-0000-000000000010'
 WHERE id='00000000-0000-0000-0000-000000000040';
UPDATE public.receipt_items SET receipt_id='00000000-0000-0000-0000-000000000041' WHERE id='00000000-0000-0000-0000-000000000050';
SET ROLE authenticated;
DO $$ DECLARE row jsonb; BEGIN
 SELECT r INTO row FROM jsonb_array_elements(public.parts_stock_inventory('00000000-0000-0000-0000-000000000010')->'rows') r
 WHERE r->>'receipt_item_id'='00000000-0000-0000-0000-000000000050';
 PERFORM pg_temp.ok(row IS NOT NULL AND row->>'receipt_id' IS NULL AND row->>'receipt_vehicle_id' IS NULL
 AND row->>'receipt_source_visible'='false','Receipt-line move cannot expose a foreign source parent');
END $$;
RESET ROLE;
SELECT 'parts receiving: units, actor, receipt identity, inspection, requirement/lot conservation, separate pull/release and historical binding passed' AS result;
