-- Isolated PostgreSQL 17 contract for 20261007100000_schema_proposal_apply_add_source.sql. Synthetic rows only; never production.
-- Run in an empty, disposable dm_refinement_* database:
--   createdb dm_refinement_schema_proposal_add_source_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_schema_proposal_add_source_ci -f supabase/sql/test_schema_proposal_add_source_contract.sql
-- The approval machinery is frozen from prod (pg_get_functiondef, 2026-10-07 05:30Z) and fingerprinted against it:
-- schema_proposal_evidence_check, fn_schema_proposal_required_approvals, fn_schema_proposal_review_handler and
-- fn_schema_proposal_apply, with their two triggers. Tables carry the live columns, defaults, CHECKs, UNIQUEs and FKs of
-- observation_sources, observation_extractors, observation_properties, schema_proposals and schema_proposal_reviews.
-- Checked: the defect on the frozen body (an approved add_source registers nothing); after the migration, an approved
-- add_source registers its row with the payload values and promoted_to_id, and its declared reader as one
-- observation_extractors row; a duplicate slug keeps the registered row, adds no reader and does not error; the July
-- payload shape applies (null trust stays null); malformed payloads and a taken reader slug are refused and leave the
-- proposal open with nothing registered; the add_property, add_observation_kind, reject and manual branches behave as before; the body is the
-- prod body plus one declaration and one branch; attributes and grants are unchanged; a second run is a no-op, a drifted
-- body is refused, and a database without the function gets it created.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.schema_proposals') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';
SET TimeZone = 'UTC';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
-- A statement must fail with a message containing the fragment; its subtransaction is rolled back, so nothing it did stays.
CREATE FUNCTION pg_temp.refused(label text, stmt text, fragment text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF position(fragment IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'Contract failed: % was refused for another reason: %', label, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS % (refused: %)', label, SQLERRM;
    RETURN;
  END;
  RAISE EXCEPTION 'Contract failed: % was admitted', label;
END $$;

-- Live shapes --------------------------------------------------------------------------------------------------------------
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TYPE public.observation_kind AS ENUM ('listing', 'sale_result', 'comment', 'bid', 'sighting', 'work_record',
  'ownership', 'specification', 'provenance', 'valuation', 'condition', 'media', 'social_mention', 'expert_opinion',
  'splice', 'activity', 'offer');
CREATE TYPE public.source_category AS ENUM ('auction', 'marketplace', 'forum', 'social_media', 'registry', 'shop',
  'documentation', 'owner', 'aggregator', 'media', 'event', 'internal', 'dealer', 'museum', 'agent');
CREATE TABLE public.organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.observation_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, display_name text NOT NULL,
  category public.source_category NOT NULL, base_url text, url_patterns text[], base_trust_score numeric(3,2) DEFAULT 0.50,
  trust_factors jsonb DEFAULT '{}'::jsonb, supported_observations public.observation_kind[], requires_auth boolean DEFAULT false,
  rate_limit_per_hour integer, makes_covered text[], years_covered int4range, regions_covered text[], notes text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  business_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL, tier integer, decay_half_life_days integer,
  veracity numeric(3,2), consecration numeric(3,2));
CREATE TABLE public.observation_extractors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid NOT NULL REFERENCES public.observation_sources(id),
  slug text NOT NULL UNIQUE, display_name text NOT NULL, extractor_type text NOT NULL, edge_function_name text,
  extractor_config jsonb DEFAULT '{}'::jsonb, produces_kinds public.observation_kind[] NOT NULL,
  is_active boolean DEFAULT true, schedule_type text DEFAULT 'on_demand', schedule_cron text, rate_limit_per_hour integer,
  min_interval_seconds integer DEFAULT 1, last_run_at timestamptz, last_success_at timestamptz, last_error text,
  consecutive_failures integer DEFAULT 0, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  UNIQUE (source_id, slug));
CREATE TABLE public.schema_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proposed_at timestamptz NOT NULL DEFAULT now(),
  proposed_by_user_id uuid REFERENCES auth.users(id), proposed_by_agent_key text, proposal_type text NOT NULL,
  payload jsonb NOT NULL, evidence jsonb NOT NULL DEFAULT '[]'::jsonb, motivating_observation_ids uuid[],
  motivating_pending_claim_ids uuid[], estimated_scope jsonb, backward_compatibility jsonb,
  status text NOT NULL DEFAULT 'open', claimed_by_user_id uuid REFERENCES auth.users(id), claimed_at timestamptz,
  resolved_at timestamptz, decision_rationale text, promoted_to_id uuid,
  supersedes_proposal_id uuid REFERENCES public.schema_proposals(id), superseded_by uuid REFERENCES public.schema_proposals(id),
  CONSTRAINT proposer_present CHECK (proposed_by_user_id IS NOT NULL OR proposed_by_agent_key IS NOT NULL),
  CONSTRAINT schema_proposals_status_check CHECK (status = ANY (ARRAY['open', 'under_review', 'approved', 'rejected',
    'needs_changes', 'superseded', 'withdrawn'])),
  CONSTRAINT schema_proposals_proposal_type_check CHECK (proposal_type = ANY (ARRAY['add_property', 'fork_property',
    'deprecate_property', 'modify_property', 'add_source', 'modify_trust_tier', 'add_observation_kind',
    'add_source_category', 'add_image_attribute', 'add_column', 'add_table'])));
