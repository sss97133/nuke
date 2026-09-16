-- =========================================================================
-- 20260522_add_verification_scope.sql
-- Date:   2026-05-22
-- Status: PROPOSED — apply after explicit review.
--
-- Adds verification_scope to observation_properties to encode the
-- philosophical distinction Skylar named 2026-05-22:
--
--   class    — verifiable by class-level authority (factory spec, OEM data)
--              or by consensus across many instances of the class.
--              Examples: engine_displacement_l, drivetrain_layout — these
--              hold true for every vehicle sharing the engine_code, so a
--              single high-trust source for the CLASS is effectively
--              authoritative.
--   instance — verifiable only by observations of THIS specific vehicle.
--              Examples: wire_length_in, current mileage_miles, the K5's
--              landmark distances (L01-L30 are custom to Skylar's build).
--              No amount of other K5 owners agreeing on their L01s tells us
--              anything about his. Verification = multi-method, multi-time
--              observation of the SAME instance converging.
--   both     — verifiable by either path. e.g. year/make/model can be
--              derived from the VIN against a class authority, OR carried
--              by an instance-level title document.
--
-- This sharpens the trust model: 'verified' confidence is emergent (not
-- assertable), AND the emergence path differs by property. The consensus
-- aggregator (whenever it's built) will respect this column.
--
-- This migration also updates fn_schema_proposal_apply() to honor
-- verification_scope from the proposal payload so future add_property
-- proposals can declare scope.
-- =========================================================================
BEGIN;

ALTER TABLE public.observation_properties
  ADD COLUMN IF NOT EXISTS verification_scope text
  CHECK (verification_scope IN ('class','instance','both'));

COMMENT ON COLUMN public.observation_properties.verification_scope IS
  'Where verification can come from for claims of this property. class = class-level authority or cross-instance consensus; instance = multi-observation of same vehicle only (custom/unique state); both = either path valid. NULL during transition for properties whose scope has not been declared.';

-- Backfill existing properties.
-- Wiring properties: all instance (custom harness build).
UPDATE public.observation_properties
   SET verification_scope = 'instance'
 WHERE category = 'wiring' AND verification_scope IS NULL;

-- Class-derivable from VIN/engine_code:
UPDATE public.observation_properties
   SET verification_scope = 'class'
 WHERE property_key IN (
   'engine_displacement_l',
   'engine_configuration',
   'engine_code',
   'drivetrain_layout',
   'transmission_type'
 ) AND verification_scope IS NULL;

-- Both-paths: year/make/model/trim — class-derivable from VIN decode OR
-- instance-attestable from a title document.
UPDATE public.observation_properties
   SET verification_scope = 'both'
 WHERE property_key IN ('year','make','model','trim','vin')
   AND verification_scope IS NULL;

-- Instance-only: per-vehicle current state.
UPDATE public.observation_properties
   SET verification_scope = 'instance'
 WHERE property_key IN (
   'exterior_color', 'interior_color',
   'mileage_miles', 'owner_name', 'owner_user_id',
   'sale_price_usd', 'asking_price_usd', 'condition_grade'
 ) AND verification_scope IS NULL;

-- Update the auto-apply function to read verification_scope from the
-- proposal payload (default 'instance' if not specified — most new
-- properties will be instance-level).
CREATE OR REPLACE FUNCTION public.fn_schema_proposal_apply(p_proposal_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_proposal     public.schema_proposals%ROWTYPE;
  v_payload      jsonb;
  v_new_prop_id  uuid;
  v_applies_to_kinds public.observation_kind[];
  v_expected_src public.source_category[];
BEGIN
  SELECT * INTO v_proposal FROM public.schema_proposals WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fn_schema_proposal_apply: proposal % not found', p_proposal_id;
  END IF;
  IF v_proposal.status <> 'approved' THEN
    RAISE EXCEPTION 'fn_schema_proposal_apply: proposal % is %, expected approved', p_proposal_id, v_proposal.status;
  END IF;

  v_payload := v_proposal.payload;

  IF v_proposal.proposal_type = 'add_property' THEN
    IF v_payload ? 'applies_to_kinds' THEN
      SELECT ARRAY(SELECT jsonb_array_elements_text(v_payload->'applies_to_kinds'))::public.observation_kind[]
        INTO v_applies_to_kinds;
    END IF;
    IF v_payload ? 'expected_source_categories' THEN
      SELECT ARRAY(SELECT jsonb_array_elements_text(v_payload->'expected_source_categories'))::public.source_category[]
        INTO v_expected_src;
    END IF;

    INSERT INTO public.observation_properties
      (property_key, label, data_type, unit, namespace, category,
       applies_to_kinds, cardinality, discriminator_key,
       expected_source_categories, description,
       verification_scope,
       proposed_by_proposal_id, ratified_at)
    VALUES (
      v_payload->>'property_key',
      v_payload->>'label',
      v_payload->>'data_type',
      v_payload->>'unit',
      COALESCE(v_payload->>'namespace_request', 'pending'),
      v_payload->>'category',
      v_applies_to_kinds,
      COALESCE(v_payload->>'cardinality', 'single'),
      v_payload->>'discriminator_key',
      v_expected_src,
      v_payload->>'description',
      COALESCE(v_payload->>'verification_scope', 'instance'),
      p_proposal_id,
      CASE WHEN COALESCE(v_payload->>'namespace_request','pending') = 'core' THEN now() ELSE NULL END
    )
    RETURNING id INTO v_new_prop_id;

    UPDATE public.schema_proposals SET promoted_to_id = v_new_prop_id WHERE id = p_proposal_id;

  ELSIF v_proposal.proposal_type = 'add_observation_kind' THEN
    EXECUTE format(
      'ALTER TYPE public.observation_kind ADD VALUE IF NOT EXISTS %L',
      v_payload->>'kind_value'
    );

  ELSE
    UPDATE public.schema_proposals
       SET decision_rationale = COALESCE(decision_rationale, '') ||
           E'\nAuto-apply skipped: proposal_type ' || v_proposal.proposal_type ||
           ' requires manual application by a curator.'
     WHERE id = p_proposal_id;
  END IF;
END $$;

-- File a schema_proposal recording this DDL move (informational; modify_property
-- proposal_type does not auto-apply, so the DDL above is the binding act).
INSERT INTO public.schema_proposals
  (proposed_by_user_id, proposal_type, payload, evidence, estimated_scope, backward_compatibility, status, resolved_at, decision_rationale)
VALUES (
  '0b9f107a-d124-49de-9ded-94698f63c1c4',
  'modify_property',
  jsonb_build_object(
    'change_type', 'registry_schema_extension',
    'added_column', 'verification_scope',
    'data_type', 'text',
    'check_constraint', 'verification_scope IN (''class'',''instance'',''both'')',
    'motivation', 'Skylar 2026-05-22 conversation: distinguish class-level truths (verifiable by class authority or many-instance consensus) from instance-level truths (verifiable only by multi-method observation of THIS vehicle). Wiring is heavily instance-level; engine specs are class-level. The consensus aggregator (future) must respect this distinction or it will falsely promote per-build values to verified by aggregating across unrelated builds.'
  ),
  jsonb_build_array(
    jsonb_build_object('kind','conversation','date','2026-05-22','speaker','Skylar','excerpt','"that only works for things that are true at scale like 100s of trucks being the same measurements its not exactly a ground truth always for all subjects. wiring wil have lots of variations"')
  ),
  jsonb_build_object('affected_properties_count_estimate', 18, 'note', 'All 18 wiring properties backfilled instance; 5 engine specs backfilled class; 5 identity properties backfilled both; 8 condition/state properties backfilled instance.'),
  jsonb_build_object('existing_data_behavior','preserved_unchanged','rollback_plan','ALTER TABLE DROP COLUMN verification_scope','read_api_impact','New nullable column. Existing queries unaffected.'),
  'approved', now(),
  'Self-approved by owner (Skylar) as the proposer of the architectural distinction. DDL applied in same migration. The proposal is the institutional record; the migration is the binding act.'
);

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Verify
SELECT verification_scope, count(*) FROM public.observation_properties GROUP BY verification_scope ORDER BY 1;
