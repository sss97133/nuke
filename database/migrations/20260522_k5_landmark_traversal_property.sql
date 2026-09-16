-- File + approve schema_proposal for wire_landmark_traversal.
-- This is the atomic refile of the previously-withdrawn wire_routing_landmarks
-- (which collapsed N traversals into one jsonb array). New shape: one
-- observation per (wire_id, sequence, landmark_id) traversal.
--
-- discriminator_key is 'traversal_key' which structured_data pre-computes as
-- '<wire_id>_<sequence>' so vehicle_canonical partitions per traversal.
BEGIN;

DO $$
DECLARE
  v_user uuid := '0b9f107a-d124-49de-9ded-94698f63c1c4';
  v_proposal_id uuid;
BEGIN
  INSERT INTO public.schema_proposals
    (proposed_by_user_id, proposal_type, payload, evidence, estimated_scope, backward_compatibility, status)
  VALUES (v_user, 'add_property',
    jsonb_build_object(
      'property_key', 'wire_landmark_traversal',
      'label', 'Wire Landmark Traversal',
      'data_type', 'string',
      'namespace_request', 'pending',
      'category', 'wiring',
      'cardinality', 'multi',
      'discriminator_key', 'traversal_key',
      'applies_to_kinds', jsonb_build_array('specification'),
      'expected_source_categories', jsonb_build_array('documentation','owner'),
      'description', 'One observation per (wire_id, sequence, landmark_id) traversal. value = landmark ID (e.g. "L01"). structured_data carries wire_id, sequence (0-indexed position along the path), and a pre-computed traversal_key = wire_id_sequence (e.g. "4a_0", "4a_1") that the discriminator uses to partition canonical rows. Refile of the withdrawn wire_routing_landmarks (jsonb-array shape was a cell-collapse violation).'),
    jsonb_build_array(
      jsonb_build_object('kind','research_document','path','docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md','section','§9'),
      jsonb_build_object('kind','existing_substrate','path','docs/wiring/output/K5_wire_paths.yaml','description','Per-wire landmark traversal data, 80+ wires'),
      jsonb_build_object('kind','prior_proposal_withdrawn','reference','wire_routing_landmarks (10220521-04c9-4387-8200-575a3b0a1a33)')),
    jsonb_build_object('affected_vehicles_count',1,'affected_claims_count_estimate',800,'note','~80 K5 wires × avg 4-6 landmarks each = ~400-800 traversal cells'),
    jsonb_build_object('existing_data_behavior','preserved_unchanged','rollback_plan','Drop column.','read_api_impact','New optional field.'),
    'open')
  RETURNING id INTO v_proposal_id;

  INSERT INTO public.schema_proposal_reviews (proposal_id, reviewer_user_id, decision, reasoning)
  VALUES (v_proposal_id, v_user, 'approve',
    'Owner self-approval. Atomic-cell shape (one observation per traversal); learned from the withdrawn jsonb-array version. Source data exists in K5_wire_paths.yaml ready to ingest.');
END $$;

-- Verify the property got created by the trigger
SELECT property_key, data_type, cardinality, discriminator_key, namespace
FROM public.observation_properties
WHERE property_key = 'wire_landmark_traversal';

COMMIT;
