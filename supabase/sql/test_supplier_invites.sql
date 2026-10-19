-- Disposable PG17 only. Proves 20261020092000_supplier_invites.sql (on the organization-claims chain): only the job's
-- customer or vehicle owner creates an invite, only for a business not on Nuke yet, at most 20 a day; the token is
-- returned once and only its hash is kept; redemption is single-use, not by the creator, before expiry, changes no
-- membership and says whether the redeemer's confirmed e-mail domain qualifies (never the address); counts are open.
\set ON_ERROR_STOP on
\ir test_organization_claims_on_nuke.sql
\ir ../migrations/20261020092000_supplier_invites.sql

INSERT INTO organizations(id, business_name, website, is_public) VALUES ('20000000-0000-0000-0000-0000000000e1', 'Paint Supply Co', 'https://www.paintsupply.example', true);
INSERT INTO auth.users(id, email, email_confirmed_at, last_sign_in_at) VALUES
 ('10000000-0000-0000-0000-0000000000b1', 'counter@paintsupply.example', '2026-10-01', '2026-10-01'),
 ('10000000-0000-0000-0000-0000000000b2', 'someone@example.org', '2026-10-01', '2026-10-01');

SELECT t_assert(has_function_privilege('authenticated', 'create_supplier_invite(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'create_supplier_invite(uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'redeem_supplier_invite(text)', 'EXECUTE') AND NOT has_function_privilege('anon', 'redeem_supplier_invite(text)', 'EXECUTE')
  AND has_function_privilege('anon', 'supplier_invites_summary()', 'EXECUTE') AND NOT has_table_privilege('authenticated', 'supplier_invites', 'SELECT'),
  'grants: Signs signed-in; counts open; table private');

SET ROLE authenticated;
-- 1. Creating.
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-0000000000b2","role":"authenticated"}', false);
SELECT t_assert(t_refused_with($q$SELECT create_supplier_invite('20000000-0000-0000-0000-0000000000e1', '56000000-0000-0000-0000-000000000001')$q$,
  'customer or vehicle owner'), 'a stranger cannot invite');
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-00000000000c","role":"authenticated"}', false);
SELECT create_supplier_invite('20000000-0000-0000-0000-0000000000e1', '56000000-0000-0000-0000-000000000001') AS i1 \gset
SELECT t_assert((:'i1'::jsonb) @> '{"available":true,"single_use":true,"providers_notified":false,"sent_by_nuke":false,
  "organization":{"name":"Paint Supply Co"},"requirement":{"requirement_id":"56000000-0000-0000-0000-000000000001","kind":"skill"}}'
  AND (:'i1'::jsonb)->>'token' ~ '^[0-9a-f]{64}$' AND (:'i1'::jsonb)->>'share_path' = '/supplier-invite/' || ((:'i1'::jsonb)->>'token'),
  'the customer gets a single-use token to share');
SELECT t_assert(create_supplier_invite(:'az', '56000000-0000-0000-0000-000000000001') @> '{"available":false,"reason":"already_on_nuke",
  "contact":{"writer":"request_contact"}}', 'a business already on Nuke gets a contact descriptor, not an invite');
RESET ROLE;
SELECT t_assert((SELECT count(*) FROM supplier_invites WHERE token_hash = encode(sha256(convert_to((:'i1'::jsonb)->>'token', 'UTF8')), 'hex')) = 1
  AND NOT EXISTS (SELECT 1 FROM supplier_invites WHERE token_hash = (:'i1'::jsonb)->>'token'), 'only the hash is stored');

-- 2. Redeeming.
SET ROLE authenticated;
SELECT t_assert(t_refused_with(format('SELECT redeem_supplier_invite(%L)', (:'i1'::jsonb)->>'token'), 'cannot redeem your own'), 'the creator cannot redeem');
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-0000000000b1","role":"authenticated"}', false);
SELECT t_assert(t_refused_with(format('SELECT redeem_supplier_invite(%L)', repeat('a', 64)), 'unavailable'), 'an unknown token is refused');
SELECT redeem_supplier_invite((:'i1'::jsonb)->>'token') AS r1 \gset
SELECT t_assert((:'r1'::jsonb) @> '{"duplicate":false,"membership_changed":false,"email_returned":false,
  "on_nuke":{"state":"not_on_nuke_yet"},"claim":{"writer":"claim_organization","domain_email_qualifies":true,"methods":["domain_email","document"]},
  "requirement":{"requirement_id":"56000000-0000-0000-0000-000000000001","still_open":true,"offer":{"writer":"offer_on_requirement"}}}'
  AND (:'r1'::jsonb)::text !~ '@', 'redeemed: claim methods (domain qualifies, address not shown) and the requirement to offer on');
SELECT t_assert(redeem_supplier_invite((:'i1'::jsonb)->>'token') @> '{"duplicate":true}', 'the redeemer can reopen it');
SELECT t_assert(claim_organization('20000000-0000-0000-0000-0000000000e1', 'domain_email') @> '{"state":"claimed","method":"domain_email"}',
  'the redeemer claims the business through the existing Sign');
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-0000000000b2","role":"authenticated"}', false);
SELECT t_assert(t_refused_with(format('SELECT redeem_supplier_invite(%L)', (:'i1'::jsonb)->>'token'), 'already used'), 'single use');
RESET ROLE;

-- 3. Expiry and the daily limit.
INSERT INTO organizations(id, business_name, is_public) VALUES ('20000000-0000-0000-0000-0000000000e2', 'Quiet Machine Shop', true);
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-00000000000c","role":"authenticated"}', false);
SELECT create_supplier_invite('20000000-0000-0000-0000-0000000000e2', '56000000-0000-0000-0000-000000000001') AS i2 \gset
RESET ROLE;
UPDATE supplier_invites SET created_at = now() - interval '20 days', expires_at = now() - interval '6 days' WHERE id = ((:'i2'::jsonb)->>'invite_id')::uuid;
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-0000000000b2","role":"authenticated"}', false);
SELECT t_assert(t_refused_with(format('SELECT redeem_supplier_invite(%L)', (:'i2'::jsonb)->>'token'), 'expired'), 'an expired invite is refused');
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-00000000000c","role":"authenticated"}', false);
SELECT count(*) FROM (SELECT create_supplier_invite('20000000-0000-0000-0000-0000000000e2', '56000000-0000-0000-0000-000000000001') FROM generate_series(1, 19)) x;
SELECT t_assert(t_refused_with($q$SELECT create_supplier_invite('20000000-0000-0000-0000-0000000000e2', '56000000-0000-0000-0000-000000000001')$q$, '20 per day'),
  'at most 20 invites a day');
RESET ROLE;

-- 4. Counts only.
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT t_assert(supplier_invites_summary() @> '{"created":21,"redeemed":1,"organizations_invited":2,"organizations_claimed_after_invite":1}'
  AND supplier_invites_summary()::text !~ '([0-9a-f]{64}|Paint Supply|@)', 'summary: counts only');
RESET ROLE;
