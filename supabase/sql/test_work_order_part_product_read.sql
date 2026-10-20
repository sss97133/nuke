-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations (chained on the job-loop replay).
-- work_order_part_read (one job part line as a product page), including the product link of 20261020074500.
\ir test_job_loop_replay.sql

CREATE FUNCTION public.as_user(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.auth_uid',COALESCE(p::text,''),false) $$;
GRANT EXECUTE ON FUNCTION public.as_user(uuid) TO anon, authenticated, service_role;
CREATE FUNCTION public.ppr(p uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT work_order_part_read(p) $$;
GRANT EXECUTE ON FUNCTION public.ppr(uuid) TO anon, authenticated;

-- Catalog: MB-304 by the line's brand (matches); 12-345 by another manufacturer (the line records Holley: no match);
-- a short shared number without a brand (ambiguous).
INSERT INTO catalog_sources(id,name,provider,base_url) VALUES
 ('c5000000-0000-0000-0000-000000000001','Fixture Catalog','fixture','https://catalog.example.invalid');
INSERT INTO catalog_parts(id,catalog_id,part_number,name,manufacturer,price_current,currency,product_image_url,supplier_url,in_stock,fits_models,updated_at) VALUES
 ('c6000000-0000-0000-0000-000000000001','c5000000-0000-0000-0000-000000000001','MB 304','Mandrel bend, 304 stainless','FixtureCo Inc',29.99,'USD',
  'https://img.example.invalid/mb304.jpg','javascript:alert(1)',true,ARRAY['Fixture Model'],'2026-05-01T00:00:00Z'),
 ('c6000000-0000-0000-0000-000000000002','c5000000-0000-0000-0000-000000000001','12345','Gasket','Edelbrock',9,'USD',NULL,NULL,true,NULL,'2026-05-01T00:00:00Z'),
 ('c6000000-0000-0000-0000-000000000003','c5000000-0000-0000-0000-000000000001','77','Clip','A',1,'USD',NULL,NULL,true,NULL,'2026-05-01T00:00:00Z'),
 ('c6000000-0000-0000-0000-000000000004','c5000000-0000-0000-0000-000000000001','7-7','Clip','B',1,'USD',NULL,NULL,true,NULL,'2026-05-01T00:00:00Z');
-- Part lines: d..01 (replay fixture, quoted MB-304 FixtureCo); d..02 installed, names the customer, a supplier address,
-- an op code shared with a labor line, an unsafe image url; d..03 a short shared number without a brand; d..04 on no job.
UPDATE work_order_parts SET supplier = 'Fixture Supply', buy_url = 'https://www.shop.example.invalid/mb-304?ref=1' WHERE id = 'd0000000-0000-0000-0000-000000000001';
INSERT INTO work_order_parts(id,work_order_id,part_name,part_number,brand,quantity,status,unit_price,total_price,supplier,buy_url,image_url,notes,job_op_code,is_comped) VALUES
 ('d0000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','Gasket for Fixture Customer','12-345','Holley',1,'installed',12,12,
  '707 Fixture St, Boulder City NV','ftp://files.example.invalid/x','javascript:alert(1)','Call Fixture before install','EXH-001',false),
 ('d0000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000001','Clip','77',NULL,10,'quoted',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
 ('d0000000-0000-0000-0000-000000000004',NULL,'Loose part','MB-304','FixtureCo',1,'quoted',1,1,NULL,NULL,NULL,NULL,NULL,NULL),
 ('d0000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000001','Header gasket','RF-9001','Remflex',2,'installed',8,16,NULL,NULL,NULL,NULL,NULL,false),
 ('d0000000-0000-0000-0000-000000000006','30000000-0000-0000-0000-000000000001','Seat cover','SC-1','Customer Trim',1,'installed',50,50,NULL,NULL,NULL,NULL,NULL,false);
-- Product links (20261020074500's service-role writer): d..05 by its page; d..06 whose brand names the customer.
SET ROLE service_role;
SELECT record_work_order_part_product('d0000000-0000-0000-0000-000000000005','https://www.shop.example.invalid/rf-9001','Remflex header gasket 2-bolt',
  'Remflex','RF-9001','https://img.example.invalid/rf.jpg','brand_and_part_number_on_page','page_extract_v1','2026-10-19T20:00:00Z');
SELECT record_work_order_part_product('d0000000-0000-0000-0000-000000000006','https://www.trim.example.invalid/sc-1','Seat cover',
  'Customer Trim','SC-1','https://img.example.invalid/sc.jpg','brand_and_part_number_on_page','page_extract_v1','2026-10-19T20:00:00Z');
RESET ROLE;
INSERT INTO work_order_labor(id,work_order_id,task_name,task_category,hours,hourly_rate,job_op_code,status) VALUES
 ('e0000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','Install headers','install',2,150,'EXH-001','complete');
INSERT INTO part_alternatives(id,work_order_part_id,retailer,brand,part_number,condition,price,store_location,in_stock,url,is_selected,notes,created_at) VALUES
 ('c7000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','rockauto','FixtureCo','MB-304','new',27.5,NULL,true,
  'https://www.rockauto.example.invalid/mb304',true,'cheapest','2026-02-04T00:00:00Z'),
 ('c7000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','autozone','FixtureCo','MB-304','new',33,'Store 12, Fixture Ave',false,
  'ftp://x.example.invalid',false,NULL,'2026-02-04T00:00:00Z');

UPDATE vehicles SET is_public = true WHERE id = '40000000-0000-0000-0000-000000000001';
SET ROLE anon;
SELECT as_user(NULL);
SELECT ppr('d0000000-0000-0000-0000-000000000001') AS a1 \gset
SELECT ppr('d0000000-0000-0000-0000-000000000002') AS a2 \gset
SELECT ppr('d0000000-0000-0000-0000-000000000003') AS a3 \gset
SELECT ppr('d0000000-0000-0000-0000-000000000005') AS a5 \gset
SELECT ppr('d0000000-0000-0000-0000-000000000006') AS a6 \gset
SELECT t_assert(t_refused_with($q$SELECT ppr('d0000000-0000-0000-0000-000000000004')$q$,'Part unavailable')
 AND t_refused_with($q$SELECT ppr('d0000000-0000-0000-0000-0000000000ff')$q$,'Part unavailable'),
 'a part on no job, or no part, is unavailable');
RESET ROLE;

SELECT t_assert((:'a1'::jsonb) @> '{"part":{"part_name":"304 stainless mandrel bend","brand":"FixtureCo","part_number":"MB-304","quantity":4},
   "line":{"status":"quoted"},"price":{"unit_price":31.25,"total_price":125},
   "supplier":{"label":null,"label_visibility":"parties_only","buy_url":"https://www.shop.example.invalid/mb-304?ref=1","buy_url_host":"shop.example.invalid"},
   "vehicle_label":{},"viewer":{"party":false,"context":"visitor","actions":[]},"payment_authorized":false}'
 AND (:'a1'::jsonb)#>>'{line,status_basis}' LIKE '%not a completion Sign%',
 'anon on a public vehicle: identity, line status with its basis, recorded prices, link and host; supplier label to parties only');
SELECT t_assert((:'a1'::jsonb)->'catalog' @> '{"state":"matched","match_basis":"exact_part_number_and_brand",
   "match":{"catalog_part_id":"c6000000-0000-0000-0000-000000000001","name":"Mandrel bend, 304 stainless","price_current":29.99,
     "product_image_url":"https://img.example.invalid/mb304.jpg","supplier_url":null,"clock":"2026-05-01T00:00:00+00:00",
     "source":{"name":"Fixture Catalog","base_url":"https://catalog.example.invalid"}}}'
 AND (:'a1'::jsonb)#>>'{catalog,basis}' LIKE '%not a fact about the installed item%'
 AND (:'a1'::jsonb) @> '{"product_link":null,"product_link_basis":"no_current_link","catalog":{"same_as_product_link":false}}',
 'catalog listing by exact normalized part number with brand agreement, its source and clock; unsafe urls dropped');
SELECT t_assert((:'a1'::jsonb)->'offers' = jsonb_build_array(
   jsonb_build_object('id','c7000000-0000-0000-0000-000000000001','retailer','rockauto','brand','FixtureCo','part_number','MB-304','condition','new',
     'price',27.5,'in_stock',true,'url','https://www.rockauto.example.invalid/mb304','url_host','rockauto.example.invalid','is_selected',true,
     'recorded_at','2026-02-04T00:00:00+00:00'),
   jsonb_build_object('id','c7000000-0000-0000-0000-000000000002','retailer','autozone','brand','FixtureCo','part_number','MB-304','condition','new',
     'price',33,'in_stock',false,'url',NULL,'url_host',NULL,'is_selected',false,'recorded_at','2026-02-04T00:00:00+00:00'))
 AND (:'a1'::jsonb)->'coverage' @> '{"offers":2,"offers_with_link":1,"catalog":"matched","operation_link":"no_job_op_code","evidence":"not_linkable"}',
 'offers: selected first, http(s) links only, no store location or notes for a visitor; coverage counts them');
SELECT t_assert((:'a2'::jsonb) @> '{"part":{"part_name":null,"part_name_visibility":"withheld_personal_info","brand":"Holley"},
   "line":{"status":"installed"},"supplier":{"label":null,"buy_url":null},"image":{"url":null},
   "catalog":{"state":"not_matched_brand_disagrees","catalog_rows_same_part_number":1,"match":null},
   "operation":{"job_op_code":"EXH-001","line_item":null,"labor":[{"id":"e0000000-0000-0000-0000-000000000002","task_name":"Install headers","status":"complete"}]},
   "coverage":{"operation_link":"labor_by_job_op_code","operation_row":"not_linkable","part_image":false,"buy_link":false}}'
 AND NOT (:'a2'::jsonb)->'line' ? 'notes',
 'anon: a name naming the customer is withheld; a brand disagreement is no match; labor by op code; ftp and javascript urls dropped; no notes');
SELECT t_assert((:'a3'::jsonb)->'catalog' @> '{"state":"not_matched_part_number_ambiguous","catalog_rows_same_part_number":2,"match":null}',
 'a short part number shared by two catalog rows and no brand is not matched');
SELECT t_assert((:'a5'::jsonb) @> '{"product_link":{"product_name":"Remflex header gasket 2-bolt","manufacturer":"Remflex","part_number_as_printed":"RF-9001",
     "image_url":"https://img.example.invalid/rf.jpg","page_url":"https://www.shop.example.invalid/rf-9001","page_host":"shop.example.invalid",
     "match_basis":"brand_and_part_number_on_page"},
   "catalog":{"state":"matched","same_as_product_link":true},"coverage":{"product_link":true}}'
 AND (:'a5'::jsonb)#>>'{product_link_basis}' LIKE '%not the installed item%',
 'a linked part carries its product link (page, seller photo, basis); the exact-number catalog row is the same listing');
