-- Isolated PostgreSQL 17 contract for 20261007014500_stack_registry.sql (case ledger 13.2: the stack registry as data)
-- and for 20261007040000_stack_sa_v2_showable.sql (SA version 2, the stack as a page) and
-- 20261007121000_stack_s61_funding_fit.sql (S61 version 1, funding opportunity fit), applied in that order below.
-- Synthetic rows only; never production. Run from the repo root in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_stack_registry_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_stack_registry_ci -f supabase/sql/test_stack_registry.sql
-- Fixtures carry the live shapes read from prod on 2026-10-07 (PostgreSQL 17.6): vein_ledger and its append-only trigger
-- function, schema_proposals with its constraints and evidence trigger, pipeline_registry, and v_schema_atlas as a plain
-- table with the live view's column names and types. Small fixture tables, analyzed, give pg_stats real null fractions.
-- Supabase's default privileges are set first, so the migration's revokes are exercised.
-- Covered: shape and comments; the proposal vocabulary and row; constraints and append-only attacks; the seed (64 stacks,
-- 151 needs, 47 substrates, S03's thesis, no owner quotes) and its idempotent re-run from the migration's own text; every
-- need kind resolving present, partial and missing with its evidence; coverage arithmetic; stack needs one level down;
-- a new version replacing the old in the reading; a substrate declaration moving every stack that names it; the reader
-- view; the ACL with real reads as service_role, anon and authenticated.
-- Not covered: the live atlas and statistics (the PR carries a read-only run of the function body on prod); the
-- unindexed-clock branch on a table over 1,000,000 rows (a planner estimate this fixture cannot reach cheaply).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.stacks') IS NOT NULL
     OR to_regclass('public.vein_ledger') IS NOT NULL
     OR to_regclass('public.v_schema_atlas') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* PostgreSQL 17 database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
-- Supabase's default privileges: every table, view and function postgres creates in public starts with every privilege
-- for the three API roles (and functions with EXECUTE for PUBLIC). The migration must take them away.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

-- A statement that must fail with one SQLSTATE. It runs in a subtransaction, so a failure leaves nothing behind.
CREATE FUNCTION pg_temp.fails(label text, stmt text, want text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = want THEN RAISE NOTICE 'PASS %', label; RETURN; END IF;
    RAISE EXCEPTION 'Contract failed: % raised % (%), expected %', label, SQLSTATE, SQLERRM, want;
  END;
  RAISE EXCEPTION 'Contract failed: % did not raise (expected %)', label, want;
END $$;

-- Live fixtures ------------------------------------------------------------------------------------------------------
-- vein_append_only(), as pg_get_functiondef printed it on prod.
CREATE FUNCTION public.vein_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION '% is append-only: register a new version or append a new run', TG_TABLE_NAME;
END;
$function$;

-- vein_ledger as created by 20261001120000, with its append-only trigger and the thesis row S03 cites.
CREATE TABLE public.vein_ledger (
  vein_id text NOT NULL, version integer NOT NULL DEFAULT 1, family text NOT NULL, hypothesis text NOT NULL,
  intent text NOT NULL, population text NOT NULL, outcome text NOT NULL, test text NOT NULL, pass_rule text NOT NULL,
  baseline text NOT NULL, parameters jsonb NOT NULL DEFAULT '{}'::jsonb, case_ref text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')), supersedes_version integer,
  registered_at timestamptz NOT NULL DEFAULT now(), registered_by text NOT NULL,
  PRIMARY KEY (vein_id, version)
);
INSERT INTO public.vein_ledger (vein_id, version, family, hypothesis, intent, population, outcome, test, pass_rule,
                                baseline, case_ref, registered_by)
VALUES ('V012', 1, 'consequential_bidder', 'fixture', 'fixture', 'fixture', 'fixture', 'fixture', 'fixture', 'fixture',
        'C6', 'fixture');
CREATE TRIGGER vein_ledger_append_only BEFORE UPDATE OR DELETE ON public.vein_ledger
  FOR EACH ROW EXECUTE FUNCTION public.vein_append_only();

-- schema_proposals with the live columns, constraints (proposal_type as of 2026-10-07, add_column included) and trigger.
CREATE TABLE public.schema_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposed_at timestamptz NOT NULL DEFAULT now(),
  proposed_by_user_id uuid, proposed_by_agent_key text,
  proposal_type text NOT NULL, payload jsonb NOT NULL, evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  motivating_observation_ids uuid[], motivating_pending_claim_ids uuid[],
  estimated_scope jsonb, backward_compatibility jsonb,
  status text NOT NULL DEFAULT 'open', claimed_by_user_id uuid, claimed_at timestamptz, resolved_at timestamptz,
  decision_rationale text, promoted_to_id uuid,
  supersedes_proposal_id uuid REFERENCES public.schema_proposals(id),
  superseded_by uuid REFERENCES public.schema_proposals(id),
  CONSTRAINT proposer_present CHECK (proposed_by_user_id IS NOT NULL OR proposed_by_agent_key IS NOT NULL),
  CONSTRAINT schema_proposals_status_check CHECK (status = ANY (ARRAY['open', 'under_review', 'approved', 'rejected',
    'needs_changes', 'superseded', 'withdrawn'])),
  CONSTRAINT schema_proposals_proposal_type_check CHECK (proposal_type = ANY (ARRAY['add_property', 'fork_property',
    'deprecate_property', 'modify_property', 'add_source', 'modify_trust_tier', 'add_observation_kind',
    'add_source_category', 'add_image_attribute', 'add_column']))
);
CREATE FUNCTION public.schema_proposal_evidence_check()
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
      NEW.proposal_type;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_schema_proposal_evidence BEFORE INSERT ON public.schema_proposals
  FOR EACH ROW EXECUTE FUNCTION public.schema_proposal_evidence_check();
INSERT INTO public.schema_proposals (proposed_by_agent_key, proposal_type, payload, status)
VALUES ('earlier-agent', 'add_column', '{"table": "earlier"}', 'approved');

CREATE TABLE public.pipeline_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL, column_name text,
  owned_by text NOT NULL, description text NOT NULL, valid_values text[],
  do_not_write_directly boolean NOT NULL DEFAULT false, write_via text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_name, column_name)
);

-- The atlas, as a table with the live view's column names and types. Rows describe the fixture tables below.
CREATE TABLE public.v_schema_atlas (
  table_name name, activity text, writes_since_stats_reset bigint, reads_since_stats_reset bigint, est_rows bigint,
  heap_toast_bytes bigint, n_cols bigint, n_cols_described bigint, fk_out bigint, fk_parents text[], fk_in bigint,
  triggers bigint, purpose text, registry_fields bigint, registry_owners text[], writers_30d text[],
  undeclared_stmts_30d bigint, last_write timestamptz, crons_mentioning text[]
);
REVOKE ALL ON public.v_schema_atlas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_schema_atlas TO service_role;
INSERT INTO public.v_schema_atlas (table_name, activity, est_rows, registry_fields, registry_owners) VALUES
  ('fx_log', 'written', 100, NULL, NULL),
  ('fx_parent', 'read-only', 10, NULL, NULL),
  ('fx_empty', 'idle', 0, NULL, NULL),
  ('fx_fold_owned', 'written', 10, 1, ARRAY['fx_writer']),
  ('fx_fold_unowned', 'written', 10, NULL, NULL);

