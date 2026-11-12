-- Disposable synthetic contract for the stored visual work build log; no production rows.
-- The stored output must equal a fresh compute, be served only while its inputs are unchanged,
-- never cross amount visibility, and leave the reader's output identical to before the migration.
\set ON_ERROR_STOP on
\ir test_visual_work_fixed_service_fees.sql

-- Restore the admitted card the prior contract ended by excluding (confidence above the gate),
-- then record the pre-migration reader output for anon and the owner.
UPDATE vehicle_observations SET confidence_score=.6 WHERE id='a0000000-0000-0000-0000-000000000001';
CREATE TEMP TABLE before_reader(role text PRIMARY KEY, output jsonb);
DO $$ DECLARE v uuid:='10000000-0000-0000-0000-000000000001'; BEGIN
 PERFORM set_config('test.role','anon',false); PERFORM set_config('test.uid','',false);
 INSERT INTO before_reader VALUES('anon',public.visual_work_build_log(v));
 PERFORM set_config('test.role','authenticated',false); PERFORM set_config('test.uid','20000000-0000-0000-0000-000000000001',false);
 INSERT INTO before_reader VALUES('owner',public.visual_work_build_log(v));
 PERFORM set_config('test.role','anon',false); PERFORM set_config('test.uid','',false);
 ASSERT (SELECT output FROM before_reader WHERE role='anon') ? 'master_ledger','fixture must reach the cost fold';
 ASSERT (SELECT output#>'{visual_work,0,receipts,0,amount}' FROM before_reader WHERE role='owner')<>'null'::jsonb,
  'owner fixture must carry a receipt amount';
END $$;

\ir ../migrations/20261116022000_visual_work_build_log_state.sql

DO $$
DECLARE v uuid:='10000000-0000-0000-0000-000000000001'; j jsonb; k jsonb; r jsonb; d text; st record;
BEGIN
 -- Private helpers and the state table are not reachable from the API roles.
 ASSERT NOT has_function_privilege('anon','visual_work_build_log_compute(uuid,boolean)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','visual_work_build_log_compute(uuid,boolean)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','visual_work_build_log_compute(uuid,boolean)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','visual_work_build_log_inputs_digest(uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','visual_work_build_log_refresh(integer)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','visual_work_build_log_refresh(integer)','EXECUTE');
 ASSERT NOT has_table_privilege('anon','public.visual_work_build_log_state','SELECT');
 ASSERT NOT has_table_privilege('authenticated','public.visual_work_build_log_state','SELECT');
 ASSERT NOT has_function_privilege('anon','visual_work_master_cost_fold(uuid,jsonb,boolean,boolean)','EXECUTE');

 -- 1. With nothing stored the reader computes live, identical to before the migration.
 PERFORM set_config('test.role','anon',false); PERFORM set_config('test.uid','',false);
 ASSERT NOT EXISTS(SELECT 1 FROM visual_work_build_log_state);
 j:=public.visual_work_build_log(v);
 ASSERT j #- '{master_ledger,as_of}' = (SELECT output #- '{master_ledger,as_of}' FROM before_reader WHERE role='anon'),'anon live drifted';
 PERFORM set_config('test.role','authenticated',false); PERFORM set_config('test.uid','20000000-0000-0000-0000-000000000001',false);
 j:=public.visual_work_build_log(v);
 ASSERT j #- '{master_ledger,as_of}' = (SELECT output #- '{master_ledger,as_of}' FROM before_reader WHERE role='owner'),'owner live drifted';

 -- 2. The refresher runs without a JWT and stores both visibility variants.
 PERFORM set_config('test.role','',false); PERFORM set_config('test.uid','',false);
 r:=public.visual_work_build_log_refresh();
 ASSERT r->>'computed'='2' AND r->>'deferred'='0',r::text;
 ASSERT (SELECT count(*) FROM visual_work_build_log_state WHERE vehicle_id=v)=2;
 -- Contract: each stored output equals a fresh compute (as_of is the compute time).
 FOR st IN SELECT * FROM visual_work_build_log_state WHERE vehicle_id=v LOOP
  ASSERT st.output #- '{master_ledger,as_of}' = public.visual_work_build_log_compute(v,st.amounts_visible) #- '{master_ledger,as_of}',
   'stored differs from fresh compute, amounts_visible='||st.amounts_visible;
  ASSERT st.inputs_digest=public.visual_work_build_log_inputs_digest(v);
  ASSERT st.valid_until>st.computed_at AND st.valid_until<=st.computed_at+interval '1 hour';
 END LOOP;
 ASSERT (SELECT output FROM visual_work_build_log_state WHERE vehicle_id=v AND NOT amounts_visible)#>'{visual_work,0,receipts,0,amount}'='null'::jsonb;
 -- A second run with unchanged inputs computes nothing.
 r:=public.visual_work_build_log_refresh();
 ASSERT r->>'computed'='0' AND r->>'fresh'='2',r::text;

 -- 3. Each viewer gets its own variant from the store, byte for byte, and the same output as before.
 PERFORM set_config('test.role','anon',false); PERFORM set_config('test.uid','',false);
 j:=public.visual_work_build_log(v);
 ASSERT j=(SELECT output FROM visual_work_build_log_state WHERE vehicle_id=v AND NOT amounts_visible),'anon not served from store';
 ASSERT j #- '{master_ledger,as_of}' = (SELECT output #- '{master_ledger,as_of}' FROM before_reader WHERE role='anon');
 ASSERT j#>'{visual_work,0,receipts,0,amount}'='null'::jsonb,'anon must never get the owner variant';
 k:=public.vehicle_build_log_public(v,false);
 ASSERT k #- '{master_ledger,as_of}' = (j #- '{master_ledger,as_of}')||jsonb_build_object('work_records',k->'work_records','reported_work',k->'reported_work');
 PERFORM set_config('test.role','authenticated',false); PERFORM set_config('test.uid','20000000-0000-0000-0000-000000000001',false);
 j:=public.visual_work_build_log(v);
 ASSERT j=(SELECT output FROM visual_work_build_log_state WHERE vehicle_id=v AND amounts_visible),'owner not served from store';
 ASSERT j #- '{master_ledger,as_of}' = (SELECT output #- '{master_ledger,as_of}' FROM before_reader WHERE role='owner');
 -- An unrelated signed-in user is not tied: the anon variant.
 PERFORM set_config('test.uid','29999999-0000-0000-0000-000000000009',false);
 ASSERT public.visual_work_build_log(v)=(SELECT output FROM visual_work_build_log_state WHERE vehicle_id=v AND NOT amounts_visible);

 -- 4. Any changed input is a miss: the reader computes live until the refresher catches up.
 PERFORM set_config('test.role','anon',false); PERFORM set_config('test.uid','',false);
 d:=public.visual_work_build_log_inputs_digest(v);
 -- A withdrawn cited image (privacy): never served from the store.
 UPDATE vehicle_images SET is_sensitive=true WHERE id='4abcdef1-0000-0000-0000-000000000002';
 ASSERT public.visual_work_build_log_inputs_digest(v)<>d,'image withdrawal must change the digest';
 j:=public.visual_work_build_log(v);
 ASSERT j #- '{master_ledger,as_of}' = public.visual_work_build_log_compute(v,false) #- '{master_ledger,as_of}';
 ASSERT j #- '{master_ledger,as_of}' <> (SELECT output #- '{master_ledger,as_of}' FROM visual_work_build_log_state WHERE vehicle_id=v AND NOT amounts_visible),
  'a withdrawn image must not be served from the store';
 UPDATE vehicle_images SET is_sensitive=false WHERE id='4abcdef1-0000-0000-0000-000000000002';
 ASSERT public.visual_work_build_log_inputs_digest(v)=d;
 -- A superseded cost-line source, a retired receipt link, an edited receipt line, an edited record.
 UPDATE vehicle_observations SET is_superseded=true WHERE id='a5000000-0000-0000-0000-000000000001';
 ASSERT public.visual_work_build_log_inputs_digest(v)<>d;
 UPDATE vehicle_observations SET is_superseded=false WHERE id='a5000000-0000-0000-0000-000000000001';
 UPDATE receipt_vehicle_links SET retired_at=now() WHERE id='80000000-0000-0000-0000-000000000001';
 ASSERT public.visual_work_build_log_inputs_digest(v)<>d;
 UPDATE receipt_vehicle_links SET retired_at=NULL WHERE id='80000000-0000-0000-0000-000000000001';
 UPDATE receipt_items SET total_price=coalesce(total_price,0)+1 WHERE id='70000000-0000-0000-0000-000000000001';
 ASSERT public.visual_work_build_log_inputs_digest(v)<>d;
 UPDATE receipt_items SET total_price=total_price-1 WHERE id='70000000-0000-0000-0000-000000000001';
 UPDATE vehicles SET year=coalesce(year,1970)+1 WHERE id=v;
 ASSERT public.visual_work_build_log_inputs_digest(v)<>d;
 UPDATE vehicles SET year=year-1 WHERE id=v;
 ASSERT public.visual_work_build_log_inputs_digest(v)=d,'restored inputs restore the digest';
 -- Catalog evidence behind a product card: a withdrawn page snapshot, a removed stock image,
 -- a changed quote. Each must be read live, never from the store.
 ASSERT (SELECT output#>'{visual_work,0,receipts,0,product}' FROM visual_work_build_log_state WHERE vehicle_id=v AND NOT amounts_visible)<>'null'::jsonb,
  'fixture product card must be stored';
 UPDATE listing_page_snapshots SET success=false WHERE id='a0000000-0000-0000-0000-000000000001';
 ASSERT public.visual_work_build_log_inputs_digest(v)<>d,'snapshot withdrawal must change the digest';
 ASSERT public.visual_work_build_log(v)#>'{visual_work,0,receipts,0,product}'='null'::jsonb,'withdrawn snapshot served from store';
 UPDATE listing_page_snapshots SET success=true WHERE id='a0000000-0000-0000-0000-000000000001';
 DELETE FROM storage.objects WHERE bucket_id='catalog-images';
 ASSERT public.visual_work_build_log_inputs_digest(v)<>d,'stock image removal must change the digest';
 INSERT INTO storage.objects VALUES('catalog-images','receipt-products/'||repeat('b',64)||'.jpeg');
 UPDATE catalog_parts SET price_current=price_current+1 WHERE id='c0000000-0000-0000-0000-000000000001';
 ASSERT public.visual_work_build_log_inputs_digest(v)<>d,'a changed quote must change the digest';
 UPDATE catalog_parts SET price_current=price_current-1 WHERE id='c0000000-0000-0000-0000-000000000001';
 ASSERT public.visual_work_build_log_inputs_digest(v)=d;
 -- A deployed change to a helper the compute calls is a changed input.
 EXECUTE replace(pg_get_functiondef('public.receipt_product_number(text)'::regprocedure),'$function$ SELECT','$function$ /* v2 */ SELECT');
 ASSERT public.visual_work_build_log_inputs_digest(v)<>d,'a helper body change must change the digest';
 EXECUTE replace(pg_get_functiondef('public.receipt_product_number(text)'::regprocedure),'$function$ /* v2 */ SELECT','$function$ SELECT');
 ASSERT public.visual_work_build_log_inputs_digest(v)=d;
 UPDATE vehicle_observations SET structured_data=jsonb_set(structured_data,'{title}','"Front assembly, revised"')
  WHERE id='a0000000-0000-0000-0000-000000000001';
 ASSERT public.visual_work_build_log_inputs_digest(v)<>d;
 j:=public.visual_work_build_log(v);
 ASSERT j#>>'{visual_work,0,title}'='Front assembly, revised','an edited record must be read live';
 PERFORM set_config('test.role','',false);
 r:=public.visual_work_build_log_refresh();
 ASSERT r->>'computed'='2',r::text;
 PERFORM set_config('test.role','anon',false);
 ASSERT public.visual_work_build_log(v)=(SELECT output FROM visual_work_build_log_state WHERE vehicle_id=v AND NOT amounts_visible);
 ASSERT public.visual_work_build_log(v)#>>'{visual_work,0,title}'='Front assembly, revised';

 -- 5. An expired row is a miss, and the refresher renews rows about to expire.
 -- (One DO block shares statement_timestamp, so a sentinel output marks what is served.)
 UPDATE visual_work_build_log_state SET output='{"sentinel":true}' WHERE vehicle_id=v AND NOT amounts_visible;
 ASSERT public.visual_work_build_log(v)='{"sentinel":true}'::jsonb,'a current row is served as stored';
 UPDATE visual_work_build_log_state SET valid_until=now()-interval '1 second' WHERE vehicle_id=v AND NOT amounts_visible;
 ASSERT public.visual_work_build_log(v) #- '{master_ledger,as_of}' = public.visual_work_build_log_compute(v,false) #- '{master_ledger,as_of}',
  'an expired row must not be served';
 PERFORM set_config('test.role','',false);
 r:=public.visual_work_build_log_refresh();
 ASSERT r->>'computed'='1' AND r->>'fresh'='1',r::text;
 -- A catalog quote turning stale bounds valid_until: captured 6 days 23 hours 30 minutes ago.
 UPDATE catalog_parts SET application_data=jsonb_set(application_data,'{receipt_product_v1,captured_at}',
  to_jsonb(now()-interval '6 days 23 hours 30 minutes')) WHERE id='c0000000-0000-0000-0000-000000000001';
 UPDATE visual_work_build_log_state SET valid_until=now() WHERE vehicle_id=v;
 r:=public.visual_work_build_log_refresh();
 ASSERT r->>'computed'='2',r::text;
 SELECT * INTO st FROM visual_work_build_log_state WHERE vehicle_id=v AND NOT amounts_visible;
 ASSERT st.valid_until=now()+interval '30 minutes',st.valid_until::text;
 ASSERT st.output#>>'{visual_work,0,receipts,0,product,price_stale}'='false';
 -- A batch limit defers the rest to the next run.
 UPDATE visual_work_build_log_state SET valid_until=now() WHERE vehicle_id=v;
 r:=public.visual_work_build_log_refresh(1);
 ASSERT r->>'computed'='1' AND r->>'deferred'='1',r::text;

 -- 6. A vehicle that stops being public loses its rows and is gated live.
 UPDATE vehicles SET is_public=false WHERE id=v;
 r:=public.visual_work_build_log_refresh();
 ASSERT r->>'removed'='2' AND NOT EXISTS(SELECT 1 FROM visual_work_build_log_state),r::text;
 PERFORM set_config('test.role','anon',false);
 ASSERT public.visual_work_build_log(v)='{}'::jsonb;
 UPDATE vehicles SET is_public=true WHERE id=v;
 -- A vehicle without visual work gets no row and reads exactly as before.
 UPDATE vehicle_observations SET is_superseded=true WHERE kind='work_record';
 PERFORM set_config('test.role','',false);
 r:=public.visual_work_build_log_refresh();
 ASSERT r->>'computed'='0' AND NOT EXISTS(SELECT 1 FROM visual_work_build_log_state),r::text;
 PERFORM set_config('test.role','anon',false);
 ASSERT public.visual_work_build_log(v)='{}'::jsonb;
END $$;
SELECT 'visual work build log state contract passed' AS result;