SELECT t_assert((:'a6'::jsonb) @> '{"part":{"brand":null,"brand_visibility":"withheld_personal_info"},"product_link":null,
   "product_link_basis":"withheld_with_brand","catalog":{"state":"withheld_with_brand"},"coverage":{"product_link":false}}'
 AND NOT (:'a6'::jsonb)::text ~ 'Customer Trim',
 'a brand that names the customer withholds the product link and catalog match from a visitor');
SELECT t_assert(NOT (:'a1'::jsonb)::text ~ '(10000000-0000-0000-0000-00000000000[cdef]|Fixture Customer|fixture@example|15550100|Fixture St|Store 12|cheapest)'
 AND NOT (:'a2'::jsonb)::text ~ '(10000000-0000-0000-0000-00000000000[cdef]|Fixture Customer|fixture@example|15550100|Fixture St|Call Fixture)',
 'no user ids, names, contact, supplier address, store location or notes in the open reader');

-- Parties: the customer reads the supplier label, notes and offer store locations.
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT ppr('d0000000-0000-0000-0000-000000000001') AS c1 \gset
SELECT ppr('d0000000-0000-0000-0000-000000000002') AS c2 \gset
RESET ROLE;
SELECT t_assert((:'c2'::jsonb) @> '{"part":{"part_name":"Gasket for Fixture Customer"},"supplier":{"label":"707 Fixture St, Boulder City NV","label_visibility":"shown"},
   "line":{"notes":"Call Fixture before install"},"viewer":{"party":true}}'
 AND (:'c1'::jsonb)->'offers' @> '[{"retailer":"autozone","store_location":"Store 12, Fixture Ave"},{"retailer":"rockauto","notes":"cheapest"}]',
 'customer: name, supplier label, notes and offer store locations shown');

