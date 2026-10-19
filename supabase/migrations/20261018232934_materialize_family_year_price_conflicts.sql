-- Prepare a private beside copy; leave the populated reader and its cron untouched.
-- Measured read-only Bultaco/Suzuki cohort (2026-10-18): 4,893.630ms -> 1,569.982ms,
-- 716 rows each, EXCEPT ALL both ways = 0. Full-build performance is not yet measured.
-- The conflict subplan ran 825 times in each of ten aggregates; the copy evaluates it once.
-- No pricing, identity, eligibility, source or pooling rule changes. Build/rename is a separate stage.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';
DO $copy$
DECLARE
  live text;
  want text;
  ix record;
  ddl text;
BEGIN
  live := pg_get_viewdef('public.mv_family_year_prices'::regclass);
  IF (SELECT count(*) FROM regexp_matches(live, '\mnamed AS \(', 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(live, '\mp AS \(', 'g')) <> 1 THEN
    RAISE EXCEPTION 'year-price named/p stages changed; inspect before preparing the copy';
  END IF;
  want := replace(replace(live, 'named AS (', 'named AS MATERIALIZED ('),
                                'p AS (', 'p AS MATERIALIZED (');
  IF to_regclass('public.mv_family_year_prices_v2') IS NOT NULL THEN
    -- Compare through a parsed temp view because deparsing can move harmless casts.
    EXECUTE 'CREATE TEMP VIEW fyp_cached_want AS ' || regexp_replace(want, ';\s*$', '');
    want := pg_get_viewdef('pg_temp.fyp_cached_want'::regclass);
    DROP VIEW pg_temp.fyp_cached_want;
    IF pg_get_viewdef('public.mv_family_year_prices_v2'::regclass) <> want THEN
      RAISE EXCEPTION 'existing year-price beside copy differs; preserve and inspect it';
    END IF;
    RETURN;
  END IF;
  EXECUTE 'CREATE MATERIALIZED VIEW public.mv_family_year_prices_v2 AS '
          || regexp_replace(want, ';\s*$', '') || ' WITH NO DATA';
  FOR ix IN
    SELECT ic.relname AS name, pg_get_indexdef(i.indexrelid) AS def
    FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid
    WHERE i.indrelid='public.mv_family_year_prices'::regclass
  LOOP
    ddl := replace(ix.def, format(' INDEX %s ON public.mv_family_year_prices ',quote_ident(ix.name)),
                   format(' INDEX %s ON public.mv_family_year_prices_v2 ',quote_ident(ix.name||'_v2')));
    IF ddl=ix.def THEN RAISE EXCEPTION 'could not copy index %',ix.name; END IF;
    EXECUTE ddl;
  END LOOP;
  REVOKE ALL ON public.mv_family_year_prices_v2 FROM PUBLIC,anon,authenticated,service_role;
  COMMENT ON MATERIALIZED VIEW public.mv_family_year_prices_v2 IS
    'Private unbuilt beside copy: same year-price rules; cache named and conflict expressions once. '
    'Reader stays on populated original until separately validated build and rename.';
END $copy$;
COMMIT;
