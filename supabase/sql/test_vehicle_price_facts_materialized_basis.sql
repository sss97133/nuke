-- Actual canonical price helper regression; synthetic rows only.
-- psql -X -v ON_ERROR_STOP=1 -d dm_refinement_price_facts_ci -f this file.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database()<>'dm_refinement_price_facts_ci'
    OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='auth') THEN
    RAISE EXCEPTION 'Refusing price helper fixtures outside the isolated database';
  END IF;
END $$;
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('CREATE ROLE %I',r); END IF;
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
SET timezone='UTC';
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, year integer, make text, model text, is_public boolean DEFAULT true, deleted_at timestamptz,
  listing_kind text, origin_metadata jsonb, body_style text, engine_type text, transmission text,
  condition_rating integer, primary_image_url text, sale_status text, auction_outcome text, reserve_status text,
  sale_price numeric, bat_sold_price numeric, sold_price numeric, winning_bid numeric, high_bid numeric,
  asking_price numeric, sale_date date, bat_sale_date date, listing_updated_at timestamptz,
  listing_posted_at timestamptz, nuke_estimate numeric, nuke_estimate_confidence integer,
  valuation_calculated_at timestamptz, canonical_outcome text, canonical_platform text,
  listing_url text, bat_auction_url text, platform_url text, discovery_url text, notes text,
  import_metadata jsonb, created_at timestamptz DEFAULT now(), auction_end_date text
);

