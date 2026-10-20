-- An approved registry expansion must survive a lost response without being
-- mistaken for a completed consumer repair. Existing owner: schema_proposals /
-- fn_schema_proposal_apply. Live atlas and approval bodies inspected 2026-10-11.
-- No testimony, proposal, review or registry row is written by this migration.
-- No automated reviewer, replay worker, ontology expansion or new intake authority.
-- Contract: test_schema_proposal_retry_and_progress.sql, included by the existing
-- PostgreSQL 17 schema-proposal CI contract.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE v_fingerprint text;
BEGIN
  v_fingerprint := md5(pg_get_functiondef('public.fn_schema_proposal_apply(uuid)'::regprocedure));
  IF v_fingerprint NOT IN ('631a3406c541e23c1635e4ef23f35aba', '661a1d978490cf2de9e63d90d07b3162') THEN -- gitleaks:allow (function fingerprints)
    RAISE EXCEPTION 'fn_schema_proposal_apply drifted from the reviewed body (%); review before replacement', v_fingerprint;
  END IF;
  -- These fields are omitted by the existing INSERT. Their live defaults are
  -- part of the retry comparison; changing that policy requires another review.
  IF (SELECT pg_get_expr(adbin, adrelid) FROM pg_attrdef
       WHERE adrelid = 'public.observation_properties'::regclass
         AND adnum = (SELECT attnum FROM pg_attribute WHERE attrelid = adrelid AND attname = 'trust_floor'))
       IS DISTINCT FROM '0.00'
     OR EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a
                  ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                 WHERE d.adrelid = 'public.observation_properties'::regclass AND a.attname = 'parent_property_id') THEN
    RAISE EXCEPTION 'observation_properties insertion defaults drifted; review retry comparison';
  END IF;
END $guard$;