-- Fixture tables with known fills: of 100 fx_log rows, fk_full is set on 95, fk_thin on 50, nofk_full on 100 (no
-- foreign key), fk_ratio on 46 and ratio_text on 50 (every fk_ratio row among them), made_at newest one hour ago.
CREATE TABLE public.fx_parent (id uuid PRIMARY KEY);
INSERT INTO public.fx_parent SELECT gen_random_uuid() FROM generate_series(1, 10);
CREATE TABLE public.fx_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fk_full uuid REFERENCES public.fx_parent (id),
  fk_thin uuid REFERENCES public.fx_parent (id),
  nofk_full uuid,
  fk_ratio uuid REFERENCES public.fx_parent (id),
  ratio_text text,
  label text,
  made_at timestamptz
);
CREATE INDEX fx_log_made_at_idx ON public.fx_log (made_at);
INSERT INTO public.fx_log (fk_full, fk_thin, nofk_full, fk_ratio, ratio_text, label, made_at)
SELECT CASE WHEN g <= 95 THEN p.id END, CASE WHEN g <= 50 THEN p.id END, p.id,
       CASE WHEN g <= 46 THEN p.id END, CASE WHEN g <= 50 THEN 'handle ' || g END, 'label ' || g,
       now() - interval '1 hour' - g * interval '1 minute'
FROM generate_series(1, 100) g
CROSS JOIN LATERAL (SELECT id FROM public.fx_parent ORDER BY id LIMIT 1) p;
CREATE TABLE public.fx_old (made_at timestamptz);
INSERT INTO public.fx_old VALUES (now() - interval '30 days'), (now() - interval '40 days'), (now() - interval '50 days');
CREATE TABLE public.fx_empty (made_at timestamptz);
ANALYZE public.fx_parent, public.fx_log, public.fx_old, public.fx_empty;
-- A column added after ANALYZE has no statistics.
ALTER TABLE public.fx_log ADD COLUMN after_analyze text;

SELECT pg_temp.ok('fixture: pg_stats carries the planned null fractions',
  (SELECT array_agg(round(null_frac::numeric, 2) ORDER BY attname) FROM pg_stats
   WHERE schemaname = 'public' AND tablename = 'fx_log' AND attname IN ('fk_full', 'fk_ratio', 'fk_thin', 'nofk_full', 'ratio_text'))
  = ARRAY[0.05, 0.54, 0.50, 0.00, 0.50]::numeric[]);

-- The migration ------------------------------------------------------------------------------------------------------
\ir ../migrations/20261007014500_stack_registry.sql

-- Shape and comments ---------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('stacks: columns, order and types',
  (SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum) FROM pg_attribute
   WHERE attrelid = 'public.stacks'::regclass AND attnum > 0 AND NOT attisdropped)
  = 'stack_id:text,version:integer,name:text,question:text,family:text,path:text[],external_dimensions:text[],'
    || 'who_cares:text,scoring:text,status:text,thesis_vein_id:text,thesis_vein_version:integer,source:text,'
    || 'supersedes_version:integer,registered_at:timestamp with time zone,registered_by:text');
SELECT pg_temp.ok('stack_needs: columns, order and types; substrate is generated',
  (SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum) FROM pg_attribute
   WHERE attrelid = 'public.stack_needs'::regclass AND attnum > 0 AND NOT attisdropped)
  = 'stack_id:text,version:integer,layer:text,kind:text,object:text,denominator:text,fresh_within:interval,note:text,substrate:text'
  AND (SELECT attgenerated FROM pg_attribute WHERE attrelid = 'public.stack_needs'::regclass AND attname = 'substrate') = 's');
SELECT pg_temp.ok('stack_substrates: columns, order and types',
  (SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum) FROM pg_attribute
   WHERE attrelid = 'public.stack_substrates'::regclass AND attnum > 0 AND NOT attisdropped)
  = 'substrate:text,declared_table:text,declared_at:timestamp with time zone,declared_by:text,note:text,source:text,'
    || 'registered_at:timestamp with time zone,registered_by:text');
SELECT pg_temp.ok('v_stacks: columns, order and types',
  (SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum) FROM pg_attribute
   WHERE attrelid = 'public.v_stacks'::regclass AND attnum > 0 AND NOT attisdropped)
  = 'stack_id:text,version:integer,name:text,question:text,family:text,status:text,coverage:numeric,n_needs:integer,'
    || 'n_present:integer,n_partial:integer,n_missing:integer,needs_missing:text[],needs_partial:text[],'
    || 'thesis_vein_id:text,thesis_vein_version:integer,source:text,registered_at:timestamp with time zone,'
    || 'measured_at:timestamp with time zone');
SELECT pg_temp.ok('stack_coverage: STABLE, SECURITY DEFINER, fixed search_path, the documented result columns',
  (SELECT p.provolatile = 's' AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, pg_temp']
          AND pg_get_function_result(p.oid) = 'TABLE(stack_id text, version integer, coverage numeric, n_needs integer, '
            || 'n_present integer, n_partial integer, n_missing integer, needs jsonb, measured_at timestamp with time zone)'
   FROM pg_proc p WHERE p.oid = 'public.stack_coverage(text)'::regprocedure));
SELECT pg_temp.ok('every column of the three tables and the view has a comment',
  NOT EXISTS (SELECT 1 FROM pg_attribute a
              WHERE a.attrelid IN ('public.stacks'::regclass, 'public.stack_needs'::regclass,
                                   'public.stack_substrates'::regclass, 'public.v_stacks'::regclass)
                AND a.attnum > 0 AND NOT a.attisdropped AND coalesce(col_description(a.attrelid, a.attnum), '') = ''));
SELECT pg_temp.ok('the tables, the view and the function have comments',
  obj_description('public.stacks'::regclass, 'pg_class') LIKE 'Stack registry%'
  AND obj_description('public.stack_needs'::regclass, 'pg_class') IS NOT NULL
  AND obj_description('public.stack_substrates'::regclass, 'pg_class') IS NOT NULL
  AND obj_description('public.v_stacks'::regclass, 'pg_class') IS NOT NULL
  AND obj_description('public.stack_coverage(text)'::regprocedure, 'pg_proc') LIKE 'How close each stack is today.%');

-- The proposal ---------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('schema_proposals: one approved add_table row from this migration, the earlier row untouched',
  (SELECT count(*) FROM public.schema_proposals WHERE proposal_type = 'add_table' AND status = 'approved'
     AND proposed_by_agent_key = 'claude-opus-5-5-stack-registry' AND resolved_at IS NOT NULL
     AND payload ->> 'migration' = '20261007014500_stack_registry.sql'
     AND jsonb_array_length(payload -> 'tables') = 3 AND jsonb_array_length(evidence) > 0) = 1
  AND (SELECT count(*) FROM public.schema_proposals) = 2);
SELECT pg_temp.fails('schema_proposals still refuses an unknown proposal type',
  $q$INSERT INTO public.schema_proposals (proposed_by_agent_key, proposal_type, payload) VALUES ('x', 'add_view', '{}')$q$,
  '23514');

