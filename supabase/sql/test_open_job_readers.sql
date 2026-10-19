-- Disposable PG17 only. Proves 20261019121500_open_job_readers.sql under the privacy doctrine: anon reads open job
-- fields (vehicle label, display title, stages, resources, prices) and never personal information or party payments;
-- parties see their payments; private-vehicle work orders stay with slot holders. Fixture and prior state: the
-- authenticated job-reader contract, whose assertions run first against the previous readers.
\set ON_ERROR_STOP on
\ir test_job_readers_authenticated.sql

-- Open-data fixture: vehicle visibility and trim as live; a title naming the customer; a private vehicle; a job with
-- nothing but its vehicle; public handles for the tool supplier and the performer.
ALTER TABLE public.vehicles ADD COLUMN is_public boolean, ADD COLUMN trim text;
ALTER TABLE public.work_orders ADD COLUMN scope_category text;
UPDATE public.vehicles SET is_public = true;
UPDATE public.vehicles SET trim = 'Custom' WHERE id = '40000000-0000-0000-0000-000000000001';
INSERT INTO public.vehicles(id,user_id,year,make,model,is_public) VALUES
 ('40000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000007',1966,'Ford','Bronco',false);
INSERT INTO public.work_orders(id,vehicle_id,customer_id,customer_name,customer_email,title,scope_category,request_source,status) VALUES
 ('30000000-0000-0000-0000-00000000000d','40000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002',
  'Other Customer','other@example.com','Other Customer engine swap','full_restoration','in_person','quoted'),
 ('30000000-0000-0000-0000-00000000000e','40000000-0000-0000-0000-000000000005',NULL,NULL,NULL,'Bronco tune',NULL,NULL,'pending'),
 ('30000000-0000-0000-0000-00000000000f','40000000-0000-0000-0000-000000000003',NULL,NULL,NULL,NULL,NULL,'web','pending');
INSERT INTO public.profiles(id,username,is_public) VALUES ('00000000-0000-0000-0000-000000000008','tool_lender',true),
 ('00000000-0000-0000-0000-000000000006','fixture_tech',true);
INSERT INTO public.actors VALUES ('a0000000-0000-0000-0000-0000000000f2','Private Painter','painter','+15550177');

\ir ../migrations/20261019121500_open_job_readers.sql

CREATE OR REPLACE FUNCTION public.t_pii(j jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT j::text ~ '(Fixture Customer|Other Customer|5550100|5550177|5550199|example\.com|Customer asked|road test|Fixture Performer|Private Painter|"amount"|amount_usd|actual_payout|total_cost|unit_price|total_labor_cost|"phone"|"email"|"address"|payment_records|payouts_recorded)' $$;
GRANT EXECUTE ON FUNCTION public.t_pii(jsonb) TO anon, authenticated;

-- 0. Grants.
SELECT t_assert((SELECT bool_and(has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND p.prosecdef AND 'search_path=pg_catalog, public' = ANY (p.proconfig)) AND count(*) = 3
  FROM pg_proc p WHERE p.proname IN ('work_order_job_path_read','work_order_resources_read','vehicle_work_orders_read')),
  'open readers: definer with fixed search_path, executable by anon and authenticated');
SELECT t_assert((SELECT bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) AND count(*) = 3
  FROM pg_proc p WHERE p.proname IN ('my_identity_read','my_work_orders','my_signature_queue')), 'personal queues stay authenticated-only');
SELECT t_assert((SELECT bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  FROM pg_proc p WHERE p.proname IN ('work_order_viewer_slots','work_order_row_slots','platform_person_label','platform_actor_label',
    'work_order_open_header','work_order_list_row','job_reader_viewer','read_work_order_job_path','read_work_order_resources')),
  'helpers and wrapped readers stay closed');

-- 1. A visitor reads open fields, never personal information or party payments.
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
CREATE TEMP TABLE va AS SELECT work_order_job_path_read('30000000-0000-0000-0000-00000000000a') j;
SELECT t_assert((SELECT j @> '{"viewer":{"context":"visitor","slots":[],"money_visible":false,"contact_visible":false,"identity_bridge":"none","actions":[]},
  "vehicle_label":{"year":1970,"make":"Chevrolet","model":"C10","trim":"Custom","text":"1970 Chevrolet C10 Custom"},
  "display_title":"Brake job","display_title_basis":"title","request_source_label":"Requested by text message",
  "stages":{"accounting":{"state":"withheld","visibility":"parties_only"},"intake":{"state":"recorded"}},"coverage":{"withheld":["accounting: party payments and balances"]}}'
  AND (SELECT count(*) FROM jsonb_object_keys(j->'stages')) = 7 FROM va), 'visitor: job path with vehicle label, title, source label, accounting withheld');
