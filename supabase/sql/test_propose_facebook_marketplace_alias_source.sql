-- Isolated PostgreSQL 17 regression: synthetic rows only, never production data.
-- Contract for 20261015014500_propose_facebook_marketplace_alias_source.sql: the migration files one open add_source
-- proposal for slug 'facebook-marketplace' with cited evidence (accepted by the live evidence trigger), files nothing
-- when the platform entity already holds that slug, and does not duplicate an open proposal on re-apply. It never
-- writes observation_sources itself.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%'
   OR current_setting('server_version_num')::int / 10000 <> 17
   OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
 RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database'; END IF;
END $$;
SET statement_timeout='30s';
SET lock_timeout='3s';

CREATE TABLE public.observation_sources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE);
INSERT INTO public.observation_sources(slug) VALUES ('facebook_marketplace');
-- schema_proposals as on prod (columns and checks read 2026-10-14).
CREATE TABLE public.schema_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposed_at timestamptz NOT NULL DEFAULT now(),
  proposed_by_user_id uuid, proposed_by_agent_key text,
  proposal_type text NOT NULL, payload jsonb NOT NULL, evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  motivating_observation_ids uuid[], motivating_pending_claim_ids uuid[],
  estimated_scope jsonb, backward_compatibility jsonb,
  status text NOT NULL DEFAULT 'open',
  CONSTRAINT proposer_present CHECK (proposed_by_user_id IS NOT NULL OR proposed_by_agent_key IS NOT NULL),
  CONSTRAINT schema_proposals_status_check CHECK (status = ANY (ARRAY['open', 'under_review', 'approved', 'rejected',
    'needs_changes', 'superseded', 'withdrawn'])),
  CONSTRAINT schema_proposals_proposal_type_check CHECK (proposal_type = ANY (ARRAY['add_property', 'fork_property',
    'deprecate_property', 'modify_property', 'add_source', 'modify_trust_tier', 'add_observation_kind',
    'add_source_category', 'add_image_attribute', 'add_column', 'add_table']))
);
-- The live evidence trigger (AX-024), same condition as prod.
CREATE FUNCTION public.schema_proposal_evidence_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.proposal_type IN ('add_property','fork_property','modify_property','add_source','add_source_category','add_observation_kind')
     AND (NEW.evidence IS NULL OR jsonb_array_length(NEW.evidence) = 0)
     AND (NEW.motivating_observation_ids   IS NULL OR array_length(NEW.motivating_observation_ids, 1)   IS NULL)
     AND (NEW.motivating_pending_claim_ids IS NULL OR array_length(NEW.motivating_pending_claim_ids, 1) IS NULL)
  THEN
    RAISE EXCEPTION 'schema_proposal_evidence: proposal type % requires evidence[]', NEW.proposal_type;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER schema_proposal_evidence_check BEFORE INSERT OR UPDATE ON public.schema_proposals
  FOR EACH ROW EXECUTE FUNCTION public.schema_proposal_evidence_check();
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label;
END $$;

-- If the entity already holds the slug, nothing is filed.
INSERT INTO public.observation_sources(slug) VALUES ('facebook-marketplace');
\ir ../migrations/20261015014500_propose_facebook_marketplace_alias_source.sql
SELECT pg_temp.ok('no proposal when the entity row exists',
  NOT EXISTS (SELECT 1 FROM public.schema_proposals WHERE payload->>'slug' = 'facebook-marketplace'));
DELETE FROM public.observation_sources WHERE slug = 'facebook-marketplace';

\ir ../migrations/20261015014500_propose_facebook_marketplace_alias_source.sql
-- A second application does not duplicate the open proposal.
\ir ../migrations/20261015014500_propose_facebook_marketplace_alias_source.sql

SELECT pg_temp.ok('exactly one open proposal is filed',
  (SELECT count(*) = 1 AND bool_and(status = 'open' AND proposal_type = 'add_source'
          AND proposed_by_agent_key = 'night-run/platform-resolution')
     FROM public.schema_proposals WHERE payload->>'slug' = 'facebook-marketplace'));
SELECT pg_temp.ok('the payload mirrors the canonical sibling',
  (SELECT payload->>'category' = 'marketplace' AND (payload->>'tier')::int = 3
          AND (payload->>'base_trust_score')::numeric = 0.60
          AND payload->'supported_observations' = '["listing", "sale_result", "media"]'::jsonb
          AND payload->>'notes' LIKE '%Sibling of slug facebook_marketplace%'
     FROM public.schema_proposals WHERE payload->>'slug' = 'facebook-marketplace'));
SELECT pg_temp.ok('evidence carries three cited measures',
  (SELECT jsonb_array_length(evidence) = 3 AND evidence->0->>'value' = '78509'
     FROM public.schema_proposals WHERE payload->>'slug' = 'facebook-marketplace'));
SELECT pg_temp.ok('the migration writes no platform entity row',
  (SELECT count(*) = 1 FROM public.observation_sources) AND
  NOT EXISTS (SELECT 1 FROM public.observation_sources WHERE slug = 'facebook-marketplace'));

-- An approved proposal also blocks a re-file.
UPDATE public.schema_proposals SET status = 'approved' WHERE payload->>'slug' = 'facebook-marketplace';
\ir ../migrations/20261015014500_propose_facebook_marketplace_alias_source.sql
SELECT pg_temp.ok('an approved proposal is not duplicated',
  (SELECT count(*) = 1 FROM public.schema_proposals WHERE payload->>'slug' = 'facebook-marketplace'));
