-- Disposable PG17 contract for 20261125103000_vin_format_rule_rows (vin_format_rows_v1). Synthetic rows only.
-- A stub data_set_candidates_v1 carries the live vin CTE (the migration's anchor) and returns what that CTE decodes.
-- Asserts: identical output for the three Pontiac formats before and after; negatives decode nothing; a fourth make
-- decodes from a row alone and stops when the row is superseded; the CHECK refuses malformed format rows; a replay
-- changes nothing.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, vin text, year int, make text);
CREATE TABLE IF NOT EXISTS public.vehicle_decode_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL CHECK (rule_key ~ '^[a-z][a-z0-9_]*$'),
  make text,
  model text,
  code text,
  year_min integer,
  year_max integer,
  qualifiers jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(qualifiers) = 'object'),
  value jsonb NOT NULL CHECK (jsonb_typeof(value) = 'object'),
  citation_url text NOT NULL CHECK (citation_url ~ '^https?://'),
  citation_title text,
  citation_locator text,
  cited_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_by uuid REFERENCES public.vehicle_decode_rules (id),
  superseded_at timestamptz,
  CHECK (year_min IS NULL OR year_max IS NULL OR year_min <= year_max),
  CHECK ((superseded_by IS NULL) = (superseded_at IS NULL))
);
CREATE INDEX IF NOT EXISTS vehicle_decode_rules_lookup
  ON public.vehicle_decode_rules (rule_key, upper(code)) WHERE superseded_at IS NULL;
-- One current row per rule, scope and citation: a second reading of the same table supersedes, never duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_decode_rules_current_unique
  ON public.vehicle_decode_rules (rule_key, coalesce(make, ''), coalesce(model, ''), coalesce(code, ''),
    coalesce(year_min, 0), coalesce(year_max, 0), citation_url) WHERE superseded_at IS NULL;
ALTER TABLE public.vehicle_decode_rules ENABLE ROW LEVEL SECURITY;

-- Position rows the format rows copy their citation from (synthetic URLs).
INSERT INTO public.vehicle_decode_rules (rule_key, make, code, year_min, year_max, value, citation_url, citation_title)
VALUES ('vin_series_char', 'Pontiac', '28', 1970, 1971, '{"series": "x"}', 'https://example.org/chart-a', 'chart a'),
       ('vin_series_char', 'Pontiac', 'X', 1972, 1980, '{"series": "y"}', 'https://example.org/chart-b', 'chart b'),
       ('vin_series_char', 'Pontiac', 'W', 1981, 1981, '{"series": "z"}', 'https://example.org/chart-c', 'chart c');

CREATE FUNCTION public.data_set_candidates_v1(p_vehicles uuid[])
RETURNS TABLE(vehicle_id uuid, series text, body text, eng text, plant text, dyear int, fmt text)
LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH v AS (
    SELECT x.id, upper(btrim(x.vin)) AS vin, x.year, lower(btrim(x.make)) AS mk FROM public.vehicles x WHERE x.id = ANY (p_vehicles)),
  -- Pontiac Firebird VIN formats (vehicle_decode_rules cite the chart for each position):
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
  vin_ok AS (SELECT * FROM vin WHERE vin.year IS NULL OR vin.year = vin.dyear)
  SELECT id, series, body, eng, plant, dyear, fmt FROM vin_ok
$function$;

INSERT INTO public.vehicles (id, vin, year, make) VALUES
  ('00000000-0000-0000-0000-000000000001', '2W87Z3N100001', 1973, 'Pontiac'),     -- 1972-80 format, 1973
  ('00000000-0000-0000-0000-000000000002', '2U87LAL100002', 1980, 'Pontiac'),     -- 1972-80 format, A = 1980
  ('00000000-0000-0000-0000-000000000003', '228871N100003', 1971, 'Pontiac'),     -- 1970-71 format
  ('00000000-0000-0000-0000-000000000004', '1G2AW87W0BN100004', 1981, 'Pontiac'), -- 1981 17-character
  ('00000000-0000-0000-0000-000000000005', '2W87Z4N100005', 1973, 'Pontiac'),     -- year char 4 vs 1973: excluded
  ('00000000-0000-0000-0000-000000000006', '2W87Z3N100006', 1973, 'Chevrolet'),   -- Pontiac-shaped VIN, other make
  ('00000000-0000-0000-0000-000000000007', 'ZZZ', 1973, 'Pontiac'),               -- no format
  ('00000000-0000-0000-0000-000000000008', '9Q12K7T100008', 1977, 'Testmake'),    -- decodes only once its row exists
  ('00000000-0000-0000-0000-000000000009', '2w87z3n100009 ', NULL, 'pontiac ');   -- case, spaces, no year

CREATE TEMP TABLE before AS SELECT * FROM public.data_set_candidates_v1(ARRAY(SELECT id FROM public.vehicles));

\ir ../migrations/20261125103000_vin_format_rule_rows.sql
\ir ../migrations/20261125103000_vin_format_rule_rows.sql
SET client_min_messages = warning;

