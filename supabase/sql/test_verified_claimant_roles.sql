-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations (chained on the verified-claimant contract,
-- itself on the job-loop replay). 20261020155000: a verified claimant's organization supply evidence never passes skill or
-- performer tools; it shows as corroboration / supplier evidence; Plan-B suppliers pass as 'can supply this'; skill passes on
-- completions the organization performed through Nuke and the customer accepted. Declared assets passing facility for claimed
-- organizations is proven by test_open_requirements_claimed_providers (unchanged here).
\ir test_verified_claimant_offers.sql

-- J4: a 'recover seats' job AutoZone's claimant (a7) performs through Nuke and the customer (0c) accepts.
-- J5: an open job of 0c's with four requirements: recover seats (skill), header polish (skill), bead roller tool (tool), vehicle lift (facility).
INSERT INTO work_orders(id, vehicle_id, customer_id, title, description, status) VALUES
 ('ab000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000c', 'Seats', '- recover seats', 'pending'),
 ('ab000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000c', 'Mixed', '- several', 'pending');
INSERT INTO work_order_line_items(id, work_order_id, line_number, task_type, task_description, status) VALUES
 ('ab100000-0000-0000-0000-000000000004', 'ab000000-0000-0000-0000-000000000004', 1, 'other', 'recover seats', 'pending'),
 ('ab100000-0000-0000-0000-000000000005', 'ab000000-0000-0000-0000-000000000005', 1, 'other', 'recover seats', 'pending'),
 ('ab100000-0000-0000-0000-000000000006', 'ab000000-0000-0000-0000-000000000005', 2, 'clean', 'Header polish/cleaning (muriatic acid bath)', 'pending'),
 ('ab100000-0000-0000-0000-000000000007', 'ab000000-0000-0000-0000-000000000005', 3, 'other', 'Roll beads in the floor pan', 'pending');
INSERT INTO vehicle_observations(id, vehicle_id, kind, source_id, observed_at, extraction_method, structured_data)
SELECT r.id::uuid, '40000000-0000-0000-0000-000000000001', 'work_record', '90000000-0000-0000-0000-000000000001', '2026-03-02', 'requirement_interpretation_v1',
  jsonb_build_object('work_order_resource', jsonb_build_object('version', 1, 'event_type', 'requirement', 'work_order_id', r.wo, 'line_item_id', r.li,
    'requirement_kind', r.kind, 'description', r.descr, 'quantity', 1, 'unit', 'job'))
FROM (VALUES ('ab200000-0000-0000-0000-000000000004', 'ab000000-0000-0000-0000-000000000004', 'ab100000-0000-0000-0000-000000000004', 'skill', 'recover seats'),
  ('ab200000-0000-0000-0000-000000000005', 'ab000000-0000-0000-0000-000000000005', 'ab100000-0000-0000-0000-000000000005', 'skill', 'recover seats'),
  ('ab200000-0000-0000-0000-000000000006', 'ab000000-0000-0000-0000-000000000005', 'ab100000-0000-0000-0000-000000000006', 'skill', 'Header polish/cleaning (muriatic acid bath)'),
  ('ab200000-0000-0000-0000-000000000007', 'ab000000-0000-0000-0000-000000000005', 'ab100000-0000-0000-0000-000000000007', 'tool', 'Bead roller tool'),
  ('ab200000-0000-0000-0000-000000000008', 'ab000000-0000-0000-0000-000000000005', 'ab100000-0000-0000-0000-000000000007', 'facility', 'Vehicle lift')) r(id, wo, li, kind, descr);
SET ROLE service_role;
SELECT project_work_order_resource_observation(x::uuid) FROM unnest(ARRAY['ab200000-0000-0000-0000-000000000004', 'ab200000-0000-0000-0000-000000000005',
  'ab200000-0000-0000-0000-000000000006', 'ab200000-0000-0000-0000-000000000007', 'ab200000-0000-0000-0000-000000000008']) x;
RESET ROLE;
-- AutoZone's receipts: paid for plating service twice, supplied tools three times.
INSERT INTO organization_supply_evidence(organization_id, basis_table, basis_id, supply_kind, resolver) VALUES
 (:'az', 'receipts', 'b1000000-0000-0000-0000-000000000001', 'plating_service', 'reviewed_alias'),
 (:'az', 'receipts', 'b1000000-0000-0000-0000-000000000002', 'plating_service', 'reviewed_alias'),
 (:'az', 'receipts', 'b1000000-0000-0000-0000-000000000003', 'tools', 'reviewed_alias'),
 (:'az', 'receipts', 'b1000000-0000-0000-0000-000000000004', 'tools', 'reviewed_alias'),
 (:'az', 'receipts', 'b1000000-0000-0000-0000-000000000005', 'tools', 'reviewed_alias');

