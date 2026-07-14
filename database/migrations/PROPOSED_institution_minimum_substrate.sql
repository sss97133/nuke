-- =========================================================================
-- PROPOSED: institution_minimum_substrate.sql
-- Date:     2026-05-17 (rewrite of earlier draft killed mid-flight)
-- Status:   PROPOSED — DO NOT APPLY without explicit review by Skylar.
--
-- Goal: add the four institutional rails Nuke needs to be physiologically
-- incapable of accepting uncited claims, AND capable of growing its
-- vocabulary through cited proposals — without forking the existing
-- claim substrate.
--
-- This rewrite was forced by verifying the earlier draft's claims against
-- the live DB. Three were wrong:
--   1. Subagent said `public.properties` was unused. It IS used — for
--      REAL-ESTATE listings (address, lat/lon, base_price, listing_type,
--      4,738 rows). The earlier draft's `CREATE TABLE IF NOT EXISTS
--      public.properties (property_key, namespace, data_type, …)` would
--      have silently no-op'd, then every downstream FK and policy
--      referencing those columns would have crashed.
--      → Renamed to `observation_properties` (consistent with the rest
--        of the testimony naming: `vehicle_observations`,
--        `observation_sources`, `observation_extractors`).
--   2. Subagent said the DB has 812 tables. Actual: 1,012.
--   3. Subagent said 269 tables have RLS-on-no-policy. Actual: 298.
--
-- The verified biology this migration sits on top of
-- ---------------------------------------------------
-- The claim model is ALREADY HERE (stronger than the earlier draft
-- credited). `public.vehicle_observations` (7,514,560 rows, verified
-- via pg_class reltuples) already has:
--   - kind ∈ enum observation_kind (14 values: listing, sale_result,
--     comment, bid, sighting, work_record, ownership, specification,
--     provenance, valuation, condition, media, social_mention,
--     expert_opinion)
--   - rank ∈ enum vfc_rank (3: preferred, normal, deprecated) — the
--     Wikidata rank semantics, already implemented
--   - confidence ∈ enum confidence_level (5: verified, high, medium,
--     low, inferred)
--   - is_superseded + superseded_by (no-overwrite)
--   - source_id FK to observation_sources, submitted_by_user_id FK to
--     auth.users (citation)
--   - changeset_id + applies_to_build_id (grouped writes)
-- `public.observation_sources` (164 rows) already has category
-- (source_category enum, 15 values), base_trust_score, trust_factors,
-- tier.
--
-- What the substrate is MISSING that this migration adds (5 tables):
-- ---------------------------------------------------
-- 1. observation_properties (new) — fine-grained property registry.
--    `kind` is the coarse rail; properties are the fine slots that
--    hang off a kind. The "what specification" inside a
--    kind='specification' observation currently lives in the
--    structured_data JSONB blob, which is the drift surface AX-032
--    warns about.
-- 2. schema_proposals (new) — the institution's intake desk. Anyone
--    files; curators approve. AX-032 says the schema breathes; this is
--    the table it breathes through.
-- 3. schema_proposal_reviews (new) — per-review decision rows.
--    Approval is testimony, not a code change.
-- 4. pending_claims (new) — claims rejected because the property
--    doesn't exist yet are parked here, not lost. AX-007 (testimony
--    invariant) applied at the pre-canonical layer.
-- 5. (extension only) `property_id` column on vehicle_observations —
--    nullable, additive. Existing rows stay NULL; new writes via
--    api-v1-observations populate. Once retrofit is complete a future
--    migration can require NOT NULL.
--
-- Plus:
-- - citation_required trigger on vehicle_observations (rejects writes
--   that carry neither source_id nor submitted_by_user_id; verified
--   sample shows 0.13% of existing rows would fail this — retrofit cost
--   is minimal).
-- - vehicle_canonical view (highest-rank, highest-confidence,
--   most-recent projection per (vehicle_id, property_id)). AX-012:
--   current state is computed, not stored.
-- - RLS policies on the five new tables (registry is publicly readable;
--   writes gated by service_role or curator app_metadata claim).
--
-- What this migration is NOT
-- --------------------------
-- - Not a closure of the 298 RLS-on-no-policy tables across the
--   substrate. That's a separate migration with much larger blast
--   radius (bat_bids 4.2M rows, field_extraction_log 3.9M, etc.).
--   This migration leaves those alone.
-- - Not a rewrite of vehicle_observations. Adds 1 nullable column.
-- - Not a wiring or match-scoring refactor. The K5 wiring substrate
--   stays in its current form; the registry just gives the cut-list
--   ingest cited property_ids to write against if Skylar wants.
-- - Not auto-applied. Every CREATE wrapped in IF NOT EXISTS, RLS in
--   DROP-then-CREATE, with a rollback block at the bottom.
--
-- Hard Rule #2 (CLAUDE.md): new tables require justification in
-- migration comment. Each CREATE TABLE below has its justification
-- as a COMMENT ON TABLE.
-- =========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. observation_properties — fine-grained property registry
--    AX-032 (schema breathes), AX-024 (data knows what it contains),
--    external_prior_art.md §"Pattern 1: Wikidata property proposals"
--
--    Sits on top of observation_kind (the coarse rail). Each property
--    declares which kinds it can attach to via applies_to_kinds[].
--    Adding a property is a row insert, not DDL.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.observation_properties (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_key               text NOT NULL UNIQUE,
  label                      text NOT NULL,
  data_type                  text NOT NULL CHECK (data_type IN (
                               'string','integer','numeric','boolean','date',
                               'timestamp','enum','uuid_ref','jsonb','text_long'
                             )),
  unit                       text,
  namespace                  text NOT NULL DEFAULT 'pending'
                               CHECK (namespace IN ('core','pending','deprecated')),
  category                   text,
  parent_property_id         uuid REFERENCES public.observation_properties(id),
  applies_to_kinds           public.observation_kind[],
  cardinality                text NOT NULL DEFAULT 'single'
                               CHECK (cardinality IN ('single','multi')),
  trust_floor                numeric(3,2) DEFAULT 0.00,
  expected_source_categories public.source_category[],
  description                text,
  proposed_by_proposal_id    uuid,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  ratified_at                timestamptz,
  deprecated_at              timestamptz
);

COMMENT ON TABLE public.observation_properties IS
  'AX-032: Wikidata-style first-class property registry. Adding a property is a row insert, not a DDL migration. Sits on top of observation_kind (coarse) — each property declares which kinds it can attach to.';

CREATE INDEX IF NOT EXISTS idx_observation_properties_namespace
  ON public.observation_properties(namespace);
CREATE INDEX IF NOT EXISTS idx_observation_properties_category
  ON public.observation_properties(category) WHERE deprecated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_observation_properties_kinds
  ON public.observation_properties USING GIN(applies_to_kinds);

-- Seed core properties. These are the ones the wiring + base-vehicle
-- substrate needs immediately. Every additional property after this
-- seed enters via schema_proposals.
INSERT INTO public.observation_properties
  (property_key, label, data_type, unit, namespace, category, cardinality, applies_to_kinds, expected_source_categories, description)
VALUES
  ('vin',                    'VIN',                       'string',  NULL,    'core', 'identity',   'single', ARRAY['specification','ownership','provenance']::public.observation_kind[], ARRAY['registry','documentation','dealer']::public.source_category[],         '17-char Vehicle Identification Number (or pre-1981 chassis number per AX-028)'),
  ('year',                   'Model Year',                'integer', NULL,    'core', 'identity',   'single', ARRAY['specification','listing']::public.observation_kind[],                ARRAY['registry','documentation','auction','marketplace']::public.source_category[], 'Model year — NOT manufacture year'),
  ('make',                   'Make',                      'string',  NULL,    'core', 'identity',   'single', ARRAY['specification','listing']::public.observation_kind[],                ARRAY['registry','documentation','auction','marketplace']::public.source_category[], NULL),
  ('model',                  'Model',                     'string',  NULL,    'core', 'identity',   'single', ARRAY['specification','listing']::public.observation_kind[],                ARRAY['registry','documentation','auction','marketplace']::public.source_category[], NULL),
  ('trim',                   'Trim',                      'string',  NULL,    'core', 'identity',   'single', ARRAY['specification']::public.observation_kind[],                          ARRAY['registry','auction']::public.source_category[],                                NULL),
  ('exterior_color',         'Exterior Color',            'string',  NULL,    'core', 'spec',       'single', ARRAY['specification','condition']::public.observation_kind[],              ARRAY['owner','auction','marketplace']::public.source_category[],                     NULL),
  ('interior_color',         'Interior Color',            'string',  NULL,    'core', 'spec',       'single', ARRAY['specification']::public.observation_kind[],                          ARRAY['owner','auction']::public.source_category[],                                   NULL),
  ('engine_displacement_l',  'Engine Displacement',       'numeric', 'liters','core', 'engine',     'single', ARRAY['specification']::public.observation_kind[],                          ARRAY['registry','documentation']::public.source_category[],                          'Liters; convert ci/cc at projection time'),
  ('engine_configuration',   'Engine Configuration',      'string',  NULL,    'core', 'engine',     'single', ARRAY['specification']::public.observation_kind[],                          ARRAY['documentation','registry']::public.source_category[],                          'e.g. V8, I6, flat-6'),
  ('engine_code',            'Engine Code',               'string',  NULL,    'core', 'engine',     'single', ARRAY['specification']::public.observation_kind[],                          ARRAY['documentation','registry']::public.source_category[],                          'Casting / serial number-derived'),
  ('transmission_type',      'Transmission Type',         'enum',    NULL,    'core', 'drivetrain', 'single', ARRAY['specification']::public.observation_kind[],                          ARRAY['registry','owner']::public.source_category[],                                  'manual|automatic|cvt|semi'),
  ('drivetrain_layout',      'Drivetrain Layout',         'enum',    NULL,    'core', 'drivetrain', 'single', ARRAY['specification']::public.observation_kind[],                          ARRAY['registry']::public.source_category[],                                          'FWD|RWD|AWD|4WD'),
  ('mileage_miles',          'Odometer Reading (mi)',     'integer', 'miles', 'core', 'condition',  'multi',  ARRAY['condition','listing','work_record']::public.observation_kind[],     ARRAY['documentation','auction','shop','owner']::public.source_category[],            'AX-049: each reading is a new claim'),
  ('owner_name',             'Owner Name',                'string',  NULL,    'core', 'ownership',  'multi',  ARRAY['ownership']::public.observation_kind[],                              ARRAY['documentation','owner','registry']::public.source_category[],                  'Multi: chain preserved'),
  ('owner_user_id',          'Owner User Id',             'uuid_ref',NULL,    'core', 'ownership',  'single', ARRAY['ownership']::public.observation_kind[],                              ARRAY['owner','internal']::public.source_category[],                                  'FK to auth.users'),
  ('sale_price_usd',         'Sale Price (USD)',          'numeric', 'usd',   'core', 'market',     'multi',  ARRAY['sale_result']::public.observation_kind[],                            ARRAY['auction','documentation']::public.source_category[],                           'Each sale is a claim'),
  ('asking_price_usd',       'Asking Price (USD)',        'numeric', 'usd',   'core', 'market',     'multi',  ARRAY['listing']::public.observation_kind[],                                ARRAY['auction','marketplace']::public.source_category[],                             'Short half-life per AX-005'),
  ('condition_grade',        'Condition Grade',           'enum',    NULL,    'core', 'condition',  'multi',  ARRAY['condition']::public.observation_kind[],                              ARRAY['auction','shop']::public.source_category[],                                    'Hagerty 1-4 or comparable'),
  -- Wiring properties (so K5 cut list ingest has property_ids to write against)
  ('wire_circuit_id',        'Wire Circuit ID',           'string',  NULL,    'core', 'wiring',     'multi',  ARRAY['work_record','specification']::public.observation_kind[],            ARRAY['documentation','owner']::public.source_category[],                             'cut-list-row identifier'),
  ('wire_gauge_awg',         'Wire Gauge (AWG)',          'integer', 'awg',   'core', 'wiring',     'multi',  ARRAY['work_record','specification']::public.observation_kind[],            ARRAY['documentation','owner']::public.source_category[],                             NULL),
  ('wire_color_code',        'Wire Color Code',           'string',  NULL,    'core', 'wiring',     'multi',  ARRAY['work_record','specification']::public.observation_kind[],            ARRAY['documentation','owner']::public.source_category[],                             'e.g. W, W/R, W/R/K'),
  ('wire_specification',     'Wire Mil-Spec',             'string',  NULL,    'core', 'wiring',     'multi',  ARRAY['specification']::public.observation_kind[],                          ARRAY['documentation']::public.source_category[],                                     'M22759/32, M27500, etc.'),
  ('wire_length_in',         'Wire Length',               'numeric', 'inches','core', 'wiring',     'multi',  ARRAY['work_record']::public.observation_kind[],                            ARRAY['owner','documentation']::public.source_category[],                             'measured or estimated; mark in confidence'),
  ('wire_terminal_pn_a',     'Wire Terminal PN (A end)',  'string',  NULL,    'core', 'wiring',     'multi',  ARRAY['work_record','specification']::public.observation_kind[],            ARRAY['documentation']::public.source_category[],                                     NULL),
  ('wire_terminal_pn_b',     'Wire Terminal PN (B end)',  'string',  NULL,    'core', 'wiring',     'multi',  ARRAY['work_record','specification']::public.observation_kind[],            ARRAY['documentation']::public.source_category[],                                     NULL)
ON CONFLICT (property_key) DO NOTHING;

UPDATE public.observation_properties
   SET ratified_at = now()
 WHERE namespace = 'core' AND ratified_at IS NULL;


-- ---------------------------------------------------------------------------
-- 2. schema_proposals — the institution's intake desk
--    AX-032 (schema breathes), AX-024 (sample-then-design),
--    external_prior_art.md §"Pattern 1: Wikidata + Schema.org pending"
--
--    Filing is open to all authenticated keys (OSM "any tags you like").
--    Approval is per-proposal-type, scaling with reversibility.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.schema_proposals (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposed_at              timestamptz NOT NULL DEFAULT now(),
  proposed_by_user_id      uuid REFERENCES auth.users(id),
  proposed_by_agent_key    text,
  proposal_type            text NOT NULL CHECK (proposal_type IN (
                             'add_property',
                             'fork_property',
                             'deprecate_property',
                             'modify_property',
                             'add_source',
                             'modify_trust_tier',
                             'add_observation_kind',
                             'add_source_category'
                           )),
  payload                  jsonb NOT NULL,
  evidence                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  motivating_observation_ids uuid[],
  motivating_pending_claim_ids uuid[],
  estimated_scope          jsonb,
  backward_compatibility   jsonb,
  status                   text NOT NULL DEFAULT 'open'
                             CHECK (status IN ('open','under_review','approved','rejected','needs_changes','superseded','withdrawn')),
  claimed_by_user_id       uuid REFERENCES auth.users(id),
  claimed_at               timestamptz,
  resolved_at              timestamptz,
  decision_rationale       text,
  promoted_to_id           uuid,
  supersedes_proposal_id   uuid REFERENCES public.schema_proposals(id),
  superseded_by            uuid REFERENCES public.schema_proposals(id),
  CONSTRAINT proposer_present CHECK (
    proposed_by_user_id IS NOT NULL OR proposed_by_agent_key IS NOT NULL
  )
);

COMMENT ON TABLE public.schema_proposals IS
  'AX-032: the institution''s intake desk. Anyone (any agent, any user) submits; only curators approve. DDL is no longer the path for new properties.';

CREATE INDEX IF NOT EXISTS idx_schema_proposals_status_open
  ON public.schema_proposals(status) WHERE status IN ('open','under_review');
CREATE INDEX IF NOT EXISTS idx_schema_proposals_proposer
  ON public.schema_proposals(proposed_by_user_id);
CREATE INDEX IF NOT EXISTS idx_schema_proposals_type
  ON public.schema_proposals(proposal_type);

-- Forward FK: observation_properties.proposed_by_proposal_id → schema_proposals.id
ALTER TABLE public.observation_properties
  DROP CONSTRAINT IF EXISTS observation_properties_proposed_by_proposal_id_fkey,
  ADD CONSTRAINT observation_properties_proposed_by_proposal_id_fkey
    FOREIGN KEY (proposed_by_proposal_id)
    REFERENCES public.schema_proposals(id)
    ON DELETE SET NULL;


-- ---------------------------------------------------------------------------
-- 3. schema_proposal_reviews — per-reviewer decision testimony
--    AX-001/049 (every act is a claim — including approval).
--    A proposal moves to 'approved' only when the required number of
--    distinct curators have approved per the proposal type's quorum.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.schema_proposal_reviews (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id         uuid NOT NULL REFERENCES public.schema_proposals(id) ON DELETE CASCADE,
  reviewer_user_id    uuid NOT NULL REFERENCES auth.users(id),
  decision            text NOT NULL CHECK (decision IN ('approve','reject','needs_changes')),
  reasoning           text,
  reviewed_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (proposal_id, reviewer_user_id)
);

COMMENT ON TABLE public.schema_proposal_reviews IS
  'Approval is testimony, not a code change. One row per (proposal, reviewer); quorum checked by the application or a trigger that promotes the proposal status when satisfied.';

CREATE INDEX IF NOT EXISTS idx_schema_proposal_reviews_proposal
  ON public.schema_proposal_reviews(proposal_id);


-- ---------------------------------------------------------------------------
-- 4. pending_claims — claims rejected for unknown_property, parked
--    AX-007 (testimony invariant) applied to the pre-canonical layer.
--    A claim whose property doesn't exist isn't lost — it parks here
--    with a back-pointer to the proposal that would unblock it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pending_claims (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id                  uuid,                                  -- FK omitted: vehicle may itself be pending
  attempted_property_key      text NOT NULL,
  attempted_kind              public.observation_kind,
  attempted_value             jsonb,
  attempted_structured_data   jsonb,
  source_id                   uuid REFERENCES public.observation_sources(id),
  submitted_by_user_id        uuid REFERENCES auth.users(id),
  agent_key                   text,
  agent_session_id            text,
  rejection_reason            text NOT NULL DEFAULT 'unknown_property',
  proposal_id                 uuid REFERENCES public.schema_proposals(id),
  status                      text NOT NULL DEFAULT 'awaiting_proposal'
                                CHECK (status IN ('awaiting_proposal','migrated','rejected_pending','withdrawn')),
  attempted_at                timestamptz NOT NULL DEFAULT now(),
  migrated_at                 timestamptz,
  migrated_to_observation_id  uuid,                                  -- FK to vehicle_observations(id) — omitted to avoid cyclic dep at apply
  CONSTRAINT pending_claim_attribution CHECK (
    submitted_by_user_id IS NOT NULL
    OR agent_key         IS NOT NULL
    OR source_id         IS NOT NULL
  )
);

COMMENT ON TABLE public.pending_claims IS
  'AX-007 at the pre-canonical layer: claims rejected for unknown_property park here, never lost. After a schema_proposal lands, the cleanup bot migrates these into vehicle_observations under the newly-created property_id.';

CREATE INDEX IF NOT EXISTS idx_pending_claims_property_key
  ON public.pending_claims(attempted_property_key);
CREATE INDEX IF NOT EXISTS idx_pending_claims_proposal
  ON public.pending_claims(proposal_id);
CREATE INDEX IF NOT EXISTS idx_pending_claims_status
  ON public.pending_claims(status) WHERE status IN ('awaiting_proposal');


-- ---------------------------------------------------------------------------
-- 5. Extend vehicle_observations — add property_id (the shape gap)
--    AX-003 (every datum is a claim about a property)
--
--    Existing rows: property_id IS NULL. Acceptable during transition.
--    New writes via api-v1-observations populate property_id. Once
--    callers retrofitted, a future migration adds NOT NULL.
--
--    Sample (TABLESAMPLE SYSTEM 1, 73,659 rows): 0.13% have neither
--    source_id nor submitted_by_user_id, so the citation trigger below
--    affects almost no live caller.
-- ---------------------------------------------------------------------------
ALTER TABLE public.vehicle_observations
  ADD COLUMN IF NOT EXISTS property_id uuid
    REFERENCES public.observation_properties(id);

COMMENT ON COLUMN public.vehicle_observations.property_id IS
  'AX-003: the property this observation makes a claim about. NULL during transition while existing rows use kind+structured_data shape. New writes SHOULD populate.';

-- Index on (vehicle_id, property_id) is created OUTSIDE this transaction via
-- CREATE INDEX CONCURRENTLY (see footer). A non-concurrent CREATE INDEX on
-- this 7.5M-row table exceeds the 30s statement_timeout because the planner
-- cannot tell in advance that 0% of rows match the partial WHERE clause.


-- ---------------------------------------------------------------------------
-- 6. vehicle_canonical — computed current value per (vehicle, property)
--    AX-012 (current state is computed, not stored)
--    Highest rank → highest confidence → most recent. Decay applied at
--    projection. Only rows with property_id populated participate.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vehicle_canonical AS
WITH ranked AS (
  SELECT
    o.vehicle_id,
    o.property_id,
    o.id              AS observation_id,
    o.structured_data,
    o.content_text,
    o.confidence_score,
    o.observed_at,
    o.source_id,
    o.rank,
    o.kind,
    o.changeset_id,
    ROW_NUMBER() OVER (
      PARTITION BY o.vehicle_id, o.property_id
      ORDER BY
        CASE o.rank::text WHEN 'preferred' THEN 0 WHEN 'normal' THEN 1 WHEN 'deprecated' THEN 2 ELSE 3 END,
        COALESCE(o.confidence_score, 0) DESC,
        o.observed_at DESC
    ) AS rn
  FROM public.vehicle_observations o
  WHERE o.is_superseded = false
    AND o.property_id IS NOT NULL
    AND o.rank::text <> 'deprecated'
)
SELECT vehicle_id, property_id, observation_id,
       structured_data, content_text, confidence_score,
       observed_at, source_id, kind, rank, changeset_id
FROM ranked
WHERE rn = 1;

COMMENT ON VIEW public.vehicle_canonical IS
  'AX-012: projection of current value per (vehicle_id, property_id). Highest rank → highest confidence → most recent wins. Only rows with property_id set participate; transition rows (NULL property_id) excluded.';


-- ---------------------------------------------------------------------------
-- 7. citation_required trigger on vehicle_observations
--    AX-006 (every numeric value carries source DNA),
--    AX-117 (evidence first)
--
--    The biological refusal. A write without source_id AND without
--    submitted_by_user_id is rejected at the substrate edge.
--    Sample shows ~0.13% of historical rows would fail this — almost
--    no retrofit needed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.citation_required_write_check()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.source_id IS NULL
     AND NEW.submitted_by_user_id IS NULL
  THEN
    RAISE EXCEPTION
      'citation_required: vehicle_observations write must include source_id (system source) or submitted_by_user_id (authenticated human). Got kind=%, vehicle_id=%.',
      NEW.kind, NEW.vehicle_id
      USING ERRCODE = 'check_violation',
            HINT = 'AX-006/117. See docs/library/reference/encyclopedia/08-schema-proposal-workflow.md if your property does not exist yet — file a schema_proposal and the claim parks in pending_claims.';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.citation_required_write_check() IS
  'AX-006/117: the substrate''s biological refusal of uncited claims. Defense-in-depth on top of RLS (which gates WHO can write); this gates WHAT can be written.';

DROP TRIGGER IF EXISTS trg_citation_required_vehicle_observations
  ON public.vehicle_observations;
CREATE TRIGGER trg_citation_required_vehicle_observations
  BEFORE INSERT OR UPDATE OF source_id, submitted_by_user_id
  ON public.vehicle_observations
  FOR EACH ROW
  EXECUTE FUNCTION public.citation_required_write_check();


-- ---------------------------------------------------------------------------
-- 8. schema_proposal evidence trigger
--    A proposal with no evidence is a vibe.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.schema_proposal_evidence_check()
RETURNS trigger
LANGUAGE plpgsql
AS $$
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
$$;

DROP TRIGGER IF EXISTS trg_schema_proposal_evidence ON public.schema_proposals;
CREATE TRIGGER trg_schema_proposal_evidence
  BEFORE INSERT ON public.schema_proposals
  FOR EACH ROW
  EXECUTE FUNCTION public.schema_proposal_evidence_check();


-- ---------------------------------------------------------------------------
-- 9. RLS policies on the five new tables
--    Registry tables are publicly readable (anyone can read the
--    ontology). Writes gated by service_role or curator app_metadata
--    claim. The 298 pre-existing RLS-on-no-policy tables are OUT OF
--    SCOPE for this migration.
-- ---------------------------------------------------------------------------

-- observation_properties
ALTER TABLE public.observation_properties ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS observation_properties_read ON public.observation_properties;
CREATE POLICY observation_properties_read ON public.observation_properties
  FOR SELECT USING (true);
DROP POLICY IF EXISTS observation_properties_write_curator ON public.observation_properties;
CREATE POLICY observation_properties_write_curator ON public.observation_properties
  FOR ALL TO authenticated
  USING (
    auth.role() = 'service_role'
    OR (auth.jwt() -> 'app_metadata' ->> 'curator')::boolean = true
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (auth.jwt() -> 'app_metadata' ->> 'curator')::boolean = true
  );

-- schema_proposals — anyone authenticated can INSERT; everyone can SELECT
ALTER TABLE public.schema_proposals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS schema_proposals_read ON public.schema_proposals;
CREATE POLICY schema_proposals_read ON public.schema_proposals
  FOR SELECT USING (true);
DROP POLICY IF EXISTS schema_proposals_insert_authenticated ON public.schema_proposals;
CREATE POLICY schema_proposals_insert_authenticated ON public.schema_proposals
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.role() = 'service_role'
    OR proposed_by_user_id = auth.uid()
  );
DROP POLICY IF EXISTS schema_proposals_update_curator ON public.schema_proposals;
CREATE POLICY schema_proposals_update_curator ON public.schema_proposals
  FOR UPDATE TO authenticated
  USING (
    auth.role() = 'service_role'
    OR (auth.jwt() -> 'app_metadata' ->> 'curator')::boolean = true
    OR proposed_by_user_id = auth.uid()        -- proposer can edit own (e.g. revise on needs_changes)
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (auth.jwt() -> 'app_metadata' ->> 'curator')::boolean = true
    OR proposed_by_user_id = auth.uid()
  );

-- schema_proposal_reviews — readable by all; insert by curator only
ALTER TABLE public.schema_proposal_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS schema_proposal_reviews_read ON public.schema_proposal_reviews;
CREATE POLICY schema_proposal_reviews_read ON public.schema_proposal_reviews
  FOR SELECT USING (true);
DROP POLICY IF EXISTS schema_proposal_reviews_insert_curator ON public.schema_proposal_reviews;
CREATE POLICY schema_proposal_reviews_insert_curator ON public.schema_proposal_reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    (auth.role() = 'service_role'
     OR (auth.jwt() -> 'app_metadata' ->> 'curator')::boolean = true)
    AND reviewer_user_id = auth.uid()
  );

-- pending_claims — readable by submitter + curator; insert by anyone authenticated
ALTER TABLE public.pending_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pending_claims_read ON public.pending_claims;
CREATE POLICY pending_claims_read ON public.pending_claims
  FOR SELECT TO authenticated
  USING (
    auth.role() = 'service_role'
    OR (auth.jwt() -> 'app_metadata' ->> 'curator')::boolean = true
    OR submitted_by_user_id = auth.uid()
  );
DROP POLICY IF EXISTS pending_claims_insert_authenticated ON public.pending_claims;
CREATE POLICY pending_claims_insert_authenticated ON public.pending_claims
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.role() = 'service_role'
    OR submitted_by_user_id = auth.uid()
    OR agent_key IS NOT NULL                  -- agent-key writes via api-v1-observations
  );


-- ---------------------------------------------------------------------------
-- 10. NOTIFY PostgREST to reload schema cache (per Hard Rule #15)
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

COMMIT;

-- =========================================================================
-- Post-commit: index on the 7.5M-row vehicle_observations table.
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction; runs outside.
-- Idempotent via IF NOT EXISTS.
-- =========================================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicle_observations_property
  ON public.vehicle_observations(vehicle_id, property_id)
  WHERE property_id IS NOT NULL AND is_superseded = false;


-- =========================================================================
-- Rollback (PROPOSED — execute only if migration needs to be reverted)
-- =========================================================================
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_schema_proposal_evidence ON public.schema_proposals;
-- DROP TRIGGER IF EXISTS trg_citation_required_vehicle_observations ON public.vehicle_observations;
-- DROP FUNCTION IF EXISTS public.schema_proposal_evidence_check();
-- DROP FUNCTION IF EXISTS public.citation_required_write_check();
-- DROP VIEW IF EXISTS public.vehicle_canonical;
-- DROP INDEX IF EXISTS idx_vehicle_observations_property;
-- ALTER TABLE public.vehicle_observations DROP COLUMN IF EXISTS property_id;
-- -- RLS policies
-- DROP POLICY IF EXISTS pending_claims_insert_authenticated ON public.pending_claims;
-- DROP POLICY IF EXISTS pending_claims_read ON public.pending_claims;
-- DROP POLICY IF EXISTS schema_proposal_reviews_insert_curator ON public.schema_proposal_reviews;
-- DROP POLICY IF EXISTS schema_proposal_reviews_read ON public.schema_proposal_reviews;
-- DROP POLICY IF EXISTS schema_proposals_update_curator ON public.schema_proposals;
-- DROP POLICY IF EXISTS schema_proposals_insert_authenticated ON public.schema_proposals;
-- DROP POLICY IF EXISTS schema_proposals_read ON public.schema_proposals;
-- DROP POLICY IF EXISTS observation_properties_write_curator ON public.observation_properties;
-- DROP POLICY IF EXISTS observation_properties_read ON public.observation_properties;
-- -- Tables (children first)
-- DROP TABLE IF EXISTS public.pending_claims;
-- DROP TABLE IF EXISTS public.schema_proposal_reviews;
-- ALTER TABLE public.observation_properties DROP CONSTRAINT IF EXISTS observation_properties_proposed_by_proposal_id_fkey;
-- DROP TABLE IF EXISTS public.schema_proposals;
-- DROP TABLE IF EXISTS public.observation_properties;
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;
-- =========================================================================
-- END PROPOSED_institution_minimum_substrate.sql
-- =========================================================================