DO $t$
DECLARE n int; d text;
BEGIN
  d := pg_get_functiondef('public.data_set_candidates_v1(uuid[])'::regprocedure);
  IF position('v.mk = ''pontiac''' IN d) > 0 THEN RAISE EXCEPTION 'make literal left on the VIN path'; END IF;
  IF (length(d) - length(replace(d, 'vin_format_rows_v1_end', ''))) / length('vin_format_rows_v1_end') <> 1 THEN
    RAISE EXCEPTION 'patched more than once'; END IF;
  SELECT count(*) INTO n FROM public.vehicle_decode_rules WHERE rule_key = 'vin_format';
  IF n <> 3 THEN RAISE EXCEPTION 'expected 3 vin_format rows after a replay, got %', n; END IF;
  IF (SELECT count(*) FROM before) <> 5 THEN RAISE EXCEPTION 'baseline should decode 5 VINs: %', (SELECT json_agg(b) FROM before b); END IF;
  SELECT count(*) INTO n FROM (
    (SELECT * FROM before EXCEPT ALL SELECT * FROM public.data_set_candidates_v1(ARRAY(SELECT id FROM public.vehicles)))
    UNION ALL
    (SELECT * FROM public.data_set_candidates_v1(ARRAY(SELECT id FROM public.vehicles)) EXCEPT ALL SELECT * FROM before)) x;
  IF n <> 0 THEN RAISE EXCEPTION 'Pontiac output changed: % rows differ', n; END IF;
  IF (SELECT citation_url FROM public.vehicle_decode_rules WHERE rule_key = 'vin_format' AND code = 'gm_1981_17_vin_v1') <> 'https://example.org/chart-c'
  THEN RAISE EXCEPTION 'format row did not copy its position rows'' citation'; END IF;
  IF (SELECT eng FROM public.data_set_candidates_v1(ARRAY['00000000-0000-0000-0000-000000000003'::uuid])) IS NOT NULL
  THEN RAISE EXCEPTION '1970-71 format must carry no engine character'; END IF;
  IF (SELECT dyear FROM public.data_set_candidates_v1(ARRAY['00000000-0000-0000-0000-000000000002'::uuid])) <> 1980
  THEN RAISE EXCEPTION 'year char A must map to 1980'; END IF;
END $t$;

-- A fourth make decodes from a row alone (no function edit), and stops when the row is superseded.
INSERT INTO public.vehicle_decode_rules (rule_key, make, code, year_min, year_max, value, citation_url)
VALUES ('vin_format', 'Testmake', 'test_vin_v1', 1977, 1977,
        '{"regex": "^9[A-Z][0-9]{2}[A-Z]7[A-Z][0-9]{6}$", "positions": {"series": [2, 1], "body": [3, 2], "engine": [5, 1], "plant": [7, 1], "year": [6, 1]}, "year_chars": {"7": 1977}}',
        'https://example.org/test-chart');
DO $t$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.data_set_candidates_v1(ARRAY['00000000-0000-0000-0000-000000000008'::uuid]);
  IF r.fmt IS DISTINCT FROM 'test_vin_v1' OR r.series <> 'Q' OR r.body <> '12' OR r.eng <> 'K' OR r.plant <> 'T' OR r.dyear <> 1977 THEN
    RAISE EXCEPTION 'new make did not decode from its row: %', row_to_json(r); END IF;
  UPDATE public.vehicle_decode_rules SET superseded_at = now(), superseded_by = id WHERE code = 'test_vin_v1';
  IF EXISTS (SELECT 1 FROM public.data_set_candidates_v1(ARRAY['00000000-0000-0000-0000-000000000008'::uuid])) THEN
    RAISE EXCEPTION 'a superseded format row still decodes'; END IF;
END $t$;

-- The CHECK refuses malformed rows.
DO $t$
DECLARE bad jsonb; ok boolean;
BEGIN
  FOREACH bad IN ARRAY ARRAY[
    '{"regex": "^[A-Z", "positions": {"year": [6, 1]}, "year_chars": {"7": 1977}}'::jsonb,
    '{"regex": "^.*$", "positions": {"series": [17, 2], "year": [6, 1]}, "year_chars": {"7": 1977}}',
    '{"regex": "^.*$", "positions": {"series": [2, 1]}, "year_chars": {"7": 1977}}',
    '{"regex": "^.*$", "positions": {"trim": [2, 1], "year": [6, 1]}, "year_chars": {"7": 1977}}',
    '{"regex": "^.*$", "positions": {"year": [6, 1]}, "year_chars": {"7": "1977"}}',
    '{"regex": "^.*$", "positions": {"year": [0, 1]}, "year_chars": {"7": 1977}}']
  LOOP
    ok := true;
    BEGIN
      INSERT INTO public.vehicle_decode_rules (rule_key, make, code, value, citation_url)
      VALUES ('vin_format', 'Testmake', 'bad_' || md5(bad::text), bad, 'https://example.org/bad');
    EXCEPTION WHEN check_violation THEN ok := false;
    END;
    IF ok THEN RAISE EXCEPTION 'CHECK admitted a malformed vin_format row: %', bad; END IF;
  END LOOP;
END $t$;
\echo vin_format_rows: ok
