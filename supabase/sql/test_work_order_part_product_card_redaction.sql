-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations (20261020191500 is applied by the job-loop replay).
-- The operations reader withholds a part's product card from non-parties when the part's name or brand is withheld.
\ir test_work_order_part_product_matches.sql

SET ROLE anon;
SELECT as_user(NULL);
SELECT opr() AS before_anon \gset
RESET ROLE;
SELECT t_assert((:'before_anon'::jsonb)#>>'{parts,0,product,image_url}' IS NOT NULL
  AND (:'before_anon'::jsonb)#>'{parts,0,product_visibility}' = 'null'::jsonb,'nothing withheld: visitors keep the product card');

-- The customer's name now matches a word in the part name, so the part name is withheld from visitors.
UPDATE work_orders SET customer_name = 'Mandrel Customer' WHERE id = '30000000-0000-0000-0000-000000000001';
SET ROLE anon;
SELECT as_user(NULL);
SELECT opr() AS a \gset
RESET ROLE;
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT opr() AS c \gset
RESET ROLE;
SELECT t_assert((:'a'::jsonb)->'parts' @> '[{"id":"d0000000-0000-0000-0000-000000000001","part_name":null,"part_name_visibility":"withheld_personal_info","product":null,"product_visibility":"withheld_personal_info"}]'
  AND NOT :'a' ~* '(mandrel|img\.example)','visitor: withheld part name also withholds its product card');
SELECT t_assert((:'c'::jsonb)#>>'{parts,0,product,image_url}' IS NOT NULL AND (:'c'::jsonb)#>'{parts,0,product_visibility}' = 'null'::jsonb,
  'customer (party): product card shown');
