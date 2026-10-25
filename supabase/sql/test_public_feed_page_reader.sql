\set ON_ERROR_STOP on
-- Synthetic disposable PG17 database only; never run on production.
DO $$ BEGIN IF to_regclass('public.vehicles') IS NOT NULL THEN RAISE EXCEPTION 'empty database required'; END IF; END $$;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
\ir fixtures/feed_visibility_preimage.sql
CREATE FUNCTION public.assert_true(value boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION '%',message; END IF; END $$;
INSERT INTO public.vehicles(id,year,make,model,series,trim,vin,status,is_public,listing_kind,owner_id,created_at,updated_at,
 asking_price,sale_price,sale_price_currency,sale_price_usd,current_value,mileage,has_photos,primary_image_url,
 origin_organization_id,canonical_vehicle_type,canonical_body_style,drivetrain,is_for_sale,discovery_source)
SELECT ('00000000-0000-4000-8000-'||lpad((1000+i)::text,12,'0'))::uuid,1980+i%20,
 CASE i%3 WHEN 0 THEN 'Chevrolet' WHEN 1 THEN 'GMC' ELSE 'Ford' END,
 CASE WHEN i%2=0 THEN 'Camaro' ELSE 'Truck' END,CASE WHEN i%4=0 THEN 'SS' ELSE 'Base' END,'TrimOnlyMarker',
 'SYNTHETIC-VIN-'||i,'active',CASE WHEN i%19=0 THEN NULL ELSE i%17<>0 END,
 CASE WHEN i%23=0 THEN 'non_vehicle_item' ELSE 'vehicle' END,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
 '2026-10-25T08:00:00Z'::timestamptz+i*interval '1 minute','2026-10-25T09:00:00Z'::timestamptz+i*interval '1 minute',
 12345.67,1000+i,CASE WHEN i=3 THEN 'EUR' ELSE 'USD' END,12345.67,9999.99,i*1000,i%2=0,
 CASE WHEN i%3=0 THEN 'https://fixture.invalid/image.jpg' END,
 CASE WHEN i%17=0 THEN NULL WHEN i%5=0 THEN 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid ELSE 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid END,
 CASE WHEN i%11=0 THEN NULL WHEN i%7=0 THEN 'BOAT' ELSE 'CAR' END,
 CASE WHEN i%2=0 THEN 'coupe' ELSE 'pickup' END,CASE WHEN i%3=0 THEN '4WD' ELSE 'RWD' END,i%2=0,
 CASE WHEN i%11=0 THEN NULL WHEN i%2=0 THEN 'bat' ELSE 'craigslist' END
FROM generate_series(1,64) i;
INSERT INTO public.clean_vehicle_prices(vehicle_id,best_price,price_source,is_sold)
SELECT id,CASE WHEN right(id::text,3)::integer%13=0 THEN NULL ELSE (right(id::text,3)::integer%9)*1000+1000 END,
 'asking',CASE WHEN right(id::text,3)::integer%11=0 THEN NULL ELSE right(id::text,3)::integer%3=0 END FROM public.vehicles;
INSERT INTO public.nuke_estimates(id,vehicle_id,estimated_value,value_low,value_high,confidence_score,deal_score,heat_score)
SELECT id,id,12345.67,11234.56,14567.89,75,right(id::text,3)::integer%10,right(id::text,3)::integer%7 FROM public.vehicles;
INSERT INTO public.vehicle_sale_price_untrusted_ids VALUES ('00000000-0000-4000-8000-000000001004');
-- Dedicated pagination cohort includes equal keys, NULL numerics/clocks and empty text.
INSERT INTO public.vehicles(id,year,make,model,status,is_public,created_at,updated_at,mileage,discovery_source)
SELECT ('00000000-0000-4000-8000-'||lpad((2000+i)::text,12,'0'))::uuid,2000,
 CASE i WHEN 1 THEN '' WHEN 2 THEN 'A' WHEN 3 THEN 'A' ELSE 'Z' END,'Cursor','active',true,
 CASE WHEN i IN (1,4) THEN NULL ELSE '2026-10-25T08:00:00Z'::timestamptz+(i%2)*interval '1 minute' END,
 CASE WHEN i IN (2,5) THEN NULL ELSE '2026-10-25T09:00:00Z'::timestamptz END,
 CASE WHEN i IN (1,4) THEN NULL ELSE (i%2)*1000 END,'cursor_fixture'
FROM generate_series(1,5) i;
INSERT INTO public.clean_vehicle_prices(vehicle_id,best_price,price_source,is_sold)
SELECT id,CASE WHEN right(id::text,1)::integer IN (1,4) THEN NULL ELSE (right(id::text,1)::integer%2)*1000 END,'asking',false
FROM public.vehicles WHERE discovery_source='cursor_fixture';
REFRESH MATERIALIZED VIEW public.vehicle_valuation_feed;
UPDATE public.vehicles SET deleted_at=now() WHERE id='00000000-0000-4000-8000-000000001061';
DELETE FROM public.vehicles WHERE id='00000000-0000-4000-8000-000000001062';
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.vehicles TO anon,authenticated,service_role;
CREATE POLICY fixture_visibility ON public.vehicles FOR SELECT USING (is_public IS TRUE OR owner_id=nullif(current_setting('request.jwt.claim.sub',true),'')::uuid);
CREATE TEMP TABLE before_storage AS SELECT oid,relfilenode,relacl FROM pg_class WHERE oid='public.vehicle_valuation_feed'::regclass;
CREATE TEMP TABLE before_job AS SELECT * FROM cron.job;
CREATE TEMP TABLE before_helper AS SELECT pg_get_functiondef('public.refresh_vehicle_valuation_feed_safe()'::regprocedure) definition;
\ir ../migrations/20261025131942_public_feed_page_reader.sql
SELECT public.assert_true((SELECT NOT prosecdef AND provolatile='s' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] FROM pg_proc WHERE oid='public.feed_public_page_read(jsonb,text,text,text,uuid,boolean,integer)'::regprocedure),'service reader is stable invoker with fixed search path');
SELECT public.assert_true((SELECT c.oid=b.oid AND c.relfilenode=b.relfilenode AND c.relacl=b.relacl FROM pg_class c,before_storage b WHERE c.oid='public.vehicle_valuation_feed'::regclass),'stage1 does not rename/rebuild cache or change existing grants');
SELECT public.assert_true(NOT EXISTS((SELECT * FROM cron.job EXCEPT SELECT * FROM before_job) UNION ALL(SELECT * FROM before_job EXCEPT SELECT * FROM cron.job)),'stage1 leaves refresh cron unchanged');
SELECT public.assert_true((SELECT definition=pg_get_functiondef('public.refresh_vehicle_valuation_feed_safe()'::regprocedure) FROM before_helper),'stage1 leaves refresh helper unchanged');
SET ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM * FROM public.feed_public_page_read(); RAISE EXCEPTION 'anon called service reader'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
SELECT public.assert_true(EXISTS(SELECT 1 FROM public.vehicles WHERE id='00000000-0000-4000-8000-000000001017'),'fixture caller may read owned private vehicle');
DO $$ BEGIN
 BEGIN PERFORM * FROM public.feed_public_page_read(); RAISE EXCEPTION 'authenticated called service reader'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- The independent oracle reproduces existing PostgREST filter semantics over the
