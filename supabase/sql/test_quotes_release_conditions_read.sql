-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations (chained on the job-loop replay).
-- work_order_quotes_read: release_conditions on quotes, the top-level block, and the issue_quote arg hint.
\ir test_job_loop_replay.sql

CREATE FUNCTION public.as_user(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.auth_uid',COALESCE(p::text,''),false) $$;
GRANT EXECUTE ON FUNCTION public.as_user(uuid) TO anon, authenticated, service_role;
UPDATE vehicles SET is_public = true WHERE id = '40000000-0000-0000-0000-000000000001';
CREATE FUNCTION public.qr() RETURNS jsonb LANGUAGE sql AS $$ SELECT work_order_quotes_read('30000000-0000-0000-0000-000000000001') $$;
GRANT EXECUTE ON FUNCTION public.qr() TO anon, authenticated;

SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT qr()#>'{viewer,issuer_actions}' AS ia0 \gset
SELECT issue_work_order_quote('30000000-0000-0000-0000-000000000001',
  '[{"ref_kind":"labor","ref_id":"e0000000-0000-0000-0000-000000000001","description":"Fabrication labor","pricing_basis":"day_rate","amount":200,"currency":"USD","unit":"day","quantity":2}]',
  NULL,NULL,NULL,'["customer_completion_sign",{"kind":"days_signed","days":7}]') AS q1 \gset
RESET ROLE;
SET ROLE anon;
SELECT as_user(NULL);
SELECT qr() AS a1 \gset
RESET ROLE;
SELECT t_assert((:'ia0'::jsonb) @> '[{"action":"issue_quote","rpc":"issue_work_order_quote","args":{"p_work_order_id":"30000000-0000-0000-0000-000000000001","p_release_conditions":null}}]'
 AND (:'ia0'::jsonb)->0->'release_conditions_vocabulary' @> '["customer_completion_sign","inspector_attestation","installed_parts_witness","photos_in_window"]',
 'issuer: issue_quote with the release-conditions hint and vocabulary');
SELECT t_assert((:'a1'::jsonb)#>'{current_quote,release_conditions}' = '[{"kind":"customer_completion_sign"},{"kind":"days_signed","days":7}]'::jsonb
 AND (:'a1'::jsonb)->'release_conditions' @> '{"declared_by":"platform_standard","accepted":null}'
 AND (:'a1'::jsonb)#>'{release_conditions,current}' = '[{"kind":"customer_completion_sign"},{"kind":"days_signed","days":7}]'::jsonb
 AND (:'a1'::jsonb)#>'{viewer,issuer_actions}' = '[]'::jsonb,
 'anon: declared terms open on the current quote; not yet accepted, so the platform standard applies; no issuer actions');
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT accept_work_order_quote(((:'q1'::jsonb)->>'quote_id')::uuid,(:'q1'::jsonb)->>'quote_hash');
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT qr() AS o2 \gset
RESET ROLE;
SELECT t_assert((:'o2'::jsonb)->'release_conditions' @> '{"declared_by":"accepted_quote"}'
 AND (:'o2'::jsonb)#>'{release_conditions,accepted}' = '[{"kind":"customer_completion_sign"},{"kind":"days_signed","days":7}]'::jsonb
 AND NOT (:'o2'::jsonb)#>'{viewer,issuer_actions}' @> '[{"action":"issue_quote"}]'
 AND (:'o2'::jsonb)#>'{viewer,issuer_actions}' @> '[{"action":"issue_change_order"}]',
 'accepted: terms declared by the accepted quote; issuing moves to change orders');
SELECT t_assert(NOT has_function_privilege('authenticated','work_order_quote_issue_action(uuid,uuid,uuid,text,uuid)','EXECUTE')
 AND (SELECT count(*) FROM regexp_matches(pg_get_functiondef('work_order_quotes_read(uuid)'::regprocedure),'work_order_quote_release_conditions','g'))=5,
 'helpers internal; four anchored edits in the reader');
