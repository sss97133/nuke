-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_decode_rules_gm_seed -f this-file.sql
-- Proves the cited GM / Pontiac seed of vehicle_decode_rules: it applies twice without adding rows, every row is
-- cited, the lookups a reader needs answer from the charts (Muncie ratios keyed by countershaft, case and tail years,
-- serial formats, 1973 axle codes, the reused YH stamp resolved by its block casting, 1973 body tag), two independent
-- charts agree on the 1973 engine codes, and disagreeing availability sources are all kept.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_decode_rules') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;

-- The table as 20261116016000_vehicle_facet_items creates it (columns, checks and the current-row unique index).
CREATE TABLE public.vehicle_decode_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL CHECK (rule_key ~ '^[a-z][a-z0-9_]*$'),
  make text, model text, code text, year_min integer, year_max integer,
  qualifiers jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(qualifiers) = 'object'),
  value jsonb NOT NULL CHECK (jsonb_typeof(value) = 'object'),
  citation_url text NOT NULL CHECK (citation_url ~ '^https?://'),
  citation_title text, citation_locator text, cited_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_by uuid REFERENCES public.vehicle_decode_rules (id), superseded_at timestamptz,
  CHECK (year_min IS NULL OR year_max IS NULL OR year_min <= year_max),
  CHECK ((superseded_by IS NULL) = (superseded_at IS NULL)));
CREATE UNIQUE INDEX vehicle_decode_rules_current_unique
  ON public.vehicle_decode_rules (rule_key, coalesce(make, ''), coalesce(model, ''), coalesce(code, ''),
    coalesce(year_min, 0), coalesce(year_max, 0), citation_url) WHERE superseded_at IS NULL;

BEGIN;
\i supabase/migrations/20261116033000_vehicle_decode_rules_gm_seed.sql
COMMIT;
CREATE TEMP TABLE first_count AS SELECT count(*) AS n FROM public.vehicle_decode_rules;
BEGIN;
\i supabase/migrations/20261116033000_vehicle_decode_rules_gm_seed.sql
COMMIT;

