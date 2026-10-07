-- Case ledger §13.2, "How we get there" item 1 (docs/ledger/theory/data-machine-cases.md): the stack registry as data.
--
-- WHY. On 2026-10-06/07 the owner asked to start every session from the stacks (§13, 13.1, 13.2) and to see "how close
-- we are to actually showing them". The 64 stacks (the twenty of §13, the forty of 13.2 and the four built through every
-- layer, A to D) lived only in a markdown table. 13.1 says a stack is a named, versioned definition that readers cite;
-- 13.2 says the registry should sit in the vein family with a coverage function from the atlas and pipeline_registry,
-- refreshed by the pulse. This migration is that registry: the stacks, their needs as rows, the abstract layers they
-- name, a coverage function that resolves every need to present, partial or missing by a measure, and one reader view.
--
-- MEASURED BEFORE (prod, read-only through scripts/data/q.sh, 2026-10-07 00:30Z to 01:30Z):
--   vein_ledger 11 rows (V001-V007, V010-V013) and vein_runs 15 rows. vein_ledger holds one pre-registered hypothesis
--   per version, with seven NOT NULL blanks (hypothesis, intent, population, outcome, test, pass_rule, baseline) and status
--   active or retired; it is append-only through vein_append_only().
--   Search before mint: 77 tables and views named like stack, thesis, hypothesis, coverage, need, registry, catalog, metric,
--   capability, question or analysis. Read in full: coverage_targets (completeness goal per source and segment),
--   reference_coverage (reference documents per make, model and topic), analysis_widgets (per-vehicle widget registry),
--   analysis_weight_configs, model_registry (AI models), pipeline_registry (owner per table and column), schema_proposals
--   (shape proposals). None holds a named path through the nine layers with typed needs.
--   schema_proposals: 27 rows; its proposal_type vocabulary had no value for a new table.
--   v_schema_atlas full read: 0.53 s (EXPLAIN ANALYZE). pg_stats read by schema, table and column: one index probe.
--
-- DESIGN (the lead offered: extend vein_ledger, a child of it, or a new table only if neither fits).
--   Chosen: a child of the vein family. public.stacks is a versioned registry whose scored thesis is a vein_ledger row
--   (thesis_vein_id, thesis_vein_version, a foreign key). Pass rules stay in vein_ledger only, so there is one hypothesis
--   family and no second table of pass rules. vein_ledger is not changed.
--   Not chosen, extending vein_ledger: a stack is a path with needs, a different grain from one pre-registered hypothesis.
--   The case ledger states a thesis for stack A and, through V012, for stack 3; the other 62 stacks would have filled the
--   seven NOT NULL blanks with placeholder text, which would weaken the rule that a vein's pass rule is written before
--   counting. Stack status (proposed to live) is not vein status (active, retired). vein_ledger is readable by anon and
--   the stack readers are service_role only.
--   Needs are rows (public.stack_needs): one row per layer and object a stack version needs. Abstract layers (a place
--   entity, the text fold) are rows of public.stack_substrates, an allowlist that declares which table implements each one.
--   A substrate is missing until a migration declares its table there; then every stack that needs it is measured on that
--   table at once, with no new stack version. That is 13.1 point 4: sources are pluggable.
--   Stacks and needs are append-only (vein_append_only(), as for veins). A change of definition or status is a new version
--   with supersedes_version; readers take the latest version and cite (stack_id, version). Substrate declarations are
--   registry updates made by migrations, like pipeline_registry rows.
--
-- COVERAGE (stack_coverage(p_stack_id), read by v_stacks; one call measures every current stack, about 1 s on prod):
--   coverage = needs present / needs, for the latest version of each stack. Partial counts as not present; it is reported.
--   table     a table in public, read from v_schema_atlas. present: est_rows > 0, and at the fold, baseline, residual,
--             feature and prediction layers also an owner in pipeline_registry. partial: the table exists with no rows by
--             the planner estimate, or such a layer has no declared owner. missing: no such table.
--   column    table.column. fill = 1 - pg_stats.null_frac, divided by the fill of the denominator column when one is named
--             (a key over the rows that carry the text it keys). present: fill >= 0.9, and at the key layer a foreign key
--             on the column. partial: the column exists with a lower fill, no statistics, or a key with no foreign key.
--             missing: no such column.
--   function  a function in public. present when it exists, missing otherwise.
--   intake    table.clock_column with fresh_within. present: the newest clock value is inside the window. partial: older,
--             no rows, or not measurable (no index on the clock of a table over 1,000,000 rows). missing: no such column,
--             or the column is not a timestamp or date. The newest value is read with max(), once per object.
--   stack     another stack. present when all of that stack's own needs are present, partial when some are, missing when
--             none are or the stack does not exist. Its own needs are counted without its stack needs (one level).
--   abstract  a stack_substrates row. missing until declared_table is set; then measured as a table.
--
-- SEED. 64 stacks (S01-S60 are the case ledger's numbers 1-60; SA-SD are stacks A-D), status measured, source
--   'data-machine-cases.md §13 2026-10-06/07', 151 needs and 47 substrates. The needs are the ledger's missing-layer text
--   for 1-20 and 21-60, the §13 assignments (place entity 1, 11, 13, 16; text fold 4, 5, 19; dimensions 12, 14; clocks 10,
--   18; zone 6), the stack numbers the ledger cites as inputs (13, 15, 42, 49, 52, 54, 56-59), and for A-D the layers their
--   text names. A stack's own fold, baseline, residual, feature and prediction are not needs: coverage says how much of what
--   a stack sits on is present, and status says whether it is built. Rows hold the structured form; the owner's words stay
--   in the case ledger. Questions are short restatements of each stack's name and chain. who_cares is NULL (the ledger does
--   not state it for any stack) and scoring is set for A-D only. S03's thesis is V012 version 1.
--
-- MEASURED 2026-10-07T00:59Z (this file's stack_coverage body over the seed held inline, run read-only through
--   scripts/data/q.sh; nothing written): 1.03 s for all 64 stacks (planning 0.31 s, execution 0.72 s). Of the 151 needs,
--   15 were present, 33 partial and 103 missing. Coverage 1 for S03, S21, S47, S48 and S56; SA 0.6; S26 and S36 0.5; S09
--   and S58 0.25; SD 0.2; the other 53 stacks 0. The needs that block the most stacks: the place entity (9), receipts
--   intake (6), the text fold (5), the parts and labor taxonomy (4), timeline_events.organization_id (4).
--
-- SCHEMA_LAW (lofficiel-concierge/supabase/SCHEMA_LAW.md), the seven questions:
--   1 search: above; no fit. 2 not a fact class about a vehicle: registry definitions, not observations. 3 rows carry
--   source and registered_at/by (the vein_ledger grammar); vocabularies are CHECKed and listed in the column comments.
--   4 coverage is computed by a function and a view, never stored; stacks and needs are append-only. 5 invariants are
--   constraints and triggers with a contract test. 6 the writer is supabase/migrations (pipeline_registry rows below); the
--   readers are v_stacks and the pulse through stack_coverage(). 7 this file; RLS is enabled on the three tables with no
--   policy, so only roles that bypass RLS read them; service_role gets SELECT, anon and authenticated nothing.
--   The proposal_type vocabulary gains add_table (a new table; the payload names its grain, keys, columns, writer, readers
--   and access), and the change is recorded as one approved schema_proposals row.
--
-- ACCESS. Like v_residual and v_schema_atlas: service_role SELECT on the tables and the view and EXECUTE on the function;
--   anon and authenticated have nothing. stack_coverage is SECURITY DEFINER so its catalog, statistics and clock reads do
--   not depend on the caller's grants; it runs one statement per intake object (SELECT max(column) FROM public.table, names
--   quoted) and nothing else dynamic.
--
-- CONTRACT TEST: supabase/sql/test_stack_registry.sql (PostgreSQL 17 in CI, job metric-fold-health-contract).
--
-- LIMITS. est_rows and null_frac are planner statistics: they lag until ANALYZE. A column's fill is over the whole table
--   unless a denominator is named. A present need is a structural reading, not semantic completeness. Coverage does not
--   weight needs. A stack need reads one level down. The 0.9 fill threshold and the per-need freshness windows are
--   choices stated here, not measurements.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

-- 1. Proposal vocabulary and the proposal row ---------------------------------------------------------------------------
-- Refuse a drifted CHECK rather than overwrite a value someone else added (read from prod 2026-10-07 00:40Z).
DO $guard$
BEGIN
  IF (SELECT pg_get_constraintdef(c.oid) FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = 'public.schema_proposals'::regclass AND c.conname = 'schema_proposals_proposal_type_check')
     IS DISTINCT FROM
     'CHECK ((proposal_type = ANY (ARRAY[''add_property''::text, ''fork_property''::text, ''deprecate_property''::text, ''modify_property''::text, ''add_source''::text, ''modify_trust_tier''::text, ''add_observation_kind''::text, ''add_source_category''::text, ''add_image_attribute''::text, ''add_column''::text])))'
  THEN
    RAISE EXCEPTION 'schema_proposals_proposal_type_check differs from the 2026-10-07 read; re-read it before extending it';
  END IF;
END
$guard$;

ALTER TABLE public.schema_proposals
  DROP CONSTRAINT schema_proposals_proposal_type_check,
  ADD CONSTRAINT schema_proposals_proposal_type_check CHECK (proposal_type = ANY (ARRAY[
    'add_property', 'fork_property', 'deprecate_property', 'modify_property', 'add_source', 'modify_trust_tier',
    'add_observation_kind', 'add_source_category', 'add_image_attribute', 'add_column', 'add_table']));

INSERT INTO public.schema_proposals (
  proposed_by_agent_key, proposal_type, payload, evidence, estimated_scope, backward_compatibility,
  status, resolved_at, decision_rationale)
