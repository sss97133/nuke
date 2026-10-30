-- books_gate_md5 walks what the gate reads instead of hashing a fixed list.
--
-- WHY. books_gate_md5() (migration 20261106110000) hashed five functions and four root views plus the views beneath them. Checked against the
-- live catalog, books_year_gate depends on four more objects that the hash never saw, so an edit to any of them left a stored pass looking fresh:
--   v_books_direction_checks   a view the gate names that no view under the roots reads
--   books_macrs_pct            a function v_books_asset_register calls (the walk followed views only)
--   books_eic_amount           a helper books_eic_recompute calls
--   accounting_return_drafts   a reader books_year_state calls
--
-- WHAT. The hash starts at books_year_gate (every overload) and follows two edges. Nothing is listed, so a view or helper the gate starts to read
-- is covered the day it does.
--   By name.    A books_* / accounting_* function, or a v_books_* / v_accounting_* / v_financial_* view, that a function's source names. A function
--               body is opaque to the dependency catalog, so its source is the only place that says what it reads.
--   By catalog. The views and the public functions that a view's stored rule depends on (pg_depend), however deep.
-- A name in a comment counts too: that errs toward stale, never toward trusted. A body declared with BEGIN ATOMIC is hashed as well (prosqlbody).
-- The signature, the grants and the NULL for a book with no gate are the same, so this is a CREATE OR REPLACE. The hash value changes: a run recorded
-- before this migration reads stale once, and the recorder files the next one (it runs after the last landing).
--
-- EVIDENCE (read-only prod, 2026-10-29, the body below run inline): the walk from books_year_gate reaches 17 definitions (8 functions, 9 views,
-- 1.2 MB with the rule trees); the same md5 on two runs; 51 ms server-side as the signed-in role, walk included (the list took 15 ms for 12). It
-- reaches v_books_vehicle_links, which migration 20261105200000 added under v_books_audit_tiers and v_books_large_sums.
-- CONTRACT. supabase/sql/test_books_gate_runs.sql: a view only the gate names, a function a view calls, a helper a reader names, an unrelated function
-- of the families (no change), and a new view first read by two named views (no change while unread, a change when each starts to read it and when it
-- is edited). The previous hash fails the first of these.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.books_gate_md5()
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  -- What the gate is made of, found from the gate itself: the walk starts at books_year_gate (every overload) and follows two kinds of edge.
  --   By name. A function body is opaque to the dependency catalog, so its source is the only place that says what it reads: a books_* or
  --   accounting_* function, or a v_books_* / v_accounting_* / v_financial_* view, that a function's source names is part of the gate.
  --   By catalog. A view's stored rule depends on the views it reads and the public functions it calls (books_macrs_pct): both are part of the gate.
  -- Nothing is listed here, so a helper or view the gate starts to read is covered the day it does (a name in a comment counts too: that errs toward
  -- stale, never toward trusted). A rule tree is hashed rather than deparsed: a read of the stored trees is 15 ms, a deparse of the same views
  -- 270 ms. A view that is only re-formatted counts as changed, for the same reason. The convention that bounds the walk is the two name families.
  WITH RECURSIVE node(kind, oid) AS (
    SELECT 'f'::text, p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'books_year_gate'
    UNION
    SELECT e.kind, e.oid
    FROM node n
    CROSS JOIN LATERAL (
      SELECT 'f'::text AS kind, q.oid
      FROM pg_proc s JOIN pg_proc q ON q.pronamespace = 'public'::regnamespace AND q.oid <> s.oid AND q.proname ~ '^(books|accounting)_' AND position(q.proname IN s.prosrc) > 0
      WHERE n.kind = 'f' AND s.oid = n.oid
      UNION ALL
      SELECT 'v', c.oid
      FROM pg_proc s JOIN pg_class c ON c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v', 'm')
        AND c.relname ~ '^v_(books|accounting|financial)_' AND position(c.relname IN s.prosrc) > 0
      WHERE n.kind = 'f' AND s.oid = n.oid
      UNION ALL
      SELECT CASE d.refclassid WHEN 'pg_class'::regclass THEN 'v' ELSE 'f' END, d.refobjid
      FROM pg_rewrite rw JOIN pg_depend d ON d.classid = 'pg_rewrite'::regclass AND d.objid = rw.oid AND d.refobjid <> n.oid
      WHERE n.kind = 'v' AND rw.ev_class = n.oid
        AND ((d.refclassid = 'pg_class'::regclass AND EXISTS (SELECT 1 FROM pg_class rc WHERE rc.oid = d.refobjid AND rc.relkind IN ('v', 'm')))
          OR (d.refclassid = 'pg_proc'::regclass AND EXISTS (SELECT 1 FROM pg_proc rp WHERE rp.oid = d.refobjid AND rp.pronamespace = 'public'::regnamespace)))
    ) e
  )
  SELECT CASE WHEN to_regprocedure('public.books_year_gate(uuid,integer)') IS NULL THEN NULL ELSE (
    SELECT md5(string_agg(x.name || ':' || x.body, E'\n' ORDER BY x.name))
    FROM (
      SELECT 'f:' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS name,
             p.prosrc || coalesce(p.prosqlbody::text, '') || coalesce(p.proconfig::text, '') AS body
      FROM node n JOIN pg_proc p ON n.kind = 'f' AND p.oid = n.oid
      UNION ALL
      SELECT 'v:' || c.relname, rw.ev_action::text
      FROM node n JOIN pg_class c ON n.kind = 'v' AND c.oid = n.oid
      JOIN pg_rewrite rw ON rw.ev_class = c.oid AND rw.rulename = '_RETURN'
    ) x) END
$$;
REVOKE ALL ON FUNCTION public.books_gate_md5() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.books_gate_md5() TO authenticated, service_role;
COMMENT ON FUNCTION public.books_gate_md5() IS
  'md5 of what books_year_gate is made of, found from the gate itself: its source; the source of each books_* / accounting_* function a function''s source names; the stored rule tree of each v_books_* / v_accounting_* / v_financial_* view a function''s source names; and, through the dependency catalog, every view and public function those views read or call, however deep. NULL when the gate does not exist. A stored run whose gate_md5 differs ran an older gate, helper or view. A name in a comment counts (errs toward stale). SECURITY INVOKER.';
COMMENT ON COLUMN public.books_gate_runs.gate_md5 IS 'md5 of what the gate was made of when the run started (books_gate_md5()): books_year_gate, the books functions and views its source names, and what those views read and call, however deep. Unit: none (hex). Source: pg_proc, pg_rewrite and pg_depend. Grain: one run. Clock: as of the run start.';
