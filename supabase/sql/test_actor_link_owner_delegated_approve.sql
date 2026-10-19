-- Disposable PG17 only. Proves 20261020002500_actor_link_owner_delegated_approve.sql (on 20261020002000): only the
-- owner's own actor claim can be approved on his behalf; only finder-approvable evidence is accepted and the rung is the
-- highest it supports; the approval and its register row commit or roll back together; a register row cannot be reused
-- or forged into another claim; every other claim still needs a distinct active admin.
-- Fixture and prior state: the actor-link evidence chain (claim c1..f3 of user 01 approved at work_evidence by admin 05).
\set ON_ERROR_STOP on
\ir test_actor_link_claim_evidence.sql

-- O is the owner the authorization names. Owner sessions on the actor's vehicle: the event day (direct) and outside the
-- window (not evidence); one owner observation listed on the actor's component event (signed).
INSERT INTO auth.users VALUES ('0b9f107a-d124-49de-9ded-94698f63c1c4');
INSERT INTO admin_users(user_id, is_active) VALUES ('0b9f107a-d124-49de-9ded-94698f63c1c4', true);
INSERT INTO public.work_sessions(id, user_id, vehicle_id, session_date, duration_minutes) VALUES
 ('63000000-0000-0000-0000-000000000001','0b9f107a-d124-49de-9ded-94698f63c1c4','40000000-0000-0000-0000-000000000003','2026-02-01',90),
 ('63000000-0000-0000-0000-000000000002','0b9f107a-d124-49de-9ded-94698f63c1c4','40000000-0000-0000-0000-000000000001','2026-02-01',30);
INSERT INTO public.vehicle_observations(id, vehicle_id, kind, source_id, observed_at, submitted_by_user_id, structured_data) VALUES
 ('83000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000003','work_record','90000000-0000-0000-0000-000000000001','2026-02-01',
  '0b9f107a-d124-49de-9ded-94698f63c1c4','{"note":"owner weld photo"}');
UPDATE public.component_events SET evidence_ids = evidence_ids || '83000000-0000-0000-0000-000000000001'::uuid
  WHERE id = 'c0000000-0000-0000-0000-0000000000f3';
SET ROLE authenticated;
SELECT t_as('0b9f107a-d124-49de-9ded-94698f63c1c4');
INSERT INTO account_link_claims(id,user_id,platform,handle,actor_id,verification_method) VALUES
 ('c2000000-0000-0000-0000-0000000000f3','0b9f107a-d124-49de-9ded-94698f63c1c4','nuke_actor','a0000000-0000-0000-0000-0000000000f3','a0000000-0000-0000-0000-0000000000f3','self_claim');
RESET ROLE;

\ir ../migrations/20261020002000_owner_delegated_signs.sql
\ir ../migrations/20261020002500_actor_link_owner_delegated_approve.sql

SELECT t_assert(NOT has_function_privilege('anon', 'public.approve_actor_link_claim_owner_delegated(uuid,uuid[],text,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.approve_actor_link_claim_owner_delegated(uuid,uuid[],text,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.approve_actor_link_claim_owner_delegated(uuid,uuid[],text,text)', 'EXECUTE'),
  'owner-delegated approval is service-only');
SELECT t_assert((SELECT bool_and(prosrc !~* '(full_name|phone|email|\mname\M|profiles|actors)') FROM pg_proc
  WHERE proname IN ('account_link_claims_actor_guard', 'approve_actor_link_claim_owner_delegated')), 'no name, phone, email, profile or actor field is read');

SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-d124-49de-9ded-94698f63c1c4"}', false);
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim_owner_delegated('c2000000-0000-0000-0000-0000000000f3',
  ARRAY['63000000-0000-0000-0000-000000000001']::uuid[], 'dude its fine')$q$), 'a non-service JWT is refused');
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);

-- 1. Only the owner's own claim.
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim_owner_delegated('c1000000-0000-0000-0000-0000000000f4',
  ARRAY['61000000-0000-0000-0000-000000000001']::uuid[], 'dude its fine')$q$), 'another account''s claim cannot be approved on the owner''s behalf');

