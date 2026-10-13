-- Synthetic disposable PostgreSQL only. Executes the cached live baseline and
-- actual migration; never assumes these fixture results describe fleet coverage.
\set ON_ERROR_STOP on
\set QUIET on
DO $$ BEGIN
  IF current_database() <> 'dm_refinement_search_pagination'
     OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable dm_refinement_search_pagination database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '1s';
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, year integer, make text, model text, vin text, status text,
  sale_price integer, current_value numeric, is_public boolean DEFAULT true,
  deleted_at timestamptz, listing_kind text,
  canonical_vehicle_type text DEFAULT 'AUTO', primary_image_url text,
  image_count integer, bat_view_count integer, view_count integer
);
-- A stand-in for the unchanged production classifier. Its production taxonomy
-- is outside this pagination fixture; false and unknown decisions must survive.
CREATE FUNCTION public.is_auto_vehicle(kind text, make text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT kind = 'AUTO' $$;
\ir helpers/search_vehicles_fts_live_20261013.sql
REVOKE ALL ON FUNCTION public.search_vehicles_fts(text,integer,boolean,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_vehicles_fts(text,integer,boolean,integer) TO anon, authenticated;
CREATE TEMP TABLE before_attributes AS SELECT to_jsonb(p) - 'prosrc' AS attributes
  FROM pg_proc p WHERE oid = 'public.search_vehicles_fts(text,integer,boolean,integer)'::regprocedure;
DO $$ BEGIN
  EXECUTE replace(pg_get_functiondef('public.search_vehicles_fts(text,integer,boolean,integer)'::regprocedure),
    'public.search_vehicles_fts(', 'public.search_vehicles_fts_baseline(');
END $$;
CREATE FUNCTION pg_temp.uid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
INSERT INTO public.vehicles(id,year,make,model,primary_image_url,image_count,bat_view_count,view_count,sale_price)
SELECT pg_temp.uid(n), 2000, 'Porsche', 'GT3', 'image', 1, NULL, 2, 2 FROM generate_series(1,9) n;
UPDATE public.vehicles SET primary_image_url=NULL,image_count=999,view_count=999,sale_price=999 WHERE id=pg_temp.uid(1);
UPDATE public.vehicles SET image_count=0,view_count=0,sale_price=1 WHERE id=pg_temp.uid(2);
UPDATE public.vehicles SET view_count=0,sale_price=1 WHERE id=pg_temp.uid(3);
UPDATE public.vehicles SET bat_view_count=1,view_count=999,sale_price=1 WHERE id=pg_temp.uid(4);
UPDATE public.vehicles SET sale_price=1 WHERE id=pg_temp.uid(5);
UPDATE public.vehicles SET year=2001 WHERE id IN(pg_temp.uid(7),pg_temp.uid(8));
UPDATE public.vehicles SET sale_price=NULL WHERE id=pg_temp.uid(9);
INSERT INTO public.vehicles(id,year,make,model,primary_image_url,image_count,view_count,sale_price)
SELECT pg_temp.uid(n), 2020, 'Other', 'Porsche', 'image', 999, 999, 999 FROM generate_series(20,26) n;
INSERT INTO public.vehicles(id,year,make,model)
SELECT pg_temp.uid(n), CASE WHEN n<=35 OR n=39 THEN 1967 ELSE 1968 END,
  'Ford', CASE WHEN n=39 THEN 'Mustang' ELSE '1967 Mustang' END FROM generate_series(30,39) n;
INSERT INTO public.vehicles(id,year,make,model,is_public,canonical_vehicle_type) VALUES
  (pg_temp.uid(90),2000,'Porsche','GT3',false,'AUTO'),
  (pg_temp.uid(91),NULL,'Porsche','GT3',true,'AUTO'),
  (pg_temp.uid(92),2000,NULL,'Porsche',true,'AUTO'),
  (pg_temp.uid(93),2000,'Porsche',NULL,true,'AUTO'),
  (pg_temp.uid(94),2000,'Porsche','GT3',true,'BOAT'),
  (pg_temp.uid(95),2000,'Porsche','GT3',true,NULL),
  (pg_temp.uid(96),1967,'Ford','1967 Mustang',false,'AUTO');

SELECT pg_temp.ok('baseline reproduces exact/fallback over-return',
  (SELECT count(*)=6 FROM public.search_vehicles_fts('porsche',5,true,5)));
SELECT pg_temp.ok('baseline loses the fallback tail after exact branch exhaustion',
  (SELECT count(*)=0 FROM public.search_vehicles_fts('porsche',5,true,10)));
SELECT pg_temp.ok('baseline repeats the year/fallback overlap',
  (SELECT count(*)>count(DISTINCT id) FROM public.search_vehicles_fts('1967 Mustang',20,true,0)));
CREATE TEMP TABLE baseline_primary AS SELECT * FROM public.search_vehicles_fts('porsche',5,true,0);
CREATE TEMP TABLE baseline_multi AS SELECT * FROM public.search_vehicles_fts('Porsche & GT3',5,true,0);

\ir ../migrations/20261013090000_search_vehicles_fts_single_offset.sql
\ir ../migrations/20261013090000_search_vehicles_fts_single_offset.sql
SELECT pg_temp.ok('owner, grants, security, settings, signature and all other catalog attributes unchanged',
  (SELECT to_jsonb(p)-'prosrc'=b.attributes FROM pg_proc p CROSS JOIN before_attributes b
    WHERE p.oid='public.search_vehicles_fts(text,integer,boolean,integer)'::regprocedure));
SELECT pg_temp.ok('full primary page is identical to deployed reader',
  (SELECT jsonb_agg(t) FROM public.search_vehicles_fts('porsche',5,true,0)t)=(SELECT jsonb_agg(t) FROM baseline_primary t));
SELECT pg_temp.ok('ordinary multi-token page is identical to deployed reader',
  (SELECT jsonb_agg(t) FROM public.search_vehicles_fts('Porsche & GT3',5,true,0)t)=(SELECT jsonb_agg(t) FROM baseline_multi t));

-- Each public branch must withhold deleted records and non-vehicle items,
-- including those with otherwise convincing titles and a high ranking.
INSERT INTO public.vehicles(id,year,make,model,deleted_at,listing_kind,image_count) VALUES
  (pg_temp.uid(97),2000,'Porsche','GT3','2026-10-01Z',NULL,10000),
  (pg_temp.uid(98),2000,'Porsche','GT3',NULL,'non_vehicle_item',10000),
  (pg_temp.uid(99),1967,'Ford','1967 Mustang','2026-10-01Z',NULL,10000),
  (pg_temp.uid(100),1968,'Ford','1967 Mustang',NULL,'non_vehicle_item',10000),
  (pg_temp.uid(101),2000,'Other','Porsche',NULL,'non_vehicle_item',10000),
  (pg_temp.uid(102),2000,'Other','Porsche','2026-10-01Z',NULL,10000);
SELECT pg_temp.ok('baseline confirms deleted/non-vehicle candidates were exposed',
  (SELECT count(*)=4 FROM public.search_vehicles_fts_baseline('porsche',100,true,0) WHERE id BETWEEN pg_temp.uid(97) AND pg_temp.uid(102)));

CREATE FUNCTION pg_temp.assert_pages(q text, expected uuid[], expected_relevance real[]) RETURNS void LANGUAGE plpgsql AS $$
DECLARE cap integer; off integer; actual uuid[]; scores real[];
BEGIN
  FOREACH cap IN ARRAY ARRAY[1,2,5,20] LOOP
    FOR off IN 0..cardinality(expected)+2 LOOP
      SELECT COALESCE(array_agg(s.id ORDER BY ordinality),'{}'::uuid[]),
             COALESCE(array_agg(s.relevance ORDER BY ordinality),'{}'::real[])
        INTO actual,scores FROM public.search_vehicles_fts(q,cap,true,off) WITH ORDINALITY s;
      IF actual IS DISTINCT FROM expected[off+1:off+cap] OR scores IS DISTINCT FROM expected_relevance[off+1:off+cap] THEN
        RAISE EXCEPTION 'Page mismatch query=% limit=% offset=% got=% expected=%',q,cap,off,actual,expected[off+1:off+cap];
      END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'PASS all boundary pages and relevance values for %',q;
END $$;
SELECT pg_temp.assert_pages('porsche',
  ARRAY(SELECT pg_temp.uid(n) FROM unnest(ARRAY[7,8,6,5,9,4,3,2,1,20,21,22,23,24,25,26])n),
  array_fill(0.95::real,ARRAY[9]) || array_fill(0.9::real,ARRAY[7]));
SELECT pg_temp.assert_pages('1967 Mustang',
  ARRAY(SELECT pg_temp.uid(n) FROM unnest(ARRAY[30,31,32,33,34,35,39,36,37,38])n),
  array_fill(0.98::real,ARRAY[7]) || array_fill(0.9::real,ARRAY[3]));
SELECT pg_temp.assert_pages('Porsche & GT3',
  ARRAY(SELECT pg_temp.uid(n) FROM unnest(ARRAY[7,8,6,5,9,4,3,2,1])n), array_fill(0.9::real,ARRAY[9]));
SELECT pg_temp.assert_pages('no-match','{}'::uuid[],'{}'::real[]);
SELECT pg_temp.ok('NULL limit retains all eligible rows and NULL offset means zero',
  (SELECT count(*)=16 AND count(DISTINCT id)=16 FROM public.search_vehicles_fts('porsche',NULL,true,NULL)));
SELECT pg_temp.ok('zero limit and empty/NULL queries return nothing',
  NOT EXISTS(SELECT FROM public.search_vehicles_fts('porsche',0,true,0))
  AND NOT EXISTS(SELECT FROM public.search_vehicles_fts('',5,true,0))
  AND NOT EXISTS(SELECT FROM public.search_vehicles_fts(NULL,5,true,0)));
SELECT pg_temp.ok('explicit non-auto mode retains existing selection semantics',
  (SELECT count(*)=18 FROM public.search_vehicles_fts('porsche',100,false,0))
  AND (SELECT count(*)=16 FROM public.search_vehicles_fts('porsche',100,NULL,0)));
DO $$ BEGIN
  BEGIN PERFORM public.search_vehicles_fts('porsche',-1,true,0); RAISE EXCEPTION 'negative limit accepted';
    EXCEPTION WHEN invalid_row_count_in_limit_clause THEN NULL; END;
  BEGIN PERFORM public.search_vehicles_fts('porsche',1,true,-1); RAISE EXCEPTION 'negative offset accepted';
    EXCEPTION WHEN invalid_row_count_in_result_offset_clause THEN NULL; END;
  RAISE NOTICE 'PASS invalid pagination refuses with PostgreSQL limit/offset errors';
END $$;

SET ROLE anon;
SELECT pg_temp.ok('anonymous definer call excludes private/deleted/non-vehicle/incomplete/non-auto fixtures',
  (SELECT count(*)=16 AND bool_and(id NOT BETWEEN pg_temp.uid(90) AND pg_temp.uid(102))
    FROM public.search_vehicles_fts('porsche',100,true,0)));
RESET ROLE;

-- Larger deterministic stream: 6,000 exact then 6,001 fallback rows. Ranking
-- ties exercise every branch boundary and offset-ceiling-sized requests.
INSERT INTO public.vehicles(id,year,make,model,primary_image_url,image_count,view_count,sale_price)
SELECT pg_temp.uid(100000+n),2000+n%20,CASE WHEN n<=6000 THEN 'Boundary' ELSE 'Other' END,
  'Boundary Needle',CASE WHEN n%3=0 THEN NULL ELSE 'image' END,n%5,n%7,n%11
FROM generate_series(1,12001)n;
-- Model the existing make access path, not the optional proposed rank index.
CREATE INDEX fixture_make_idx ON public.vehicles(make);
ANALYZE public.vehicles;
DO $$ DECLARE expected uuid[]; actual uuid[]:='{}'; page_ids uuid[]; cursor integer:=0; cap integer:=94; started timestamptz;
BEGIN
  SELECT array_agg(v.id ORDER BY (v.make='Boundary') DESC,(v.primary_image_url IS NOT NULL) DESC,
    COALESCE(v.image_count,0) DESC,COALESCE(v.bat_view_count,v.view_count,0) DESC,
    v.sale_price DESC NULLS LAST,v.year DESC,v.id) INTO expected
  FROM public.vehicles v WHERE v.model='Boundary Needle';
  started:=clock_timestamp();
  LOOP
    SELECT array_agg(s.id ORDER BY ordinality) INTO page_ids
    FROM public.search_vehicles_fts('boundary',cap+1,true,cursor) WITH ORDINALITY s;
    EXIT WHEN page_ids IS NULL;
    actual:=actual || page_ids[1:cap];
    EXIT WHEN cardinality(page_ids)<=cap;
    cursor:=cursor+cap; cap:=100;
  END LOOP;
  PERFORM pg_temp.ok('12,001-candidate stream, 94 then 100 slots, lookahead, ties and all branch boundaries',actual=expected);
  RAISE NOTICE 'Synthetic complete pagination duration_ms=%',round(1000*extract(epoch FROM clock_timestamp()-started),3);
  PERFORM pg_temp.ok('offset 10,000 retains the exact oracle slice',
    (SELECT array_agg(s.id ORDER BY ordinality) FROM public.search_vehicles_fts('boundary',101,true,10000) WITH ORDINALITY s)=expected[10001:10101]);
END $$;

-- These outer plans measure local execution, not the production scan estimate.
-- Installed auto_explain records the nested plans in this disposable server's
-- log; the runner verifies that full exact-make pages never execute fallback.
LOAD 'auto_explain';
SET auto_explain.log_min_duration = 0;
SET auto_explain.log_nested_statements = on;
SET auto_explain.log_analyze = on;
SET auto_explain.log_timing = off;
SET auto_explain.log_buffers = on;
SET auto_explain.log_format = json;
EXPLAIN (ANALYZE,BUFFERS,TIMING OFF) SELECT * FROM public.search_vehicles_fts_baseline('boundary',95,true,0);
EXPLAIN (ANALYZE,BUFFERS,TIMING OFF) SELECT * FROM public.search_vehicles_fts('boundary',95,true,0);
EXPLAIN (ANALYZE,BUFFERS,TIMING OFF) SELECT * FROM public.search_vehicles_fts('boundary',101,true,5999);
SET auto_explain.log_min_duration = -1;
SELECT pg_temp.ok('fixture leaves no waiting locks',NOT EXISTS(SELECT FROM pg_stat_activity WHERE wait_event_type='Lock'));