VALUES (
  'claude-opus-5-5-stack-registry',
  'add_table',
  jsonb_build_object(
    'tables', jsonb_build_array(
      jsonb_build_object('table', 'stacks', 'grain', 'one version of one stack',
        'key', 'stack_id, version; unique name, version',
        'references', jsonb_build_array('vein_ledger (thesis_vein_id, thesis_vein_version)', 'stacks (stack_id, supersedes_version)'),
        'columns', jsonb_build_array('stack_id', 'version', 'name', 'question', 'family', 'path', 'external_dimensions',
          'who_cares', 'scoring', 'status', 'thesis_vein_id', 'thesis_vein_version', 'source', 'supersedes_version',
          'registered_at', 'registered_by'),
        'append_only', true),
      jsonb_build_object('table', 'stack_needs', 'grain', 'one layer and object needed by one stack version',
        'key', 'stack_id, version, layer, object',
        'references', jsonb_build_array('stacks (stack_id, version)', 'stack_substrates (substrate) for abstract needs'),
        'columns', jsonb_build_array('stack_id', 'version', 'layer', 'kind', 'object', 'denominator', 'fresh_within',
          'note', 'substrate'),
        'append_only', true),
      jsonb_build_object('table', 'stack_substrates', 'grain', 'one abstract layer that stacks name',
        'key', 'substrate',
        'columns', jsonb_build_array('substrate', 'declared_table', 'declared_at', 'declared_by', 'note', 'source',
          'registered_at', 'registered_by'),
        'append_only', false)),
    'function', 'stack_coverage(p_stack_id text DEFAULT NULL): coverage and per-need verdicts for the latest version of each stack',
    'view', 'v_stacks: one row per stack, its latest version, with coverage and the objects of its missing and partial needs',
    'design', 'A child of the vein family: a stack''s scored thesis is a vein_ledger row; pass rules stay in vein_ledger. vein_ledger is unchanged.',
    'why', 'Case ledger 13.2, How we get there item 1: the registry as data, seeded with the 64 stacks, with a coverage function from the atlas and pipeline_registry refreshed by the pulse.',
    'writers', jsonb_build_array('supabase/migrations'),
    'readers', jsonb_build_array('v_stacks', 'stack_coverage() called hourly by the pulse'),
    'access', 'RLS enabled with no policy; service_role SELECT on tables and view, EXECUTE on the function; anon and authenticated none.',
    'migration', '20261007014500_stack_registry.sql'),
  jsonb_build_array(
    jsonb_build_object('measure', 'vein_ledger rows', 'value', 11, 'at', '2026-10-07T00:35Z'),
    jsonb_build_object('measure', 'vein_runs rows', 'value', 15, 'at', '2026-10-07T00:35Z'),
    jsonb_build_object('measure', 'stacks in the case ledger with a stated thesis', 'value', 2, 'denominator', 64, 'at', '2026-10-07T00:30Z'),
    jsonb_build_object('measure', 'candidate tables and views searched by name', 'value', 77, 'at', '2026-10-07T00:40Z'),
    jsonb_build_object('measure', 'candidates holding a path with typed needs', 'value', 0, 'denominator', 77, 'at', '2026-10-07T00:40Z'),
    jsonb_build_object('measure', 'v_schema_atlas full read, ms', 'value', 526, 'at', '2026-10-07T00:45Z')),
  jsonb_build_object('tables', 3, 'stacks', 64, 'needs', 151, 'substrates', 47, 'rows_changed_elsewhere', 0),
  jsonb_build_object('additive', true, 'existing_tables_changed', jsonb_build_array('schema_proposals: proposal_type CHECK gains add_table'),
    'vein_ledger_changed', false, 'existing_writers_changed', false, 'existing_readers_changed', false),
  'approved',
  now(),
  'Approved for build by the owner through the lead session (skylar-64) on 2026-10-07 under case ledger 13.2, How we get there item 1. The building agent wrote this row; the owner did not sign it. Supersede or reject it to retire the tables.');

-- 2. The tables -------------------------------------------------------------------------------------------------------
CREATE TABLE public.stack_substrates (
  substrate      text        PRIMARY KEY CHECK (btrim(substrate) <> '' AND substrate = btrim(substrate)),
  declared_table text        CHECK (declared_table ~ '^[a-z_][a-z0-9_]*$'),
  declared_at    timestamptz,
  declared_by    text,
  note           text,
  source         text        NOT NULL,
  registered_at  timestamptz NOT NULL DEFAULT now(),
  registered_by  text        NOT NULL,
  CONSTRAINT stack_substrates_declaration_complete
    CHECK ((declared_table IS NULL) = (declared_at IS NULL) AND (declared_table IS NULL) = (declared_by IS NULL))
);

CREATE TABLE public.stacks (
  stack_id            text        NOT NULL CHECK (stack_id ~ '^S[0-9A-Z]+$'),
  version             integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  name                text        NOT NULL CHECK (btrim(name) <> ''),
  question            text        NOT NULL CHECK (btrim(question) <> ''),
  family              text,
  path                text[],
  external_dimensions text[],
  who_cares           text,
  scoring             text,
  status              text        NOT NULL DEFAULT 'proposed'
                                  CHECK (status IN ('proposed', 'measured', 'building', 'showable', 'live', 'retired')),
  thesis_vein_id      text,
  thesis_vein_version integer,
  source              text        NOT NULL,
  supersedes_version  integer,
  registered_at       timestamptz NOT NULL DEFAULT now(),
  registered_by       text        NOT NULL,
  PRIMARY KEY (stack_id, version),
  CONSTRAINT stacks_name_version_key UNIQUE (name, version),
  CONSTRAINT stacks_thesis_vein_fkey FOREIGN KEY (thesis_vein_id, thesis_vein_version)
    REFERENCES public.vein_ledger (vein_id, version),
  CONSTRAINT stacks_thesis_complete CHECK ((thesis_vein_id IS NULL) = (thesis_vein_version IS NULL)),
  CONSTRAINT stacks_supersedes_earlier CHECK (supersedes_version IS NULL OR supersedes_version < version),
  CONSTRAINT stacks_supersedes_fkey FOREIGN KEY (stack_id, supersedes_version) REFERENCES public.stacks (stack_id, version)
);

CREATE TABLE public.stack_needs (
  stack_id     text     NOT NULL,
  version      integer  NOT NULL,
  layer        text     NOT NULL CHECK (layer IN ('log', 'key', 'dimension', 'fold', 'baseline', 'residual', 'feature',
                                                  'prediction', 'outcome')),
  kind         text     NOT NULL CHECK (kind IN ('table', 'column', 'function', 'intake', 'stack', 'abstract')),
  object       text     NOT NULL,
  denominator  text,
  fresh_within interval,
  note         text,
  substrate    text     GENERATED ALWAYS AS (CASE WHEN kind = 'abstract' THEN object END) STORED,
  PRIMARY KEY (stack_id, version, layer, object),
  CONSTRAINT stack_needs_stack_fkey FOREIGN KEY (stack_id, version) REFERENCES public.stacks (stack_id, version),
  CONSTRAINT stack_needs_substrate_fkey FOREIGN KEY (substrate) REFERENCES public.stack_substrates (substrate),
  CONSTRAINT stack_needs_object_form CHECK (CASE kind
    WHEN 'table'    THEN object ~ '^[a-z_][a-z0-9_]*$'
    WHEN 'function' THEN object ~ '^[a-z_][a-z0-9_]*$'
    WHEN 'column'   THEN object ~ '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$'
    WHEN 'intake'   THEN object ~ '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$'
    WHEN 'stack'    THEN object ~ '^S[0-9A-Z]+$' AND object <> stack_id
    ELSE btrim(object) <> '' AND object = btrim(object) END),
  CONSTRAINT stack_needs_denominator_same_table CHECK (denominator IS NULL OR (kind = 'column'
    AND denominator ~ '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$'
    AND split_part(denominator, '.', 1) = split_part(object, '.', 1) AND denominator <> object)),
  CONSTRAINT stack_needs_window_for_intake CHECK ((kind = 'intake') = (fresh_within IS NOT NULL)
    AND (fresh_within IS NULL OR fresh_within > interval '0'))
);
CREATE INDEX stack_needs_substrate_idx ON public.stack_needs (substrate) WHERE substrate IS NOT NULL;

DROP TRIGGER IF EXISTS stacks_append_only ON public.stacks;
CREATE TRIGGER stacks_append_only BEFORE UPDATE OR DELETE ON public.stacks
  FOR EACH ROW EXECUTE FUNCTION public.vein_append_only();
DROP TRIGGER IF EXISTS stack_needs_append_only ON public.stack_needs;
CREATE TRIGGER stack_needs_append_only BEFORE UPDATE OR DELETE ON public.stack_needs
  FOR EACH ROW EXECUTE FUNCTION public.vein_append_only();

ALTER TABLE public.stack_substrates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stack_needs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stack_substrates, public.stacks, public.stack_needs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.stack_substrates, public.stacks, public.stack_needs TO service_role;

COMMENT ON TABLE public.stacks IS
  'Stack registry (case ledger 13.1, 13.2): one row per version of one stack, a named path through the nine layers (log, key, dimension, fold, baseline, residual, feature, prediction, outcome) that answers one question. Grain: stack_id + version. Append-only (vein_append_only): a change of definition or status is a new version with supersedes_version, and readers cite (stack_id, version). Its needs are rows of stack_needs; its coverage is computed by stack_coverage() and read through v_stacks, never stored. A stack''s scored thesis is a vein_ledger row (thesis_vein_id, thesis_vein_version), so pass rules live only in vein_ledger. Writer: supabase/migrations. RLS on with no policy: service_role reads; anon and authenticated have no access.';
COMMENT ON COLUMN public.stacks.stack_id IS 'Stable id of the stack, S followed by digits or capitals. S01-S60 are the case ledger''s numbers 1-60 (§13 rows 1-20, 13.2 items 21-60); SA-SD are 13.2 stacks A-D. Grain key with version.';
COMMENT ON COLUMN public.stacks.version IS 'Version of the stack definition, from 1. A changed name, question, path, need list or status is a new version. Readers take the highest version per stack_id.';
COMMENT ON COLUMN public.stacks.name IS 'The stack''s name as the case ledger gives it. Natural key with version (unique name, version).';
COMMENT ON COLUMN public.stacks.question IS 'The question the stack answers, in one sentence: a short restatement of the name and chain, not the owner''s words (the case ledger keeps those).';
COMMENT ON COLUMN public.stacks.family IS 'The group the case ledger lists the stack under (13.2: market microstructure, physics of the asset, information and attention, geography, logistics, tax, people and reputation, economics and finance, counterfactuals, the machine''s economics). NULL when the ledger groups it under none (§13 rows 1-20, stacks A-D).';
COMMENT ON COLUMN public.stacks.path IS 'The chain of derived tables in order, one step per element, as the case ledger states it (§13 chain column; 13.2 layer lines for A-D, prefixed with the layer). NULL when the ledger gives no chain (13.2 items 21-60).';
COMMENT ON COLUMN public.stacks.external_dimensions IS 'Dimensions that come from outside the platform (climate, Census population and income, interest rates, licensed guides). NULL when the ledger names none.';
COMMENT ON COLUMN public.stacks.who_cares IS 'Who acts on the stack''s answer. NULL = not stated; the case ledger states it for no seeded stack.';
COMMENT ON COLUMN public.stacks.scoring IS 'How the stack''s output is graded against outcomes, in one sentence. The rule that counts is the thesis vein''s pass_rule. NULL when the ledger states none (set for A-D).';
COMMENT ON COLUMN public.stacks.status IS 'Lifecycle: proposed (registered, not reviewed), measured (needs written and measured by stack_coverage), building (layers under construction), showable (renderable as a page with its coverage), live (page live), retired. A change is a new version. Vocabulary fixed by CHECK.';
COMMENT ON COLUMN public.stacks.thesis_vein_id IS 'vein_ledger.vein_id of the stack''s pre-registered thesis (its prediction with a pass rule). NULL until one is registered. With thesis_vein_version, a foreign key to vein_ledger.';
COMMENT ON COLUMN public.stacks.thesis_vein_version IS 'vein_ledger.version of the thesis. NULL exactly when thesis_vein_id is NULL.';
COMMENT ON COLUMN public.stacks.source IS 'Where the definition comes from (e.g. data-machine-cases.md §13 2026-10-06/07, a generator run, a review).';
COMMENT ON COLUMN public.stacks.supersedes_version IS 'The earlier version of this stack_id this row replaces; NULL on version 1. A foreign key to (stack_id, version).';
COMMENT ON COLUMN public.stacks.registered_at IS 'Ingest time: when this version was registered (timestamptz).';
COMMENT ON COLUMN public.stacks.registered_by IS 'Who registered this version (agent session, generator, owner).';

COMMENT ON TABLE public.stack_needs IS
  'What one version of a stack needs, as rows: one row per layer and object. kind says how stack_coverage() measures the object: table (v_schema_atlas), column (pg_attribute, pg_stats, pg_constraint), function (pg_proc), intake (newest value of a clock column), stack (another stack''s coverage) or abstract (a stack_substrates row, missing until a table is declared for it). Grain: stack_id + version + layer + object. Append-only (vein_append_only): a new stack version carries its full need list. Writer: supabase/migrations. RLS on with no policy: service_role reads.';