DO $$
DECLARE n integer; r record; v jsonb;
BEGIN
  -- Replay adds nothing; every row is cited and located.
  SELECT count(*) INTO n FROM public.vehicle_decode_rules;
  IF n <> (SELECT first_count.n FROM first_count) OR n < 1300 THEN RAISE EXCEPTION 'row count % after replay', n; END IF;
  IF EXISTS (SELECT 1 FROM public.vehicle_decode_rules WHERE citation_title IS NULL OR citation_locator IS NULL OR cited_on IS NULL)
    THEN RAISE EXCEPTION 'uncited row'; END IF;
  -- Each cited document has its chart_source row.
  IF EXISTS (SELECT DISTINCT citation_url FROM public.vehicle_decode_rules r WHERE rule_key <> 'chart_source'
             AND NOT EXISTS (SELECT 1 FROM public.vehicle_decode_rules s WHERE s.rule_key = 'chart_source' AND s.citation_url = r.citation_url))
    THEN RAISE EXCEPTION 'citation without a chart_source row'; END IF;

  -- Muncie: a 7/8-inch countershaft case (3851325, 1964-65) carries the 2.56 M20 or the 2.20 M21 set.
  SELECT value INTO v FROM public.vehicle_decode_rules WHERE rule_key = 'transmission_case_casting' AND code = '3851325';
  IF v->>'countershaft_in' <> '7/8' THEN RAISE EXCEPTION 'case 3851325: %', v; END IF;
  SELECT count(*) INTO n FROM public.vehicle_decode_rules WHERE rule_key = 'transmission_gear_ratios' AND make IS NULL
    AND qualifiers->>'oem_group' = 'GM' AND value->>'countershaft_in' = '7/8';
  IF n <> 2 THEN RAISE EXCEPTION '7/8 countershaft ratio sets: %', n; END IF;
  SELECT value INTO v FROM public.vehicle_decode_rules WHERE rule_key = 'transmission_gear_ratios' AND code = 'M20'
    AND value->>'countershaft_in' = '7/8';
  IF v->'gears' <> '[2.56, 1.91, 1.48, 1.0]'::jsonb OR (v->>'reverse')::numeric <> 3.16 THEN RAISE EXCEPTION 'M20 7/8: %', v; END IF;
  SELECT value INTO v FROM public.vehicle_decode_rules WHERE rule_key = 'transmission_gear_ratios' AND code = 'M20'
    AND value->>'countershaft_in' = '1';
  IF (v->'gears'->>0)::numeric <> 2.52 OR (v->>'reverse')::numeric <> 3.11 THEN RAISE EXCEPTION 'M20 1in: %', v; END IF;
  SELECT value INTO v FROM public.vehicle_decode_rules WHERE rule_key = 'transmission_tailhousing_casting' AND code = '3857584';
  IF (v->>'output_splines')::int <> 27 OR v->>'speedo_side' <> 'passenger' THEN RAISE EXCEPTION 'tail: %', v; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vehicle_decode_rules WHERE rule_key = 'transmission_serial_format'
                 AND 'P0118' ~ (value->>'pattern') AND year_max = 1966)
    THEN RAISE EXCEPTION 'P0118 does not match the 1963-66 serial format'; END IF;
  SELECT count(*) INTO n FROM public.vehicle_decode_rules WHERE rule_key = 'transmission_serial_format' AND 'P0118' ~ (value->>'pattern');
  IF n <> 1 THEN RAISE EXCEPTION 'P0118 matched % serial formats', n; END IF;
  SELECT count(*) INTO n FROM public.vehicle_decode_rules WHERE rule_key = 'transmission_gear_ratios' AND code LIKE 'SAGINAW_%';
  IF n <> 8 THEN RAISE EXCEPTION 'Saginaw ratio rows: %', n; END IF;

  -- 1973 Pontiac axle code and the Fisher tag decode.
  SELECT value INTO v FROM public.vehicle_decode_rules WHERE rule_key = 'axle_code' AND code = 'GYG' AND make = 'Pontiac'
    AND 1973 BETWEEN year_min AND year_max;
  IF (v->>'ratio')::numeric <> 3.08 OR (v->>'limited_slip')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'GYG: %', v; END IF;
  SELECT value INTO v FROM public.vehicle_decode_rules WHERE rule_key = 'body_tag_trim_code' AND code = '232';
  IF v->>'pontiac_trim' <> '321' OR v->>'color' <> 'White' THEN RAISE EXCEPTION 'trim 232: %', v; END IF;
  -- Paint codes already in paint_codes are referenced, not copied.
  SELECT value INTO v FROM public.vehicle_decode_rules WHERE rule_key = 'body_tag_paint_code' AND code = '75';
  IF v->'ref'->>'table' <> 'paint_codes' OR v ? 'name' OR v->>'pontiac_code' <> 'R' THEN RAISE EXCEPTION 'paint 75: %', v; END IF;
  SELECT count(*) INTO n FROM public.vehicle_decode_rules WHERE rule_key = 'body_tag_paint_code' AND code ~ '^\d{2}$';
  IF n <> 16 THEN RAISE EXCEPTION '1973 Fisher paint codes: %', n; END IF;

  -- YH is reused across years; the block casting picks the 1970 455.
  SELECT count(DISTINCT year_min) INTO n FROM public.vehicle_decode_rules WHERE rule_key = 'engine_stamp_code' AND code = 'YH';
  IF n < 5 THEN RAISE EXCEPTION 'YH years: %', n; END IF;
  SELECT count(*) INTO n FROM public.vehicle_decode_rules WHERE rule_key = 'engine_stamp_code' AND code = 'YH'
    AND (value->>'block_casting' = '9799140' OR value->'variants' @> '[{"block_casting": "9799140"}]');
  IF n <> 1 THEN RAISE EXCEPTION 'YH + 9799140 rows: %', n; END IF;
  SELECT year_min, value INTO r FROM public.vehicle_decode_rules WHERE rule_key = 'block_casting' AND code = '9799140';
  IF r.year_min <> 1970 OR (r.value->>'displacement_ci')::int <> 455 THEN RAISE EXCEPTION 'block 9799140: %', r; END IF;

  -- Two independent charts agree on the 1973 engine stamp displacements.
  SELECT count(*) INTO n FROM public.vehicle_decode_rules h
  WHERE h.rule_key = 'engine_stamp_code' AND h.citation_url LIKE 'https://wwfirebirds.com/%'
    AND NOT EXISTS (SELECT 1 FROM public.vehicle_decode_rules p WHERE p.rule_key = 'engine_stamp_code'
      AND p.citation_url LIKE 'https://www.thepartsplaceinc.com/%' AND p.code = h.code AND p.year_min = 1973
      AND (p.value->'displacement_ci' = h.value->'displacement_ci'
           OR p.value->'variants' @> jsonb_build_array(jsonb_build_object('displacement_ci', h.value->'displacement_ci'))));
  IF n > 1 THEN RAISE EXCEPTION '% 1973 HPP engine codes without a matching Parts Place row', n; END IF;

  -- Availability of a 4-speed with the base six: every source kept, none chosen.
  SELECT count(*) INTO n FROM public.vehicle_decode_rules WHERE rule_key = 'model_availability' AND code = 'S87:D:M20' AND year_min = 1973;
  IF n <> 3 THEN RAISE EXCEPTION '1973 availability rows: %', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vehicle_decode_rules WHERE rule_key = 'model_availability' AND code = 'S87:D:M20'
                 AND value->>'available' = 'implied') THEN RAISE EXCEPTION 'the opposing source was dropped'; END IF;
  -- A chart line repeated for one key is kept as variants, never dropped.
  IF NOT EXISTS (SELECT 1 FROM public.vehicle_decode_rules WHERE (qualifiers->>'variants')::int > 1
                 AND jsonb_array_length(value->'variants') = (qualifiers->>'variants')::int)
    THEN RAISE EXCEPTION 'no merged variant rows'; END IF;
  -- The base-six 4-speed sides are quoted verbatim.
  IF EXISTS (SELECT 1 FROM public.vehicle_decode_rules WHERE rule_key = 'model_availability' AND value->>'quoted' IS NULL)
    THEN RAISE EXCEPTION 'availability side without its quote'; END IF;
  RAISE NOTICE 'decode rule seed: % rows, replay idempotent, lookups pass', (SELECT first_count.n FROM first_count);
END $$;
