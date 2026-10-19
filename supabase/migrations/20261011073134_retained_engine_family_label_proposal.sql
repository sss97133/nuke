-- File vocabulary for curator review, without ratifying it or admitting observations.
-- engine_code is casting / serial number-derived; publisher M50-style family labels
-- must not be written into it. No review identity, worker, source or intake is changed.
SET statement_timeout = '30s';
SET lock_timeout = '1s';

DO $proposal$
DECLARE
  proposal_id constant uuid := '6b9de10b-1666-4bdf-bb69-7e82d62f8b32';
  property_payload constant jsonb := $payload${
    "property_key":"engine_family_label",
    "label":"Publisher engine-family label",
    "data_type":"string",
    "unit":null,
    "namespace_request":"core",
    "category":"engine",
    "applies_to_kinds":["specification"],
    "cardinality":"single",
    "discriminator_key":null,
    "expected_source_categories":["auction"],
    "verification_scope":"class",
    "description":"Literal publisher engine-family label attributed to the engine described as powering the subject vehicle. Preserve the source quote, original capture fingerprint, source subject and clocks. This is publisher testimony; it does not establish a casting or serial identifier, OEM decoded identity, factory originality, installed physical configuration, current configuration or event time. Those remain unknown unless separately supported. Do not substitute it for engine_code or treat repeated captures as independent witnesses."
  }$payload$::jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.observation_properties
    WHERE id = '3d8394a9-8ea2-4823-ae24-f3fe23f6418e'
      AND property_key = 'engine_code' AND namespace = 'core'
      AND data_type = 'string' AND description = 'Casting / serial number-derived'
      AND ratified_at IS NOT NULL AND deprecated_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Existing engine_code ownership or meaning changed; review the proposal';
  END IF;
  IF encode(sha256(convert_to(pg_get_functiondef('public.fn_schema_proposal_apply(uuid)'::regprocedure), 'UTF8')), 'base64')
      <> '7qumoyywiZG1GXko/kKEGVr1Yjcn3pAOeBVflP3/1so='
      OR public.fn_schema_proposal_required_approvals('add_property') <> 1 THEN
    RAISE EXCEPTION 'Schema curator contract changed; review the proposal';
  END IF;
  IF EXISTS (SELECT 1 FROM public.observation_properties WHERE property_key = 'engine_family_label') THEN
    RAISE EXCEPTION 'Engine family vocabulary already exists; inspect its canonical owner';
  END IF;
  IF EXISTS (SELECT 1 FROM public.schema_proposals WHERE id = proposal_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.schema_proposals
      WHERE id = proposal_id AND proposal_type = 'add_property'
        AND proposed_by_agent_key = 'codex-retained-engine-family'
        AND payload = property_payload AND status = 'open' AND promoted_to_id IS NULL
    ) THEN
      RAISE EXCEPTION 'Engine family proposal changed or resolved; preserve curator decision';
    END IF;
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.schema_proposals
    WHERE proposal_type = 'add_property' AND payload->>'property_key' = 'engine_family_label'
      AND status IN ('open', 'under_review', 'needs_changes', 'approved')
  ) THEN
    RAISE EXCEPTION 'Another engine family proposal owns this vocabulary';
  END IF;

  INSERT INTO public.schema_proposals (
    id, proposed_by_agent_key, proposal_type, payload, evidence,
    motivating_observation_ids, estimated_scope, backward_compatibility
  ) VALUES (
    proposal_id, 'codex-retained-engine-family', 'add_property', property_payload,
    jsonb_build_array(
      $evidence${"role":"bounded_discovery","sampled_native_captures":30,"strict_powering_candidates":1,"canonical_admissions":0,"scope":"Retained native publisher bodies with the existing eleven capture metadata fields. A discovery sample, not population coverage."}$evidence$::jsonb,
      $evidence${"role":"positive_powering_witness","source_observation_id":"74ad2e68-dc1e-443e-b6bc-5164bd90323e","literal_value":"M50","source_capture_sha256":"f311bff91ad9e8247c37053e7901e5debe631d612b2378ed92b20f3a685f75ae","existing_configuration":"I6","existing_displacement_l":2.5,"capture_time":"2026-10-07T08:55:02.212Z","recording_time":"2026-10-07T08:55:04.430034Z","event_time":"unknown","identity_status":"unverified","stage":"parsed_unadmitted"}$evidence$::jsonb, -- gitleaks:allow (original source capture SHA-256, not a credential)
      $evidence${"role":"negative_factory_only","source_observation_id":"76a70e27-d890-4821-8a8c-ed5f7a0529d7","literal_value":"2UZ-FE","admitted":false}$evidence$::jsonb,
      $evidence${"role":"negative_not_powering","source_observation_id":"79954105-3740-4628-b67c-c8115435d4ff","literal_value":"N20","admitted":false}$evidence$::jsonb,
      $evidence${"role":"negative_component_style","source_observation_id":"739c76f2-a385-43a5-84a5-11200828bbda","admitted":false}$evidence$::jsonb
    ),
    ARRAY['74ad2e68-dc1e-443e-b6bc-5164bd90323e'::uuid],
    '{"initial_consumer":"read-only proposedDescriptionEngineFamilyLabelWitness / proposedRetainedEngineFamilyLabelWitness","canonical_consumer":"requires separate curator ratification and a separately tested existing-intake implementation","population_coverage":"unmeasured","new_paid_inference":false,"replay_changes":false}'::jsonb,
    '{"engine_code":"unchanged casting / serial contract","existing_intake":"family label remains refused","rollback":"Within seven days withdraw the still-open proposal and revert the unused prototype; preserve original testimony. Curator approval is a separate human act.","reviews_written":0,"properties_created":0,"source_observations_written":0}'::jsonb
  );
END;
$proposal$;

RESET lock_timeout;
RESET statement_timeout;