COMMENT ON COLUMN public.stack_needs.stack_id IS 'The stack. With version, a foreign key to stacks.';
COMMENT ON COLUMN public.stack_needs.version IS 'The stack version this need belongs to.';
COMMENT ON COLUMN public.stack_needs.layer IS 'The layer the need sits in: log, key, dimension, fold, baseline, residual, feature, prediction or outcome (case ledger 13.2 grammar). Vocabulary fixed by CHECK. At fold, baseline, residual, feature and prediction a table need is present only with an owner in pipeline_registry.';
COMMENT ON COLUMN public.stack_needs.kind IS 'How the object is measured: table, column, function, intake, stack or abstract. Vocabulary fixed by CHECK; the rules are in the stack_coverage comment.';
COMMENT ON COLUMN public.stack_needs.object IS 'What is needed. table and function: a name in schema public. column and intake: table.column. stack: another stack_id (not this one). abstract: a stack_substrates.substrate. Lower-case identifiers; form fixed by CHECK. A column the house grammar would name but that does not exist yet (ownership_transfers.auction_event_id) resolves missing until it is added.';
COMMENT ON COLUMN public.stack_needs.denominator IS 'column needs only: a column of the same table whose filled rows are the universe, so fill = filled share of object / filled share of denominator (a key over the rows that carry the text it keys). NULL = the whole table.';
COMMENT ON COLUMN public.stack_needs.fresh_within IS 'intake needs only (required for them): the window inside which the newest clock value must fall for the need to be present, e.g. 2 days for bid frames, 14 days for receipts. A choice per need, stated in the seed.';
COMMENT ON COLUMN public.stack_needs.note IS 'Why the stack needs it, in a few words, with the dated case-ledger fact when there is one.';
COMMENT ON COLUMN public.stack_needs.substrate IS 'Generated: object when kind is abstract, else NULL. A foreign key to stack_substrates, so every abstract need names a registered substrate.';

COMMENT ON TABLE public.stack_substrates IS
  'The allowlist of abstract layers that stacks name (a place entity, the text fold, a parts taxonomy): one row per substrate, with the table declared to implement it. Grain: one substrate. An abstract need is missing until declared_table is set; then stack_coverage() measures it as that table for every stack that names it, with no new stack version (case ledger 13.1 point 4: sources are pluggable). Declarations are made by migrations through SCHEMA_LAW; rows are updated, not versioned, like pipeline_registry. RLS on with no policy: service_role reads.';
COMMENT ON COLUMN public.stack_substrates.substrate IS 'Name of the abstract layer, lower case except proper names (Census, VIN, BaT). Primary key; stack_needs.substrate references it.';
COMMENT ON COLUMN public.stack_substrates.declared_table IS 'The table in schema public declared to implement the substrate. NULL = none declared, and every need on it is missing.';
COMMENT ON COLUMN public.stack_substrates.declared_at IS 'When the table was declared (timestamptz). NULL exactly when declared_table is NULL.';
COMMENT ON COLUMN public.stack_substrates.declared_by IS 'Who declared it (migration, agent session). NULL exactly when declared_table is NULL.';
COMMENT ON COLUMN public.stack_substrates.note IS 'What the substrate is, where the case ledger names it, and live candidate tables that are not declared.';
COMMENT ON COLUMN public.stack_substrates.source IS 'Where the substrate was named (e.g. data-machine-cases.md §13 2026-10-06/07).';
COMMENT ON COLUMN public.stack_substrates.registered_at IS 'Ingest time: when the row was registered (timestamptz).';
COMMENT ON COLUMN public.stack_substrates.registered_by IS 'Who registered the row.';

-- 3. The coverage function --------------------------------------------------------------------------------------------
CREATE FUNCTION public.stack_coverage(p_stack_id text DEFAULT NULL)
RETURNS TABLE (
  stack_id    text,
  version     integer,
  coverage    numeric,
  n_needs     integer,
  n_present   integer,
  n_partial   integer,
  n_missing   integer,
  needs       jsonb,
  measured_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_clock   jsonb := '{}'::jsonb;
  r         record;
  v_rel     regclass;
  v_tbl     text;
  v_col     text;
  v_att     smallint;
  v_typ     regtype;
  v_rows    real;
  v_indexed boolean;
  v_newest  timestamptz;
  v_state   text;
BEGIN
  -- Intake clocks: the newest value of each intake object's clock column, read once per object. Only with an index that
  -- leads with the column, or on a table of at most 1,000,000 rows by the planner estimate, so a call stays bounded.
  FOR r IN
    SELECT DISTINCT n.object
    FROM public.stack_needs n
    JOIN (SELECT DISTINCT ON (s.stack_id) s.stack_id AS sid, s.version AS ver
          FROM public.stacks s
          ORDER BY s.stack_id, s.version DESC) c
      ON c.sid = n.stack_id AND c.ver = n.version
    WHERE n.kind = 'intake'
  LOOP
    v_tbl := split_part(r.object, '.', 1);
    v_col := split_part(r.object, '.', 2);
    v_rel := to_regclass('public.' || quote_ident(v_tbl));
    v_att := NULL; v_typ := NULL; v_rows := NULL; v_indexed := NULL; v_newest := NULL;
    IF v_rel IS NOT NULL THEN
      SELECT a.attnum, a.atttypid::regtype INTO v_att, v_typ
      FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = v_rel AND a.attname = v_col AND a.attnum > 0 AND NOT a.attisdropped;
    END IF;
    IF v_att IS NULL THEN
      v_state := 'absent';
    ELSIF v_typ NOT IN ('timestamp with time zone'::regtype, 'timestamp without time zone'::regtype, 'date'::regtype) THEN
      v_state := 'not_a_clock';
    ELSE
      SELECT c.reltuples INTO v_rows FROM pg_catalog.pg_class c WHERE c.oid = v_rel;
      SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_index i
                     WHERE i.indrelid = v_rel AND i.indkey[0] = v_att AND i.indpred IS NULL AND i.indisvalid)
        INTO v_indexed;
      IF v_indexed OR coalesce(v_rows, 0) <= 1000000 THEN
        BEGIN
          EXECUTE format('SELECT max(%I)::timestamptz FROM public.%I', v_col, v_tbl) INTO v_newest;
          v_state := CASE WHEN v_newest IS NULL THEN 'empty' ELSE 'read' END;
        EXCEPTION WHEN insufficient_privilege OR lock_not_available THEN
          v_state := 'unreadable';
        END;
      ELSE
        v_state := 'unindexed';
      END IF;
    END IF;
    v_clock := v_clock || jsonb_build_object(r.object, jsonb_build_object(
      'state', v_state, 'newest', v_newest, 'est_rows', v_rows, 'indexed', v_indexed));
  END LOOP;

  RETURN QUERY
  -- stack_coverage body begin
  WITH cur AS (
    SELECT DISTINCT ON (s.stack_id) s.stack_id AS sid, s.version AS ver
    FROM public.stacks s
    ORDER BY s.stack_id, s.version DESC
  ), nd AS (
    SELECT n.stack_id AS sid, n.version AS ver, n.layer, n.kind, n.object, n.denominator, n.fresh_within, n.note,
           split_part(n.object, '.', 1) AS rel_name, split_part(n.object, '.', 2) AS col_name
    FROM public.stack_needs n
    JOIN cur c ON c.sid = n.stack_id AND c.ver = n.version
  ), atlas AS MATERIALIZED (
    SELECT a.table_name::text AS table_name, a.est_rows, a.activity, a.registry_fields, a.registry_owners
    FROM public.v_schema_atlas a
  ), tbl AS (
    SELECT nd.sid, nd.ver, nd.layer, nd.kind, nd.object, nd.note,
           CASE WHEN nd.kind = 'abstract' THEN g.declared_table ELSE nd.object END AS target
    FROM nd
    LEFT JOIN public.stack_substrates g ON nd.kind = 'abstract' AND g.substrate = nd.object
    WHERE nd.kind IN ('table', 'abstract')
  ), tbl_v AS (
    SELECT t.sid, t.ver, t.layer, t.kind, t.object, t.note,
           CASE
             WHEN t.target IS NULL OR a.table_name IS NULL THEN 'missing'
             WHEN coalesce(a.est_rows, 0) <= 0 THEN 'partial'
             WHEN t.layer IN ('fold', 'baseline', 'residual', 'feature', 'prediction')
                  AND coalesce(a.registry_fields, 0) = 0 THEN 'partial'
             ELSE 'present'
           END AS verdict,
           jsonb_strip_nulls(jsonb_build_object(
             'declared_table', CASE WHEN t.kind = 'abstract' THEN t.target END,
             'est_rows', a.est_rows,
             'activity', a.activity,
             'owners', a.registry_owners,
             'reason', CASE
               WHEN t.target IS NULL THEN 'no table declared for this substrate'
               WHEN a.table_name IS NULL THEN 'no such table'
               WHEN coalesce(a.est_rows, 0) <= 0 THEN 'no rows by the planner estimate'
               WHEN t.layer IN ('fold', 'baseline', 'residual', 'feature', 'prediction')
                    AND coalesce(a.registry_fields, 0) = 0 THEN 'no owner declared in pipeline_registry'
             END)) AS evidence
    FROM tbl t
    LEFT JOIN atlas a ON a.table_name = t.target
  ), col AS (
    SELECT nd.sid, nd.ver, nd.layer, nd.kind, nd.object, nd.note, nd.denominator, nd.rel_name, nd.col_name,
           to_regclass('public.' || quote_ident(nd.rel_name)) AS rel
    FROM nd
    WHERE nd.kind = 'column'
  ), col_m AS (
    SELECT c.*, att.attnum,
           (SELECT st.null_frac FROM pg_catalog.pg_stats st
             WHERE st.schemaname = 'public' AND st.tablename = c.rel_name AND st.attname = c.col_name
             ORDER BY st.inherited DESC LIMIT 1) AS nf,
           (SELECT st.null_frac FROM pg_catalog.pg_stats st
             WHERE st.schemaname = 'public' AND st.tablename = c.rel_name
               AND st.attname = split_part(c.denominator, '.', 2)
             ORDER BY st.inherited DESC LIMIT 1) AS nf_den,
           EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                    WHERE k.conrelid = c.rel AND k.contype = 'f' AND att.attnum = ANY (k.conkey)) AS has_fk,
           (SELECT greatest(u.last_analyze, u.last_autoanalyze) FROM pg_catalog.pg_stat_all_tables u
             WHERE u.relid = c.rel) AS analyzed_at
    FROM col c
    LEFT JOIN pg_catalog.pg_attribute att
      ON att.attrelid = c.rel AND att.attname = c.col_name AND att.attnum > 0 AND NOT att.attisdropped
  ), col_f AS (
    SELECT m.*,
           CASE
             WHEN m.attnum IS NULL OR m.nf IS NULL THEN NULL
             WHEN m.denominator IS NULL THEN round((1 - m.nf)::numeric, 4)
             WHEN m.nf_den IS NULL OR m.nf_den >= 1 THEN NULL
             ELSE round(least(1, (1 - m.nf)::numeric / (1 - m.nf_den)::numeric), 4)
           END AS fill
    FROM col_m m
  ), col_v AS (
    SELECT f.sid, f.ver, f.layer, f.kind, f.object, f.note,
           CASE
             WHEN f.attnum IS NULL THEN 'missing'
             WHEN f.fill IS NULL OR f.fill < 0.9 THEN 'partial'
             WHEN f.layer = 'key' AND NOT f.has_fk THEN 'partial'
             ELSE 'present'
           END,
           jsonb_strip_nulls(jsonb_build_object(
             'fill', f.fill,
             'denominator', f.denominator,
             'foreign_key', CASE WHEN f.attnum IS NOT NULL THEN f.has_fk END,
             'stats_at', f.analyzed_at,
             'reason', CASE
               WHEN f.rel IS NULL THEN 'no such table'
               WHEN f.attnum IS NULL THEN 'no such column'
               WHEN f.nf IS NULL THEN 'no planner statistics for the column'
               WHEN f.fill IS NULL THEN 'no planner statistics for the denominator, or it is never filled'
               WHEN f.fill < 0.9 THEN 'filled below 0.9'
               WHEN f.layer = 'key' AND NOT f.has_fk THEN 'a key column with no foreign key'
             END))
    FROM col_f f
  ), fn_v AS (
    SELECT nd.sid, nd.ver, nd.layer, nd.kind, nd.object, nd.note,
           CASE WHEN p.n > 0 THEN 'present' ELSE 'missing' END,
           jsonb_strip_nulls(jsonb_build_object(
             'overloads', p.n,
             'reason', CASE WHEN p.n = 0 THEN 'no such function' END))
    FROM nd
    CROSS JOIN LATERAL (SELECT count(*)::int AS n FROM pg_catalog.pg_proc pr
                        WHERE pr.pronamespace = 'public'::regnamespace AND pr.proname = nd.object) p
    WHERE nd.kind = 'function'
  ), in_v AS (
    SELECT nd.sid, nd.ver, nd.layer, nd.kind, nd.object, nd.note,
           CASE
             WHEN x.ck ->> 'state' = 'read' AND (x.ck ->> 'newest')::timestamptz >= now() - nd.fresh_within THEN 'present'
             WHEN x.ck ->> 'state' IN ('read', 'empty', 'unindexed', 'unreadable') THEN 'partial'
             ELSE 'missing'
           END,
           jsonb_strip_nulls(jsonb_build_object(
             'newest', x.ck -> 'newest',
             'fresh_within', nd.fresh_within::text,
             'est_rows', x.ck -> 'est_rows',
             'indexed', x.ck -> 'indexed',
             'reason', CASE x.ck ->> 'state'
               WHEN 'read' THEN CASE WHEN (x.ck ->> 'newest')::timestamptz < now() - nd.fresh_within
                                     THEN 'newest row is older than the window' END
               WHEN 'empty' THEN 'no rows'
               WHEN 'absent' THEN 'no such table or column'
               WHEN 'not_a_clock' THEN 'the column is not a timestamp or date'
               WHEN 'unindexed' THEN 'not measured: no index leads with the clock and the table holds over 1,000,000 rows'
               WHEN 'unreadable' THEN 'not measured: the table could not be read'
               ELSE 'not measured'
             END))
    FROM nd
    CROSS JOIN LATERAL (SELECT v_clock -> nd.object AS ck) x
    WHERE nd.kind = 'intake'
  ), leaf AS (
    SELECT * FROM tbl_v
    UNION ALL SELECT * FROM col_v
    UNION ALL SELECT * FROM fn_v
    UNION ALL SELECT * FROM in_v
  ), leaf_cov AS (
    SELECT l.sid, count(*)::int AS n, (count(*) FILTER (WHERE l.verdict = 'present'))::int AS p
    FROM leaf l
    GROUP BY l.sid
  ), stk_v AS (
    SELECT nd.sid, nd.ver, nd.layer, nd.kind, nd.object, nd.note,
           CASE WHEN lc.sid IS NULL OR lc.p = 0 THEN 'missing' WHEN lc.p = lc.n THEN 'present' ELSE 'partial' END,
           jsonb_strip_nulls(jsonb_build_object(
             'coverage', CASE WHEN lc.n > 0 THEN round(lc.p::numeric / lc.n, 4) END,
             'needs', lc.n,
             'present', lc.p,
             'reason', CASE
               WHEN NOT EXISTS (SELECT 1 FROM cur c2 WHERE c2.sid = nd.object) THEN 'no such stack'
               WHEN lc.sid IS NULL THEN 'the stack has no needs other than stacks'
               WHEN lc.p = 0 THEN 'none of its needs is present'
             END))
    FROM nd
    LEFT JOIN leaf_cov lc ON lc.sid = nd.object
    WHERE nd.kind = 'stack'
  ), allv AS (
    SELECT * FROM leaf
    UNION ALL SELECT * FROM stk_v
  )
  SELECT c.sid,
         c.ver,
         CASE WHEN count(v.object) > 0
              THEN round((count(v.object) FILTER (WHERE v.verdict = 'present'))::numeric / count(v.object), 4) END,
         count(v.object)::int,
         (count(v.object) FILTER (WHERE v.verdict = 'present'))::int,
         (count(v.object) FILTER (WHERE v.verdict = 'partial'))::int,
         (count(v.object) FILTER (WHERE v.verdict = 'missing'))::int,
         coalesce(jsonb_agg(jsonb_build_object('layer', v.layer, 'kind', v.kind, 'object', v.object,
                                               'verdict', v.verdict, 'evidence', v.evidence, 'note', v.note)
                            ORDER BY array_position(ARRAY['log', 'key', 'dimension', 'fold', 'baseline', 'residual',
                                                          'feature', 'prediction', 'outcome'], v.layer), v.object COLLATE "C")
                  FILTER (WHERE v.object IS NOT NULL), '[]'::jsonb),
         now()
  FROM cur c
  LEFT JOIN allv v ON v.sid = c.sid AND v.ver = c.ver
  WHERE p_stack_id IS NULL OR c.sid = p_stack_id
  GROUP BY c.sid, c.ver
  ORDER BY c.sid;
  -- stack_coverage body end
