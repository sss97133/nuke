-- Disposable PG17 only. Proves 20261020041000_actor_link_review_owner_agent.sql: the review queue shows each pending claim's
-- direct evidence and whether an agent may review it on the owner's behalf; approve_actor_link_claim_owner_agent approves only
-- another signed-in account's claim with at least one direct, finder-approvable cited item, records the owner as reviewer
-- with a note naming the agent and register row, and registers it in owner_delegated_signs in the same transaction.
-- Nothing is approved by reading the queue. Fixture and prior state: the owner-delegated approval chain.
\set ON_ERROR_STOP on
\ir test_actor_link_owner_delegated_approve.sql

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz;
UPDATE auth.users SET last_sign_in_at = '2026-10-01' WHERE id IN ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003',
  '0b9f107a-d124-49de-9ded-94698f63c1c4');
SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000003');
INSERT INTO account_link_claims(id, user_id, platform, handle, actor_id, verification_method) VALUES
 ('c5000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-000000000003', 'nuke_actor', 'a0000000-0000-0000-0000-0000000000f3',
  'a0000000-0000-0000-0000-0000000000f3', 'self_claim');
SELECT t_as('00000000-0000-0000-0000-000000000001');
INSERT INTO account_link_claims(id, user_id, platform, handle, actor_id, verification_method) VALUES
 ('c5000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000001', 'nuke_actor', 'a0000000-0000-0000-0000-0000000000f1',
  'a0000000-0000-0000-0000-0000000000f1', 'self_claim');
RESET ROLE;

\ir ../migrations/20261020041000_actor_link_review_owner_agent.sql

SELECT t_assert(NOT has_function_privilege('authenticated', 'public.approve_actor_link_claim_owner_agent(uuid,uuid[],text,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.approve_actor_link_claim_owner_agent(uuid,uuid[],text,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.actor_link_owner_agent_eligibility(uuid,jsonb)', 'EXECUTE'), 'owner-agent approval is service-only');

-- 1. The queue shows evidence and eligibility; reading approves nothing.
SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000005');
CREATE TEMP TABLE rq2 AS SELECT actor_link_claims_review_queue() j;
RESET ROLE;
SELECT t_assert((SELECT j->'pending' @> '[{"claim_id":"c5000000-0000-0000-0000-0000000000f3","direct_evidence":[{"kind":"work_session","row_id":"61000000-0000-0000-0000-000000000003"}],
  "owner_agent_approval":{"eligible":true,"reasons":[],"rpc":"approve_actor_link_claim_owner_agent","automatic":false,
  "args":{"p_claim_id":"c5000000-0000-0000-0000-0000000000f3","p_evidence_ids":["61000000-0000-0000-0000-000000000003"]}}},
  {"claim_id":"c5000000-0000-0000-0000-0000000000f1","direct_evidence":[],"owner_agent_approval":{"eligible":false,"reasons":["no_direct_evidence"]}}]'
  AND j->'coverage' @> '{"pending_actor_claims":2,"owner_agent_eligible":1}' FROM rq2), 'queue: direct evidence and owner-agent eligibility per pending claim');
SELECT t_assert((SELECT count(*) FROM account_link_claims WHERE status = 'pending' AND actor_id IS NOT NULL) = 2, 'reading the queue approves nothing');

-- 2. Refusals.
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000005"}', false);
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim_owner_agent('c5000000-0000-0000-0000-0000000000f3',
  ARRAY['61000000-0000-0000-0000-000000000003']::uuid[], 'dude its fine')$q$), 'a non-service JWT is refused');
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim_owner_agent('c5000000-0000-0000-0000-0000000000f1',
  ARRAY['0a000000-0000-0000-0000-000000000001']::uuid[], 'dude its fine')$q$), 'corroborating-only evidence (org co-membership) is refused');
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim_owner_agent('c2000000-0000-0000-0000-0000000000f3',
  ARRAY['83000000-0000-0000-0000-000000000001']::uuid[], 'dude its fine')$q$), 'the owner''s own claim is not an owner-agent review');
RESET ROLE;
UPDATE auth.users SET last_sign_in_at = NULL WHERE id = '00000000-0000-0000-0000-000000000003';
SET ROLE service_role;
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim_owner_agent('c5000000-0000-0000-0000-0000000000f3',
  ARRAY['61000000-0000-0000-0000-000000000003']::uuid[], 'dude its fine')$q$), 'a claimant who never signed in is refused');
RESET ROLE;
UPDATE auth.users SET last_sign_in_at = '2026-10-01' WHERE id = '00000000-0000-0000-0000-000000000003';
SET ROLE service_role;
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim_owner_agent('c5000000-0000-0000-0000-0000000000f3',
  ARRAY['61000000-0000-0000-0000-000000000001']::uuid[], 'dude its fine')$q$), 'another account''s session cannot be cited');
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim_owner_agent('c5000000-0000-0000-0000-0000000000f3',
  ARRAY['61000000-0000-0000-0000-000000000003']::uuid[], ' ')$q$), 'an authorization quote is required');
SELECT t_assert((SELECT count(*) FROM owner_delegated_signs WHERE rpc = 'approve_actor_link_claim_owner_agent') = 0, 'refusals register nothing');

-- 3. Rolled back together; then approved.
BEGIN;
SELECT approve_actor_link_claim_owner_agent('c5000000-0000-0000-0000-0000000000f3', ARRAY['61000000-0000-0000-0000-000000000003']::uuid[], 'dude its fine', 'agent-test');
ROLLBACK;
SELECT t_assert((SELECT status FROM account_link_claims WHERE id = 'c5000000-0000-0000-0000-0000000000f3') = 'pending'
  AND (SELECT count(*) FROM owner_delegated_signs WHERE rpc = 'approve_actor_link_claim_owner_agent') = 0, 'a rolled-back review leaves neither');
CREATE TEMP TABLE ag AS SELECT approve_actor_link_claim_owner_agent('c5000000-0000-0000-0000-0000000000f3',
  ARRAY['61000000-0000-0000-0000-000000000003']::uuid[], 'dude its fine', 'agent-test') r;
RESET ROLE;
SELECT t_assert((SELECT r @> '{"rung":"work_evidence","previous_rung":"self_claim","evidence_rows":1,"direct_rows":1,"reviewer":"agent_on_behalf_of_owner"}' FROM ag),
  'direct session -> work_evidence');
SELECT t_assert((SELECT c.status = 'approved' AND c.reviewed_by_user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
  AND c.rung_evidence->-1->>'note' LIKE '%agent on the owner''s behalf; owner_delegated_signs ' || (SELECT r->>'owner_delegated_sign_id' FROM ag) || '%'
  FROM account_link_claims c WHERE c.id = 'c5000000-0000-0000-0000-0000000000f3'), 'owner recorded as reviewer, note names the agent and register row');
SELECT t_assert((SELECT count(*) FROM owner_delegated_signs d WHERE d.id = (SELECT (r->>'owner_delegated_sign_id')::uuid FROM ag)
  AND d.rpc = 'approve_actor_link_claim_owner_agent' AND d.result_ref = 'c5000000-0000-0000-0000-0000000000f3'
  AND d.args_summary @> '{"claimant_user_id":"00000000-0000-0000-0000-000000000003","rung":"work_evidence"}') = 1, 'registered in the same transaction');
SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000005');
SELECT t_assert((SELECT actor_link_claims_review_queue()->'coverage' @> '{"pending_actor_claims":1,"owner_agent_eligible":0}'), 'the approved claim leaves the queue');
RESET ROLE;
