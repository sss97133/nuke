-- fn_schema_proposal_apply(): an approved add_source proposal now registers its source in observation_sources.
-- Case: data-machine-cases.md §13.9.1 (owner, 2026-10-07 05:00Z): "How do we automate expansion of the data model to fit
-- this in?" In the lead's reading, point 4 is one observation_sources row "or an add_source proposal that the review
-- handler applies", and point 5(b) is the drain: "The proposal queue has no drain: four add_source rows have waited since
-- July." Until now an approved add_source proposal only got "Auto-apply skipped ... requires manual application by a
-- curator" appended to decision_rationale. A new source therefore needed a hand-written migration, and until one existed
-- ingest-observation refused its rows with "Unknown source ... Register source in observation_sources table first".
--
-- WHAT CHANGES. One branch, added before ELSE: proposal_type 'add_source' inserts the observation_sources row from the
-- payload and points schema_proposals.promoted_to_id at it, as the add_property branch does for observation_properties.
-- When the payload declares the source's reader (key extractor), the same approval registers it in observation_extractors,
-- the registry that names which reader reads which source (SCHEMA_LAW §6: the registry row rides along with the expansion).
-- One variable is declared. Everything else in the body is the prod body byte for byte: the add_property and
-- add_observation_kind branches, the ELSE branch for the other types (add_source_category among them), the signature,
-- language, volatility, owner and grants. The function comment is rewritten to name the new branch.
--
-- PAYLOAD KEYS the branch reads (observation_sources columns as read live 2026-10-07 05:30Z):
--   slug           text, UNIQUE, required
--   display_name   required
--   category       cast to source_category, required
--   base_url, notes
--   tier           integer
--   base_trust_score  numeric(3,2). A key present as null stays null: the four July proposals send null on purpose
--                  ("assigning a trust tier is an owner decision"). An absent key takes the column default, 0.50.
--   url_patterns   JSON array of strings -> text[]. The column is text[], not jsonb: URL LIKE patterns, as on access-sb.
--   supported_observations  JSON array -> observation_kind[]. ingest-observation refuses a kind the source does not list,
--                  so a source registered without it admits nothing.
--   trust_factors  JSON object. 65 of 192 rows keep access descriptors there (data_access, has_extractor, structured).
--   extractor      JSON object, optional: slug, display_name, extractor_type, edge_function_name, extractor_config
--                  (object), produces_kinds (array, required by the column), schedule_type (default on_demand). It becomes
--                  one observation_extractors row on the new source. That table (8 rows, read live) keys source_id to
--                  observation_sources, holds UNIQUE (slug), and is what derive-dispatch reads to find a source's reader.
--                  A script-type row with no edge_function_name is never dispatched; vehicle_observations.extractor_id
--                  (uuid) can name it.
--   Other keys (why, notes about the evidence) stay on the proposal row.
-- A url_patterns or supported_observations that is not an array, a trust_factors, extractor or extractor_config that is
-- not an object, a missing slug, an unknown category or kind, an extractor slug already taken: the apply raises, the
-- review insert fails with it, and the proposal stays open with nothing registered.
-- A slug that is already registered is kept as it is (ON CONFLICT (slug) DO NOTHING). The proposal then points at the
-- existing row and its decision_rationale says so; its extractor, if any, is not registered. A duplicate proposal never
-- edits a registered source or adds a reader to it. A change of trust or tier is a modify_trust_tier proposal, which stays
-- manual.
--
-- WHO APPROVES (read live, unchanged here). The review trigger and this function run as the role that inserts the review
-- row. EXECUTE on this function is granted to postgres and service_role only, and authenticated has SELECT only on
-- observation_sources, so a review inserted through PostgREST by a signed-in curator fails. The 14 reviews on record
-- (all approve, one reviewer, 2026-05-22..23, "Owner self-approval per handbook §4") were inserted as postgres by
-- migrations. Approval stays a human act: one INSERT into schema_proposal_reviews, run as postgres.
--
-- VERIFIED LIVE (prod, read-only through scripts/data/q.sh, 2026-10-07 05:20Z..05:45Z):
--   fn_schema_proposal_apply: md5(pg_get_functiondef) is the first fingerprint the guard below accepts; PostgreSQL 17.6;
--     owner postgres; EXECUTE to postgres and service_role only; not SECURITY DEFINER. Caller: the review handler only.
--   observation_sources: 192 rows; UNIQUE (slug); no triggers; RLS on (authenticated and anon: SELECT only).
--   observation_extractors: 8 rows; FK source_id; UNIQUE (slug) and (source_id, slug); no triggers; RLS on with no
--     policy (postgres and service_role only).
--   schema_proposals, proposal_type add_source: 4 open since 2026-07-20 (nominatim, sibarth.com, wimco.com, applemaps).
--     Their payload keys are slug, display_name, category, base_trust_score (null), supported_observations and why;
--     each applies under this branch (the contract replays that shape).
-- SCHEMA_LAW: no table, column, kind, category or policy is created. No row is written by this migration.
-- Contract: supabase/sql/test_schema_proposal_add_source_contract.sql (PostgreSQL 17, CI job metric-fold-health-contract).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE m text;
BEGIN
  IF to_regprocedure('public.fn_schema_proposal_apply(uuid)') IS NULL THEN
    RAISE NOTICE 'fn_schema_proposal_apply(uuid) does not exist in this database; creating it from this migration';
    RETURN;
  END IF;
  m := md5(pg_get_functiondef('public.fn_schema_proposal_apply(uuid)'::regprocedure));
  -- the prod body as read 2026-10-07, or this migration's own body (a second run changes nothing); refuse any other
  IF m NOT IN ('ff007911e3698553a443be2ce3d7c27b', '631a3406c541e23c1635e4ef23f35aba') THEN -- gitleaks:allow (function-definition fingerprints, not secrets)
    RAISE EXCEPTION 'fn_schema_proposal_apply drifted from the reviewed body (md5 %); review before replacement', m;
  END IF;
END $guard$;

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
'Executes the deterministic schema change for an approved proposal; called by fn_schema_proposal_review_handler when a proposal reaches its approvals. add_property: INSERT into observation_properties, promoted_to_id = the property. add_observation_kind: ALTER TYPE observation_kind ADD VALUE. add_source: INSERT into observation_sources from payload keys slug, display_name, category, base_url, tier, base_trust_score, notes, url_patterns (array), supported_observations (array) and trust_factors (object), promoted_to_id = the source; with a payload key extractor (object), also one observation_extractors row naming the source''s reader. A slug already registered is kept unchanged, gets no extractor, and is named in decision_rationale. Other types are marked approved but require manual application (decision_rationale says so). Runs as the role that inserted the review: postgres or service_role.';

DO $check$
DECLARE d text := pg_get_functiondef('public.fn_schema_proposal_apply(uuid)'::regprocedure);
BEGIN
  IF position('ELSIF v_proposal.proposal_type = ''add_source'' THEN' IN d) = 0 THEN
    RAISE EXCEPTION 'add_source branch missing after replacement';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_schema_proposal_apply(uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'fn_schema_proposal_apply must not be SECURITY DEFINER';
  END IF;
END $check$;
COMMIT;
