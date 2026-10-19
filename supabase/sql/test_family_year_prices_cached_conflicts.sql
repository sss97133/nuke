-- Disposable PG17 only; reuse actual source, eligibility, conflict and percentile fixtures.
\ir test_family_year_prices.sql
CREATE TEMP TABLE before_cached_prices AS SELECT * FROM public.mv_family_year_prices;
\ir ../migrations/20261018232934_materialize_family_year_price_conflicts.sql
\ir ../migrations/20261018232934_materialize_family_year_price_conflicts.sql
SELECT pg_temp.ok('preparation preserves the populated reader and leaves the private copy empty',
 (SELECT relispopulated FROM pg_class WHERE oid='public.mv_family_year_prices'::regclass)
 AND NOT (SELECT relispopulated FROM pg_class WHERE oid='public.mv_family_year_prices_v2'::regclass)
 AND NOT has_table_privilege('anon','public.mv_family_year_prices_v2','SELECT')
 AND NOT has_table_privilege('authenticated','public.mv_family_year_prices_v2','SELECT'));
REFRESH MATERIALIZED VIEW public.mv_family_year_prices_v2;
SELECT pg_temp.ok('cached expressions preserve every value and multiplicity, including conflicts and thin pools',
 NOT EXISTS (SELECT to_jsonb(v)-'as_of' FROM public.mv_family_year_prices_v2 v EXCEPT ALL SELECT to_jsonb(b)-'as_of' FROM before_cached_prices b)
 AND NOT EXISTS (SELECT to_jsonb(b)-'as_of' FROM before_cached_prices b EXCEPT ALL SELECT to_jsonb(v)-'as_of' FROM public.mv_family_year_prices_v2 v));
SELECT pg_temp.ok('existing unique key is copied and both fences are installed',
 EXISTS(SELECT 1 FROM pg_index WHERE indrelid='public.mv_family_year_prices_v2'::regclass
   AND indisunique AND indisvalid)
 AND pg_get_viewdef('public.mv_family_year_prices_v2'::regclass) LIKE '%named AS MATERIALIZED%'
 AND pg_get_viewdef('public.mv_family_year_prices_v2'::regclass) LIKE '%p AS MATERIALIZED%');
