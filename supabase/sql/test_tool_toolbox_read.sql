-- Disposable PG17 only. Synthetic fixtures; exercises the actual migration.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR to_regclass('public.user_tools') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable database required';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.profiles(id uuid PRIMARY KEY, tool_inventory_public boolean DEFAULT false);
CREATE TABLE public.tool_brands(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
CREATE TABLE public.tool_catalog(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), brand_id uuid REFERENCES public.tool_brands(id), part_number text, name text, msrp numeric);
CREATE TABLE public.tool_catalog_images(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), catalog_id uuid, image_url text, image_type text, sort_order int,
  created_at timestamptz DEFAULT now());
CREATE TABLE public.user_tools(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, part_number text, description text, brand text, category text,
  total_quantity integer, first_purchase_date date, last_purchase_date date, total_spent numeric, receipt_ids uuid[]);
INSERT INTO profiles VALUES ('10000000-0000-0000-0000-00000000000a', false), ('10000000-0000-0000-0000-00000000000b', false);
INSERT INTO tool_brands(id,name) VALUES ('20000000-0000-0000-0000-000000000001','Snap-on'),('20000000-0000-0000-0000-000000000002','OtherCo');
INSERT INTO tool_catalog(id,brand_id,part_number,name) VALUES
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','FXM10','10MM WRENCH 1 RA Sale 40.00'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','IMFM7','3/8DR 7MM SOCKET 1 RA Sale 17.60'),
 ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002','ZZ1','Other brand tool');
INSERT INTO tool_catalog_images(catalog_id,image_url,image_type,sort_order) VALUES
 ('30000000-0000-0000-0000-000000000001','https://img.example/FXM10-alt.jpg','alternate',1),
 ('30000000-0000-0000-0000-000000000001','https://img.example/FXM10.jpg','primary',2);
INSERT INTO user_tools(user_id,part_number,description,brand,category,total_quantity,first_purchase_date,last_purchase_date,total_spent,receipt_ids) VALUES
 ('10000000-0000-0000-0000-00000000000a','FXM-10','10MM WRENCH 1 RA Sale 40.00','Snap-on','Wrenches',2,'2024-01-01','2025-01-01',80.00,ARRAY[gen_random_uuid()]),
 ('10000000-0000-0000-0000-00000000000a','IMFM7','3/8DR 7MM SOCKET','snap-on ','Sockets',1,'2024-02-01','2024-02-01',17.60,ARRAY[gen_random_uuid()]),
 ('10000000-0000-0000-0000-00000000000a','ZZ1','tool of another brand','Snap-on','Other',1,NULL,NULL,5,NULL),
 ('10000000-0000-0000-0000-00000000000a','RECEIPT','Sold To: Fixture Person 555-0100 Main St','Unknown','Professional Tools',1,NULL,NULL,0,NULL);

\ir ../migrations/20261020103000_tool_toolbox_read.sql

CREATE FUNCTION public.t_assert(v boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
CREATE FUNCTION public.t_refused(q text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
CREATE FUNCTION public.t_fails(q text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean,text), public.t_refused(text), public.t_fails(text) TO authenticated, anon, service_role;

SET ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
SELECT record_tool_catalog_page_capture('30000000-0000-0000-0000-000000000001','https://maker.example/product/FXM10','10 mm 12-Point Flank Drive Wrench',
  'FXM10',45.50,'USD','page_extract_v1','2026-10-19T21:00:00Z') AS c1 \gset
SELECT record_tool_catalog_page_capture('30000000-0000-0000-0000-000000000001','https://maker.example/product/FXM10','10 mm 12-Point Flank Drive Wrench',
  'FXM10',45.50,'USD','page_extract_v1','2026-10-19T21:05:00Z') AS c1dup \gset
SELECT t_assert(NOT ((:'c1'::jsonb)->>'duplicate')::boolean AND ((:'c1dup'::jsonb)->>'duplicate')::boolean,'identical capture of the same page is a duplicate');
SELECT t_assert(t_fails($q$SELECT record_tool_catalog_page_capture('30000000-0000-0000-0000-000000000001','https://maker.example/p','X wrench','FXM10',45.5,NULL,'m1x','2026-10-19')$q$),
  'a price without a currency is refused');
RESET ROLE;
SELECT t_assert(t_fails('UPDATE tool_catalog_page_captures SET list_price = 1') AND t_fails('DELETE FROM tool_catalog_page_captures'),'captures are kept as captured');

SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}',false);
SELECT user_toolbox_read('10000000-0000-0000-0000-00000000000a') AS own \gset
SELECT t_assert(t_refused($q$SELECT record_tool_catalog_page_capture('30000000-0000-0000-0000-000000000001','https://maker.example/p','X wrench','FXM10',1,'USD','m1x','2026-10-19')$q$),
  'a signed-in user cannot record captures');
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}',false);
SELECT t_assert(t_refused($q$SELECT user_toolbox_read('10000000-0000-0000-0000-00000000000a')$q$),'another account: toolbox not shared');
RESET ROLE;
SET ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',false);
SELECT t_assert(t_refused($q$SELECT user_toolbox_read('10000000-0000-0000-0000-00000000000a')$q$),'anon: toolbox not shared');
RESET ROLE;

