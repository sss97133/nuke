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
CREATE TABLE public.reference_libraries (id uuid PRIMARY KEY, year int, make text, model text);
CREATE TABLE public.library_documents (id uuid PRIMARY KEY, library_id uuid REFERENCES public.reference_libraries (id), title text,
  file_url text, is_factory_original boolean, year_range_start int, year_range_end int);
-- stand-in for 20261125124500's corrected view (corrections overlay the document's fields)
CREATE VIEW public.library_documents_current AS SELECT * FROM public.library_documents;
CREATE TABLE public.library_document_corrections (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.library_documents (id), field text NOT NULL, new_value jsonb,
  superseded_at timestamptz);
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

-- fixtures: document 1 is factory by a current cited correction; document 2 carries the uploader-writable
-- is_factory_original flag but no correction, so it is uploaded, unverified
INSERT INTO public.reference_libraries VALUES
  ('e0000000-0000-0000-0000-000000000001', 1977, 'Testmake', 'T'),
  ('e0000000-0000-0000-0000-000000000002', 1977, 'Othermake', 'O');
INSERT INTO public.library_documents VALUES
  ('d0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'Test factory manual', 'file:///laptop/manual.pdf', false, NULL, NULL),
  ('d0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001', 'Test reprint', 'https://example.org/reprint', true, NULL, NULL),
  ('d0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000002', 'Other make manual', NULL, false, NULL, NULL);
INSERT INTO public.library_document_corrections (document_id, field, new_value) VALUES
  ('d0000000-0000-0000-0000-000000000003', 'is_factory_original', 'true');
INSERT INTO public.library_document_corrections (document_id, field, new_value) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'is_factory_original', 'true');
INSERT INTO public.service_manual_chunks VALUES
  ('c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 12,
   E'VEHICLE IDENTIFICATION NUMBER\nSERIES CODE   K   FOUR-WHEEL DRIVE\nSERIES CODE   Z   UNUSED SERIES\nKIT NUMBERS FOLLOW'),
  ('c0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 13,
   'SERIES CODE M ' || repeat('FILLER TEXT ', 20) || ' MOTOR HOME CHASSIS'),
  ('c0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000002', 4,
   'SERIES CODE C CONVENTIONAL CAB'),
  ('c0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000001', 14,
   'CODE AAA VEHICLE IDENTIFICATION LAYOUT, SERIES IN POSITION 3. SERIES CODE K FOUR WHEEL DRIVE MODELS'),
  ('c0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000001', 15,
   'SERIES CODE K FOUR-WHEEL DRIVE SERIES CODE Z UNUSED SERIES'),
  ('c0000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000001', 16,
   E'SERIES B BLAZER BODY B BUS\nSERIES CODE B BLAZER\nTRIM CODE B BLACK VINYL'),
  ('c0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000003', 2,
   E'SERIES CODE K FOUR-WHEEL DRIVE\nSERIES CODE Q Q'),
  ('c0000000-0000-0000-0000-000000000008', 'd0000000-0000-0000-0000-000000000001', 17,
   E'ENGINE CODE Z 6.6 LITER 4 BBL V8\nTONNAGE CODE 1 1/2 TON\nX 2 DOOR COUPE');
INSERT INTO public.vehicles VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Testmake', 'T', 1977, 'CK1234567890A', true, NULL),
  ('a0000000-0000-0000-0000-000000000002', 'Testmake', 'T', 1978, 'CK2234567890A', true, NULL),
  ('a0000000-0000-0000-0000-000000000003', 'Testmake', 'T', 1977, 'CC3234567890A', true, NULL),
  ('a0000000-0000-0000-0000-000000000004', 'Testmake', 'T', 1977, 'CK4234567890A', false, NULL);
INSERT INTO public.vehicle_decode_rules (rule_key, make, code, year_min, year_max, value, citation_url) VALUES
  ('vin_format', 'Testmake', 'testmake_fmt', 1973, 1980,
   '{"regex": "^C[A-Z][0-9A-Z]{11}$", "positions": {"series": [2, 1], "year": [6, 1]}, "year_chars": {"7": 1977, "8": 1978}}',
   'https://example.org/fmt'),
  ('vin_series_char', 'Othermake', 'K', 1973, 1980, '{"series": "Other K"}', 'https://example.org/other');
CREATE TEMP TABLE pre AS SELECT id, citation_url FROM public.vehicle_decode_rules;

\ir ../migrations/20261125120000_decode_rule_proposals_gate.sql
\ir ../migrations/20261125120000_decode_rule_proposals_gate.sql
SET client_min_messages = warning;

