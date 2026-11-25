-- decode_rule_proposals_v1: decode rule rows come from cited factory document pages through a measured gate.
--
-- WHY. Every live vehicle_decode_rules row (1,413 Pontiac + 45 make NULL, 2026-11-25) cites a web reference page and none
-- cites a factory document in the library; every other make has 0 rows, so their VINs decode to nothing. Rule rows for
-- the next make must come from the indexed factory manuals (service_manual_chunks), never typed from memory or a model's
-- recall, and must not reach a reader before they are measured. Owner: "i ask for this car but we implement the same
-- goals triggers loops and graphs to make the same happen for all others."
--
-- ROWS.
--   vehicle_decode_rules + citation_class ('web_reference' | 'factory_document' | 'uploaded_document'; every live row is web_reference by the
--     default, nothing is demoted), citation_document_id FK library_documents, citation_chunk_id FK
--     service_manual_chunks, citation_page. A factory_document row names its document and chunk; citation_url may then
--     be NULL (the manuals are laptop files, not web pages). The current-row unique index keys the chunk when the URL is
--     NULL.
--   vehicle_decode_rule_proposals: the rule columns, value_text (the value exactly as printed), the cited document,
--     chunk and optional line (citation_line, 1-based), proposer, status (proposed | active | rejected), promotion_measure, promoted_rule_id. No reader reads it,
--     so a proposal is never live. RLS on, service role only.
--
-- GATE. vehicle_decode_rule_promote(proposal) activates a proposal only when, measured inside a subtransaction:
--   1. the cited chunk is a page of the cited document, and the document is for this rule: its library
--      (library_documents.library_id -> reference_libraries) has the rule's make and a year inside the rule's years, or
--      its year range (library_documents_current, so a cited correction counts) overlaps them. Factory status is never read from
--      library_documents.is_factory_original (its uploader can write it): a document is factory only by a current
--      library_document_corrections row is_factory_original = true (20261125124500, whose writer needs the document's
--      own page to print its publisher). The rule row lands as citation_class 'factory_document' with that witness,
--      else 'uploaded_document' (uploaded, unverified), which the grade tells apart.
--   2. the printed line. The chunk is split into lines (a chunk with no line breaks is one line); text compares as
--      upper-case tokens (letters and digits; punctuation and spacing are not tokens). On the cited line (the
--      proposal's citation_line, or else the only line where it holds): the code is printed exactly once as whole
--      tokens; value_text starts at the very next token (a code table prints code and meaning side by side, so a
--      neighbour row's meaning or a far phrase does not count) and does not run into the next row: it holds no repeat of
--      the token printed before the code followed by a code-shaped token, and when the code starts the line, no token of
--      the code's length and class (letters or digits); and every
--      scalar leaf of value (each string and number the rule writes) is printed as whole tokens inside the value_text span. A
--      code printed on another line too needs citation_line. A boolean or null leaf is not printable. A written label
--      that differs from the print is refused; value_text carries at least 2 letters or digits (a keyed normalization map is a later rule table, never free text), so a
--      vin_format row (a regex) cannot be proposed here.
--   3. supersedes_rule_id names a current rule with the same rule_key, make, model and code whose years the proposal
--      covers (a narrower supersede would leave years with no current rule: supersede_drops_years); without one, a current
--      rule for that key, make, model, code and overlapping years refuses the proposal. A per-code advisory lock
--      serializes two proposals for one code, and vehicle_decode_rules_document_current allows one current
--      document-cited row per key, make, model, code and years. The old row is superseded before the new one is
--      inserted (superseded_by FK made DEFERRABLE INITIALLY DEFERRED, a catalog-only change).
--   4. the rule key has a measured consumer: vin_series_char, vin_body_code, vin_engine_char, vin_plant_char
--      (data_set_candidates_v1).
--   5. on the cars the rule chooses (the first 50 public cars by id of that make, inside the year range, whose VIN
--      matches a live vin_format row of the make and carries the code at that row's position for the rule key:
--      series, body, engine or plant), data_set_candidates_v1 run before and after the insert fills at
--      least one candidate (a new row, or a label where the row had none), removes no row and changes no established
--      label, unless the proposal names the rule it supersedes; the measure keeps each label change before -> after.
--      Rows are compared by identity (set_kind, set_key, member, vehicle, basis).
-- The measure is stored on the proposal either way. vehicle_decode_rule_propose(...) inserts and runs the gate.
-- Contract: supabase/sql/test_decode_rule_proposals_gate.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $need$ BEGIN
  IF to_regclass('public.library_document_corrections') IS NULL OR to_regclass('public.library_documents_current') IS NULL THEN
    RAISE EXCEPTION 'decode_rule_proposals_v1 needs library_document_corrections (20261125124500) first';
  END IF;
END $need$;

-- 1. Citation class and keyed citation on the rule rows -----------------------------------------------------------------
ALTER TABLE public.vehicle_decode_rules
  ADD COLUMN IF NOT EXISTS citation_class text NOT NULL DEFAULT 'web_reference',
  ADD COLUMN IF NOT EXISTS citation_document_id uuid REFERENCES public.library_documents (id),
  ADD COLUMN IF NOT EXISTS citation_chunk_id uuid REFERENCES public.service_manual_chunks (id),
  ADD COLUMN IF NOT EXISTS citation_page integer;
ALTER TABLE public.vehicle_decode_rules DROP CONSTRAINT IF EXISTS vehicle_decode_rules_citation_class_check;
ALTER TABLE public.vehicle_decode_rules ADD CONSTRAINT vehicle_decode_rules_citation_class_check
  CHECK (citation_class IN ('web_reference', 'factory_document', 'uploaded_document'));
ALTER TABLE public.vehicle_decode_rules DROP CONSTRAINT IF EXISTS vehicle_decode_rules_citation_keyed;
ALTER TABLE public.vehicle_decode_rules ADD CONSTRAINT vehicle_decode_rules_citation_keyed
  CHECK (CASE citation_class WHEN 'web_reference' THEN citation_url IS NOT NULL
                             ELSE citation_document_id IS NOT NULL AND citation_chunk_id IS NOT NULL END);
ALTER TABLE public.vehicle_decode_rules ALTER COLUMN citation_url DROP NOT NULL;
DROP INDEX IF EXISTS public.vehicle_decode_rules_current_unique;
CREATE UNIQUE INDEX vehicle_decode_rules_current_unique
  ON public.vehicle_decode_rules (rule_key, coalesce(make, ''), coalesce(model, ''), coalesce(code, ''),
    coalesce(year_min, 0), coalesce(year_max, 0), coalesce(citation_url, citation_chunk_id::text)) WHERE superseded_at IS NULL;
ALTER TABLE public.vehicle_decode_rules ALTER CONSTRAINT vehicle_decode_rules_superseded_by_fkey DEFERRABLE INITIALLY DEFERRED;
-- One current document-cited rule per scope: a second reading supersedes it, never stands beside it. Web rows (two live
-- groups share a scope with two citations) are outside it.
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_decode_rules_document_current
  ON public.vehicle_decode_rules (rule_key, lower(make), coalesce(lower(model), ''), upper(btrim(code)),
    coalesce(year_min, 0), coalesce(year_max, 0))
  WHERE superseded_at IS NULL AND citation_class <> 'web_reference';
COMMENT ON COLUMN public.vehicle_decode_rules.citation_class IS
  'decode_rule_proposals_v1: web_reference (a web page, citation_url); factory_document (a library_documents page whose factory status is a current cited correction); uploaded_document (a library page without that witness: uploaded, unverified). Document classes carry citation_document_id + citation_chunk_id. Every row before 2026-11-25 is web_reference.';

-- 2. Proposals ------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vehicle_decode_rule_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL CHECK (rule_key ~ '^[a-z][a-z0-9_]*$'),
  make text NOT NULL,
  model text,
  code text NOT NULL CHECK (length(btrim(code)) > 0),
  year_min integer NOT NULL,
  year_max integer NOT NULL,
  qualifiers jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(qualifiers) = 'object'),
  value jsonb NOT NULL CHECK (jsonb_typeof(value) = 'object'),
  value_text text NOT NULL CHECK (length(btrim(value_text)) > 0),
  citation_document_id uuid NOT NULL REFERENCES public.library_documents (id),
  citation_chunk_id uuid NOT NULL REFERENCES public.service_manual_chunks (id),
  citation_page integer,
  citation_line integer CHECK (citation_line > 0),
  supersedes_rule_id uuid REFERENCES public.vehicle_decode_rules (id),
  proposer text NOT NULL CHECK (length(btrim(proposer)) > 0),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'active', 'rejected')),
  promotion_measure jsonb,
  promoted_rule_id uuid REFERENCES public.vehicle_decode_rules (id),
  proposed_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CHECK (year_min <= year_max),
  CHECK ((status = 'active') = (promoted_rule_id IS NOT NULL)),
  CHECK ((status = 'proposed') = (decided_at IS NULL))
);
CREATE INDEX IF NOT EXISTS vehicle_decode_rule_proposals_status ON public.vehicle_decode_rule_proposals (status, proposed_at);
ALTER TABLE public.vehicle_decode_rule_proposals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vehicle_decode_rule_proposals FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.vehicle_decode_rule_proposals TO service_role;
COMMENT ON TABLE public.vehicle_decode_rule_proposals IS
  'decode_rule_proposals_v1: a decode rule read from a cited factory document chunk, waiting for vehicle_decode_rule_promote. Never read by a decoder.';

