-- =========================================================================
-- 2026-05-22 substrate deepening
--
-- 1. Ingest 4 wire_label_a/b_text observations now that the receipts split
--    the merged labels (110a, 110b, 109a, 109b).
-- 2. File 4 crimp QA proposals (wire_crimp_{a,b}_die_pn + _pull_test_lbf)
--    + owner self-approve to test the new institutional biology end-to-end.
-- 3. Create v_open_proposals + v_proposals_resolved views so the institution
--    is queryable from a single SELECT.
-- =========================================================================
BEGIN;

DO $$
DECLARE
  v_user uuid := '0b9f107a-d124-49de-9ded-94698f63c1c4';
  v_research text := 'docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md';
  v_receipts_source uuid;
  v_prop_label_a uuid;
  v_prop_label_b uuid;
BEGIN
  SELECT id INTO v_receipts_source FROM public.observation_sources WHERE slug = 'k5_wire_closure_receipts';
  SELECT id INTO v_prop_label_a    FROM public.observation_properties WHERE property_key = 'wire_label_a_text';
  SELECT id INTO v_prop_label_b    FROM public.observation_properties WHERE property_key = 'wire_label_b_text';

  -- =================================================================
  -- Part 1: Ingest the 4 known labels into substrate.
  -- Sources: K5_wire_labels.md (lines :79 and :80), surfaced via the
  -- closure receipts for wires #109 (IAT) and #110 (CLT).
  -- =================================================================

  -- #110 CLT — end A (sensor end)
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES
    ('e08bf694-970f-4cbe-8a74-8715158a0f2e',
     'specification'::observation_kind,
     v_prop_label_a,
     jsonb_build_object(
       'wire_id', '110',
       'loom', 'ENGINE LOOM',
       'label', 'Coolant Temp Sensor (ECU)',
       'property_key', 'wire_label_a_text',
       'value', 'COOLANT TEMP CLT 22',
       'citation', 'K5_wire_labels.md:80 (split from previously-merged label_text per 2026-05-22 receipt migration)',
       'end', 'A'),
     v_receipts_source, v_user, now(), 'normal'::vfc_rank, 'high'::confidence_level, 0.95,
     '#110 wire_label_a_text=COOLANT TEMP CLT 22 (sensor end)');

  -- #110 CLT — end B (ECU end)
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES
    ('e08bf694-970f-4cbe-8a74-8715158a0f2e',
     'specification'::observation_kind,
     v_prop_label_b,
     jsonb_build_object(
       'wire_id', '110',
       'loom', 'ENGINE LOOM',
       'label', 'Coolant Temp Sensor (ECU)',
       'property_key', 'wire_label_b_text',
       'value', 'M130:B04 CLT 22',
       'citation', 'K5_wire_labels.md:80 (split from previously-merged label_text)',
       'end', 'B'),
     v_receipts_source, v_user, now(), 'normal'::vfc_rank, 'high'::confidence_level, 0.95,
     '#110 wire_label_b_text=M130:B04 CLT 22 (ECU end)');

  -- #109 IAT — end A
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES
    ('e08bf694-970f-4cbe-8a74-8715158a0f2e',
     'specification'::observation_kind,
     v_prop_label_a,
     jsonb_build_object(
       'wire_id', '109',
       'loom', 'ENGINE LOOM',
       'label', 'Intake Air Temp Sensor',
       'property_key', 'wire_label_a_text',
       'value', 'INTAKE TEMP IAT 22',
       'citation', 'K5_wire_labels.md:79',
       'end', 'A'),
     v_receipts_source, v_user, now(), 'normal'::vfc_rank, 'high'::confidence_level, 0.95,
     '#109 wire_label_a_text=INTAKE TEMP IAT 22 (sensor end)');

  -- #109 IAT — end B
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES
    ('e08bf694-970f-4cbe-8a74-8715158a0f2e',
     'specification'::observation_kind,
     v_prop_label_b,
     jsonb_build_object(
       'wire_id', '109',
       'loom', 'ENGINE LOOM',
       'label', 'Intake Air Temp Sensor',
       'property_key', 'wire_label_b_text',
       'value', 'M130:B03 IAT 22',
       'citation', 'K5_wire_labels.md:79',
       'end', 'B'),
     v_receipts_source, v_user, now(), 'normal'::vfc_rank, 'high'::confidence_level, 0.95,
     '#109 wire_label_b_text=M130:B03 IAT 22 (ECU end)');

  -- =================================================================
  -- Part 2: File 4 crimp QA proposals.
  -- Per IPC/WHMA-A-620 §19.1 every crimp termination must be verified
  -- with: which die was used (M22520/x), and what pull-force was
  -- achieved. Per-AWG minimums in the spec (16 AWG = 50 lbf min,
  -- 20 AWG = 13 lbf min, 22 AWG = 8 lbf min). Slots will be empty
  -- until Skylar starts logging crimps but the substrate accepts them.
  -- =================================================================

  INSERT INTO public.schema_proposals (proposed_by_user_id, proposal_type, payload, evidence, estimated_scope, backward_compatibility, status)
  VALUES (v_user, 'add_property',
    jsonb_build_object(
      'property_key', 'wire_crimp_a_die_pn',
      'label', 'Wire Crimp Die PN — End A',
      'data_type', 'string',
      'namespace_request', 'pending',
      'category', 'wiring',
      'cardinality', 'multi',
      'discriminator_key', 'wire_id',
      'applies_to_kinds', jsonb_build_array('work_record'),
      'expected_source_categories', jsonb_build_array('documentation', 'owner', 'shop'),
      'description', 'PN of the M22520-series die used to crimp the terminal at end A (the device end). Captures the QA-traceability layer per IPC/WHMA-A-620 §19.1.'),
    jsonb_build_array(
      jsonb_build_object('kind', 'research_document', 'path', v_research, 'section', '§7 Crimp tooling'),
      jsonb_build_object('kind', 'existing_substrate', 'path', 'docs/wiring/reference/connectors/CONNECTOR_DATA_REPORT.md', 'section', '§4'),
      jsonb_build_object('kind', 'industry_standard', 'reference', 'IPC/WHMA-A-620 §19.1 Crimp Termination Verification')),
    jsonb_build_object('affected_vehicles_count', 1, 'affected_claims_count_estimate', 162),
    jsonb_build_object('existing_data_behavior', 'preserved_unchanged', 'rollback_plan', 'Drop column.', 'read_api_impact', 'New optional QA field.'),
    'open');

  INSERT INTO public.schema_proposals (proposed_by_user_id, proposal_type, payload, evidence, estimated_scope, backward_compatibility, status)
  VALUES (v_user, 'add_property',
    jsonb_build_object(
      'property_key', 'wire_crimp_b_die_pn',
      'label', 'Wire Crimp Die PN — End B',
      'data_type', 'string',
      'namespace_request', 'pending',
      'category', 'wiring',
      'cardinality', 'multi',
      'discriminator_key', 'wire_id',
      'applies_to_kinds', jsonb_build_array('work_record'),
      'expected_source_categories', jsonb_build_array('documentation', 'owner', 'shop'),
      'description', 'Sibling of wire_crimp_a_die_pn for end B (the ECU/PDM end).'),
    jsonb_build_array(
      jsonb_build_object('kind', 'research_document', 'path', v_research, 'section', '§7'),
      jsonb_build_object('kind', 'industry_standard', 'reference', 'IPC/WHMA-A-620 §19.1')),
    jsonb_build_object('affected_vehicles_count', 1, 'affected_claims_count_estimate', 162),
    jsonb_build_object('existing_data_behavior', 'preserved_unchanged', 'rollback_plan', 'Drop column.', 'read_api_impact', 'New optional QA field.'),
    'open');

  INSERT INTO public.schema_proposals (proposed_by_user_id, proposal_type, payload, evidence, estimated_scope, backward_compatibility, status)
  VALUES (v_user, 'add_property',
    jsonb_build_object(
      'property_key', 'wire_crimp_a_pull_test_lbf',
      'label', 'Wire Crimp Pull-Test (lbf) — End A',
      'data_type', 'numeric',
      'unit', 'lbf',
      'namespace_request', 'pending',
      'category', 'wiring',
      'cardinality', 'multi',
      'discriminator_key', 'wire_id',
      'applies_to_kinds', jsonb_build_array('work_record'),
      'expected_source_categories', jsonb_build_array('documentation', 'owner', 'shop'),
      'description', 'Pull-test force achieved on the crimp at end A, in pound-force. Per IPC/WHMA-A-620 §19.1 minimums by AWG: 16 AWG = 50 lbf, 18 AWG = 38 lbf, 20 AWG = 13 lbf, 22 AWG = 8 lbf. A claim with value below the AWG minimum should be flagged before approval.'),
    jsonb_build_array(
      jsonb_build_object('kind', 'research_document', 'path', v_research, 'section', '§7'),
      jsonb_build_object('kind', 'industry_standard', 'reference', 'IPC/WHMA-A-620 §19.1 Table 19-1 Pull-Test Minimum Values')),
    jsonb_build_object('affected_vehicles_count', 1, 'affected_claims_count_estimate', 162),
    jsonb_build_object('existing_data_behavior', 'preserved_unchanged', 'rollback_plan', 'Drop column.', 'read_api_impact', 'New optional QA field.'),
    'open');

  INSERT INTO public.schema_proposals (proposed_by_user_id, proposal_type, payload, evidence, estimated_scope, backward_compatibility, status)
  VALUES (v_user, 'add_property',
    jsonb_build_object(
      'property_key', 'wire_crimp_b_pull_test_lbf',
      'label', 'Wire Crimp Pull-Test (lbf) — End B',
      'data_type', 'numeric',
      'unit', 'lbf',
      'namespace_request', 'pending',
      'category', 'wiring',
      'cardinality', 'multi',
      'discriminator_key', 'wire_id',
      'applies_to_kinds', jsonb_build_array('work_record'),
      'expected_source_categories', jsonb_build_array('documentation', 'owner', 'shop'),
      'description', 'Sibling of wire_crimp_a_pull_test_lbf for end B.'),
    jsonb_build_array(
      jsonb_build_object('kind', 'research_document', 'path', v_research, 'section', '§7'),
      jsonb_build_object('kind', 'industry_standard', 'reference', 'IPC/WHMA-A-620 §19.1')),
    jsonb_build_object('affected_vehicles_count', 1, 'affected_claims_count_estimate', 162),
    jsonb_build_object('existing_data_behavior', 'preserved_unchanged', 'rollback_plan', 'Drop column.', 'read_api_impact', 'New optional QA field.'),
    'open');

  -- Auto-approve all 4 — owner self-approval, additive + reversible.
  INSERT INTO public.schema_proposal_reviews (proposal_id, reviewer_user_id, decision, reasoning)
  SELECT id, v_user, 'approve',
         'Owner self-approval. Adds the QA layer (crimp die PN + pull-test) per IPC/WHMA-A-620 §19.1.'
  FROM public.schema_proposals
  WHERE payload->>'property_key' IN ('wire_crimp_a_die_pn', 'wire_crimp_b_die_pn', 'wire_crimp_a_pull_test_lbf', 'wire_crimp_b_pull_test_lbf')
    AND status = 'open';