-- The seed -------------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('seed: 64 stacks, S01-S60 and SA-SD, version 1, measured, from the case ledger',
  (SELECT array_agg(stack_id ORDER BY stack_id) FROM public.stacks)
    = (SELECT array_agg(x ORDER BY x) FROM (SELECT 'S' || lpad(g::text, 2, '0') AS x FROM generate_series(1, 60) g
                                           UNION ALL SELECT unnest(ARRAY['SA', 'SB', 'SC', 'SD'])) s)
  AND NOT EXISTS (SELECT 1 FROM public.stacks WHERE version <> 1 OR status <> 'measured' OR supersedes_version IS NOT NULL
                  OR source <> 'data-machine-cases.md §13 2026-10-06/07'));
SELECT pg_temp.ok('seed: 151 needs, every stack has at least one, every stack need names a seeded stack',
  (SELECT count(*) FROM public.stack_needs) = 151
  AND NOT EXISTS (SELECT 1 FROM public.stacks s WHERE NOT EXISTS (SELECT 1 FROM public.stack_needs n WHERE n.stack_id = s.stack_id))
  AND NOT EXISTS (SELECT 1 FROM public.stack_needs n WHERE n.kind = 'stack'
                  AND NOT EXISTS (SELECT 1 FROM public.stacks s WHERE s.stack_id = n.object)));
SELECT pg_temp.ok('seed: needs by kind (table 3, column 33, intake 12, stack 20, abstract 83)',
  (SELECT jsonb_object_agg(kind, n) FROM (SELECT kind, count(*) AS n FROM public.stack_needs GROUP BY kind) k)
  = '{"table": 3, "column": 33, "intake": 12, "stack": 20, "abstract": 83}'::jsonb);
SELECT pg_temp.ok('seed: 47 substrates, none declared, every one named by a need',
  (SELECT count(*) FROM public.stack_substrates) = 47
  AND NOT EXISTS (SELECT 1 FROM public.stack_substrates WHERE declared_table IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM public.stack_substrates g WHERE NOT EXISTS
                  (SELECT 1 FROM public.stack_needs n WHERE n.substrate = g.substrate)));
SELECT pg_temp.ok('seed: S03''s thesis is V012 version 1 and no other stack has one',
  (SELECT array_agg(stack_id || ':' || thesis_vein_id || ':' || thesis_vein_version) FROM public.stacks
   WHERE thesis_vein_id IS NOT NULL) = ARRAY['S03:V012:1']);
SELECT pg_temp.ok('seed: scoring for A-D only, who_cares unknown everywhere, family for 21-60 only, path for all but 21-60',
  (SELECT array_agg(stack_id ORDER BY stack_id) FROM public.stacks WHERE scoring IS NOT NULL) = ARRAY['SA', 'SB', 'SC', 'SD']
  AND NOT EXISTS (SELECT 1 FROM public.stacks WHERE who_cares IS NOT NULL)
  AND (SELECT count(*) FROM public.stacks WHERE family IS NOT NULL) = 40
  AND NOT EXISTS (SELECT 1 FROM public.stacks WHERE (family IS NOT NULL) <> (stack_id ~ '^S(2[1-9]|[3-5][0-9]|60)$'))
  AND NOT EXISTS (SELECT 1 FROM public.stacks WHERE (path IS NULL) <> (stack_id ~ '^S(2[1-9]|[3-5][0-9]|60)$')));
SELECT pg_temp.ok('seed: every intake need has a window, bid frames 2 days and receipts or work sessions 14 days',
  (SELECT array_agg(DISTINCT object || '=' || fresh_within::text ORDER BY object || '=' || fresh_within::text)
   FROM public.stack_needs WHERE kind = 'intake')
  = ARRAY['bat_bids.bid_timestamp=2 days', 'receipts.created_at=14 days', 'work_sessions.created_at=14 days']);
SELECT pg_temp.ok('seed: the owner''s words stay in the case ledger (no quoted fragment in any row)',
  NOT EXISTS (
    SELECT 1 FROM (
      SELECT concat_ws(' ', name, question, family, array_to_string(path, ' '), array_to_string(external_dimensions, ' '),
                       scoring) AS t FROM public.stacks
      UNION ALL SELECT concat_ws(' ', object, note) FROM public.stack_needs
      UNION ALL SELECT concat_ws(' ', substrate, note) FROM public.stack_substrates) r
    WHERE r.t ~* '(barely scratching|investment-grade|design language for sql|this scale is where|pretty pictures|marketplace of actions|spinning these up|the owner''s example)'));

-- The seed again, as the migration's own statements: nothing changes and nothing fails.
CREATE TEMP TABLE mig_lines (n bigserial, line text);
\copy mig_lines(line) FROM 'supabase/migrations/20261007014500_stack_registry.sql' WITH (FORMAT csv, DELIMITER E'\x01', QUOTE E'\x02', ESCAPE E'\x02')
SELECT pg_temp.ok('the migration mints with plain CREATE TABLE (a name collision errors) and marks its seed and body',
  NOT EXISTS (SELECT 1 FROM mig_lines WHERE line ~* 'create table if not exists')
  AND (SELECT count(*) FROM mig_lines WHERE line ~ '^-- seed:(substrates|stacks|needs):(begin|end)$') = 6
  AND (SELECT count(*) FROM mig_lines WHERE line ~ '^  -- stack_coverage body (begin|end)$') = 2);
DO $$
DECLARE
  b text;
  stmt text;
  before_counts text := (SELECT (SELECT count(*) FROM public.stacks) || '/' || (SELECT count(*) FROM public.stack_needs)
                                || '/' || (SELECT count(*) FROM public.stack_substrates));
BEGIN
  FOREACH b IN ARRAY ARRAY['substrates', 'stacks', 'needs'] LOOP
    SELECT string_agg(l.line, E'\n' ORDER BY l.n) INTO stmt
    FROM mig_lines l
    WHERE l.n > (SELECT n FROM mig_lines WHERE line = '-- seed:' || b || ':begin')
      AND l.n < (SELECT n FROM mig_lines WHERE line = '-- seed:' || b || ':end');
    EXECUTE rtrim(stmt, E'; \n');
  END LOOP;
  PERFORM pg_temp.ok('seed re-run from the migration text changes no count (' || before_counts || ')',
    before_counts = (SELECT (SELECT count(*) FROM public.stacks) || '/' || (SELECT count(*) FROM public.stack_needs)
                            || '/' || (SELECT count(*) FROM public.stack_substrates)));
END $$;

-- Constraints and append-only ----------------------------------------------------------------------------------------
SELECT pg_temp.fails('stacks: an unknown status is refused',
  $q$INSERT INTO public.stacks (stack_id, name, question, status, source, registered_by) VALUES ('SX9', 'x', 'x?', 'done', 't', 't')$q$, '23514');
SELECT pg_temp.fails('stacks: an id that is not S plus digits or capitals is refused',
  $q$INSERT INTO public.stacks (stack_id, name, question, source, registered_by) VALUES ('X9', 'x', 'x?', 't', 't')$q$, '23514');
SELECT pg_temp.fails('stacks: a second stack id with the same name and version is refused',
  $q$INSERT INTO public.stacks (stack_id, name, question, source, registered_by) VALUES ('SX9', 'Bid hazard model', 'x?', 't', 't')$q$, '23505');
SELECT pg_temp.fails('stacks: a thesis that is not a registered vein is refused',
  $q$INSERT INTO public.stacks (stack_id, name, question, thesis_vein_id, thesis_vein_version, source, registered_by) VALUES ('SX9', 'x', 'x?', 'V999', 1, 't', 't')$q$, '23503');