SELECT t_assert((SELECT NOT t_pii(j) FROM va), 'visitor job path: no personal information or payments');
SELECT t_assert((SELECT j @> '{"display_title":"Paint","vehicle_label":null,"stages":{"accounting":{"state":"withheld"}}}' AND NOT t_pii(j)
  FROM (SELECT work_order_job_path_read('30000000-0000-0000-0000-00000000000b') j) x), 'visitor: a job without a vehicle is open, its payments withheld');
SELECT t_assert((SELECT j @> '{"display_title":"Full restoration","display_title_basis":"scope_category","request_source_label":"Requested in person"}' AND NOT t_pii(j)
  FROM (SELECT work_order_job_path_read('30000000-0000-0000-0000-00000000000d') j) x), 'visitor: a title naming the customer falls back to the scope category');
SELECT t_assert((SELECT j @> '{"display_title":"Work order on 1999 Jeep Cherokee","display_title_basis":"vehicle","request_source_label":"Requested on the web"}'
  FROM (SELECT work_order_job_path_read('30000000-0000-0000-0000-00000000000f') j) x), 'visitor: an untitled job is named by its vehicle');
SELECT t_assert(t_refused($q$SELECT work_order_job_path_read('30000000-0000-0000-0000-00000000000e')$q$)
  AND t_refused($q$SELECT work_order_resources_read('30000000-0000-0000-0000-00000000000e')$q$), 'visitor: private-vehicle job refused');
SELECT t_assert(t_refused($q$SELECT work_order_job_path_read('30000000-0000-0000-0000-000000000099')$q$), 'visitor: unknown job refused');
CREATE TEMP TABLE vr AS SELECT work_order_resources_read('30000000-0000-0000-0000-00000000000a') j;
SELECT t_assert((SELECT j @> '{"viewer":{"context":"visitor","party":false,"money_visible":false},"display_title":"Brake job",
  "fulfillments":[{"supplier_user_id":null,"supplier":{"kind":"user","handle":"tool_lender","profile_id":"00000000-0000-0000-0000-000000000008"},"user_tool_id":"70000000-0000-0000-0000-000000000001"}],
  "attestations":[{"attestor_user_id":null,"attestor":{"kind":"user","handle":"tool_lender"},"scope":"Bleeder available Tuesday"}],
  "requirements":[{"description":"Brake bleeder","basis_excerpt":null,"basis_excerpt_visibility":"withheld_not_party"}]}' FROM vr),
  'visitor: resources open, people by public handle, raw ids and excerpts withheld');
SELECT t_assert((SELECT NOT t_pii(j) FROM vr), 'visitor resources: no personal information');
CREATE TEMP TABLE vv AS SELECT vehicle_work_orders_read('40000000-0000-0000-0000-000000000003') j;
SELECT t_assert((SELECT j @> '{"viewer":{"context":"visitor","slots":[]},"vehicle_label":{"text":"1999 Jeep Cherokee"},"coverage":{"returned":2,"total_for_vehicle":2},"next_after":null,
  "rows":[{"work_order_id":"30000000-0000-0000-0000-00000000000d","display_title":"Full restoration","title":"Full restoration","slots":[],"money_visible":false,"stage_states":{"accounting":"withheld"}},
          {"work_order_id":"30000000-0000-0000-0000-00000000000f","display_title":"Work order on 1999 Jeep Cherokee"}]}'
  AND (SELECT count(*) FROM jsonb_object_keys(j->'rows'->0->'stage_states')) = 7 AND NOT t_pii(j) FROM vv), 'visitor: vehicle work orders with labels, no slots, no PII');
SELECT t_assert((SELECT jsonb_array_length(j->'rows') = 1 AND j->>'next_after' = '30000000-0000-0000-0000-00000000000d'
  FROM (SELECT vehicle_work_orders_read('40000000-0000-0000-0000-000000000003', NULL, 1) j) x), 'visitor: vehicle list paginates');
SELECT t_assert(t_refused($q$SELECT vehicle_work_orders_read('40000000-0000-0000-0000-000000000005')$q$), 'visitor: private vehicle list refused');
SELECT t_assert(t_refused($q$SELECT vehicle_work_orders_read('40000000-0000-0000-0000-000000000099')$q$), 'visitor: unknown vehicle refused');
SELECT t_assert(t_refused('SELECT my_work_orders()') AND t_refused('SELECT my_identity_read()') AND t_refused('SELECT my_signature_queue()'),
  'visitor: personal queues refused');
RESET ROLE;

-- 2. Parties see their payments and their own titles.
SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000002');
SELECT t_assert((SELECT j @> '{"viewer":{"context":"client","slots":["customer"],"money_visible":true},"stages":{"accounting":{"state":"recorded","payment_records":1}},"coverage":{"withheld":[]}}'
  FROM (SELECT work_order_job_path_read('30000000-0000-0000-0000-00000000000b') j) x), 'customer: own payments visible');
