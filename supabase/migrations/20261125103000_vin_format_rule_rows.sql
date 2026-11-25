-- vin_format_rows_v1: VIN formats are rule rows, not code. Any make decodes a VIN cohort once its format row exists.
--
-- WHY. data_set_candidates_v1 held the three Pontiac VIN formats as code (mk = 'pontiac', a regex and substr
-- positions per format), so no other make could get a VIN cohort without a function edit, and the decode rules for
-- the positions (vin_series_char, vin_body_code, vin_engine_char, vin_plant_char) had no format row to hang on.
--
-- WHAT CHANGES.
--   * vehicle_decode_rules rows with rule_key 'vin_format', one per format: make, year range, code = format key,
--     value = {regex, positions: {series|body|engine|plant|year: [from, length]}, year_chars: {char: model year}}.
--     A position that the format does not carry is absent (the 1970-71 format has no engine character).
--     The three Pontiac rows cite the chart their position rows already cite (copied from those rows here).
--   * vehicle_decode_vin_format_valid(value): the shape a vin_format row must have (regex compiles, every position
--     inside a 17-character VIN, year position present, year_chars maps to model years). CHECK on the table.
--   * data_set_candidates_v1: the vin CTE reads the live vin_format rows for the vehicle's make; nothing after it
--     changes. No make literal is left on the VIN path. Patched at its anchor; refuses drift; skipped when present.
--
-- EXPECTED. 0 membership change for Pontiac (same regexes, same positions, same year mapping); measured before merge
-- with a pg_temp copy against the live function on every Pontiac car whose VIN matches a format.
-- model_fold_logic_key changes once (function source + 3 rows): one F-body sweep pass, throttled as usual.
--
-- REVERT. Restore the vin CTE between vin_format_rows_v1 and vin_format_rows_v1_end from the previous definition and
-- supersede the three rows.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.vehicle_decode_vin_format_valid(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE k text; pos jsonb;
BEGIN
  IF jsonb_typeof(p_value -> 'regex') <> 'string' OR jsonb_typeof(p_value -> 'positions') <> 'object'
     OR jsonb_typeof(p_value -> 'year_chars') <> 'object' OR NOT (p_value -> 'positions') ? 'year' THEN
    RETURN false;
  END IF;
  BEGIN
    PERFORM 'X' ~ (p_value ->> 'regex');
  EXCEPTION WHEN others THEN RETURN false;
  END;
  FOR k, pos IN SELECT * FROM jsonb_each(p_value -> 'positions') LOOP
    IF k NOT IN ('series', 'body', 'engine', 'plant', 'year') OR jsonb_typeof(pos) <> 'array' OR jsonb_array_length(pos) <> 2
       OR jsonb_typeof(pos -> 0) <> 'number' OR jsonb_typeof(pos -> 1) <> 'number'
       OR (pos ->> 0)::int < 1 OR (pos ->> 1)::int < 1 OR (pos ->> 0)::int + (pos ->> 1)::int - 1 > 17 THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN NOT EXISTS (SELECT 1 FROM jsonb_each(p_value -> 'year_chars') y
                      WHERE jsonb_typeof(y.value) <> 'number' OR (y.value)::text !~ '^(19|20)[0-9]{2}$');
END $$;

ALTER TABLE public.vehicle_decode_rules DROP CONSTRAINT IF EXISTS vehicle_decode_rules_vin_format_shape;
ALTER TABLE public.vehicle_decode_rules ADD CONSTRAINT vehicle_decode_rules_vin_format_shape
  CHECK (rule_key <> 'vin_format' OR (make IS NOT NULL AND code IS NOT NULL AND public.vehicle_decode_vin_format_valid(value)));

-- The three Pontiac formats, exactly as the function held them; citation copied from the position rows they explain.
INSERT INTO public.vehicle_decode_rules (rule_key, make, code, year_min, year_max, value, citation_url, citation_title,
                                         citation_locator, cited_on)
SELECT 'vin_format', 'Pontiac', f.code, f.y0, f.y1, f.value, c.citation_url, c.citation_title,
       'VIN position chart (format of the position rows)', c.cited_on
  FROM (VALUES
    ('gm_1970_1971_car_vin_v1', 1970, 1971,
     '{"regex": "^22[3468]87[01][A-Z][0-9]{6}$", "positions": {"series": [2, 2], "body": [4, 2], "plant": [7, 1], "year": [6, 1]}, "year_chars": {"0": 1970, "1": 1971}}'::jsonb),
    ('gm_1972_1980_car_vin_v1', 1972, 1980,
     '{"regex": "^2[A-Z][0-9]{2}[A-Z][2-9A][A-Z][0-9]{6}$", "positions": {"series": [2, 1], "body": [3, 2], "engine": [5, 1], "plant": [7, 1], "year": [6, 1]}, "year_chars": {"2": 1972, "3": 1973, "4": 1974, "5": 1975, "6": 1976, "7": 1977, "8": 1978, "9": 1979, "A": 1980}}'::jsonb),
    ('gm_1981_17_vin_v1', 1981, 1981,
     '{"regex": "^1G2[A-C][A-Z]87[A-Z][0-9X]B[A-Z][0-9]{6}$", "positions": {"series": [5, 1], "body": [6, 2], "engine": [8, 1], "plant": [11, 1], "year": [10, 1]}, "year_chars": {"B": 1981}}'::jsonb)
  ) f(code, y0, y1, value)
  CROSS JOIN LATERAL (
    SELECT r.citation_url, r.citation_title, r.cited_on FROM public.vehicle_decode_rules r
     WHERE r.rule_key = 'vin_series_char' AND r.make = 'Pontiac' AND r.superseded_at IS NULL
       AND r.year_min <= f.y1 AND r.year_max >= f.y0
     ORDER BY r.year_min, r.id LIMIT 1) c
 WHERE NOT EXISTS (SELECT 1 FROM public.vehicle_decode_rules x
                    WHERE x.rule_key = 'vin_format' AND x.make = 'Pontiac' AND x.code = f.code AND x.superseded_at IS NULL);

DO $chk$
BEGIN
  IF (SELECT count(*) FROM public.vehicle_decode_rules WHERE rule_key = 'vin_format' AND make = 'Pontiac' AND superseded_at IS NULL) <> 3 THEN
    RAISE EXCEPTION 'vin_format_rows_v1: expected 3 Pontiac vin_format rows (a format had no cited vin_series_char row)';
  END IF;
END $chk$;

DO $patch$
DECLARE
  d text;
  a text := $a$  -- Pontiac Firebird VIN formats (vehicle_decode_rules cite the chart for each position):
  --   gm_1970_1971_car_vin_v1: 2 + series (2 digits, e.g. 28 = Trans Am) + body (2) + year digit (0/1) + plant + serial (6); no engine
  --   gm_1972_1980_car_vin_v1: 2 + series + body (2) + engine + year (2-9, A = 1980) + plant + serial (6)
  --   gm_1981_17_vin_v1: 1G2 + restraint + series + body (2) + engine + check + B (1981) + plant + serial (6)
  vin AS (
    SELECT v.*, substr(v.vin, 2, 1) AS series, substr(v.vin, 3, 2) AS body, substr(v.vin, 5, 1) AS eng,
           substr(v.vin, 7, 1) AS plant,
           CASE substr(v.vin, 6, 1) WHEN 'A' THEN 1980 ELSE 1970 + substr(v.vin, 6, 1)::int END AS dyear,
           'gm_1972_1980_car_vin_v1'::text AS fmt
      FROM v WHERE v.mk = 'pontiac' AND v.vin ~ '^2[A-Z][0-9]{2}[A-Z][2-9A][A-Z][0-9]{6}$'
    UNION ALL
    SELECT v.*, substr(v.vin, 2, 2), substr(v.vin, 4, 2), NULL::text, substr(v.vin, 7, 1),
           1970 + substr(v.vin, 6, 1)::int, 'gm_1970_1971_car_vin_v1'
      FROM v WHERE v.mk = 'pontiac' AND v.vin ~ '^22[3468]87[01][A-Z][0-9]{6}$'
    UNION ALL
    SELECT v.*, substr(v.vin, 5, 1), substr(v.vin, 6, 2), substr(v.vin, 8, 1), substr(v.vin, 11, 1),
           1981, 'gm_1981_17_vin_v1'
      FROM v WHERE v.mk = 'pontiac' AND v.vin ~ '^1G2[A-C][A-Z]87[A-Z][0-9X]B[A-Z][0-9]{6}$'),
$a$;
  r text := $r$  -- vin_format_rows_v1: VIN formats are vehicle_decode_rules rows (rule_key 'vin_format', one per format and make):
  -- value.regex selects the VIN, value.positions gives [from, length] per character group, value.year_chars maps the
  -- year character to the model year. A group the format does not carry is NULL (1970-71 GM has no engine character).
  vin AS (
    SELECT v.*,
           substr(v.vin, (f.p -> 'series' ->> 0)::int, (f.p -> 'series' ->> 1)::int) AS series,
           substr(v.vin, (f.p -> 'body' ->> 0)::int, (f.p -> 'body' ->> 1)::int) AS body,
           substr(v.vin, (f.p -> 'engine' ->> 0)::int, (f.p -> 'engine' ->> 1)::int) AS eng,
           substr(v.vin, (f.p -> 'plant' ->> 0)::int, (f.p -> 'plant' ->> 1)::int) AS plant,
           (f.yc ->> substr(v.vin, (f.p -> 'year' ->> 0)::int, (f.p -> 'year' ->> 1)::int))::int AS dyear,
           f.code AS fmt
      FROM v
      JOIN LATERAL (SELECT r.code, r.value -> 'positions' AS p, r.value -> 'year_chars' AS yc
                      FROM public.vehicle_decode_rules r
                     WHERE r.rule_key = 'vin_format' AND r.superseded_at IS NULL
                       AND lower(r.make) = v.mk AND v.vin ~ (r.value ->> 'regex')) f ON true),
  -- vin_format_rows_v1_end
$r$;
  n int;
BEGIN
  d := pg_get_functiondef('public.data_set_candidates_v1(uuid[])'::regprocedure);
  IF position('vin_format_rows_v1' IN d) > 0 THEN RETURN; END IF;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  IF n <> 1 THEN RAISE EXCEPTION 'vin_format_rows_v1: anchor drifted (% matches)', n; END IF;
  EXECUTE replace(d, a, r);
END $patch$;
