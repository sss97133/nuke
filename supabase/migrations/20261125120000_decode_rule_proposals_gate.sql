-- decode_rule_proposals_v1: decode rule rows come from cited factory document pages through a measured gate.
--
-- WHY. Every live vehicle_decode_rules row (1,413 Pontiac + 45 make NULL, 2026-11-25) cites a web reference page and none
-- cites a factory document in the library; every other make has 0 rows, so their VINs decode to nothing. Rule rows for
-- the next make must come from the indexed factory manuals (service_manual_chunks), never typed from memory or a model's
-- recall, and must not reach a reader before they are measured. Owner: "i ask for this car but we implement the same
-- goals triggers loops and graphs to make the same happen for all others."
--
-- ROWS.
--   vehicle_decode_rules + citation_class ('web_reference' | 'factory_document'; every live row is web_reference by the
--     default, nothing is demoted), citation_document_id FK library_documents, citation_chunk_id FK
--     service_manual_chunks, citation_page. A factory_document row names its document and chunk; citation_url may then
--     be NULL (the manuals are laptop files, not web pages). The current-row unique index keys the chunk when the URL is
--     NULL.
--   vehicle_decode_rule_proposals: the rule columns, value_text (the value exactly as printed), the cited document and
--     chunk, proposer, status (proposed | active | rejected), promotion_measure, promoted_rule_id. No reader reads it,
--     so a proposal is never live. RLS on, service role only.
--
-- GATE. vehicle_decode_rule_promote(proposal) activates a proposal only when, measured inside a subtransaction:
--   1. the cited document is a factory original (library_documents.is_factory_original) and holds the cited chunk;
--   2. the chunk's text holds the code as a whole token and value_text no more than 160 characters apart;
--   3. the rule key has a measured consumer: vin_format, vin_series_char, vin_body_code, vin_engine_char,
--      vin_plant_char (data_set_candidates_v1); every other key is refused until its consumer is measured;
--   4. on the cars the rule chooses (the first 50 public cars by id of that make, inside the year range, whose VIN
--      matches a live or the proposed vin_format row of the make), data_set_candidates_v1 run before and after the
--      insert fills at least one candidate (a new row, or a label where the row had none), removes no row and changes
--      no established label, unless the proposal names the rule it supersedes. Rows are compared by identity
--      (set_kind, set_key, member, vehicle, basis): the reader emits a VIN cohort row for every format match and a
--      decode rule only labels it, so a rule for an existing format shows as labelled, never as removed + filled.
-- The measure is stored on the proposal either way. vehicle_decode_rule_propose(...) inserts and runs the gate.
-- Contract: supabase/sql/test_decode_rule_proposals_gate.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- 1. Citation class and keyed citation on the rule rows -----------------------------------------------------------------
ALTER TABLE public.vehicle_decode_rules
  ADD COLUMN IF NOT EXISTS citation_class text NOT NULL DEFAULT 'web_reference',
  ADD COLUMN IF NOT EXISTS citation_document_id uuid REFERENCES public.library_documents (id),
  ADD COLUMN IF NOT EXISTS citation_chunk_id uuid REFERENCES public.service_manual_chunks (id),
  ADD COLUMN IF NOT EXISTS citation_page integer;
ALTER TABLE public.vehicle_decode_rules DROP CONSTRAINT IF EXISTS vehicle_decode_rules_citation_class_check;
ALTER TABLE public.vehicle_decode_rules ADD CONSTRAINT vehicle_decode_rules_citation_class_check
  CHECK (citation_class IN ('web_reference', 'factory_document'));
ALTER TABLE public.vehicle_decode_rules DROP CONSTRAINT IF EXISTS vehicle_decode_rules_citation_keyed;
ALTER TABLE public.vehicle_decode_rules ADD CONSTRAINT vehicle_decode_rules_citation_keyed
  CHECK (CASE citation_class WHEN 'web_reference' THEN citation_url IS NOT NULL
                             ELSE citation_document_id IS NOT NULL AND citation_chunk_id IS NOT NULL END);