SELECT t_assert((SELECT j @> '{"display_title":"Other Customer engine swap","display_title_basis":"title"}'
  FROM (SELECT work_order_job_path_read('30000000-0000-0000-0000-00000000000d') j) x), 'customer: own title shown');
SELECT t_assert((SELECT j @> '{"viewer":{"context":"visitor","money_visible":false},"stages":{"accounting":{"state":"withheld"}}}'
  FROM (SELECT work_order_job_path_read('30000000-0000-0000-0000-00000000000a') j) x), 'another customer''s payments withheld from a signed-in non-party');
SELECT t_as('00000000-0000-0000-0000-000000000001');
SELECT t_assert((SELECT j @> '{"viewer":{"party":true,"money_visible":true},"fulfillments":[{"supplier_user_id":"00000000-0000-0000-0000-000000000008","supplier":{"handle":"tool_lender"}}],
  "requirements":[{"basis_excerpt":"road test after brake bleed"}]}' FROM (SELECT work_order_resources_read('30000000-0000-0000-0000-00000000000a') j) x),
  'customer: raw supplier id and excerpt shown to the party');
CREATE TEMP TABLE m1 AS SELECT my_work_orders() j;
SELECT t_assert((SELECT j->'rows' @> '[{"work_order_id":"30000000-0000-0000-0000-00000000000a","slots":["customer"],"money_visible":true,"display_title":"Brake job","vehicle_label":{"make":"Chevrolet"},"request_source_label":"Requested by text message"},
  {"work_order_id":"30000000-0000-0000-0000-00000000000d","slots":["vehicle_access"],"money_visible":false,"title":"Full restoration","stage_states":{"accounting":"withheld"}}]'
  AND (j#>>'{coverage,total_for_viewer}')::int = 3 FROM m1), 'my_work_orders: labelled rows, money only on party rows, names withheld on non-party rows');
SELECT t_assert((SELECT NOT (j::text ~ '(Other Customer|other@example|5550100)') FROM m1), 'my_work_orders: no other customer''s PII');
SELECT t_as('00000000-0000-0000-0000-000000000007');
SELECT t_assert((SELECT j @> '{"viewer":{"context":"client","slots":["vehicle_access"]},"rows":[{"work_order_id":"30000000-0000-0000-0000-00000000000e","slots":["vehicle_access"],"display_title":"Bronco tune","request_source_label":"Request channel not recorded"}],"coverage":{"total_for_vehicle":1}}'
  FROM (SELECT vehicle_work_orders_read('40000000-0000-0000-0000-000000000005') j) x), 'private vehicle: its owner reads its work orders');
SELECT t_assert((SELECT work_order_job_path_read('30000000-0000-0000-0000-00000000000e') @> '{"viewer":{"slots":["vehicle_access"]}}'), 'private vehicle: owner reads the job path');
RESET ROLE;

-- 3. People and actors: handle through a public profile or an evidenced bridge, otherwise unnamed; never a legal name.
SELECT t_assert(platform_actor_label('a0000000-0000-0000-0000-0000000000f1') @> '{"kind":"user","handle":"fixture_tech","basis":"evidenced_identity_bridge"}',
  'an evidenced actor appears by the public handle of the bridged account');
SELECT t_assert(platform_actor_label('a0000000-0000-0000-0000-0000000000f2') = '{"kind":"actor","actor_id":"a0000000-0000-0000-0000-0000000000f2","role":"painter","label":"unnamed party"}',
  'an unbridged actor is an unnamed party with a role');
SELECT t_assert(platform_person_label('00000000-0000-0000-0000-000000000009') = '{"kind":"user","label":"unnamed party"}', 'a user without a public profile is unnamed');
SELECT t_assert(platform_organization_label('0a000000-0000-0000-0000-000000000001') @> '{"kind":"organization","name":"Fixture Shop"}', 'organizations appear by name');

-- 4. Slot helper reads the caller's candidates, one work order or one vehicle.
SELECT t_assert((SELECT array_agg(right(work_order_id::text,1) ORDER BY work_order_id) FROM work_order_viewer_slots('00000000-0000-0000-0000-000000000003')) = '{a}',
  'slots: vehicle permission holder gets only that vehicle''s job');
SELECT t_assert((SELECT count(*) FROM work_order_viewer_slots('00000000-0000-0000-0000-000000000005')) = 6, 'slots: admin reads every job');
SELECT t_assert((SELECT count(*) FROM work_order_viewer_slots(NULL, NULL, '40000000-0000-0000-0000-000000000003')) = 2
  AND (SELECT bool_and(cardinality(slots) = 0) FROM work_order_viewer_slots(NULL, NULL, '40000000-0000-0000-0000-000000000003')), 'slots: per-vehicle rows for a visitor carry no slots');
SELECT t_assert((SELECT count(*) FROM work_order_viewer_slots(NULL)) = 0, 'slots: a visitor has no work-order list of their own');
