-- Disposable PG17 only. Proves 20261020101000_verified_claimant_offers.sql as the job-loop replay applies it (chained on
-- the organization-claims contract, where X claimed AutoZone by domain e-mail and Y's document claim was approved): claims
-- are kept in their own register, not organization_contributors, and still read "Claimed on Nuke"; a verified claimant offers as the organization on an open
-- requirement at rung verified_claimant (recorded on the signed offer) and the offers reader shows it as the organization;
-- the claimant cannot offer on, read or sign the organization's own private job and sees no customer contact; after the
-- customer accepts, the claimant quotes, starts, attests completion and invoices that job only.
\set ON_ERROR_STOP on
\ir test_organization_claims_on_nuke.sql

RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SELECT as_user(NULL);

SELECT t_assert(NOT EXISTS (SELECT 1 FROM organization_contributors WHERE claim_evidence ? 'method')
  AND (SELECT count(*) FROM organization_verified_claimants) = 2
  AND EXISTS (SELECT 1 FROM organization_verified_claimants WHERE organization_id = :'az' AND user_id = '10000000-0000-0000-0000-0000000000a7'
    AND method = 'domain_email' AND claim_evidence @> '{"domain":"autozone.com"}')
  AND EXISTS (SELECT 1 FROM organization_verified_claimants WHERE organization_id = '20000000-0000-0000-0000-0000000000d1'
    AND user_id = '10000000-0000-0000-0000-0000000000a8' AND method = 'document'),
  'claims (domain e-mail and approved document) are in the claimant register, not organization_contributors');
SELECT t_assert(organization_on_nuke(:'az') @> '{"state":"claimed","label":"Claimed on Nuke","members_active":0,"owners_active":0,
  "verified_claimants":1,"claimed_via":["domain_email"],"offer_capable":true}', 'a claimed organization still reads Claimed on Nuke, as a verified claimant');
SELECT t_assert(contact_recipient_users(NULL, NULL, :'az') = ARRAY['10000000-0000-0000-0000-0000000000a7']::uuid[]
  AND requirement_plan_b_suppliers('Paint touch-up for the door') @> '[{"organization":{"name":"AutoZone"},"can_receive_requests":true}]',
  'the claimant receives requests addressed to the organization; Plan-B lists it as reachable');
SELECT t_assert(NOT has_table_privilege('authenticated', 'organization_verified_claimants', 'SELECT')
  AND NOT has_table_privilege('anon', 'organization_verified_claimants', 'SELECT')
  AND NOT has_function_privilege('anon', 'organization_verified_claimant(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'organization_claim_grant(uuid,uuid,text,jsonb)', 'EXECUTE'),
  'the register is service-only; the grant stays internal');

-- J1: an open job (public vehicle) for customer C. J2: AutoZone's own invite-only job for another customer, contact on file.
-- J3: another job of C's on the public vehicle that C unpublishes (invite_only).
INSERT INTO work_orders(id, vehicle_id, customer_id, organization_id, customer_name, customer_phone, customer_email, title, description, status) VALUES
 ('ab000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000c', NULL,
  'Claim Fixture Customer', '+15550199', 'claimfix@example.invalid', 'Seat', '- Recover driver seat', 'pending'),
 ('ab000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000b', :'az',
  'Private Customer', '+15550198', 'private@example.invalid', 'Parts run', '- Source primer', 'pending'),
 ('ab000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000c', NULL,
  NULL, NULL, NULL, 'Trim', '- Recover door panels', 'pending');
INSERT INTO work_order_line_items(id, work_order_id, line_number, task_type, task_description, status) VALUES
 ('ab100000-0000-0000-0000-000000000001', 'ab000000-0000-0000-0000-000000000001', 1, 'other', 'Recover driver seat', 'pending'),
 ('ab100000-0000-0000-0000-000000000002', 'ab000000-0000-0000-0000-000000000002', 1, 'other', 'Source primer', 'pending'),
 ('ab100000-0000-0000-0000-000000000003', 'ab000000-0000-0000-0000-000000000003', 1, 'other', 'Recover door panels', 'pending');
INSERT INTO vehicle_observations(id, vehicle_id, kind, source_id, observed_at, extraction_method, structured_data) VALUES
 ('ab200000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'work_record', '90000000-0000-0000-0000-000000000001', '2026-03-02',
  'requirement_interpretation_v1', jsonb_build_object('work_order_resource', jsonb_build_object('version', 1, 'event_type', 'requirement',
   'work_order_id', 'ab000000-0000-0000-0000-000000000001', 'line_item_id', 'ab100000-0000-0000-0000-000000000001', 'requirement_kind', 'skill',
   'description', 'Recover the driver seat', 'quantity', 1, 'unit', 'job'))),
 ('ab200000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 'work_record', '90000000-0000-0000-0000-000000000001', '2026-03-02',
  'requirement_interpretation_v1', jsonb_build_object('work_order_resource', jsonb_build_object('version', 1, 'event_type', 'requirement',
   'work_order_id', 'ab000000-0000-0000-0000-000000000002', 'line_item_id', 'ab100000-0000-0000-0000-000000000002', 'requirement_kind', 'skill',
   'description', 'Source and apply primer', 'quantity', 1, 'unit', 'job'))),
 ('ab200000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', 'work_record', '90000000-0000-0000-0000-000000000001', '2026-03-02',
  'requirement_interpretation_v1', jsonb_build_object('work_order_resource', jsonb_build_object('version', 1, 'event_type', 'requirement',
   'work_order_id', 'ab000000-0000-0000-0000-000000000003', 'line_item_id', 'ab100000-0000-0000-0000-000000000003', 'requirement_kind', 'skill',
   'description', 'Recover the door panels', 'quantity', 1, 'unit', 'job')));
SET ROLE service_role;
SELECT project_work_order_resource_observation('ab200000-0000-0000-0000-000000000001');
SELECT project_work_order_resource_observation('ab200000-0000-0000-0000-000000000002');
SELECT project_work_order_resource_observation('ab200000-0000-0000-0000-000000000003');
RESET ROLE;
-- X has linked a work actor (their own technician identity); 60000000-...-0001 is someone else's.
INSERT INTO actors(id, name, actor_type) VALUES ('ab300000-0000-0000-0000-000000000001', 'AZ Seat Tech', 'person');
INSERT INTO account_link_claims(user_id, platform, handle, status, verification_method, actor_id) VALUES
 ('10000000-0000-0000-0000-0000000000a7', 'nuke_actor', 'ab300000-0000-0000-0000-000000000001', 'pending', 'self_claim', 'ab300000-0000-0000-0000-000000000001');

CREATE FUNCTION public.vc_as(p uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub', p, 'role', 'authenticated')::text, false), as_user(p) $$;
CREATE FUNCTION public.vc_terms(p_actor uuid DEFAULT 'ab300000-0000-0000-0000-000000000001', p_org uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
  SELECT jsonb_build_object('organization_id', COALESCE(p_org, (SELECT id FROM organizations WHERE website = 'https://autozone.com')),
    'performer_actor_id', p_actor, 'lines', jsonb_build_array(jsonb_build_object('description', 'Recover driver seat in vinyl',
      'pricing_basis', 'flat', 'amount', 300, 'currency', 'USD', 'unit', NULL, 'quantity', NULL))) $$;
CREATE FUNCTION public.vc_lines() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(jsonb_build_object('ref_kind', 'operation', 'ref_id', 'ab100000-0000-0000-0000-000000000001',
    'description', 'Recover driver seat', 'pricing_basis', 'flat', 'amount', 300, 'currency', 'USD', 'unit', NULL, 'quantity', NULL)) $$;
GRANT EXECUTE ON FUNCTION public.vc_as(uuid), public.vc_terms(uuid, uuid), public.vc_lines() TO authenticated;

-- Eligibility: who may offer as AutoZone, and where.
SELECT t_assert(work_order_offer_eligibility('10000000-0000-0000-0000-0000000000a7', 'ab200000-0000-0000-0000-000000000001', :'az',
    'ab300000-0000-0000-0000-000000000001') @> '{"eligible":true,"offer_kind":"organization","rung":"verified_claimant"}'
  AND work_order_offer_eligibility('10000000-0000-0000-0000-0000000000a8', 'ab200000-0000-0000-0000-000000000001', :'az',
    'ab300000-0000-0000-0000-000000000001') @> '{"eligible":false,"reason":"not_organization_owner"}'
  AND work_order_offer_eligibility('10000000-0000-0000-0000-0000000000a7', 'ab200000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001', 'ab300000-0000-0000-0000-000000000001') @> '{"eligible":false,"reason":"not_organization_owner"}'
  AND work_order_offer_eligibility('10000000-0000-0000-0000-0000000000a7', 'ab200000-0000-0000-0000-000000000001', :'az',
    '60000000-0000-0000-0000-000000000001') @> '{"eligible":false,"reason":"actor_not_linked_to_account"}'
  AND work_order_offer_eligibility('10000000-0000-0000-0000-0000000000a7', 'ab200000-0000-0000-0000-000000000001', :'az', NULL)
    @> '{"eligible":false,"reason":"organization_offer_needs_facility_or_named_performer"}'
  AND work_order_offer_eligibility('10000000-0000-0000-0000-0000000000a7', 'ab200000-0000-0000-0000-000000000002', :'az',
    'ab300000-0000-0000-0000-000000000001') @> '{"eligible":false}',
  'eligibility: only the verified claimant, only for its organization, only with its own linked performer, not on the private job');
SET ROLE authenticated;
SELECT vc_as('10000000-0000-0000-0000-00000000000c');
SELECT unpublish_work_order('ab000000-0000-0000-0000-000000000003') AS unp \gset
RESET ROLE;
SELECT t_assert(work_order_offer_eligibility('10000000-0000-0000-0000-0000000000a7', 'ab200000-0000-0000-0000-000000000003', :'az',
    'ab300000-0000-0000-0000-000000000001') @> '{"eligible":false,"reason":"verified_claimants_offer_on_open_requirements_only"}'
  AND (SELECT request_visibility FROM work_orders WHERE id = 'ab000000-0000-0000-0000-000000000003') = 'invite_only',
  'an invite_only job is not open to verified claimants');
SELECT t_assert(work_order_offer_eligibility('10000000-0000-0000-0000-00000000000e', 'ab200000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001') @> '{"eligible":true,"rung":"organization_owner"}',
  'the business owner path is unchanged');

-- The claimant offers as AutoZone on the open requirement and is refused on the private one.
SET ROLE authenticated;
SELECT vc_as('10000000-0000-0000-0000-0000000000a7');
SELECT t_assert(t_refused_with($q$SELECT offer_on_requirement('ab200000-0000-0000-0000-000000000002', vc_terms())$q$, 'Offer unavailable'),
  'no offer on the organization''s private job');
SELECT t_assert(t_refused($q$SELECT issue_work_order_quote('ab000000-0000-0000-0000-000000000001', vc_lines())$q$),
  'no quote before the customer accepts an offer');
SELECT offer_on_requirement('ab200000-0000-0000-0000-000000000001', vc_terms(), NULL, NULL, 'AutoZone seat shop can take it') AS vo \gset
RESET ROLE;
SELECT t_assert((:'vo'::jsonb) @> jsonb_build_object('offer_kind', 'organization', 'offer_rung', 'verified_claimant', 'supplier_organization_id', :'az',
    'performer_actor_id', 'ab300000-0000-0000-0000-000000000001', 'duplicate', false, 'payment_authorized', false)
  AND (SELECT structured_data#>>'{work_order_resource,offer_rung}' = 'verified_claimant' AND submitted_by_user_id = '10000000-0000-0000-0000-0000000000a7'
    FROM vehicle_observations WHERE id = ((:'vo'::jsonb)->>'offer_id')::uuid),
  'offer_on_requirement as AutoZone at rung verified_claimant, recorded on the signed offer');

SET ROLE authenticated;
SELECT vc_as('10000000-0000-0000-0000-00000000000c');
SELECT work_order_offers_read('ab000000-0000-0000-0000-000000000001') AS orr \gset
RESET ROLE;
SELECT t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements((:'orr'::jsonb)->'requirements') r, jsonb_array_elements(r->'offers') o
    WHERE o->>'offer_id' = (:'vo'::jsonb)->>'offer_id'
      AND o->'provider' @> jsonb_build_object('kind', 'organization', 'name', 'AutoZone', 'on_nuke', 'Claimed on Nuke', 'evidence_rung', 'verified_claimant')),
  'the customer sees the offer from AutoZone, Claimed on Nuke, rung verified_claimant');

-- The customer accepts; the claimant quotes, starts, attests and invoices that job.
SET ROLE authenticated;
SELECT vc_as('10000000-0000-0000-0000-00000000000c');
SELECT accept_offer(((:'vo'::jsonb)->>'offer_id')::uuid, (:'vo'::jsonb)->>'offer_hash') AS va \gset
SELECT vc_as('10000000-0000-0000-0000-0000000000a7');
SELECT issue_work_order_quote('ab000000-0000-0000-0000-000000000001', vc_lines(), NULL, now() + interval '30 days') AS vq \gset
SELECT vc_as('10000000-0000-0000-0000-00000000000c');
SELECT accept_work_order_quote(((:'vq'::jsonb)->>'quote_id')::uuid, (:'vq'::jsonb)->>'quote_hash') AS vqa \gset
SELECT vc_as('10000000-0000-0000-0000-0000000000a7');
SELECT start_work('ab000000-0000-0000-0000-000000000001', (:'vq'::jsonb)->>'quote_hash') AS vs \gset
SELECT attest_work_completion('ab000000-0000-0000-0000-000000000001', (:'vq'::jsonb)->>'quote_hash', 'Seat recovered') AS vat \gset
SELECT vc_as('10000000-0000-0000-0000-00000000000c');
SELECT accept_work_completion('ab000000-0000-0000-0000-000000000001', ((:'vat'::jsonb)->>'completion_id')::uuid, (:'vat'::jsonb)->>'completion_hash') AS vac \gset
SELECT vc_as('10000000-0000-0000-0000-0000000000a7');
SELECT issue_work_order_invoice('ab000000-0000-0000-0000-000000000001', jsonb_build_array(jsonb_build_object('quote_line', 0,
  'description', 'Recover driver seat', 'pricing_basis', 'flat', 'amount', 300, 'currency', 'USD')), ((:'vq'::jsonb)->>'quote_id')::uuid) AS vi \gset
SELECT work_order_job_path_read('ab000000-0000-0000-0000-000000000001') AS vjp \gset
RESET ROLE;
SELECT t_assert((:'va'::jsonb) @> '{"duplicate":false,"payment_authorized":false}'
  AND (:'vq'::jsonb)->>'quote_id' IS NOT NULL AND (:'vqa'::jsonb) @> '{"duplicate":false}'
  AND (:'vs'::jsonb)->>'start_id' IS NOT NULL AND (:'vat'::jsonb)->>'completion_id' IS NOT NULL
  AND (:'vac'::jsonb) @> '{"signer_role":"customer"}'
  AND (:'vi'::jsonb) @> '{"total":300,"issuer_role":"accepted_provider","payment_authorized":false,"money_moved":false}',
  'after acceptance the claimant quotes, starts, attests completion and invoices the job');
SELECT t_assert(work_order_quote_issuer_role('10000000-0000-0000-0000-0000000000a7', 'ab000000-0000-0000-0000-000000000001') = 'accepted_provider'
  AND work_order_completion_signer_role('ab000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a7') = 'accepted_provider',
  'on that job the claimant signs as its accepted provider');
SELECT t_assert(position('claimfix@example.invalid' IN :'vjp') = 0 AND position('+15550199' IN :'vjp') = 0
  AND position('Claim Fixture Customer' IN :'vjp') = 0 AND position('claimfix@' IN :'orr') = 0,
  'the job path and offers read carry no customer contact for the claimant');

-- Nothing else of AutoZone's opens to the claimant.
SET ROLE authenticated;
SELECT vc_as('10000000-0000-0000-0000-0000000000a7');
SELECT t_assert(NOT work_order_is_accessible('ab000000-0000-0000-0000-000000000002')
  AND t_refused($q$SELECT work_order_job_path_read('ab000000-0000-0000-0000-000000000002')$q$)
  AND t_refused($q$SELECT issue_work_order_quote('ab000000-0000-0000-0000-000000000002', vc_lines())$q$)
  AND t_refused($q$SELECT attest_work_completion('ab000000-0000-0000-0000-000000000002', NULL, 'x')$q$)
  AND t_refused($q$SELECT issue_work_order_invoice('ab000000-0000-0000-0000-000000000002', vc_lines())$q$),
  'the claimant cannot read, quote, attest or invoice AutoZone''s private job');
RESET ROLE;
SELECT t_assert(cardinality(COALESCE((SELECT slots FROM work_order_viewer_slots('10000000-0000-0000-0000-0000000000a7', 'ab000000-0000-0000-0000-000000000002')), '{}')) = 0
  AND work_order_completion_signer_role('ab000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-0000000000a7') IS NULL
  AND work_order_quote_issuer_role('10000000-0000-0000-0000-0000000000a7', 'ab000000-0000-0000-0000-000000000002') IS DISTINCT FROM 'organization_owner'
  AND NOT EXISTS (SELECT 1 FROM organization_contributors WHERE user_id = '10000000-0000-0000-0000-0000000000a7'),
  'a claimant is not an organization member or owner for any other job');
SET ROLE authenticated;
SELECT vc_as('10000000-0000-0000-0000-0000000000a7');
SELECT claim_organization(:'az', 'domain_email') AS dup \gset
RESET ROLE;
SELECT t_assert((:'dup'::jsonb) @> '{"duplicate":true,"state":"claimed"}', 'claim_organization sees the register (duplicate)');
