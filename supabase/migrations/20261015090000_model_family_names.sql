-- mv_model_family_names: every public make and model name, resolved to a factory model family, so sales, asks and
-- live lots of the same car share one key.
--
-- Why: sales and asks do not share model strings (Craigslist "tacoma sr5", BaT "911 Carrera 4S Coupe 6-Speed"), so
-- "the same car" had no key. canonical_models (3,456 rows, 212 makes, every row with aliases, read 2026-10-15) names
-- factory models with their aliases and year ranges. Prototype on production samples, 2026-10-15 02:20Z: word-run
-- alias matching resolved 4,894 of a 6,000-sale sample (81.6%) and 491 of the day's 635 Craigslist asks (77.3%).
-- Unresolved names stay, with their vehicle counts, so coverage is measured, not assumed.
--
-- Grain: one row per (make_l, model_l) of mv_vehicle_name_dictionary (public vehicles; refreshed 03:50 UTC), never per
-- vehicle: every vehicle of one name resolves the same way, and readers join vehicles by lower(make), lower(model)
-- through idx_vehicles_lower_make_model.
--   - make: the name's make, or its canonical_makes spelling (canonical_name, display_name, short_name, aliases),
--     compared without case or punctuation ("Mercedes Benz" = "Mercedes-Benz").
--   - family: canonical_models rows of one make and model name merge (lowest id is the key; year range is the union,
--     open when any row is open). Their aliases and the model name itself are the phrases.
--   - match: the model name cut into words (letters and digits); the longest run of up to 4 words that is a phrase of
--     the make wins, then the earliest. Ties between families on one phrase go to the family the phrase names.
--   - year_start / year_end: the family's range, so a reader can refuse a vehicle outside it (one year of slack).
-- Refreshed daily at 04:05 UTC (after the dictionary), CONCURRENTLY. Public names only; anon reads it.
-- Contract: supabase/sql/test_model_family_names.sql (db-contracts).
BEGIN;
SET LOCAL statement_timeout = '300s';
SET LOCAL lock_timeout = '5s';

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_model_family_names AS
WITH make_alias AS (
  SELECT DISTINCT ON (k) k, canonical_name
  FROM (SELECT regexp_replace(lower(x), '[^a-z0-9]', '', 'g') AS k, cm.canonical_name
        FROM public.canonical_makes cm,
             unnest(array_cat(ARRAY[cm.canonical_name, cm.display_name, cm.short_name], coalesce(cm.aliases, '{}'::text[]))) x
        WHERE x IS NOT NULL AND btrim(x) <> '') a
  WHERE k <> ''
  ORDER BY k, canonical_name
), fam AS (
  SELECT regexp_replace(lower(coalesce(ma.canonical_name, m.make)), '[^a-z0-9]', '', 'g') AS make_key,
         m.canonical_model, m.id, m.year_start, m.year_end, m.aliases
  FROM public.canonical_models m
  LEFT JOIN make_alias ma ON ma.k = regexp_replace(lower(m.make), '[^a-z0-9]', '', 'g')
  WHERE m.make IS NOT NULL AND m.canonical_model IS NOT NULL AND btrim(m.canonical_model) <> ''
), family AS (
  SELECT make_key, lower(canonical_model) AS family_l, min(canonical_model) AS family,
         (array_agg(id ORDER BY id))[1] AS family_id,
         CASE WHEN bool_or(year_start IS NULL) THEN NULL ELSE min(year_start) END AS year_start,
         CASE WHEN bool_or(year_end IS NULL) THEN NULL ELSE max(year_end) END AS year_end
  FROM fam
  GROUP BY make_key, lower(canonical_model)
), phrase AS (
  SELECT DISTINCT ON (f.make_key, a.phrase) f.make_key, a.phrase, fy.family_id, fy.family, fy.year_start, fy.year_end
  FROM fam f
  CROSS JOIN LATERAL (
    SELECT btrim(regexp_replace(lower(x), '[^a-z0-9]+', ' ', 'g')) AS phrase
    FROM unnest(array_append(coalesce(f.aliases, '{}'::text[]), f.canonical_model)) x
  ) a
  JOIN family fy ON fy.make_key = f.make_key AND fy.family_l = lower(f.canonical_model)
  WHERE a.phrase <> ''
  ORDER BY f.make_key, a.phrase,
           (btrim(regexp_replace(fy.family_l, '[^a-z0-9]+', ' ', 'g')) = a.phrase) DESC, length(fy.family), fy.family, fy.family_id
), names AS (
  SELECT d.make_l, d.model_l, d.vehicles, ma.canonical_name,
         regexp_replace(lower(coalesce(ma.canonical_name, d.make_l)), '[^a-z0-9]', '', 'g') AS make_key,
         string_to_array(btrim(regexp_replace(d.model_l, '[^a-z0-9]+', ' ', 'g')), ' ') AS t
  FROM public.mv_vehicle_name_dictionary d
  LEFT JOIN make_alias ma ON ma.k = regexp_replace(d.make_l, '[^a-z0-9]', '', 'g')
), grams AS (
  SELECT nm.make_l, nm.model_l, nm.make_key, w.n, w.i, array_to_string(nm.t[w.i:w.i + w.n - 1], ' ') AS g
  FROM names nm
  CROSS JOIN LATERAL (
    SELECT n, i FROM generate_series(1, least(4, cardinality(nm.t))) n, generate_series(1, cardinality(nm.t) - n + 1) i
  ) w
  WHERE nm.make_key <> '' AND nm.t <> '{""}'::text[]
), hit AS (
  SELECT DISTINCT ON (g.make_l, g.model_l) g.make_l, g.model_l, p.family_id, p.family, p.year_start, p.year_end, g.g AS matched
  FROM grams g
  JOIN phrase p ON p.make_key = g.make_key AND p.phrase = g.g
  ORDER BY g.make_l, g.model_l, g.n DESC, g.i
)
SELECT nm.make_l, nm.model_l, nm.vehicles, nm.canonical_name AS make,
       h.family_id, h.family, h.matched, h.year_start, h.year_end
FROM names nm
LEFT JOIN hit h ON h.make_l = nm.make_l AND h.model_l = nm.model_l;

CREATE UNIQUE INDEX IF NOT EXISTS mv_model_family_names_key ON public.mv_model_family_names (make_l, model_l);
CREATE INDEX IF NOT EXISTS mv_model_family_names_family ON public.mv_model_family_names (family_id);
REVOKE ALL ON public.mv_model_family_names FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mv_model_family_names TO anon, authenticated, service_role;
COMMENT ON MATERIALIZED VIEW public.mv_model_family_names IS
  'One row per public make and model name (mv_vehicle_name_dictionary) with its factory model family from canonical_models '
  '(family_id = lowest canonical_models.id of the merged family, family name, the phrase that matched, the family year '
  'range); family is null when no phrase of the make matches. Join vehicles on lower(make), lower(coalesce(model, '''')). '
  'Refreshed daily by cron job refresh-model-family-names.';

DO $job$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-model-family-names') THEN
    PERFORM cron.schedule('refresh-model-family-names', '5 4 * * *',
      'SET statement_timeout = ''300s''; REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_model_family_names');
  END IF;
END $job$;

COMMIT;