ALTER TABLE public.vehicle_decode_rules ALTER COLUMN citation_url DROP NOT NULL;
DROP INDEX IF EXISTS public.vehicle_decode_rules_current_unique;
CREATE UNIQUE INDEX vehicle_decode_rules_current_unique
  ON public.vehicle_decode_rules (rule_key, coalesce(make, ''), coalesce(model, ''), coalesce(code, ''),
    coalesce(year_min, 0), coalesce(year_max, 0), coalesce(citation_url, citation_chunk_id::text)) WHERE superseded_at IS NULL;
COMMENT ON COLUMN public.vehicle_decode_rules.citation_class IS
  'decode_rule_proposals_v1: web_reference (a web page, citation_url) or factory_document (a library_documents page, citation_document_id + citation_chunk_id). Lets the grade tell them apart; every row before 2026-11-25 is web_reference.';

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
CREATE OR REPLACE FUNCTION public.vehicle_decode_rule_promote(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
SET statement_timeout = '60s'
AS $f$
DECLARE
  p public.vehicle_decode_rule_proposals%ROWTYPE;
  doc public.library_documents%ROWTYPE;
  txt text; u text; code_re text; val_re text;
  reasons text[] := '{}';
  win_at int;
  cars uuid[];
  n_before int := 0; n_filled int := 0; n_removed int := 0; n_labelled int := 0; n_changed int := 0;
  new_id uuid;
  measure jsonb;
  measured_keys constant text[] := ARRAY['vin_format', 'vin_series_char', 'vin_body_code', 'vin_engine_char', 'vin_plant_char'];
BEGIN
  SELECT * INTO p FROM public.vehicle_decode_rule_proposals WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'vehicle_decode_rule_promote: no proposal %', p_id; END IF;
  IF p.status <> 'proposed' THEN RAISE EXCEPTION 'vehicle_decode_rule_promote: proposal % is %', p_id, p.status; END IF;

  -- 1. factory document holding the chunk
  SELECT * INTO doc FROM public.library_documents WHERE id = p.citation_document_id;
  IF doc.is_factory_original IS NOT TRUE THEN reasons := array_append(reasons, ('document_not_factory_original')::text); END IF;
  SELECT c.content INTO txt FROM public.service_manual_chunks c
   WHERE c.id = p.citation_chunk_id AND c.document_id = p.citation_document_id;
  IF txt IS NULL THEN reasons := array_append(reasons, ('chunk_not_in_document')::text); END IF;

  -- 2. code as a whole token and value_text within one 160-character window
  IF txt IS NOT NULL THEN
    u := regexp_replace(upper(txt), '\s+', ' ', 'g');
    code_re := '(^|[^A-Z0-9])' || regexp_replace(regexp_replace(upper(btrim(p.code)), '\s+', ' ', 'g'), '([^A-Z0-9 ])', '\\\1', 'g')
               || '([^A-Z0-9]|$)';
    val_re := regexp_replace(regexp_replace(upper(btrim(p.value_text)), '\s+', ' ', 'g'), '([^A-Z0-9 ])', '\\\1', 'g');
    SELECT min(abs(c.pos - v.pos)) INTO win_at
      FROM generate_series(1, least(regexp_count(u, code_re), 200)) cn
           CROSS JOIN LATERAL (SELECT regexp_instr(u, code_re, 1, cn) AS pos) c
           CROSS JOIN generate_series(1, least(regexp_count(u, val_re), 200)) vn
           CROSS JOIN LATERAL (SELECT regexp_instr(u, val_re, 1, vn) AS pos) v;
    IF win_at IS NULL OR win_at > 160 THEN reasons := array_append(reasons, ('code_and_value_not_within_160_chars')::text); END IF;
  END IF;

  -- 3. a measured consumer
  IF NOT p.rule_key = ANY (measured_keys) THEN reasons := array_append(reasons, (('rule_key_has_no_measured_consumer:' || p.rule_key))::text); END IF;

  -- 4. the fleet measure (only when 1-3 pass)
  IF cardinality(reasons) = 0 THEN
    SELECT array_agg(id ORDER BY id) INTO cars FROM (
      SELECT v.id FROM public.vehicles v
       WHERE lower(v.make) = lower(p.make) AND v.year BETWEEN p.year_min AND p.year_max
         AND v.is_public AND v.deleted_at IS NULL AND v.vin IS NOT NULL
         AND (EXISTS (SELECT 1 FROM public.vehicle_decode_rules f
                       WHERE f.rule_key = 'vin_format' AND f.superseded_at IS NULL AND lower(f.make) = lower(p.make)
                         AND upper(btrim(v.vin)) ~ (f.value ->> 'regex'))
              OR (p.rule_key = 'vin_format' AND upper(btrim(v.vin)) ~ (p.value ->> 'regex')))
       ORDER BY v.id LIMIT 50) z;
    IF cars IS NULL THEN
      reasons := array_append(reasons, ('no_cars_to_measure')::text);
    ELSE
      CREATE TEMP TABLE IF NOT EXISTS _dr_before ON COMMIT DROP AS SELECT * FROM public.data_set_candidates_v1('{}'::uuid[]) LIMIT 0;
      CREATE TEMP TABLE IF NOT EXISTS _dr_after ON COMMIT DROP AS SELECT * FROM public.data_set_candidates_v1('{}'::uuid[]) LIMIT 0;
      TRUNCATE _dr_before; TRUNCATE _dr_after;
      INSERT INTO _dr_before SELECT * FROM public.data_set_candidates_v1(cars);
      SELECT count(*) INTO n_before FROM _dr_before;
      BEGIN
        INSERT INTO public.vehicle_decode_rules (rule_key, make, model, code, year_min, year_max, qualifiers, value,
                                                 citation_url, citation_title, citation_locator, cited_on, citation_class,
                                                 citation_document_id, citation_chunk_id, citation_page)
        VALUES (p.rule_key, p.make, p.model, p.code, p.year_min, p.year_max, p.qualifiers, p.value,
                CASE WHEN doc.file_url ~ '^https?://' THEN doc.file_url END, doc.title,
                coalesce('page ' || p.citation_page, 'chunk ' || p.citation_chunk_id), current_date, 'factory_document',
                p.citation_document_id, p.citation_chunk_id, p.citation_page)
        RETURNING id INTO new_id;
        IF p.supersedes_rule_id IS NOT NULL THEN
          UPDATE public.vehicle_decode_rules SET superseded_at = now(), superseded_by = new_id
           WHERE id = p.supersedes_rule_id AND superseded_at IS NULL;
          IF NOT FOUND THEN reasons := array_append(reasons, ('superseded_rule_not_current')::text); END IF;
        END IF;
        INSERT INTO _dr_after SELECT * FROM public.data_set_candidates_v1(cars);
        -- a candidate row's identity is (set_kind, set_key, member, vehicle, basis); a rule row changes the set of
        -- identities (a new format) or the label a decode rule gives an identity (NULL -> label is a fill; label -> other
        -- label is a change of an established decode)
        SELECT count(*) INTO n_filled FROM (
          SELECT set_kind, set_key, member_type, member_id, vehicle_id, basis_type, basis_id FROM _dr_after
          EXCEPT SELECT set_kind, set_key, member_type, member_id, vehicle_id, basis_type, basis_id FROM _dr_before) x;
        SELECT count(*) INTO n_removed FROM (
          SELECT set_kind, set_key, member_type, member_id, vehicle_id, basis_type, basis_id FROM _dr_before
          EXCEPT SELECT set_kind, set_key, member_type, member_id, vehicle_id, basis_type, basis_id FROM _dr_after) x;
        SELECT count(*) FILTER (WHERE b.set_label IS NULL AND a.set_label IS NOT NULL),
               count(*) FILTER (WHERE b.set_label IS NOT NULL AND a.set_label IS DISTINCT FROM b.set_label)
          INTO n_labelled, n_changed
          FROM (SELECT DISTINCT * FROM _dr_before) b
          JOIN (SELECT DISTINCT * FROM _dr_after) a
            ON (a.set_kind, a.set_key, a.member_type, a.member_id, a.vehicle_id, a.basis_type)
               IS NOT DISTINCT FROM (b.set_kind, b.set_key, b.member_type, b.member_id, b.vehicle_id, b.basis_type)
           AND a.basis_id IS NOT DISTINCT FROM b.basis_id;
        n_filled := n_filled + n_labelled;
        IF n_filled < 1 AND NOT (p.supersedes_rule_id IS NOT NULL AND n_changed > 0) THEN
          reasons := array_append(reasons, ('fills_nothing')::text); END IF;
        IF n_removed > 0 AND p.supersedes_rule_id IS NULL THEN reasons := array_append(reasons, ('removes_existing_candidates')::text); END IF;
        IF n_changed > 0 AND p.supersedes_rule_id IS NULL THEN reasons := array_append(reasons, ('changes_established_labels')::text); END IF;
        IF cardinality(reasons) > 0 THEN RAISE EXCEPTION USING ERRCODE = 'P0R01', MESSAGE = 'rejected'; END IF;
      EXCEPTION
        WHEN SQLSTATE 'P0R01' THEN new_id := NULL;
        WHEN unique_violation THEN new_id := NULL; reasons := array_append(reasons, ('duplicate_current_rule')::text);
      END;
    END IF;
  END IF;

  measure := jsonb_build_object('reasons', to_jsonb(reasons), 'cars_compared', coalesce(cardinality(cars), 0),
                                'car_ids', to_jsonb(cars), 'candidate_rows_before', n_before, 'filled', n_filled,
                                'labelled', n_labelled, 'removed', n_removed, 'changed', n_changed, 'window_at', win_at,
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

CREATE OR REPLACE FUNCTION public.vehicle_decode_rule_propose(
  p_rule_key text, p_make text, p_model text, p_code text, p_year_min integer, p_year_max integer, p_value jsonb,
  p_value_text text, p_citation_chunk_id uuid, p_proposer text, p_qualifiers jsonb DEFAULT '{}'::jsonb,
  p_supersedes_rule_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
SET statement_timeout = '60s'
AS $f$
DECLARE c public.service_manual_chunks%ROWTYPE; v_id uuid;
BEGIN
  SELECT * INTO c FROM public.service_manual_chunks WHERE id = p_citation_chunk_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'vehicle_decode_rule_propose: no chunk %', p_citation_chunk_id; END IF;
  INSERT INTO public.vehicle_decode_rule_proposals (rule_key, make, model, code, year_min, year_max, qualifiers, value, value_text,
                                                    citation_document_id, citation_chunk_id, citation_page, supersedes_rule_id, proposer)
  VALUES (p_rule_key, p_make, p_model, p_code, p_year_min, p_year_max, coalesce(p_qualifiers, '{}'::jsonb), p_value, p_value_text,
          c.document_id, c.id, c.page_number, p_supersedes_rule_id, p_proposer)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('proposal_id', v_id) || public.vehicle_decode_rule_promote(v_id);
END $f$;

REVOKE ALL ON FUNCTION public.vehicle_decode_rule_promote(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vehicle_decode_rule_propose(text, text, text, text, integer, integer, jsonb, text, uuid, text, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_decode_rule_promote(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.vehicle_decode_rule_propose(text, text, text, text, integer, integer, jsonb, text, uuid, text, jsonb, uuid)
  TO service_role;