END $$;

-- =================================================================
-- Part 3: Institutional views — single-SELECT queryability.
-- =================================================================

CREATE OR REPLACE VIEW public.v_open_proposals AS
SELECT
  sp.id,
  sp.proposal_type,
  COALESCE(sp.payload->>'property_key',
           sp.payload->>'kind_value',
           sp.payload->>'category_value') AS subject,
  sp.proposed_by_user_id,
  sp.proposed_by_agent_key,
  sp.proposed_at,
  EXTRACT(epoch FROM (now() - sp.proposed_at))::int / 86400 AS days_open,
  jsonb_array_length(sp.evidence) AS evidence_count,
  sp.status,
  (SELECT count(*) FROM public.schema_proposal_reviews r
    WHERE r.proposal_id = sp.id AND r.decision = 'approve') AS approves,
  (SELECT count(*) FROM public.schema_proposal_reviews r
    WHERE r.proposal_id = sp.id AND r.decision = 'reject') AS rejects,
  public.fn_schema_proposal_required_approvals(sp.proposal_type) AS quorum_required
FROM public.schema_proposals sp
WHERE sp.status IN ('open', 'under_review', 'needs_changes')
ORDER BY sp.proposed_at;

COMMENT ON VIEW public.v_open_proposals IS
  'Single-SELECT view of proposals awaiting curator action. Includes days_open, evidence_count, vote tally, and quorum required so a reviewer can prioritize.';


