-- Disposable PG17 contract for 20261125120000_decode_rule_proposals_gate. Synthetic rows only.
-- The reader is a stub with the live data_set_candidates_v1 signature that decodes a VIN by the make's vin_format row
-- (the first by code): one vin_series row per format match, labelled by the make's current vin_series_char rows, as the
-- live reader emits a cohort row per format match and rules only label it.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $r$;
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, make text, model text, year int, vin text, is_public boolean, deleted_at timestamptz);
CREATE TABLE public.library_documents (id uuid PRIMARY KEY, title text, file_url text, is_factory_original boolean);
CREATE TABLE public.service_manual_chunks (id uuid PRIMARY KEY, document_id uuid REFERENCES public.library_documents (id),
  page_number int, content text);
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

CREATE FUNCTION public.data_set_candidates_v1(p uuid[])
RETURNS TABLE(set_kind text, set_key text, set_label text, set_provenance jsonb, member_type text, member_id uuid,
              vehicle_id uuid, basis_type text, basis_id uuid, basis_detail jsonb, confidence numeric, member_rule_version text)
LANGUAGE sql STABLE AS $f$
  WITH fmt AS (
    SELECT DISTINCT ON (v.id) v.id, v.vin, v.year, lower(v.make) AS mk, f.value -> 'positions' -> 'series' AS sp
      FROM public.vehicles v
      JOIN public.vehicle_decode_rules f ON f.rule_key = 'vin_format' AND f.superseded_at IS NULL
                                        AND lower(f.make) = lower(v.make) AND v.vin ~ (f.value ->> 'regex')
     WHERE v.id = ANY (p)
     ORDER BY v.id, f.code)
  SELECT 'vin_series', z.mk || ':' || substr(z.vin, (z.sp ->> 0)::int, (z.sp ->> 1)::int),
         (SELECT string_agg(DISTINCT r.value ->> 'series', '|') FROM public.vehicle_decode_rules r
           WHERE r.rule_key = 'vin_series_char' AND r.superseded_at IS NULL AND lower(r.make) = z.mk
             AND r.code = substr(z.vin, (z.sp ->> 0)::int, (z.sp ->> 1)::int)
             AND z.year BETWEEN coalesce(r.year_min, 0) AND coalesce(r.year_max, 9999)),
         NULL::jsonb, 'vehicle', z.id, z.id, 'vin', NULL::uuid, NULL::jsonb, 1::numeric, 'stub'
    FROM fmt z
$f$;

-- fixtures: two factory documents (one not original), chunks, cars, a live Testmake vin_format row from a web page
INSERT INTO public.library_documents VALUES
  ('d0000000-0000-0000-0000-000000000001', 'Test factory manual', 'file:///laptop/manual.pdf', true),
  ('d0000000-0000-0000-0000-000000000002', 'Test reprint', 'https://example.org/reprint', false);
INSERT INTO public.service_manual_chunks VALUES
  ('c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 12,
   E'VEHICLE IDENTIFICATION NUMBER\nSERIES CODE   K   FOUR-WHEEL DRIVE\nSERIES CODE   Z   UNUSED SERIES\nKIT NUMBERS FOLLOW'),
  ('c0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 13,
   'SERIES CODE M ' || repeat('FILLER TEXT ', 20) || ' MOTOR HOME CHASSIS'),
  ('c0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000002', 4,
   'SERIES CODE K FOUR-WHEEL DRIVE'),
  ('c0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000001', 14,
   'CODE AAA VEHICLE IDENTIFICATION LAYOUT, SERIES IN POSITION 3. SERIES CODE K FOUR WHEEL DRIVE MODELS');
INSERT INTO public.vehicles VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Testmake', 'T', 1977, 'CK1234567890A', true, NULL),
  ('a0000000-0000-0000-0000-000000000002', 'Testmake', 'T', 1978, 'CK2234567890A', true, NULL),
  ('a0000000-0000-0000-0000-000000000003', 'Testmake', 'T', 1977, 'CC3234567890A', true, NULL),
  ('a0000000-0000-0000-0000-000000000004', 'Testmake', 'T', 1977, 'CK4234567890A', false, NULL);
INSERT INTO public.vehicle_decode_rules (rule_key, make, code, year_min, year_max, value, citation_url) VALUES
  ('vin_format', 'Testmake', 'testmake_fmt', 1973, 1980,
   '{"regex": "^C[A-Z][0-9A-Z]{11}$", "positions": {"series": [2, 1], "year": [6, 1]}, "year_chars": {"7": 1977, "8": 1978}}',
   'https://example.org/fmt');
