-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations (20261020074500 is applied by the job-loop replay).
-- Job part to catalog product links: the service-role writer, supersession, the immutability guard and the product card
-- on work_order_operations_read parts.
\ir test_work_order_operations_read.sql

CREATE FUNCTION public.rec(p_url text, p_img text, p_basis text DEFAULT 'brand_and_part_number_on_page') RETURNS jsonb LANGUAGE sql AS $$
  SELECT record_work_order_part_product('d0000000-0000-0000-0000-000000000001', p_url, 'Mandrel bend 2.5in 304', 'FixtureCo',
    'MB-304', p_img, p_basis, 'page_extract_v1', '2026-10-19T20:00:00Z') $$;
GRANT EXECUTE ON FUNCTION public.rec(text,text,text) TO anon, authenticated, service_role;

SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT t_assert(t_refused('SELECT rec(''https://shop.example/p/mb-304'',''https://img.example/mb.jpg'')'),'signed-in user cannot record a product link');
RESET ROLE;
SET ROLE service_role;
SELECT rec('https://www.shop.example/p/mb-304','https://img.example/mb.jpg') AS l1 \gset
SELECT rec('https://www.shop.example/p/mb-304','https://img.example/mb.jpg') AS l1dup \gset
SELECT t_assert(t_refused('SELECT rec(''ftp://shop.example/p'',''https://img.example/mb.jpg'')')
  AND t_refused('SELECT rec(''https://shop.example/p'',''https://img.example/mb.jpg'',''looks_similar'')'),'non-http page and unknown basis refused');
RESET ROLE;
SELECT t_assert(NOT ((:'l1'::jsonb)->>'duplicate')::boolean AND ((:'l1dup'::jsonb)->>'duplicate')::boolean
  AND (:'l1dup'::jsonb)->>'link_id' = (:'l1'::jsonb)->>'link_id'
  AND (SELECT count(*) FROM catalog_sources WHERE provider='shop.example' AND base_url='https://shop.example') = 1
  AND (SELECT count(*) FROM catalog_parts WHERE supplier_url='https://www.shop.example/p/mb-304') = 1,'first capture links; replay is a duplicate; one source per host');

SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT opr() AS c1 \gset
RESET ROLE;
SELECT t_assert((:'c1'::jsonb)->'parts' @> jsonb_build_array(jsonb_build_object('id','d0000000-0000-0000-0000-000000000001',
   'product',jsonb_build_object('image_url','https://img.example/mb.jpg','product_name','Mandrel bend 2.5in 304','manufacturer','FixtureCo',
     'part_number_as_printed','MB-304','source','shop.example','match_basis','brand_and_part_number_on_page',
     'page_url','https://www.shop.example/p/mb-304')))
  AND (:'c1'::jsonb)#>>'{parts,0,product,image_basis}' LIKE '%not a photo of the installed part%','operations reader: part carries its product card');

UPDATE vehicles SET is_public = true WHERE id = '40000000-0000-0000-0000-000000000001';
SET ROLE anon;
SELECT as_user(NULL);
SELECT opr() AS a1 \gset
RESET ROLE;
SELECT t_assert((:'a1'::jsonb)#>>'{parts,0,product,image_url}' = 'https://img.example/mb.jpg','anon on a public vehicle: product card shown');

SET ROLE service_role;
SELECT rec('https://www.shop.example/p/mb-304-v2','https://img.example/mb2.jpg') AS l2 \gset
RESET ROLE;
SELECT t_assert((:'l2'::jsonb)->>'superseded' = (:'l1'::jsonb)->>'link_id'
  AND (SELECT superseded_at IS NOT NULL AND superseded_by = ((:'l2'::jsonb)->>'link_id')::uuid FROM work_order_part_products WHERE id = ((:'l1'::jsonb)->>'link_id')::uuid)
  AND (SELECT count(*) FROM work_order_part_products WHERE work_order_part_id='d0000000-0000-0000-0000-000000000001') = 2
  AND (SELECT count(*) FROM catalog_parts WHERE product_image_url IN ('https://img.example/mb.jpg','https://img.example/mb2.jpg')) = 2
  AND work_order_part_product_card('d0000000-0000-0000-0000-000000000001')->>'image_url' = 'https://img.example/mb2.jpg','a new capture supersedes the link and keeps the old one and its catalog row');
SELECT t_assert(t_refused_with(format('DELETE FROM work_order_part_products WHERE id=%L',(:'l1'::jsonb)->>'link_id'),'kept')
  AND t_refused_with(format('UPDATE work_order_part_products SET evidence_url=''https://x.example'' WHERE id=%L',(:'l2'::jsonb)->>'link_id'),'immutable'),
  'links are never deleted or rewritten');
SELECT t_assert(NOT has_function_privilege('anon','record_work_order_part_product(uuid,text,text,text,text,text,text,text,timestamptz)','EXECUTE')
  AND NOT has_function_privilege('authenticated','record_work_order_part_product(uuid,text,text,text,text,text,text,text,timestamptz)','EXECUTE')
  AND NOT has_function_privilege('authenticated','work_order_part_product_card(uuid)','EXECUTE')
  AND NOT has_table_privilege('anon','work_order_part_products','SELECT')
  AND NOT has_table_privilege('authenticated','work_order_part_products','SELECT'),'grants: writer and table are service-only');