SELECT pg_temp.fails('stacks: a thesis id without its version is refused',
  $q$INSERT INTO public.stacks (stack_id, name, question, thesis_vein_id, source, registered_by) VALUES ('SX9', 'x', 'x?', 'V012', 't', 't')$q$, '23514');
SELECT pg_temp.fails('stacks: superseding a later or equal version is refused',
  $q$INSERT INTO public.stacks (stack_id, version, name, question, supersedes_version, source, registered_by) VALUES ('S01', 2, 'x', 'x?', 2, 't', 't')$q$, '23514');
SELECT pg_temp.fails('stacks: superseding a version that does not exist is refused',
  $q$INSERT INTO public.stacks (stack_id, version, name, question, supersedes_version, source, registered_by) VALUES ('SX9', 3, 'x', 'x?', 2, 't', 't')$q$, '23503');
SELECT pg_temp.fails('stack_needs: an unknown layer is refused',
  $q$INSERT INTO public.stack_needs (stack_id, version, layer, kind, object) VALUES ('S01', 1, 'page', 'table', 'fx_log')$q$, '23514');
SELECT pg_temp.fails('stack_needs: an unknown kind is refused',
  $q$INSERT INTO public.stack_needs (stack_id, version, layer, kind, object) VALUES ('S01', 1, 'log', 'view', 'fx_log')$q$, '23514');
SELECT pg_temp.fails('stack_needs: a table object with a dot is refused',
  $q$INSERT INTO public.stack_needs (stack_id, version, layer, kind, object) VALUES ('S01', 1, 'log', 'table', 'fx_log.id')$q$, '23514');
SELECT pg_temp.fails('stack_needs: a column object without a dot is refused',
  $q$INSERT INTO public.stack_needs (stack_id, version, layer, kind, object) VALUES ('S01', 1, 'key', 'column', 'fx_log')$q$, '23514');
SELECT pg_temp.fails('stack_needs: a stack that needs itself is refused',
  $q$INSERT INTO public.stack_needs (stack_id, version, layer, kind, object) VALUES ('S01', 1, 'fold', 'stack', 'S01')$q$, '23514');
SELECT pg_temp.fails('stack_needs: an abstract need on an unregistered substrate is refused',
  $q$INSERT INTO public.stack_needs (stack_id, version, layer, kind, object) VALUES ('S01', 1, 'key', 'abstract', 'a place entity')$q$, '23503');
SELECT pg_temp.fails('stack_needs: an intake need without a window is refused',
  $q$INSERT INTO public.stack_needs (stack_id, version, layer, kind, object) VALUES ('S01', 1, 'log', 'intake', 'fx_log.made_at')$q$, '23514');
SELECT pg_temp.fails('stack_needs: a window on a column need is refused',
  $q$INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, fresh_within) VALUES ('S01', 1, 'key', 'column', 'fx_log.fk_full', '1 day')$q$, '23514');
SELECT pg_temp.fails('stack_needs: a denominator on another table is refused',
  $q$INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator) VALUES ('S01', 1, 'key', 'column', 'fx_log.fk_full', 'fx_old.made_at')$q$, '23514');
SELECT pg_temp.fails('stack_needs: a denominator on an intake need is refused',
  $q$INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, fresh_within) VALUES ('S01', 1, 'log', 'intake', 'fx_log.made_at', 'fx_log.label', '1 day')$q$, '23514');
SELECT pg_temp.fails('stack_needs: a need on a stack version that does not exist is refused',
  $q$INSERT INTO public.stack_needs (stack_id, version, layer, kind, object) VALUES ('S01', 2, 'log', 'table', 'fx_log')$q$, '23503');
SELECT pg_temp.fails('stack_substrates: a declared table without its date and author is refused',
  $q$INSERT INTO public.stack_substrates (substrate, declared_table, source, registered_by) VALUES ('fx half', 'fx_log', 't', 't')$q$, '23514');
SELECT pg_temp.fails('stacks are append-only: UPDATE raises',
  $q$UPDATE public.stacks SET status = 'live' WHERE stack_id = 'S01'$q$, 'P0001');
SELECT pg_temp.fails('stacks are append-only: DELETE raises',
  $q$DELETE FROM public.stacks WHERE stack_id = 'S01'$q$, 'P0001');
SELECT pg_temp.fails('stack_needs are append-only: UPDATE raises',
  $q$UPDATE public.stack_needs SET note = 'x' WHERE stack_id = 'S01'$q$, 'P0001');
SELECT pg_temp.fails('stack_needs are append-only: DELETE raises',
  $q$DELETE FROM public.stack_needs WHERE stack_id = 'S01'$q$, 'P0001');

-- Coverage ---------------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('in this database no seeded need resolves present: their objects exist only on prod',
  (SELECT count(*) FROM public.stack_coverage() WHERE stack_id !~ '^SX') = 64
  AND NOT EXISTS (SELECT 1 FROM public.stack_coverage() WHERE stack_id !~ '^SX' AND (coverage <> 0 OR n_needs = 0)));

INSERT INTO public.stack_substrates (substrate, note, source, registered_by) VALUES
  ('fx declared', 'fixture', 'test', 'test'), ('fx undeclared', 'fixture', 'test', 'test');
INSERT INTO public.stacks (stack_id, name, question, status, source, registered_by) VALUES
  ('SX1', 'fixture every kind', 'q?', 'measured', 'test', 'test'),
  ('SX2', 'fixture stack needs', 'q?', 'measured', 'test', 'test'),
  ('SX3', 'fixture complete', 'q?', 'measured', 'test', 'test'),
  ('SX4', 'fixture half', 'q?', 'measured', 'test', 'test'),
  ('SX5', 'fixture none', 'q?', 'measured', 'test', 'test'),
  ('SX6', 'fixture no needs', 'q?', 'proposed', 'test', 'test'),
  ('SX7', 'fixture only stack needs', 'q?', 'proposed', 'test', 'test'),
  ('SX8', 'fixture needs a stack of stacks', 'q?', 'proposed', 'test', 'test');
INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, fresh_within) VALUES
  ('SX1', 1, 'log',       'table',    'fx_log',             NULL, NULL),
  ('SX1', 1, 'log',       'table',    'fx_empty',           NULL, NULL),
  ('SX1', 1, 'log',       'table',    'fx_absent',          NULL, NULL),
  ('SX1', 1, 'fold',      'table',    'fx_fold_owned',      NULL, NULL),
  ('SX1', 1, 'fold',      'table',    'fx_fold_unowned',    NULL, NULL),
  ('SX1', 1, 'key',       'column',   'fx_log.fk_full',     NULL, NULL),
  ('SX1', 1, 'key',       'column',   'fx_log.fk_thin',     NULL, NULL),
  ('SX1', 1, 'key',       'column',   'fx_log.nofk_full',   NULL, NULL),
  ('SX1', 1, 'dimension', 'column',   'fx_log.nofk_full',   NULL, NULL),
  ('SX1', 1, 'key',       'column',   'fx_log.fk_ratio',    'fx_log.ratio_text', NULL),
  ('SX1', 1, 'dimension', 'column',   'fx_log.fk_ratio',    NULL, NULL),
  ('SX1', 1, 'key',       'column',   'fx_log.after_analyze', NULL, NULL),
  ('SX1', 1, 'key',       'column',   'fx_log.no_such_col', NULL, NULL),
  ('SX1', 1, 'key',       'column',   'fx_nope.col',        NULL, NULL),
  ('SX1', 1, 'log',       'intake',   'fx_log.made_at',     NULL, '2 days'),
  ('SX1', 1, 'log',       'intake',   'fx_old.made_at',     NULL, '14 days'),
  ('SX1', 1, 'log',       'intake',   'fx_empty.made_at',   NULL, '1 day'),
  ('SX1', 1, 'log',       'intake',   'fx_log.label',       NULL, '1 day'),
  ('SX1', 1, 'log',       'intake',   'fx_log.nope',        NULL, '1 day'),
  ('SX1', 1, 'feature',   'function', 'stack_coverage',     NULL, NULL),
  ('SX1', 1, 'feature',   'function', 'no_such_function',   NULL, NULL),
  ('SX1', 1, 'dimension', 'abstract', 'fx declared',        NULL, NULL),
  ('SX1', 1, 'dimension', 'abstract', 'fx undeclared',      NULL, NULL),
  ('SX2', 1, 'feature',   'stack',    'SX3',                NULL, NULL),
  ('SX2', 1, 'feature',   'stack',    'SX4',                NULL, NULL),
  ('SX2', 1, 'feature',   'stack',    'SX5',                NULL, NULL),
  ('SX2', 1, 'feature',   'stack',    'SZZ',                NULL, NULL),
  ('SX3', 1, 'log',       'table',    'fx_log',             NULL, NULL),
  ('SX4', 1, 'log',       'table',    'fx_log',             NULL, NULL),
  ('SX4', 1, 'log',       'table',    'fx_absent',          NULL, NULL),
  ('SX5', 1, 'log',       'table',    'fx_absent',          NULL, NULL),
  ('SX7', 1, 'feature',   'stack',    'SX3',                NULL, NULL),
  ('SX8', 1, 'feature',   'stack',    'SX7',                NULL, NULL);

CREATE TEMP TABLE got AS
SELECT e.value ->> 'layer' AS layer, e.value ->> 'object' AS object, e.value ->> 'verdict' AS verdict,
       e.value -> 'evidence' AS evidence, e.ord
FROM public.stack_coverage('SX1') c
CROSS JOIN LATERAL jsonb_array_elements(c.needs) WITH ORDINALITY AS e(value, ord);
SELECT pg_temp.ok('every kind resolves as specified (' || coalesce((
    SELECT string_agg(coalesce(w.layer || ':' || w.object, g.layer || ':' || g.object) || ' got ' || coalesce(g.verdict, 'no row')
                      || ' want ' || coalesce(w.verdict, 'no row'), '; ')
    FROM (VALUES
      ('log', 'fx_log', 'present'), ('log', 'fx_empty', 'partial'), ('log', 'fx_absent', 'missing'),
      ('fold', 'fx_fold_owned', 'present'), ('fold', 'fx_fold_unowned', 'partial'),
      ('key', 'fx_log.fk_full', 'present'), ('key', 'fx_log.fk_thin', 'partial'), ('key', 'fx_log.nofk_full', 'partial'),
      ('dimension', 'fx_log.nofk_full', 'present'), ('key', 'fx_log.fk_ratio', 'present'),
      ('dimension', 'fx_log.fk_ratio', 'partial'), ('key', 'fx_log.after_analyze', 'partial'),
      ('key', 'fx_log.no_such_col', 'missing'), ('key', 'fx_nope.col', 'missing'),
      ('log', 'fx_log.made_at', 'present'), ('log', 'fx_old.made_at', 'partial'), ('log', 'fx_empty.made_at', 'partial'),
      ('log', 'fx_log.label', 'missing'), ('log', 'fx_log.nope', 'missing'),
      ('feature', 'stack_coverage', 'present'), ('feature', 'no_such_function', 'missing'),
      ('dimension', 'fx declared', 'missing'), ('dimension', 'fx undeclared', 'missing')) AS w(layer, object, verdict)
    FULL JOIN got g ON g.layer = w.layer AND g.object = w.object
    WHERE g.verdict IS DISTINCT FROM w.verdict), 'all match') || ')',
  NOT EXISTS (
    SELECT 1 FROM (VALUES
      ('log', 'fx_log', 'present'), ('log', 'fx_empty', 'partial'), ('log', 'fx_absent', 'missing'),
      ('fold', 'fx_fold_owned', 'present'), ('fold', 'fx_fold_unowned', 'partial'),
      ('key', 'fx_log.fk_full', 'present'), ('key', 'fx_log.fk_thin', 'partial'), ('key', 'fx_log.nofk_full', 'partial'),
      ('dimension', 'fx_log.nofk_full', 'present'), ('key', 'fx_log.fk_ratio', 'present'),
      ('dimension', 'fx_log.fk_ratio', 'partial'), ('key', 'fx_log.after_analyze', 'partial'),
      ('key', 'fx_log.no_such_col', 'missing'), ('key', 'fx_nope.col', 'missing'),
      ('log', 'fx_log.made_at', 'present'), ('log', 'fx_old.made_at', 'partial'), ('log', 'fx_empty.made_at', 'partial'),
      ('log', 'fx_log.label', 'missing'), ('log', 'fx_log.nope', 'missing'),
      ('feature', 'stack_coverage', 'present'), ('feature', 'no_such_function', 'missing'),
      ('dimension', 'fx declared', 'missing'), ('dimension', 'fx undeclared', 'missing')) AS w(layer, object, verdict)
    FULL JOIN got g ON g.layer = w.layer AND g.object = w.object
    WHERE g.verdict IS DISTINCT FROM w.verdict));
SELECT pg_temp.ok('coverage = present / needs: 7 present, 8 partial, 8 missing of 23 is 0.3043',
  (SELECT coverage = 0.3043 AND n_needs = 23 AND n_present = 7 AND n_partial = 8 AND n_missing = 8 AND measured_at = now()
   FROM public.stack_coverage('SX1')));
SELECT pg_temp.ok('column evidence: fills 0.95, 0.5, 1 and 0.92 over the denominator; foreign keys as declared; reasons',
  (SELECT (evidence ->> 'fill')::numeric = 0.95 AND (evidence ->> 'foreign_key')::boolean FROM got WHERE layer = 'key' AND object = 'fx_log.fk_full')
  AND (SELECT (evidence ->> 'fill')::numeric = 0.5 AND evidence ->> 'reason' = 'filled below 0.9' FROM got WHERE layer = 'key' AND object = 'fx_log.fk_thin')
  AND (SELECT (evidence ->> 'fill')::numeric = 1 AND NOT (evidence ->> 'foreign_key')::boolean
              AND evidence ->> 'reason' = 'a key column with no foreign key' FROM got WHERE layer = 'key' AND object = 'fx_log.nofk_full')
  AND (SELECT (evidence ->> 'fill')::numeric = 0.92 AND evidence ->> 'denominator' = 'fx_log.ratio_text'
         FROM got WHERE layer = 'key' AND object = 'fx_log.fk_ratio')
  AND (SELECT (evidence ->> 'fill')::numeric = 0.46 FROM got WHERE layer = 'dimension' AND object = 'fx_log.fk_ratio')
  AND (SELECT evidence ->> 'reason' = 'no planner statistics for the column' FROM got WHERE object = 'fx_log.after_analyze')
  AND (SELECT evidence ->> 'reason' = 'no such column' FROM got WHERE object = 'fx_log.no_such_col')
  AND (SELECT evidence ->> 'reason' = 'no such table' FROM got WHERE object = 'fx_nope.col'));