END;
$fn$;

COMMENT ON FUNCTION public.stack_coverage(text) IS
  'How close each stack is today. For the latest version of each stack (or only p_stack_id when given): coverage = needs present / needs (numeric, 4 decimals; NULL when the stack has no needs), the counts present, partial and missing, needs = one jsonb object per need {layer, kind, object, verdict, evidence, note} in layer order, and measured_at = now(). Rules by kind: table, from v_schema_atlas: present when est_rows > 0 and, at fold, baseline, residual, feature and prediction, an owner in pipeline_registry; partial when it exists without rows or such an owner; missing when absent. column (table.column): fill = 1 - pg_stats.null_frac, divided by the denominator''s fill when one is named; present when fill >= 0.9 and, at the key layer, a foreign key on the column; partial when it exists with less, without statistics, or as a key with no foreign key; missing when absent. function: present when it exists in public. intake (table.clock_column): present when max(clock) is inside fresh_within; partial when older, empty or not measurable (no index leading with the clock on a table over 1,000,000 rows); missing when absent or not a timestamp or date. stack: present when all of that stack''s needs other than stacks are present, partial when some are, missing when none are or it does not exist. abstract: missing until stack_substrates.declared_table is set, then measured as a table. Sources: stacks, stack_needs, stack_substrates, v_schema_atlas (pipeline_registry owners), pg_attribute, pg_stats, pg_constraint, pg_stat_all_tables, pg_proc, and one max() per intake object. Statistics lag until ANALYZE; present is a structural reading, not semantic completeness. SECURITY DEFINER with a fixed search_path; EXECUTE for service_role only. About 1 s for every stack on prod (2026-10-07). Readers: v_stacks; the pulse, hourly.';

REVOKE ALL ON FUNCTION public.stack_coverage(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stack_coverage(text) TO service_role;

-- 4. The reader -------------------------------------------------------------------------------------------------------
CREATE VIEW public.v_stacks AS
SELECT s.stack_id,
       s.version,
       s.name,
       s.question,
       s.family,
       s.status,
       c.coverage,
       c.n_needs,
       c.n_present,
       c.n_partial,
       c.n_missing,
       ARRAY(SELECT e.value ->> 'object'
             FROM jsonb_array_elements(c.needs) WITH ORDINALITY AS e(value, ord)
             WHERE e.value ->> 'verdict' = 'missing'
             ORDER BY e.ord) AS needs_missing,
       ARRAY(SELECT e.value ->> 'object'
             FROM jsonb_array_elements(c.needs) WITH ORDINALITY AS e(value, ord)
             WHERE e.value ->> 'verdict' = 'partial'
             ORDER BY e.ord) AS needs_partial,
       s.thesis_vein_id,
       s.thesis_vein_version,
       s.source,
       s.registered_at,
       c.measured_at
FROM public.stack_coverage() c
JOIN public.stacks s ON s.stack_id = c.stack_id AND s.version = c.version;

COMMENT ON VIEW public.v_stacks IS
  'The stacks and how close each is today: one row per stack, its latest version, with the coverage of its needs computed now by stack_coverage() (one call per read, about 1 s on prod). Grain: one stack. Order and filter in the reader, e.g. ORDER BY coverage DESC NULLS LAST, stack_id. Coverage counts only present needs; partial needs are listed apart. A stack at coverage 1 has everything it sits on; whether it is built is its status. Readers: the app and the pulse (hourly). service_role only, like v_residual and v_schema_atlas.';
COMMENT ON COLUMN public.v_stacks.stack_id IS 'The stack (stacks.stack_id): S01-S60 are the case ledger''s numbers 1-60, SA-SD its stacks A-D.';
COMMENT ON COLUMN public.v_stacks.version IS 'The latest version of the stack, the one measured; cite (stack_id, version).';
COMMENT ON COLUMN public.v_stacks.name IS 'The stack''s name (stacks.name).';
COMMENT ON COLUMN public.v_stacks.question IS 'The question the stack answers (stacks.question).';
COMMENT ON COLUMN public.v_stacks.family IS 'The case-ledger group of the stack, or NULL (stacks.family).';
COMMENT ON COLUMN public.v_stacks.status IS 'Lifecycle of the version: proposed, measured, building, showable, live or retired (stacks.status).';
COMMENT ON COLUMN public.v_stacks.coverage IS 'Needs present / needs for this version, a fraction from 0 to 1 with 4 decimals; NULL when the stack has no needs. Computed at read time by stack_coverage(); rules in its comment.';
COMMENT ON COLUMN public.v_stacks.n_needs IS 'Number of needs of this version (stack_needs rows), in needs.';
COMMENT ON COLUMN public.v_stacks.n_present IS 'Needs resolved present now, in needs.';
COMMENT ON COLUMN public.v_stacks.n_partial IS 'Needs resolved partial now (the object exists but is thin, unkeyed, stale or unmeasured), in needs.';
COMMENT ON COLUMN public.v_stacks.n_missing IS 'Needs resolved missing now (no such object, or an abstract layer with no declared table), in needs.';
COMMENT ON COLUMN public.v_stacks.needs_missing IS 'The objects of the missing needs, in layer order (log to outcome), then by object name. The same object can block several stacks; group by it to rank the backlog.';
COMMENT ON COLUMN public.v_stacks.needs_partial IS 'The objects of the partial needs, in the same order. The verdict evidence (fill, newest clock, reason) is in stack_coverage(stack_id).needs.';
COMMENT ON COLUMN public.v_stacks.thesis_vein_id IS 'vein_ledger.vein_id of the stack''s registered thesis, or NULL.';
COMMENT ON COLUMN public.v_stacks.thesis_vein_version IS 'vein_ledger.version of the thesis, or NULL.';
COMMENT ON COLUMN public.v_stacks.source IS 'Where this version''s definition comes from (stacks.source).';
COMMENT ON COLUMN public.v_stacks.registered_at IS 'When this version was registered (stacks.registered_at; ingest time).';
COMMENT ON COLUMN public.v_stacks.measured_at IS 'When the coverage was computed: now() of the reading transaction (timestamptz). Store it with any snapshot of this view.';

REVOKE ALL ON public.v_stacks FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_stacks TO service_role;

-- 5. Owners -----------------------------------------------------------------------------------------------------------
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT x.table_name, NULL, 'supabase/migrations', x.description, false, x.write_via
FROM (VALUES
  ('stacks',
   'Stack registry: one row per version of one stack (case ledger 13.1, 13.2). Append-only; a change is a new version with supersedes_version.',
   'A migration file in supabase/migrations, applied by supabase-deploy CI: INSERT a new version (stack_id, version + 1, supersedes_version) with its full need list in stack_needs; UPDATE and DELETE raise (vein_append_only). New shapes go through schema_proposals per SCHEMA_LAW.'),
  ('stack_needs',
   'What one stack version needs, one row per layer and object, measured by stack_coverage(). Append-only.',
   'A migration file in supabase/migrations, in the same transaction as the stack version it belongs to; UPDATE and DELETE raise (vein_append_only).'),
  ('stack_substrates',
   'Allowlist of abstract layers named by stacks, with the table declared to implement each (NULL = none).',
   'A migration file in supabase/migrations: INSERT a new substrate, or set declared_table, declared_at and declared_by in the migration that creates or adopts the implementing table.')
) AS x(table_name, description, write_via)
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry p WHERE p.table_name = x.table_name AND p.column_name IS NULL);

