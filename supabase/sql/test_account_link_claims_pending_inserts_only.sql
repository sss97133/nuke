-- Disposable PG17 only. Proves 20261019100000_account_link_claims_pending_inserts_only.sql: a user's own insert
-- (direct or through the external_identity_claims view) files only a pending, unreviewed claim, while the RPC,
-- service and actor self_claim paths keep working. Fixture and prior state: the identity-bridge contract.
\set ON_ERROR_STOP on
\ir test_account_link_claims_actor_bridge.sql

-- Before: a user can file an already approved external claim.
SET ROLE authenticated;
SELECT t_as('authenticated','00000000-0000-0000-0000-0000000000a2');
INSERT INTO account_link_claims(user_id,platform,handle,status,reviewed_at) VALUES
  ('00000000-0000-0000-0000-0000000000a2','bat','before_fix','approved',now());
SELECT t_assert((SELECT status FROM account_link_claims WHERE handle='before_fix')='approved', 'before: a user files an approved claim');
RESET ROLE;

\ir ../migrations/20261019100000_account_link_claims_pending_inserts_only.sql
-- Live: authenticated reads external_identities (public read policy), which the view's INSTEAD OF trigger needs.
GRANT SELECT ON public.external_identities TO anon, authenticated;

SET ROLE authenticated;
SELECT t_as('authenticated','00000000-0000-0000-0000-0000000000a2');
INSERT INTO account_link_claims(user_id,platform,handle,proof_type,proof_url) VALUES
  ('00000000-0000-0000-0000-0000000000a2','bat','plain_pending','profile_link','https://example.com/p');
SELECT t_assert((SELECT status FROM account_link_claims WHERE handle='plain_pending')='pending', 'a pending external claim is still filed directly');
SELECT t_assert(t_refused($q$INSERT INTO account_link_claims(user_id,platform,handle,status) VALUES ('00000000-0000-0000-0000-0000000000a2','bat','x1','approved')$q$),
  'approved refused');
SELECT t_assert(t_refused($q$INSERT INTO account_link_claims(user_id,platform,handle,status) VALUES ('00000000-0000-0000-0000-0000000000a2','bat','x2','verified')$q$),
  'verified refused');
SELECT t_assert(t_refused($q$INSERT INTO account_link_claims(user_id,platform,handle,status) VALUES ('00000000-0000-0000-0000-0000000000a2','bat','x3','pending_review')$q$),
  'pending_review refused (review is a service step)');
SELECT t_assert(t_refused($q$INSERT INTO account_link_claims(user_id,platform,handle,reviewed_by_user_id,reviewed_at)
  VALUES ('00000000-0000-0000-0000-0000000000a2','bat','x4','00000000-0000-0000-0000-0000000000ad',now())$q$), 'reviewer fields refused');
SELECT t_assert(t_refused($q$INSERT INTO account_link_claims(user_id,platform,handle,claim_confidence) VALUES ('00000000-0000-0000-0000-0000000000a2','bat','x5',90)$q$),
  'a confidence score refused');
SELECT t_assert(t_refused($q$INSERT INTO account_link_claims(user_id,platform,handle,verification_method) VALUES ('00000000-0000-0000-0000-0000000000a2','bat','x6','email_match')$q$),
  'a self-asserted verification method refused');
SELECT t_assert(t_refused($q$INSERT INTO external_identity_claims(external_identity_id,requested_by_user_id,status)
  VALUES ((SELECT id FROM external_identities WHERE handle='fixture_handle'),'00000000-0000-0000-0000-0000000000a2','approved')$q$),
  'an approved claim through the view refused');
INSERT INTO external_identity_claims(external_identity_id,requested_by_user_id)
  VALUES ((SELECT id FROM external_identities WHERE handle='fixture_handle'),'00000000-0000-0000-0000-0000000000a2');
SELECT t_assert((SELECT count(*) FROM account_link_claims WHERE handle='fixture_handle' AND user_id='00000000-0000-0000-0000-0000000000a2' AND status='pending')=1,
  'a pending claim through the view is still filed');
SELECT request_external_identity_claim('bat','rpc_after_fix');
SELECT t_assert((SELECT status FROM account_link_claims WHERE handle='rpc_after_fix')='pending', 'request_external_identity_claim still files');
INSERT INTO account_link_claims(user_id,platform,handle,actor_id,verification_method) VALUES ('00000000-0000-0000-0000-0000000000a2','nuke_actor',
  'a0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002','self_claim');
SELECT t_assert((SELECT verification_method FROM account_link_claims WHERE actor_id='a0000000-0000-0000-0000-000000000002')='self_claim',
  'an actor self_claim is still filed');
SELECT t_assert(t_refused($q$INSERT INTO account_link_claims(user_id,platform,handle,actor_id) VALUES ('00000000-0000-0000-0000-0000000000a1','nuke_actor',
  'a0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002')$q$), 'an actor claim without self_claim refused');
RESET ROLE;
SET ROLE anon;
SELECT t_as('anon', NULL);
SELECT t_assert(t_refused($q$INSERT INTO account_link_claims(user_id,platform,handle) VALUES ('00000000-0000-0000-0000-0000000000a2','bat','anon_try')$q$), 'anon refused');
RESET ROLE;
SET ROLE service_role;
SELECT t_as('service_role', NULL);
INSERT INTO account_link_claims(user_id,platform,handle,status,verification_method,claim_confidence)
  VALUES ('00000000-0000-0000-0000-0000000000a1','ebay','mcp_review','pending_review','manual_review',0)
  ON CONFLICT (user_id,platform,handle) DO UPDATE SET status=EXCLUDED.status;
SELECT t_assert((SELECT status FROM account_link_claims WHERE handle='mcp_review')='pending_review', 'service (MCP) claim paths unaffected');
SELECT t_assert((SELECT status FROM account_link_claims WHERE handle='before_fix')='approved', 'existing rows are not rewritten');
RESET ROLE;