SELECT pg_temp.ok('table evidence: rows, owners and reasons from the atlas',
  (SELECT (evidence ->> 'est_rows')::int = 100 FROM got WHERE layer = 'log' AND object = 'fx_log')
  AND (SELECT evidence ->> 'reason' = 'no rows by the planner estimate' FROM got WHERE layer = 'log' AND object = 'fx_empty')
  AND (SELECT evidence ->> 'reason' = 'no such table' FROM got WHERE object = 'fx_absent')
  AND (SELECT evidence -> 'owners' = '["fx_writer"]'::jsonb FROM got WHERE object = 'fx_fold_owned')
  AND (SELECT evidence ->> 'reason' = 'no owner declared in pipeline_registry' FROM got WHERE object = 'fx_fold_unowned')
  AND (SELECT evidence ->> 'reason' = 'no table declared for this substrate' FROM got WHERE object = 'fx undeclared'));
SELECT pg_temp.ok('intake evidence: newest clock, window, index and reasons',
  (SELECT (evidence ->> 'newest')::timestamptz BETWEEN now() - interval '62 minutes' AND now() - interval '60 minutes'
          AND (evidence ->> 'indexed')::boolean AND evidence ->> 'fresh_within' = '2 days' AND NOT evidence ? 'reason'
   FROM got WHERE object = 'fx_log.made_at')
  AND (SELECT evidence ->> 'reason' = 'newest row is older than the window' AND NOT (evidence ->> 'indexed')::boolean
       FROM got WHERE object = 'fx_old.made_at')
  AND (SELECT evidence ->> 'reason' = 'no rows' FROM got WHERE object = 'fx_empty.made_at')
  AND (SELECT evidence ->> 'reason' = 'the column is not a timestamp or date' FROM got WHERE object = 'fx_log.label')
  AND (SELECT evidence ->> 'reason' = 'no such table or column' FROM got WHERE object = 'fx_log.nope'));
SELECT pg_temp.ok('needs come in layer order, then object in byte order',
  (SELECT array_agg(layer ORDER BY ord) FROM got)
  = (SELECT array_agg(layer ORDER BY array_position(ARRAY['log', 'key', 'dimension', 'fold', 'baseline', 'residual',
                                                          'feature', 'prediction', 'outcome'], layer), object COLLATE "C") FROM got)
  AND (SELECT array_agg(object ORDER BY ord) FROM got WHERE layer = 'log')
    = ARRAY['fx_absent', 'fx_empty', 'fx_empty.made_at', 'fx_log', 'fx_log.label', 'fx_log.made_at', 'fx_log.nope',
            'fx_old.made_at']);

SELECT pg_temp.ok('stack needs read one level down: SX3 complete is present, SX4 half is partial, SX5 none and SZZ unknown are missing',
  (SELECT array_agg(e.value ->> 'object' || ':' || (e.value ->> 'verdict') ORDER BY e.value ->> 'object')
   FROM public.stack_coverage('SX2') c CROSS JOIN LATERAL jsonb_array_elements(c.needs) e)
  = ARRAY['SX3:present', 'SX4:partial', 'SX5:missing', 'SZZ:missing']
  AND (SELECT coverage = 0.25 FROM public.stack_coverage('SX2'))
  AND (SELECT e.value -> 'evidence' ->> 'reason' = 'no such stack'
       FROM public.stack_coverage('SX2') c CROSS JOIN LATERAL jsonb_array_elements(c.needs) e WHERE e.value ->> 'object' = 'SZZ')
  AND (SELECT (e.value -> 'evidence' ->> 'coverage')::numeric = 0.5
       FROM public.stack_coverage('SX2') c CROSS JOIN LATERAL jsonb_array_elements(c.needs) e WHERE e.value ->> 'object' = 'SX4'));
SELECT pg_temp.ok('a stack whose own needs are only stacks reads as missing to its dependents, with the reason',
  (SELECT e.value ->> 'verdict' = 'missing' AND e.value -> 'evidence' ->> 'reason' = 'the stack has no needs other than stacks'
   FROM public.stack_coverage('SX8') c CROSS JOIN LATERAL jsonb_array_elements(c.needs) e)
  AND (SELECT coverage = 1 FROM public.stack_coverage('SX7')));
SELECT pg_temp.ok('a stack with no needs has NULL coverage, zero counts and an empty list',
  (SELECT coverage IS NULL AND n_needs = 0 AND n_present = 0 AND n_missing = 0 AND needs = '[]'::jsonb
   FROM public.stack_coverage('SX6')));
SELECT pg_temp.ok('stack_coverage(NULL) reads every stack once; an unknown id reads nothing',
  (SELECT count(*) = count(DISTINCT stack_id) AND count(*) = 72 FROM public.stack_coverage())
  AND NOT EXISTS (SELECT 1 FROM public.stack_coverage('SNOPE')));

-- A new version replaces the old one in every reading, and its dependents move with it.
INSERT INTO public.stacks (stack_id, version, name, question, status, source, registered_by, supersedes_version)
VALUES ('SX4', 2, 'fixture half', 'q?', 'building', 'test', 'test', 1);
INSERT INTO public.stack_needs (stack_id, version, layer, kind, object) VALUES ('SX4', 2, 'log', 'table', 'fx_log');
SELECT pg_temp.ok('the latest version is the one measured; SX2 now sees SX4 present',
  (SELECT version = 2 AND coverage = 1 AND n_needs = 1 FROM public.stack_coverage('SX4'))
  AND (SELECT coverage = 0.5 FROM public.stack_coverage('SX2'))
  AND (SELECT count(*) = 1 FROM public.v_stacks WHERE stack_id = 'SX4' AND version = 2 AND status = 'building'));

-- A declaration moves every need on the substrate, with no new stack version.
UPDATE public.stack_substrates SET declared_table = 'fx_log', declared_at = now(), declared_by = 'test'
WHERE substrate = 'fx declared';
UPDATE public.stack_substrates SET declared_table = 'fx_absent_table', declared_at = now(), declared_by = 'test'
WHERE substrate = 'fx undeclared';
SELECT pg_temp.ok('declaring a table for a substrate turns its needs present (8 of 23 = 0.3478); a declared table that does not exist stays missing',
  (SELECT coverage = 0.3478 AND n_present = 8 AND n_missing = 7 FROM public.stack_coverage('SX1'))
  AND (SELECT e.value ->> 'verdict' = 'present' AND e.value -> 'evidence' ->> 'declared_table' = 'fx_log'
       FROM public.stack_coverage('SX1') c CROSS JOIN LATERAL jsonb_array_elements(c.needs) e WHERE e.value ->> 'object' = 'fx declared')
  AND (SELECT e.value ->> 'verdict' = 'missing' AND e.value -> 'evidence' ->> 'reason' = 'no such table'
       FROM public.stack_coverage('SX1') c CROSS JOIN LATERAL jsonb_array_elements(c.needs) e WHERE e.value ->> 'object' = 'fx undeclared'));

