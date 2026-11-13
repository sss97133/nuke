-- books_gate_runs: the stored result of books_year_gate, one row per run, and the owner-only reader the books docket reads.
--
-- WHY. books_year_gate(owner, year) is the reconciliation gate (rules R1-R10). It takes 15.5 s (2022, owner role), 22.8 s (2023) and
-- more than 30 s (2024, 2025) on prod (read-only, 2026-10-29 about 10:30 PT), and the authenticated role's statement cap is 15 s, so no
-- page can call it. The docket reads a stored run instead, with the time it ran, whether the books have changed since, and whether the
-- gate's own definition has changed since. Nothing here changes the gate.
--
-- WHAT.
--   1. public.books_gate_runs: append-only (vein_append_only), one row per attempt. status complete carries the gate's full output
--      (failing ids and detail text included: owner-only data, never returned by the reader) and a context object: the denominators
--      the gate does not state as structure (the year's deduction dollars, how many deductions have no bank line, the rows and dollars of
--      the head that rule R12 tests), read by books_gate_context in the same repeatable-read transaction as the gate; timed_out and
--      error carry the reason.
--      book_signature is the book's revision when the run started and gate_md5 the md5 of what the gate was made of (item 3), so the reader
--      decides stale in the database, never in the browser.
--      RLS: an owner-only SELECT policy (auth.uid() = owner_id). No anon grant, no write grant to authenticated. The accounting
--      reviewer grant (accounting_access_grants) reads every older accounting reader by design; it does NOT read this store.
--   2. public.books_book_signature(owner): count and latest updated_at of the owner's financial_documents, the same two reads the
--      page's live-revision hook makes, in the same spelling (count:YYYY-MM-DDTHH:MI:SS.USZ; the browser formats its read the same way
--      and a test pins both to this format). The store is separate from financial_documents on purpose: a result written as a
--      register cell would bump the very signature that decides staleness.
--   3. public.books_gate_md5(): md5 of what the gate is made of: the definition of books_year_gate, of the readers it calls
--      (books_year_state, books_eic_recompute, accounting_decision_proof, accounting_current_records) and of the views it reads
--      (v_books_large_sums, v_books_audit_tiers, v_books_asset_register, v_books_direction_links) with every view those read, however
--      deep. R10 and R12 are computed by views, so a migration that changes only a view marks every stored run stale. NULL when the
--      gate does not exist.
--   4. public.record_books_gate_run(...): the only writer. SECURITY INVOKER, EXECUTE for service_role only (the script calls it as
--      the service role after reading the signature and running the gate in one repeatable-read transaction), one write_receipts row.
--   5. public.books_gate_status(owner): SECURITY INVOKER, authenticated and service_role. Raises 42501 for anyone but the owner (a
--      stranger who calls books_year_gate directly gets a successful EMPTY pass; this reader refuses instead). Per tax year (the
--      return drafts, the stored runs and the years that have Expense decisions): the latest complete run with its rules sorted by the database (R1, R2, R2i, R3 ... R10; an unknown
--      id sorts last and is never dropped), each with status, n failing, of checked, amount, plus R5 grades and R10 extras; stale
--      because the books changed or because the gate or a view it reads changed since the run; trusted (passed, fresh, and no rule that
--      checked nothing); the latest attempt (complete, timed_out, error); the newest draft's document id and how many drafts are on
--      file; and the open return items counted by who closes them (owner, cpa, agent, unassigned). Failing ids and detail text are
--      never returned. The Expense decisions are the population the audit tiers count, so the database owns the list of cards and the page
--      invents none. About 1 s, summed from its parts and not yet timed whole: a table read, the drafts reader and one register read (0.2 s),
--      the definition hash (15 ms) and one grouped read of the records view (0.7 s as the owner role).
--
-- EVIDENCE (read-only prod, 2026-10-29): the hash of 12 definitions (1.1 MB of rule trees) takes 15 ms; the grouped year read of the records
-- view takes 0.64 to 0.71 s as the owner role. vein_append_only() and write_receipts exist; auth.uid() and auth.role() read
-- request.jwt.claim.sub / role and request.jwt.claims; financial_documents has no foreign key on owner_id and an index on
-- (owner_id); the roles' statement_timeout: anon 15 s, authenticated 15 s, postgres 10 s, service_role none.
-- CONTRACT. supabase/sql/test_books_gate_runs.sql (synthetic data; anon, stranger and reviewer negative controls).
SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- 1. The store ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.books_gate_runs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       uuid        NOT NULL,
  tax_year       integer     NOT NULL,
  status         text        NOT NULL,
  started_at     timestamptz NOT NULL,
  finished_at    timestamptz NOT NULL,
  duration_ms    integer     NOT NULL,
  book_signature text        NOT NULL,
  gate_md5       text        NOT NULL,
  pass           boolean,
  result         jsonb,
  context        jsonb,
  error          text,
  registered_by  text        NOT NULL,
  CONSTRAINT books_gate_runs_year_check CHECK (tax_year BETWEEN 2000 AND 2100),
  CONSTRAINT books_gate_runs_status_check CHECK (status IN ('complete', 'timed_out', 'error')),
  CONSTRAINT books_gate_runs_clock_check CHECK (finished_at >= started_at AND duration_ms >= 0),
  CONSTRAINT books_gate_runs_outcome_check CHECK (
    (status = 'complete' AND result IS NOT NULL AND pass IS NOT NULL AND error IS NULL
       AND coalesce(jsonb_typeof(result->'rules'), '') = 'array' AND pass IS NOT DISTINCT FROM (result->>'pass')::boolean)
    OR (status <> 'complete' AND result IS NULL AND pass IS NULL AND coalesce(btrim(error), '') <> '')),
  CONSTRAINT books_gate_runs_registered_by_check CHECK (btrim(registered_by) <> ''),
  CONSTRAINT books_gate_runs_context_check CHECK (context IS NULL OR (status = 'complete' AND jsonb_typeof(context) = 'object'))
);
CREATE INDEX IF NOT EXISTS books_gate_runs_owner_year_idx ON public.books_gate_runs (owner_id, tax_year, finished_at DESC);
DROP TRIGGER IF EXISTS books_gate_runs_append_only ON public.books_gate_runs;
CREATE TRIGGER books_gate_runs_append_only BEFORE UPDATE OR DELETE ON public.books_gate_runs
  FOR EACH ROW EXECUTE FUNCTION public.vein_append_only();