CREATE TABLE public.observation_properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), property_key text NOT NULL UNIQUE, label text NOT NULL,
  data_type text NOT NULL, unit text, namespace text NOT NULL DEFAULT 'pending', category text,
  parent_property_id uuid REFERENCES public.observation_properties(id), applies_to_kinds public.observation_kind[],
  cardinality text NOT NULL DEFAULT 'single', trust_floor numeric DEFAULT 0.00,
  expected_source_categories public.source_category[], description text,
  proposed_by_proposal_id uuid REFERENCES public.schema_proposals(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), ratified_at timestamptz, deprecated_at timestamptz, discriminator_key text,
  verification_scope text,
  CONSTRAINT observation_properties_cardinality_check CHECK (cardinality = ANY (ARRAY['single', 'multi'])),
  CONSTRAINT observation_properties_data_type_check CHECK (data_type = ANY (ARRAY['string', 'integer', 'numeric',
    'boolean', 'date', 'timestamp', 'enum', 'uuid_ref', 'jsonb', 'text_long'])),
  CONSTRAINT observation_properties_namespace_check CHECK (namespace = ANY (ARRAY['core', 'pending', 'deprecated'])),
  CONSTRAINT observation_properties_verification_scope_check CHECK (verification_scope = ANY (ARRAY['class', 'instance',
    'both'])));
CREATE TABLE public.schema_proposal_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES public.schema_proposals(id) ON DELETE CASCADE,
  reviewer_user_id uuid NOT NULL REFERENCES auth.users(id),
  decision text NOT NULL CHECK (decision = ANY (ARRAY['approve', 'reject', 'needs_changes'])),
  reasoning text, reviewed_at timestamptz NOT NULL DEFAULT now(), UNIQUE (proposal_id, reviewer_user_id));

-- Frozen live bodies (pg_get_functiondef on prod, 2026-10-07 05:30Z) ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.schema_proposal_evidence_check()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.proposal_type IN ('add_property','fork_property','modify_property','add_source','add_source_category','add_observation_kind')
     AND (NEW.evidence IS NULL OR jsonb_array_length(NEW.evidence) = 0)
     AND (NEW.motivating_observation_ids   IS NULL OR array_length(NEW.motivating_observation_ids, 1)   IS NULL)
     AND (NEW.motivating_pending_claim_ids IS NULL OR array_length(NEW.motivating_pending_claim_ids, 1) IS NULL)
  THEN
    RAISE EXCEPTION
      'schema_proposal_evidence: proposal type % requires evidence[], motivating_observation_ids[], or motivating_pending_claim_ids[].',
      NEW.proposal_type
      USING HINT = 'AX-024 (data knows what it contains). See docs/library/reference/encyclopedia/08-schema-proposal-workflow.md §2.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_schema_proposal_required_approvals(p_type text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE p_type
    WHEN 'add_property'         THEN 1
    WHEN 'add_observation_kind' THEN 1
    WHEN 'add_source'           THEN 1
    WHEN 'add_source_category'  THEN 1
    WHEN 'modify_property'      THEN 1
    WHEN 'deprecate_property'   THEN 1
    WHEN 'fork_property'        THEN 2
    WHEN 'modify_trust_tier'    THEN 2
    ELSE 9999
  END
$function$;

CREATE OR REPLACE FUNCTION public.fn_schema_proposal_review_handler()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_proposal_type text;
  v_current_status text;
  v_required int;
  v_approves int;
  v_rejects int;
  v_distinct_approvers int;
BEGIN
  SELECT proposal_type, status
    INTO v_proposal_type, v_current_status
    FROM public.schema_proposals
   WHERE id = NEW.proposal_id
   FOR UPDATE;

  -- Already resolved? Don't re-evaluate.
  IF v_current_status IN ('approved','rejected','withdrawn','superseded') THEN
    RETURN NEW;
  END IF;

  v_required := public.fn_schema_proposal_required_approvals(v_proposal_type);

  -- Any reject short-circuits.
  SELECT count(*) INTO v_rejects
    FROM public.schema_proposal_reviews
   WHERE proposal_id = NEW.proposal_id AND decision = 'reject';

  IF v_rejects > 0 THEN
    UPDATE public.schema_proposals
       SET status = 'rejected', resolved_at = now()
     WHERE id = NEW.proposal_id;
    RETURN NEW;
  END IF;

  -- Count distinct approving reviewers (defends against same curator double-tap)
  SELECT count(DISTINCT reviewer_user_id) INTO v_distinct_approvers
    FROM public.schema_proposal_reviews
   WHERE proposal_id = NEW.proposal_id AND decision = 'approve';

  IF v_distinct_approvers >= v_required THEN
    UPDATE public.schema_proposals
       SET status = 'approved', resolved_at = now()
     WHERE id = NEW.proposal_id;
    PERFORM public.fn_schema_proposal_apply(NEW.proposal_id);
  END IF;

  RETURN NEW;