CREATE OR REPLACE VIEW public.v_proposals_resolved AS
SELECT
  sp.id,
  sp.proposal_type,
  COALESCE(sp.payload->>'property_key', sp.payload->>'kind_value') AS subject,
  sp.proposed_at,
  sp.resolved_at,
  EXTRACT(epoch FROM (sp.resolved_at - sp.proposed_at))::int / 3600 AS hours_to_resolve,
  sp.status,
  sp.promoted_to_id,
  op.property_key AS created_property_key,
  sp.decision_rationale
FROM public.schema_proposals sp
LEFT JOIN public.observation_properties op ON op.id = sp.promoted_to_id
WHERE sp.status IN ('approved', 'rejected', 'withdrawn', 'superseded')
ORDER BY sp.resolved_at DESC NULLS LAST;

COMMENT ON VIEW public.v_proposals_resolved IS
  'History view of resolved proposals. For approved: shows the observation_properties row that was created. For rejected/withdrawn: shows the decision_rationale.';

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- Verification readout
-- =================================================================
\echo '=== open proposals ==='
SELECT subject, proposal_type, evidence_count, approves, quorum_required FROM public.v_open_proposals;

\echo '=== resolved proposals (last 24h) ==='
SELECT subject, status, hours_to_resolve, COALESCE(created_property_key, '—') AS created
FROM public.v_proposals_resolved
WHERE resolved_at > now() - interval '24 hours' OR (status = 'approved' AND resolved_at > now() - interval '24 hours')
ORDER BY resolved_at DESC;

\echo '=== K5 substrate state ==='
SELECT
  (SELECT count(*) FROM public.observation_properties WHERE category='wiring') AS wiring_props,
  (SELECT count(*) FROM public.vehicle_observations WHERE vehicle_id='e08bf694-970f-4cbe-8a74-8715158a0f2e' AND property_id IS NOT NULL) AS k5_cited_cells,
  (SELECT count(*) FROM public.vehicle_canonical WHERE vehicle_id='e08bf694-970f-4cbe-8a74-8715158a0f2e') AS k5_canonical_rows;

COMMIT;
