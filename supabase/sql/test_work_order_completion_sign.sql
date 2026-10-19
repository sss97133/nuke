-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations.
-- Completion Signs (attest_work_completion / accept_work_completion) and the job path's completion stage.
\ir test_work_order_offers_read.sql
\ir ../migrations/20261019200000_work_order_completion_sign.sql

CREATE FUNCTION public.attest(p_hash text,p_evidence jsonb DEFAULT NULL,p_wo uuid DEFAULT '30000000-0000-0000-0000-000000000001') RETURNS jsonb
 LANGUAGE sql AS $$ SELECT attest_work_completion(p_wo,p_hash,'Fixture completion note',p_evidence) $$;
GRANT EXECUTE ON FUNCTION public.attest(text,jsonb,uuid) TO authenticated;
INSERT INTO vehicle_images(id,vehicle_id) VALUES ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001'),
 ('50000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002');

SELECT t_assert(jp('completion') @> '{"state":"absent","state_basis":"no_completion_sign","customer_acceptance":"not_established","provider_attestation":null}'
 AND jp('completion')->'gaps' @> '["no_provider_completion_attestation"]' AND jp('completion')#>>'{scope_basis,basis}'='scope_snapshot'
 AND jp('completion')#>>'{scope_basis,scope_hash}' ~ '^[0-9a-f]{64}$','baseline: no Sign, pinned to the scope snapshot');

-- Shop owner quotes; customer accepts: the completion is now pinned to that quote hash.
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT issue() AS q1 \gset
SELECT (:'q1'::jsonb)->>'quote_id' AS q1id \gset
SELECT (:'q1'::jsonb)->>'quote_hash' AS q1hash \gset
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT accept_work_order_quote(:'q1id',:'q1hash');
RESET ROLE;
SELECT t_assert(jp('completion')->'scope_basis' @> jsonb_build_object('basis','accepted_quote','quote_id',:'q1id','scope_hash',:'q1hash'),
 'accepted quote pins the completion scope');

SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT t_assert(t_refused_with(format('SELECT attest(%L)',:'q1hash'),'unavailable for completion'),'customer cannot attest their own job');
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT t_assert(t_refused_with(format('SELECT attest(%L)',:'q1hash'),'unavailable for completion'),'stranger refused');
SELECT as_user('10000000-0000-0000-0000-000000000009');
SELECT t_assert(t_refused_with(format('SELECT attest(%L)',:'q1hash'),'unavailable for completion'),'self-claimed offerer is not a provider on the job');
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT t_assert(t_refused_with(format('SELECT attest(%L)',:'q1hash'),'unavailable for completion'),'provider whose acceptance was withheld refused');
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT t_assert(t_refused_with($q$SELECT attest(repeat('a',64))$q$,'Scope hash does not match'),'wrong scope hash refused');
SELECT t_assert(t_refused_with(format('SELECT attest(%L,%L)',:'q1hash','[{"kind":"image","id":"50000000-0000-0000-0000-000000000002"}]'),'Evidence'),
 'evidence from another vehicle refused');
SELECT t_assert(t_refused_with(format('SELECT attest(%L,%L)',:'q1hash','[{"kind":"invoice","id":"50000000-0000-0000-0000-000000000001"}]'),'Evidence'),
 'unknown evidence kind refused');
SELECT n_obs() AS nobs0 \gset
SELECT attest(:'q1hash','[{"kind":"image","id":"50000000-0000-0000-0000-000000000001"}]') AS a1 \gset
SELECT attest(:'q1hash','[{"kind":"image","id":"50000000-0000-0000-0000-000000000001"}]') AS a1dup \gset
SELECT t_assert((:'a1'::jsonb) @> jsonb_build_object('signer_role','organization_owner','scope_basis','accepted_quote','quote_id',:'q1id',
   'evidence_count',1,'duplicate',false,'payment_authorized',false,'customer_notified',false,'work_order_status_changed',false)
 AND (:'a1'::jsonb)->>'completion_hash' ~ '^[0-9a-f]{64}$' AND (:'a1dup'::jsonb)->>'completion_id'=(:'a1'::jsonb)->>'completion_id'
 AND ((:'a1dup'::jsonb)->>'duplicate')::boolean AND n_obs()=(:'nobs0')::bigint+1,'org owner Sign: one work_record, idempotent replay');
RESET ROLE;
SELECT (:'a1'::jsonb)->>'completion_id' AS c1 \gset
SELECT (:'a1'::jsonb)->>'completion_hash' AS ch1 \gset
SELECT t_assert(EXISTS (SELECT 1 FROM vehicle_observations o WHERE o.id=:'c1' AND o.kind='work_record' AND o.submitted_by_user_id='10000000-0000-0000-0000-00000000000e'
   AND o.source_id='90000000-0000-0000-0000-000000000002' AND o.structured_data#>>'{work_order_lifecycle,event_type}'='completion_attestation'
   AND o.observed_at=(:'a1'::jsonb->>'signed_at')::timestamptz),'source is an owner-input work_record with signer and sign clock');
SELECT t_assert(jp('completion') @> jsonb_build_object('state','recorded','state_basis','provider_completion_attestation','customer_acceptance','not_established',
   'provider_attestation',jsonb_build_object('completion_id',:'c1','completion_hash',:'ch1','signer_role','organization_owner','evidence_count',1,'basis','authenticated_sign'))
 AND jp('completion')->'gaps' @> '["no_customer_completion_acceptance"]' AND NOT jp('completion')->'gaps' @> '["no_provider_completion_attestation"]',
 'job path: completion recorded by the provider Sign; customer acceptance not established');
SELECT t_assert(NOT read_work_order_job_path('30000000-0000-0000-0000-000000000001')::text ~ '(10000000-0000-0000-0000-00000000000[cef9]|Fixture completion note)',
 'job path: no raw user ids or notes');

SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT t_assert(t_refused_with(format('SELECT accept_work_completion(%L,%L,%L)','30000000-0000-0000-0000-000000000001',:'c1',:'ch1'),'Completion unavailable'),
 'provider cannot accept their own completion');
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT t_assert(t_refused_with(format('SELECT accept_work_completion(%L,%L,%L)','30000000-0000-0000-0000-000000000001',:'c1',repeat('b',64)),'hash does not match'),
 'customer acceptance is hash-pinned');
SELECT t_assert(t_refused_with(format('SELECT accept_work_completion(%L,%L,%L)','30000000-0000-0000-0000-000000000003',:'c1',:'ch1'),'Completion unavailable'),
 'attestation from another work order refused');
SELECT accept_work_completion('30000000-0000-0000-0000-000000000001',:'c1',:'ch1') AS k1 \gset
SELECT accept_work_completion('30000000-0000-0000-0000-000000000001',:'c1',:'ch1') AS k1dup \gset
SELECT t_assert((:'k1'::jsonb) @> '{"signer_role":"customer","duplicate":false,"payment_authorized":false}'
 AND (:'k1dup'::jsonb)->>'acceptance_id'=(:'k1'::jsonb)->>'acceptance_id' AND ((:'k1dup'::jsonb)->>'duplicate')::boolean,'customer Sign: accepted once, replay idempotent');
SELECT t_assert(t_refused($q$SELECT * FROM work_order_completion_attestations$q$) AND t_refused($q$SELECT * FROM work_order_completion_acceptances$q$),
 'projections are not readable by signed-in users');
RESET ROLE;
SELECT t_assert(jp('completion') @> jsonb_build_object('state','recorded','customer_acceptance','established',
   'customer_acceptance_sign',jsonb_build_object('acceptance_id',(:'k1'::jsonb)->>'acceptance_id','basis','authenticated_sign'))
 AND NOT jp('completion')->'gaps' @> '["no_customer_completion_acceptance"]','job path: customer acceptance established only by the customer Sign');
SELECT t_assert(t_refused_with(format('UPDATE work_order_completion_attestations SET evidence=%L WHERE id=%L','[]',:'c1'),'immutable')
 AND t_refused_with(format('DELETE FROM work_order_completion_acceptances WHERE completion_id=%L',:'c1'),'immutable'),'projections are immutable');
SET ROLE service_role;
SELECT t_assert((project_work_order_lifecycle_event(:'c1')->>'duplicate')::boolean,'projector replay is idempotent');
RESET ROLE;

-- A revised quote withholds the attestation and its acceptance.
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT issue(p_lines=>lines(175),p_supersedes=>:'q1id') AS q2 \gset
SELECT (:'q2'::jsonb)->>'quote_id' AS q2id \gset
SELECT (:'q2'::jsonb)->>'quote_hash' AS q2hash \gset
RESET ROLE;
SELECT t_assert(jp('completion') @> '{"state":"absent","customer_acceptance":"withheld","attestations_withheld":1,"provider_attestation":null}'
 AND jp('completion')->'gaps' @> '["completion_attestation_withheld_scope_changed","no_provider_completion_attestation"]'
 AND jp('completion')#>>'{scope_basis,basis}'='scope_snapshot','job path: superseded quote withholds attestation and acceptance');
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT t_assert(t_refused_with(format('SELECT accept_work_completion(%L,%L,%L)','30000000-0000-0000-0000-000000000001',:'c1',:'ch1'),'withheld'),
 'customer cannot accept a withheld completion');
SELECT accept_work_order_quote(:'q2id',:'q2hash');
-- The customer accepts the provider's revised offer: that provider may now attest.
SELECT (SELECT a->'args' FROM jsonb_array_elements(ofr()#>'{viewer,actions}') a WHERE a->>'action'='accept_offer'
  AND a#>>'{args,p_offer_id}' NOT IN (:'f0',:'f1')) AS rev \gset
SELECT accept_offer(((:'rev'::jsonb)->>'p_offer_id')::uuid,(:'rev'::jsonb)->>'p_offer_hash');
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT t_assert(t_refused_with(format('SELECT attest(%L)',:'q1hash'),'Scope hash does not match'),'old quote hash refused after revision');
SELECT attest(:'q2hash') AS a2 \gset
RESET ROLE;
SELECT t_assert((:'a2'::jsonb) @> jsonb_build_object('signer_role','accepted_provider','quote_id',:'q2id','evidence_count',0)
 AND jp('completion') @> jsonb_build_object('state','recorded','customer_acceptance','not_established','attestations_withheld',1,'acceptances_withheld',1,
   'provider_attestation',jsonb_build_object('completion_id',(:'a2'::jsonb)->>'completion_id','signer_role','accepted_provider')),
 'accepted provider attests the current quote; earlier acceptance does not carry over');

-- An organization member may attest; a completion clock alone is partial.
INSERT INTO organization_contributors(organization_id,user_id,role,status) VALUES
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000d','technician','active');
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000d');
SELECT t_assert(attest(:'q2hash')->>'signer_role'='organization_member','organization member Sign');
RESET ROLE;
UPDATE work_orders SET completed_at='2026-02-01',status='completed' WHERE id='30000000-0000-0000-0000-000000000003';
SELECT t_assert(jp('completion','30000000-0000-0000-0000-000000000003') @> '{"state":"partial","state_basis":"completion_clock_without_attestation","customer_acceptance":"not_established"}'
 AND jp('completion','30000000-0000-0000-0000-000000000003')->'gaps' @> '["no_provider_completion_attestation"]','completion clock without a Sign is partial');
SET ROLE service_role;
SELECT t_assert((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(work_order_job_path_scoreboard()) k)::text=:'board_keys'
 AND work_order_job_path_scoreboard()#>'{stages,completion}' @> '{"recorded":1,"partial":1}'
 AND (work_order_job_path_scoreboard()#>>'{gaps,completion_attestation_withheld_scope_changed}')::int=1,'scoreboard shape unchanged; counts Sign-based completion');
RESET ROLE;
SELECT t_assert(has_function_privilege('authenticated','attest_work_completion(uuid,text,text,jsonb)','EXECUTE')
 AND has_function_privilege('authenticated','accept_work_completion(uuid,uuid,text)','EXECUTE')
 AND NOT has_function_privilege('anon','attest_work_completion(uuid,text,text,jsonb)','EXECUTE')
 AND NOT has_function_privilege('anon','accept_work_completion(uuid,uuid,text)','EXECUTE')
 AND NOT has_function_privilege('service_role','attest_work_completion(uuid,text,text,jsonb)','EXECUTE')
 AND NOT has_function_privilege('authenticated','project_work_order_lifecycle_event(uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','work_order_completion_overlay(uuid,jsonb)','EXECUTE')
 AND NOT has_function_privilege('anon','work_order_completion_basis(uuid)','EXECUTE'),'grants: Signs for signed-in users; helpers service-only');
SELECT t_assert((SELECT count(*) FROM regexp_matches(pg_get_functiondef('read_work_order_job_path(uuid)'::regprocedure),'work_order_completion_overlay','g'))=1,
 'job path carries exactly one overlay call');