-- This reads registration, not whether a consumer accepted a claim. Unknown IDs
-- return no row. Source duplicates retain the existing source under the existing
-- apply policy, so this reader never certifies that a source payload was applied.
CREATE OR REPLACE FUNCTION public.get_schema_proposal_progress(p_proposal_id uuid)
RETURNS TABLE (
  proposal_id uuid,
  proposal_type text,
  proposal_status text,
  registration_state text,
  registered_id uuid,
  definition_matches boolean,
  consumer_state text,
  next_action text
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $progress$
  WITH registered AS (
    SELECT p.id, p.proposal_type, p.status, p.promoted_to_id,
           op.id AS property_id, op.namespace, op.deprecated_at,
           src.id AS source_id,
           op.proposed_by_proposal_id = p.id
             AND jsonb_build_object(
               'property_key', op.property_key, 'label', op.label,
               'data_type', op.data_type, 'unit', op.unit,
               'parent_property_id', op.parent_property_id, 'trust_floor', op.trust_floor,
               'namespace', op.namespace, 'category', op.category,
               'applies_to_kinds', op.applies_to_kinds,
               'cardinality', op.cardinality, 'discriminator_key', op.discriminator_key,
               'expected_source_categories', op.expected_source_categories,
               'description', op.description, 'verification_scope', op.verification_scope
             ) = jsonb_build_object(
               'property_key', p.payload->>'property_key', 'label', p.payload->>'label',
               'data_type', p.payload->>'data_type', 'unit', p.payload->>'unit',
               'parent_property_id', NULL, 'trust_floor', 0.00,
               'namespace', COALESCE(p.payload->>'namespace_request', 'pending'),
               'category', p.payload->>'category',
               'applies_to_kinds', p.payload->'applies_to_kinds',
               'cardinality', COALESCE(p.payload->>'cardinality', 'single'),
               'discriminator_key', p.payload->>'discriminator_key',
               'expected_source_categories', p.payload->'expected_source_categories',
               'description', p.payload->>'description',
               'verification_scope', COALESCE(p.payload->>'verification_scope', 'instance')
             ) AS property_matches,
           EXISTS (SELECT 1 FROM public.observation_properties collision
                    WHERE collision.property_key = p.payload->>'property_key') AS property_key_exists
      FROM public.schema_proposals p
      LEFT JOIN public.observation_properties op
        ON p.proposal_type = 'add_property' AND op.id = p.promoted_to_id
      LEFT JOIN public.observation_sources src
        ON p.proposal_type = 'add_source' AND src.id = p.promoted_to_id
       AND src.slug = p.payload->>'slug'
     WHERE p.id = p_proposal_id
  ), states AS (
    SELECT *, CASE
      WHEN status <> 'approved' THEN 'not_approved'
      WHEN proposal_type = 'add_property' THEN CASE
        WHEN promoted_to_id IS NULL AND property_key_exists THEN 'name_collision'
        WHEN promoted_to_id IS NULL THEN 'unregistered'
        WHEN deprecated_at IS NOT NULL OR namespace = 'deprecated' THEN 'retired'
        WHEN property_id IS NULL OR property_matches IS NOT TRUE THEN 'registration_drift'
        WHEN namespace = 'core' THEN 'core_registered'
        ELSE 'pending_ratification' END
      WHEN proposal_type = 'add_source' THEN CASE
        WHEN promoted_to_id IS NULL THEN 'unregistered'
        WHEN source_id IS NULL THEN 'registration_drift'
        ELSE 'source_registered_definition_unverified' END
      ELSE 'manual_verification_required'
    END AS registration
    FROM registered
  )
  SELECT id, proposal_type, status, registration,
         CASE WHEN proposal_type = 'add_property' THEN property_id
              WHEN proposal_type = 'add_source' THEN source_id END,
         CASE WHEN proposal_type = 'add_property' AND property_id IS NOT NULL
              THEN property_matches END,
         'unverified'::text,
         CASE
           WHEN status IN ('open', 'under_review') THEN 'curator_review'
           WHEN status = 'needs_changes' THEN 'revise_proposal'
           WHEN status <> 'approved' THEN 'preserve_decision'
           WHEN registration = 'unregistered' THEN 'apply_approved_proposal'
           WHEN registration IN ('name_collision', 'registration_drift', 'retired', 'pending_ratification') THEN 'curator_review'
           WHEN registration = 'core_registered' THEN 'verify_intake_and_consumer'
           WHEN registration = 'source_registered_definition_unverified' THEN 'verify_source_definition_and_consumer'
           ELSE 'inspect_type_specific_implementation'
         END
    FROM states;
$progress$;
REVOKE ALL ON FUNCTION public.get_schema_proposal_progress(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_schema_proposal_progress(uuid) TO service_role;
COMMENT ON FUNCTION public.get_schema_proposal_progress(uuid) IS
  'Read-only progress for the schema_proposals owner. Approval, exact property registration, source registration and consumer verification remain distinct. Consumer state is always unverified: this registry reader has no consumer replay receipt. Unknown proposal IDs return no row. Service-role invoker only.';

CREATE OR REPLACE FUNCTION public.fn_schema_proposal_apply(p_proposal_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_proposal     public.schema_proposals%ROWTYPE;
  v_payload      jsonb;
  v_new_prop_id  uuid;
  v_applies_to_kinds public.observation_kind[];
  v_expected_src public.source_category[];
  v_new_source_id uuid;
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
    -- A worker may lose the response after a committed approval. Replaying that
    -- same proposal is safe only while its exact, attributed definition survives.
    IF v_proposal.promoted_to_id IS NOT NULL THEN
      PERFORM 1 FROM public.observation_properties
       WHERE id = v_proposal.promoted_to_id FOR SHARE;
      IF NOT EXISTS (
        SELECT 1 FROM public.get_schema_proposal_progress(p_proposal_id)
         WHERE registration_state IN ('core_registered', 'pending_ratification')
           AND definition_matches IS TRUE
      ) THEN
        RAISE EXCEPTION 'fn_schema_proposal_apply: proposal % registration drift; review the linked property before retry', p_proposal_id;
      END IF;
      RETURN;
    END IF;

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

  ELSIF v_proposal.proposal_type = 'add_source' THEN
    -- The registry row the fact log keys to (case ledger 13.9.1). Keys and their rules: the migration header.
    IF COALESCE(v_payload->>'slug', '') = '' THEN
      RAISE EXCEPTION 'fn_schema_proposal_apply: add_source proposal % has no slug', p_proposal_id;
    END IF;
    IF jsonb_typeof(v_payload->'url_patterns') NOT IN ('array', 'null')
       OR jsonb_typeof(v_payload->'supported_observations') NOT IN ('array', 'null')
       OR jsonb_typeof(v_payload->'trust_factors') NOT IN ('object', 'null')
       OR jsonb_typeof(v_payload->'extractor') NOT IN ('object', 'null')
       OR jsonb_typeof(v_payload->'extractor'->'extractor_config') NOT IN ('object', 'null') THEN
      RAISE EXCEPTION 'fn_schema_proposal_apply: add_source proposal % needs url_patterns and supported_observations as arrays and trust_factors, extractor and extractor_config as objects', p_proposal_id;
    END IF;
    IF jsonb_typeof(v_payload->'extractor') = 'object'
       AND COALESCE(jsonb_typeof(v_payload->'extractor'->'produces_kinds'), '') <> 'array' THEN
      RAISE EXCEPTION 'fn_schema_proposal_apply: add_source proposal % declares an extractor without a produces_kinds array', p_proposal_id;
    END IF;

    INSERT INTO public.observation_sources
      (slug, display_name, category, base_url, tier, base_trust_score, notes,
       url_patterns, supported_observations, trust_factors)
    VALUES (
      v_payload->>'slug',
      v_payload->>'display_name',
      (v_payload->>'category')::public.source_category,
      v_payload->>'base_url',
      (v_payload->>'tier')::integer,
      CASE WHEN v_payload ? 'base_trust_score' THEN (v_payload->>'base_trust_score')::numeric ELSE 0.50 END,
      v_payload->>'notes',
      CASE WHEN jsonb_typeof(v_payload->'url_patterns') = 'array'
        THEN ARRAY(SELECT jsonb_array_elements_text(v_payload->'url_patterns')) END,
      CASE WHEN jsonb_typeof(v_payload->'supported_observations') = 'array'
        THEN ARRAY(SELECT jsonb_array_elements_text(v_payload->'supported_observations'))::public.observation_kind[] END,
      CASE WHEN jsonb_typeof(v_payload->'trust_factors') = 'object' THEN v_payload->'trust_factors' ELSE '{}'::jsonb END
    )
    ON CONFLICT (slug) DO NOTHING
    RETURNING id INTO v_new_source_id;

    IF v_new_source_id IS NULL THEN
      SELECT id INTO v_new_source_id FROM public.observation_sources WHERE slug = v_payload->>'slug';
      UPDATE public.schema_proposals
         SET decision_rationale = COALESCE(decision_rationale, '') ||
             E'\nSource ' || (v_payload->>'slug') || ' was already registered; the existing row was kept.'
       WHERE id = p_proposal_id;
    ELSIF jsonb_typeof(v_payload->'extractor') = 'object' THEN
      -- The source's reader rides along with its registry row; a taken extractor slug raises.
      INSERT INTO public.observation_extractors
        (source_id, slug, display_name, extractor_type, edge_function_name, extractor_config,
         produces_kinds, schedule_type)
      VALUES (
        v_new_source_id,
        v_payload->'extractor'->>'slug',
        v_payload->'extractor'->>'display_name',
        v_payload->'extractor'->>'extractor_type',
        v_payload->'extractor'->>'edge_function_name',
        CASE WHEN jsonb_typeof(v_payload->'extractor'->'extractor_config') = 'object'
          THEN v_payload->'extractor'->'extractor_config' ELSE '{}'::jsonb END,
        ARRAY(SELECT jsonb_array_elements_text(v_payload->'extractor'->'produces_kinds'))::public.observation_kind[],
        COALESCE(v_payload->'extractor'->>'schedule_type', 'on_demand')
      );
    END IF;

    UPDATE public.schema_proposals SET promoted_to_id = v_new_source_id WHERE id = p_proposal_id;

  ELSE
    UPDATE public.schema_proposals
       SET decision_rationale = COALESCE(decision_rationale, '') ||
           E'\nAuto-apply skipped: proposal_type ' || v_proposal.proposal_type ||
           ' requires manual application by a curator.'
     WHERE id = p_proposal_id;
  END IF;
END $function$;

COMMENT ON FUNCTION public.fn_schema_proposal_apply(uuid) IS
  'Applies approved schema proposals through existing typed branches. add_property retries preserve the exact proposal-owned registration and its original clock; missing, changed, retired or foreign registrations refuse. add_source retains its existing duplicate-source policy. Registration alone does not establish intake admission or a working consumer; inspect get_schema_proposal_progress and replay through the sanctioned writer.';
COMMIT;
