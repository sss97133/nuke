-- mv_family_year_prices_v2 counts two-character model aliases that carry a digit (2026-10-15).
-- Break: the fold's conflict rule keeps only aliases of 3+ characters (`words`: length(n.w) >= 3), so M3, Z3, M5, X5
-- and the like name nothing. A sale whose own page reads "1995-bmw-m3-5-speed" then names its model year but no phrase
-- of its family, and is refused as another car. Measured on the live fold's single-year sold rows, built 18:45Z:
-- BMW M3 902 refused vs 2,667 kept (1995: 133 vs 84), Z3 187 vs 404, M5 133 vs 1,265, X5 104 vs 454. Two-letter
-- words without a digit ("cv", "gt") still name nothing.
-- Applied to skylar-b7's beside copy only (20261016153000), so the live fold never goes unpopulated: the empty, unread
-- mv_family_year_prices_v2 is recreated WITH NO DATA as the live definition with mv_treemap_outcomes read as its _v2
-- copy and this one fragment replaced:
--   (length(n.w) >= 3)  ->  ((length(n.w) >= 3) OR ((length(n.w) = 2) AND (n.w ~ '[0-9]'::text)))
-- Same unique index (mv_family_year_prices_key_v2), grants and comment as the live view. The live view is not touched;
-- the rename swap (#1578) installs this copy. Definitions are compared as Postgres prints them once re-parsed (a view
-- made from deparsed text moves percentile_cont's ARRAY cast inside the array), through a temporary view of each
-- text. Refuses if the copy is populated, read by anything, or not the plain copy of the live fold. Forward-only, no
-- row changes. Contract: supabase/sql/test_family_year_prices_v2_short_alias.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
DO $short$
DECLARE
  c_before CONSTANT text := '(length(n.w) >= 3)';
  c_after  CONSTANT text := '((length(n.w) >= 3) OR ((length(n.w) = 2) AND (n.w ~ ''[0-9]''::text)))';
  live  text;
  plain text;
  want  text;
  copy  text;
  ix    record;
  ddl   text;
  g     record;
BEGIN
  IF to_regclass('public.mv_family_year_prices_v2') IS NULL OR to_regclass('public.mv_treemap_outcomes_v2') IS NULL THEN
    RAISE EXCEPTION 'mv_family_year_prices_v2 and mv_treemap_outcomes_v2 come from 20261016153000; neither may be missing';
  END IF;
  live := pg_get_viewdef('public.mv_family_year_prices'::regclass);
  IF position(c_before IN live) = 0 OR position(c_before IN substr(live, position(c_before IN live) + 1)) > 0 THEN
    RAISE EXCEPTION 'the live fold does not carry the alias rule % exactly once; review before patching', c_before;
  END IF;
  plain := regexp_replace(live, '\mmv_treemap_outcomes\M', 'mv_treemap_outcomes_v2', 'g');
  want  := replace(plain, c_before, c_after);
  -- A view made from deparsed text deparses a little differently (percentile_cont's ARRAY cast moves inside), so
  -- both forms are compared as Postgres prints them once re-parsed: through a temporary view of each text.
  EXECUTE format('CREATE TEMP VIEW fyp_plain AS %s', regexp_replace(plain, ';\s*$', ''));
  EXECUTE format('CREATE TEMP VIEW fyp_want AS %s', regexp_replace(want, ';\s*$', ''));
  plain := pg_get_viewdef('pg_temp.fyp_plain'::regclass);
  want  := pg_get_viewdef('pg_temp.fyp_want'::regclass);
  DROP VIEW pg_temp.fyp_plain;
  DROP VIEW pg_temp.fyp_want;
  copy  := pg_get_viewdef('public.mv_family_year_prices_v2'::regclass);
  IF copy = want THEN
    RAISE NOTICE 'mv_family_year_prices_v2 already counts two-character aliases with a digit';
    RETURN;
  END IF;
  IF copy <> plain THEN
    RAISE EXCEPTION 'mv_family_year_prices_v2 is not the plain copy of the live fold; review before replacing it';
  END IF;
  IF (SELECT relispopulated FROM pg_class WHERE oid = 'public.mv_family_year_prices_v2'::regclass) THEN
    RAISE EXCEPTION 'mv_family_year_prices_v2 is already built; not replacing a populated copy';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite rw ON rw.oid = d.objid
             WHERE d.refobjid = 'public.mv_family_year_prices_v2'::regclass AND rw.ev_class <> d.refobjid) THEN
    RAISE EXCEPTION 'something reads mv_family_year_prices_v2; not dropping it';
  END IF;

  DROP MATERIALIZED VIEW public.mv_family_year_prices_v2;
  EXECUTE format('CREATE MATERIALIZED VIEW public.mv_family_year_prices_v2 AS %s WITH NO DATA', regexp_replace(want, ';\s*$', ''));

  FOR ix IN
    SELECT ic.relname AS name, pg_get_indexdef(i.indexrelid) AS def
    FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
    WHERE i.indrelid = 'public.mv_family_year_prices'::regclass
  LOOP
    ddl := replace(ix.def, format(' INDEX %s ON public.mv_family_year_prices ', quote_ident(ix.name)),
                           format(' INDEX %s ON public.mv_family_year_prices_v2 ', quote_ident(ix.name || '_v2')));
    IF ddl = ix.def THEN RAISE EXCEPTION 'could not name the copy of index % (%)', ix.name, ix.def; END IF;
    EXECUTE ddl;
  END LOOP;

  REVOKE ALL ON public.mv_family_year_prices_v2 FROM PUBLIC, anon, authenticated, service_role;
  FOR g IN
    SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END AS grantee, a.privilege_type
    FROM pg_class cl, aclexplode(cl.relacl) a
    WHERE cl.oid = 'public.mv_family_year_prices'::regclass AND a.grantee <> cl.relowner
  LOOP
    EXECUTE format('GRANT %s ON public.mv_family_year_prices_v2 TO %s', g.privilege_type, g.grantee);
  END LOOP;
  EXECUTE format('COMMENT ON MATERIALIZED VIEW public.mv_family_year_prices_v2 IS %L',
                 coalesce(obj_description('public.mv_family_year_prices'::regclass, 'pg_class'), ''));

  IF pg_get_viewdef('public.mv_family_year_prices_v2'::regclass) <> want THEN
    RAISE EXCEPTION 'mv_family_year_prices_v2 does not deparse as the live fold with the one alias fragment replaced';
  END IF;
END
$short$;
COMMIT;
