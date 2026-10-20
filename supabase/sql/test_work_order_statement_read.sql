-- Disposable PG17 only. Proves 20261019130000_work_order_statement_read.sql: lookup by work order id, vehicle id or
-- public handle only; parts and labor prices open; payments, balances, payment instructions and notes to parties only;
-- no customer or shop contact fields; private-vehicle work orders only to slot holders.
-- Fixture and prior state: the open job-reader contract.
\set ON_ERROR_STOP on
\ir test_open_job_readers.sql

-- Statement columns of the live tables.
ALTER TABLE public.work_order_parts ADD COLUMN part_number text, ADD COLUMN brand text, ADD COLUMN category text,
  ADD COLUMN quantity integer DEFAULT 1, ADD COLUMN total_price numeric, ADD COLUMN supplier text, ADD COLUMN buy_url text,
  ADD COLUMN ai_extracted boolean, ADD COLUMN user_verified boolean, ADD COLUMN is_comped boolean, ADD COLUMN comp_reason text,
  ADD COLUMN comp_retail_value numeric, ADD COLUMN is_taxable boolean, ADD COLUMN notes text, ADD COLUMN created_at timestamptz DEFAULT now();
ALTER TABLE public.work_order_labor ADD COLUMN task_name text, ADD COLUMN task_category text, ADD COLUMN hourly_rate numeric,
  ADD COLUMN rate_source text, ADD COLUMN status text, ADD COLUMN is_comped boolean, ADD COLUMN comp_reason text,
  ADD COLUMN comp_retail_value numeric, ADD COLUMN notes text, ADD COLUMN created_at timestamptz DEFAULT now();
ALTER TABLE public.work_order_payments ADD COLUMN payment_method text, ADD COLUMN sender_name text, ADD COLUMN memo text,
  ADD COLUMN reference_id text, ADD COLUMN payment_date date, ADD COLUMN source text, ADD COLUMN created_at timestamptz DEFAULT now();
ALTER TABLE public.work_orders ADD COLUMN org_id uuid, ADD COLUMN notes text;
ALTER TABLE public.organizations ADD COLUMN legal_name text, ADD COLUMN email text, ADD COLUMN phone text, ADD COLUMN website text,
  ADD COLUMN address text, ADD COLUMN city text, ADD COLUMN state text, ADD COLUMN zip_code text, ADD COLUMN logo_url text,
  ADD COLUMN tax_rate numeric, ADD COLUMN metadata jsonb;
ALTER TABLE public.profiles ADD COLUMN username_lower text;
ALTER TABLE public.vehicles ADD COLUMN vin text;

UPDATE public.organizations SET legal_name='Fixture Holdings LLC', email='shop@example.com', phone='+15550144', website='https://shop.example.org',
  address='9 Fixture Rd', city='Boise', state='ID', zip_code='83702', tax_rate=0.06,
  metadata='{"payment_methods":[{"method":"zelle","label":"Zelle","detail":"pay-shop@example.com"}]}' WHERE id='0a000000-0000-0000-0000-000000000001';
UPDATE public.work_orders SET org_id='0a000000-0000-0000-0000-000000000001', notes='Customer prefers calls at night' WHERE id='30000000-0000-0000-0000-00000000000a';
UPDATE public.work_order_parts SET quantity=1, total_price=40, supplier='Parts House', notes='call customer 555-0100' WHERE id='d0000000-0000-0000-0000-000000000001';
UPDATE public.work_order_labor SET task_name='Bleed brakes', hourly_rate=150, rate_source='shop_rate', notes='private labor note'
  WHERE work_order_id='30000000-0000-0000-0000-00000000000a';
INSERT INTO public.work_order_payments(work_order_id,amount,status,payment_method,sender_name,memo,payment_date)
  VALUES ('30000000-0000-0000-0000-00000000000a',100,'completed','zelle','Fixture Customer','brakes','2026-01-05');
UPDATE public.vehicles SET vin='1FIXTUREVIN000001' WHERE id='40000000-0000-0000-0000-000000000001';
UPDATE public.profiles SET is_public=true WHERE id='00000000-0000-0000-0000-000000000001';
INSERT INTO public.profiles(id,username,is_public) VALUES ('00000000-0000-0000-0000-000000000002','second_customer',false);
UPDATE public.profiles SET username_lower=lower(username);

\ir ../migrations/20261019130000_work_order_statement_read.sql

