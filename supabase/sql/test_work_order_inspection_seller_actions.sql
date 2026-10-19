-- Disposable PG17 only. Builds the job loop through the golden path (story 1: the seller e1 granted the inspection
-- e7... :'iw'), then applies the seller-actions migration and checks who is offered grant_inspection_access.
\set ON_ERROR_STOP on
\ir test_job_loop_golden_path.sql
\ir ../migrations/20261020020000_work_order_inspection_seller_actions.sql

CREATE FUNCTION public.ins_actions(p_wo uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT work_order_inspection_read(p_wo)#>'{viewer,actions}' $$;
GRANT EXECUTE ON FUNCTION public.ins_actions(uuid) TO anon, authenticated;
SELECT parent_work_order_id AS parent FROM work_orders WHERE id = :'iw' \gset

SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000e1');
SELECT t_assert(NOT ins_actions(:'iw') @> '[{"action":"grant_inspection_access"}]','granted permission offers no grant step');
RESET ROLE;

UPDATE vehicle_observations SET is_superseded = true WHERE source_identifier = 'inspection_access:' || :'iw';

SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000e1');
SELECT t_assert(ins_actions(:'iw') @> jsonb_build_array(jsonb_build_object('action','grant_inspection_access','rpc','grant_inspection_access',
  'permission_state','not_established','args',jsonb_build_object('p_inspection_work_order_id',:'iw'))),'verified owner is offered grant_inspection_access');
SELECT t_assert(:'parent' = '' OR ins_actions(:'parent'::uuid) @> '[{"action":"grant_inspection_access"}]','the parent job lists the same step');
SELECT t_as('e7000000-0000-0000-0000-000000000099');
SELECT t_assert(NOT COALESCE(ins_actions(:'iw'),'[]') @> '[{"action":"grant_inspection_access"}]','a stranger is not offered the step');
SELECT t_as('e7000000-0000-0000-0000-0000000000c1');
SELECT t_assert(NOT COALESCE(ins_actions(:'iw'),'[]') @> '[{"action":"grant_inspection_access"}]','the client who ordered it is not offered the step');
RESET ROLE;
SELECT t_assert(t_refused($q$SET ROLE anon; SELECT inspection_seller_actions('e7000000-0000-0000-0000-0000000000e1','e7400000-0000-0000-0000-000000000001')$q$),'anonymous cannot call the action list');
RESET ROLE;

SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000e1');
SELECT ((ins_actions(:'iw')->0)#>>'{args,p_inspection_work_order_id}')::uuid AS offered \gset
SELECT grant_inspection_access(:'offered','Inspect at the seller lot again',jsonb_build_object('from',now(),'until',now()+interval '7 days')) AS ga2 \gset
SELECT t_assert((:'ga2'::jsonb)::text ~ 'established' AND NOT ins_actions(:'iw') @> '[{"action":"grant_inspection_access"}]','signing the offered step establishes permission and removes it');
RESET ROLE;
