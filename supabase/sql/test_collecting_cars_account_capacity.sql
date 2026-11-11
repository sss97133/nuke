\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_collecting_cars_account_capacity%' OR to_regclass('public.firecrawl_params') IS NOT NULL THEN
  RAISE EXCEPTION 'Requires empty disposable collecting cars account capacity database';
 END IF;
END $$;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE TABLE public.firecrawl_params(key text PRIMARY KEY,value numeric,text_value text,note text NOT NULL,set_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.firecrawl_source_params(source text PRIMARY KEY,paused jsonb,hosts text[] NOT NULL DEFAULT '{}');
CREATE TABLE public.firecrawl_target_allocation(source text,vehicle_group text,monthly_credits numeric,computed_at timestamptz);
CREATE TABLE public.firecrawl_spend_log(source text,credits numeric,spent_at timestamptz DEFAULT now(),historical boolean DEFAULT false);
CREATE FUNCTION pg_temp.ok(label text,condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %',label; END IF; RAISE NOTICE 'PASS %',label;
END $$;
-- Exact tracked functions, isolated from the original migrations' unrelated allocator/schema changes.
CREATE OR REPLACE FUNCTION public.firecrawl_param(p_key text, p_default numeric DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $$
  SELECT coalesce((SELECT value FROM public.firecrawl_params WHERE key = p_key), p_default)
$$;
CREATE OR REPLACE FUNCTION public.firecrawl_allowance(p_source text)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_day int := firecrawl_param('period_start_day', 4)::int;
  v_start date;
  v_end date;
  v_alloc numeric;
  v_spent_before numeric;
  v_spent_today numeric;
  v_days_left int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.firecrawl_source_params WHERE source = p_source AND paused IS NOT NULL) THEN RETURN 0; END IF;
  v_start := CASE WHEN extract(day FROM current_date) >= v_day
                  THEN make_date(extract(year FROM current_date)::int, extract(month FROM current_date)::int, v_day)
                  ELSE (make_date(extract(year FROM current_date)::int, extract(month FROM current_date)::int, v_day) - interval '1 month')::date END;
  v_end := (v_start + interval '1 month')::date;
  SELECT a.monthly_credits INTO v_alloc
    FROM public.firecrawl_target_allocation a
   WHERE a.source = p_source AND a.vehicle_group = '*'
     AND a.computed_at = (SELECT max(computed_at) FROM public.firecrawl_target_allocation)
   LIMIT 1;
  IF v_alloc IS NULL OR v_alloc <= 0 THEN RETURN 0; END IF;
  SELECT coalesce(sum(credits) FILTER (WHERE spent_at < current_date), 0), coalesce(sum(credits) FILTER (WHERE spent_at >= current_date), 0)
    INTO v_spent_before, v_spent_today FROM public.firecrawl_spend_log WHERE source = p_source AND spent_at >= v_start AND NOT historical;
  v_days_left := greatest(1, v_end - current_date);
  RETURN greatest(0, least(v_alloc - v_spent_before - v_spent_today, ceil((v_alloc - v_spent_before) / v_days_left) - v_spent_today));
END $$;
CREATE OR REPLACE FUNCTION public.firecrawl_source_for_url(p_url text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  WITH h AS (SELECT regexp_replace(lower(substring(p_url FROM '^[a-z]+://([^/:?#]+)')), '^www\.', '') host)
  SELECT s.source FROM public.firecrawl_source_params s, h
   WHERE h.host IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(s.hosts) d WHERE h.host = d OR h.host LIKE '%.' || d)
   ORDER BY length((SELECT max(d) FROM unnest(s.hosts) d WHERE h.host = d OR h.host LIKE '%.' || d)) DESC NULLS LAST
   LIMIT 1
$$;
CREATE OR REPLACE FUNCTION public.firecrawl_allowance_for_url(p_url text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  SELECT coalesce((SELECT public.firecrawl_allowance(public.firecrawl_source_for_url(p_url))
                    WHERE public.firecrawl_source_for_url(p_url) IS NOT NULL), 0)
$$;

REVOKE ALL ON FUNCTION public.firecrawl_allowance(text),public.firecrawl_allowance_for_url(text),public.firecrawl_source_for_url(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.firecrawl_allowance(text),public.firecrawl_allowance_for_url(text),public.firecrawl_source_for_url(text) TO service_role;
INSERT INTO firecrawl_params(key,value,note) VALUES('period_start_day',4,'fixture'),('monthly_credits',1000,'fixture');
INSERT INTO firecrawl_source_params(source,hosts) VALUES('collecting-cars','{collectingcars.com}'),('mecum','{mecum.com}'),('cars_and_bids','{carsandbids.com}');
UPDATE firecrawl_source_params SET paused='{"reason":"owner hold"}' WHERE source='cars_and_bids';
INSERT INTO firecrawl_target_allocation SELECT source,'*',CASE source WHEN 'collecting-cars' THEN 50 ELSE 1000 END,now()-interval '1 hour' FROM firecrawl_source_params;
INSERT INTO firecrawl_spend_log(source,credits) VALUES('collecting-cars',50),('mecum',1);
CREATE TEMP TABLE baseline AS SELECT source,firecrawl_allowance(source) allowance FROM firecrawl_source_params;
CREATE TEMP TABLE before_acl AS SELECT oid,proacl,prosecdef,proconfig FROM pg_proc WHERE oid='public.firecrawl_allowance(text)'::regprocedure;
SELECT pg_temp.ok('baseline CC exhausted',(SELECT allowance=0 FROM baseline WHERE source='collecting-cars'));
SELECT pg_temp.ok('baseline other source has allowance',(SELECT allowance>0 FROM baseline WHERE source='mecum'));
\ir ../migrations/20261110031150_collecting_cars_account_capacity.sql
SELECT pg_temp.ok('CC can request one scrape despite internal quota exhaustion',firecrawl_allowance('collecting-cars')=1);
SELECT pg_temp.ok('other sources unchanged',(SELECT bool_and(firecrawl_allowance(source)=allowance) FROM baseline WHERE source<>'collecting-cars'));
SELECT pg_temp.ok('source URL wrapper allows CC',firecrawl_allowance_for_url('https://collectingcars.com/for-sale/2020-porsche-911')=1);
SELECT pg_temp.ok('unmapped URL remains refused',firecrawl_allowance_for_url('https://unmapped.invalid/lot')=0);
SELECT pg_temp.ok('lookalike URL remains refused',firecrawl_allowance_for_url('https://collectingcars.com.evil.invalid/lot')=0);
SELECT pg_temp.ok('unknown source remains refused',firecrawl_allowance('unknown-source')=0);
SELECT pg_temp.ok('existing function identity and ACL preserved',(SELECT p.proacl IS NOT DISTINCT FROM b.proacl AND p.prosecdef=b.prosecdef AND p.proconfig=b.proconfig FROM pg_proc p JOIN before_acl b USING(oid)));
SELECT pg_temp.ok('anon and authenticated cannot call allowance',NOT has_function_privilege('anon','public.firecrawl_allowance(text)','EXECUTE') AND NOT has_function_privilege('authenticated','public.firecrawl_allowance(text)','EXECUTE'));
SELECT pg_temp.ok('service role still can call allowance',has_function_privilege('service_role','public.firecrawl_allowance(text)','EXECUTE'));
SET ROLE service_role;
SELECT public.firecrawl_allowance('collecting-cars');
RESET ROLE;
UPDATE firecrawl_source_params SET paused='{"reason":"explicit owner pause"}' WHERE source='collecting-cars';
SELECT pg_temp.ok('source pause precedes account capacity flag',firecrawl_allowance('collecting-cars')=0 AND firecrawl_allowance_for_url('https://collectingcars.com/for-sale/lot')=0);
UPDATE firecrawl_source_params SET paused=NULL WHERE source='collecting-cars';
UPDATE firecrawl_params SET value=0 WHERE key='account_capacity_collecting-cars';
SELECT pg_temp.ok('flag off restores exhausted original quota',firecrawl_allowance('collecting-cars')=0);
UPDATE firecrawl_params SET value=2 WHERE key='account_capacity_collecting-cars';
SELECT pg_temp.ok('non-one flag cannot authorize account capacity',firecrawl_allowance('collecting-cars')=0);
UPDATE firecrawl_params SET value=1 WHERE key='account_capacity_collecting-cars';
INSERT INTO firecrawl_target_allocation SELECT source,'*',0,now() FROM firecrawl_source_params;
SELECT pg_temp.ok('new allocator zero row cannot erase explicit CC authorization',firecrawl_allowance('collecting-cars')=1);
SELECT pg_temp.ok('other source remains subject to newer allocator zero',firecrawl_allowance('mecum')=0);
SELECT pg_temp.ok('capacity authorization does not alter spend records',(SELECT count(*)=2 AND sum(credits)=51 FROM firecrawl_spend_log));
SELECT pg_temp.ok('global budget remains unchanged',firecrawl_param('monthly_credits')=1000);