CREATE FUNCTION public.t_statement_pii(j jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT j::text ~ '(Fixture Customer|Other Customer|5550100|5550144|example\.com|Fixture Rd|83702|Fixture Holdings|prefers calls|call customer|private labor note|"amount"|sender_name|pay-shop)' $$;
GRANT EXECUTE ON FUNCTION public.t_statement_pii(jsonb) TO anon, authenticated;

SELECT t_assert(has_function_privilege('anon','public.work_order_statement_read(uuid,uuid,text)','EXECUTE')
  AND has_function_privilege('authenticated','public.work_order_statement_read(uuid,uuid,text)','EXECUTE')
  AND (SELECT prosecdef AND 'search_path=pg_catalog, public' = ANY (proconfig) FROM pg_proc WHERE proname='work_order_statement_read'),
  'statement reader: definer, pinned search_path, anon and authenticated');

-- 1. A visitor reads the open statement.
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
CREATE TEMP TABLE sa AS SELECT work_order_statement_read('30000000-0000-0000-0000-00000000000a') j;
SELECT t_assert((SELECT j @> '{"viewer":{"context":"visitor","money_visible":false},
  "vehicle":{"text":"1970 Chevrolet C10 Custom","vin":"1FIXTUREVIN000001"},
  "contact":{"action":"contact_via_nuke","available":false},
  "shop":{"name":"Fixture Shop","website":"https://shop.example.org","city":"Boise","tax_rate":0.06,"payment_methods":null,"payment_methods_visibility":"withheld_not_party"},
  "work_orders":[{"id":"30000000-0000-0000-0000-00000000000a","display_title":"Brake job","money_visible":false,"notes":null,
    "parts":[{"part_name":"Pads","unit_price":40,"total_price":40,"supplier":"Parts House","notes":null}],
    "labor":[{"task_name":"Bleed brakes","hourly_rate":150,"total_cost":300,"notes":null}],
    "payments":null,"payments_visibility":"withheld_not_party","payments_total":null,"balance_due":null,"parts_total":40,"labor_total":300}],
  "totals":{"parts":40,"labor":300,"subtotal":340,"payments":null,"balance":null},"coverage":{"payments_withheld_on":1,"lookup":"work_order_id"}}' FROM sa),
  'visitor: statement lines and prices open; payments, balance, instructions and notes withheld');
SELECT t_assert((SELECT NOT t_statement_pii(j) AND NOT (j->'shop' ?| ARRAY['email','phone','address','zip_code','legal_name']) FROM sa),
  'visitor statement: no customer or shop contact fields');
SELECT t_assert((SELECT jsonb_array_length(j->'work_orders') = 2 AND j->'work_orders' @> '[{"display_title":"Full restoration"},{"display_title":"Work order on 1999 Jeep Cherokee"}]'
  AND NOT t_statement_pii(j) FROM (SELECT work_order_statement_read(NULL, '40000000-0000-0000-0000-000000000003') j) x), 'visitor: statement by vehicle');
SELECT t_assert((SELECT j @> '{"vehicle":{"text":"1970 Chevrolet C10 Custom"},"coverage":{"lookup":"handle"}}'
  FROM (SELECT work_order_statement_read(NULL, NULL, '@fixture_one') j) x), 'visitor: statement by public handle');
SELECT t_assert((SELECT work_order_statement_read(NULL, NULL, 'second_customer') = '{"error":"no_match","lookup":"handle"}'), 'a private profile handle does not resolve');
SELECT t_assert((SELECT work_order_statement_read(NULL, NULL, 'Fixture Customer') @> '{"error":"no_match"}'), 'customer names are not a lookup key');
SELECT t_assert((SELECT work_order_statement_read('30000000-0000-0000-0000-000000000099') = '{"error":"no_match","lookup":"work_order_id"}'), 'unknown work order: no match');
SELECT t_assert((SELECT j @> '{"vehicle":null,"coverage":{"population":"one work order without a vehicle"},"work_orders":[{"display_title":"Paint","payments":null}]}'
  FROM (SELECT work_order_statement_read('30000000-0000-0000-0000-00000000000b') j) x), 'visitor: a work order without a vehicle is its own statement');
SELECT t_assert((SELECT work_order_statement_read('30000000-0000-0000-0000-00000000000e') @> '{"error":"no_match","lookup":"not_visible"}')
  AND (SELECT work_order_statement_read(NULL, '40000000-0000-0000-0000-000000000005') @> '{"error":"no_match","lookup":"not_visible"}'), 'visitor: private vehicle statement not visible');
SELECT t_assert(t_refused($q$SELECT work_order_statement_read('30000000-0000-0000-0000-00000000000a','40000000-0000-0000-0000-000000000001')$q$)
  AND t_refused('SELECT work_order_statement_read()'), 'exactly one lookup key');
RESET ROLE;

-- 2. Parties see payments, balance, instructions and notes.
SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000001');
CREATE TEMP TABLE sc AS SELECT work_order_statement_read('30000000-0000-0000-0000-00000000000a') j;
SELECT t_assert((SELECT j @> '{"viewer":{"slots":["customer"],"money_visible":true},
  "shop":{"payment_methods":[{"method":"zelle"}],"payment_methods_visibility":"party"},
  "work_orders":[{"money_visible":true,"notes":"Customer prefers calls at night","payments":[{"amount":100,"sender_name":"Fixture Customer"}],
    "payments_visibility":"party","payments_total":100,"balance_due":240,"parts":[{"notes":"call customer 555-0100"}]}],
  "totals":{"payments":100,"balance":240},"contact":{"action":"contact_via_nuke"}}' FROM sc), 'customer: payments, balance, instructions and notes');
SELECT t_assert((SELECT NOT (j->'shop' ?| ARRAY['email','phone','address','zip_code','legal_name']) FROM sc), 'customer: shop contact fields still not exposed');
SELECT t_as('00000000-0000-0000-0000-000000000007');
SELECT t_assert((SELECT j @> '{"work_orders":[{"id":"30000000-0000-0000-0000-00000000000e","slots":["vehicle_access"],"money_visible":false}]}'
  FROM (SELECT work_order_statement_read(NULL, '40000000-0000-0000-0000-000000000005') j) x), 'private vehicle: its owner reads the statement');
RESET ROLE;