SELECT t_assert((:'own'::jsonb)->'items' @> jsonb_build_array(jsonb_build_object('part_number','FXM10','name','10 mm 12-Point Flank Drive Wrench','name_basis','maker_page',
    'quantity',2,'list_value',91.00,'pack_shot',jsonb_build_object('image_url','https://img.example/FXM10.jpg'),
    'list_price',jsonb_build_object('amount',45.50,'currency','USD','page_url','https://maker.example/product/FXM10'),
    'paid',jsonb_build_object('total',80.00,'receipts',1,'basis','your receipts'))),
  'owner: same-brand exact part-number match with primary pack shot, captured name and list value, and what was paid');
SELECT t_assert((:'own'::jsonb)->'items' @> '[{"part_number":"IMFM7","name":"3/8DR 7MM SOCKET","name_basis":"receipt_line","pack_shot":null,"list_price":null,"list_value":null}]',
  'no capture: receipt name without the sale-price tail; no pack shot or list price invented');
SELECT t_assert((:'own'::jsonb)#>'{coverage}' @> '{"tool_records":4,"matched_to_catalog":2,"unmatched_records":2,"with_pack_shot":1,"with_list_price":1}'
  AND (:'own'::jsonb)#>>'{totals,list_value}' = '91.00' AND (:'own'::jsonb)#>>'{totals,list_value_currency}' = 'USD'
  AND (:'own'::jsonb)#>>'{totals,paid}' = '97.60',
  'coverage counts the other-brand and receipt-header rows as unmatched; totals over matched items');
SELECT t_assert(NOT :'own' ~ '(Fixture Person|555-0100|another brand)','unmatched rows are never described');

UPDATE profiles SET tool_inventory_public = true WHERE id = '10000000-0000-0000-0000-00000000000a';
SET ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',false);
SELECT user_toolbox_read('10000000-0000-0000-0000-00000000000a') AS pub \gset
RESET ROLE;
SELECT t_assert(jsonb_array_length((:'pub'::jsonb)->'items') = 2
  AND (SELECT bool_and(NOT (i ? 'paid')) FROM jsonb_array_elements((:'pub'::jsonb)->'items') i) AND (:'pub'::jsonb)#>'{totals,paid}' = 'null'::jsonb
  AND NOT :'pub' ~ '(80\.00|97\.60|your receipts)'
  AND (:'pub'::jsonb)#>'{viewer,owner}' = 'false'::jsonb AND (:'pub'::jsonb)#>>'{items,0,pack_shot,image_url}' = 'https://img.example/FXM10.jpg',
  'shared toolbox: visitors see pack shots and list values, never what was paid');
SELECT t_assert(NOT has_function_privilege('authenticated','record_tool_catalog_page_capture(uuid,text,text,text,numeric,text,text,timestamptz)','EXECUTE')
  AND NOT has_table_privilege('anon','tool_catalog_page_captures','SELECT') AND has_function_privilege('anon','user_toolbox_read(uuid)','EXECUTE'),
  'grants: writer and captures service-only; reader open behind its own gate');
