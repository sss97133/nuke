-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations.
-- The open evidence reader withholds personal operation text from non-parties, as work_order_operations_read does.
\ir test_job_evidence_attach.sql
\ir ../migrations/20261020041500_work_order_evidence_operation_redaction.sql

SET ROLE anon;
SELECT as_user(NULL);
SELECT evr() #> '{attachments}' AS plain_anon \gset
RESET ROLE;
SELECT t_assert((:'plain_anon'::jsonb) @> jsonb_build_array(jsonb_build_object('operation',
   jsonb_build_object('operation_id',:'op1','task_description','Fabricate stainless exhaust')))
 AND NOT :'plain_anon' ~ 'task_description_visibility','anon: non-personal operation text still shown, no visibility marker');

-- Sourced operation text is immutable, so the customer is renamed to a word the operation already uses.
UPDATE work_orders SET customer_name='Stainless Customer' WHERE id='30000000-0000-0000-0000-000000000001';
SET ROLE anon;
SELECT as_user(NULL);
SELECT evr() #> '{attachments}' AS pa \gset
RESET ROLE;
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT evr() #> '{attachments}' AS ps \gset
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT evr() #> '{attachments}' AS pc \gset
RESET ROLE;
SELECT t_assert((:'pa'::jsonb) @> jsonb_build_array(jsonb_build_object('operation',
   jsonb_build_object('operation_id',:'op1','task_description',NULL,'task_description_visibility','withheld_personal_info')))
 AND NOT :'pa' ~* 'stainless','anon: personal operation text withheld and marked; operation id kept');
SELECT t_assert((:'ps'::jsonb) @> jsonb_build_array(jsonb_build_object('operation',
   jsonb_build_object('task_description',NULL,'task_description_visibility','withheld_personal_info')))
 AND NOT :'ps' ~* 'stainless','signed-in stranger: personal operation text withheld');
SELECT t_assert((:'pc'::jsonb) @> jsonb_build_array(jsonb_build_object('operation',
   jsonb_build_object('operation_id',:'op1','task_description','Fabricate stainless exhaust')))
 AND NOT :'pc' ~ 'task_description_visibility','customer (party): full operation text');
SELECT t_assert(has_function_privilege('anon','work_order_evidence_read(uuid)','EXECUTE')
 AND (SELECT prosecdef FROM pg_proc WHERE oid='public.work_order_evidence_read(uuid)'::regprocedure),'reader stays open and security definer');
