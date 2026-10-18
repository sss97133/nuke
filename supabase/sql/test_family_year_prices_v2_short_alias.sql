-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_family_year_prices_v2_short_alias -f this-file.sql
-- Contract for 20261017053000_family_year_prices_v2_short_alias.sql. Synthetic rows only; never production.
-- Runs the whole fold contract first (test_family_year_prices.sql: the live fold built over its fixtures), then makes
-- skylar-b7's beside copy as 20261016153000 does (the live definition reading mv_treemap_outcomes_v2, WITH NO DATA,
-- index <name>_v2, the same grants and comment), adds a BMW M3 sale whose own page reads "1995-bmw-m3-5-speed", and
-- applies the migration twice:
--   * the copy deparses as the live fold with mv_treemap_outcomes read as _v2 and only the alias fragment replaced;
--   * it stays unpopulated with the same unique index, grants and comment; the live view is untouched and still built;
--   * built, the copy counts the M3 sale that the live fold refuses, and every other row matches the live fold
--     (so "cv", two letters without a digit, still names nothing);
--   * it refuses to replace a populated copy and a copy that is not the plain copy of the live fold.
\set ON_ERROR_STOP on
\ir test_family_year_prices.sql
SET statement_timeout = '60s';

-- skylar-b7's beside copy, as 20261016153000 makes it.
CREATE TABLE public.mv_treemap_outcomes_v2 AS TABLE public.mv_treemap_outcomes;
DO $copy$
DECLARE def text; ix record; g record;
BEGIN
  def := regexp_replace(pg_get_viewdef('public.mv_family_year_prices'::regclass), '\mmv_treemap_outcomes\M', 'mv_treemap_outcomes_v2', 'g');
  EXECUTE format('CREATE MATERIALIZED VIEW public.mv_family_year_prices_v2 AS %s WITH NO DATA', regexp_replace(def, ';\s*$', ''));
  FOR ix IN SELECT ic.relname AS name, pg_get_indexdef(i.indexrelid) AS def FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
            WHERE i.indrelid = 'public.mv_family_year_prices'::regclass LOOP
    EXECUTE replace(ix.def, format(' INDEX %s ON public.mv_family_year_prices ', quote_ident(ix.name)),
                            format(' INDEX %s ON public.mv_family_year_prices_v2 ', quote_ident(ix.name || '_v2')));
  END LOOP;
  FOR g IN SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END AS grantee, a.privilege_type
           FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = 'public.mv_family_year_prices'::regclass AND a.grantee <> c.relowner LOOP
    EXECUTE format('GRANT %s ON public.mv_family_year_prices_v2 TO %s', g.privilege_type, g.grantee);
  END LOOP;
  EXECUTE format('COMMENT ON MATERIALIZED VIEW public.mv_family_year_prices_v2 IS %L', obj_description('public.mv_family_year_prices'::regclass, 'pg_class'));
END $copy$;

-- Family M (BMW M3, 1986..2006): canonical name and alias "M3", two characters with a digit. One 1995 sale whose own
-- BaT page reads "1995-bmw-m3-5-speed" under the name "m3 coupe 5-speed".
INSERT INTO public.mv_model_family_names (make_l, model_l, vehicles, make, family_id, family, matched, year_start, year_end) VALUES
  ('bmw', 'm3 coupe 5-speed', 1, 'BMW', '00000000-0000-4000-c000-0000000000e3', 'M3', 'm3 coupe 5 speed', 1986, 2006);
INSERT INTO public.canonical_models (id, make, canonical_model, aliases) VALUES
  ('00000000-0000-4000-c000-0000000000e3', 'BMW', 'M3', '{m3}');
INSERT INTO public.vehicles (id, make, model, year, sale_date, listing_url) VALUES
  ('00000000-0000-4000-a995-000000000001', 'BMW', 'M3 Coupe 5-Speed', 1995, current_date - 200,
   'https://example.invalid/listing/1995-bmw-m3-5-speed/');
INSERT INTO public.mv_treemap_outcomes (id, brand_name, model, year, source_name, outcome, sold_amount) VALUES
  ('00000000-0000-4000-a995-000000000001', 'BMW', 'M3 Coupe 5-Speed', 1995, 'Bring a Trailer', 'sold', 31000);
INSERT INTO public.mv_treemap_outcomes_v2 (id, brand_name, model, year, source_name, outcome, sold_amount) VALUES
  ('00000000-0000-4000-a995-000000000001', 'BMW', 'M3 Coupe 5-Speed', 1995, 'Bring a Trailer', 'sold', 31000);
REFRESH MATERIALIZED VIEW public.mv_family_year_prices;

CREATE TEMP TABLE before AS SELECT md5(pg_get_viewdef('public.mv_family_year_prices'::regclass)) v1;
\ir ../migrations/20261017053000_family_year_prices_v2_short_alias.sql
-- A second application finds the patched copy and changes nothing.
\ir ../migrations/20261017053000_family_year_prices_v2_short_alias.sql

DO $$
DECLARE live text := pg_get_viewdef('public.mv_family_year_prices'::regclass);
        copy text := pg_get_viewdef('public.mv_family_year_prices_v2'::regclass);
        expect text;