-- Private vehicle: parties only.
UPDATE vehicles SET is_public = false WHERE id = '40000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT t_assert(t_refused_with($q$SELECT ppr('d0000000-0000-0000-0000-000000000001')$q$,'Part unavailable'),'stranger: private vehicle part unavailable');
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT ppr('d0000000-0000-0000-0000-000000000001') AS o1 \gset
RESET ROLE;
SET ROLE anon;
SELECT as_user(NULL);
SELECT t_assert(t_refused_with($q$SELECT ppr('d0000000-0000-0000-0000-000000000001')$q$,'Part unavailable'),'anon: private vehicle part unavailable');
RESET ROLE;
SELECT t_assert((:'o1'::jsonb) @> '{"viewer":{"party":true},"supplier":{"label":"Fixture Supply"}}','shop owner reads the part on a private vehicle');

SELECT t_assert(has_function_privilege('anon','work_order_part_read(uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','work_order_part_catalog_match(text,text)','EXECUTE')
 AND (SELECT count(*) FROM regexp_matches(pg_get_functiondef('work_order_operations_read(uuid)'::regprocedure),'''product''','g')) = 1
 AND to_regclass('public.idx_catalog_parts_pn_norm_any') IS NOT NULL,
 'reader granted to anon; catalog helper internal; operations reader keeps one product key; full part-number index');