-- synthetic cache and compares every returned field, including money and clocks.
CREATE FUNCTION public.assert_read(filters jsonb,where_sql text,sort_key text DEFAULT 'newest',sort_column text DEFAULT 'event_at',sort_dir text DEFAULT 'desc') RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual jsonb; expected jsonb;
BEGIN
 SELECT jsonb_agg(to_jsonb(r)-'ordinality' ORDER BY ordinality) INTO actual
 FROM public.feed_public_page_read(filters,sort_key,sort_dir,p_limit=>200) WITH ORDINALITY r;
 EXECUTE 'SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT f."vehicle_id", f."year", f."make", f."model", f."series", f."trim", f."transmission", f."drivetrain", f."body_style", f."canonical_body_style", f."mileage", f."vin", f."is_for_sale", f."sale_status", f."sale_date", f."created_at", f."updated_at", f."auction_end_at", f."event_at", f."discovery_url", f."discovery_source", f."profile_origin", f."origin_organization_id", f."city", f."state", f."listing_location", f."canonical_vehicle_type", f."has_photos", f."primary_image_url", f."thumbnail_url", f."medium_url", f."full_image_url", f."description_snippet", f."display_price", f."price_source", f."is_sold", f."asking_price", f."sale_price", f."current_value", f."nuke_estimate", f."nuke_estimate_low", f."nuke_estimate_high", f."nuke_estimate_confidence", f."price_tier", f."deal_score", f."deal_score_label", f."heat_score", f."heat_score_label", f."is_record_price", f."segment_record_price", f."feed_rank_score" FROM public.vehicle_valuation_feed f
 WHERE EXISTS(SELECT 1 FROM public.vehicles v WHERE v.id=f.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM ''non_vehicle_item'') AND ('||where_sql||') ORDER BY f.'||quote_ident(sort_column)||' '||sort_dir||',f.vehicle_id LIMIT 201) r' INTO expected;
 PERFORM public.assert_true(actual IS NOT DISTINCT FROM expected,'full payload/filter parity failed: '||filters::text||' / '||sort_key||' '||sort_dir);
