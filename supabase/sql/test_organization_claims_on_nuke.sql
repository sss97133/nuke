-- Disposable PG17 only. Proves 20261020091000_organization_claims_on_nuke.sql as the job-loop replay applies it, with
-- 20261020101000_verified_claimant_offers.sql (claims recorded in organization_verified_claimants, not as organization
-- membership): a confirmed e-mail at an organization's website domain claims it without storing or returning the address;
-- free-mail, unconfirmed, look-alike and missing domains are refused; a document claim is pending until an owner-delegated,
-- registered review approves it; readers say "Claimed on Nuke" vs "Not on Nuke yet"; a contact request to an unclaimed
-- organization returns not_on_nuke_yet with an invite descriptor and sends nothing.
\set ON_ERROR_STOP on
\ir test_open_requirements_plan_b_suppliers.sql

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT COALESCE(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT COALESCE(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub', nullif(current_setting('test.auth_uid', true), ''))::uuid $$;
GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid() TO anon, authenticated, service_role;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email text, ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_anonymous boolean, ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz;
ALTER TABLE organization_contributors ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
  ADD CONSTRAINT fixture_oc_unique UNIQUE (organization_id, user_id);
-- X works at AutoZone (confirmed), Y uses free mail, Z is unconfirmed at the domain, L is at a look-alike host; O is the owner.
INSERT INTO auth.users(id, email, email_confirmed_at, last_sign_in_at) VALUES
 ('10000000-0000-0000-0000-0000000000a7', 'parts@autozone.com', '2026-10-01', '2026-10-01'),
 ('10000000-0000-0000-0000-0000000000a8', 'someone@gmail.com', '2026-10-01', '2026-10-01'),
 ('10000000-0000-0000-0000-0000000000a9', 'new@autozone.com', NULL, NULL),
 ('10000000-0000-0000-0000-0000000000aa', 'x@autozone.com.example.net', '2026-10-01', '2026-10-01'),
 ('0b9f107a-d124-49de-9ded-94698f63c1c4', 'owner@example.invalid', '2026-10-01', '2026-10-01');
INSERT INTO profiles(id, username, is_public) VALUES ('10000000-0000-0000-0000-0000000000a7', 'az_parts', true),
 ('10000000-0000-0000-0000-0000000000a8', 'free_mail', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO admin_users(user_id, is_active) VALUES ('0b9f107a-d124-49de-9ded-94698f63c1c4', true);
INSERT INTO organizations(id, business_name, is_public) VALUES ('20000000-0000-0000-0000-0000000000d1', 'No Website Garage', true);
SELECT id AS az FROM organizations WHERE website = 'https://autozone.com' \gset
UPDATE organizations SET is_public = true WHERE id = :'az';

SELECT t_assert(has_function_privilege('authenticated', 'claim_organization(uuid,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'claim_organization(uuid,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'approve_organization_claim_owner_agent(uuid,text,text,text)', 'EXECUTE')
  AND has_function_privilege('anon', 'organization_on_nuke(uuid)', 'EXECUTE'), 'grants');

-- 1. Readers before any claim.
SELECT t_assert(organization_on_nuke(:'az') @> '{"state":"not_on_nuke_yet","label":"Not on Nuke yet","members_active":0,
  "claim":{"writer":"claim_organization","methods":["domain_email","document"],"domain":"autozone.com"}}', 'AutoZone: not on Nuke yet, claimable by domain e-mail');
SELECT t_assert(organization_on_nuke('20000000-0000-0000-0000-0000000000d1') @> '{"state":"not_on_nuke_yet","claim":{"methods":["document"],"domain":null}}',
  'no website: document only');
SELECT t_assert(organization_on_nuke('20000000-0000-0000-0000-000000000001') @> '{"state":"claimed","label":"Claimed on Nuke"}', 'the fixture shop (active owner) is claimed');
SELECT t_assert(requirement_plan_b_suppliers('Paint touch-up for the door') @> '[{"organization":{"name":"AutoZone"},"can_receive_requests":false,
  "on_nuke":{"state":"not_on_nuke_yet"}}]', 'plan-B entries say the supplier cannot receive requests yet');
SET ROLE anon;
SELECT as_user(NULL);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT t_assert(facility_read(:'az') @> '{"on_nuke":{"state":"not_on_nuke_yet"}}', 'facility_read shows Not on Nuke yet');
SELECT t_assert(organization_supply_read(:'az') @> '{"on_nuke":{"state":"not_on_nuke_yet"}}', 'organization_supply_read shows it too');
RESET ROLE;

-- 2. Contact to an unclaimed business: explicit, nothing sent.
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-0000000000a8');
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-0000000000a8","role":"authenticated"}', false);
SELECT request_contact('requirement', '56000000-0000-0000-0000-000000000001', 'Do you have primer?', NULL, NULL, :'az') AS rc1 \gset
RESET ROLE;
SELECT t_assert((:'rc1'::jsonb) @> '{"available":false,"reason":"not_on_nuke_yet","status":"not_sent","delivery":"none",
  "invite":{"rpc":"create_supplier_invite","args":{"p_requirement_id":"56000000-0000-0000-0000-000000000001"}}}'
  AND (SELECT count(*) FROM contact_requests WHERE recipient_organization_id = :'az') = 0, 'not_on_nuke_yet with an invite descriptor; no request stored');

-- 3. Domain e-mail claims.
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-0000000000a8","role":"authenticated"}', false);
SELECT t_assert(t_refused_with(format('SELECT claim_organization(%L, %L)', :'az', 'domain_email'), 'not at this organization'), 'free mail does not match');
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-0000000000a9","role":"authenticated"}', false);
SELECT t_assert(t_refused_with(format('SELECT claim_organization(%L, %L)', :'az', 'domain_email'), 'not at this organization'), 'an unconfirmed e-mail does not count');
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-0000000000aa","role":"authenticated"}', false);
SELECT t_assert(t_refused_with(format('SELECT claim_organization(%L, %L)', :'az', 'domain_email'), 'not at this organization'), 'a look-alike host does not match');
SELECT t_assert(t_refused_with($q$SELECT claim_organization('20000000-0000-0000-0000-0000000000d1', 'domain_email')$q$, 'no website domain'), 'no website, no domain claim');
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-0000000000a7","role":"authenticated"}', false);
SELECT claim_organization(:'az', 'domain_email') AS c1 \gset
SELECT t_assert((:'c1'::jsonb) @> '{"state":"claimed","method":"domain_email","role":"verified_claimant","domain":"autozone.com","email_returned":false,
  "on_nuke":{"state":"claimed","owners_active":0,"verified_claimants":1,"claimed_via":["domain_email"]}}' AND (:'c1'::jsonb)::text !~ '@',
  'claimed as a verified claimant; no address returned');
SELECT t_assert(claim_organization(:'az', 'domain_email') @> '{"duplicate":true}', 'a second claim is a duplicate');
SELECT t_assert(t_refused_with(format('SELECT claim_organization(%L, %L)', :'az', 'fax'), 'Method'), 'method vocabulary');
RESET ROLE;
SELECT t_assert((SELECT method = 'domain_email' AND revoked_at IS NULL AND claim_evidence::text !~ '@'
  AND claim_evidence @> '{"domain":"autozone.com","match":"exact"}' FROM organization_verified_claimants WHERE organization_id = :'az'
  AND user_id = '10000000-0000-0000-0000-0000000000a7')
  AND NOT EXISTS (SELECT 1 FROM organization_contributors WHERE user_id = '10000000-0000-0000-0000-0000000000a7'),
  'the claim records the method and domain, never the address, and is not an organization membership');
SELECT t_assert(requirement_plan_b_suppliers('Paint touch-up for the door') @> '[{"organization":{"name":"AutoZone"},"can_receive_requests":true}]',
  'plan-B: AutoZone can now receive requests');

-- 4. Contact now reaches the claimed business.
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-0000000000a8","role":"authenticated"}', false);
SELECT t_assert(request_contact('requirement', '56000000-0000-0000-0000-000000000001', 'Do you have primer?', NULL, NULL, :'az') @> '{"status":"pending","delivery":"in_app"}',
  'after the claim the request is delivered in app');

-- 5. Document claims: pending until an owner-delegated review.
SELECT t_assert(t_refused_with($q$SELECT claim_organization('20000000-0000-0000-0000-0000000000d1', 'document', '{"verification_type":"selfie","document_url":"https://x"}')$q$,
  'verification_type'), 'document type vocabulary');
SELECT t_assert(t_refused_with($q$SELECT claim_organization('20000000-0000-0000-0000-0000000000d1', 'document', '{"verification_type":"business_license","document_url":"http://x"}')$q$,
  'https'), 'https document required');
SELECT claim_organization('20000000-0000-0000-0000-0000000000d1', 'document', '{"verification_type":"business_license","document_url":"https://docs.example.invalid/license.pdf"}') AS d1 \gset
SELECT t_assert((:'d1'::jsonb) @> '{"state":"pending_review","method":"document","duplicate":false}'
  AND organization_on_nuke('20000000-0000-0000-0000-0000000000d1') @> '{"state":"not_on_nuke_yet"}', 'document claim pending; nothing granted');
SELECT t_assert(claim_organization('20000000-0000-0000-0000-0000000000d1', 'document', '{"verification_type":"business_license","document_url":"https://docs.example.invalid/license.pdf"}')
  @> '{"duplicate":true}', 'a repeat document claim is a duplicate');
RESET ROLE;
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT t_assert(t_refused_with(format('SELECT approve_organization_claim_owner_agent(%L, %L, %L)', (:'d1'::jsonb)->>'verification_id', 'ok', 'q'), '10 to 2000'),
  'the reviewer states what the document shows');
SELECT approve_organization_claim_owner_agent(((:'d1'::jsonb)->>'verification_id')::uuid, 'Nevada business license naming No Website Garage, current through 2027',
  'dude its fine', 'agent-test') AS a1 \gset
RESET ROLE;
SELECT t_assert((:'a1'::jsonb) @> '{"state":"claimed","role":"verified_claimant","reviewer":"agent_on_behalf_of_owner"}'
  AND (SELECT status = 'approved' AND human_reviewer_id = '0b9f107a-d124-49de-9ded-94698f63c1c4' FROM organization_ownership_verifications
    WHERE id = ((:'a1'::jsonb)->>'verification_id')::uuid)
  AND EXISTS (SELECT 1 FROM owner_delegated_signs WHERE rpc = 'approve_organization_claim_owner_agent' AND result_ref = (:'a1'::jsonb)->>'verification_id')
  AND organization_on_nuke('20000000-0000-0000-0000-0000000000d1') @> '{"state":"claimed","claimed_via":["document"]}',
  'approved on the owner''s behalf, registered, verified claimant by document');
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"0b9f107a-d124-49de-9ded-94698f63c1c4","role":"authenticated"}', false);
SELECT claim_organization(:'az', 'document', '{"verification_type":"tax_id","document_url":"https://docs.example.invalid/ein.pdf"}') AS d2 \gset
RESET ROLE;
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT t_assert(t_refused_with(format('SELECT approve_organization_claim_owner_agent(%L, %L, %L)', (:'d2'::jsonb)->>'verification_id',
  'EIN letter naming AutoZone', 'q'), 'other than the owner'), 'the owner''s own document claim is not an agent review');
RESET ROLE;