DO $t$
DECLARE r jsonb; k_rule uuid; n int; other_k uuid;
BEGIN
  -- existing rows: web_reference by default, nothing else changed
  IF EXISTS (SELECT 1 FROM public.vehicle_decode_rules WHERE citation_class <> 'web_reference') THEN RAISE EXCEPTION 'existing row not web_reference'; END IF;
  IF (SELECT count(*) FROM public.vehicle_decode_rules d JOIN pre USING (id) WHERE d.citation_url = pre.citation_url) <> (SELECT count(*) FROM pre) THEN
    RAISE EXCEPTION 'existing rows changed'; END IF;

  -- 1. supported: on line 2 the code K is printed once and the label follows it; the document is factory by correction
  r := public.vehicle_decode_rule_propose('vin_series_char', 'Testmake', NULL, 'K', 1973, 1980, '{"series": "Four-wheel drive"}',
         'four-wheel drive', 'c0000000-0000-0000-0000-000000000001', 'test');
  IF r ->> 'status' <> 'active' THEN RAISE EXCEPTION '1 supported proposal not active: %', r; END IF;
  IF (r ->> 'filled')::int <> 2 OR (r ->> 'labelled')::int <> 2 OR (r ->> 'removed')::int <> 0 OR (r ->> 'cars_compared')::int <> 2
     OR (r ->> 'line')::int <> 2 OR r -> 'car_ids' <> '["a0000000-0000-0000-0000-000000000001", "a0000000-0000-0000-0000-000000000002"]' THEN
    RAISE EXCEPTION '1 measure wrong (expect line 2, the 2 public cars with K at the series position, both labelled): %', r; END IF;
  k_rule := (r ->> 'rule_id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.vehicle_decode_rules WHERE id = k_rule AND citation_class = 'factory_document'
                   AND citation_url IS NULL AND citation_chunk_id = 'c0000000-0000-0000-0000-000000000001' AND citation_page = 12
                   AND citation_locator = 'page 12, line 2') THEN
    RAISE EXCEPTION '1 promoted row not keyed to its chunk, line and factory class'; END IF;

  -- 2. a far phrase on a flat page is not the code's meaning
  r := public.vehicle_decode_rule_propose('vin_series_char', 'Testmake', NULL, 'M', 1973, 1980, '{"series": "Motor home chassis"}',
         'motor home chassis', 'c0000000-0000-0000-0000-000000000002', 'test');
  IF r ->> 'status' <> 'rejected' OR NOT (r -> 'reasons') ? 'code_value_not_adjacent_on_a_line' THEN RAISE EXCEPTION '2 far value admitted: %', r; END IF;

  -- 3. a code only inside another word (KIT) is not the code
  r := public.vehicle_decode_rule_propose('vin_series_char', 'Testmake', NULL, 'IT', 1973, 1980, '{"series": "Numbers follow"}',
         'numbers follow', 'c0000000-0000-0000-0000-000000000001', 'test');
  IF r ->> 'status' <> 'rejected' OR NOT (r -> 'reasons') ? 'code_value_not_adjacent_on_a_line' THEN RAISE EXCEPTION '3 part-word code admitted: %', r; END IF;

  -- 4. the uploader's is_factory_original flag is not read: no correction, so the row lands uploaded_document
  r := public.vehicle_decode_rule_propose('vin_series_char', 'Testmake', NULL, 'C', 1973, 1980, '{"series": "Conventional cab"}',
         'conventional cab', 'c0000000-0000-0000-0000-000000000003', 'test');
  IF r ->> 'status' <> 'active' OR r ->> 'citation_class' <> 'uploaded_document'
     OR NOT EXISTS (SELECT 1 FROM public.vehicle_decode_rules WHERE id = (r ->> 'rule_id')::uuid AND citation_class = 'uploaded_document') THEN
    RAISE EXCEPTION '4 flag-only document treated as factory: %', r; END IF;

  -- 5. a rule key with no measured consumer
  r := public.vehicle_decode_rule_propose('engine_stamp_code', 'Testmake', NULL, 'Z', 1973, 1980, '{"x": "unused series"}',
         'unused series', 'c0000000-0000-0000-0000-000000000001', 'test');
  IF NOT (r -> 'reasons') ? 'rule_key_has_no_measured_consumer:engine_stamp_code' THEN RAISE EXCEPTION '5 unmeasured key admitted: %', r; END IF;

  -- 6. supported by the page but no car carries series Z: rejected, no rule row left behind
  SELECT count(*) INTO n FROM public.vehicle_decode_rules;
  r := public.vehicle_decode_rule_propose('vin_series_char', 'Testmake', NULL, 'Z', 1973, 1980, '{"series": "Unused series"}',
         'unused series', 'c0000000-0000-0000-0000-000000000001', 'test');
  IF r ->> 'status' <> 'rejected' OR (r -> 'reasons') <> '["no_cars_to_measure"]' THEN RAISE EXCEPTION '6 empty rule admitted: %', r; END IF;
  IF (SELECT count(*) FROM public.vehicle_decode_rules) <> n THEN RAISE EXCEPTION '6 rejected rule left a row'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vehicle_decode_rule_proposals WHERE id = (r ->> 'proposal_id')::uuid AND status = 'rejected'
                   AND promotion_measure -> 'reasons' = '["no_cars_to_measure"]') THEN RAISE EXCEPTION '6 rejected measure not stored: %', r; END IF;

  -- 7. a vin_format row writes a regex no page prints: refused before any measure
  r := public.vehicle_decode_rule_propose('vin_format', 'Testmake', NULL, 'AAA', 1973, 1980,
         '{"regex": "^C[A-Z][0-9A-Z]{11}$", "positions": {"series": [3, 1]}}',
         'vehicle identification layout', 'c0000000-0000-0000-0000-000000000004', 'test');
  IF r ->> 'status' <> 'rejected' OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(r -> 'reasons') x WHERE x LIKE 'value_leaf_not_in_value_text:%')
     OR (r ->> 'cars_compared')::int <> 0 THEN RAISE EXCEPTION '7 format regex admitted: %', r; END IF;

  -- 8. a named supersede in scope: K re-cited from another page with its printed label replaces it; the measure keeps
  -- the superseded rule's readings before -> after
  r := public.vehicle_decode_rule_propose('vin_series_char', 'Testmake', NULL, 'K', 1973, 1980, '{"series": "Four wheel drive models"}',
         'four wheel drive models', 'c0000000-0000-0000-0000-000000000004', 'test', '{}'::jsonb, k_rule);
  IF r ->> 'status' <> 'active' OR (r ->> 'changed')::int <> 2 OR (r ->> 'removed')::int <> 0
     OR (r ->> 'superseded_rule_id')::uuid IS DISTINCT FROM k_rule
     OR NOT (r -> 'label_changes') @> '[{"before": "Four-wheel drive", "after": "Four wheel drive models"}]' THEN
    RAISE EXCEPTION '8 named supersede refused or unmeasured: %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vehicle_decode_rules WHERE id = k_rule AND superseded_by = (r ->> 'rule_id')::uuid
                   AND superseded_at IS NOT NULL) THEN RAISE EXCEPTION '8 old rule not superseded by the new one'; END IF;
  k_rule := (r ->> 'rule_id')::uuid;

  -- 8b. a second current rule for K without a supersede is refused before it is measured
  r := public.vehicle_decode_rule_propose('vin_series_char', 'Testmake', NULL, 'K', 1973, 1980, '{"series": "Four-wheel drive"}',
         'four-wheel drive', 'c0000000-0000-0000-0000-000000000001', 'test');
  IF r ->> 'status' <> 'rejected' OR NOT (r -> 'reasons') ? 'current_rule_exists_supersede_it' THEN RAISE EXCEPTION '8b second current rule admitted: %', r; END IF;

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
    INSERT INTO public.vehicle_decode_rules (rule_key, make, code, value, citation_class, citation_url)
    VALUES ('vin_series_char', 'Testmake', 'Q', '{}', 'uploaded_document', 'https://example.org/x');
    RAISE EXCEPTION 'uploaded_document without chunk admitted';
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

  -- 12. skeptic2 (1): a label the page does not print (MOTOR HOME) with a printed value_text is refused
  r := public.vehicle_decode_rule_propose('vin_series_char', 'Testmake', NULL, 'K', 1973, 1980, '{"series": "MOTOR HOME"}',
         'four-wheel drive', 'c0000000-0000-0000-0000-000000000001', 'test', '{}'::jsonb, k_rule);
  IF r ->> 'status' <> 'rejected' OR NOT (r -> 'reasons') ? 'value_leaf_not_in_value_text:MOTOR HOME' THEN RAISE EXCEPTION '12 unprinted label admitted: %', r; END IF;

  -- 13. skeptic2 (2): the neighbour row's meaning on a flat page (K ... Z UNUSED SERIES) is not K's
  r := public.vehicle_decode_rule_propose('vin_series_char', 'Testmake', NULL, 'K', 1973, 1980, '{"series": "Unused series"}',
         'unused series', 'c0000000-0000-0000-0000-000000000005', 'test', '{}'::jsonb, k_rule);
  IF r ->> 'status' <> 'rejected' OR NOT (r -> 'reasons') ? 'code_value_not_adjacent_on_a_line' THEN RAISE EXCEPTION '13 neighbour swap admitted: %', r; END IF;

  -- 14. skeptic2 (3): a supersede of another make's rule is refused and that rule stays current
  SELECT id INTO other_k FROM public.vehicle_decode_rules WHERE make = 'Othermake';
  r := public.vehicle_decode_rule_propose('vin_series_char', 'Testmake', NULL, 'Z', 1973, 1980, '{"series": "Unused series"}',
         'unused series', 'c0000000-0000-0000-0000-000000000001', 'test', '{}'::jsonb, other_k);
  IF r ->> 'status' <> 'rejected' OR NOT (r -> 'reasons') ? 'supersedes_other_rule'
     OR NOT EXISTS (SELECT 1 FROM public.vehicle_decode_rules WHERE id = other_k AND superseded_at IS NULL) THEN
    RAISE EXCEPTION '14 cross-make supersede admitted: %', r; END IF;

  -- 15. a code printed on several lines needs the line named; a code printed twice on the named line is refused
  r := public.vehicle_decode_rule_propose('vin_series_char', 'Testmake', NULL, 'B', 1973, 1980, '{"series": "Blazer"}',
         'blazer', 'c0000000-0000-0000-0000-000000000006', 'test');
  IF r ->> 'status' <> 'rejected' OR NOT (r -> 'reasons') ? 'code_on_several_lines_name_the_line' THEN RAISE EXCEPTION '15a ambiguous code admitted: %', r; END IF;
  r := public.vehicle_decode_rule_propose('vin_series_char', 'Testmake', NULL, 'B', 1973, 1980, '{"series": "Blazer"}',
         'blazer', 'c0000000-0000-0000-0000-000000000006', 'test', '{}'::jsonb, NULL, 1);
  IF r ->> 'status' <> 'rejected' OR NOT (r -> 'reasons') ? 'code_repeats_on_line' THEN RAISE EXCEPTION '15b repeated code admitted: %', r; END IF;
  r := public.vehicle_decode_rule_propose('vin_series_char', 'Testmake', NULL, 'B', 1973, 1980, '{"series": "Blazer"}',
         'blazer', 'c0000000-0000-0000-0000-000000000006', 'test', '{}'::jsonb, NULL, 2);
  IF r ->> 'status' <> 'rejected' OR (r -> 'reasons') <> '["no_cars_to_measure"]' OR (r ->> 'line')::int <> 2 THEN
    RAISE EXCEPTION '15c named line not read as the cited row (only no_cars_to_measure expected, no car has B): %', r; END IF;
  r := public.vehicle_decode_rule_propose('vin_series_char', 'Testmake', NULL, 'B', 1973, 1980, '{"series": "Black vinyl"}',
         'black vinyl', 'c0000000-0000-0000-0000-000000000006', 'test', '{}'::jsonb, NULL, 2);
  IF r ->> 'status' <> 'rejected' OR NOT (r -> 'reasons') ? 'code_value_not_adjacent_on_cited_line' THEN RAISE EXCEPTION '15d other line meaning admitted: %', r; END IF;

  -- 16. skeptic (1): a factory page of another make's library cannot make a Testmake rule
  r := public.vehicle_decode_rule_propose('vin_series_char', 'Testmake', NULL, 'K', 1973, 1980, '{"series": "Four-wheel drive"}',
         'four-wheel drive', 'c0000000-0000-0000-0000-000000000007', 'test', '{}'::jsonb, k_rule);
  IF r ->> 'status' <> 'rejected' OR (r -> 'reasons') <> '["document_not_for_this_make_and_years"]' THEN RAISE EXCEPTION '16 other make document admitted: %', r; END IF;
  -- ... nor a rule for years its library is not in
  r := public.vehicle_decode_rule_propose('vin_series_char', 'Testmake', NULL, 'K', 1981, 1986, '{"series": "Four-wheel drive"}',
         'four-wheel drive', 'c0000000-0000-0000-0000-000000000001', 'test');
  IF r ->> 'status' <> 'rejected' OR NOT (r -> 'reasons') ? 'document_not_for_this_make_and_years' THEN RAISE EXCEPTION '16b other years admitted: %', r; END IF;

  -- 17. skeptic (2): a one-character value_text is refused
  r := public.vehicle_decode_rule_propose('vin_series_char', 'Othermake', NULL, 'Q', 1973, 1980, '{"series": "Q"}',
         'q', 'c0000000-0000-0000-0000-000000000007', 'test');
  IF r ->> 'status' <> 'rejected' OR NOT (r -> 'reasons') ? 'value_text_under_2_characters' THEN RAISE EXCEPTION '17 one-character value admitted: %', r; END IF;

  -- 19. skeptic2 01:15 (1): the next row's meaning on a flat line is not inside K's value_text
  r := public.vehicle_decode_rule_propose('vin_series_char', 'Testmake', NULL, 'K', 1973, 1980, '{"series": "Unused series"}',
         'four-wheel drive', 'c0000000-0000-0000-0000-000000000005', 'test', '{}'::jsonb, k_rule);
  IF r ->> 'status' <> 'rejected' OR NOT (r -> 'reasons') ? 'value_leaf_not_in_value_text:Unused series' THEN RAISE EXCEPTION '19 neighbour leaf admitted: %', r; END IF;
  -- ... nor may value_text run on into the next row's code
  r := public.vehicle_decode_rule_propose('vin_series_char', 'Testmake', NULL, 'K', 1973, 1980, '{"series": "Unused series"}',
         'four-wheel drive series code z unused series', 'c0000000-0000-0000-0000-000000000005', 'test', '{}'::jsonb, k_rule);
  IF r ->> 'status' <> 'rejected' OR NOT (r -> 'reasons') ? 'value_text_crosses_next_code' THEN RAISE EXCEPTION '19b run-on value_text admitted: %', r; END IF;

  -- 19c. digits inside a letter code's value are not a next row (true negative)
  r := public.vehicle_decode_rule_propose('vin_engine_char', 'Testmake', NULL, 'Z', 1973, 1980, '{"engine": "6.6 liter 4 bbl v8"}',
         '6.6 liter 4 bbl v8', 'c0000000-0000-0000-0000-000000000008', 'test');
  IF (r -> 'reasons') ? 'value_text_crosses_next_code' OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(r -> 'reasons') x
       WHERE x LIKE 'value_leaf_not_in_value_text:%') THEN RAISE EXCEPTION '19c engine value refused as run-on: %', r; END IF;
  -- 19d. a labelled digit code whose value carries digits is not a run-on either (true negative)
  r := public.vehicle_decode_rule_propose('vin_series_char', 'Testmake', NULL, '1', 1973, 1980, '{"tonnage": "1/2 ton"}',
         '1/2 ton', 'c0000000-0000-0000-0000-000000000008', 'test');
  IF (r -> 'reasons') ? 'value_text_crosses_next_code' OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(r -> 'reasons') x
       WHERE x LIKE 'value_leaf_not_in_value_text:%') THEN RAISE EXCEPTION '19d tonnage value refused as run-on: %', r; END IF;

  -- 19e. a letter code that starts its line, with a digit in its value (true negative)
  r := public.vehicle_decode_rule_propose('vin_body_code', 'Testmake', NULL, 'X', 1973, 1980, '{"body": "2 door coupe"}',
         '2 door coupe', 'c0000000-0000-0000-0000-000000000008', 'test');
  IF (r -> 'reasons') ? 'value_text_crosses_next_code' THEN RAISE EXCEPTION '19e body value refused as run-on: %', r; END IF;

  -- 20. skeptic2 01:15 (2): a supersede for fewer years would leave 1973-1977 with no current K rule
  r := public.vehicle_decode_rule_propose('vin_series_char', 'Testmake', NULL, 'K', 1977, 1980, '{"series": "Four-wheel drive"}',
         'four-wheel drive', 'c0000000-0000-0000-0000-000000000001', 'test', '{}'::jsonb, k_rule);
  IF r ->> 'status' <> 'rejected' OR NOT (r -> 'reasons') ? 'supersede_drops_years'
     OR NOT EXISTS (SELECT 1 FROM public.vehicle_decode_rules WHERE id = k_rule AND superseded_at IS NULL) THEN
    RAISE EXCEPTION '20 narrowing supersede admitted: %', r; END IF;

  -- 18. one current document-cited rule per scope is a constraint, not only the gate's check
  BEGIN
    INSERT INTO public.vehicle_decode_rules (rule_key, make, code, year_min, year_max, value, citation_class, citation_document_id, citation_chunk_id)
    VALUES ('vin_series_char', 'Testmake', 'K', 1973, 1980, '{"series": "x"}', 'uploaded_document',
            'd0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003');
    RAISE EXCEPTION '18 second current document rule admitted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $t$;
\echo decode_rule_proposals_gate: ok
