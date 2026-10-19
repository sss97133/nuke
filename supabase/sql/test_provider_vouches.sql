-- Disposable PG17 only. Proves 20261019211500_provider_vouches.sql: standing vouches (vouch_for_provider / withdraw_vouch)
-- shown on provider_profile_read as vouched_for_by (never under capabilities), and tools.co_signed counting authenticated
-- co-sign attestations (cosign_provider).
-- Fixture and prior state: the contact-broker contract chain, then the offer acceptance and co-sign migrations.
\set ON_ERROR_STOP on
\ir test_contact_broker.sql
-- Live work_order_assignments columns the chain fixture omits.
ALTER TABLE public.work_order_assignments ADD COLUMN technician_id uuid NOT NULL DEFAULT gen_random_uuid(), ADD COLUMN job_op_code text,
  ADD COLUMN role text DEFAULT 'lead' CHECK (role = ANY (ARRAY['lead','technician','helper'])), ADD COLUMN offered_at timestamptz,
  ADD COLUMN declined_at timestamptz, ADD COLUMN payout_type text DEFAULT 'flat' CHECK (payout_type = ANY (ARRAY['flat','hourly','percentage'])),
  ADD COLUMN payout_rate numeric, ADD COLUMN payout_percentage numeric, ADD COLUMN created_at timestamptz DEFAULT now(),
  ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE public.work_order_assignments ALTER COLUMN technician_id DROP DEFAULT;
ALTER TABLE public.vehicle_observations ALTER COLUMN id SET DEFAULT gen_random_uuid(), ADD COLUMN source_identifier text,
  ADD COLUMN content_hash text, ADD COLUMN observed_at_basis text, ADD COLUMN source_event_at timestamptz,
  ADD COLUMN source_event_time_precision text, ADD COLUMN observer_raw jsonb, ADD COLUMN confidence text, ADD COLUMN superseded_by uuid,
  ADD COLUMN superseded_at timestamptz, ADD COLUMN lineage_chain uuid[], ADD UNIQUE (source_id, source_identifier, kind, content_hash);
\ir ../migrations/20261019182000_work_order_offer_acceptance.sql
\ir ../migrations/20261019210000_work_order_cosign.sql
\ir ../migrations/20261019211500_provider_vouches.sql