-- 6. The seed ---------------------------------------------------------------------------------------------------------
-- seed:substrates:begin
INSERT INTO public.stack_substrates (substrate, note, source, registered_by)
SELECT v.substrate, v.note, 'data-machine-cases.md §13 2026-10-06/07', 'claude-code (Opus 5.5), stack-registry lane, for the owner through lead session skylar-64'
FROM (VALUES
  ('place entity', 'A place keyed from lots, sellers, buyers and dated locations (case ledger §13: unblocks 1, 11, 13, 16). Live candidates, not declared: us_county_boundaries (county FIPS), zip_to_fips, geocoding_cache; vehicle_location_observations.county_fips is text.'),
  ('text fold', 'Comments and descriptions folded into attributed claims (case ledger §13: unblocks 4, 5, 19; the analysis queue was stuck on 2026-10-06).'),
  ('comment stance dimension', 'Stance per comment (bid, reservation, refusal, question), produced by the text fold (case ledger 13.2, stack A).'),
  ('comment sentiment per lot', 'Comment sentiment folded per lot. sentiment_update_queue fills with no reader (case ledger, 2026-10-06); vehicle_sentiment is per vehicle, not per lot.'),
  ('relist chains', 'One vehicle''s successive listings linked through the lot entity (case ledger §13 row 4, 13.2 item 34).'),
  ('image zone dimension', 'Vehicle zones as a dimension keyed from image appearances (case ledger §13 row 6). Live candidates, not declared: angle_spectrum_zones, angle_taxonomy.'),
  ('vision gate condition claims', 'Per-zone condition claims produced by the vision gate (case ledger §13 row 6).'),
  ('parts and labor taxonomy', 'Parts and labor as a keyed taxonomy for receipts and work (case ledger §13 rows 7, 15; 13.2 items 31, 55, stack B). catalog_parts is the parts catalog; no labor taxonomy is declared.'),
  ('failure-mode dimension', 'Model failure modes by age and mileage, from recalls, forums and receipts (case ledger §13 row 7, 13.2 stack B).'),
  ('odometer observation kind', 'Mileage as one observation kind with a clock on every source (case ledger §13 row 8). vehicle_observations listed no mileage kind among its common kinds on 2026-10-07.'),
  ('account age from profile reads', 'Account age per identity, read from platform profiles (case ledger §13 row 9).'),
  ('identity location', 'A location per identity, inferred from comments, shipping and purchases; 328 identities carried a city on 2026-10-06 (case ledger §13 row 11, 13.2 item 40).'),
  ('option keys', 'Options (RPO codes, build sheets) as a keyed dimension (case ledger §13 rows 12, 14; 13.2 item 30). Live candidates, not declared: gm_rpo_library, rpo_code_definitions.'),
  ('demand signals keyed to episodes', 'Bids, watchers and app searches keyed to the listing episode (case ledger §13 row 13).'),
  ('cost-of-operating dimension', 'Shop and storage cost per county (case ledger §13 row 13).'),
  ('non-BaT intake', 'Intake from sources other than BaT; 102 of 126 jobs were paused on 2026-10-06 (case ledger §13 row 13).'),
  ('modifications dimension', 'Modifications to a vehicle as a dimension (case ledger §13 row 15, 13.2 item 31).'),
  ('state-history dimension', 'The states a vehicle has lived in over time, from dated locations (case ledger §13 row 16, 13.2 items 27, 44).'),
  ('organization keys re-pointed from archived tables', 'vehicles.selling_organization_id and vehicles.owner_shop_id reference tables archived 2026-01-29 (case ledger §13 row 17).'),
  ('dense dated sales', 'A sale clock on every sale, across venues (case ledger §13 row 18, 13.2 items 38, 51).'),
  ('market index series beyond BaT live bids', 'market_index_values series beyond the BaT live-bid index (case ledger §13 row 18).'),
  ('claims table', 'A table of attributed claims, a shape decision (case ledger §13 row 19, 13.2 item 60). field_evidence holds per-field evidence.'),
  ('job-health snapshots', 'v_job_health readings kept over time (case ledger §13 row 20).'),
  ('residual snapshots', 'v_residual readings kept over time (case ledger §13 row 20).'),
  ('reader-dependency graph', 'Which readers and features depend on which tables (case ledger §13 row 20).'),
  ('extension chains from bid frames', 'Soft-close extension chains folded from bid frames (case ledger 13.2 item 22; veins V010 and V011 measured them on samples).'),
  ('outcome clocks', 'When each lot''s outcome became known (case ledger 13.2 item 23).'),
  ('watcher counts as a time series', 'Watchers per lot over time; auction_events.watchers holds one reading per lot (case ledger 13.2 item 24).'),
  ('platform entity', 'Venues as an entity keyed from lots and listings (case ledger 13.2 items 25, 46, stack C). Live candidates, not declared: source_registry, live_auction_sources.'),
  ('auction sale entity', 'The auction a lot was catalogued in, so lots can be ordered within it (case ledger 13.2 item 26).'),
  ('climate dimension', 'Climate per place (case ledger 13.2 item 27, stacks B and D).'),
  ('production dimension', 'Production counts per configuration (case ledger 13.2 item 29). Live candidates, not declared: vehicle_production_data, survival_rate_estimates.'),
  ('cross-platform vehicle identity', 'One physical vehicle across platforms, short chassis numbers and VIN variants included (case ledger §13 row 2, 13.2 item 29).'),
  ('cross-platform person identity', 'One person or dealer across platform handles (case ledger 13.2 item 46).'),
  ('VIN build sequence', 'Build sequence decoded from the VIN (case ledger 13.2 item 30).'),
  ('title observations with clocks', 'Title and brand observations, each with its clock (case ledger 13.2 item 33, stack D).'),
  ('image fold', 'EXIF truth, angle and zone, and per-zone condition claims from images (case ledger §13, 13.2 item 33).'),
  ('description observations per listing', 'Description text per listing over time (case ledger 13.2 item 35). listing_page_snapshots holds the fetched pages.'),
  ('odometer OCR', 'Mileage read from odometer photos (case ledger 13.2 item 39).'),
  ('jurisdiction dimension', 'Taxes, emissions and rules per jurisdiction (case ledger 13.2 item 41, stack B).'),
  ('Census dimension', 'Population and income per place (case ledger 13.2 item 43, stack D).'),
  ('long clocks', 'Work and ownership dated across years per vehicle (case ledger 13.2 item 50).'),
  ('macro series', 'Interest-rate and fuel-price series (case ledger 13.2 item 51).'),
  ('cost-of-carry dimension', 'The cost of holding a vehicle per period (case ledger 13.2 item 52).'),
  ('licensed guide dimension', 'Published price-guide values under licence (case ledger 13.2 item 53).'),
  ('the price model', 'A registered price model whose uncertainty can be priced (case ledger 13.2 item 59).'),
  ('outcome ledger', 'Realized outcomes joined back to predictions and claims (case ledger 13.2 item 60).')
) AS v(substrate, note)
ON CONFLICT (substrate) DO NOTHING;
-- seed:substrates:end
-- seed:stacks:begin
INSERT INTO public.stacks (stack_id, version, name, question, family, path, external_dimensions, who_cares, scoring,
                           status, thesis_vein_id, thesis_vein_version, source, registered_by)
SELECT v.stack_id, 1, v.name, v.question, v.family, v.path, v.external_dimensions, NULL, v.scoring,
       'measured', v.thesis_vein_id, v.thesis_vein_version, 'data-machine-cases.md §13 2026-10-06/07', 'claude-code (Opus 5.5), stack-registry lane, for the owner through lead session skylar-64'