-- 2. Only finder-approvable evidence.
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim_owner_delegated('c2000000-0000-0000-0000-0000000000f3', ARRAY[]::uuid[], 'q')$q$), 'no evidence, no approval');
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim_owner_delegated('c2000000-0000-0000-0000-0000000000f3',
  ARRAY['63000000-0000-0000-0000-000000000001','63000000-0000-0000-0000-000000000001']::uuid[], 'q')$q$), 'duplicate ids are refused');
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim_owner_delegated('c2000000-0000-0000-0000-0000000000f3',
  ARRAY['63000000-0000-0000-0000-000000000001']::uuid[], ' ')$q$), 'an authorization quote is required');
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim_owner_delegated('c2000000-0000-0000-0000-0000000000f3',
  ARRAY['63000000-0000-0000-0000-000000000002']::uuid[], 'q')$q$), 'the owner''s session on an unrelated vehicle is not evidence for this actor');
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim_owner_delegated('c2000000-0000-0000-0000-0000000000f3',
  ARRAY['61000000-0000-0000-0000-000000000001']::uuid[], 'q')$q$), 'another person''s session is not the owner''s evidence');
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim_owner_delegated('c2000000-0000-0000-0000-0000000000f3',
  ARRAY['63000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000002']::uuid[], 'q')$q$),
  'a corroborating photo analysis (approvable for nothing) cannot be cited');
SELECT t_assert((SELECT count(*) FROM owner_delegated_signs) = 0 AND (SELECT status || '/' || verification_method FROM account_link_claims
  WHERE id = 'c2000000-0000-0000-0000-0000000000f3') = 'pending/self_claim', 'refusals leave no register row and the claim unchanged');

-- 3. Rolled back together.
BEGIN;
SELECT approve_actor_link_claim_owner_delegated('c2000000-0000-0000-0000-0000000000f3',
  ARRAY['63000000-0000-0000-0000-000000000001']::uuid[], 'dude its fine', 'agent-test');
ROLLBACK;
SELECT t_assert((SELECT count(*) FROM owner_delegated_signs) = 0 AND (SELECT verification_method FROM account_link_claims
  WHERE id = 'c2000000-0000-0000-0000-0000000000f3') = 'self_claim', 'a rolled-back approval leaves neither the promotion nor its register row');

-- 4. work_evidence from the owner's direct session, registered.
CREATE TEMP TABLE a1 AS SELECT approve_actor_link_claim_owner_delegated('c2000000-0000-0000-0000-0000000000f3',
  ARRAY['63000000-0000-0000-0000-000000000001']::uuid[], 'dude its fine', 'agent-test') r;
SELECT t_assert((SELECT r @> '{"rung":"work_evidence","previous_rung":"self_claim","evidence_rows":1,"reviewer":"agent_on_behalf_of_owner"}' FROM a1),
  'direct work session -> work_evidence');
SELECT t_assert((SELECT c.status = 'approved' AND c.reviewed_by_user_id = c.user_id
  AND c.rung_evidence->0 @> jsonb_build_object('rung', 'work_evidence', 'reviewer', 'agent_on_behalf_of_owner', 'authorization_quote', 'dude its fine',
    'owner_delegated_sign_id', (SELECT r->>'owner_delegated_sign_id' FROM a1),
    'evidence', '[{"kind":"work_session","id":"63000000-0000-0000-0000-000000000001"}]'::jsonb)
  FROM account_link_claims c WHERE c.id = 'c2000000-0000-0000-0000-0000000000f3'), 'rung entry names the agent marker, quote and register row');
SELECT t_assert((SELECT count(*) FROM owner_delegated_signs d WHERE d.id = (SELECT (r->>'owner_delegated_sign_id')::uuid FROM a1)
  AND d.rpc = 'approve_actor_link_claim_owner_delegated' AND d.result_ref = 'c2000000-0000-0000-0000-0000000000f3'
  AND d.agent_session = 'agent-test' AND d.args_summary @> '{"rung":"work_evidence","previous_rung":"self_claim"}') = 1, 'register row written with the approval');
SELECT t_assert(is_owner_delegated_sign('approve_actor_link_claim_owner_delegated', 'c2000000-0000-0000-0000-0000000000f3'), 'readers can flag the delegated approval');
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim_owner_delegated('c2000000-0000-0000-0000-0000000000f3',
  ARRAY['63000000-0000-0000-0000-000000000001']::uuid[], 'q')$q$), 'the same evidence cannot grant the same rung again');

