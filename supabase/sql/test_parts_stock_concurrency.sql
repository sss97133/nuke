\set ON_ERROR_STOP on
-- Native PostgreSQL17 only: dblink supplies genuinely independent sessions.
-- This is intentionally not represented as a PGlite concurrency proof.
\i supabase/sql/test_parts_receiving_stock.sql
RESET ROLE;
CREATE EXTENSION dblink;

CREATE FUNCTION public.test_stock_requirement() RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE r uuid:=gen_random_uuid();
BEGIN
 INSERT INTO public.harness_model_component_requirements VALUES('00000000-0000-0000-0000-000000000102',r,'connector_housing',NULL,gen_random_uuid(),NULL,
 '00000000-0000-0000-0000-000000000060',1,'each','provisional');
 RETURN r;
END $$;
SELECT dblink_connect('stock_a',format('dbname=%L host=%L port=%L user=%L',current_database(),split_part(current_setting('unix_socket_directories'),',',1),current_setting('port'),current_user));
SELECT dblink_connect('stock_b',format('dbname=%L host=%L port=%L user=%L',current_database(),split_part(current_setting('unix_socket_directories'),',',1),current_setting('port'),current_user));
SELECT dblink_exec('stock_a','SET ROLE authenticated'),dblink_exec('stock_b','SET ROLE authenticated');
SELECT dblink_exec('stock_a',$q$SET test.uid='00000000-0000-0000-0000-000000000001'$q$),dblink_exec('stock_b',$q$SET test.uid='00000000-0000-0000-0000-000000000001'$q$);
SELECT dblink_exec('stock_a',$q$SET test.jwt='{"role":"authenticated","is_anonymous":false}'$q$),dblink_exec('stock_b',$q$SET test.jwt='{"role":"authenticated","is_anonymous":false}'$q$);
CREATE FUNCTION public.test_stock_pair(p_a text,p_b text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE a jsonb; b jsonb; attempt text=$attempt$
 DO $race$ DECLARE result jsonb; BEGIN
  BEGIN
   EXECUTE %L INTO result;
   -- Retain real locks while the peer contends. Domain calls are direct;
   -- no test wrapper impersonates a sanctioned account-work entry point.
   PERFORM pg_sleep(0.2);
   PERFORM set_config('test.stock_result',jsonb_build_object('status','ok','result',result)::text,false);
  EXCEPTION WHEN OTHERS THEN
   PERFORM set_config('test.stock_result',jsonb_build_object('status','refused','code',SQLSTATE,'message',SQLERRM)::text,false);
  END;
 END $race$
 $attempt$;
BEGIN
 PERFORM dblink_send_query('stock_a',format(attempt,p_a));
 PERFORM dblink_send_query('stock_b',format(attempt,p_b));
 PERFORM status FROM dblink_get_result('stock_a') AS x(status text);
 PERFORM status FROM dblink_get_result('stock_b') AS x(status text);
 -- Async connections must be drained before the next independent race.
 PERFORM status FROM dblink_get_result('stock_a') AS x(status text);
 PERFORM status FROM dblink_get_result('stock_b') AS x(status text);
 SELECT r INTO a FROM dblink('stock_a',$q$SELECT current_setting('test.stock_result')::jsonb$q$) AS x(r jsonb);
 SELECT r INTO b FROM dblink('stock_b',$q$SELECT current_setting('test.stock_result')::jsonb$q$) AS x(r jsonb);
 RETURN jsonb_build_array(a,b);
END $$;

-- Commit fixture arrivals/reservations before asking other sessions to see them.
CREATE TABLE public.stock_race_cases(name text PRIMARY KEY,lot_a uuid,lot_b uuid,req_a uuid,req_b uuid,allocation_id uuid);
INSERT INTO public.stock_race_cases(name,req_a,req_b) VALUES
 ('same_lot',public.test_stock_requirement(),public.test_stock_requirement()),('two_lots',public.test_stock_requirement(),NULL),
 ('pull_release',public.test_stock_requirement(),NULL),('inspection_pull',public.test_stock_requirement(),NULL);
DO $$ DECLARE scenario record; r uuid; i uuid; lot uuid; source jsonb; position int; BEGIN
 FOR scenario IN SELECT name FROM public.stock_race_cases LOOP
  FOR position IN 1..(CASE WHEN scenario.name='two_lots' THEN 2 ELSE 1 END) LOOP
   r:=gen_random_uuid(); i:=gen_random_uuid();
   INSERT INTO public.receipts(id,user_id,vehicle_id) VALUES(r,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010');
   INSERT INTO public.receipt_items(id,receipt_id,part_number,description,quantity) VALUES(i,r,'FIXTURE-PART','Synthetic concurrency arrival',1);
   INSERT INTO public.test_receipt_catalog VALUES(i,'00000000-0000-0000-0000-000000000060');
   source:=public.record_parts_arrival(gen_random_uuid(),jsonb_build_object('receipt_item_id',i,'catalog_part_id','00000000-0000-0000-0000-000000000060',
    'quantity',1,'unit','ea','received_at','2026-11-24T10:00:00Z','receipt_line_is_this_arrival',true));
   lot:=(source->>'lot_id')::uuid;
   PERFORM public.record_parts_inspection(gen_random_uuid(),lot,1,0,'2026-11-24T11:00:00Z');
   IF position=1 THEN UPDATE public.stock_race_cases SET lot_a=lot WHERE name=scenario.name;
   ELSE UPDATE public.stock_race_cases SET lot_b=lot WHERE name=scenario.name; END IF;
  END LOOP;
 END LOOP;
END $$;
UPDATE public.stock_race_cases SET allocation_id=(public.reserve_parts_stock(gen_random_uuid(),lot_a,
 '00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000102',NULL,req_a,1)->>'allocation_id')::uuid
 WHERE name IN('pull_release','inspection_pull');

DO $$ DECLARE lot uuid; one uuid; two uuid; results jsonb;
BEGIN
 SELECT lot_a,req_a,req_b INTO lot,one,two FROM public.stock_race_cases WHERE name='same_lot';
 results:=public.test_stock_pair(
 format('SELECT public.reserve_parts_stock(%L,%L,%L,%L,NULL,%L,1)',gen_random_uuid(),lot,'00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000102',one),
 format('SELECT public.reserve_parts_stock(%L,%L,%L,%L,NULL,%L,1)',gen_random_uuid(),lot,'00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000102',two));
 IF (SELECT count(*) FROM jsonb_array_elements(results) r WHERE r->>'status'='ok')<>1
 OR (SELECT count(*) FROM jsonb_array_elements(results) r WHERE r->>'code'='P0001' AND r->>'message'='Inspected available stock is insufficient or held')<>1
 OR (SELECT sum(quantity) FROM public.parts_stock_allocations WHERE lot_id=lot)<>1 THEN RAISE EXCEPTION 'Concurrent same-lot over-allocation: %',results; END IF;
END $$;

DO $$ DECLARE lot_a uuid; lot_b uuid; req uuid; results jsonb;
BEGIN
 SELECT x.lot_a,x.lot_b,x.req_a INTO lot_a,lot_b,req FROM public.stock_race_cases x WHERE name='two_lots';
 results:=public.test_stock_pair(
 format('SELECT public.reserve_parts_stock(%L,%L,%L,%L,NULL,%L,1)',gen_random_uuid(),lot_a,'00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000102',req),
 format('SELECT public.reserve_parts_stock(%L,%L,%L,%L,NULL,%L,1)',gen_random_uuid(),lot_b,'00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000102',req));
 IF (SELECT count(*) FROM jsonb_array_elements(results) r WHERE r->>'status'='ok')<>1
 OR (SELECT count(*) FROM jsonb_array_elements(results) r WHERE r->>'code'='P0001' AND r->>'message'='Requirement already reserved or consumed')<>1
 OR (SELECT sum(quantity) FROM public.parts_stock_allocations WHERE component_requirement_id=req)<>1 THEN RAISE EXCEPTION 'Concurrent cross-lot target over-allocation: %',results; END IF;
END $$;

DO $$ DECLARE lot uuid; req uuid; allocation uuid; results jsonb;
BEGIN
 SELECT lot_a,req_a,allocation_id INTO lot,req,allocation FROM public.stock_race_cases WHERE name='pull_release';
 results:=public.test_stock_pair(
 format('SELECT public.record_parts_stock_event(%L,%L,''release'',1,statement_timestamp())',gen_random_uuid(),allocation),
 format('SELECT public.record_parts_stock_event(%L,%L,''pull'',1,statement_timestamp())',gen_random_uuid(),allocation));
 IF (SELECT count(*) FROM jsonb_array_elements(results) r WHERE r->>'status'='ok')<>1
 OR (SELECT count(*) FROM jsonb_array_elements(results) r WHERE r->>'code'='P0001' AND r->>'message'='Quantity already released or pulled')<>1
 OR (SELECT sum(quantity) FROM public.parts_stock_events WHERE allocation_id=allocation)<>1 THEN RAISE EXCEPTION 'Concurrent pull and release spent same reservation: %',results; END IF;
END $$;

DO $$ DECLARE lot uuid; req uuid; allocation uuid; inspection uuid; results jsonb; state jsonb;
BEGIN
 SELECT lot_a,req_a,allocation_id INTO lot,req,allocation FROM public.stock_race_cases WHERE name='inspection_pull';
 inspection:=(public.parts_stock_lot(lot)->>'inspection_observation_id')::uuid;
 results:=public.test_stock_pair(
 format('SELECT public.record_parts_inspection(%L,%L,0,1,statement_timestamp(),%L)',gen_random_uuid(),lot,inspection),
 format('SELECT public.record_parts_stock_event(%L,%L,''pull'',1,statement_timestamp())',gen_random_uuid(),allocation));
 state:=public.parts_stock_lot(lot);
 IF (SELECT count(*) FROM jsonb_array_elements(results) r WHERE r->>'status'='ok') NOT BETWEEN 1 AND 2
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(results) r WHERE r->>'status'='refused'
 AND (r->>'code'<>'P0001' OR r->>'message'<>'Physical stock qualification is held'))
 OR state->>'accepted_quantity'<>'0' OR state->>'available_quantity' IS NOT NULL
 OR NOT state->'holds' ? 'inspection_below_committed_quantity'
 OR (SELECT coalesce(sum(quantity),0) FROM public.parts_stock_events WHERE allocation_id=allocation)>1
 THEN RAISE EXCEPTION 'Concurrent inspection/pull lost rejection or debit history: %, %',results,state; END IF;
END $$;
SELECT dblink_disconnect('stock_a'),dblink_disconnect('stock_b');
SELECT 'native stock races: same-lot, cross-lot target, pull/release, inspection/pull passed' AS result;
