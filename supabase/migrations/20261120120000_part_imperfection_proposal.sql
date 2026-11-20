-- File one property for curator review: a flaw seen on one named part in one photo. Nothing here approves it.
-- Why: 436 of this vehicle's 446 photo_map_harvest_v1 observations state a flaw (oxidation, scratch, discoloration,
-- misalignment...) about a named part. Each already carries a condition-taxonomy descriptor, but no registered
-- property, so no reader that follows property_id can compare, fold or doubt it. The 10 other rows state a component
-- is absent; that is component_visible_present (approved 2026-11-12) and is not re-proposed. Whole-photo values stay with
-- the three image_visible_* keys; free text (narrative, notes, workshop signals) is not a value and gets no key.
-- What: one add_property proposal (open), shape following the design in docs/ledger/2026-11-10_image-keys-build-design.md
-- section 2.5 (discriminator claim_key, part from subject_taxonomy, imperfection kind from condition_taxonomy).
-- Cited by observation id. No observation is keyed, no review is written, no property is registered, no reader changes.
-- Revert: withdraw the open proposal (status 'withdrawn'); nothing else depends on it.
-- Pattern: 20261120060000_reported_labor_hours_proposal.sql. Contract: supabase/sql/test_part_imperfection_proposal.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $proposal$
DECLARE
  agent constant text := 'claude-part-imperfection-key';
  pr record;
  v_key text;
BEGIN
  IF encode(sha256(convert_to(pg_get_functiondef('public.fn_schema_proposal_apply(uuid)'::regprocedure), 'UTF8')), 'base64')
      NOT IN ('7qumoyywiZG1GXko/kKEGVr1Yjcn3pAOeBVflP3/1so=', 'tUZdsgAe5iDEAejqpZToqdiZCeAOBZM+HBu9p1Jtmpo=')
      OR public.fn_schema_proposal_required_approvals('add_property') <> 1 THEN
    RAISE EXCEPTION 'Schema curator contract changed; review the proposal';
  END IF;
  FOR pr IN SELECT * FROM (VALUES
    ('5e0a3b4c-8d1f-4a27-9c64-2b7d91f0a3e8'::uuid, $payload${"property_key": "part_imperfection", "label": "Imperfection seen on a named part in one photo", "data_type": "boolean", "unit": null, "namespace_request": "core", "category": "condition", "applies_to_kinds": ["condition"], "cardinality": "multi", "discriminator_key": "claim_key", "expected_source_categories": ["internal"], "verification_scope": "instance", "description": "Grain: one reader's statement about one part in one image. True means a flaw of the named kind is visible on that part in that image. The claim is identified by structured_data.claim_key, built as image_id|part_key|part_side|descriptor_key, where part_key is a subject_taxonomy part key, part_side is left, right or center when the reader said it (empty when not), and descriptor_key is a condition_taxonomy canonical key (for example exterior.metal.oxidation). The reader's own sentence stays as source_text. False needs explicit absence wording in a view that covers the part; not visible and cannot tell are omitted, never false. A missing component is not this key: it is component_visible_present. It describes what one photo shows of one part; it does not establish severity, cause, whole-part or whole-vehicle condition, or independent corroboration. Two readers of one photo are two claims."}$payload$::jsonb,
     $evidence$[{"role": "bounded_discovery", "scope": "One vehicle, read-only, 2026-11-20. 446 photo_map_harvest_v1 observations, all with a condition-taxonomy descriptor and none with a property_id. 436 state a flaw; 10 state a missing component. Of the 436, 354 name a part (82 do not, and cannot land on this key) and 347 are distinct image, part, side and descriptor claims across 77 parts and 17 descriptors. 241 of the 354 use a part key already in the vocabulary; 113 use a part key the run decided or drafted, which must be registered first. Not population coverage."}, {"role": "prototype_row", "source_table": "vehicle_observations", "row_id": "8441978f-7484-4b27-811e-1beb59af8f8f", "quote": "Alternator casing has a dull oxidized appearance.", "reads": "part=engine.alternator, descriptor=exterior.metal.oxidation, true"}, {"role": "prototype_row", "source_table": "vehicle_observations", "row_id": "4cb37d96-cd49-49de-b1c6-ce7b6e540663", "quote": "Broad coating deterioration and exposed corrosion are visible.", "reads": "part=undercarriage, descriptor=exterior.metal.oxidation, true"}, {"role": "prototype_row", "source_table": "vehicle_observations", "row_id": "6ce59a00-200a-44cb-a150-aa2759f0d635", "quote": "Nose-to-valance joint appears uneven without establishing structural failure.", "reads": "part=trim.bumper.front, descriptor=exterior.body.alignment, true"}, {"role": "excluded_row", "source_table": "vehicle_observations", "row_id": "95f5a90a-9367-4531-af8a-b55aa8ba1e7d", "quote": "Rear license plate is absent from the visible recess.", "reads": "a missing component: component_visible_present, not this key"}]$evidence$::jsonb)
  ) AS t(proposal_id, property_payload, proposal_evidence) LOOP
    v_key := pr.property_payload->>'property_key';
    IF EXISTS (SELECT 1 FROM public.observation_properties WHERE property_key = v_key) THEN
      RAISE EXCEPTION 'Part imperfection vocabulary already exists (%); inspect its canonical owner', v_key;
    END IF;
    IF EXISTS (SELECT 1 FROM public.schema_proposals WHERE id = pr.proposal_id) THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.schema_proposals
        WHERE id = pr.proposal_id AND proposal_type = 'add_property' AND proposed_by_agent_key = agent
          AND payload = pr.property_payload AND status = 'open' AND promoted_to_id IS NULL
      ) THEN
        RAISE EXCEPTION 'Part imperfection proposal changed or resolved (%); preserve curator decision', v_key;
      END IF;
      CONTINUE;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.schema_proposals
      WHERE proposal_type = 'add_property' AND payload->>'property_key' = v_key
        AND status IN ('open', 'under_review', 'needs_changes', 'approved')
    ) THEN
      RAISE EXCEPTION 'Another proposal owns this vocabulary (%)', v_key;
    END IF;
    INSERT INTO public.schema_proposals (
      id, proposed_by_agent_key, proposal_type, payload, evidence,
      motivating_observation_ids, estimated_scope, backward_compatibility
    ) VALUES (
      pr.proposal_id, agent, 'add_property', pr.property_payload,
      pr.proposal_evidence || jsonb_build_array(
        jsonb_build_object('role', 'harvest_check', 'scope', 'No registered key carries a part-level imperfection today; the statements keep a condition-taxonomy descriptor and the part as text in structured_data.')),
      ARRAY[]::uuid[],
      '{"initial_consumer":"a harvest of existing photo_map_harvest_v1 statements as keyed observations citing the original, no model call","canonical_consumer":"requires curator approval, part keys registered for the 113 decided or drafted parts, and a writer change in ingest-observation (imageProperties.ts and the key gate in index.ts)","population_coverage":"one vehicle measured: 354 of 446 statements name a part","new_paid_inference":false,"replay_changes":false}'::jsonb,
      '{"existing_properties":"unchanged; the three image_visible_* keys and component_visible_present keep their grain","existing_intake":"part_imperfection stays refused until the writer is changed","rollback":"Withdraw the still-open proposal. Curator approval is a separate human act.","reviews_written":0,"properties_created":0,"source_observations_written":0}'::jsonb
    );
  END LOOP;
END;
$proposal$;

RESET lock_timeout;
RESET statement_timeout;