-- 5. A register row cannot be reused or forged.
RESET ROLE;
SELECT t_assert(t_refused($q$UPDATE account_link_claims SET verification_method = 'authenticated_sign', reviewed_at = '2026-03-01',
  rung_evidence = rung_evidence || jsonb_build_array(jsonb_build_object('rung', 'authenticated_sign',
    'evidence', '[{"kind":"observation","id":"83000000-0000-0000-0000-000000000001"}]'::jsonb,
    'reviewer_user_id', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'reviewed_at', '2026-03-01T00:00:00+00:00',
    'reviewer', 'agent_on_behalf_of_owner', 'authorization_quote', 'dude its fine',
    'owner_delegated_sign_id', (SELECT r->>'owner_delegated_sign_id' FROM a1)))
  WHERE id = 'c2000000-0000-0000-0000-0000000000f3'$q$), 'a used register row cannot authorize a second promotion');
SELECT t_assert(t_refused($q$UPDATE account_link_claims SET verification_method = 'co_sign', status = 'approved',
  reviewed_by_user_id = user_id, reviewed_at = '2026-03-01',
  rung_evidence = rung_evidence || jsonb_build_array(jsonb_build_object('rung', 'co_sign', 'evidence', '[{"kind":"work_session","id":"61000000-0000-0000-0000-000000000001"}]'::jsonb,
    'reviewer_user_id', user_id, 'reviewed_at', '2026-03-01T00:00:00+00:00', 'reviewer', 'agent_on_behalf_of_owner',
    'authorization_quote', 'dude its fine', 'owner_delegated_sign_id', (SELECT r->>'owner_delegated_sign_id' FROM a1)))
  WHERE id = 'c1000000-0000-0000-0000-0000000000f3'$q$), 'another account cannot borrow the owner''s register row to self-review');
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim('c2000000-0000-0000-0000-0000000000f3', 'authenticated_sign',
  '[{"kind":"observation","id":"83000000-0000-0000-0000-000000000001"}]', '0b9f107a-d124-49de-9ded-94698f63c1c4')$q$),
  'the plain approval path still refuses the owner reviewing his own claim');
SELECT t_assert(t_refused($q$UPDATE account_link_claims SET verification_method = 'authenticated_sign', reviewed_by_user_id = '00000000-0000-0000-0000-000000000005',
  reviewed_at = '2026-03-01', rung_evidence = rung_evidence || jsonb_build_array(jsonb_build_object('rung', 'authenticated_sign',
    'evidence', '[{"kind":"observation","id":"82000000-0000-0000-0000-000000000001"}]'::jsonb, 'reviewer_user_id', '00000000-0000-0000-0000-000000000005',
    'reviewed_at', '2026-03-01T00:00:00+00:00', 'reviewer', 'agent_on_behalf_of_owner'))
  WHERE id = 'c1000000-0000-0000-0000-0000000000f3'$q$), 'delegation fields without a register row are refused');

-- 6. Distinct-admin path unchanged for everyone else.
SET ROLE service_role;
SELECT approve_actor_link_claim('c1000000-0000-0000-0000-0000000000f4', 'work_evidence',
  '[{"kind":"work_session","id":"61000000-0000-0000-0000-000000000001"}]', '00000000-0000-0000-0000-000000000005');
SELECT t_assert((SELECT verification_method FROM account_link_claims WHERE id = 'c1000000-0000-0000-0000-0000000000f4') = 'work_evidence',
  'a distinct active admin still approves other claims');
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim('c1000000-0000-0000-0000-0000000000f3', 'authenticated_sign',
  '[{"kind":"observation","id":"82000000-0000-0000-0000-000000000001"}]', '00000000-0000-0000-0000-000000000001')$q$),
  'a claimant still cannot review their own claim');

-- 7. authenticated_sign from the owner's own submitted observation.
CREATE TEMP TABLE a2 AS SELECT approve_actor_link_claim_owner_delegated('c2000000-0000-0000-0000-0000000000f3',
  ARRAY['83000000-0000-0000-0000-000000000001','63000000-0000-0000-0000-000000000001']::uuid[], 'dude its fine', 'agent-test') r;
SELECT t_assert((SELECT r @> '{"rung":"authenticated_sign","previous_rung":"work_evidence","evidence_rows":2}' FROM a2),
  'his own submitted observation supports authenticated_sign');
SELECT t_assert((SELECT jsonb_array_length(rung_evidence) = 2 AND rung_evidence->1->>'owner_delegated_sign_id' = (SELECT r->>'owner_delegated_sign_id' FROM a2)
  FROM account_link_claims WHERE id = 'c2000000-0000-0000-0000-0000000000f3') AND (SELECT count(*) FROM owner_delegated_signs) = 2,
  'each promotion carries its own register row');
RESET ROLE;
