-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_search_deep -f this-file.sql
-- Contract for 20261015003000_search_deep_text_for_page_only.sql. Synthetic rows only; never production.
-- The live search_vehicles_deep (helper, hash-checked by the migration) is kept as search_vehicles_deep_old, the
-- migration replaces search_vehicles_deep, and both answer the same queries over the same synthetic index:
--   * with a limit covering every match, the two return the same rows, field for field;
--   * for any page, the relevance values returned are the same (ties may swap members), every row equals its row in
--     the full answer, and the page is ordered by relevance;
--   * typos the synonym map expands, words found only in comments, no match and an empty query behave the same;
--   * the migration is idempotent and leaves the function invoker, STABLE, with the same signature.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.vehicle_search_index') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '120s';
SET lock_timeout = '3s';

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, year integer, make text, model text, vin text, primary_image_url text, sale_price integer,
  is_public boolean, canonical_vehicle_type text);
CREATE TABLE public.vehicle_search_index (
  vehicle_id uuid PRIMARY KEY, vehicle_text text, description_text text, comment_text text, evidence_text text,
  search_vector tsvector, make text, year smallint);
CREATE INDEX ON public.vehicle_search_index USING gin (search_vector);

\ir helpers/search_deep_deps_live_20261014.sql
\ir helpers/search_vehicles_deep_live_20261014.sql
DO $$ BEGIN
  EXECUTE replace(pg_get_functiondef('public.search_vehicles_deep(text,integer,integer)'::regprocedure),
                  'FUNCTION public.search_vehicles_deep(', 'FUNCTION public.search_vehicles_deep_old(');
END $$;

-- 600 vehicles: four makes, models, public and private, some typed BOAT (is_auto_vehicle refuses them), comments and descriptions that share words.
INSERT INTO public.vehicles (id, year, make, model, vin, primary_image_url, sale_price, is_public, canonical_vehicle_type)
SELECT ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
       1950 + g % 60,
       (ARRAY['Chevrolet', 'Ford', 'Porsche', 'Lotus'])[1 + g % 4],
       (ARRAY['Corvette', 'Mustang', '911', 'Elan', 'Camaro', 'K5 Blazer', 'F-100'])[1 + g % 7],
       'VIN' || g, 'https://example.invalid/' || g || '.jpg', 10000 + g * 37,
       g % 9 <> 0,
       CASE WHEN g % 50 = 0 THEN 'BOAT' ELSE 'CAR' END
FROM generate_series(1, 600) g;
INSERT INTO public.vehicle_search_index (vehicle_id, vehicle_text, description_text, comment_text, evidence_text, search_vector, make, year)
SELECT v.id,
       v.year || ' ' || v.make || ' ' || v.model,
       CASE WHEN g % 3 = 0 THEN 'Restored engine, rebuilt carburetor, new paint on the ' || v.model ELSE 'Original survivor ' || v.model END,
       CASE WHEN g % 5 = 0 THEN repeat('Some surface rust on the floor pans, otherwise solid. ', 1 + g % 40)
            WHEN g % 7 = 0 THEN 'Bidder asked about the chevrolet drivetrain and the restored interior.'
            ELSE NULL END,
       CASE WHEN g % 11 = 0 THEN 'Title shows rust repair receipt' ELSE NULL END,
       NULL, v.make, v.year::smallint
FROM public.vehicles v JOIN generate_series(1, 600) g ON v.id = ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid;
UPDATE public.vehicle_search_index SET search_vector =
  to_tsvector('english', coalesce(vehicle_text, '') || ' ' || coalesce(description_text, '') || ' ' ||
              coalesce(comment_text, '') || ' ' || coalesce(evidence_text, ''));

\ir ../migrations/20261015003000_search_deep_text_for_page_only.sql
-- A second application changes nothing and passes its own guard.
\ir ../migrations/20261015003000_search_deep_text_for_page_only.sql

SELECT pg_temp.ok('same signature, invoker, STABLE',
  (SELECT NOT prosecdef AND provolatile = 's' FROM pg_proc WHERE oid = 'public.search_vehicles_deep(text,integer,integer)'::regprocedure));

CREATE TEMP TABLE probe(q text);
INSERT INTO probe VALUES ('chevorlet'), ('chevrolet'), ('rust'), ('porsche 911'), ('restored engine'), ('mustnag'),
  ('carburetor'), ('nomatchatall'), ('');

-- Full answers: field for field.
SELECT pg_temp.ok('full answer for "' || q || '": same rows field for field',
  NOT EXISTS (SELECT * FROM public.search_vehicles_deep_old(q, 10000, 0)
              EXCEPT ALL SELECT * FROM public.search_vehicles_deep(q, 10000, 0))
  AND NOT EXISTS (SELECT * FROM public.search_vehicles_deep(q, 10000, 0)
                  EXCEPT ALL SELECT * FROM public.search_vehicles_deep_old(q, 10000, 0)))
FROM probe;
SELECT pg_temp.ok('the broad queries match many rows (the contract exercises the expensive path)',
  (SELECT count(*) FROM public.search_vehicles_deep_old('chevorlet', 10000, 0)) > 100
  AND (SELECT count(*) FROM public.search_vehicles_deep_old('rust', 10000, 0)) > 100);

-- Pages: the same relevance values, rows equal to the full answer, ordered.
CREATE TEMP TABLE pages(l int, o int);
INSERT INTO pages VALUES (20, 0), (5, 0), (5, 5), (3, 7), (50, 40), (20, 1000);
SELECT pg_temp.ok(format('page limit %s offset %s for "%s": same relevance values', l, o, q),
  (SELECT array_agg(relevance ORDER BY relevance DESC) FROM public.search_vehicles_deep_old(q, l, o))
  IS NOT DISTINCT FROM
  (SELECT array_agg(relevance ORDER BY relevance DESC) FROM public.search_vehicles_deep(q, l, o)))
FROM probe, pages WHERE q <> '';
SELECT pg_temp.ok(format('page limit %s offset %s for "%s": rows equal their full-answer rows, in relevance order', l, o, q),
  NOT EXISTS (SELECT * FROM public.search_vehicles_deep(q, l, o)
              EXCEPT ALL SELECT * FROM public.search_vehicles_deep_old(q, 10000, 0))
  AND (SELECT bool_and(ok) FROM (
         SELECT relevance <= coalesce(lag(relevance) OVER (), relevance) AS ok
         FROM public.search_vehicles_deep(q, l, o)) s) IS NOT FALSE)
FROM probe, pages WHERE q <> '';