-- 3. The gate ---------------------------------------------------------------------------------------------------------------
-- Upper-case letter/digit tokens of a text; punctuation and spacing are not tokens.
CREATE OR REPLACE FUNCTION public.decode_rule_tokens(p text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $f$
  SELECT coalesce(array_remove(regexp_split_to_array(regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]+', ' ', 'g'), ' '), ''), '{}')
$f$;
-- 1-based start positions where needle occurs as whole tokens in hay.
CREATE OR REPLACE FUNCTION public.decode_rule_token_positions(hay text[], needle text[])
RETURNS int[] LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $f$
  SELECT coalesce(array_agg(i ORDER BY i), '{}')
    FROM generate_series(1, cardinality(hay) - cardinality(needle) + 1) i
   WHERE cardinality(needle) > 0 AND hay[i:i + cardinality(needle) - 1] = needle
$f$;

CREATE OR REPLACE FUNCTION public.vehicle_decode_rule_promote(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $f$
DECLARE
  p public.vehicle_decode_rule_proposals%ROWTYPE;
  doc record;
  pos_key text; pos jsonb;
  txt text; lines text[]; t text[]; ct text[]; vt text[]; lt text[];
  is_factory boolean;
  reasons text[] := '{}';
  hit_lines int[] := '{}'; code_lines int[] := '{}'; line_no int; cp int[]; vp int[]; c int; v int; ok boolean;
  leaf record; n_leaves int := 0; vs int; ve int; shape text;
  cars uuid[];
  n_before int := 0; n_filled int := 0; n_removed int := 0; n_labelled int := 0; n_changed int := 0;
  label_changes jsonb;
  new_id uuid;
  measure jsonb;
  measured_keys constant text[] := ARRAY['vin_series_char', 'vin_body_code', 'vin_engine_char', 'vin_plant_char'];
BEGIN
  SELECT * INTO p FROM public.vehicle_decode_rule_proposals WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'vehicle_decode_rule_promote: no proposal %', p_id; END IF;
  IF p.status <> 'proposed' THEN RAISE EXCEPTION 'vehicle_decode_rule_promote: proposal % is %', p_id, p.status; END IF;
  -- one decision at a time per (rule key, make, model, code)
  PERFORM pg_advisory_xact_lock(hashtextextended('decode_rule:' || p.rule_key || ':' || lower(p.make) || ':'
                                                 || coalesce(lower(p.model), '') || ':' || upper(btrim(p.code)), 0));

  -- 1. the chunk is a page of the document; factory status only from a current cited correction
  SELECT d.id, d.title, d.file_url, d.year_range_start, d.year_range_end, rl.make AS lib_make, rl.year AS lib_year
    INTO doc
    FROM public.library_documents_current d LEFT JOIN public.reference_libraries rl ON rl.id = d.library_id
   WHERE d.id = p.citation_document_id;
  IF doc.id IS NULL OR lower(doc.lib_make) IS DISTINCT FROM lower(p.make)
     OR NOT coalesce(doc.lib_year BETWEEN p.year_min AND p.year_max
             OR (doc.year_range_start <= p.year_max AND coalesce(doc.year_range_end, doc.year_range_start) >= p.year_min), false) THEN
    reasons := array_append(reasons, 'document_not_for_this_make_and_years'::text);
  END IF;
  SELECT c2.content INTO txt FROM public.service_manual_chunks c2
   WHERE c2.id = p.citation_chunk_id AND c2.document_id = p.citation_document_id;
  IF txt IS NULL THEN reasons := array_append(reasons, 'chunk_not_in_document'::text); END IF;
  is_factory := EXISTS (SELECT 1 FROM public.library_document_corrections x
                         WHERE x.document_id = p.citation_document_id AND x.field = 'is_factory_original'
                           AND x.superseded_at IS NULL AND x.new_value = 'true'::jsonb);

  -- 2. the printed line
  ct := public.decode_rule_tokens(p.code);
  vt := public.decode_rule_tokens(p.value_text);
  IF length(array_to_string(vt, '')) < 2 THEN reasons := array_append(reasons, 'value_text_under_2_characters'::text); END IF;
  IF txt IS NOT NULL AND cardinality(ct) > 0 AND cardinality(vt) > 0 THEN
    lines := string_to_array(txt, E'\n');
    FOR line_no IN 1 .. cardinality(lines) LOOP
      t := public.decode_rule_tokens(lines[line_no]);
      cp := public.decode_rule_token_positions(t, ct);
      IF cardinality(cp) = 0 THEN CONTINUE; END IF;
      code_lines := code_lines || line_no;
      vp := public.decode_rule_token_positions(t, vt);
      ok := false;
      FOREACH c IN ARRAY cp LOOP
        FOREACH v IN ARRAY vp LOOP
          -- the printed meaning starts at the token right after the code (a table row prints them side by side)
          IF v = c + cardinality(ct) THEN ok := true; END IF;
        END LOOP;
      END LOOP;
      IF ok THEN hit_lines := hit_lines || line_no; END IF;
    END LOOP;
    IF p.citation_line IS NOT NULL THEN
      IF NOT p.citation_line = ANY (hit_lines) THEN
        reasons := array_append(reasons, 'code_value_not_adjacent_on_cited_line'::text); END IF;
      line_no := p.citation_line;
    ELSIF cardinality(hit_lines) = 0 THEN
      reasons := array_append(reasons, 'code_value_not_adjacent_on_a_line'::text);
    ELSIF cardinality(code_lines) > 1 THEN
      reasons := array_append(reasons, 'code_on_several_lines_name_the_line'::text);
    ELSE
      line_no := hit_lines[1];
    END IF;
    IF cardinality(reasons) = 0 THEN
      t := public.decode_rule_tokens(lines[line_no]);
      cp := public.decode_rule_token_positions(t, ct);
      IF cardinality(cp) <> 1 THEN reasons := array_append(reasons, 'code_repeats_on_line'::text); END IF;
      -- the printed value_text span on the line: from the token after the code, |value_text| tokens long
      vs := cp[1] + cardinality(ct);
      ve := vs + cardinality(vt) - 1;
      shape := CASE WHEN array_to_string(ct, '') ~ '^[0-9]+$' THEN '^[0-9]{' WHEN array_to_string(ct, '') ~ '^[A-Z]+$' THEN '^[A-Z]{'
                    ELSE '^[A-Z0-9]{' END || length(array_to_string(ct, '')) || '}$';
      IF (CASE WHEN cp[1] > 1
              THEN EXISTS (SELECT 1 FROM generate_subscripts(vt, 1) i WHERE i < cardinality(vt)
                             AND vt[i] = t[cp[1] - 1] AND vt[i + 1] ~ ('^[A-Z0-9]{' || length(array_to_string(ct, '')) || '}$'))
              ELSE EXISTS (SELECT 1 FROM unnest(vt) z(tok) WHERE z.tok ~ shape) END) THEN
        reasons := array_append(reasons, 'value_text_crosses_next_code'::text); END IF;
      -- every scalar leaf the rule writes is printed inside that span
      FOR leaf IN SELECT x.val FROM jsonb_path_query(p.value, 'strict $.**') AS x(val)
                 WHERE jsonb_typeof(x.val) NOT IN ('object', 'array') LOOP
        n_leaves := n_leaves + 1;
        IF jsonb_typeof(leaf.val) NOT IN ('string', 'number') THEN
          reasons := array_append(reasons, ('value_leaf_not_printable:' || leaf.val::text)::text);
          CONTINUE;
        END IF;
        lt := public.decode_rule_tokens(leaf.val #>> '{}');
        IF cardinality(lt) = 0 OR NOT EXISTS (SELECT 1 FROM unnest(public.decode_rule_token_positions(t, lt)) q(pos)
                                              WHERE q.pos >= vs AND q.pos + cardinality(lt) - 1 <= ve) THEN
          reasons := array_append(reasons, ('value_leaf_not_in_value_text:' || (leaf.val #>> '{}'))::text);
        END IF;
      END LOOP;
      IF n_leaves = 0 THEN reasons := array_append(reasons, 'value_has_no_leaf'::text); END IF;
    END IF;
  ELSIF txt IS NOT NULL THEN
    reasons := array_append(reasons, 'code_or_value_text_has_no_token'::text);
  END IF;

  -- 3. supersede scope, or no current rule for the code
  IF p.supersedes_rule_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.vehicle_decode_rules s
                    WHERE s.id = p.supersedes_rule_id AND s.superseded_at IS NULL AND s.rule_key = p.rule_key
                      AND lower(s.make) = lower(p.make) AND lower(s.model) IS NOT DISTINCT FROM lower(p.model)
                      AND upper(btrim(s.code)) = upper(btrim(p.code))) THEN
      reasons := array_append(reasons, 'supersedes_other_rule'::text);
    ELSIF NOT EXISTS (SELECT 1 FROM public.vehicle_decode_rules s
                       WHERE s.id = p.supersedes_rule_id AND coalesce(s.year_min, 0) >= p.year_min
                         AND coalesce(s.year_max, 9999) <= p.year_max) THEN
      reasons := array_append(reasons, 'supersede_drops_years'::text);
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.vehicle_decode_rules s
                 WHERE s.superseded_at IS NULL AND s.rule_key = p.rule_key AND lower(s.make) = lower(p.make)
                   AND lower(s.model) IS NOT DISTINCT FROM lower(p.model) AND upper(btrim(s.code)) = upper(btrim(p.code))
                   AND coalesce(s.year_min, 0) <= p.year_max AND coalesce(s.year_max, 9999) >= p.year_min) THEN
    reasons := array_append(reasons, 'current_rule_exists_supersede_it'::text);
  END IF;

  -- 4. a measured consumer
  IF NOT p.rule_key = ANY (measured_keys) THEN reasons := array_append(reasons, ('rule_key_has_no_measured_consumer:' || p.rule_key)::text); END IF;

  -- 5. the fleet measure (only when 1-4 pass)
  IF cardinality(reasons) = 0 THEN
    pos_key := CASE p.rule_key WHEN 'vin_series_char' THEN 'series' WHEN 'vin_body_code' THEN 'body'
                               WHEN 'vin_engine_char' THEN 'engine' WHEN 'vin_plant_char' THEN 'plant' END;
    SELECT array_agg(id ORDER BY id) INTO cars FROM (
      SELECT v2.id FROM public.vehicles v2
       WHERE lower(v2.make) = lower(p.make) AND v2.year BETWEEN p.year_min AND p.year_max
         AND v2.is_public AND v2.deleted_at IS NULL AND v2.vin IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.vehicle_decode_rules f
                      WHERE f.rule_key = 'vin_format' AND f.superseded_at IS NULL AND lower(f.make) = lower(p.make)
                        AND upper(btrim(v2.vin)) ~ (f.value ->> 'regex')
                        AND jsonb_typeof(f.value -> 'positions' -> pos_key) = 'array'
                        AND substr(upper(btrim(v2.vin)), (f.value -> 'positions' -> pos_key ->> 0)::int,
                                   (f.value -> 'positions' -> pos_key ->> 1)::int) = upper(btrim(p.code)))
       ORDER BY v2.id LIMIT 50) z;
    IF cars IS NULL THEN
      reasons := array_append(reasons, 'no_cars_to_measure'::text);
    ELSE
      CREATE TEMP TABLE IF NOT EXISTS _dr_before ON COMMIT DROP AS SELECT * FROM public.data_set_candidates_v1('{}'::uuid[]) LIMIT 0;
      CREATE TEMP TABLE IF NOT EXISTS _dr_after ON COMMIT DROP AS SELECT * FROM public.data_set_candidates_v1('{}'::uuid[]) LIMIT 0;
      TRUNCATE _dr_before; TRUNCATE _dr_after;
      INSERT INTO _dr_before SELECT * FROM public.data_set_candidates_v1(cars);
      SELECT count(*) INTO n_before FROM _dr_before;
      BEGIN
        new_id := gen_random_uuid();
        IF p.supersedes_rule_id IS NOT NULL THEN
          UPDATE public.vehicle_decode_rules SET superseded_at = now(), superseded_by = new_id
           WHERE id = p.supersedes_rule_id AND superseded_at IS NULL;
          IF NOT FOUND THEN reasons := array_append(reasons, 'superseded_rule_not_current'::text); END IF;
        END IF;
        INSERT INTO public.vehicle_decode_rules (id, rule_key, make, model, code, year_min, year_max, qualifiers, value,
                                                 citation_url, citation_title, citation_locator, cited_on, citation_class,
                                                 citation_document_id, citation_chunk_id, citation_page)
        VALUES (new_id, p.rule_key, p.make, p.model, p.code, p.year_min, p.year_max, p.qualifiers, p.value,
                CASE WHEN doc.file_url ~ '^https?://' THEN doc.file_url END, doc.title,
                coalesce('page ' || p.citation_page, 'chunk ' || p.citation_chunk_id) || coalesce(', line ' || line_no, ''),
                current_date, CASE WHEN is_factory THEN 'factory_document' ELSE 'uploaded_document' END,
                p.citation_document_id, p.citation_chunk_id, p.citation_page);
        INSERT INTO _dr_after SELECT * FROM public.data_set_candidates_v1(cars);
        SELECT count(*) INTO n_filled FROM (
          SELECT set_kind, set_key, member_type, member_id, vehicle_id, basis_type, basis_id FROM _dr_after
          EXCEPT SELECT set_kind, set_key, member_type, member_id, vehicle_id, basis_type, basis_id FROM _dr_before) x;
        SELECT count(*) INTO n_removed FROM (
          SELECT set_kind, set_key, member_type, member_id, vehicle_id, basis_type, basis_id FROM _dr_before
          EXCEPT SELECT set_kind, set_key, member_type, member_id, vehicle_id, basis_type, basis_id FROM _dr_after) x;
        SELECT count(*) FILTER (WHERE b.set_label IS NULL AND a.set_label IS NOT NULL),
               count(*) FILTER (WHERE b.set_label IS NOT NULL AND a.set_label IS DISTINCT FROM b.set_label),
               jsonb_agg(DISTINCT jsonb_build_object('before', b.set_label, 'after', a.set_label))
                 FILTER (WHERE a.set_label IS DISTINCT FROM b.set_label)
          INTO n_labelled, n_changed, label_changes
          FROM (SELECT DISTINCT * FROM _dr_before) b
          JOIN (SELECT DISTINCT * FROM _dr_after) a
            ON (a.set_kind, a.set_key, a.member_type, a.member_id, a.vehicle_id, a.basis_type)
               IS NOT DISTINCT FROM (b.set_kind, b.set_key, b.member_type, b.member_id, b.vehicle_id, b.basis_type)
           AND a.basis_id IS NOT DISTINCT FROM b.basis_id;
        n_filled := n_filled + n_labelled;
        IF n_filled < 1 AND NOT (p.supersedes_rule_id IS NOT NULL AND n_changed > 0) THEN
          reasons := array_append(reasons, 'fills_nothing'::text); END IF;
        IF n_removed > 0 AND p.supersedes_rule_id IS NULL THEN reasons := array_append(reasons, 'removes_existing_candidates'::text); END IF;
        IF n_changed > 0 AND p.supersedes_rule_id IS NULL THEN reasons := array_append(reasons, 'changes_established_labels'::text); END IF;
        IF cardinality(reasons) > 0 THEN RAISE EXCEPTION USING ERRCODE = 'P0R01', MESSAGE = 'rejected'; END IF;
        SET CONSTRAINTS public.vehicle_decode_rules_superseded_by_fkey IMMEDIATE;
        SET CONSTRAINTS public.vehicle_decode_rules_superseded_by_fkey DEFERRED;
      EXCEPTION
        WHEN SQLSTATE 'P0R01' THEN new_id := NULL;
        WHEN unique_violation THEN new_id := NULL; reasons := array_append(reasons, 'duplicate_current_rule'::text);
      END;
    END IF;
  END IF;

  measure := jsonb_build_object('reasons', to_jsonb(reasons), 'cars_compared', coalesce(cardinality(cars), 0),
                                'car_ids', to_jsonb(cars), 'candidate_rows_before', n_before, 'filled', n_filled,
                                'labelled', n_labelled, 'removed', n_removed, 'changed', n_changed,
                                'label_changes', coalesce(label_changes, '[]'::jsonb),
                                'superseded_rule_id', p.supersedes_rule_id, 'line', line_no,
                                'citation_class', CASE WHEN is_factory THEN 'factory_document' ELSE 'uploaded_document' END,
                                'measured_at', now());
  IF cardinality(reasons) = 0 AND new_id IS NOT NULL THEN
    UPDATE public.vehicle_decode_rule_proposals SET status = 'active', promoted_rule_id = new_id, decided_at = now(),
           promotion_measure = measure WHERE id = p_id;
  ELSE
    UPDATE public.vehicle_decode_rule_proposals SET status = 'rejected', decided_at = now(), promotion_measure = measure
     WHERE id = p_id;
  END IF;
  RETURN measure || jsonb_build_object('status', CASE WHEN cardinality(reasons) = 0 AND new_id IS NOT NULL THEN 'active' ELSE 'rejected' END,
                                       'rule_id', new_id);
END $f$;

DROP FUNCTION IF EXISTS public.vehicle_decode_rule_propose(text, text, text, text, integer, integer, jsonb, text, uuid, text, jsonb, uuid);
CREATE OR REPLACE FUNCTION public.vehicle_decode_rule_propose(
  p_rule_key text, p_make text, p_model text, p_code text, p_year_min integer, p_year_max integer, p_value jsonb,
  p_value_text text, p_citation_chunk_id uuid, p_proposer text, p_qualifiers jsonb DEFAULT '{}'::jsonb,
  p_supersedes_rule_id uuid DEFAULT NULL, p_citation_line integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $f$
DECLARE c public.service_manual_chunks%ROWTYPE; v_id uuid;
BEGIN
  SELECT * INTO c FROM public.service_manual_chunks WHERE id = p_citation_chunk_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'vehicle_decode_rule_propose: no chunk %', p_citation_chunk_id; END IF;
  INSERT INTO public.vehicle_decode_rule_proposals (rule_key, make, model, code, year_min, year_max, qualifiers, value, value_text,
                                                    citation_document_id, citation_chunk_id, citation_page, citation_line,
                                                    supersedes_rule_id, proposer)
  VALUES (p_rule_key, p_make, p_model, p_code, p_year_min, p_year_max, coalesce(p_qualifiers, '{}'::jsonb), p_value, p_value_text,
          c.document_id, c.id, c.page_number, p_citation_line, p_supersedes_rule_id, p_proposer)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('proposal_id', v_id) || public.vehicle_decode_rule_promote(v_id);
END $f$;

REVOKE ALL ON FUNCTION public.decode_rule_tokens(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.decode_rule_token_positions(text[], text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decode_rule_tokens(text), public.decode_rule_token_positions(text[], text[]) TO service_role;

REVOKE ALL ON FUNCTION public.vehicle_decode_rule_promote(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vehicle_decode_rule_propose(text, text, text, text, integer, integer, jsonb, text, uuid, text, jsonb, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_decode_rule_promote(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.vehicle_decode_rule_propose(text, text, text, text, integer, integer, jsonb, text, uuid, text, jsonb, uuid, integer)
  TO service_role;