FROM (VALUES
  ('S01', 'County performance surface per model', 'Per model, which counties sell above their cohort baseline, and how often and how fast do lots there sell?', NULL, ARRAY['lot rows', 'seller location', 'geocode', 'county FIPS', 'sale residual vs cohort baseline as of sale date', 'per county: median residual, sell-through, days-to-sale, confidence by count']::text[], NULL, NULL, NULL, NULL),
  ('S02', 'Flip ledger and arbitrage corridors', 'When one vehicle is bought and resold, across which platforms, places and seasons, with what hold time, spread and fees?', NULL, ARRAY['one physical vehicle across platforms and time (VIN or chassis chain, lot entity)', 'buy event, sell event, hold days, spread, fees', 'corridors by model and season (bought in county A on platform P, sold in county B on platform Q)']::text[], NULL, NULL, NULL, NULL),
  ('S03', 'Bidder record as of a date', 'As of a date, what is each bidder''s record, and how does who is bidding now change the chance that the reserve is met?', NULL, ARRAY['per identity: lots bid, win rate, max bid vs hammer, lateness relative to close, cohorts chased, counties bought from', 'live-lot feature: probability the reserve is met given who is bidding now']::text[], NULL, NULL, 'V012', 1),
  ('S04', 'Seller trust and its price', 'As of a date, how far can a seller be trusted, and what premium or discount does that trust realize?', NULL, ARRAY['seller identity', 'prior lots: sell-through, reserve-not-met rate, relist rate, post-sale disputes in comments', 'trust score as of date', 'realized premium or discount']::text[], NULL, NULL, NULL, NULL),
  ('S05', 'Crowd disclosure gap', 'What did the crowd flag on a lot that the seller did not state, and how much of the price residual does it explain?', NULL, ARRAY['comments', 'topic and stance per comment', 'per lot at close: what the crowd flagged that the seller did not state', 'price residual explanation; per seller: how often caught']::text[], NULL, NULL, NULL, NULL),
  ('S06', 'Cohort-relative condition from photos', 'Zone by zone, where does a vehicle''s photographed condition sit in its cohort, and what is each zone worth?', NULL, ARRAY['images', 'EXIF truth', 'angle and zone', 'per-zone condition claims', 'position on the cohort''s distribution', 'price effect per zone; effect of photo coverage itself']::text[], NULL, NULL, NULL, NULL),
  ('S07', 'Hidden-defect prior', 'Given its model''s failure modes and its own repair evidence, what is likely to fail on a vehicle, and which inspection is worth paying for?', NULL, ARRAY['model failure modes by age and mileage (dimension from recalls, forums, receipts) x the vehicle''s repair evidence', 'latent-failure probability', 'priced pre-purchase inspection list']::text[], NULL, NULL, NULL, NULL),
  ('S08', 'Odometer honesty', 'Do a vehicle''s mileage readings agree across sources and over time?', NULL, ARRAY['every mileage observation with observed_at across sources', 'monotonicity violations, rollovers, TMU statements', 'trust downgrade per observation and seller']::text[], NULL, NULL, NULL, NULL),
  ('S09', 'Shill and ring detection', 'Which lots carry bidding patterns that look coordinated, and how much should that discount their prices?', NULL, ARRAY['bidder graph (who bids against whom, increments, timing, repeat under-bidders on one seller''s lots, account age)', 'anomaly score per lot', 'integrity feature on every price']::text[], NULL, NULL, NULL, NULL),
  ('S10', 'Liquidity surface', 'Per cohort and county, how likely is a listing to sell within N days at a given price-to-estimate ratio?', NULL, ARRAY['per cohort and county: listings', 'outcomes', 'survival curve of days-to-sale by price-to-estimate ratio, platform, season', 'list at X to sell in N days with p%']::text[], NULL, NULL, NULL, NULL),
  ('S11', 'Buyer migration maps', 'Per cohort, where do winners live relative to sellers, and which platform reaches which region?', NULL, ARRAY['winners'' locations vs sellers'' locations per cohort', 'where the money for a model lives and how far it travels', 'which platform reaches which region']::text[], NULL, NULL, NULL, NULL),
  ('S12', 'Dimensions as evidence, not lists', 'Can a cohort be filtered by generation, body style, engine, paint and color family as keyed values with a denominator?', NULL, ARRAY['generation, body style, engine, paint code and color family from VIN decodes, text and images with sources', 'four keyed filters and a clock, with a denominator']::text[], NULL, NULL, NULL, NULL),
  ('S13', 'Where to set up shop', 'Which county best combines supply, demand, flip margin and buyer proximity against the cost of operating there?', NULL, ARRAY['supply density by cohort and county x demand (bids, watchers, app searches) x realized flip margin (2) x buyer proximity (11) x shop and storage cost', 'relocation score per county']::text[], ARRAY['shop and storage cost']::text[], NULL, NULL, NULL),
  ('S14', 'Option and color premiums', 'Per cohort and as of a date, what premium does each option and color carry, and with what confidence?', NULL, ARRAY['decoded options (RPO, build sheets) and normalized color', 'hedonic regression per cohort as of date', 'premium per option with confidence', 'what to spec on a build']::text[], NULL, NULL, NULL, NULL),
  ('S15', 'Build ROI', 'What has each build decision cost over time, against what the cohort pays for the result?', NULL, ARRAY['parts carts, receipts and labor sessions keyed to the vehicle and a parts taxonomy', 'cost basis over time vs the cohort surface and (14)', 'ROI per decision']::text[], NULL, NULL, NULL, NULL),
  ('S16', 'Provenance depth and exposure history', 'How long and complete is a vehicle''s chain of ownership, where has it lived, and what is that worth?', NULL, ARRAY['transfers, title and registration observations, auction history', 'chain length and gaps, collection provenance from text, state history', 'rust-belt exposure prior, provenance premium']::text[], NULL, NULL, NULL, NULL),
  ('S17', 'Shop and dealer performance', 'Which shops and dealers touch vehicles that hold their value afterwards?', NULL, ARRAY['organizations', 'vehicles they touched', 'outcomes afterwards (residual, later defect reports)', 'which restorations hold value, inventory turn, consignment realization']::text[], NULL, NULL, NULL, NULL),
  ('S18', 'Seasonality and macro per cohort', 'Per cohort, how do dated residuals move with season, the auction calendar and macro conditions?', NULL, ARRAY['dated residuals', 'seasonal decomposition, auction-calendar effects, rate and macro covariates', 'monthly forecast index per cohort']::text[], ARRAY['interest rates', 'macro covariates']::text[], NULL, NULL, NULL),
  ('S19', 'Claims ledger from text', 'Which claims were made about a vehicle, by whom, with what trust, and which were disputed?', NULL, ARRAY['every description and comment sentence', 'attributed claim with the author''s trust', 'per-vehicle fact table with two-layer confidence']::text[], NULL, NULL, NULL, NULL),
  ('S20', 'The machine''s own health as data', 'Which pipeline decays next, and which repair helps the most downstream readers and features?', NULL, ARRAY['every writer''s yield, fold freshness and key fill as time series', 'which pipeline rots next', 'repair ranked by downstream readers and features']::text[], NULL, NULL, NULL, NULL),
  ('S21', 'Bid hazard model', 'On a live lot, what is the chance of a next bid within each interval?', 'market microstructure', NULL, NULL, NULL, NULL, NULL),
  ('S22', 'Snipe cascades and rivalry pairs', 'How do late bids chain into extensions, and which bidder pairs keep meeting?', 'market microstructure', NULL, NULL, NULL, NULL, NULL),
  ('S23', 'Reserve inference', 'What reserve does a lot''s bidding and outcome imply?', 'market microstructure', NULL, NULL, NULL, NULL, NULL),
  ('S24', 'Demand nowcast with calibrated intervals', 'How much demand does a lot or cohort have right now, with intervals that hold their stated coverage?', 'market microstructure', NULL, NULL, NULL, NULL, NULL),
  ('S25', 'Attention saturation', 'When comparable lots close at once across venues, do bids and prices thin out?', 'market microstructure', NULL, NULL, NULL, NULL, NULL),
  ('S26', 'Catalogue position effects', 'Does a lot''s position in its auction''s catalogue move its price?', 'market microstructure', NULL, NULL, NULL, NULL, NULL),
  ('S27', 'Corrosion exposure prior', 'Given where a vehicle has lived and the climate there, how likely is corrosion, zone by zone?', 'physics of the asset', NULL, ARRAY['climate']::text[], NULL, NULL, NULL),
  ('S28', 'Use profile from odometer curves', 'How has a vehicle been used, from its mileage over time and its receipts?', 'physics of the asset', NULL, NULL, NULL, NULL, NULL),
  ('S29', 'Survival by production', 'Of each configuration built, how many survive, and how does that rarity price?', 'physics of the asset', NULL, NULL, NULL, NULL, NULL),
  ('S30', 'Factory batch effects', 'Do vehicles built in the same batch or sequence share defects or premiums?', 'physics of the asset', NULL, NULL, NULL, NULL, NULL),
  ('S31', 'Modification recipes and outcomes', 'Which combinations of modifications raise or lower a vehicle''s outcome?', 'physics of the asset', NULL, NULL, NULL, NULL, NULL),
  ('S32', 'Documentation premium', 'What is documentation worth, by kind of document?', 'physics of the asset', NULL, NULL, NULL, NULL, NULL),
  ('S33', 'Title brand arbitrage', 'Where do branded titles price differently across states and venues?', 'physics of the asset', NULL, NULL, NULL, NULL, NULL),
  ('S34', 'Information half-life', 'How long does new information about a vehicle keep moving its price?', 'information and attention', NULL, NULL, NULL, NULL, NULL),
  ('S35', 'Disclosure drift', 'How does a listing''s description change over its life, and does the change predict the outcome?', 'information and attention', NULL, NULL, NULL, NULL, NULL),
  ('S36', 'Expertise graph', 'Who knows what about which models, by the record of what they wrote?', 'information and attention', NULL, NULL, NULL, NULL, NULL),
  ('S37', 'Photographer fingerprints and image reuse', 'Which images are reused across listings, and who took them?', 'information and attention', NULL, NULL, NULL, NULL, NULL),
  ('S38', 'Event impact studies', 'How do outside events move the prices of the cohorts they touch?', 'information and attention', NULL, NULL, NULL, NULL, NULL),
  ('S39', 'Inconsistency graphs', 'Where do a vehicle''s records contradict one another?', 'information and attention', NULL, NULL, NULL, NULL, NULL),
  ('S40', 'Delivered-price surface', 'What does a vehicle cost delivered to a given place?', 'geography, logistics, tax', NULL, NULL, NULL, NULL, NULL),
  ('S41', 'Tax and rule geography', 'How do taxes and rules by jurisdiction change the cost of owning and selling?', 'geography, logistics, tax', NULL, ARRAY['taxes and rules by jurisdiction']::text[], NULL, NULL, NULL),
  ('S42', 'Regional taste maps', 'Which colors, options and body styles does each region prefer?', 'geography, logistics, tax', NULL, NULL, NULL, NULL, NULL),
  ('S43', 'Demographic overlays', 'How do population and income line up with where cohorts sell and for how much?', 'geography, logistics, tax', NULL, ARRAY['Census population and income']::text[], NULL, NULL, NULL),
  ('S44', 'Cohort migration', 'How do cohorts move between states over time?', 'geography, logistics, tax', NULL, NULL, NULL, NULL, NULL),
  ('S45', 'Service capacity market', 'Where is service capacity short or idle, and at what price?', 'geography, logistics, tax', NULL, NULL, NULL, NULL, NULL),
  ('S46', 'Unified dealer entity', 'Which accounts across platforms are the same dealer?', 'people and reputation', NULL, NULL, NULL, NULL, NULL),
  ('S47', 'Dealer markdown curves', 'How do dealers mark down unsold inventory over time?', 'people and reputation', NULL, NULL, NULL, NULL, NULL),
  ('S48', 'Tenure mix as stability', 'Does a cohort''s mix of short and long ownerships signal its stability?', 'people and reputation', NULL, NULL, NULL, NULL, NULL),
  ('S49', 'Venue integrity index', 'How clean is each venue, from its shill, disclosure and reserve signals?', 'people and reputation', NULL, NULL, NULL, NULL, NULL),
  ('S50', 'Restorer lineage', 'Which restorers'' work holds value years later?', 'people and reputation', NULL, NULL, NULL, NULL, NULL),
  ('S51', 'Rate and fuel betas', 'How do interest rates and fuel prices move each cohort''s prices?', 'economics and finance', NULL, ARRAY['interest rates', 'fuel prices']::text[], NULL, NULL, NULL),
  ('S52', 'Carry-adjusted returns', 'What does a flip return after the cost of carrying the vehicle?', 'economics and finance', NULL, NULL, NULL, NULL, NULL),
  ('S53', 'Guide lag', 'How far do published price guides lag realized sales?', 'economics and finance', NULL, ARRAY['licensed price guides']::text[], NULL, NULL, NULL),
  ('S54', 'Portfolio construction', 'Which mix of cohorts balances return, liquidity and seasonality?', 'economics and finance', NULL, NULL, NULL, NULL, NULL),
  ('S55', 'Parts price indices', 'How do parts prices move over time by part family?', 'economics and finance', NULL, NULL, NULL, NULL, NULL),
  ('S56', 'Venue design replays', 'How would lots have closed under a different venue rule?', 'counterfactuals', NULL, NULL, NULL, NULL, NULL),
  ('S57', 'Feature attribution by matched siblings', 'What is one feature worth, measured between otherwise matched vehicles?', 'counterfactuals', NULL, NULL, NULL, NULL, NULL),
  ('S58', 'What-if pricing for one VIN', 'What would one VIN bring under a different listing, timing or build?', 'counterfactuals', NULL, NULL, NULL, NULL, NULL),
  ('S59', 'Value of information', 'Which single observation would most reduce a price''s uncertainty, and what is it worth?', 'the machine''s economics', NULL, NULL, NULL, NULL, NULL),
  ('S60', 'Trust calibration', 'How often do each source''s claims prove true against outcomes?', 'the machine''s economics', NULL, NULL, NULL, NULL, NULL),
  ('SA', 'The auction as an order book', 'From a live lot''s bid and comment frames, what demand curve does it imply against its cohort, and where will the hammer land?', NULL, ARRAY['log: bid comments as timed quotes, stated prices as reservation prices, refusals', 'key: bid to identity, bid to lot', 'dimension: comment stance (bid, reservation, refusal, question) from the text fold', 'fold: per lot per minute, the implied demand curve', 'baseline: the cohort''s curve shape at the same minutes-to-close', 'residual: this lot''s curve against its cohort', 'feature: slope, depth, top-two gap as of each minute', 'prediction: hammer distribution and P(reserve met)', 'outcome: the hammer']::text[], NULL, 'Hammer distribution and P(reserve met) with intervals calibrated on every past lot; the thesis "clears above estimate" is scored at close against the hammer.', NULL, NULL),
  ('SB', 'The car as a bond', 'What will a vehicle cost to own, and what will it be worth after 1, 3 and 5 years, per county?', NULL, ARRAY['log: odometer observations, receipts, work sessions', 'key: vehicle, part, shop', 'dimension: parts taxonomy, failure modes', 'fold: miles per year and spend per mile per vehicle', 'baseline: cohort medians', 'residual: maintained above or below cohort', 'prediction: total cost of ownership and residual at 1, 3 and 5 years per county (tax, emissions, climate)', 'outcome: later sales and receipts']::text[], ARRAY['tax', 'emissions', 'climate']::text[], 'Total cost of ownership and residual value are graded against later sales and receipts.', NULL, NULL),
  ('SC', 'Liquidity as an option', 'Per cohort and venue, what discount sells a vehicle within 14 days, and how far is that from the patient price?', NULL, ARRAY['log: listing open and close clocks', 'key: lot, venue, place', 'dimension: cohort', 'fold: per cohort x venue, the survival curve of time-to-sale by price-to-baseline ratio', 'baseline: the cohort median curve', 'residual: per county and season', 'feature: N-day sell probability at a discount', 'prediction: the discount that sells in 14 days, with intervals', 'outcome: realized sales']::text[], NULL, 'The 14-day discount and its intervals are graded against realized sales.', NULL, NULL),
  ('SD', 'Ownership as flow', 'Per cohort and quarter, how do vehicles flow between counties, and where will supply thin next?', NULL, ARRAY['log: dated locations from listings, titles, transfers', 'key: place', 'fold: county to county transfer matrix per cohort per quarter', 'baseline: a gravity model (population, income, distance, climate)', 'residual: corridors above gravity', 'feature: net inflow per county per cohort', 'prediction: where supply thins next quarter', 'outcome: the quarter''s sales']::text[], ARRAY['population', 'income', 'distance', 'climate']::text[], 'Where supply thins is graded against the quarter''s sales.', NULL, NULL)
) AS v(stack_id, name, question, family, path, external_dimensions, scoring, thesis_vein_id, thesis_vein_version)
ON CONFLICT (name, version) DO NOTHING;
-- seed:stacks:end
-- seed:needs:begin
INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, fresh_within, note)
SELECT v.stack_id, 1, v.layer, v.kind, v.object, v.denominator, v.fresh_within, v.note
FROM (VALUES
  ('S01', 'key', 'abstract', 'place entity', NULL, NULL, 'seller_location is text; 69% matched a city-state lookup (case ledger, 2026-10-06)'),
  ('S02', 'key', 'abstract', 'cross-platform vehicle identity', NULL, NULL, 'short chassis numbers'),
  ('S02', 'key', 'column', 'ownership_transfers.auction_event_id', NULL, NULL, 'transfers keyed to lots; trigger_table and trigger_id name the source row with no foreign key'),
  ('S03', 'log', 'intake', 'bat_bids.bid_timestamp', NULL, '2 days'::interval, 'bid frames; the bat_bids copy stopped 2026-10-05 (case ledger §12)'),
  ('S03', 'key', 'column', 'bat_bids.external_identity_id', NULL, NULL, 'bid tied to the bidder identity'),
  ('S04', 'fold', 'abstract', 'comment sentiment per lot', NULL, NULL, 'queue with no reader (case ledger, 2026-10-06)'),
  ('S04', 'fold', 'abstract', 'relist chains', NULL, NULL, 'relist detection through the lot entity'),
  ('S04', 'fold', 'abstract', 'text fold', NULL, NULL, 'case ledger §13: the text fold unblocks 4, 5, 19'),
  ('S05', 'fold', 'abstract', 'text fold', NULL, NULL, 'analysis queue stuck (case ledger, 2026-10-06)'),
  ('S06', 'dimension', 'abstract', 'image zone dimension', NULL, NULL, 'keyed from image appearances'),
  ('S06', 'key', 'column', 'vehicle_images.vehicle_zone', NULL, NULL, 'zone per image'),
  ('S06', 'fold', 'abstract', 'vision gate condition claims', NULL, NULL, NULL),
  ('S07', 'log', 'intake', 'receipts.created_at', NULL, '14 days'::interval, 'receipts intake landed 0 rows in 14 days (case ledger, 2026-10-06)'),
  ('S07', 'dimension', 'abstract', 'parts and labor taxonomy', NULL, NULL, 'receipts and work keyed to it'),
  ('S08', 'log', 'abstract', 'odometer observation kind', NULL, NULL, 'a uniform observation kind with a clock on every source'),
  ('S09', 'key', 'column', 'bat_bids.external_identity_id', NULL, NULL, 'bidder edge'),
  ('S09', 'key', 'column', 'bat_bids.auction_event_id', NULL, NULL, 'bid to lot edge'),
  ('S09', 'key', 'column', 'auction_events.seller_external_identity_id', 'auction_events.seller_name', NULL, 'seller edge, over lots that name a seller'),
  ('S09', 'log', 'abstract', 'account age from profile reads', NULL, NULL, NULL),
  ('S10', 'log', 'column', 'vehicle_events.started_at', NULL, NULL, 'open clock of every episode (dense event clocks)'),
  ('S10', 'log', 'column', 'vehicle_events.ended_at', NULL, NULL, 'close clock of every episode (dense event clocks)'),
  ('S11', 'key', 'abstract', 'identity location', NULL, NULL, '328 identities carried a city (case ledger, 2026-10-06)'),
  ('S11', 'key', 'abstract', 'place entity', NULL, NULL, 'case ledger §13: the place entity unblocks 1, 11, 13, 16'),
  ('S12', 'dimension', 'column', 'vehicles.paint_code', NULL, NULL, 'color normalization from paint codes'),
  ('S12', 'dimension', 'column', 'vehicles.color_family', NULL, NULL, 'normalized color family'),
  ('S12', 'key', 'column', 'vehicles.canonical_body_style', NULL, NULL, 'body-style key; text with no foreign key to canonical_body_styles'),
  ('S12', 'key', 'abstract', 'option keys', NULL, NULL, NULL),
  ('S13', 'key', 'abstract', 'demand signals keyed to episodes', NULL, NULL, NULL),
  ('S13', 'dimension', 'abstract', 'cost-of-operating dimension', NULL, NULL, NULL),
  ('S13', 'log', 'abstract', 'non-BaT intake', NULL, NULL, '102 of 126 jobs paused (case ledger, 2026-10-06)'),
  ('S13', 'key', 'abstract', 'place entity', NULL, NULL, 'case ledger §13: the place entity unblocks 1, 11, 13, 16'),
  ('S13', 'fold', 'stack', 'S02', NULL, NULL, 'realized flip margin (2)'),
  ('S13', 'fold', 'stack', 'S11', NULL, NULL, 'buyer proximity (11)'),
  ('S14', 'key', 'abstract', 'option keys', NULL, NULL, 'options as a keyed dimension'),
  ('S14', 'dimension', 'column', 'vehicles.color_family', NULL, NULL, 'normalized color'),
  ('S15', 'log', 'intake', 'receipts.created_at', NULL, '14 days'::interval, 'receipts intake'),
  ('S15', 'log', 'intake', 'work_sessions.created_at', NULL, '14 days'::interval, 'work_sessions intake'),
  ('S15', 'dimension', 'abstract', 'modifications dimension', NULL, NULL, NULL),
  ('S15', 'baseline', 'stack', 'S14', NULL, NULL, 'cost basis against the cohort surface and (14)'),
  ('S16', 'key', 'column', 'ownership_transfers.auction_event_id', NULL, NULL, 'transfers keyed to lots'),
  ('S16', 'key', 'column', 'ownership_transfers.from_identity_id', NULL, NULL, 'transfers keyed to the seller identity'),
  ('S16', 'key', 'column', 'ownership_transfers.to_identity_id', NULL, NULL, 'transfers keyed to the buyer identity'),
  ('S16', 'dimension', 'abstract', 'state-history dimension', NULL, NULL, 'from dated locations'),
  ('S16', 'key', 'abstract', 'place entity', NULL, NULL, 'case ledger §13: the place entity unblocks 1, 11, 13, 16'),
  ('S17', 'key', 'column', 'timeline_events.organization_id', NULL, NULL, 'organization key on events'),
  ('S17', 'key', 'column', 'vehicle_events.source_organization_id', NULL, NULL, 'organization key on listing episodes'),
  ('S17', 'key', 'column', 'receipts.organization_id', NULL, NULL, 'organization key on receipts; vendor_name is text'),
  ('S17', 'key', 'abstract', 'organization keys re-pointed from archived tables', NULL, NULL, NULL),
  ('S18', 'log', 'abstract', 'dense dated sales', NULL, NULL, NULL),
  ('S18', 'log', 'abstract', 'market index series beyond BaT live bids', NULL, NULL, NULL),
  ('S19', 'fold', 'abstract', 'claims table', NULL, NULL, 'a shape decision'),
  ('S19', 'fold', 'abstract', 'text fold', NULL, NULL, 'case ledger §13: the text fold unblocks 4, 5, 19'),
  ('S20', 'fold', 'abstract', 'job-health snapshots', NULL, NULL, NULL),
  ('S20', 'fold', 'abstract', 'residual snapshots', NULL, NULL, NULL),
  ('S20', 'dimension', 'abstract', 'reader-dependency graph', NULL, NULL, NULL),
  ('S21', 'log', 'intake', 'bat_bids.bid_timestamp', NULL, '2 days'::interval, 'bid frames at second precision'),
  ('S21', 'key', 'column', 'bat_bids.external_identity_id', NULL, NULL, 'bid tied to the bidder identity'),
  ('S22', 'fold', 'abstract', 'extension chains from bid frames', NULL, NULL, NULL),
  ('S23', 'outcome', 'abstract', 'outcome clocks', NULL, NULL, NULL),
  ('S24', 'log', 'abstract', 'watcher counts as a time series', NULL, NULL, NULL),
  ('S25', 'key', 'abstract', 'platform entity', NULL, NULL, NULL),
  ('S25', 'log', 'column', 'vehicle_events.ended_at', NULL, NULL, 'every venue''s close clocks'),
  ('S26', 'log', 'column', 'auction_events.lot_number', NULL, NULL, 'lot order'),
  ('S26', 'dimension', 'abstract', 'auction sale entity', NULL, NULL, 'lots grouped by the auction they were catalogued in'),
  ('S27', 'dimension', 'abstract', 'state-history dimension', NULL, NULL, NULL),
  ('S27', 'dimension', 'abstract', 'image zone dimension', NULL, NULL, NULL),
  ('S27', 'dimension', 'abstract', 'climate dimension', NULL, NULL, NULL),
  ('S28', 'log', 'abstract', 'odometer observation kind', NULL, NULL, 'uniform odometer observations'),
  ('S28', 'log', 'intake', 'receipts.created_at', NULL, '14 days'::interval, 'receipts'),
  ('S29', 'dimension', 'abstract', 'production dimension', NULL, NULL, NULL),
  ('S29', 'key', 'abstract', 'cross-platform vehicle identity', NULL, NULL, 'cross-source VIN identity'),
  ('S30', 'dimension', 'abstract', 'VIN build sequence', NULL, NULL, NULL),
  ('S30', 'key', 'abstract', 'option keys', NULL, NULL, NULL),
  ('S31', 'dimension', 'abstract', 'parts and labor taxonomy', NULL, NULL, NULL),
  ('S31', 'dimension', 'abstract', 'modifications dimension', NULL, NULL, NULL),
  ('S32', 'dimension', 'column', 'vehicle_images.document_category', NULL, NULL, 'document kinds from the image fold'),
  ('S33', 'log', 'abstract', 'title observations with clocks', NULL, NULL, NULL),
  ('S33', 'fold', 'abstract', 'image fold', NULL, NULL, NULL),
  ('S34', 'fold', 'abstract', 'relist chains', NULL, NULL, NULL),
  ('S34', 'fold', 'abstract', 'text fold', NULL, NULL, NULL),
  ('S35', 'log', 'abstract', 'description observations per listing', NULL, NULL, NULL),
  ('S36', 'fold', 'abstract', 'text fold', NULL, NULL, NULL),
  ('S36', 'key', 'column', 'auction_comments.external_identity_id', NULL, NULL, 'comment author key'),
  ('S37', 'log', 'column', 'vehicle_images.exif_data', NULL, NULL, 'EXIF on every image'),
  ('S37', 'fold', 'column', 'vehicle_images.dhash', NULL, NULL, 'dhash on every image'),
  ('S38', 'log', 'abstract', 'dense dated sales', NULL, NULL, NULL),
  ('S39', 'log', 'abstract', 'odometer OCR', NULL, NULL, NULL),
  ('S39', 'log', 'intake', 'receipts.created_at', NULL, '14 days'::interval, 'receipts'),
  ('S40', 'key', 'abstract', 'place entity', NULL, NULL, NULL),
  ('S40', 'key', 'abstract', 'identity location', NULL, NULL, 'buyer location'),
  ('S41', 'dimension', 'abstract', 'jurisdiction dimension', NULL, NULL, NULL),
  ('S42', 'dimension', 'stack', 'S12', NULL, NULL, 'dimensions'),
  ('S42', 'key', 'abstract', 'place entity', NULL, NULL, NULL),
  ('S43', 'dimension', 'abstract', 'Census dimension', NULL, NULL, NULL),
  ('S44', 'dimension', 'abstract', 'state-history dimension', NULL, NULL, NULL),
  ('S45', 'log', 'intake', 'work_sessions.created_at', NULL, '14 days'::interval, 'work_sessions intake'),
  ('S45', 'key', 'column', 'timeline_events.organization_id', NULL, NULL, 'organization keys'),
  ('S46', 'key', 'abstract', 'cross-platform person identity', NULL, NULL, NULL),
  ('S46', 'key', 'abstract', 'platform entity', NULL, NULL, NULL),
  ('S47', 'log', 'table', 'vehicle_price_history', NULL, NULL, 'price observations as a time series'),
  ('S48', 'log', 'column', 'ownership_transfers.sale_date', NULL, NULL, 'transfers with clocks'),
  ('S49', 'feature', 'stack', 'S09', NULL, NULL, NULL),
  ('S49', 'feature', 'stack', 'S05', NULL, NULL, NULL),
  ('S49', 'feature', 'stack', 'S23', NULL, NULL, NULL),
  ('S50', 'key', 'column', 'timeline_events.organization_id', NULL, NULL, 'organization keys on work'),
  ('S50', 'log', 'abstract', 'long clocks', NULL, NULL, NULL),
  ('S51', 'log', 'abstract', 'dense dated sales', NULL, NULL, NULL),
  ('S51', 'dimension', 'abstract', 'macro series', NULL, NULL, NULL),
  ('S52', 'fold', 'stack', 'S02', NULL, NULL, NULL),
  ('S52', 'dimension', 'abstract', 'cost-of-carry dimension', NULL, NULL, NULL),
  ('S53', 'dimension', 'abstract', 'licensed guide dimension', NULL, NULL, NULL),
  ('S54', 'feature', 'stack', 'S10', NULL, NULL, NULL),
  ('S54', 'feature', 'stack', 'S18', NULL, NULL, NULL),
  ('S54', 'feature', 'stack', 'S51', NULL, NULL, NULL),
  ('S55', 'dimension', 'abstract', 'parts and labor taxonomy', NULL, NULL, NULL),
  ('S55', 'log', 'intake', 'receipts.created_at', NULL, '14 days'::interval, 'receipts intake'),
  ('S56', 'prediction', 'stack', 'S21', NULL, NULL, NULL),
  ('S57', 'dimension', 'stack', 'S12', NULL, NULL, NULL),
  ('S57', 'dimension', 'stack', 'S30', NULL, NULL, NULL),
  ('S58', 'prediction', 'stack', 'S10', NULL, NULL, NULL),
  ('S58', 'prediction', 'stack', 'S21', NULL, NULL, NULL),
  ('S58', 'prediction', 'stack', 'S24', NULL, NULL, NULL),
  ('S58', 'prediction', 'stack', 'S31', NULL, NULL, NULL),
  ('S59', 'fold', 'stack', 'S20', NULL, NULL, NULL),
  ('S59', 'prediction', 'abstract', 'the price model', NULL, NULL, NULL),
  ('S60', 'fold', 'abstract', 'claims table', NULL, NULL, NULL),
  ('S60', 'outcome', 'abstract', 'outcome ledger', NULL, NULL, NULL),
  ('SA', 'log', 'table', 'auction_comments', NULL, NULL, 'every bid comment is a timed quote'),
  ('SA', 'log', 'intake', 'bat_bids.bid_timestamp', NULL, '2 days'::interval, 'bid frames at second precision (the bat_bids copy)'),
  ('SA', 'key', 'column', 'auction_comments.external_identity_id', NULL, NULL, 'bid to identity (keyed 2026-10-06)'),
  ('SA', 'key', 'column', 'auction_comments.auction_event_id', NULL, NULL, 'bid to lot (keyed 2026-10-06)'),
  ('SA', 'dimension', 'abstract', 'comment stance dimension', NULL, NULL, 'bid, reservation, refusal, question'),
  ('SB', 'log', 'abstract', 'odometer observation kind', NULL, NULL, 'odometer observations'),
  ('SB', 'log', 'intake', 'receipts.created_at', NULL, '14 days'::interval, 'receipts intake landed 0 rows in 14 days (case ledger 13.2)'),
  ('SB', 'log', 'intake', 'work_sessions.created_at', NULL, '14 days'::interval, 'work sessions'),
  ('SB', 'key', 'column', 'timeline_events.organization_id', NULL, NULL, 'shop key on work'),
  ('SB', 'key', 'abstract', 'place entity', NULL, NULL, 'per county'),
  ('SB', 'dimension', 'abstract', 'parts and labor taxonomy', NULL, NULL, 'parts taxonomy and part key'),
  ('SB', 'dimension', 'abstract', 'failure-mode dimension', NULL, NULL, NULL),
  ('SB', 'dimension', 'abstract', 'jurisdiction dimension', NULL, NULL, 'tax and emissions per county'),
  ('SB', 'dimension', 'abstract', 'climate dimension', NULL, NULL, 'climate per county'),
  ('SC', 'log', 'column', 'vehicle_events.started_at', NULL, NULL, 'listing open clock (dense clocks on every episode)'),
  ('SC', 'log', 'column', 'vehicle_events.ended_at', NULL, NULL, 'listing close clock (dense clocks on every episode)'),
  ('SC', 'key', 'abstract', 'platform entity', NULL, NULL, 'venue'),
  ('SC', 'key', 'abstract', 'place entity', NULL, NULL, NULL),
  ('SC', 'dimension', 'stack', 'S12', NULL, NULL, 'cohort'),
  ('SD', 'log', 'table', 'vehicle_location_observations', NULL, NULL, 'dated locations from listings'),
  ('SD', 'log', 'abstract', 'title observations with clocks', NULL, NULL, 'dated locations from titles'),
  ('SD', 'key', 'abstract', 'place entity', NULL, NULL, NULL),
  ('SD', 'dimension', 'abstract', 'Census dimension', NULL, NULL, 'gravity model: population, income'),
  ('SD', 'dimension', 'abstract', 'climate dimension', NULL, NULL, 'gravity model: climate')
) AS v(stack_id, layer, kind, object, denominator, fresh_within, note)
ON CONFLICT (stack_id, version, layer, object) DO NOTHING;
-- seed:needs:end

