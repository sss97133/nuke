-- Disposable synthetic contract for the master ledger's image map; no production rows.
-- Expanding master_ledger.images back into the rows must give the previous ledger exactly,
-- minus rows[].pricing.product; the rest of the reader output is unchanged.
\set ON_ERROR_STOP on
\ir test_visual_work_build_log_state.sql

-- Two current lines (an operation and a catalog-priced material) citing the same source photograph.
UPDATE vehicle_observations SET is_superseded=false,structured_data=(SELECT packet FROM baseline_packet)
 WHERE id='a0000000-0000-0000-0000-000000000001';
UPDATE vehicle_observations SET is_superseded=false WHERE id='a5000000-0000-0000-0000-000000000001';
CREATE TEMP TABLE before_ledger(amounts_visible boolean PRIMARY KEY, output jsonb);
INSERT INTO before_ledger SELECT t,public.visual_work_build_log_compute('10000000-0000-0000-0000-000000000001',t) FROM unnest(ARRAY[false,true]) t;
CREATE TEMP TABLE before_digest AS SELECT public.visual_work_build_log_inputs_digest('10000000-0000-0000-0000-000000000001') d;

\ir ../migrations/20261116025000_visual_work_ledger_image_map.sql

-- Re-expansion used by this contract only: string entries resolve through the map.
CREATE FUNCTION pg_temp.expand(j jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN j ? 'master_ledger' THEN jsonb_set(j,'{master_ledger}',(j->'master_ledger')-'images'||jsonb_build_object('scenarios',(
  SELECT coalesce(jsonb_agg(s||jsonb_build_object('rows',(
   SELECT coalesce(jsonb_agg(r||jsonb_build_object('source_images',(
    SELECT coalesce(jsonb_agg(CASE WHEN jsonb_typeof(si)='string' THEN j->'master_ledger'->'images'->(si#>>'{}') ELSE si END ORDER BY io),'[]')
    FROM jsonb_array_elements(r->'source_images') WITH ORDINALITY y(si,io))) ORDER BY ro),'[]')
   FROM jsonb_array_elements(s->'rows') WITH ORDINALITY z(r,ro))) ORDER BY so),'[]')
  FROM jsonb_array_elements(j#>'{master_ledger,scenarios}') WITH ORDINALITY x(s,so)))) ELSE j END $$;
CREATE FUNCTION pg_temp.drop_product(j jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN j ? 'master_ledger' THEN jsonb_set(j,'{master_ledger,scenarios}',(
  SELECT coalesce(jsonb_agg(s||jsonb_build_object('rows',(
   SELECT coalesce(jsonb_agg(CASE WHEN jsonb_typeof(r->'pricing')='object' THEN r||jsonb_build_object('pricing',(r->'pricing')-'product') ELSE r END ORDER BY ro),'[]')
   FROM jsonb_array_elements(s->'rows') WITH ORDINALITY z(r,ro))) ORDER BY so),'[]')
  FROM jsonb_array_elements(j#>'{master_ledger,scenarios}') WITH ORDINALITY x(s,so))) ELSE j END $$;

DO $$
DECLARE v uuid:='10000000-0000-0000-0000-000000000001'; b jsonb; a jsonb; t boolean; c jsonb; img jsonb; s jsonb;
BEGIN
 ASSERT NOT has_function_privilege('anon','visual_work_master_ledger_compact(jsonb)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','visual_work_master_ledger_compact(jsonb)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','visual_work_master_ledger_compact(jsonb)','EXECUTE');
 -- The fixture really exercises both changes.
 SELECT output INTO b FROM before_ledger WHERE NOT amounts_visible;
 ASSERT jsonb_array_length(b#>'{master_ledger,scenarios,0,rows}')=2,'fixture needs two rows';
 ASSERT (SELECT count(*) FROM jsonb_array_elements(b#>'{master_ledger,scenarios,0,rows}') r WHERE jsonb_array_length(r->'source_images')>0)=2;
 ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(b#>'{master_ledger,scenarios,0,rows}') r WHERE r#>'{pricing,product}' IS NOT NULL
  AND jsonb_typeof(r#>'{pricing,product}')='object'),'fixture needs a catalog product under pricing';

 -- 1. Re-expanded output equals the previous output minus the unused product copy, both variants.
 FOR t IN SELECT unnest(ARRAY[false,true]) LOOP
  SELECT output INTO b FROM before_ledger WHERE amounts_visible=t;
  a:=public.visual_work_build_log_compute(v,t);
  ASSERT pg_temp.expand(a) #- '{master_ledger,as_of}' = pg_temp.drop_product(b) #- '{master_ledger,as_of}',
   'expanded ledger differs, amounts_visible='||t;
  -- Rows carry ids only; each mapped photograph appears once.
  ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a#>'{master_ledger,scenarios}') sc CROSS JOIN LATERAL jsonb_array_elements(sc->'rows') r
   CROSS JOIN LATERAL jsonb_array_elements(r->'source_images') si WHERE jsonb_typeof(si)<>'string'),'identical photos must be ids';
  ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a#>'{master_ledger,scenarios}') sc CROSS JOIN LATERAL jsonb_array_elements(sc->'rows') r
   WHERE r->'pricing' ? 'product'),'pricing.product must be dropped';
  ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(a#>'{master_ledger,scenarios}') sc CROSS JOIN LATERAL jsonb_array_elements(sc->'rows') r
   WHERE r#>>'{pricing,receipt_item_id}' IS NOT NULL),'receipt_item_id stays';
  ASSERT a #- '{master_ledger}' = b #- '{master_ledger}','visual_work and other keys unchanged';
  ASSERT (a->'master_ledger')-'images'-'scenarios'-'as_of' = (b->'master_ledger')-'scenarios'-'as_of';
  ASSERT (SELECT count(*) FROM jsonb_object_keys(a#>'{master_ledger,images}'))=1;
 END LOOP;
 -- The visual_work product card the page reads is still present.
 ASSERT jsonb_typeof(a#>'{visual_work,0,receipts,0,product}')='object';

 -- 2. A photograph cited differently by two rows stays inline in each; others are mapped.
 img:='{"image_id":"i1","image_url":"https://images.example/1.jpg","role":"after","caption":"One"}';
 c:=public.visual_work_master_ledger_compact(jsonb_build_array(jsonb_build_object('scenario','reconstruct_observed','totals','{}'::jsonb,
  'rows',jsonb_build_array(
   jsonb_build_object('label','a','source_images',jsonb_build_array(img,img||'{"image_id":"i2","image_url":"https://images.example/2.jpg"}'),
    'pricing','{"kind":"catalog","receipt_item_id":"x","product":{"name":"p"}}'::jsonb),
   jsonb_build_object('label','b','source_images',jsonb_build_array(img||'{"image_id":"i2","image_url":"https://images.example/2.jpg","role":"source"}'),
    'pricing',NULL),
   jsonb_build_object('label','c','source_images','[]'::jsonb,'pricing','{"kind":"unpriced"}'::jsonb)))));
 ASSERT c->'images'=jsonb_build_object('i1',img),c::text;
 s:=c#>'{scenarios,0}';
 ASSERT s#>'{rows,0,source_images}'=jsonb_build_array('i1',img||'{"image_id":"i2","image_url":"https://images.example/2.jpg"}'),s::text;
 ASSERT s#>'{rows,1,source_images,0,role}'='"source"' AND s#>'{rows,0,pricing}'='{"kind":"catalog","receipt_item_id":"x"}';
 ASSERT s#>'{rows,1,pricing}'='null' AND s#>'{rows,2,pricing}'='{"kind":"unpriced"}' AND s->'totals'='{}';
 ASSERT public.visual_work_master_ledger_compact('[]')='{"images":{},"scenarios":[]}';

 -- 3. The deployed change is a changed input for stored build logs; the helper is in the digest.
 ASSERT public.visual_work_build_log_inputs_digest(v)<>(SELECT d FROM before_digest);
 ASSERT pg_get_functiondef('public.visual_work_build_log_inputs_digest(uuid)'::regprocedure) ~ 'visual_work_master_ledger_compact';
 PERFORM set_config('test.role','',false);
 ASSERT (public.visual_work_build_log_refresh()->>'computed')='2';
 ASSERT (SELECT output FROM visual_work_build_log_state WHERE vehicle_id=v AND NOT amounts_visible) #- '{master_ledger,as_of}'
  = public.visual_work_build_log_compute(v,false) #- '{master_ledger,as_of}';
 PERFORM set_config('test.role','anon',false);
 ASSERT public.visual_work_build_log(v)=(SELECT output FROM visual_work_build_log_state WHERE vehicle_id=v AND NOT amounts_visible);
END $$;
SELECT 'visual work ledger image map contract passed' AS result;