CREATE FUNCTION pg_temp.inp(p_req text, p_input text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT m FROM jsonb_array_elements(open_requirements_read(NULL, 100, NULL)->'rows') r, jsonb_array_elements(r->'match') m
  WHERE r->>'requirement_id' = p_req AND m->>'input' = p_input $$;
CREATE FUNCTION pg_temp.row_of(p_req text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT r FROM jsonb_array_elements(open_requirements_read(NULL, 100, NULL)->'rows') r WHERE r->>'requirement_id' = p_req $$;

-- Before J4 completes: the claimant's 'recover seats' skill has no basis to pass.
SET ROLE authenticated;
SELECT vc_as('10000000-0000-0000-0000-0000000000a7');
SELECT pg_temp.inp('ab200000-0000-0000-0000-000000000005', 'skill') AS s0 \gset
SELECT pg_temp.inp('ab200000-0000-0000-0000-000000000006', 'skill') AS polish \gset
SELECT pg_temp.inp('ab200000-0000-0000-0000-000000000007', 'tools') AS tools \gset
SELECT pg_temp.inp('ab200000-0000-0000-0000-000000000008', 'evidence_rung') AS rung \gset
SELECT pg_temp.row_of('ab200000-0000-0000-0000-000000000007') AS toolrow \gset
RESET ROLE;
SELECT t_assert((:'s0'::jsonb)->>'result' <> 'pass', 'no accepted completion yet: recover seats does not pass');
SELECT t_assert((:'polish'::jsonb)->>'result' = 'unknown' AND (:'polish'::jsonb)->>'basis' IS DISTINCT FROM 'verified_claimant'
 AND (:'polish'::jsonb)->'organization_corroboration' @> '[{"kind":"plating_service","records":2,"label":"paid for this kind of work 2 times","strength":"corroborating"}]',
 'parts-store claimant paid for plating twice: skill stays unknown, shown as corroboration (no pass)');
SELECT t_assert((:'tools'::jsonb) @> '{"result":"unknown","role":"performer","basis":"organization_supplies_this_kind","supplier_evidence":[{"kind":"tools","records":3,"label":"can supply this"}]}',
 'supplying tools is not having the tool for the work: performer tools unknown with the supplier evidence');
SELECT t_assert((:'toolrow'::jsonb)->>'match_role' = 'performer'
 AND (:'toolrow'::jsonb)->'plan_b_suppliers' @> '[{"organization":{"name":"AutoZone"},"role":"plan_b_supplier","supplier_result":"pass","supplier_label":"can supply this"}]',
 'the same organization appears as a Plan-B supplier that can supply this');
SELECT t_assert((:'rung'::jsonb) @> '{"result":"pass","rung":"verified_claimant"}',
 'the verified claim still passes the evidence rung (declared assets: test_open_requirements_claimed_providers)');

-- J4 through Nuke: offer as AutoZone, accept, quote, accept, start, attest, accept completion.
SET ROLE authenticated;
SELECT vc_as('10000000-0000-0000-0000-0000000000a7');
SELECT offer_on_requirement('ab200000-0000-0000-0000-000000000004', vc_terms(), NULL, NULL, 'Seat shop') AS o4 \gset
SELECT vc_as('10000000-0000-0000-0000-00000000000c');
SELECT accept_offer(((:'o4'::jsonb)->>'offer_id')::uuid, (:'o4'::jsonb)->>'offer_hash') AS a4 \gset
SELECT vc_as('10000000-0000-0000-0000-0000000000a7');
SELECT issue_work_order_quote('ab000000-0000-0000-0000-000000000004', jsonb_build_array(jsonb_build_object('ref_kind', 'operation',
  'ref_id', 'ab100000-0000-0000-0000-000000000004', 'description', 'Recover seats', 'pricing_basis', 'flat', 'amount', 300, 'currency', 'USD',
  'unit', NULL, 'quantity', NULL)), NULL, now() + interval '30 days') AS q4 \gset
SELECT vc_as('10000000-0000-0000-0000-00000000000c');
SELECT accept_work_order_quote(((:'q4'::jsonb)->>'quote_id')::uuid, (:'q4'::jsonb)->>'quote_hash') AS qa4 \gset
SELECT vc_as('10000000-0000-0000-0000-0000000000a7');
SELECT start_work('ab000000-0000-0000-0000-000000000004', (:'q4'::jsonb)->>'quote_hash') AS st4 \gset
SELECT attest_work_completion('ab000000-0000-0000-0000-000000000004', (:'q4'::jsonb)->>'quote_hash', 'Seats recovered') AS at4 \gset
SELECT vc_as('10000000-0000-0000-0000-00000000000c');
SELECT accept_work_completion('ab000000-0000-0000-0000-000000000004', ((:'at4'::jsonb)->>'completion_id')::uuid, (:'at4'::jsonb)->>'completion_hash') AS ac4 \gset
SELECT vc_as('10000000-0000-0000-0000-0000000000a7');
SELECT pg_temp.inp('ab200000-0000-0000-0000-000000000005', 'skill') AS s1 \gset
SELECT pg_temp.inp('ab200000-0000-0000-0000-000000000006', 'skill') AS polish1 \gset
SELECT vc_as('10000000-0000-0000-0000-00000000000c');
SELECT work_order_provider_matches_read('ab000000-0000-0000-0000-000000000005') AS pm \gset
RESET ROLE;
SELECT t_assert((:'s1'::jsonb) @> '{"result":"pass","basis":"organization_completed_on_nuke","capability_keys":["upholstery_full"],"organization_evidence":[{"organization":{"name":"AutoZone"},"jobs_completed_and_accepted":1}]}',
 'after AutoZone performed a recover-seats job through Nuke and the customer accepted it: recover seats passes');
SELECT t_assert((:'polish1'::jsonb)->>'result' = 'unknown', 'the accepted seat job does not make plating work pass');
SELECT t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements((:'pm'::jsonb)->'providers') p WHERE p->>'role' = 'performer' AND p->'listed_because' @> '["verified_claimant"]')
 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements((:'pm'::jsonb)->'providers') p, jsonb_array_elements(p->'requirements') r, jsonb_array_elements(r->'inputs') i
   WHERE i->>'result' = 'pass' AND i->>'basis' = 'verified_claimant')
 AND (:'pm'::jsonb)->'plan_b_suppliers' @> '[{"requirement_id":"ab200000-0000-0000-0000-000000000007","suppliers":[{"organization":{"name":"AutoZone"},"supplier_label":"can supply this"}]}]'
 AND (:'pm'::jsonb)->>'ranking' LIKE 'performers by count of passed performer inputs only%',
 'matches: performers rank on performer inputs (no verified_claimant pass anywhere); Plan-B suppliers listed separately');