ALTER TABLE public.books_gate_runs ENABLE ROW LEVEL SECURITY;
-- Supabase's default privileges give anon and authenticated write bits on a new public table: take everything away first.
REVOKE ALL ON public.books_gate_runs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.books_gate_runs TO authenticated, service_role;
GRANT INSERT ON public.books_gate_runs TO service_role;
DROP POLICY IF EXISTS books_gate_runs_owner_select ON public.books_gate_runs;
CREATE POLICY books_gate_runs_owner_select ON public.books_gate_runs FOR SELECT TO authenticated USING (auth.uid() = owner_id);

COMMENT ON TABLE public.books_gate_runs IS
  'One attempt to run books_year_gate(owner, year), append-only. complete rows hold the gate''s full output in result (failing ids and detail text: owner-only, never returned by books_gate_status); timed_out and error rows hold the reason. book_signature is the book''s revision (books_book_signature) when the run started; gate_md5 is the md5 of the live gate definitions, views included (books_gate_md5): a later difference in either marks the run stale. Written only by record_books_gate_run (service_role). RLS: owner-only SELECT; the accounting reviewer grant does not read it. Migration 20261106110000.';
COMMENT ON COLUMN public.books_gate_runs.owner_id IS 'The book the gate ran on. Unit: none (key). Source: the caller of record_books_gate_run. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.books_gate_runs.tax_year IS 'The tax year the gate ran for (2000-2100). Unit: year. Source: the caller. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.books_gate_runs.status IS 'complete (the gate returned), timed_out (stopped at its statement bound) or error. Unit: none. Source: scripts/books/books_year_gate_check.py --record. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.books_gate_runs.started_at IS 'When the run began. Unit: timestamptz. Source: the script clock. Grain: one run. Clock: run time.';
COMMENT ON COLUMN public.books_gate_runs.finished_at IS 'When the run ended, successfully or not. Unit: timestamptz. Source: the script clock. Grain: one run. Clock: run time.';
COMMENT ON COLUMN public.books_gate_runs.duration_ms IS 'Wall time of the run in milliseconds (a timed_out row carries the bound it hit). Unit: ms. Source: the script. Grain: one run. Clock: run time.';
COMMENT ON COLUMN public.books_gate_runs.book_signature IS 'books_book_signature(owner) read in the same repeatable-read transaction as the gate: the book the gate saw. Unit: none (text count:latest-change). Source: books_book_signature. Grain: one run. Clock: as of the run start.';
COMMENT ON COLUMN public.books_gate_runs.gate_md5 IS 'md5 of what the gate was made of when the run started (books_gate_md5()): books_year_gate, the readers it calls and the views it reads, however deep. Unit: none (hex). Source: pg_proc and pg_rewrite. Grain: one run. Clock: as of the run start.';
COMMENT ON COLUMN public.books_gate_runs.pass IS 'The gate''s own top-level pass: true only when every rule passes (a rule not assessed makes it false). NULL unless status is complete; equals result->pass (CHECK). Unit: boolean. Source: books_year_gate. Grain: one run. Clock: as of the run.';
COMMENT ON COLUMN public.books_gate_runs.result IS 'The full books_year_gate output (rules with n, of, amount, ids, detail). Owner-only: ids and detail embed amounts and local ids. NULL unless status is complete. Unit: none (jsonb). Source: books_year_gate. Grain: one run. Clock: as of the run.';
COMMENT ON COLUMN public.books_gate_runs.context IS 'The denominators of the run, read by books_gate_context in the same repeatable-read transaction as the gate: the year''s deduction dollars and count, the deductions with no bank line and those with no payment proof and no owner ruling (rule R10 part b), and the head rule R12 tests (rows, dollars, the year''s dollars). NULL when the caller gave none or the run did not complete. Unit: none (jsonb of counts and dollars). Source: books_gate_context. Grain: one run. Clock: as of the run.';
COMMENT ON COLUMN public.books_gate_runs.error IS 'Why the run did not complete (timed_out, error). NULL for a complete run. Unit: none (text). Source: the script. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.books_gate_runs.registered_by IS 'Who called the writer (script or session). Unit: none (text). Source: the caller. Grain: one run. Clock: n/a.';