CREATE TEMP TABLE pre AS SELECT id, citation_url FROM public.vehicle_decode_rules;

\ir ../migrations/20261125120000_decode_rule_proposals_gate.sql
\ir ../migrations/20261125120000_decode_rule_proposals_gate.sql
SET client_min_messages = warning;

DO $t$
DECLARE r jsonb; m jsonb; k_rule uuid; n int;
  f text[] := ARRAY['vin_series_char', 'Testmake', NULL, 'K', '1973', '1980'];
BEGIN
  -- existing rows: web_reference by default, nothing else changed
  IF EXISTS (SELECT 1 FROM public.vehicle_decode_rules WHERE citation_class <> 'web_reference') THEN RAISE EXCEPTION 'existing row not web_reference'; END IF;
  IF (SELECT count(*) FROM public.vehicle_decode_rules d JOIN pre USING (id) WHERE d.citation_url = pre.citation_url) <> (SELECT count(*) FROM pre) THEN
    RAISE EXCEPTION 'existing rows changed'; END IF;

  -- 1. supported: code K and its value within 160 chars, factory document, measured consumer, fills candidates
  r := public.vehicle_decode_rule_propose('vin_series_char', 'Testmake', NULL, 'K', 1973, 1980, '{"series": "K4"}',
         'four-wheel drive', 'c0000000-0000-0000-0000-000000000001', 'test');
  IF r ->> 'status' <> 'active' THEN RAISE EXCEPTION 'supported proposal not active: %', r; END IF;
  IF (r ->> 'filled')::int <> 2 OR (r ->> 'labelled')::int <> 2 OR (r ->> 'removed')::int <> 0 OR (r ->> 'cars_compared')::int <> 3 THEN
    RAISE EXCEPTION 'measure wrong (expect 2 labelled of 3 public cars, none removed): %', r; END IF;
  k_rule := (r ->> 'rule_id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.vehicle_decode_rules WHERE id = k_rule AND citation_class = 'factory_document'
                   AND citation_url IS NULL AND citation_chunk_id = 'c0000000-0000-0000-0000-000000000001' AND citation_page = 12) THEN
    RAISE EXCEPTION 'promoted row not keyed to its chunk'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vehicle_decode_rule_proposals WHERE promoted_rule_id = k_rule AND status = 'active'
                   AND promotion_measure ? 'car_ids') THEN RAISE EXCEPTION 'proposal not marked active with measure'; END IF;

  -- 2. code and value further apart than 160 characters
  r := public.vehicle_decode_rule_propose('vin_series_char', 'Testmake', NULL, 'M', 1973, 1980, '{"series": "M"}',
         'motor home chassis', 'c0000000-0000-0000-0000-000000000002', 'test');
  IF r ->> 'status' <> 'rejected' OR NOT (r -> 'reasons') ? 'code_and_value_not_within_160_chars' THEN RAISE EXCEPTION 'far value admitted: %', r; END IF;

  -- 3. code only inside another word (KIT) is not the code; value absent
  r := public.vehicle_decode_rule_propose('vin_series_char', 'Testmake', NULL, 'IT', 1973, 1980, '{"series": "IT"}',
         'numbers follow', 'c0000000-0000-0000-0000-000000000001', 'test');
  IF r ->> 'status' <> 'rejected' OR NOT (r -> 'reasons') ? 'code_and_value_not_within_160_chars' THEN RAISE EXCEPTION 'part-word code admitted: %', r; END IF;

  -- 4. not a factory original
  r := public.vehicle_decode_rule_propose('vin_series_char', 'Testmake', NULL, 'K', 1973, 1980, '{"series": "K"}',
         'four-wheel drive', 'c0000000-0000-0000-0000-000000000003', 'test');
  IF NOT (r -> 'reasons') ? 'document_not_factory_original' THEN RAISE EXCEPTION 'reprint admitted: %', r; END IF;

  -- 5. a rule key with no measured consumer
  r := public.vehicle_decode_rule_propose('engine_stamp_code', 'Testmake', NULL, 'K', 1973, 1980, '{"x": 1}',
         'four-wheel drive', 'c0000000-0000-0000-0000-000000000001', 'test');
  IF NOT (r -> 'reasons') ? 'rule_key_has_no_measured_consumer:engine_stamp_code' THEN RAISE EXCEPTION 'unmeasured key admitted: %', r; END IF;

  -- 6. supported by the text but fills nothing (no car has series Z): rejected, and no rule row is left behind
  SELECT count(*) INTO n FROM public.vehicle_decode_rules;
  r := public.vehicle_decode_rule_propose('vin_series_char', 'Testmake', NULL, 'Z', 1973, 1980, '{"series": "Z"}',
         'unused series', 'c0000000-0000-0000-0000-000000000001', 'test');
  IF r ->> 'status' <> 'rejected' OR NOT (r -> 'reasons') ? 'fills_nothing' THEN RAISE EXCEPTION 'empty rule admitted: %', r; END IF;
  IF (SELECT count(*) FROM public.vehicle_decode_rules) <> n THEN RAISE EXCEPTION 'rejected rule left a row'; END IF;
  IF (r ->> 'cars_compared')::int <> 3 THEN RAISE EXCEPTION 'rejected measure not stored: %', r; END IF;

  -- 7. removes existing candidates without naming a supersede: a format row that moves the series position
  r := public.vehicle_decode_rule_propose('vin_format', 'Testmake', NULL, 'AAA', 1973, 1980,
         '{"regex": "^C[A-Z][0-9A-Z]{11}$", "positions": {"series": [3, 1], "year": [6, 1]}, "year_chars": {"7": 1977}}',
         'vehicle identification layout', 'c0000000-0000-0000-0000-000000000004', 'test');
  IF r ->> 'status' <> 'rejected' OR NOT (r -> 'reasons') ? 'removes_existing_candidates' THEN RAISE EXCEPTION 'removing rule admitted: %', r; END IF;
  IF EXISTS (SELECT 1 FROM public.vehicle_decode_rules WHERE code = 'AAA') THEN RAISE EXCEPTION 'rejected format left a row'; END IF;

  -- 8. a named supersede: the K rule re-cited from another page with a corrected value replaces it
  r := public.vehicle_decode_rule_propose('vin_series_char', 'Testmake', NULL, 'K', 1973, 1980, '{"series": "K-4WD"}',
         'four wheel drive', 'c0000000-0000-0000-0000-000000000004', 'test', '{}'::jsonb, k_rule);
  IF r ->> 'status' <> 'active' OR (r ->> 'changed')::int <> 2 OR (r ->> 'removed')::int <> 0 THEN RAISE EXCEPTION 'named supersede refused: %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vehicle_decode_rules WHERE id = k_rule AND superseded_by = (r ->> 'rule_id')::uuid
                   AND superseded_at IS NOT NULL) THEN RAISE EXCEPTION 'old rule not superseded by the new one'; END IF;

  -- 8b. a second current rule for K with another value, no supersede named: it would relabel established rows
  r := public.vehicle_decode_rule_propose('vin_series_char', 'Testmake', NULL, 'K', 1973, 1980, '{"series": "K-other"}',
         'four-wheel drive', 'c0000000-0000-0000-0000-000000000001', 'test');
  IF r ->> 'status' <> 'rejected' OR NOT (r -> 'reasons') ? 'changes_established_labels' THEN RAISE EXCEPTION 'relabel admitted: %', r; END IF;

  -- 9. a decided proposal cannot be promoted again
  BEGIN
    PERFORM public.vehicle_decode_rule_promote((SELECT id FROM public.vehicle_decode_rule_proposals WHERE promoted_rule_id = k_rule));
    RAISE EXCEPTION 'decided proposal promoted twice';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'decided proposal promoted twice' THEN RAISE; END IF;
  END;

  -- 10. citation keys are enforced on the rule table itself
  BEGIN
    INSERT INTO public.vehicle_decode_rules (rule_key, make, code, value, citation_class, citation_url)
    VALUES ('vin_series_char', 'Testmake', 'Q', '{}', 'factory_document', 'https://example.org/x');
    RAISE EXCEPTION 'factory_document without chunk admitted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.vehicle_decode_rules (rule_key, make, code, value) VALUES ('vin_series_char', 'Testmake', 'Q', '{}');
    RAISE EXCEPTION 'web_reference without url admitted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 11. callers
  IF has_function_privilege('anon', 'public.vehicle_decode_rule_promote(uuid)', 'execute')
     OR has_function_privilege('authenticated', 'public.vehicle_decode_rule_promote(uuid)', 'execute')
     OR NOT has_function_privilege('service_role', 'public.vehicle_decode_rule_promote(uuid)', 'execute')
     OR has_table_privilege('anon', 'public.vehicle_decode_rule_proposals', 'select') THEN
    RAISE EXCEPTION 'grants wrong'; END IF;
END $t$;
\echo decode_rule_proposals_gate: ok