-- Parties: 6 fixture_tech (subject; member of Fixture Shop; evidenced actor f1), 4 owner of Fixture Shop,
-- 3 signed-in stranger, 2 customer.
CREATE FUNCTION public.t_refused_with(q text, needle text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN strpos(SQLERRM, needle) > 0; END $$;
GRANT EXECUTE ON FUNCTION public.t_refused_with(text,text) TO anon, authenticated;
CREATE FUNCTION public.t_vouch(p_user uuid, p_actor uuid, p_kinds text[], p_scope text, p_exp timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$ SELECT vouch_for_provider(p_user, p_actor, p_kinds, p_scope, p_exp) $$;
GRANT EXECUTE ON FUNCTION public.t_vouch(uuid,uuid,text[],text,timestamptz) TO anon, authenticated;
SELECT (SELECT provider_profile_read('00000000-0000-0000-0000-000000000006')->'capabilities')::text AS caps0 \gset

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT t_assert(t_refused($q$SELECT t_vouch('00000000-0000-0000-0000-000000000006',NULL,ARRAY['supervision'],'Shop floor')$q$),'anon cannot vouch');
SELECT t_assert(provider_profile_read('00000000-0000-0000-0000-000000000006') @> '{"vouched_for_by":{"items":[]},"tools":{"co_signed":{"authenticated_attestations":0}}}',
  'no vouches yet; no authenticated co-signs');
RESET ROLE;

SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000006');
SELECT t_assert(t_refused_with($q$SELECT t_vouch('00000000-0000-0000-0000-000000000006',NULL,ARRAY['supervision'],'Me')$q$,'oneself')
  AND t_refused_with($q$SELECT t_vouch(NULL,'a0000000-0000-0000-0000-0000000000f1',ARRAY['supervision'],'My actor')$q$,'oneself'),
  'no vouching for oneself or one''s evidenced actor');
SELECT t_as('00000000-0000-0000-0000-000000000003');
SELECT t_assert(t_refused_with($q$SELECT t_vouch('00000000-0000-0000-0000-000000000006',NULL,ARRAY['supervision'],'Shop floor')$q$,'needs_facility_organization_or_owned_tools'),
  'no facility, no tools: refused');
SELECT t_as('00000000-0000-0000-0000-000000000004');
SELECT t_assert(t_refused_with($q$SELECT t_vouch('00000000-0000-0000-0000-000000000006',NULL,ARRAY['skill'],'x')$q$,'Kinds must be')
  AND t_refused_with($q$SELECT t_vouch('00000000-0000-0000-0000-000000000006',NULL,ARRAY['supervision'],' ')$q$,'Scope')
  AND t_refused_with($q$SELECT t_vouch('00000000-0000-0000-0000-000000000006',NULL,ARRAY['supervision'],'x','2020-01-01')$q$,'future')
  AND t_refused_with($q$SELECT t_vouch('00000000-0000-0000-0000-000000000006','a0000000-0000-0000-0000-0000000000f1',ARRAY['supervision'],'x')$q$,'Exactly one'),
  'kinds, scope, expiry and one subject validated');
CREATE TEMP TABLE vv1 AS SELECT t_vouch('00000000-0000-0000-0000-000000000006',NULL,ARRAY['supervision','permission'],'Works unsupervised on our lifts','2099-01-01') j;
GRANT SELECT ON vv1 TO PUBLIC;
SELECT t_assert((SELECT j @> '{"voucher":{"kind":"organization","organization_id":"0a000000-0000-0000-0000-000000000001"},"kinds":["permission","supervision"],
  "duplicate":false,"skill_evidence":false,"subject_notified":false}' FROM vv1),'single-organization owner vouches for the organization');
SELECT t_assert((t_vouch('00000000-0000-0000-0000-000000000006',NULL,ARRAY['permission','supervision'],'Works unsupervised on our lifts','2099-01-01')->>'duplicate')::boolean,
  'identical repeat is a duplicate');
RESET ROLE;
INSERT INTO public.user_tools(id,user_id,category) VALUES ('70000000-0000-0000-0000-000000000033','00000000-0000-0000-0000-000000000003','lifts');
SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000003');
CREATE TEMP TABLE vv2 AS SELECT t_vouch(NULL,'a0000000-0000-0000-0000-0000000000f1',ARRAY['availability'],'Can use my TIG welder weekends') j;
GRANT SELECT ON vv2 TO PUBLIC;
SELECT t_assert((SELECT j @> '{"voucher":{"kind":"user","user_id":"00000000-0000-0000-0000-000000000003"},"subject":{"actor_id":"a0000000-0000-0000-0000-0000000000f1"}}' FROM vv2),
  'tool owner vouches for a work actor as itself');
RESET ROLE;

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
CREATE TEMP TABLE pv1 AS SELECT provider_profile_read('00000000-0000-0000-0000-000000000006') j;
SELECT t_assert((SELECT j->'vouched_for_by'->'items' @> '[{"voucher":{"kind":"organization","name":"Fixture Shop"},"kinds":["permission","supervision"],
    "scope":"Works unsupervised on our lifts","subject":"account","attribution":"authenticated_sign"},{"kinds":["availability"],"subject":"work_actor"}]'
  AND jsonb_array_length(j#>'{vouched_for_by,items}')=2 FROM pv1),'profile: vouched_for_by lists the organization and the actor vouch');
SELECT t_assert((SELECT (j->'capabilities')::text = :'caps0' AND NOT (j->'capabilities')::text ~ '(vouch|Works unsupervised)' FROM pv1),
  'capabilities unchanged by vouches');
SELECT t_assert((SELECT NOT j::text ~ '(00000000-0000-0000-0000-000000000003|00000000-0000-0000-0000-000000000004)' AND NOT t_contact_pii(j) FROM pv1),
  'no raw voucher ids or personal fields');
SELECT t_assert(provider_profile_read(NULL,'a0000000-0000-0000-0000-0000000000f1') @> '{"vouched_for_by":{"items":[{"kinds":["availability"]}]}}'
  AND jsonb_array_length(provider_profile_read(NULL,'a0000000-0000-0000-0000-0000000000f1')#>'{vouched_for_by,items}')=1,'actor profile: its own vouch only');
RESET ROLE;

-- A new vouch by the same voucher supersedes; withdrawal is the signer's (or the organization's) and happens once.
SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000004');
CREATE TEMP TABLE vv3 AS SELECT t_vouch('00000000-0000-0000-0000-000000000006',NULL,ARRAY['supervision'],'Supervised work in bay 1') j;
GRANT SELECT ON vv3 TO PUBLIC;
SELECT t_assert((SELECT (j->>'supersedes_vouch_id') = (SELECT j->>'vouch_id' FROM vv1) FROM vv3),'re-vouch supersedes the previous vouch');
SELECT t_as('00000000-0000-0000-0000-000000000003');
SELECT t_assert(t_refused_with(format('SELECT withdraw_vouch(%L)',(SELECT j->>'vouch_id' FROM vv3)),'unavailable'),'a stranger cannot withdraw another''s vouch');
SELECT withdraw_vouch((SELECT (j->>'vouch_id')::uuid FROM vv2));
SELECT t_assert((withdraw_vouch((SELECT (j->>'vouch_id')::uuid FROM vv2))->>'duplicate')::boolean,'repeat withdrawal is a duplicate');
RESET ROLE;
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT t_assert(jsonb_array_length(provider_profile_read('00000000-0000-0000-0000-000000000006')#>'{vouched_for_by,items}')=1
  AND provider_profile_read('00000000-0000-0000-0000-000000000006') @> '{"vouched_for_by":{"items":[{"scope":"Supervised work in bay 1"}]}}',
  'superseded and withdrawn vouches drop off the profile');
RESET ROLE;
SELECT t_assert(t_refused_with($q$UPDATE public.provider_vouches SET scope='edited'$q$,'only by')
  AND t_refused_with($q$DELETE FROM public.provider_vouches$q$,'retained')
  AND t_refused_with($q$INSERT INTO public.provider_vouches(signer_user_id,voucher_user_id,subject_user_id,kinds,scope,request_key)
    VALUES ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000006',ARRAY['supervision'],'x','k')$q$,'only by'),
  'vouch rows: no direct insert, edit or delete');

-- Authenticated co-signs: fixture_tech offers on the open skill requirement; the shop owner co-signs for the shop.
INSERT INTO observation_sources(id,slug,category) VALUES ('90000000-0000-0000-0000-000000000002','owner-input','owner');
SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000006');
CREATE TEMP TABLE ofx AS SELECT offer_on_requirement('81000000-0000-0000-0000-000000000002',
  '{"lines":[{"description":"Header flange welding","pricing_basis":"flat","amount":300,"currency":"USD","unit":null,"quantity":null}]}'::jsonb,
  NULL, NULL, NULL) j;
GRANT SELECT ON ofx TO PUBLIC;
SELECT t_as('00000000-0000-0000-0000-000000000004');
SELECT cosign_provider('30000000-0000-0000-0000-00000000000d',(SELECT (j->>'offer_id')::uuid FROM ofx),ARRAY['supervision','suitability'],'Supervised in Fixture Shop bay 2',NULL);
RESET ROLE;
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT t_assert(provider_profile_read('00000000-0000-0000-0000-000000000006') @> '{"tools":{"co_signed":{"authenticated_attestations":2}}}'
  AND (provider_profile_read('00000000-0000-0000-0000-000000000006')#>>'{tools,co_signed,supporting_attestations}')::int >= 2
  AND (provider_profile_read('00000000-0000-0000-0000-000000000006')->'capabilities')::text = :'caps0',
  'profile: authenticated co-sign attestations counted under tools.co_signed, not capabilities');
RESET ROLE;

SELECT t_assert(has_function_privilege('authenticated','vouch_for_provider(uuid,uuid,text[],text,timestamptz)','EXECUTE')
  AND NOT has_function_privilege('anon','vouch_for_provider(uuid,uuid,text[],text,timestamptz)','EXECUTE')
  AND has_function_privilege('authenticated','withdraw_vouch(uuid)','EXECUTE') AND NOT has_function_privilege('anon','withdraw_vouch(uuid)','EXECUTE')
  AND NOT has_table_privilege('anon','public.provider_vouches','SELECT') AND NOT has_table_privilege('authenticated','public.provider_vouches','SELECT')
  AND NOT has_function_privilege('authenticated','provider_vouched_for_by(uuid,uuid[])','EXECUTE')
  AND has_function_privilege('anon','provider_profile_read(uuid,uuid)','EXECUTE'),
  'grants: vouch Signs authenticated-only; table and helpers closed; profile reader open');
SELECT jsonb_agg(jsonb_build_object('proname',proname,'hash',md5(pg_get_functiondef(oid))) ORDER BY proname) AS implementation_hashes
 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('vouch_for_provider','withdraw_vouch','provider_vouch_guard',
 'provider_vouched_for_by','provider_authenticated_cosigns','provider_profile_read');