-- The reader -----------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('v_stacks: one row per stack at its latest version, the function''s numbers, missing and partial objects in order',
  (SELECT count(*) = 72 AND count(DISTINCT stack_id) = 72 FROM public.v_stacks)
  AND (SELECT coverage = 0.3478 AND n_needs = 23 AND n_present = 8 AND n_partial = 8 AND n_missing = 7
              AND needs_missing = ARRAY['fx_absent', 'fx_log.label', 'fx_log.nope', 'fx_log.no_such_col', 'fx_nope.col',
                                        'fx undeclared', 'no_such_function']
              AND needs_partial = ARRAY['fx_empty', 'fx_empty.made_at', 'fx_old.made_at', 'fx_log.after_analyze',
                                        'fx_log.fk_thin', 'fx_log.nofk_full', 'fx_log.fk_ratio', 'fx_fold_unowned']
              AND measured_at = now()
       FROM public.v_stacks WHERE stack_id = 'SX1')
  AND (SELECT name = 'Bidder record as of a date' AND thesis_vein_id = 'V012' AND thesis_vein_version = 1
       FROM public.v_stacks WHERE stack_id = 'S03')
  AND (SELECT needs_missing = ARRAY['place entity'] AND n_needs = 1 FROM public.v_stacks WHERE stack_id = 'S01'));

-- Access ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION pg_temp.acl(rel regclass) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ','
                             ORDER BY coalesce(r.rolname, 'PUBLIC'), x.privilege_type), 'none')
  FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x LEFT JOIN pg_roles r ON r.oid = x.grantee
  WHERE c.oid = rel AND x.grantee <> c.relowner
$$;
SELECT pg_temp.ok('ACL: SELECT for service_role only on the three tables and the view (got '
    || pg_temp.acl('public.stacks') || ' / ' || pg_temp.acl('public.stack_needs') || ' / '
    || pg_temp.acl('public.stack_substrates') || ' / ' || pg_temp.acl('public.v_stacks') || ')',
  pg_temp.acl('public.stacks') = 'service_role:SELECT' AND pg_temp.acl('public.stack_needs') = 'service_role:SELECT'
  AND pg_temp.acl('public.stack_substrates') = 'service_role:SELECT' AND pg_temp.acl('public.v_stacks') = 'service_role:SELECT');
SELECT pg_temp.ok('ACL: EXECUTE on stack_coverage for service_role only, PUBLIC included in the revoke',
  (SELECT string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ',')
   FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) x LEFT JOIN pg_roles r ON r.oid = x.grantee
   WHERE p.oid = 'public.stack_coverage(text)'::regprocedure AND x.grantee <> p.proowner) = 'service_role:EXECUTE');
SELECT pg_temp.ok('RLS is on for the three tables, with no policy',
  (SELECT bool_and(relrowsecurity) FROM pg_class
   WHERE oid IN ('public.stacks'::regclass, 'public.stack_needs'::regclass, 'public.stack_substrates'::regclass))
  AND NOT EXISTS (SELECT 1 FROM pg_policy
                  WHERE polrelid IN ('public.stacks'::regclass, 'public.stack_needs'::regclass, 'public.stack_substrates'::regclass)));
DO $$
DECLARE
  n_view bigint;
  n_fn bigint;
  denied text := '';
  r text;
  stmt text;
BEGIN
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO n_view FROM public.v_stacks;
  SELECT count(*) INTO n_fn FROM public.stack_coverage();
  RESET ROLE;
  PERFORM pg_temp.ok('service_role reads v_stacks and calls stack_coverage (' || n_view || ', ' || n_fn || ' rows)',
    n_view = 72 AND n_fn = 72);
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH stmt IN ARRAY ARRAY['SELECT 1 FROM public.v_stacks LIMIT 1', 'SELECT 1 FROM public.stack_coverage() LIMIT 1',
                                'SELECT 1 FROM public.stacks LIMIT 1', 'SELECT 1 FROM public.stack_needs LIMIT 1',
                                'SELECT 1 FROM public.stack_substrates LIMIT 1'] LOOP
      BEGIN
        EXECUTE format('SET LOCAL ROLE %I', r);
        EXECUTE stmt;
        RESET ROLE;
        RAISE EXCEPTION 'Contract failed: % could run: %', r, stmt;
      EXCEPTION WHEN insufficient_privilege THEN
        RESET ROLE;
        denied := denied || '.';
      END;
    END LOOP;
  END LOOP;
  PERFORM pg_temp.ok('anon and authenticated are refused on the view, the function and the three tables', length(denied) = 10);
END $$;

-- Version 2 of SA, the stack as a page (20261007040000) -------------------------------------------------------------
-- Applied after the registry, as CI does on prod. Checks: the version row, its full need list across the nine layers,
-- the two new substrates, the reader taking the latest version, and the replay adding nothing.
RESET ROLE;
\ir ../migrations/20261007040000_stack_sa_v2_showable.sql
SELECT pg_temp.ok('SA v2: showable, supersedes 1, nine path entries, same name and question as v1; v1 untouched',
  (SELECT count(*) FROM public.stacks WHERE stack_id = 'SA') = 2
  AND (SELECT status = 'showable' AND supersedes_version = 1 AND cardinality(path) = 9
         AND name = 'The auction as an order book' AND source LIKE 'PR #724%'
       FROM public.stacks WHERE stack_id = 'SA' AND version = 2)
  AND (SELECT s2.question = s1.question AND s2.scoring = s1.scoring
       FROM public.stacks s1 JOIN public.stacks s2 ON s2.stack_id = s1.stack_id
       WHERE s1.stack_id = 'SA' AND s1.version = 1 AND s2.version = 2)
  AND (SELECT status = 'measured' FROM public.stacks WHERE stack_id = 'SA' AND version = 1)
  AND (SELECT count(*) FROM public.stack_needs WHERE stack_id = 'SA' AND version = 1) = 5);
SELECT pg_temp.ok('SA v2 carries 16 needs over all nine layers, every abstract need on a registered substrate, the two new substrates undeclared',
  (SELECT count(*) FROM public.stack_needs WHERE stack_id = 'SA' AND version = 2) = 16
  AND (SELECT count(DISTINCT layer) FROM public.stack_needs WHERE stack_id = 'SA' AND version = 2) = 9
  AND NOT EXISTS (SELECT 1 FROM public.stack_needs n LEFT JOIN public.stack_substrates g ON g.substrate = n.object
                  WHERE n.stack_id = 'SA' AND n.version = 2 AND n.kind = 'abstract' AND g.substrate IS NULL)
  AND (SELECT count(*) FROM public.stack_substrates
       WHERE substrate IN ('order book fold per lot per minute', 'cohort demand curve by minutes to close')
         AND declared_table IS NULL AND declared_at IS NULL) = 2);
SELECT pg_temp.ok('the reader takes SA at version 2 with 16 needs, and the function grades all 16',
  (SELECT version = 2 AND n_needs = 16 AND status = 'showable' FROM public.v_stacks WHERE stack_id = 'SA')
  AND (SELECT n_present + n_partial + n_missing = 16 FROM public.stack_coverage('SA')));
\ir ../migrations/20261007040000_stack_sa_v2_showable.sql
SELECT pg_temp.ok('re-applying the version file adds nothing',
  (SELECT count(*) FROM public.stacks WHERE stack_id = 'SA') = 2
  AND (SELECT count(*) FROM public.stack_needs WHERE stack_id = 'SA') = 21
  AND (SELECT count(*) FROM public.stack_substrates
       WHERE substrate IN ('order book fold per lot per minute', 'cohort demand curve by minutes to close')) = 2);