-- Only a disposable stand-in is needed for the old sale-basis migration's
-- historical REFRESH. Its actual canonical function and comments run unchanged.
CREATE MATERIALIZED VIEW public.clean_vehicle_prices AS SELECT 1 AS fixture_only;
\ir ../migrations/20260927180000_sale_basis_conflicts_not_proven.sql
\ir ../migrations/20260928224500_vehicle_price_facts_live_outcome.sql
REVOKE ALL ON FUNCTION public.vehicle_price_facts(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_price_facts(uuid[]) TO anon,authenticated,service_role;
COMMENT ON FUNCTION public.vehicle_price_facts(uuid[]) IS 'Synthetic comment preserved through a query-only repair';
CREATE TEMP TABLE previous_price_reader_properties AS
SELECT proowner,proacl,proconfig,prosecdef,provolatile,proparallel,procost,prorows,proargnames,proallargtypes,
  obj_description(oid,'pg_proc') AS description FROM pg_proc
WHERE oid='public.vehicle_price_facts(uuid[])'::regprocedure;
CREATE FUNCTION pg_temp.ok(label text,condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Price helper contract failed: %',label; END IF;
  RAISE NOTICE 'PASS %',label;
END $$;

INSERT INTO public.vehicles(id,year,make,model,is_public,sale_status,auction_outcome,canonical_platform,listing_url,discovery_url,
 sale_price,winning_bid,bat_sold_price,sold_price,high_bid,asking_price,sale_date,bat_sale_date,auction_end_date,notes,import_metadata,
 created_at,reserve_status,listing_updated_at,listing_posted_at,nuke_estimate,nuke_estimate_confidence,valuation_calculated_at)
SELECT md5('price-fact-'||n)::uuid,1960+n%50,'Synthetic','Scope',true,
 (ARRAY['sold','available','ended','not_sold','auction_live','for_sale','upcoming','unsold','bid_to'])[n%9+1],
 (ARRAY['sold',NULL,'reserve_not_met','no_sale',NULL])[n%5+1],
 (ARRAY['bat','mecum','cars-and-bids','barrett-jackson','gooding','conceptcarz',NULL])[n%7+1],
 (ARRAY['https://bringatrailer.com/listing/fact-','https://mecum.com/lot/fact-','https://carsandbids.com/auctions/fact-',
 'https://barrett-jackson.com/lot/fact-','https://goodingco.com/fact-','conceptcarz://fact-','https://example.com/fact-'])[n%7+1]||n,
 NULL,
 CASE WHEN n%8=0 THEN NULL WHEN n%8=1 THEN 0 ELSE n*100 END,
 CASE WHEN n%4=0 THEN n*80 END,CASE WHEN n%4=1 THEN n*70 END,CASE WHEN n%4=2 THEN n*60 END,
 CASE WHEN n%3=0 THEN n*20 END,CASE WHEN n%3=1 THEN n*90 END,
 CASE WHEN n%6=0 THEN NULL ELSE '2025-01-01'::date+n%200 END,
 CASE WHEN n%6=0 THEN '2024-01-01'::date+n%200 END,
 CASE WHEN n%11=0 THEN NULL ELSE '2025-02-01T10:00:00Z' END,
 CASE WHEN n%3=0 THEN 'Result: sold' WHEN n%3=1 THEN 'Result: bid-goes-on' ELSE '{"status": "sold"}' END||repeat(md5(n::text),30),
 jsonb_build_object('auction_status',CASE WHEN n%2=0 THEN 'sold' ELSE 'reserve_not_met' END,'noise',repeat(md5(n::text),200)),
 CASE WHEN n%2=0 THEN '2026-01-01'::timestamptz ELSE '2026-09-29'::timestamptz END,
 CASE WHEN n%10=0 THEN 'reserve_not_met' END,'2025-02-01','2025-01-01',n*45,n%100,'2025-02-02'
FROM generate_series(1,5440) n;
ANALYZE public.vehicles;
UPDATE public.vehicles SET is_public=false WHERE id=ANY(ARRAY(SELECT md5('price-fact-'||n)::uuid FROM generate_series(1,10) n));
UPDATE public.vehicles SET deleted_at='2026-10-01' WHERE id=ANY(ARRAY(SELECT md5('price-fact-'||n)::uuid FROM generate_series(11,20) n));
INSERT INTO public.vehicles(id,make,model,is_public,sale_status,canonical_platform,listing_url,auction_end_date,high_bid)
VALUES (md5('unused-bad-date')::uuid,'Synthetic','Scope',true,'available','bat','https://bringatrailer.com/listing/unused-bad-date/','2025-13-32',NULL),
  (md5('required-bad-date')::uuid,'Synthetic','Scope',true,'available','bat','https://bringatrailer.com/listing/required-bad-date/','2025-13-32',1000);
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY price_fixture_public_only ON public.vehicles FOR SELECT TO anon,authenticated USING(is_public IS TRUE);
GRANT SELECT ON public.vehicles TO anon,authenticated;
CREATE TEMP TABLE test_inputs(label text PRIMARY KEY,ids uuid[],owner_count integer,visitor_count integer);
INSERT INTO test_inputs VALUES
  ('all_columns_mixed_legacy_and_current',ARRAY(SELECT md5('price-fact-'||n)::uuid FROM generate_series(1,5440) n),5430,5420),
  ('null_ids',NULL,0,0),('empty_ids','{}'::uuid[],0,0),
  ('duplicate_and_missing_ids',ARRAY[md5('price-fact-1')::uuid,md5('price-fact-1')::uuid,
    md5('price-fact-21')::uuid,md5('price-fact-21')::uuid,md5('missing')::uuid],2,1),
  ('deleted_parent',ARRAY[md5('price-fact-11')::uuid],0,0),
  ('unused_malformed_date',ARRAY[md5('unused-bad-date')::uuid],1,1);
CREATE TEMP TABLE baseline_price_rows(execution_role text,label text,fact jsonb);
GRANT SELECT ON test_inputs TO anon,authenticated;
GRANT SELECT,INSERT ON baseline_price_rows TO anon,authenticated;
INSERT INTO baseline_price_rows
SELECT 'owner',i.label,to_jsonb(f) FROM test_inputs i CROSS JOIN LATERAL public.vehicle_price_facts(i.ids) f;
SET ROLE anon;
INSERT INTO baseline_price_rows
SELECT 'anon',i.label,to_jsonb(f) FROM test_inputs i CROSS JOIN LATERAL public.vehicle_price_facts(i.ids) f;
RESET ROLE;
SET ROLE authenticated;
INSERT INTO baseline_price_rows
SELECT 'authenticated',i.label,to_jsonb(f) FROM test_inputs i CROSS JOIN LATERAL public.vehicle_price_facts(i.ids) f;
RESET ROLE;

DO $$ BEGIN
  BEGIN
    PERFORM * FROM public.vehicle_price_facts(ARRAY[md5('required-bad-date')::uuid]);
    RAISE EXCEPTION 'Original helper unexpectedly accepted a required invalid date';
  EXCEPTION WHEN datetime_field_overflow THEN
    PERFORM pg_temp.ok('original required malformed date raises',true);
  END;
END $$;

\ir ../migrations/20261004212806_vehicle_price_facts_materialized_basis.sql
SELECT pg_temp.ok('owner ACL security config signature cost and comment retained',NOT EXISTS(
  (SELECT * FROM previous_price_reader_properties EXCEPT
    SELECT proowner,proacl,proconfig,prosecdef,provolatile,proparallel,procost,prorows,proargnames,proallargtypes,
      obj_description(oid,'pg_proc') FROM pg_proc WHERE oid='public.vehicle_price_facts(uuid[])'::regprocedure)));
-- CI can retry after its schema step succeeds and a later edge deployment fails.
\ir ../migrations/20261004212806_vehicle_price_facts_materialized_basis.sql
SELECT pg_temp.ok('twice-apply retains original owner ACL security config signature and comment',NOT EXISTS(
  (SELECT * FROM previous_price_reader_properties EXCEPT
    SELECT proowner,proacl,proconfig,prosecdef,provolatile,proparallel,procost,prorows,proargnames,proallargtypes,
      obj_description(oid,'pg_proc') FROM pg_proc WHERE oid='public.vehicle_price_facts(uuid[])'::regprocedure)));

CREATE FUNCTION pg_temp.compare_inputs(p_role text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE i record; expected integer; differing integer; actual integer;
BEGIN
  FOR i IN SELECT * FROM test_inputs ORDER BY label LOOP
    expected:=CASE WHEN p_role='owner' THEN i.owner_count ELSE i.visitor_count END;
    SELECT count(*) INTO actual FROM public.vehicle_price_facts(i.ids);
    SELECT count(*) INTO differing FROM (
      (SELECT fact FROM baseline_price_rows WHERE execution_role=p_role AND label=i.label
        EXCEPT ALL SELECT to_jsonb(f) FROM public.vehicle_price_facts(i.ids) f)
      UNION ALL
      (SELECT to_jsonb(f) FROM public.vehicle_price_facts(i.ids) f
        EXCEPT ALL SELECT fact FROM baseline_price_rows WHERE execution_role=p_role AND label=i.label)
    ) differences;
    PERFORM pg_temp.ok(p_role||' '||i.label||' full twenty-column multiset equivalence',
      actual=expected AND differing=0);
  END LOOP;
END $$;
SELECT pg_temp.compare_inputs('owner');
SET ROLE anon;
SELECT pg_temp.compare_inputs('anon');
RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.compare_inputs('authenticated');
RESET ROLE;
DO $$ BEGIN
  BEGIN
    PERFORM * FROM public.vehicle_price_facts(ARRAY[md5('required-bad-date')::uuid]);
    RAISE EXCEPTION 'Optimized helper unexpectedly accepted a required invalid date';
  EXCEPTION WHEN datetime_field_overflow THEN
    PERFORM pg_temp.ok('optimized required malformed date preserves original exception',true);
  END;
END $$;
SELECT pg_temp.ok('one existing production signature only',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='vehicle_price_facts')=1);
