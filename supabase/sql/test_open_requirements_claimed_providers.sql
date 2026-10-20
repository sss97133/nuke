-- Disposable PG17 only. Proves 20261020102000_open_requirements_claimed_providers.sql as the job-loop replay applies it
-- (chained on the verified-claimant offers contract: X is AutoZone's verified claimant by domain e-mail, Y is No Website
-- Garage's by document): open_requirements_read and work_order_provider_matches_read count a verified claimant as a
-- provider for its organization: facility from its declared assets and evidence rung 'verified_claimant'; the
-- organization's paid-for service work and supply records are corroboration / supplier evidence, never a skill or
-- performer-tools pass (20261020155000, lead decision K3); people without a claim are unchanged and unclaimed
-- organizations stay Not on Nuke yet, not offer-capable.
\set ON_ERROR_STOP on
\ir test_verified_claimant_offers.sql

RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SELECT as_user(NULL);
-- J4: an open job of C's with a seat (skill), a primer tool and a lift bay (facility) requirement.
INSERT INTO work_orders(id, vehicle_id, customer_id, organization_id, title, description, status) VALUES
 ('ab000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000c', NULL,
  'Interior', '- Reupholster bench seat', 'pending');
INSERT INTO work_order_line_items(id, work_order_id, line_number, task_type, task_description, status) VALUES
 ('ab100000-0000-0000-0000-000000000004', 'ab000000-0000-0000-0000-000000000004', 1, 'other', 'Reupholster bench seat', 'pending');
INSERT INTO vehicle_observations(id, vehicle_id, kind, source_id, observed_at, extraction_method, structured_data)
SELECT x.id::uuid, '40000000-0000-0000-0000-000000000001', 'work_record', '90000000-0000-0000-0000-000000000001', '2026-03-02', 'requirement_interpretation_v1',
  jsonb_build_object('work_order_resource', jsonb_build_object('version', 1, 'event_type', 'requirement', 'work_order_id', 'ab000000-0000-0000-0000-000000000004',
    'line_item_id', 'ab100000-0000-0000-0000-000000000004', 'requirement_kind', x.k, 'description', x.d, 'quantity', 1, 'unit', 'job'))
FROM (VALUES ('ab200000-0000-0000-0000-000000000004', 'skill', 'Reupholster the bench seat'),
             ('ab200000-0000-0000-0000-000000000005', 'tool', 'Primer spray tool'),
             ('ab200000-0000-0000-0000-000000000006', 'facility', 'Lift bay for a day')) x(id, k, d);
SET ROLE service_role;
SELECT project_work_order_resource_observation('ab200000-0000-0000-0000-000000000004');
SELECT project_work_order_resource_observation('ab200000-0000-0000-0000-000000000005');
SELECT project_work_order_resource_observation('ab200000-0000-0000-0000-000000000006');
RESET ROLE;
-- AutoZone's records: paid upholstery service and primer (supply evidence); a declared lift.
INSERT INTO organization_supply_evidence(organization_id, basis_table, basis_id, supply_kind, observed_on, resolver) VALUES
 (:'az', 'receipts', 'a1000000-0000-0000-0000-0000000000f1', 'upholstery_service', '2025-02-01', 'reviewed_alias'),
 (:'az', 'receipts', 'a1000000-0000-0000-0000-0000000000f2', 'paint_materials', '2025-02-02', 'reviewed_alias')
ON CONFLICT DO NOTHING;
INSERT INTO equipment(id, shop_id, name, asset_kind, source, status, capacity, declared_by_user_id, declaration_observation_id) VALUES ('ab400000-0000-0000-0000-000000000001', :'az', 'Two-post lift', 'lift', 'member_declaration', 'in_service', 1, '10000000-0000-0000-0000-00000000000e', 'ab200000-0000-0000-0000-000000000004');

CREATE FUNCTION public.vc_match(p_req uuid, p_input text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT i FROM jsonb_array_elements(open_requirements_read(NULL, 100, NULL)->'rows') r, jsonb_array_elements(r->'match') i
  WHERE r->>'requirement_id' = p_req::text AND i->>'input' = p_input $$;
GRANT EXECUTE ON FUNCTION public.vc_match(uuid, text) TO authenticated;

SET ROLE authenticated;
SELECT vc_as('10000000-0000-0000-0000-0000000000a7');
SELECT vc_match('ab200000-0000-0000-0000-000000000004', 'skill') AS x_skill \gset
SELECT vc_match('ab200000-0000-0000-0000-000000000004', 'evidence_rung') AS x_rung \gset
SELECT vc_match('ab200000-0000-0000-0000-000000000005', 'tools') AS x_tools \gset
SELECT vc_match('ab200000-0000-0000-0000-000000000006', 'facility') AS x_fac \gset
SELECT vc_as('10000000-0000-0000-0000-0000000000a8');
SELECT vc_match('ab200000-0000-0000-0000-000000000004', 'skill') AS y_skill \gset
SELECT vc_match('ab200000-0000-0000-0000-000000000004', 'evidence_rung') AS y_rung \gset
SELECT vc_as('10000000-0000-0000-0000-0000000000a9');
SELECT vc_match('ab200000-0000-0000-0000-000000000004', 'evidence_rung') AS z_rung \gset
SELECT vc_match('ab200000-0000-0000-0000-000000000004', 'skill') AS z_skill \gset
RESET ROLE;
SELECT t_assert((:'x_skill'::jsonb)->>'result' <> 'pass'
  AND (:'x_skill'::jsonb)->'organization_corroboration' @> '[{"organization":{"name":"AutoZone"},"kind":"upholstery_service","records":1,"label":"paid for this kind of work 1 time","strength":"corroborating"}]'
  AND (:'x_rung'::jsonb) @> '{"result":"pass","rung":"verified_claimant","reason":"verified business claim (domain_email)"}',
  'open_requirements_read: AutoZone''s recorded upholstery work is corroboration, not a skill pass; the evidence rung passes');
SELECT t_assert((:'x_tools'::jsonb) @> '{"result":"unknown","role":"performer","basis":"organization_supplies_this_kind","supplier_evidence":[{"kind":"paint_materials","label":"can supply this"}]}',
  'supply records for the kind the requirement names are supplier evidence; performer tools stay unknown');
SELECT t_assert((:'x_fac'::jsonb)->>'result' = 'pass', 'facility passes on the claimed organization''s declared lift: ' || (:'x_fac'::jsonb)::text);
SELECT t_assert((:'y_rung'::jsonb) @> '{"result":"pass","reason":"verified business claim (document)"}'
  AND (:'y_skill'::jsonb)->>'result' <> 'pass', 'a document claimant passes the rung; no recorded work, no skill pass');
SELECT t_assert((:'z_rung'::jsonb)->>'result' = 'fail' AND (:'z_skill'::jsonb)->>'result' <> 'pass',
  'without a claim nothing changes');

SET ROLE authenticated;
SELECT vc_as('10000000-0000-0000-0000-00000000000c');
SELECT work_order_provider_matches_read('ab000000-0000-0000-0000-000000000004') AS pm \gset
RESET ROLE;
SELECT t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements((:'pm'::jsonb)->'providers') p
    WHERE p->'listed_because' ? 'verified_claimant'
      AND p->'offers_as' @> '[{"kind":"organization","name":"AutoZone","on_nuke":"Claimed on Nuke"}]'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(p->'requirements') q, jsonb_array_elements(q->'inputs') i
        WHERE q->>'requirement_id' = 'ab200000-0000-0000-0000-000000000004' AND i->>'input' = 'skill' AND i->>'result' <> 'pass'
          AND i->'organization_corroboration' @> '[{"kind":"upholstery_service"}]'))
  AND (:'pm'::jsonb)#>>'{coverage,population}' ~ 'verified business claim'
  AND position('parts@autozone.com' IN :'pm') = 0,
  'work_order_provider_matches_read lists the claimant offering as AutoZone (Claimed on Nuke), upholstery work as corroboration only; no address');
SELECT t_assert(NOT has_function_privilege('authenticated', 'verified_claimant_match_inputs(uuid,jsonb,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'verified_claimant_match_inputs(uuid,jsonb,jsonb)', 'EXECUTE'), 'the helper stays internal');

-- An organization without a claim stays Not on Nuke yet and not offer-capable.
INSERT INTO organizations(id, business_name, website, is_public) VALUES ('20000000-0000-0000-0000-0000000000e1', 'Unclaimed Trim Shop', 'https://trim.example', true);
SELECT t_assert(organization_on_nuke('20000000-0000-0000-0000-0000000000e1') @> '{"state":"not_on_nuke_yet","label":"Not on Nuke yet","offer_capable":false}'
  AND work_order_offer_eligibility('10000000-0000-0000-0000-0000000000a7', 'ab200000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-0000000000e1', NULL)
    @> '{"eligible":false,"reason":"not_organization_owner"}',
  'an unclaimed organization is Not on Nuke yet and nobody offers as it');