-- 2. The book's revision and the gate's definition ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.books_book_signature(p_owner_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT count(*)::text || ':' || coalesce(to_char(max(d.updated_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '')
  FROM public.financial_documents d WHERE d.owner_id = p_owner_id
$$;
CREATE OR REPLACE FUNCTION public.books_gate_md5()
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  -- What the gate is made of: its own source and that of the readers it calls (every overload), and the stored rule tree of each view it reads
  -- by name plus every view those read (found through pg_depend). A rule tree is hashed rather than deparsed: it is 15 ms, a deparse of the
  -- same views 270 ms. A view that is only re-formatted counts as changed; that errs toward stale, never toward trusted.
  WITH RECURSIVE fn AS MATERIALIZED (
    SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS name, p.prosrc || coalesce(p.proconfig::text, '') AS body
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('books_year_gate', 'books_year_state', 'books_eic_recompute', 'accounting_decision_proof', 'accounting_current_records')
  ), vw(oid) AS (
    SELECT c.oid FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v', 'm')
      AND c.relname IN ('v_books_large_sums', 'v_books_audit_tiers', 'v_books_asset_register', 'v_books_direction_links')
    UNION
    SELECT d.refobjid FROM vw
      JOIN pg_rewrite rw ON rw.ev_class = vw.oid
      JOIN pg_depend d ON d.classid = 'pg_rewrite'::regclass AND d.objid = rw.oid AND d.refclassid = 'pg_class'::regclass AND d.refobjid <> vw.oid
      JOIN pg_class rc ON rc.oid = d.refobjid AND rc.relkind IN ('v', 'm')
  )
  SELECT CASE WHEN to_regprocedure('public.books_year_gate(uuid,integer)') IS NULL THEN NULL ELSE (
    SELECT md5(string_agg(x.name || ':' || x.body, E'\n' ORDER BY x.name))
    FROM (
      SELECT 'f:' || fn.name AS name, fn.body FROM fn
      UNION ALL
      SELECT 'v:' || c.relname, rw.ev_action::text
      FROM pg_class c JOIN pg_rewrite rw ON rw.ev_class = c.oid AND rw.rulename = '_RETURN'
      WHERE c.oid IN (SELECT oid FROM vw)
    ) x) END
$$;
REVOKE ALL ON FUNCTION public.books_book_signature(uuid), public.books_gate_md5() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.books_book_signature(uuid), public.books_gate_md5() TO authenticated, service_role;
COMMENT ON FUNCTION public.books_book_signature(uuid) IS
  'The book''s revision: how many source documents the owner holds and when one last changed (count:latest updated_at as YYYY-MM-DDTHH:MI:SS.USZ, UTC). Every admitted run touches financial_documents.updated_at, so a landing changes it. The browser''s live revision is spelled the same way. SECURITY INVOKER (the book''s row policies apply).';
COMMENT ON FUNCTION public.books_gate_md5() IS
  'md5 of what books_year_gate is made of: its source, the readers it calls (books_year_state, books_eic_recompute, accounting_decision_proof, accounting_current_records) and the rule trees of the views it reads (v_books_large_sums, v_books_audit_tiers, v_books_asset_register, v_books_direction_links) and every view those read. NULL when the gate does not exist. A stored run whose gate_md5 differs ran an older gate or older views. SECURITY INVOKER.';

-- 3. The writer --------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_books_gate_run(
  p_owner_id uuid, p_year integer, p_status text, p_started_at timestamptz, p_finished_at timestamptz,
  p_book_signature text, p_gate_md5 text, p_result jsonb, p_error text, p_registered_by text, p_context jsonb DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_pass boolean;
BEGIN
  IF p_owner_id IS NULL OR p_year IS NULL THEN RAISE EXCEPTION 'owner and year required' USING ERRCODE = 'invalid_parameter_value'; END IF;
  IF coalesce(btrim(p_registered_by), '') = '' THEN
    RAISE EXCEPTION 'record_books_gate_run: p_registered_by must name the caller' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_status = 'complete' THEN
    -- A result belongs to the owner and year it names; one cannot be filed under another book.
    IF p_result IS NULL OR p_result->>'owner_id' IS DISTINCT FROM p_owner_id::text OR p_result->>'year' IS DISTINCT FROM p_year::text THEN
      RAISE EXCEPTION 'record_books_gate_run: the result does not name this owner and year' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_pass := (p_result->>'pass')::boolean;
  END IF;
  IF p_context IS NOT NULL AND (p_status <> 'complete' OR jsonb_typeof(p_context) <> 'object') THEN
    RAISE EXCEPTION 'record_books_gate_run: a context belongs to a complete run and is an object' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO public.books_gate_runs (owner_id, tax_year, status, started_at, finished_at, duration_ms, book_signature, gate_md5, pass, result, context, error, registered_by)
  VALUES (p_owner_id, p_year, p_status, p_started_at, p_finished_at,
          greatest(0, round(extract(epoch FROM (p_finished_at - p_started_at)) * 1000))::integer,
          p_book_signature, p_gate_md5, v_pass, CASE WHEN p_status = 'complete' THEN p_result END, p_context,
          CASE WHEN p_status = 'complete' THEN NULL ELSE p_error END, p_registered_by)
  RETURNING id INTO v_id;
  -- books_gate_runs has no write-receipt trigger; record this writer's statement the way snapshot_stack_coverage does.
  INSERT INTO public.write_receipts (tbl, op, rows, writer, db_role, app_name, txid)
  VALUES ('books_gate_runs', 'INSERT', 1, 'record_books_gate_run', current_user, current_setting('application_name', true), txid_current());
  RETURN v_id;
END
$$;
REVOKE ALL ON FUNCTION public.record_books_gate_run(uuid, integer, text, timestamptz, timestamptz, text, text, jsonb, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_books_gate_run(uuid, integer, text, timestamptz, timestamptz, text, text, jsonb, text, text, jsonb) TO service_role;
COMMENT ON FUNCTION public.record_books_gate_run(uuid, integer, text, timestamptz, timestamptz, text, text, jsonb, text, text, jsonb) IS
  'Sanctioned writer of books_gate_runs (migration 20261106110000): one attempt, one row, one write_receipts row. A complete result must name the owner and year it is filed under. Called by scripts/books/books_year_gate_check.py --record after reading books_book_signature, running the gate and reading books_gate_context in one repeatable-read transaction. SECURITY INVOKER, EXECUTE for service_role only.';

-- 4. The reader --------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.books_gate_status(p_owner_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_sig text;
  v_md5 text;
  v_years jsonb;
  v_sum jsonb;
BEGIN
  IF p_owner_id IS NULL THEN RAISE EXCEPTION 'owner required' USING ERRCODE = 'invalid_parameter_value'; END IF;
  -- Owner-only in the function as well as in the store's policy: a stranger or a reviewer is refused, not handed an empty list.
  IF auth.uid() IS DISTINCT FROM p_owner_id AND current_user NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'the books gate status is the owner''s alone' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_sig := public.books_book_signature(p_owner_id);
  v_md5 := public.books_gate_md5();

  WITH lc AS MATERIALIZED (
    SELECT DISTINCT ON (r.tax_year) r.* FROM public.books_gate_runs r
    WHERE r.owner_id = p_owner_id AND r.status = 'complete'
    ORDER BY r.tax_year, r.finished_at DESC, r.id
  ), la AS MATERIALIZED (
    SELECT DISTINCT ON (r.tax_year) r.tax_year, r.status, r.started_at, r.finished_at, r.duration_ms
    FROM public.books_gate_runs r WHERE r.owner_id = p_owner_id
    ORDER BY r.tax_year, r.finished_at DESC, r.id
  ), dr AS MATERIALIZED (
    SELECT d.tax_year::integer AS tax_year, d.document_id FROM public.accounting_return_drafts(p_owner_id) d
  ), dc AS MATERIALIZED (
    SELECT (e.value_normalized->'value'->>'tax_year')::integer AS tax_year, count(*) AS n
    FROM public.financial_document_extractions e
    WHERE e.owner_id = p_owner_id AND NOT e.is_superseded AND e.field_key = 'tax_return_summary'
      AND e.value_normalized->'value'->>'tax_year' ~ '^[0-9]{4}$'
    GROUP BY 1
  ), oi AS MATERIALIZED (
    -- The same cells books_year_state reads as open_items: current, not retired, status open; actor is the optional who-closes-it key.
    SELECT f.tax_year, count(*) AS total,
           count(*) FILTER (WHERE f.actor = 'owner') AS owner, count(*) FILTER (WHERE f.actor = 'cpa') AS cpa,
           count(*) FILTER (WHERE f.actor = 'agent') AS agent, count(*) FILTER (WHERE f.actor NOT IN ('owner', 'cpa', 'agent')) AS unassigned
    FROM (
      SELECT (regexp_match(e.field_key, '^fact:([0-9]{4}):'))[1]::integer AS tax_year,
             coalesce(nullif(e.value_normalized->'value'->>'actor', ''), 'unassigned') AS actor
      FROM public.financial_document_extractions e
      JOIN public.financial_documents d ON d.id = e.document_id AND d.owner_id = p_owner_id AND d.source_filename = 'return-facts-register.txt'
      WHERE e.owner_id = p_owner_id AND NOT e.is_superseded AND e.field_key ~ '^fact:[0-9]{4}:'
        AND NOT coalesce((e.value_normalized->'value'->>'retired')::boolean, false)
        AND e.value_normalized->'value'->>'status' = 'open'
    ) f GROUP BY f.tax_year
  ), dy AS MATERIALIZED (
    -- Years that have deduction decisions: the Expense decisions with an amount that the audit tiers count (the filter v_books_citation_links uses).
    SELECT DISTINCT v.year::integer AS tax_year
    FROM public.v_financial_accounting_records v
    WHERE v.owner_id = p_owner_id AND v.record_kind = 'retained_ledger_decision' AND v.section = 'Expense' AND v.amount_value IS NOT NULL
      AND coalesce(v.status, '') NOT LIKE 'Closed%' AND coalesce(v.status, '') NOT LIKE 'Open allocation%' AND v.year ~ '^[0-9]{4}$'
  ), yrs AS (
    SELECT tax_year FROM dr UNION SELECT tax_year FROM la UNION SELECT tax_year FROM dy
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'year', y.tax_year,
      'draft_document_id', dr.document_id,
      'drafts_on_file', coalesce(dc.n, 0),
      'attempt', CASE WHEN la.tax_year IS NULL THEN NULL ELSE jsonb_build_object(
        'status', la.status, 'started_at', la.started_at, 'finished_at', la.finished_at, 'duration_ms', la.duration_ms) END,
      'run', CASE WHEN lc.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', lc.id, 'started_at', lc.started_at, 'finished_at', lc.finished_at, 'duration_ms', lc.duration_ms, 'pass', lc.pass,
        'stale', (lc.book_signature IS DISTINCT FROM v_sig OR lc.gate_md5 IS DISTINCT FROM v_md5),
        'stale_books', (lc.book_signature IS DISTINCT FROM v_sig),
        'stale_gate', (lc.gate_md5 IS DISTINCT FROM v_md5),
        'trusted', (lc.pass AND lc.book_signature IS NOT DISTINCT FROM v_sig AND lc.gate_md5 IS NOT DISTINCT FROM v_md5 AND (rc.counts->>'empty')::integer = 0),
        'rule_counts', rc.counts,
        'context', lc.context,
        'rules', rc.rules) END,
      'open_items', jsonb_build_object('total', coalesce(oi.total, 0), 'owner', coalesce(oi.owner, 0), 'cpa', coalesce(oi.cpa, 0),
                                       'agent', coalesce(oi.agent, 0), 'unassigned', coalesce(oi.unassigned, 0))
    ) ORDER BY y.tax_year DESC), '[]'::jsonb)
  INTO v_years
  FROM yrs y
  LEFT JOIN dr ON dr.tax_year = y.tax_year
  LEFT JOIN dc ON dc.tax_year = y.tax_year
  LEFT JOIN la ON la.tax_year = y.tax_year
  LEFT JOIN lc ON lc.tax_year = y.tax_year
  LEFT JOIN oi ON oi.tax_year = y.tax_year
  LEFT JOIN LATERAL (
    -- Rules in the gate's own order: the number after R, then the suffix (R2 before R2i, R8a before R8b); an id with no number sorts last.
    -- Failing ids and detail text are not projected.
    SELECT jsonb_agg(
             jsonb_build_object('rule', x->>'rule', 'title', x->>'title', 'status', x->>'status', 'n', x->'n', 'of', x->'of', 'amount', x->'amount')
             || CASE WHEN x ? 'grades' THEN jsonb_build_object('grades', x->'grades', 'ruling_only', x->'ruling_only') ELSE '{}'::jsonb END
             || CASE WHEN x ? 'tiers' THEN jsonb_build_object('tiers', x->'tiers', 'b_no_bank', x->'b_no_bank', 'excluded', x->'excluded') ELSE '{}'::jsonb END
             -- R12: the head rows that miss a document, by the kind of document, and the flags; the local ids it also holds are not projected.
             || CASE WHEN x ? 'missing_doc' THEN jsonb_build_object('by_flag', x->'by_flag', 'missing_doc', jsonb_build_object(
                  'n', x->'missing_doc'->'n', 'amount', x->'missing_doc'->'amount', 'cite_no_document', x->'missing_doc'->'cite_no_document', 'by_kind', x->'missing_doc'->'by_kind')) ELSE '{}'::jsonb END
             ORDER BY (regexp_match(x->>'rule', '^R([0-9]+)'))[1]::integer NULLS LAST, x->>'rule') AS rules,
           jsonb_build_object('total', count(*),
             'pass', count(*) FILTER (WHERE x->>'status' = 'pass'),
             'fail', count(*) FILTER (WHERE x->>'status' = 'fail'),
             'not_assessed', count(*) FILTER (WHERE x->>'status' NOT IN ('pass', 'fail')),
             -- a rule that passed over a population of zero tested nothing
             'empty', count(*) FILTER (WHERE x->>'status' = 'pass' AND jsonb_typeof(x->'of') = 'number' AND (x->>'of')::numeric = 0)) AS counts
    FROM jsonb_array_elements(lc.result->'rules') x
  ) rc ON lc.id IS NOT NULL;

  SELECT jsonb_build_object(
    'years', count(*),
    'with_run', count(*) FILTER (WHERE jsonb_typeof(y->'run') = 'object'),
    'passed', count(*) FILTER (WHERE jsonb_typeof(y->'run') = 'object' AND (y->'run'->>'pass')::boolean AND NOT (y->'run'->>'stale')::boolean),
    'trusted', count(*) FILTER (WHERE jsonb_typeof(y->'run') = 'object' AND (y->'run'->>'trusted')::boolean),
    'failing', count(*) FILTER (WHERE jsonb_typeof(y->'run') = 'object' AND (y->'run'->'rule_counts'->>'fail')::integer > 0),
    'not_assessed', count(*) FILTER (WHERE jsonb_typeof(y->'run') = 'object' AND (y->'run'->'rule_counts'->>'fail')::integer = 0 AND (y->'run'->'rule_counts'->>'not_assessed')::integer > 0),
    'stale', count(*) FILTER (WHERE jsonb_typeof(y->'run') = 'object' AND (y->'run'->>'stale')::boolean),
    'open_items', coalesce(sum((y->'open_items'->>'total')::integer), 0))
  INTO v_sum
  FROM jsonb_array_elements(v_years) y;

  RETURN jsonb_build_object('owner_id', p_owner_id, 'read_at', now(), 'book_signature', v_sig, 'gate_md5', v_md5, 'summary', v_sum, 'years', v_years);
END
$$;
REVOKE ALL ON FUNCTION public.books_gate_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.books_gate_status(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.books_gate_status(uuid) IS
  'The stored books_year_gate runs, per tax year (return drafts, stored runs and years that have Expense decisions), for the owner only (42501 for anyone else, the accounting reviewer included): the latest complete run with its rules sorted R1..R10 (status, n failing, of checked, amount, R5 grades, R10 and R12 extras, the run''s context of denominators; never failing ids or detail text), stale (books changed since, or the gate or a view it reads changed since), trusted (passed, fresh, no rule that checked nothing), the latest attempt (complete, timed_out, error), the newest draft''s document id with the drafts on file, and open return items by who closes them. Never runs the gate. SECURITY INVOKER; about 1 s, summed from its parts (read-only prod, 2026-10-29, as the owner role).';
