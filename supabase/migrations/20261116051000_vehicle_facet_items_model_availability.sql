-- Header facet items: the as-built transmission items carry the cited factory availability for the car's VIN series
-- and engine, and name that rule.
--
-- WHY. vehicle_decode_rules holds model_availability rows (code '<series><body>:<engine>:<transmission>', e.g.
-- 'S87:D:M20'): what the factory offered for a series and engine in a year, each source kept, conflicts kept. The
-- as-built transmission items (transmission.as_built.type, transmission.as_built.model) read none of them, so a
-- click showed rule null and no availability even when three cited sources disagree about whether the car could have
-- been born with the installed unit.
--
-- WHAT. A new `avail` step joins the vehicle's current VIN decode (series_code, factory_engine_code, make, model, year)
-- to model_availability rows in that make, model and year whose code starts with the series and names the engine.
-- Both as-built transmission items gain `availability` (every matching row: transmission, available, the source's
-- quote, its inference when it has one, market, source type, conflicts and citation) and, when no testimony set a
-- rule, `rule` = {key model_availability, the series and engine codes read, rule ids}. Status and value are unchanged:
-- availability bounds what the car could have been built with; it never states what it was built with.
--
-- Anchor patches of the deployed body; they refuse drift and are skipped when already applied.
BEGIN;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION pg_temp.patch_once(p_text text, p_anchor text, p_replacement text, p_what text) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE n integer := (length(p_text) - length(replace(p_text, p_anchor, ''))) / greatest(length(p_anchor), 1);
BEGIN
  IF n <> 1 THEN RAISE EXCEPTION '% anchor drifted (found % times): %', p_what, n, p_anchor; END IF;
  RETURN replace(p_text, p_anchor, p_replacement);
END $f$;

DO $migration$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure);
  IF position('facet_availability_v1' in d) = 0 THEN
    d := pg_temp.patch_once(d,
      E'  GROUP BY k.key\n),\nbase AS (\n',
      $b$  GROUP BY k.key
),
-- facet_availability_v1: factory availability for the car's VIN series and engine (cited model_availability rows).
-- Every source is kept and none chosen: it bounds what the car could have been built with, never what it was.
avail AS (
  SELECT k.key,
         jsonb_agg(jsonb_build_object('rule_id', r.id, 'code', r.code, 'transmission', r.value->>'transmission',
           'available', r.value->'available', 'quoted', r.value->>'quoted', 'inference', r.value->>'inference',
           'market', r.qualifiers->>'market', 'source_type', r.qualifiers->>'source_type',
           'conflicts_with', r.qualifiers->>'conflicts_with', 'citation_url', r.citation_url,
           'citation_title', r.citation_title, 'citation_locator', r.citation_locator) ORDER BY r.code, r.id) AS rows,
         jsonb_build_object('key', 'model_availability', 'applies_to', k.key, 'reads', 'VIN series and engine decode',
           'series_code', min(dv.series_code), 'engine_code', min(dv.engine_code),
           'rule_ids', jsonb_agg(r.id ORDER BY r.code, r.id)) AS rule
  FROM (SELECT dc.sd->>'series_code' AS series_code, dc.sd->>'factory_engine_code' AS engine_code,
               CASE WHEN dc.sd->>'year' ~ '^[0-9]{4}$' THEN (dc.sd->>'year')::int END AS yr,
               dc.sd->>'make' AS make, dc.sd->>'model' AS model
        FROM decode dc ORDER BY dc.observed_at DESC NULLS LAST, dc.id LIMIT 1) dv
  CROSS JOIN (VALUES ('transmission.as_built.type'), ('transmission.as_built.model')) k(key)
  JOIN public.vehicle_decode_rules r ON r.rule_key = 'model_availability' AND r.superseded_at IS NULL
    AND lower(r.make) = lower(dv.make) AND lower(r.model) = lower(dv.model)
    AND dv.yr BETWEEN coalesce(r.year_min, dv.yr) AND coalesce(r.year_max, dv.yr)
    AND left(split_part(r.code, ':', 1), length(dv.series_code)) = dv.series_code
    AND split_part(r.code, ':', 2) = dv.engine_code
  WHERE nullif(btrim(dv.series_code), '') IS NOT NULL AND nullif(btrim(dv.engine_code), '') IS NOT NULL
  GROUP BY k.key
),
base AS (
$b$,
      'vehicle_facet_items availability step');
    d := pg_temp.patch_once(d,
      'coalesce(ex.needed, d.needed) AS needed, ex.checked,',
      'coalesce(ex.needed, d.needed) AS needed, ex.checked, av.rows AS availability, av.rule AS av_rule,',
      'vehicle_facet_items base availability columns');
    d := pg_temp.patch_once(d,
      'LEFT JOIN examined ex ON ex.key = d.key',
      'LEFT JOIN examined ex ON ex.key = d.key LEFT JOIN avail av ON av.key = d.key',
      'vehicle_facet_items base availability join');
    d := pg_temp.patch_once(d,
      $a$'sources', coalesce(sources, '[]'::jsonb), 'rule', rule, 'equation', NULL,$a$,
      $b$'sources', coalesce(sources, '[]'::jsonb), 'rule', coalesce(rule, av_rule), 'equation', NULL,$b$,
      'vehicle_facet_items item rule');
    d := pg_temp.patch_once(d,
      E'    || CASE WHEN checked IS NOT NULL AND status = ''missing'' THEN jsonb_build_object(''examined'', checked) ELSE ''{}''::jsonb END\n',
      E'    || CASE WHEN checked IS NOT NULL AND status = ''missing'' THEN jsonb_build_object(''examined'', checked) ELSE ''{}''::jsonb END\n'
      || E'    || CASE WHEN availability IS NOT NULL THEN jsonb_build_object(''availability'', availability) ELSE ''{}''::jsonb END\n',
      'vehicle_facet_items item availability');
    EXECUTE d;
  END IF;
END
$migration$;

COMMIT;