-- Stack S61 version 1, funding opportunity fit (20261007121000) ---------------------------------------------------------
-- Applied after SA v2. Checks: the version row, its 13 abstract needs across the nine layers, the twelve new substrates
-- (undeclared) beside the reused place entity, the reader and the function at version 1 (every need missing), SA
-- untouched, and the replay adding nothing.
RESET ROLE;
CREATE TEMP TABLE s61_new_substrates (substrate text PRIMARY KEY);
INSERT INTO s61_new_substrates VALUES ('funding award observations'), ('awardee organization key'), ('research institution key'), ('person subject'),
  ('funding program and phase'), ('funding topic code'), ('awards per organization per year'),
  ('award baseline by state, topic and year'), ('applicant distance from award winners'),
  ('funding criteria coverage for an applicant'), ('funding invitation probability'), ('pitch result');
SELECT pg_temp.ok('before S61: none of its new substrates is registered, place entity is',
  NOT EXISTS (SELECT 1 FROM public.stack_substrates g JOIN s61_new_substrates n USING (substrate))
  AND EXISTS (SELECT 1 FROM public.stack_substrates WHERE substrate = 'place entity'));
\ir ../migrations/20261007121000_stack_s61_funding_fit.sql
SELECT pg_temp.ok('S61 v1: measured, family the machine''s economics, nine path entries in layer order, no thesis, no earlier version',
  (SELECT count(*) FROM public.stacks WHERE stack_id = 'S61') = 1
  AND (SELECT status = 'measured' AND name = 'Funding opportunity fit' AND family = 'the machine''s economics' AND cardinality(path) = 9
         AND path[1] LIKE 'log:%' AND path[9] LIKE 'outcome:%' AND thesis_vein_id IS NULL AND supersedes_version IS NULL
         AND cardinality(external_dimensions) = 2 AND who_cares IS NOT NULL AND scoring IS NOT NULL
       FROM public.stacks WHERE stack_id = 'S61' AND version = 1));
SELECT pg_temp.ok('S61 carries 13 needs over all nine layers, all abstract, every one on a registered substrate',
  (SELECT count(*) FROM public.stack_needs WHERE stack_id = 'S61' AND version = 1) = 13
  AND (SELECT count(DISTINCT layer) FROM public.stack_needs WHERE stack_id = 'S61' AND version = 1) = 9
  AND (SELECT count(*) FROM public.stack_needs WHERE stack_id = 'S61' AND kind = 'abstract') = 13
  AND (SELECT layer FROM public.stack_needs WHERE stack_id = 'S61' AND object = 'funding award observations') = 'log'
  AND NOT EXISTS (SELECT 1 FROM public.stack_needs n LEFT JOIN public.stack_substrates g ON g.substrate = n.object
                  WHERE n.stack_id = 'S61' AND n.kind = 'abstract' AND g.substrate IS NULL));
SELECT pg_temp.ok('the twelve new substrates are registered undeclared, and place entity is reused, not duplicated',
  (SELECT count(*) FROM public.stack_substrates g JOIN s61_new_substrates n USING (substrate)
    WHERE g.declared_table IS NULL AND g.declared_at IS NULL AND g.registered_by LIKE 'claude-code%night-expansion%') = 12
  AND (SELECT count(*) FROM public.stack_substrates WHERE substrate = 'place entity') = 1);
SELECT pg_temp.ok('the reader takes S61 at version 1 with 13 needs; the function reads 0 of 13, every need missing',
  (SELECT version = 1 AND n_needs = 13 AND status = 'measured' FROM public.v_stacks WHERE stack_id = 'S61')
  AND (SELECT coverage = 0 AND n_present = 0 AND n_partial = 0 AND n_missing = 13 FROM public.stack_coverage('S61'))
  AND (SELECT count(*) = 13 FROM public.stack_coverage('S61') c, jsonb_array_elements(c.needs) e
        WHERE e ->> 'kind' = 'abstract' AND e ->> 'verdict' = 'missing'));
SELECT pg_temp.ok('S61 leaves SA as it was',
  (SELECT count(*) FROM public.stacks WHERE stack_id = 'SA') = 2
  AND (SELECT count(*) FROM public.stack_needs WHERE stack_id = 'SA') = 21);
\ir ../migrations/20261007121000_stack_s61_funding_fit.sql
SELECT pg_temp.ok('re-applying the S61 file adds nothing',
  (SELECT count(*) FROM public.stacks WHERE stack_id = 'S61') = 1
  AND (SELECT count(*) FROM public.stack_needs WHERE stack_id = 'S61') = 13
  AND (SELECT count(*) FROM public.stack_substrates g JOIN s61_new_substrates n USING (substrate)) = 12);

-- Version 3 of SA, the prediction layer partial (20261007200000) ----------------------------------------------------
RESET ROLE;
\ir ../migrations/20261007200000_stack_sa_v3_prediction_partial.sql
SELECT pg_temp.ok('SA v3: showable, supersedes 2, nine path entries, same name and question; v2 untouched with 16 needs',
  (SELECT count(*) FROM public.stacks WHERE stack_id = 'SA') = 3
  AND (SELECT status = 'showable' AND supersedes_version = 2 AND cardinality(path) = 9
       FROM public.stacks WHERE stack_id = 'SA' AND version = 3)
  AND (SELECT s3.name = s2.name AND s3.question = s2.question AND s3.scoring = s2.scoring
       FROM public.stacks s2 JOIN public.stacks s3 ON s3.stack_id = s2.stack_id
       WHERE s2.stack_id = 'SA' AND s2.version = 2 AND s3.version = 3)
  AND (SELECT count(*) FROM public.stack_needs WHERE stack_id = 'SA' AND version = 2) = 16);
SELECT pg_temp.ok('SA v3 carries 18 needs: the 16 of v2 plus the reader function and the lot key column',
  (SELECT count(*) FROM public.stack_needs WHERE stack_id = 'SA' AND version = 3) = 18
  AND EXISTS (SELECT 1 FROM public.stack_needs WHERE stack_id = 'SA' AND version = 3 AND layer = 'prediction' AND kind = 'function' AND object = 'live_lot_temperature_at')
  AND EXISTS (SELECT 1 FROM public.stack_needs WHERE stack_id = 'SA' AND version = 3 AND layer = 'outcome' AND kind = 'column' AND object = 'hammer_predictions.auction_event_id'));
SELECT pg_temp.ok('the reader takes SA at version 3 with 18 needs, and the function grades all 18',
  (SELECT version = 3 AND n_needs = 18 AND status = 'showable' FROM public.v_stacks WHERE stack_id = 'SA')
  AND (SELECT n_present + n_partial + n_missing = 18 FROM public.stack_coverage('SA')));
\ir ../migrations/20261007200000_stack_sa_v3_prediction_partial.sql
SELECT pg_temp.ok('re-applying the v3 file adds nothing',
  (SELECT count(*) FROM public.stacks WHERE stack_id = 'SA') = 3
  AND (SELECT count(*) FROM public.stack_needs WHERE stack_id = 'SA') = 39);

SELECT pg_temp.ok('done: stack registry contract', true);