END $$;
CREATE FUNCTION public.assert_rejected(filters jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN PERFORM * FROM public.feed_public_page_read(filters); RAISE EXCEPTION 'invalid filter accepted: %',filters;
 EXCEPTION WHEN data_exception THEN NULL; END;
END $$;
SET ROLE service_role;
SELECT public.assert_read('{}','true');
SELECT public.assert_true(NOT EXISTS(SELECT 1 FROM public.feed_public_page_read(p_limit=>200) r LEFT JOIN public.vehicles v ON v.id=r.vehicle_id WHERE v.id IS NULL OR v.is_public IS NOT TRUE OR v.deleted_at IS NOT NULL OR v.listing_kind='non_vehicle_item'),'service result excludes private,NULL,deleted,orphan,nonvehicle');
SELECT public.assert_read($filters${"vehicle_types": ["CAR"]}$filters$::jsonb,$where$f.canonical_vehicle_type IN ('CAR') OR f.canonical_vehicle_type IS NULL$where$);
SELECT public.assert_read($filters${"excluded_dealer_ids": ["dddddddd-dddd-4ddd-8ddd-dddddddddddd"]}$filters$::jsonb,$where$f.origin_organization_id NOT IN ('dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid)$where$);
SELECT public.assert_read($filters${"quality_min_price": 5000}$filters$::jsonb,$where$f.display_price>=5000 OR f.display_price IS NULL$where$);
SELECT public.assert_read($filters${"segment_year_min": 1985, "segment_year_max": 1998, "year_min": 1990, "year_max": 1995}$filters$::jsonb,$where$f.year>=1985 AND f.year<=1998 AND f.year>=1990 AND f.year<=1995$where$);
SELECT public.assert_read($filters${"segment_makes": ["chevrolet", "gmc"]}$filters$::jsonb,$where$f.make ILIKE 'chevrolet' OR f.make ILIKE 'gmc'$where$);
SELECT public.assert_read($filters${"segment_model_terms": ["car", "ruck"], "model_terms": ["Truck"]}$filters$::jsonb,$where$(f.model ILIKE '%car%' OR f.model ILIKE '%ruck%') AND f.model ILIKE '%Truck%'$where$);
SELECT public.assert_read($filters${"makes": ["GMC", "Ford"]}$filters$::jsonb,$where$f.make IN ('GMC','Ford')$where$);
SELECT public.assert_read($filters${"model_terms": ["Camaro", "truck"]}$filters$::jsonb,$where$f.model ILIKE '%Camaro%' OR f.model ILIKE '%truck%'$where$);
SELECT public.assert_read($filters${"body_styles": ["coupe"]}$filters$::jsonb,$where$f.canonical_body_style IN ('coupe')$where$);
SELECT public.assert_read($filters${"price_min": 3000, "price_max": 7000}$filters$::jsonb,$where$f.display_price>=3000 AND f.display_price<=7000$where$);
SELECT public.assert_read($filters${"is_4x4": true}$filters$::jsonb,$where$f.drivetrain ILIKE '%4wd%' OR f.drivetrain ILIKE '%4x4%' OR f.drivetrain ILIKE '%awd%'$where$);
SELECT public.assert_read($filters${"for_sale": true}$filters$::jsonb,$where$f.is_for_sale=true$where$);
SELECT public.assert_read($filters${"sold_only": true}$filters$::jsonb,$where$f.is_sold=true$where$);
SELECT public.assert_read($filters${"hide_sold": true}$filters$::jsonb,$where$f.is_sold IS NULL OR f.is_sold=false$where$);
SELECT public.assert_read($filters${"sold_only": true, "hide_sold": true}$filters$::jsonb,$where$f.is_sold=true AND (f.is_sold IS NULL OR f.is_sold=false)$where$);
SELECT public.assert_read($filters${"has_images": true}$filters$::jsonb,$where$f.has_photos=true OR f.primary_image_url IS NOT NULL$where$);
SELECT public.assert_read($filters${"event_not_after": "2026-10-25T08:30:00Z", "created_not_before": "2026-10-25T08:10:00Z"}$filters$::jsonb,$where$f.event_at<='2026-10-25T08:30:00Z' AND f.created_at>='2026-10-25T08:10:00Z'$where$);
SELECT public.assert_read($filters${"included_sources": ["bat", "craigslist"], "excluded_sources": ["craigslist"]}$filters$::jsonb,$where$f.discovery_source IN ('bat','craigslist') AND f.discovery_source<>'craigslist'$where$);
SELECT public.assert_read($filters${"query_terms": ["GMC", "Truck"]}$filters$::jsonb,$where$(f.make ILIKE '%GMC%' OR f.model ILIKE '%GMC%' OR f.series ILIKE '%GMC%' OR f.vin ILIKE '%GMC%') AND (f.make ILIKE '%Truck%' OR f.model ILIKE '%Truck%' OR f.series ILIKE '%Truck%' OR f.vin ILIKE '%Truck%')$where$);
SELECT public.assert_read($filters${"query_terms": ["SYNTHETIC-VIN-21"]}$filters$::jsonb,$where$f.vin ILIKE '%SYNTHETIC-VIN-21%'$where$);
SELECT public.assert_read($filters${"query_terms": ["TrimOnlyMarker"]}$filters$::jsonb,$where$false$where$);
SELECT public.assert_read($filters${"query_terms": ["x') OR true --"]}$filters$::jsonb,$where$false$where$);
SELECT public.assert_read($filters${"vehicle_types": [], "query_terms": [], "price_min": null, "has_images": false}$filters$::jsonb,$where$true$where$);

DO $$ DECLARE item record; d text; BEGIN
 FOR item IN SELECT * FROM (VALUES ('newest','event_at'),('oldest','event_at'),('updated','updated_at'),('deal_score','deal_score'),('heat_score','heat_score'),('price_high','display_price'),('price_low','display_price'),('year','year'),('make','make'),('mileage','mileage'),('feed_rank','feed_rank_score')) x(k,c) LOOP
  FOREACH d IN ARRAY ARRAY['asc','desc'] LOOP PERFORM public.assert_read('{}','true',item.k,item.c,d); END LOOP;
 END LOOP;
END $$;
SELECT public.assert_true((SELECT count(*)=2 FROM public.feed_public_page_read(p_limit=>1)),'reader returns limit+1 for hasMore');
SELECT public.assert_rejected('[]');
SELECT public.assert_rejected('{"raw_sql":"true"}');
SELECT public.assert_rejected('{"makes":"Ford"}');
SELECT public.assert_rejected('{"makes":[null]}');
SELECT public.assert_rejected('{"price_min":"100"}');
SELECT public.assert_rejected('{"has_images":1}');
SELECT public.assert_rejected('{"year_min":1990.5}');
SELECT public.assert_rejected('{"event_not_after":"infinity"}');
SELECT public.assert_rejected('{"excluded_dealer_ids":["bad"]}');
SELECT public.assert_rejected(jsonb_build_object('makes',(SELECT jsonb_agg('A'::text) FROM generate_series(1,41))));
SELECT public.assert_rejected(jsonb_build_object('model_terms',(SELECT jsonb_agg('A'::text) FROM generate_series(1,51))));
SELECT public.assert_rejected(jsonb_build_object('query_terms',(SELECT jsonb_agg('A'::text) FROM generate_series(1,33))));
SELECT public.assert_rejected(jsonb_build_object('body_styles',jsonb_build_array(repeat('a',513))));
DO $$ BEGIN
 BEGIN PERFORM * FROM public.feed_public_page_read(p_sort=>'find_score'); RAISE EXCEPTION 'finds silently broadened'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM * FROM public.feed_public_page_read(p_sort=>'event_at; DROP TABLE vehicles'); RAISE EXCEPTION 'sort SQL accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM * FROM public.feed_public_page_read(p_direction=>'sideways'); RAISE EXCEPTION 'bad direction accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM * FROM public.feed_public_page_read(p_limit=>0); RAISE EXCEPTION 'zero limit accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM * FROM public.feed_public_page_read(p_limit=>201); RAISE EXCEPTION 'large limit accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM * FROM public.feed_public_page_read(p_cursor_value=>'1'); RAISE EXCEPTION 'incomplete cursor accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM * FROM public.feed_public_page_read(p_cursor_vehicle_id=>'00000000-0000-4000-8000-000000002001',p_cursor_is_null=>false); RAISE EXCEPTION 'missing cursor value accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM * FROM public.feed_public_page_read(p_filters=>'{"makes":["No match"]}',p_sort=>'price_low',p_cursor_value=>'bad',p_cursor_vehicle_id=>'00000000-0000-4000-8000-000000002001'); RAISE EXCEPTION 'bad numeric cursor accepted'; EXCEPTION WHEN invalid_text_representation THEN NULL; END;
END $$;

-- Consume the whole small cohort through each two-row page, with duplicate sort
-- values, NULLs and an empty text value. Compare order and detect repeated pages.
DO $$ DECLARE item record; d text; rows jsonb; row jsonb; ids uuid[]; expected uuid[]; value text; cursor_id uuid; cursor_null boolean; page integer;
BEGIN
 FOR item IN SELECT * FROM (VALUES ('newest','event_at'),('oldest','event_at'),('updated','updated_at'),('deal_score','deal_score'),('heat_score','heat_score'),('price_high','display_price'),('price_low','display_price'),('year','year'),('make','make'),('mileage','mileage'),('feed_rank','feed_rank_score')) x(k,c) LOOP
  FOREACH d IN ARRAY ARRAY['asc','desc'] LOOP
   ids:='{}';value:=NULL;cursor_id:=NULL;cursor_null:=false;
   FOR page IN 1..10 LOOP
    SELECT jsonb_agg(to_jsonb(r)-'ordinality' ORDER BY ordinality) INTO rows FROM public.feed_public_page_read('{"included_sources":["cursor_fixture"]}',item.k,d,value,cursor_id,cursor_null,2) WITH ORDINALITY r;
    IF rows IS NULL THEN EXIT; END IF;
    FOR row IN SELECT v FROM jsonb_array_elements(rows) WITH ORDINALITY e(v,n) WHERE n<=2 LOOP
      ids:=array_append(ids,(row->>'vehicle_id')::uuid);
      value:=row->>item.c;cursor_null:=row->item.c='null'::jsonb;cursor_id:=(row->>'vehicle_id')::uuid;
    END LOOP;
    IF jsonb_array_length(rows)<=2 THEN EXIT; END IF;
   END LOOP;
   EXECUTE format('SELECT array_agg(vehicle_id) FROM (SELECT vehicle_id FROM public.vehicle_valuation_feed WHERE discovery_source=''cursor_fixture'' ORDER BY %I %s,vehicle_id) q',item.c,d) INTO expected;
   PERFORM public.assert_true(ids=expected,'NULL/empty/tie pagination failed: '||item.k||' '||d);
  END LOOP;
 END LOOP;
END $$;
RESET ROLE;
UPDATE public.vehicles SET is_public=false WHERE id='00000000-0000-4000-8000-000000001001';
SET ROLE service_role;
SELECT public.assert_true(NOT EXISTS(SELECT 1 FROM public.feed_public_page_read(p_limit=>200) WHERE vehicle_id='00000000-0000-4000-8000-000000001001'),'current private flip applies without refresh');
RESET ROLE;
\ir ../migrations/20261025131942_public_feed_page_reader.sql
SELECT public.assert_true((SELECT c.relfilenode=b.relfilenode FROM pg_class c,before_storage b WHERE c.oid=b.oid),'idempotent reader deployment does not rebuild cache');
-- An unexpected grant must be refused rather than silently normalized by replay.
GRANT EXECUTE ON FUNCTION public.feed_public_page_read(jsonb,text,text,text,uuid,boolean,integer) TO anon;
\set ON_ERROR_STOP off
\ir ../migrations/20261025131942_public_feed_page_reader.sql
\set ON_ERROR_STOP on
SELECT public.assert_true(has_function_privilege('anon','public.feed_public_page_read(jsonb,text,text,text,uuid,boolean,integer)','EXECUTE'),'replay preflight refuses access drift before replacing anything');
REVOKE EXECUTE ON FUNCTION public.feed_public_page_read(jsonb,text,text,text,uuid,boolean,integer) FROM anon;


-- Finite actual-RPC smoke, not a production fleet latency claim.
INSERT INTO public.vehicles(id,year,make,model,status,is_public,listing_kind,created_at,updated_at,asking_price,has_photos,origin_organization_id)
SELECT ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,1990+i%30,
 CASE WHEN i%2=0 THEN 'Fixture' ELSE 'Other' END,'Car','active',i%19<>0,'vehicle',
 '2026-10-25T08:00:00Z'::timestamptz+i*interval '1 second','2026-10-25T08:00:00Z',10000+i,true,
 CASE WHEN i%7=0 THEN 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid ELSE 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid END
FROM generate_series(10000,60000) i;
REFRESH MATERIALIZED VIEW public.vehicle_valuation_feed;
ANALYZE public.vehicles;
ANALYZE public.vehicle_valuation_feed;
CREATE FUNCTION public.assert_rpc_budget(filters jsonb,sort_key text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE plan jsonb;
BEGIN
 EXECUTE 'EXPLAIN (ANALYZE, FORMAT JSON) SELECT * FROM public.feed_public_page_read($1,$2,p_limit=>50)' INTO plan USING filters,sort_key;
 PERFORM public.assert_true((plan->0->'Plan'->>'Actual Rows')::integer=51 AND (plan->0->>'Execution Time')::numeric<5000,'finite50k actual RPC exceeded budget or page size');
END $$;
SET ROLE service_role;
SET statement_timeout='5s';
SELECT public.assert_rpc_budget('{"vehicle_types":["CAR","TRUCK","SUV","VAN","MINIVAN"],"quality_min_price":500,"excluded_dealer_ids":["dddddddd-dddd-4ddd-8ddd-dddddddddddd"],"event_not_after":"2026-11-08T00:00:00Z"}','newest');
SELECT public.assert_rpc_budget('{"vehicle_types":["CAR","TRUCK","SUV","VAN","MINIVAN"],"quality_min_price":500,"query_terms":["Fixture"]}','newest');
SELECT public.assert_rpc_budget('{"vehicle_types":["CAR","TRUCK","SUV","VAN","MINIVAN"],"quality_min_price":500,"excluded_dealer_ids":["dddddddd-dddd-4ddd-8ddd-dddddddddddd"]}','feed_rank');
SELECT public.assert_rpc_budget('{"vehicle_types":["CAR","TRUCK","SUV","VAN","MINIVAN"],"quality_min_price":500,"makes":["Fixture"],"has_images":true}','newest');
SELECT public.assert_true((SELECT count(*)=201 FROM public.feed_public_page_read(p_limit=>200)),'maximum page returns200 plus one continuation sentinel');
RESET ROLE;
RESET statement_timeout;
SELECT 'public feed page reader contract: PASS';
