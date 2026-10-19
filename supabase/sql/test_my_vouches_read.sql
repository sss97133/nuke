-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations (chained on the job-loop replay).
-- my_vouches_read and is_mine/withdraw action on provider_profile_read vouched_for_by.
\ir test_job_loop_replay.sql

CREATE FUNCTION public.as_user(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.auth_uid',COALESCE(p::text,''),false) $$;
GRANT EXECUTE ON FUNCTION public.as_user(uuid) TO anon, authenticated, service_role;
INSERT INTO profiles(id,username,is_public) VALUES ('10000000-0000-0000-0000-00000000000f','fab_pro',true),('10000000-0000-0000-0000-00000000000e','shop_owner',true)
 ON CONFLICT (id) DO UPDATE SET is_public = true, username = EXCLUDED.username;
INSERT INTO organization_contributors(organization_id,user_id,role,status) VALUES ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000d','technician','active');
CREATE FUNCTION public.vb() RETURNS jsonb LANGUAGE sql AS $$ SELECT provider_profile_read('10000000-0000-0000-0000-00000000000f',NULL)->'vouched_for_by' $$;
GRANT EXECUTE ON FUNCTION public.vb() TO anon, authenticated;

SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT vouch_for_provider('10000000-0000-0000-0000-00000000000f',NULL,ARRAY['supervision','permission'],'Works in our lift bay under supervision',now() + interval '30 days') AS v1 \gset
SELECT my_vouches_read() AS m1 \gset
SELECT vb() AS pv_owner \gset
SELECT as_user('10000000-0000-0000-0000-00000000000d');
SELECT vb() AS pv_member \gset
SELECT t_assert(my_vouches_read()->'items' @> jsonb_build_array(jsonb_build_object('vouch_id',(:'v1'::jsonb)->>'vouch_id','signed_by_me',false,'status','active')),
 'a co-member of the vouching organization sees the vouch as one they can manage');
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT vb() AS pv_stranger \gset
SELECT t_assert(my_vouches_read()->'items' = '[]'::jsonb,'a stranger has no vouches');
RESET ROLE;
SET ROLE anon;
SELECT as_user(NULL);
SELECT vb() AS pv_anon \gset
SELECT t_assert(t_refused('SELECT my_vouches_read()'),'anon refused');
RESET ROLE;
SELECT t_assert((:'m1'::jsonb)->'items' @> jsonb_build_array(jsonb_build_object('vouch_id',(:'v1'::jsonb)->>'vouch_id','status','active','signed_by_me',true,
   'kinds',jsonb_build_array('permission','supervision'),'scope','Works in our lift bay under supervision',
   'subject',jsonb_build_object('handle','fab_pro','subject_kind','account'),
   'actions',jsonb_build_array(jsonb_build_object('action','withdraw_vouch','args',jsonb_build_object('p_id',(:'v1'::jsonb)->>'vouch_id'))))),
 'voucher: my vouch with subject handle, kinds, scope, status and withdraw action');
SELECT t_assert((:'pv_owner'::jsonb)->'items'->0 @> jsonb_build_object('is_mine',true,'actions',jsonb_build_array(jsonb_build_object('action','withdraw_vouch')))
 AND (:'pv_member'::jsonb)->'items'->0 @> '{"is_mine":true}'
 AND (:'pv_stranger'::jsonb)->'items'->0 @> '{"is_mine":false,"actions":[]}'
 AND (:'pv_anon'::jsonb)->'items'->0 @> '{"is_mine":false,"actions":[]}','profile vouched_for_by: is_mine and the withdraw action only for those who can withdraw');
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT withdraw_vouch(((:'m1'::jsonb)#>>'{items,0,actions,0,args,p_id}')::uuid);
SELECT t_assert(my_vouches_read()->'items'->0 @> '{"status":"withdrawn","actions":[]}' AND vb()->'items' = '[]'::jsonb,'withdrawn through the action: status withdrawn, gone from the profile');
RESET ROLE;
SELECT t_assert(has_function_privilege('authenticated','my_vouches_read()','EXECUTE') AND NOT has_function_privilege('anon','my_vouches_read()','EXECUTE')
 AND (SELECT count(*) FROM regexp_matches(pg_get_functiondef('provider_profile_read(uuid,uuid)'::regprocedure),'provider_vouches_for_viewer','g'))=1,'grants; one decoration call');