END $function$;

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
END $function$;

CREATE TRIGGER trg_schema_proposal_evidence BEFORE INSERT ON public.schema_proposals
  FOR EACH ROW EXECUTE FUNCTION public.schema_proposal_evidence_check();
CREATE TRIGGER trg_schema_proposal_review_after_insert AFTER INSERT ON public.schema_proposal_reviews
  FOR EACH ROW EXECUTE FUNCTION public.fn_schema_proposal_review_handler();
-- Prod grants on the apply function: its owner and service_role only.
REVOKE ALL ON FUNCTION public.fn_schema_proposal_apply(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_schema_proposal_apply(uuid) TO service_role;
COMMENT ON FUNCTION public.fn_schema_proposal_apply(uuid) IS 'Executes the deterministic schema change for an approved proposal. add_property → INSERT into observation_properties. add_observation_kind → ALTER TYPE ADD VALUE. Other types are marked approved but require manual application.';

SELECT pg_temp.ok('the frozen approval machinery is the prod machinery (four definition fingerprints match prod 2026-10-07)',
  md5(pg_get_functiondef('public.fn_schema_proposal_apply(uuid)'::regprocedure)) = 'ff007911e3698553a443be2ce3d7c27b' -- gitleaks:allow (function-definition fingerprint, not a secret)
  AND md5(pg_get_functiondef('public.fn_schema_proposal_review_handler()'::regprocedure)) = '65c8427550da49573f25ea4c678dce62' -- gitleaks:allow (function-definition fingerprint, not a secret)
  AND md5(pg_get_functiondef('public.fn_schema_proposal_required_approvals(text)'::regprocedure)) = '6af67873c7c5f6c0a55c14ee4c0bbea4' -- gitleaks:allow (function-definition fingerprint, not a secret)
  AND md5(pg_get_functiondef('public.schema_proposal_evidence_check()'::regprocedure)) = 'd417f835725e9dd278e35266731fe0c4'); -- gitleaks:allow (function-definition fingerprint, not a secret)

-- Fixtures ---------------------------------------------------------------------------------------------------------------
INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-00000000a001'), ('00000000-0000-0000-0000-00000000a002');
-- An existing registry row, so a proposal for its slug is a duplicate.
INSERT INTO public.observation_sources (slug, display_name, category, tier, base_trust_score, supported_observations)
VALUES ('bonhams', 'Bonhams', 'auction', 1, 0.90, ARRAY['listing', 'sale_result']::public.observation_kind[]);
CREATE FUNCTION pg_temp.propose(p_type text, p_payload jsonb) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.schema_proposals (proposed_by_agent_key, proposal_type, payload, evidence)
  VALUES ('contract', p_type, p_payload,
    '[{"kind": "case_ledger", "path": "docs/ledger/theory/data-machine-cases.md", "section": "13.9, 13.9.1"}]'::jsonb)
  RETURNING id $$;
CREATE FUNCTION pg_temp.review(p_id uuid, p_reviewer uuid, p_decision text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.schema_proposal_reviews (proposal_id, reviewer_user_id, decision, reasoning)
  VALUES (p_id, p_reviewer, p_decision, 'contract') $$;
CREATE TEMP TABLE p (name text PRIMARY KEY, id uuid NOT NULL);
-- The payload the morning proposal sends, minus prose.
CREATE TEMP TABLE payloads (name text PRIMARY KEY, payload jsonb NOT NULL);
INSERT INTO payloads VALUES
  ('sbir', '{"slug": "sbir-gov-awards", "display_name": "SBIR.gov award data (all agencies)", "category": "registry",
     "base_url": "https://www.sbir.gov", "tier": 1, "base_trust_score": 0.90, "notes": "Public bulk award file.",
     "url_patterns": ["https://data.www.sbir.gov/awarddatapublic/award_data.csv%", "https://www.sbir.gov/awards%"],
     "supported_observations": ["activity"],
     "trust_factors": {"data_access": "public_bulk_file", "structured": "csv", "has_extractor": true},
     "extractor": {"slug": "sbir-gov-awards-declared-reader", "display_name": "Declared-source reader: SBIR.gov award file",
       "extractor_type": "script", "produces_kinds": ["activity"],
       "extractor_config": {"script": "scripts/data/declared-source-reader.mjs", "format": "csv",
         "identifier_column": "Agency Tracking Number", "subject_rule": "funder organization", "subject_org_id": null}},
     "why": "case ledger 13.9.1"}'),
  ('nsf', '{"slug": "nsf-awards-api", "display_name": "NSF awards API (SBIR/STTR)", "category": "registry",
     "base_url": "https://www.nsf.gov", "tier": 1, "base_trust_score": 0.95,
     "url_patterns": ["https://api.nsf.gov/services/v1/awards%", "https://www.nsf.gov/awardsearch/showAward?AWD_ID=%"],
     "supported_observations": ["activity"], "trust_factors": {"data_access": "public_api"}}'),
  ('july', '{"why": "Named rival witness in 33 measured organization geocode conflicts.", "slug": "applemaps",
     "category": "registry", "display_name": "Apple Maps Local Search", "base_trust_score": null,
     "base_trust_score_note": "Owner decision.", "supported_observations": ["specification", "sighting"]}');

-- 1. The defect, on the frozen prod body ------------------------------------------------------------------------------------
SELECT pg_temp.refused('an add_source proposal without evidence is refused at intake (live evidence trigger)',
  $$INSERT INTO public.schema_proposals (proposed_by_agent_key, proposal_type, payload)
    VALUES ('contract', 'add_source', '{"slug": "x"}')$$, 'requires evidence[]');
INSERT INTO p VALUES ('before', pg_temp.propose('add_source',
  '{"slug": "before-migration", "display_name": "Before", "category": "registry", "supported_observations": ["activity"]}'));
SELECT pg_temp.review((SELECT id FROM p WHERE name = 'before'), '00000000-0000-0000-0000-00000000a001', 'approve');
SELECT pg_temp.ok('frozen body: an approved add_source proposal registers nothing and is marked for a curator (the defect)',
  (SELECT status = 'approved' AND promoted_to_id IS NULL
     AND decision_rationale LIKE '%Auto-apply skipped: proposal_type add_source requires manual application by a curator.%'
   FROM public.schema_proposals WHERE id = (SELECT id FROM p WHERE name = 'before'))
  AND NOT EXISTS (SELECT 1 FROM public.observation_sources WHERE slug = 'before-migration'));

CREATE TEMP TABLE before_pg AS
  SELECT p.proacl, p.prosecdef, p.provolatile, p.proowner, p.prolang, p.proconfig,
         pg_get_functiondef(p.oid) AS def
    FROM pg_proc p WHERE p.oid = 'public.fn_schema_proposal_apply(uuid)'::regprocedure;

\ir ../migrations/20261007100000_schema_proposal_apply_add_source.sql

-- 2. The body: prod plus one declaration and one branch ---------------------------------------------------------------------
CREATE TEMP TABLE after_def AS SELECT pg_get_functiondef('public.fn_schema_proposal_apply(uuid)'::regprocedure) AS d;
SELECT pg_temp.ok('outside the add_source branch and its one declaration, the body is the prod body byte for byte',
  (SELECT replace(
            left(d, position('  ELSIF v_proposal.proposal_type = ''add_source'' THEN' IN d) - 1)
              || substr(d, position(E'  ELSE\n    UPDATE public.schema_proposals' IN d)),
            E'  v_new_source_id uuid;\n', '')
     FROM after_def) = (SELECT def FROM before_pg));
SELECT pg_temp.ok('the add_source branch sits between add_observation_kind and ELSE',
  (SELECT position('ELSIF v_proposal.proposal_type = ''add_observation_kind''' IN d)
          < position('ELSIF v_proposal.proposal_type = ''add_source'' THEN' IN d)
      AND position('ELSIF v_proposal.proposal_type = ''add_source'' THEN' IN d)
          < position(E'  ELSE\n    UPDATE public.schema_proposals' IN d) FROM after_def));
SELECT pg_temp.ok('the migrated definition carries the fingerprint the migration guard accepts',
  md5(pg_get_functiondef('public.fn_schema_proposal_apply(uuid)'::regprocedure)) = '631a3406c541e23c1635e4ef23f35aba'); -- gitleaks:allow (function-definition fingerprint, not a secret)
SELECT pg_temp.ok('owner, language, volatility, configuration, SECURITY INVOKER and grants are unchanged',
  (SELECT p.proacl IS NOT DISTINCT FROM b.proacl AND p.prosecdef = b.prosecdef AND NOT p.prosecdef
      AND p.provolatile = b.provolatile AND p.proowner = b.proowner AND p.prolang = b.prolang
      AND p.proconfig IS NOT DISTINCT FROM b.proconfig
     FROM pg_proc p, before_pg b WHERE p.oid = 'public.fn_schema_proposal_apply(uuid)'::regprocedure));
SELECT pg_temp.ok('grants: the owner and service_role execute it, PUBLIC, anon and authenticated do not',
  (SELECT count(*) = 2 AND count(*) FILTER (WHERE r.rolname = 'service_role') = 1
      AND count(*) FILTER (WHERE x.grantee = p.proowner) = 1 AND count(*) FILTER (WHERE x.grantee = 0) = 0
     FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) x LEFT JOIN pg_roles r ON r.oid = x.grantee
    WHERE p.oid = 'public.fn_schema_proposal_apply(uuid)'::regprocedure));
SELECT pg_temp.ok('the function comment names the add_source branch',
  obj_description('public.fn_schema_proposal_apply(uuid)'::regprocedure, 'pg_proc') LIKE '%add_source: INSERT into observation_sources%');

-- 3. The morning case: approve the two award sources -----------------------------------------------------------------------
INSERT INTO p VALUES ('sbir', pg_temp.propose('add_source', (SELECT payload FROM payloads WHERE name = 'sbir')));
INSERT INTO p VALUES ('nsf', pg_temp.propose('add_source', (SELECT payload FROM payloads WHERE name = 'nsf')));
SELECT pg_temp.ok('filed: both proposals are open and nothing is registered yet',
  (SELECT bool_and(status = 'open' AND promoted_to_id IS NULL) FROM public.schema_proposals
    WHERE id IN (SELECT id FROM p WHERE name IN ('sbir', 'nsf')))
  AND NOT EXISTS (SELECT 1 FROM public.observation_sources WHERE slug IN ('sbir-gov-awards', 'nsf-awards-api')));
SELECT pg_temp.review((SELECT id FROM p WHERE name = 'sbir'), '00000000-0000-0000-0000-00000000a001', 'approve');
SELECT pg_temp.ok('approved: the sbir-gov-awards row carries every payload value',
  (SELECT s.display_name = 'SBIR.gov award data (all agencies)' AND s.category = 'registry'
      AND s.base_url = 'https://www.sbir.gov' AND s.tier = 1 AND s.base_trust_score = 0.90
      AND s.notes = 'Public bulk award file.'
      AND s.url_patterns = ARRAY['https://data.www.sbir.gov/awarddatapublic/award_data.csv%', 'https://www.sbir.gov/awards%']
      AND s.supported_observations = ARRAY['activity']::public.observation_kind[]
      AND s.trust_factors = '{"data_access": "public_bulk_file", "structured": "csv", "has_extractor": true}'::jsonb
      AND s.requires_auth = false AND s.business_id IS NULL
     FROM public.observation_sources s WHERE s.slug = 'sbir-gov-awards'));
SELECT pg_temp.ok('approved: the declared reader rides along as one observation_extractors row on the new source',
  (SELECT count(*) = 1 AND bool_and(e.source_id = s.id AND e.display_name = 'Declared-source reader: SBIR.gov award file'
      AND e.extractor_type = 'script' AND e.edge_function_name IS NULL AND e.schedule_type = 'on_demand' AND e.is_active
      AND e.produces_kinds = ARRAY['activity']::public.observation_kind[]
      AND e.extractor_config ->> 'script' = 'scripts/data/declared-source-reader.mjs'
      AND e.extractor_config ->> 'identifier_column' = 'Agency Tracking Number'
      AND e.extractor_config -> 'subject_org_id' = 'null'::jsonb)
     FROM public.observation_extractors e JOIN public.observation_sources s ON s.id = e.source_id
    WHERE s.slug = 'sbir-gov-awards'));
SELECT pg_temp.ok('approved: the proposal is resolved and promoted_to_id names the new source row',
  (SELECT sp.status = 'approved' AND sp.resolved_at IS NOT NULL AND sp.promoted_to_id = s.id
      AND sp.decision_rationale IS NULL
     FROM public.schema_proposals sp, public.observation_sources s
    WHERE sp.id = (SELECT id FROM p WHERE name = 'sbir') AND s.slug = 'sbir-gov-awards'));
SELECT pg_temp.ok('what ingest-observation checks now passes: the slug resolves and the source supports kind activity',
  EXISTS (SELECT 1 FROM public.observation_sources WHERE slug = 'sbir-gov-awards'
           AND 'activity' = ANY (supported_observations)));
SELECT pg_temp.review((SELECT id FROM p WHERE name = 'nsf'), '00000000-0000-0000-0000-00000000a001', 'approve');
SELECT pg_temp.ok('approved: nsf-awards-api is registered at trust 0.95, tier 1, and promoted; no extractor declared, none made',
  (SELECT s.base_trust_score = 0.95 AND s.tier = 1 AND s.notes IS NULL AND sp.promoted_to_id = s.id
      AND s.trust_factors = '{"data_access": "public_api"}'::jsonb
     FROM public.observation_sources s, public.schema_proposals sp
    WHERE s.slug = 'nsf-awards-api' AND sp.id = (SELECT id FROM p WHERE name = 'nsf'))
  AND NOT EXISTS (SELECT 1 FROM public.observation_extractors e JOIN public.observation_sources s ON s.id = e.source_id
                   WHERE s.slug = 'nsf-awards-api'));

-- 4. Duplicates and second reviews ------------------------------------------------------------------------------------------
INSERT INTO p VALUES ('dup', pg_temp.propose('add_source',
  (SELECT payload || '{"display_name": "Renamed by a duplicate", "base_trust_score": 0.10, "tier": 4}'::jsonb
     FROM payloads WHERE name = 'sbir')));
SELECT pg_temp.review((SELECT id FROM p WHERE name = 'dup'), '00000000-0000-0000-0000-00000000a001', 'approve');
SELECT pg_temp.ok('a second approved proposal for a registered slug does not error and edits nothing, its extractor included',
  (SELECT count(*) = 1 AND bool_and(display_name = 'SBIR.gov award data (all agencies)' AND base_trust_score = 0.90
      AND tier = 1) FROM public.observation_sources WHERE slug = 'sbir-gov-awards')
  AND (SELECT count(*) = 1 FROM public.observation_extractors WHERE slug = 'sbir-gov-awards-declared-reader'));
SELECT pg_temp.ok('the duplicate points at the registered row and its rationale says it was kept',
  (SELECT sp.status = 'approved' AND sp.promoted_to_id = s.id
      AND sp.decision_rationale LIKE '%Source sbir-gov-awards was already registered; the existing row was kept.%'
     FROM public.schema_proposals sp, public.observation_sources s
    WHERE sp.id = (SELECT id FROM p WHERE name = 'dup') AND s.slug = 'sbir-gov-awards'));
INSERT INTO p VALUES ('dup_seeded', pg_temp.propose('add_source',
  '{"slug": "bonhams", "display_name": "Bonhams again", "category": "auction", "base_trust_score": 0.20}'));
SELECT pg_temp.review((SELECT id FROM p WHERE name = 'dup_seeded'), '00000000-0000-0000-0000-00000000a001', 'approve');
SELECT pg_temp.ok('a proposal for a source registered by a migration points at that row and leaves its trust alone',
  (SELECT sp.promoted_to_id = s.id AND s.base_trust_score = 0.90 AND s.display_name = 'Bonhams'
     FROM public.schema_proposals sp, public.observation_sources s
    WHERE sp.id = (SELECT id FROM p WHERE name = 'dup_seeded') AND s.slug = 'bonhams'));
SELECT pg_temp.review((SELECT id FROM p WHERE name = 'sbir'), '00000000-0000-0000-0000-00000000a002', 'approve');
SELECT pg_temp.ok('a second curator approving an approved proposal is recorded and changes nothing',
  (SELECT count(*) = 2 FROM public.schema_proposal_reviews WHERE proposal_id = (SELECT id FROM p WHERE name = 'sbir'))
  AND (SELECT count(*) = 1 FROM public.observation_sources WHERE slug = 'sbir-gov-awards')
  AND (SELECT decision_rationale IS NULL FROM public.schema_proposals WHERE id = (SELECT id FROM p WHERE name = 'sbir')));

-- 5. The July payloads and the column defaults ------------------------------------------------------------------------------
INSERT INTO p VALUES ('july', pg_temp.propose('add_source', (SELECT payload FROM payloads WHERE name = 'july')));
SELECT pg_temp.review((SELECT id FROM p WHERE name = 'july'), '00000000-0000-0000-0000-00000000a001', 'approve');
SELECT pg_temp.ok('the July shape applies: trust sent as null stays null, no tier, no patterns, empty trust_factors',
  (SELECT s.base_trust_score IS NULL AND s.tier IS NULL AND s.url_patterns IS NULL AND s.trust_factors = '{}'::jsonb
      AND s.supported_observations = ARRAY['specification', 'sighting']::public.observation_kind[]
      AND s.display_name = 'Apple Maps Local Search' AND sp.promoted_to_id = s.id
     FROM public.observation_sources s, public.schema_proposals sp
    WHERE s.slug = 'applemaps' AND sp.id = (SELECT id FROM p WHERE name = 'july')));
INSERT INTO p VALUES ('bare', pg_temp.propose('add_source',
  '{"slug": "bare-source", "display_name": "Bare", "category": "documentation", "url_patterns": null, "trust_factors": null}'));
SELECT pg_temp.review((SELECT id FROM p WHERE name = 'bare'), '00000000-0000-0000-0000-00000000a001', 'approve');
SELECT pg_temp.ok('absent trust takes the column default 0.50; null patterns and trust_factors read as none',
  (SELECT base_trust_score = 0.50 AND url_patterns IS NULL AND supported_observations IS NULL AND trust_factors = '{}'::jsonb
     FROM public.observation_sources WHERE slug = 'bare-source'));

-- 6. Malformed payloads are refused and leave the proposal open --------------------------------------------------------------
INSERT INTO p VALUES ('object_patterns', pg_temp.propose('add_source',
  '{"slug": "object-patterns", "display_name": "Object patterns", "category": "registry",
    "url_patterns": {"format": "csv", "url": "https://example.org/a.csv"}}'));
INSERT INTO p VALUES ('bad_category', pg_temp.propose('add_source',
  '{"slug": "bad-category", "display_name": "Bad category", "category": "funding"}'));
INSERT INTO p VALUES ('bad_kind', pg_temp.propose('add_source',
  '{"slug": "bad-kind", "display_name": "Bad kind", "category": "registry", "supported_observations": ["funding_award"]}'));
INSERT INTO p VALUES ('no_slug', pg_temp.propose('add_source', '{"display_name": "No slug", "category": "registry"}'));
INSERT INTO p VALUES ('scalar_trust', pg_temp.propose('add_source',
  '{"slug": "scalar-trust", "display_name": "Scalar trust", "category": "registry", "trust_factors": "high"}'));
SELECT pg_temp.refused('url_patterns as an object (the column is text[])',
  format('SELECT pg_temp.review(%L, %L, %L)', (SELECT id FROM p WHERE name = 'object_patterns'),
    '00000000-0000-0000-0000-00000000a001', 'approve'), 'needs url_patterns and supported_observations as arrays');
SELECT pg_temp.refused('an unknown source category',
  format('SELECT pg_temp.review(%L, %L, %L)', (SELECT id FROM p WHERE name = 'bad_category'),
    '00000000-0000-0000-0000-00000000a001', 'approve'), 'invalid input value for enum source_category');
SELECT pg_temp.refused('an observation kind that is not in the enum',
  format('SELECT pg_temp.review(%L, %L, %L)', (SELECT id FROM p WHERE name = 'bad_kind'),
    '00000000-0000-0000-0000-00000000a001', 'approve'), 'invalid input value for enum observation_kind');
SELECT pg_temp.refused('a payload without a slug',
  format('SELECT pg_temp.review(%L, %L, %L)', (SELECT id FROM p WHERE name = 'no_slug'),
    '00000000-0000-0000-0000-00000000a001', 'approve'), 'has no slug');
SELECT pg_temp.refused('trust_factors that is not an object',
  format('SELECT pg_temp.review(%L, %L, %L)', (SELECT id FROM p WHERE name = 'scalar_trust'),
    '00000000-0000-0000-0000-00000000a001', 'approve'), 'trust_factors, extractor and extractor_config as objects');
INSERT INTO p VALUES ('string_extractor', pg_temp.propose('add_source',
  '{"slug": "string-extractor", "display_name": "String extractor", "category": "registry", "extractor": "reader.mjs"}'));
INSERT INTO p VALUES ('array_config', pg_temp.propose('add_source',
  '{"slug": "array-config", "display_name": "Array config", "category": "registry",
    "extractor": {"slug": "array-config-reader", "display_name": "Array config reader", "extractor_type": "script",
      "produces_kinds": ["activity"], "extractor_config": ["csv"]}}'));
INSERT INTO p VALUES ('no_kinds', pg_temp.propose('add_source',
  '{"slug": "no-kinds", "display_name": "No kinds", "category": "registry",
    "extractor": {"slug": "no-kinds-reader", "display_name": "No kinds reader", "extractor_type": "script"}}'));
INSERT INTO p VALUES ('taken_reader', pg_temp.propose('add_source',
  '{"slug": "taken-reader", "display_name": "Taken reader", "category": "registry",
    "extractor": {"slug": "sbir-gov-awards-declared-reader", "display_name": "Same reader slug", "extractor_type": "script",
      "produces_kinds": ["activity"]}}'));
SELECT pg_temp.refused('an extractor that is not an object',
  format('SELECT pg_temp.review(%L, %L, %L)', (SELECT id FROM p WHERE name = 'string_extractor'),
    '00000000-0000-0000-0000-00000000a001', 'approve'), 'trust_factors, extractor and extractor_config as objects');
SELECT pg_temp.refused('an extractor_config that is not an object',
  format('SELECT pg_temp.review(%L, %L, %L)', (SELECT id FROM p WHERE name = 'array_config'),
    '00000000-0000-0000-0000-00000000a001', 'approve'), 'trust_factors, extractor and extractor_config as objects');
SELECT pg_temp.refused('an extractor without produces_kinds',
  format('SELECT pg_temp.review(%L, %L, %L)', (SELECT id FROM p WHERE name = 'no_kinds'),
    '00000000-0000-0000-0000-00000000a001', 'approve'), 'without a produces_kinds array');
SELECT pg_temp.refused('an extractor slug another source already holds (the whole approval rolls back)',
  format('SELECT pg_temp.review(%L, %L, %L)', (SELECT id FROM p WHERE name = 'taken_reader'),
    '00000000-0000-0000-0000-00000000a001', 'approve'), 'observation_extractors_slug_key');
SELECT pg_temp.ok('every refused approval left its proposal open, unreviewed and unpromoted, and registered nothing',
  (SELECT bool_and(sp.status = 'open' AND sp.resolved_at IS NULL AND sp.promoted_to_id IS NULL)
     FROM public.schema_proposals sp
    WHERE sp.id IN (SELECT id FROM p WHERE name IN ('object_patterns', 'bad_category', 'bad_kind', 'no_slug', 'scalar_trust',
      'string_extractor', 'array_config', 'no_kinds', 'taken_reader')))
  AND NOT EXISTS (SELECT 1 FROM public.schema_proposal_reviews r
    WHERE r.proposal_id IN (SELECT id FROM p WHERE name IN ('object_patterns', 'bad_category', 'bad_kind', 'no_slug',
      'scalar_trust', 'string_extractor', 'array_config', 'no_kinds', 'taken_reader')))
  AND NOT EXISTS (SELECT 1 FROM public.observation_sources
    WHERE slug IN ('object-patterns', 'bad-category', 'bad-kind', 'scalar-trust', 'string-extractor', 'array-config',
      'no-kinds', 'taken-reader'))
  AND (SELECT count(*) = 1 FROM public.observation_extractors));

-- 7. The other branches behave as before ------------------------------------------------------------------------------------
INSERT INTO p VALUES ('property', pg_temp.propose('add_property',
  '{"property_key": "award_amount_usd", "label": "Award amount", "data_type": "numeric", "unit": "USD",
    "applies_to_kinds": ["activity"], "expected_source_categories": ["registry"]}'));
SELECT pg_temp.review((SELECT id FROM p WHERE name = 'property'), '00000000-0000-0000-0000-00000000a001', 'approve');
SELECT pg_temp.ok('add_property: the property row lands pending, keyed to its proposal, and promoted_to_id names it',
  (SELECT op.namespace = 'pending' AND op.ratified_at IS NULL AND op.cardinality = 'single' AND op.verification_scope = 'instance'
      AND op.applies_to_kinds = ARRAY['activity']::public.observation_kind[]
      AND op.expected_source_categories = ARRAY['registry']::public.source_category[]
      AND op.proposed_by_proposal_id = sp.id AND sp.promoted_to_id = op.id
     FROM public.observation_properties op, public.schema_proposals sp
    WHERE op.property_key = 'award_amount_usd' AND sp.id = (SELECT id FROM p WHERE name = 'property')));
INSERT INTO p VALUES ('kind', pg_temp.propose('add_observation_kind', '{"kind_value": "funding_award"}'));
SELECT pg_temp.review((SELECT id FROM p WHERE name = 'kind'), '00000000-0000-0000-0000-00000000a001', 'approve');
SELECT pg_temp.ok('add_observation_kind: the enum gains the value; promoted_to_id stays empty as before',
  EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.observation_kind'::regtype AND enumlabel = 'funding_award')
  AND (SELECT status = 'approved' AND promoted_to_id IS NULL AND decision_rationale IS NULL
         FROM public.schema_proposals WHERE id = (SELECT id FROM p WHERE name = 'kind')));
INSERT INTO p VALUES ('category', pg_temp.propose('add_source_category', '{"category_value": "funder"}'));
SELECT pg_temp.review((SELECT id FROM p WHERE name = 'category'), '00000000-0000-0000-0000-00000000a001', 'approve');
SELECT pg_temp.ok('add_source_category stays manual: approved, nothing applied, the curator note appended',
  (SELECT status = 'approved' AND promoted_to_id IS NULL
      AND decision_rationale = E'\nAuto-apply skipped: proposal_type add_source_category requires manual application by a curator.'
     FROM public.schema_proposals WHERE id = (SELECT id FROM p WHERE name = 'category'))
  AND NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.source_category'::regtype AND enumlabel = 'funder'));
INSERT INTO p VALUES ('rejected', pg_temp.propose('add_source',
  '{"slug": "rejected-source", "display_name": "Rejected", "category": "registry"}'));
SELECT pg_temp.review((SELECT id FROM p WHERE name = 'rejected'), '00000000-0000-0000-0000-00000000a001', 'reject');
SELECT pg_temp.ok('a rejected add_source proposal registers nothing',
  (SELECT status = 'rejected' AND promoted_to_id IS NULL FROM public.schema_proposals
    WHERE id = (SELECT id FROM p WHERE name = 'rejected'))
  AND NOT EXISTS (SELECT 1 FROM public.observation_sources WHERE slug = 'rejected-source'));
SELECT pg_temp.refused('the apply function refuses a proposal that is not approved',
  format('SELECT public.fn_schema_proposal_apply(%L)', (SELECT id FROM p WHERE name = 'bad_category')),
  'expected approved');

-- 8. The migration guard: a second run is a no-op, a drifted body is refused, a missing function is created ----------------
CREATE TEMP TABLE once_def AS SELECT pg_get_functiondef('public.fn_schema_proposal_apply(uuid)'::regprocedure) AS d;
\ir ../migrations/20261007100000_schema_proposal_apply_add_source.sql
SELECT pg_temp.ok('a second run accepts the migration''s own body: the definition and the grants are unchanged',
  pg_get_functiondef('public.fn_schema_proposal_apply(uuid)'::regprocedure) = (SELECT d FROM once_def)
  AND (SELECT proacl FROM pg_proc WHERE oid = 'public.fn_schema_proposal_apply(uuid)'::regprocedure)
      IS NOT DISTINCT FROM (SELECT proacl FROM before_pg));
ALTER FUNCTION public.fn_schema_proposal_apply(uuid) SET statement_timeout TO '45s';
SELECT md5(pg_get_functiondef('public.fn_schema_proposal_apply(uuid)'::regprocedure)) AS drifted_fp \gset
\echo The ERROR below is the drift guard of the migration refusing a drifted body: the expected result.
\set ON_ERROR_STOP off
\ir ../migrations/20261007100000_schema_proposal_apply_add_source.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('drifted body: the migration refused it and left the definition untouched',
  md5(pg_get_functiondef('public.fn_schema_proposal_apply(uuid)'::regprocedure)) = :'drifted_fp'
  AND (SELECT proconfig FROM pg_proc WHERE oid = 'public.fn_schema_proposal_apply(uuid)'::regprocedure)
      = ARRAY['statement_timeout=45s']);
ALTER FUNCTION public.fn_schema_proposal_apply(uuid) RESET statement_timeout;
DROP FUNCTION public.fn_schema_proposal_apply(uuid);
\ir ../migrations/20261007100000_schema_proposal_apply_add_source.sql
SELECT pg_temp.ok('no function yet: the migration creates it with the same definition',
  pg_get_functiondef('public.fn_schema_proposal_apply(uuid)'::regprocedure) = (SELECT d FROM once_def));

\echo 'schema_proposal add_source contract: all checks passed'