-- 7. Catalog check: every new column and object is described, the seed landed whole, and the function measures every
-- stack once, or the transaction aborts and nothing of this migration stays.
DO $check$
DECLARE
  bare text[];
  n_stacks integer;
  n_needs integer;
  n_substrates integer;
  n_measured integer;
  n_empty integer;
BEGIN
  SELECT array_agg(c.relname || '.' || a.attname ORDER BY c.relname, a.attnum) INTO bare
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
  WHERE c.oid IN ('public.stacks'::regclass, 'public.stack_needs'::regclass, 'public.stack_substrates'::regclass,
                  'public.v_stacks'::regclass)
    AND a.attnum > 0 AND NOT a.attisdropped AND col_description(a.attrelid, a.attnum) IS NULL;
  IF bare IS NOT NULL THEN
    RAISE EXCEPTION 'columns without COMMENT ON COLUMN: %', bare;
  END IF;
  IF obj_description('public.stacks'::regclass, 'pg_class') IS NULL
     OR obj_description('public.stack_needs'::regclass, 'pg_class') IS NULL
     OR obj_description('public.stack_substrates'::regclass, 'pg_class') IS NULL
     OR obj_description('public.v_stacks'::regclass, 'pg_class') IS NULL
     OR obj_description('public.stack_coverage(text)'::regprocedure, 'pg_proc') IS NULL THEN
    RAISE EXCEPTION 'a new table, view or function has no comment';
  END IF;

  SELECT count(*) INTO n_stacks FROM public.stacks
  WHERE version = 1 AND status = 'measured' AND source = 'data-machine-cases.md §13 2026-10-06/07';
  SELECT count(*) INTO n_needs FROM public.stack_needs WHERE version = 1;
  SELECT count(*) INTO n_substrates FROM public.stack_substrates WHERE source = 'data-machine-cases.md §13 2026-10-06/07';
  IF n_stacks <> 64 OR n_needs <> 151 OR n_substrates <> 47 THEN
    RAISE EXCEPTION 'seed landed % stacks, % needs, % substrates; expected 64, 151, 47', n_stacks, n_needs, n_substrates;
  END IF;

  SELECT count(*), count(*) FILTER (WHERE c.n_needs = 0) INTO n_measured, n_empty FROM public.stack_coverage() c;
  IF n_measured <> 64 OR n_empty <> 0 THEN
    RAISE EXCEPTION 'stack_coverage() measured % stacks, % with no needs; expected 64 and 0', n_measured, n_empty;
  END IF;
END
$check$;

COMMIT;

-- Verify live after the run (read-only):
--   select stack_id, name, status, coverage, n_needs, n_present, n_partial, n_missing, needs_missing
--     from public.v_stacks order by coverage desc nulls last, stack_id;                                       -- 64 rows
--   select object, count(distinct stack_id) as stacks from public.stack_needs where kind = 'abstract'
--     group by object order by stacks desc;                                       -- which missing layer unblocks most
--   select * from public.stack_coverage('S03');                                         -- one stack with its evidence
--   select grantee, privilege_type from information_schema.role_table_grants
--     where table_name in ('stacks', 'stack_needs', 'stack_substrates', 'v_stacks') order by 1, 2;  -- service_role SELECT
--   select proposal_type, status from public.schema_proposals where proposed_by_agent_key = 'claude-opus-5-5-stack-registry';
--   anon probe: GET /rest/v1/v_stacks with the public anon key returns 401 permission denied.
