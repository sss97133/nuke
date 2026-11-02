-- Synthetic canonical replay: current workload, party masking and distinct money/time states.
\ir test_work_order_retained_sources.sql
BEGIN;
SELECT set_config('test.auth_uid','11000000-0000-0000-0000-000000000002',true);
UPDATE public.work_orders SET estimated_hours=11.5,actual_hours=9,currency='USD',estimated_total=1200,
 updated_at='2026-10-29',customer_name='Private Client' WHERE id='31000000-0000-0000-0000-000000000001';
INSERT INTO public.work_order_payments(id,work_order_id,status,amount,payment_date) VALUES
 ('91000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000001','completed',300,'2026-10-01'),
 ('91000000-0000-0000-0000-000000000002','31000000-0000-0000-0000-000000000001','pending',900,'2026-10-02');
INSERT INTO public.work_order_parts(id,work_order_id,part_name,status) VALUES
 ('92000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000001','Part one','quoted');
SELECT t_assert(public.work_order_list_row('31000000-0000-0000-0000-000000000001',ARRAY['customer'])#>>'{workload,disposition}'='current',
 'paid job remains current even with a legacy billing completed_at');
SELECT t_assert(public.work_order_list_row('31000000-0000-0000-0000-000000000001',ARRAY['customer'])#>>'{workload,money,received}'='300',
 'received is completed payment records only, never estimate, pending payment or actual job cost');
SELECT t_assert(public.work_order_list_row('31000000-0000-0000-0000-000000000001',ARRAY['admin','vehicle_access'])#>'{workload,money}'='{"visibility":"withheld"}'::jsonb
 AND public.work_order_list_row('31000000-0000-0000-0000-000000000001',ARRAY['admin','vehicle_access'])#>>'{workload,client}' IS NULL,
 'admin and vehicle access do not disclose private client or payment amounts');
SELECT t_assert(public.work_order_list_row('31000000-0000-0000-0000-000000000001',ARRAY['customer'])#>>'{workload,parts,states,quoted}'='1'
 AND public.work_order_list_row('31000000-0000-0000-0000-000000000001',ARRAY['customer'])#>'{workload,parts,states}'->'ready_to_order' IS NULL,
 'quoted parts are not silently ready to order or on hand');
UPDATE public.work_orders SET status='completed',completed_at='2026-04-01' WHERE id='31000000-0000-0000-0000-000000000002';
SELECT t_assert(public.work_order_list_row('31000000-0000-0000-0000-000000000002',ARRAY['customer'])#>>'{workload,disposition}'='history',
 'completed work is available in history, not current workload');
SELECT t_assert(public.work_order_list_row('31000000-0000-0000-0000-000000000002',ARRAY['customer'])#>>'{workload,money,received}' IS NULL
 AND public.work_order_list_row('31000000-0000-0000-0000-000000000002',ARRAY['customer'])#>>'{workload,time,remaining_hours}' IS NULL,
 'no payment evidence is unknown, not zero; estimated minus billed hours is not remaining work');
SELECT set_config('test.auth_uid','11000000-0000-0000-0000-000000000001',true);
SELECT t_assert(EXISTS(SELECT 1 FROM jsonb_array_elements(public.my_work_orders()->'rows') r
 WHERE r->>'work_order_id'='31000000-0000-0000-0000-000000000002' AND r#>>'{workload,disposition}'='history'),
 'existing authorized list RPC carries workload fields through to the consumer');
SELECT t_assert(NOT has_function_privilege('authenticated','public.work_order_list_row(uuid,text[])','EXECUTE')
 AND NOT has_function_privilege('anon','public.work_order_list_row(uuid,text[])','EXECUTE'),
 'caller cannot forge the slot array of this internal helper');
SELECT set_config('test.auth_uid','',true);
SELECT t_assert(public.work_order_list_row('31000000-0000-0000-0000-000000000001','{}')#>>'{workload}' IS NULL,
 'public vehicle job lists do not acquire private operational context');
ROLLBACK;
