-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations (the job-loop replay applies 20261022013000).
-- Parts by job: approve_job_part_listing (the Sign), its part_alternatives approval rows and guard, and the two readers.
\ir test_work_order_part_product_read.sql
ALTER TABLE public.work_order_parts ADD COLUMN IF NOT EXISTS added_by uuid;   -- live column the Sign writes (subset fixture lacks it)
-- As live: deleting a part line cascades to its offers (so the guard, not the key, must keep an approval).
ALTER TABLE public.part_alternatives DROP CONSTRAINT part_alternatives_work_order_part_id_fkey,
  ADD CONSTRAINT part_alternatives_work_order_part_id_fkey FOREIGN KEY (work_order_part_id) REFERENCES public.work_order_parts(id) ON DELETE CASCADE;

-- WO9: an open job on the public vehicle 1, customer C, shop O's organization.
UPDATE vehicles SET is_public = true WHERE id = '40000000-0000-0000-0000-000000000001';
INSERT INTO work_orders(id,vehicle_id,customer_id,organization_id,title,description,status) VALUES
 ('30000000-0000-0000-0000-000000000009','40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000c',
  '20000000-0000-0000-0000-000000000001','Fuel system','- Replace fuel pump','in_progress');
CREATE FUNCTION public.lst(p_item text, p_ago interval DEFAULT interval '5 minutes', p_extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('marketplace','ebay','item_id',p_item,'item_url','https://www.ebay.com/itm/'||p_item||'?fits=Year%3A1977%7CMake%3AChevrolet',
    'title','Mechanical Fuel Pump (fixture)','price',23.59,'currency','USD','shipping',0,'shipping_basis','free','condition','New','condition_id','1000',
    'fit','exact','fit_properties',jsonb_build_array(jsonb_build_object('name','Year','value','1977')),'fit_note','eBay checks fit on Year, Make',
    'rank',1,'why',jsonb_build_array('Exact fit','lowest delivered'),'seller',jsonb_build_object('username','fixture_seller'),
    'seller_feedback_percentage',99.9,'seller_feedback_score',63715,'observed_at',now() - p_ago) || p_extra $$;
CREATE FUNCTION public.appr(p_listing jsonb, p_reason text, p_part uuid DEFAULT NULL, p_name text DEFAULT 'fuel pump',
  p_wo uuid DEFAULT '30000000-0000-0000-0000-000000000009') RETURNS jsonb
 LANGUAGE sql AS $$ SELECT approve_job_part_listing(p_wo, p_listing, p_reason, p_part, CASE WHEN p_part IS NULL THEN p_name END, NULL, 1) $$;
CREATE FUNCTION public.opr(p uuid DEFAULT '30000000-0000-0000-0000-000000000009') RETURNS jsonb LANGUAGE sql AS $$ SELECT work_order_operations_read(p) $$;
GRANT EXECUTE ON FUNCTION public.lst(text,interval,jsonb), public.appr(jsonb,text,uuid,text,uuid), public.opr(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ppr(uuid) TO anon, authenticated;

SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT t_assert(t_refused_with($q$SELECT appr(lst('157375338850'),'cheapest exact fit')$q$,'unavailable for part approval'),'a stranger cannot approve');
SELECT as_user(NULL);
SELECT t_assert(t_refused_with($q$SELECT appr(lst('157375338850'),'cheapest exact fit')$q$,'Authentication required'),'anonymous cannot approve');
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT t_assert(t_refused_with($q$SELECT appr(lst('157375338850', interval '3 hours'),'cheapest')$q$,'more than two hours ago'),'a listing read 3 h ago is refused');
SELECT t_assert(t_refused_with($q$SELECT appr(lst('157375338850', interval '1 minute', '{"item_url":"https://evil.example.invalid/itm/157375338850"}'),'x')$q$,'eBay item page'),'a link that is not the item page is refused');
SELECT t_assert(t_refused_with($q$SELECT appr(lst('157375338850', interval '1 minute', '{"fit":"fits"}'),'x')$q$,'exact, possible or unknown'),'fit must be eBay''s verdict');
SELECT t_assert(t_refused_with($q$SELECT appr(lst('157375338850'),'  ')$q$,'Say why'),'an approval needs its reason');
SELECT t_assert(t_refused_with($q$SELECT appr(lst('157375338850'),'x',NULL,'fuel pump','30000000-0000-0000-0000-000000000002')$q$,'unavailable for part approval'),'not a party on another job');
RESET ROLE;
SELECT count(*) AS obs0 FROM vehicle_observations \gset

SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT appr(lst('157375338850'),'Cheapest exact fit, Delphi, new') AS a1 \gset
SELECT appr(lst('157375338850'),'Cheapest exact fit, Delphi, new') AS a1dup \gset
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT appr(lst('306697039583'),'Backup if the first sells out',NULL,'Fuel Pump') AS a2 \gset
SELECT appr(lst('157375338850'),'Shop owner confirms the Delphi',((:'a1'::jsonb)->>'work_order_part_id')::uuid) AS a3 \gset
RESET ROLE;
SELECT t_assert((:'a1'::jsonb) @> '{"part_line_created":true,"approver_role":"customer","item_id":"157375338850","duplicate":false,"ordered":false,"payment_authorized":false}'
 AND (:'a1dup'::jsonb) @> '{"duplicate":true}' AND (:'a1dup'::jsonb)->>'approval_id' = (:'a1'::jsonb)->>'approval_id',
 'the customer approves a listing; the part line is added to the job; a replay is the same approval');
SELECT t_assert((:'a2'::jsonb) @> '{"part_line_created":false,"approver_role":"organization_owner"}'
 AND (:'a2'::jsonb)->>'work_order_part_id' = (:'a1'::jsonb)->>'work_order_part_id', 'the shop owner adds a second listing to the same line, found by its name');
SELECT t_assert((:'a3'::jsonb)->>'superseded' = (:'a1'::jsonb)->>'approval_id', 'approving the same item again supersedes the earlier approval');
SELECT t_assert((SELECT count(*) FROM vehicle_observations) = (:'obs0')::bigint + 3, 'three signed work records (the replay writes none)');
SELECT t_assert(EXISTS (SELECT 1 FROM work_order_parts p WHERE p.id = ((:'a1'::jsonb)->>'work_order_part_id')::uuid AND p.part_name = 'fuel pump'
   AND p.status = 'quoted' AND p.added_by = '10000000-0000-0000-0000-00000000000c' AND p.quantity = 1), 'the added part line: quoted, added by the signer');
SELECT t_assert(EXISTS (SELECT 1 FROM vehicle_observations o WHERE o.id = (SELECT approval_observation_id FROM part_alternatives WHERE id = ((:'a1'::jsonb)->>'approval_id')::uuid)
   AND o.kind = 'work_record' AND o.extraction_method = 'work_order_part_listing_approval_sign_v1' AND o.submitted_by_user_id = '10000000-0000-0000-0000-00000000000c'
   AND o.structured_data #>> '{work_order_part_listing_approval,reason}' = 'Cheapest exact fit, Delphi, new'), 'source: the owner-input work record with the reason');
SELECT t_assert((SELECT listing FROM part_alternatives WHERE id = ((:'a1'::jsonb)->>'approval_id')::uuid) ?& ARRAY['item_id','item_url','price','fit','observed_at','why']
   AND NOT (SELECT listing FROM part_alternatives WHERE id = ((:'a1'::jsonb)->>'approval_id')::uuid) ? 'seller'
   AND (SELECT (listing->>'total')::numeric FROM part_alternatives WHERE id = ((:'a1'::jsonb)->>'approval_id')::uuid) = 23.59,
   'the stored listing keeps what the finder showed, computes the total, and drops the seller''s username');
SELECT t_assert((SELECT superseded_by FROM part_alternatives WHERE id = ((:'a1'::jsonb)->>'approval_id')::uuid) = ((:'a3'::jsonb)->>'approval_id')::uuid
   AND (SELECT retailer = 'eBay' AND is_selected AND brand IS NULL FROM part_alternatives WHERE id = ((:'a3'::jsonb)->>'approval_id')::uuid), 'superseded once; the new row is an eBay offer, selected');

-- Readers: anyone on a public vehicle sees the approved listings and the approver's role; reasons go to parties only.
SET ROLE anon;
SELECT as_user(NULL);
SELECT opr() AS r_anon \gset
SELECT ppr(((:'a1'::jsonb)->>'work_order_part_id')::uuid) AS p_anon \gset
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT opr() AS r_cust \gset
SELECT ppr(((:'a1'::jsonb)->>'work_order_part_id')::uuid) AS p_cust \gset
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT opr() AS r_stranger \gset
RESET ROLE;
SELECT t_assert(jsonb_array_length((:'r_anon'::jsonb)#>'{parts,0,approved_listings}') = 2
   AND NOT ((:'r_anon'::jsonb)#>'{parts,0,approved_listings,0}') ? 'reason'
   AND (:'r_anon'::jsonb)#>'{parts,0,approved_listings}' @> '[{"approver_role":"organization_owner","listing":{"item_id":"157375338850"}}]'
   AND (:'r_anon'::jsonb)#>>'{part_approval,approver_role}' IS NULL, 'visitor: two current approvals, roles not people, no reasons, cannot approve');
SELECT t_assert((:'r_cust'::jsonb)#>'{parts,0,approved_listings}' @> '[{"reason":"Shop owner confirms the Delphi"}]'
   AND (:'r_cust'::jsonb)#>>'{part_approval,approver_role}' = 'customer' AND (:'r_stranger'::jsonb)#>>'{part_approval,approver_role}' IS NULL,
   'the customer reads the reasons and may approve; a signed-in stranger may not');
SELECT t_assert(jsonb_array_length((:'p_anon'::jsonb)->'offers') = 2
   AND (:'p_anon'::jsonb)->'offers' @> '[{"retailer":"eBay","is_selected":true,"approval":{"approver_role":"customer"}}]' = false
   AND (:'p_anon'::jsonb)->'offers' @> '[{"retailer":"eBay","approval":{"approver_role":"organization_owner"}}]'
   AND NOT ((:'p_anon'::jsonb)#>'{offers,0}') ? 'approval_reason'
   AND (:'p_cust'::jsonb)->'offers' @> '[{"approval_reason":"Backup if the first sells out"}]',
   'part reader: superseded approvals leave the offers; the approval reason to parties only');
SELECT t_assert((:'p_anon'::jsonb) IS NOT NULL AND (SELECT count(*) FROM jsonb_array_elements((SELECT ppr('d0000000-0000-0000-0000-000000000001'))->'offers')) = 2,
  'legacy offers are unchanged');

-- The guard: approvals are never edited, deleted or cascaded away; legacy offers stay editable.
SELECT t_assert(t_refused_with(format($q$UPDATE part_alternatives SET price = 1 WHERE id = %L$q$, (:'a3'::jsonb)->>'approval_id'),'immutable'),'an approval''s price cannot be edited');
SELECT t_assert(t_refused_with(format($q$DELETE FROM part_alternatives WHERE id = %L$q$, (:'a3'::jsonb)->>'approval_id'),'kept'),'an approval cannot be deleted');
SELECT t_assert(t_refused_with(format($q$DELETE FROM work_order_parts WHERE id = %L$q$, (:'a1'::jsonb)->>'work_order_part_id'),'kept'),'a part line holding an approval cannot be deleted');
SELECT t_assert(t_refused_with($q$UPDATE part_alternatives SET listing = '{"item_id":"1"}' WHERE id = 'c7000000-0000-0000-0000-000000000001'$q$,'only by approve_job_part_listing'),'a legacy offer cannot be turned into an approval');
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,source_identifier,content_hash,extraction_method,submitted_by_user_id,observed_at)
VALUES ('7a000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000002',
  'fixture-other-sign','fixture-other-sign','some_other_sign_v1','10000000-0000-0000-0000-00000000000c',now());
SELECT t_assert(t_refused_with($q$INSERT INTO part_alternatives(work_order_part_id,retailer,price,approval_observation_id,approved_by_user_id,approver_role,approved_at,approval_reason,listing)
  VALUES ('d0000000-0000-0000-0000-000000000001','eBay',1,'7a000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000c','customer',now(),'x','{}')$q$,
  'only by approve_job_part_listing'),'an approval row needs its own signed source');
UPDATE part_alternatives SET notes = 'still editable' WHERE id = 'c7000000-0000-0000-0000-000000000001';
SELECT t_assert((SELECT notes FROM part_alternatives WHERE id = 'c7000000-0000-0000-0000-000000000001') = 'still editable', 'legacy offers stay editable');

-- A closed job takes no approvals.
UPDATE work_orders SET status = 'completed' WHERE id = '30000000-0000-0000-0000-000000000009';
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT t_assert(t_refused_with($q$SELECT appr(lst('306697039583'),'late')$q$,'parts are approved on open jobs'),'a completed job takes no approvals');
RESET ROLE;