BEGIN
  PERFORM pg_temp.ok('the live fold is untouched and still built',
    md5(live) = (SELECT v1 FROM before) AND (SELECT relispopulated FROM pg_class WHERE oid = 'public.mv_family_year_prices'::regclass));
  -- as Postgres prints the patched text once re-parsed (the ARRAY cast in percentile_cont moves inside the array)
  EXECUTE format('CREATE TEMP VIEW expect_v2 AS %s', regexp_replace(
    replace(regexp_replace(live, '\mmv_treemap_outcomes\M', 'mv_treemap_outcomes_v2', 'g'),
            '(length(n.w) >= 3)', '((length(n.w) >= 3) OR ((length(n.w) = 2) AND (n.w ~ ''[0-9]''::text)))'), ';\s*$', ''));
  expect := pg_get_viewdef('pg_temp.expect_v2'::regclass);
  PERFORM pg_temp.ok('the copy is the live fold with outcomes as _v2 and the alias fragment replaced', copy = expect);
  PERFORM pg_temp.ok('the patched rule is in the copy and not in the live fold',
    position('((length(n.w) = 2) AND (n.w ~ ''[0-9]''::text))' IN copy) > 0
    AND position('((length(n.w) = 2) AND (n.w ~ ''[0-9]''::text))' IN live) = 0);
  PERFORM pg_temp.ok('the copy is created empty', NOT (SELECT relispopulated FROM pg_class WHERE oid = 'public.mv_family_year_prices_v2'::regclass));
  PERFORM pg_temp.ok('the copy keeps the unique index by name',
    (SELECT indisunique FROM pg_index WHERE indexrelid = 'public.mv_family_year_prices_key_v2'::regclass)
    AND pg_get_indexdef('public.mv_family_year_prices_key_v2'::regclass) LIKE '%(family_id, year, basis)%');
  PERFORM pg_temp.ok('the copy has the live grants and comment',
    (SELECT array_agg(a.grantee::regrole::text || ':' || a.privilege_type ORDER BY 1) FROM pg_class c, aclexplode(c.relacl) a
      WHERE c.oid = 'public.mv_family_year_prices_v2'::regclass AND a.grantee <> c.relowner)
    = (SELECT array_agg(a.grantee::regrole::text || ':' || a.privilege_type ORDER BY 1) FROM pg_class c, aclexplode(c.relacl) a
      WHERE c.oid = 'public.mv_family_year_prices'::regclass AND a.grantee <> c.relowner)
    AND obj_description('public.mv_family_year_prices_v2'::regclass, 'pg_class') = obj_description('public.mv_family_year_prices'::regclass, 'pg_class'));
END $$;

REFRESH MATERIALIZED VIEW public.mv_family_year_prices_v2;
DO $$ BEGIN
  PERFORM pg_temp.ok('the live fold refuses the M3 sale (no 3-character phrase of M3 on its page): no M3 price at all',
    NOT EXISTS (SELECT 1 FROM public.mv_family_year_prices
      WHERE family_id = '00000000-0000-4000-c000-0000000000e3' AND n > 0));
  PERFORM pg_temp.ok('the copy counts it: "m3" names its family',
    (SELECT conflicts = 0 AND n = 1 AND prices = ARRAY[31000] FROM public.mv_family_year_prices_v2
      WHERE family_id = '00000000-0000-4000-c000-0000000000e3' AND year = 1995 AND basis = 'sold'));
  PERFORM pg_temp.ok('every other row matches the live fold ("cv" still names nothing)',
    NOT EXISTS (
      (SELECT family_id, year, basis, n, conflicts, prices FROM public.mv_family_year_prices
        WHERE family_id <> '00000000-0000-4000-c000-0000000000e3'
       EXCEPT SELECT family_id, year, basis, n, conflicts, prices FROM public.mv_family_year_prices_v2)
      UNION ALL
      (SELECT family_id, year, basis, n, conflicts, prices FROM public.mv_family_year_prices_v2
        WHERE family_id <> '00000000-0000-4000-c000-0000000000e3'
       EXCEPT SELECT family_id, year, basis, n, conflicts, prices FROM public.mv_family_year_prices)));
END $$;

-- A populated copy is not replaced; nor is one that is not the plain copy of the live fold.
CREATE TEMP TABLE built AS SELECT md5(pg_get_viewdef('public.mv_family_year_prices_v2'::regclass)) d;
\ir ../migrations/20261017053000_family_year_prices_v2_short_alias.sql
DO $$ BEGIN
  PERFORM pg_temp.ok('a patched, built copy is left as it is',
    md5(pg_get_viewdef('public.mv_family_year_prices_v2'::regclass)) = (SELECT d FROM built)
    AND (SELECT relispopulated FROM pg_class WHERE oid = 'public.mv_family_year_prices_v2'::regclass));
END $$;
DROP MATERIALIZED VIEW public.mv_family_year_prices_v2;
CREATE MATERIALIZED VIEW public.mv_family_year_prices_v2 AS SELECT 1 AS x WITH NO DATA;
\set ON_ERROR_STOP off
\ir ../migrations/20261017053000_family_year_prices_v2_short_alias.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('a copy that is not the plain copy of the live fold is refused',
  pg_get_viewdef('public.mv_family_year_prices_v2'::regclass) LIKE '%1 AS x%');

SELECT 'family_year_prices_v2 short alias contract: all passed' AS result;
