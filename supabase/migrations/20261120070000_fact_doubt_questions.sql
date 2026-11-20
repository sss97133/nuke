-- A reader's doubt about a vehicle record becomes a closed question in the existing question store.
--
-- Why: owner, 2026-11-20: "so heres where a trigger should be placed for further investigation... our skeptics can also
-- be the agents who resolve the problem by re observing the data". The store (evidence_judgment_requests) holds one
-- kind, receipt_part_visible: evidence_judgment_ineligibility and evidence_judgment_answer_problems both refuse every
-- other kind, so claim_evidence_judgments skips a second kind and answer_evidence_judgment refuses it. And no reader
-- says, in plain words, what a vehicle has been asked and what came back.
--
-- What this adds (additive; revert: supabase/sql/revert_20261120070000_fact_doubt_questions.sql):
--   kind dispatch        the two gate functions keep their names and signatures and branch on question_kind. The
--                        receipt_part_visible bodies are untouched: renamed to receipt_part_visible_ineligibility and
--                        receipt_part_visible_answer_problems, and called for that kind.
--   fact_doubt           the second kind: a doubt about ONE registered property key (observation_properties, ratified,
--                        not deprecated) on ONE vehicle. Form 'property': does the evidence settle this key. Form
--                        'reader_pair': two readers disagree about the key; do they measure the same thing.
--                        subject_table = 'observation_properties', subject_id = the property's id.
--   fact_doubt_evidence_state(vehicle, key, images, items)   what the trigger hashes: the key's current keyed observations
--                        (id and a hash of the value) and the cited frame and receipt-line ids. Never a count of photos,
--                        a producer version or a timestamp: those change without the evidence changing, which is what
--                        re-asked all 158 receipt questions five times on 2026-11-09/10.
--   fact_doubt_trigger_key(jsonb)                            sha256 of that state; stored as trigger_evidence_dedupe_key.
--   fact_doubt_params_problems / _ineligibility / _answer_problems   the closed question and answer shapes (see below).
--   evidence_judgment_decision_key / _settled                what an answer decided and whether it settles the question
--                        (both kinds); the reader uses them to compare readings.
--   evidence_public_words(text)                              a free-text answer made safe to show: contact details and
--                        amounts removed, list prices dropped, 300 characters.
--   vehicle_open_questions(uuid)                             read-only, anon-readable: the vehicle's live questions as
--                        asked / answered / open, with the answer, its witnesses and how many independent readers agree.
--
-- The closed answer for fact_doubt: {outcome: value | not_visible | cannot_tell | different_measures,
--   value (only with outcome = value; one of params.allowed when the question lists them), confidence 0..1,
--   image_ids (subset of params.cited_image_ids), receipt_item_ids (subset of params.cited_receipt_item_ids),
--   quote}. A value needs at least one witness. different_measures is only for form reader_pair and needs a quote.
--   Unknown is an answer: not_visible and cannot_tell are stored and shown as "still open".
--
-- Not here: no producer, no runner, no new key, no write to ingest-observation, no schema_proposals row. A doubt about a
-- key the registry lacks cannot be raised (key_not_registered) until its proposal is approved by a human.
-- Contract: supabase/sql/test_fact_doubt_questions.sql.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- ─── 1. keep the receipt bodies, branch by kind ──────────────────────────────────────────────────────────────────
DO $rename$
BEGIN
  IF to_regprocedure('public.receipt_part_visible_ineligibility(uuid)') IS NULL THEN
    IF to_regprocedure('public.evidence_judgment_ineligibility(uuid)') IS NULL THEN
      RAISE EXCEPTION 'evidence_judgment_ineligibility(uuid) not found; apply 20261111210500 first';
    END IF;
    ALTER FUNCTION public.evidence_judgment_ineligibility(uuid) RENAME TO receipt_part_visible_ineligibility;
  END IF;
  IF to_regprocedure('public.receipt_part_visible_answer_problems(text, jsonb, jsonb)') IS NULL THEN
    IF to_regprocedure('public.evidence_judgment_answer_problems(text, jsonb, jsonb)') IS NULL THEN
      RAISE EXCEPTION 'evidence_judgment_answer_problems(text, jsonb, jsonb) not found; apply 20261111210500 first';
    END IF;
    ALTER FUNCTION public.evidence_judgment_answer_problems(text, jsonb, jsonb) RENAME TO receipt_part_visible_answer_problems;
  END IF;
END
$rename$;

-- ─── 2. the doubt's evidence state and its trigger key ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fact_doubt_evidence_state(p_vehicle_id uuid, p_property_key text,
                                                            p_image_ids uuid[], p_item_ids uuid[])
RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'observations', coalesce((SELECT jsonb_agg(jsonb_build_array(o.id, encode(sha256(convert_to(coalesce(o.structured_data::text, ''), 'UTF8')), 'hex'))
                                               ORDER BY o.id)
                                FROM public.vehicle_observations o
                                JOIN public.observation_properties p ON p.id = o.property_id
                               WHERE o.vehicle_id = p_vehicle_id AND p.property_key = p_property_key
                                 AND o.is_superseded IS NOT TRUE), '[]'::jsonb),
    'image_ids', coalesce((SELECT jsonb_agg(x ORDER BY x) FROM (SELECT DISTINCT i::text AS x FROM unnest(coalesce(p_image_ids, '{}')) i) s), '[]'::jsonb),
    'item_ids', coalesce((SELECT jsonb_agg(x ORDER BY x) FROM (SELECT DISTINCT i::text AS x FROM unnest(coalesce(p_item_ids, '{}')) i) s), '[]'::jsonb))
$$;
COMMENT ON FUNCTION public.fact_doubt_evidence_state(uuid, text, uuid[], uuid[]) IS
  'What a fact_doubt trigger hashes on the database side: the key''s current non-superseded keyed observations (id, value hash) on the vehicle, and the cited frame and receipt-line ids. A new keyed observation or a superseded one changes it; a new photo that is not keyed, a producer version or a clock does not.';

CREATE OR REPLACE FUNCTION public.fact_doubt_trigger_key(p_state jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $$ SELECT encode(sha256(convert_to(p_state::text, 'UTF8')), 'hex') $$;
COMMENT ON FUNCTION public.fact_doubt_trigger_key(jsonb) IS
  'sha256 over the canonical text of a fact_doubt evidence_state (jsonb text is key-sorted). Stored as trigger_evidence_dedupe_key; the same doubt over the same evidence has the same key and is not asked again.';

-- ─── 3. the closed question and answer shapes ────────────────────────────────────────────────────────────────────
-- params: doubt_form 'property' | 'reader_pair'; property_key; origin 'simulated_reader' | 'comment_question' |
-- 'contradiction_check' with origin_ref (the id of the reader run, classified comment or check: the asker's words stay
-- there and are never copied into params, so the answerer reads evidence, not the asker's opinion); cited_image_ids and
-- cited_receipt_item_ids; allowed (null, or the closed list of values); evidence_state {db: fact_doubt_evidence_state,
-- readers: [{reader, ...}] for reader_pair}. No earlier answer may appear in params: a second reader that was told the
-- first answer is not a second reader.
CREATE OR REPLACE FUNCTION public.fact_doubt_params_problems(p_params jsonb) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public
AS $fn$
DECLARE probs text[] := '{}'; k text;
BEGIN
  IF jsonb_typeof(p_params) IS DISTINCT FROM 'object' THEN RETURN ARRAY['params must be an object']; END IF;
  IF p_params ->> 'doubt_form' IS NULL OR p_params ->> 'doubt_form' NOT IN ('property', 'reader_pair') THEN
    probs := array_append(probs, 'doubt_form must be property|reader_pair'); END IF;
  IF nullif(btrim(coalesce(p_params ->> 'property_key', '')), '') IS NULL THEN probs := array_append(probs, 'property_key required'); END IF;
  IF p_params ->> 'origin' IS NULL OR p_params ->> 'origin' NOT IN ('simulated_reader', 'comment_question', 'contradiction_check') THEN
    probs := array_append(probs, 'origin must be simulated_reader|comment_question|contradiction_check'); END IF;
  IF nullif(btrim(coalesce(p_params ->> 'origin_ref', '')), '') IS NULL THEN probs := array_append(probs, 'origin_ref required'); END IF;
  FOREACH k IN ARRAY ARRAY['cited_image_ids', 'cited_receipt_item_ids'] LOOP
    IF jsonb_typeof(p_params -> k) IS DISTINCT FROM 'array'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_params -> k) e
                   WHERE jsonb_typeof(e) <> 'string' OR (e #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
      probs := array_append(probs, k || ' must be an array of uuids');
    END IF;
  END LOOP;
  IF jsonb_typeof(p_params -> 'cited_image_ids') = 'array' AND jsonb_typeof(p_params -> 'cited_receipt_item_ids') = 'array'
     AND jsonb_array_length(p_params -> 'cited_image_ids') + jsonb_array_length(p_params -> 'cited_receipt_item_ids') = 0 THEN
    probs := array_append(probs, 'a doubt cites at least one frame or receipt line');
  END IF;
  IF coalesce(jsonb_typeof(p_params -> 'allowed'), 'null') NOT IN ('null', 'array')
     OR (jsonb_typeof(p_params -> 'allowed') = 'array' AND (jsonb_array_length(p_params -> 'allowed') = 0
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_params -> 'allowed') e WHERE jsonb_typeof(e) <> 'string'))) THEN
    probs := array_append(probs, 'allowed must be null or a non-empty array of strings');
  END IF;
  IF jsonb_typeof(p_params #> '{evidence_state,db}') IS DISTINCT FROM 'object' THEN probs := array_append(probs, 'evidence_state.db required'); END IF;
  IF p_params ->> 'doubt_form' = 'reader_pair'
     AND (jsonb_typeof(p_params #> '{evidence_state,readers}') IS DISTINCT FROM 'array' OR jsonb_array_length(p_params #> '{evidence_state,readers}') < 2) THEN
    probs := array_append(probs, 'reader_pair needs evidence_state.readers with at least two readers');
  END IF;
  IF p_params ?| ARRAY['answer', 'prior_answer', 'previous_answer', 'answer_history'] THEN
    probs := array_append(probs, 'params must not carry an earlier answer');
  END IF;
  RETURN probs;
END
$fn$;

-- Why a fact_doubt can no longer be claimed or answered (empty = eligible). The key must still be registered; every cited
-- frame must still be eligible (receipt_work_frame_eligible: dated, gate-approved, not sensitive, duplicate, superseded or
-- redacted); every cited receipt line must still exist on a current receipt linked to the vehicle; and the keyed evidence
-- must be what was hashed when the doubt was raised. New keyed evidence is a different doubt: this one is refused with
-- evidence_changed, the producer retires it and raises the new one.
CREATE OR REPLACE FUNCTION public.fact_doubt_ineligibility(p_id uuid) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE j evidence_judgment_requests; probs text[]; pid uuid; cid text; x vehicle_images; imgs uuid[]; items uuid[]; db jsonb;
BEGIN
  SELECT * INTO j FROM evidence_judgment_requests WHERE id = p_id;
  IF NOT FOUND THEN RETURN ARRAY['no_request']; END IF;
  probs := fact_doubt_params_problems(j.params);
  IF cardinality(probs) > 0 THEN RETURN ARRAY(SELECT 'params:' || p FROM unnest(probs) p); END IF;
  SELECT p.id INTO pid FROM observation_properties p
   WHERE p.property_key = j.params ->> 'property_key' AND p.ratified_at IS NOT NULL AND p.deprecated_at IS NULL LIMIT 1;
  IF pid IS NULL THEN probs := array_append(probs, 'key_not_registered');
  ELSIF j.subject_table IS DISTINCT FROM 'observation_properties' OR j.subject_id IS DISTINCT FROM pid THEN
    probs := array_append(probs, 'subject_is_not_the_key');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.id = j.vehicle_id AND v.deleted_at IS NULL) THEN probs := array_append(probs, 'vehicle_gone'); END IF;
  imgs := ARRAY(SELECT jsonb_array_elements_text(j.params -> 'cited_image_ids')::uuid);
  items := ARRAY(SELECT jsonb_array_elements_text(j.params -> 'cited_receipt_item_ids')::uuid);
  FOREACH cid IN ARRAY ARRAY(SELECT unnest(imgs)::text) LOOP
    SELECT * INTO x FROM vehicle_images WHERE id = cid::uuid;
    IF NOT FOUND OR x.vehicle_id IS DISTINCT FROM j.vehicle_id OR NOT receipt_work_frame_eligible(x) THEN
      probs := array_append(probs, 'frame_ineligible:' || cid);
    END IF;
  END LOOP;
  FOREACH cid IN ARRAY ARRAY(SELECT unnest(items)::text) LOOP
    IF NOT EXISTS (SELECT 1 FROM receipt_items it JOIN receipts r ON r.id = it.receipt_id
                    JOIN receipt_vehicle_links l ON l.receipt_id = r.id AND l.vehicle_id = j.vehicle_id AND l.status = 'linked' AND l.retired_at IS NULL
                   WHERE it.id = cid::uuid AND NOT coalesce(r.is_superseded, false) AND r.duplicate_of IS NULL) THEN
      probs := array_append(probs, 'line_ineligible:' || cid);
    END IF;
  END LOOP;
  db := fact_doubt_evidence_state(j.vehicle_id, j.params ->> 'property_key', imgs, items);
  IF db IS DISTINCT FROM j.params #> '{evidence_state,db}' THEN probs := array_append(probs, 'evidence_changed'); END IF;
  IF j.trigger_evidence_dedupe_key IS DISTINCT FROM fact_doubt_trigger_key(j.params -> 'evidence_state') THEN
    probs := array_append(probs, 'trigger_key_mismatch');
  END IF;
  RETURN probs;
END
$fn$;
REVOKE ALL ON FUNCTION public.fact_doubt_ineligibility(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fact_doubt_ineligibility(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fact_doubt_answer_problems(p_params jsonb, p_answer jsonb) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public
AS $fn$
DECLARE probs text[] := '{}'; c numeric; outcome text; v jsonb; img jsonb; itm jsonb; n int := 0;
BEGIN
  IF jsonb_typeof(p_answer) IS DISTINCT FROM 'object' THEN RETURN ARRAY['answer must be an object']; END IF;
  outcome := p_answer ->> 'outcome';
  IF outcome IS NULL OR outcome NOT IN ('value', 'not_visible', 'cannot_tell', 'different_measures') THEN
    probs := array_append(probs, 'outcome must be value|not_visible|cannot_tell|different_measures'); END IF;
  IF jsonb_typeof(p_answer -> 'confidence') IS DISTINCT FROM 'number' THEN probs := array_append(probs, 'confidence must be a number');
  ELSE c := (p_answer ->> 'confidence')::numeric; IF c < 0 OR c > 1 THEN probs := array_append(probs, 'confidence must be within 0..1'); END IF;
  END IF;
  img := coalesce(p_answer -> 'image_ids', '[]'::jsonb);
  itm := coalesce(p_answer -> 'receipt_item_ids', '[]'::jsonb);
  IF jsonb_typeof(img) <> 'array' OR EXISTS (SELECT 1 FROM jsonb_array_elements(img) e
       WHERE jsonb_typeof(e) <> 'string' OR NOT coalesce(p_params -> 'cited_image_ids', '[]'::jsonb) ? (e #>> '{}')) THEN
    probs := array_append(probs, 'image_ids must be a subset of cited_image_ids');
  ELSE n := n + jsonb_array_length(img); END IF;
  IF jsonb_typeof(itm) <> 'array' OR EXISTS (SELECT 1 FROM jsonb_array_elements(itm) e
       WHERE jsonb_typeof(e) <> 'string' OR NOT coalesce(p_params -> 'cited_receipt_item_ids', '[]'::jsonb) ? (e #>> '{}')) THEN
    probs := array_append(probs, 'receipt_item_ids must be a subset of cited_receipt_item_ids');
  ELSE n := n + jsonb_array_length(itm); END IF;
  IF coalesce(jsonb_typeof(p_answer -> 'quote'), 'null') NOT IN ('null', 'string') THEN probs := array_append(probs, 'quote must be text'); END IF;
  v := p_answer -> 'value';
  IF outcome = 'value' THEN
    IF coalesce(jsonb_typeof(v), 'null') NOT IN ('string', 'number', 'boolean') THEN probs := array_append(probs, 'outcome value needs a scalar value');
    ELSIF jsonb_typeof(v) = 'string' AND (btrim(v #>> '{}') = '' OR length(v #>> '{}') > 80) THEN probs := array_append(probs, 'value text must be 1..80 characters');
    ELSIF jsonb_typeof(p_params -> 'allowed') = 'array' AND NOT p_params -> 'allowed' ? (v #>> '{}') THEN probs := array_append(probs, 'value must be one of params.allowed');
    END IF;
    IF n = 0 THEN probs := array_append(probs, 'a value needs a witness: an image id or a receipt item id'); END IF;
  ELSIF coalesce(jsonb_typeof(v), 'null') <> 'null' THEN
    probs := array_append(probs, 'value only with outcome value');
  END IF;
  IF outcome = 'different_measures' THEN
    IF p_params ->> 'doubt_form' IS DISTINCT FROM 'reader_pair' THEN probs := array_append(probs, 'different_measures is only for a reader_pair doubt'); END IF;
    IF nullif(btrim(coalesce(p_answer ->> 'quote', '')), '') IS NULL THEN probs := array_append(probs, 'different_measures needs a quote saying what each figure measures'); END IF;
  END IF;
  RETURN probs;
END
$fn$;

-- ─── 4. the gate functions branch by kind (same names, same signatures, same grants) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.evidence_judgment_ineligibility(p_id uuid) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE k text;
BEGIN
  SELECT question_kind INTO k FROM evidence_judgment_requests WHERE id = p_id;
  IF NOT FOUND THEN RETURN ARRAY['no_request']; END IF;
  RETURN CASE k WHEN 'receipt_part_visible' THEN receipt_part_visible_ineligibility(p_id)
                WHEN 'fact_doubt' THEN fact_doubt_ineligibility(p_id)
                ELSE ARRAY['unknown_question_kind'] END;
END
$fn$;

CREATE OR REPLACE FUNCTION public.evidence_judgment_answer_problems(p_question_kind text, p_params jsonb, p_answer jsonb) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public
AS $fn$
BEGIN
  RETURN CASE p_question_kind WHEN 'receipt_part_visible' THEN receipt_part_visible_answer_problems(p_question_kind, p_params, p_answer)
                              WHEN 'fact_doubt' THEN fact_doubt_answer_problems(p_params, p_answer)
                              ELSE ARRAY['unknown question_kind ' || coalesce(p_question_kind, 'null')] END;
END
$fn$;

-- The renamed originals kept their grants; these are new functions under the old names, so the grants are restated:
-- service role only, as before.
REVOKE ALL ON FUNCTION public.evidence_judgment_ineligibility(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evidence_judgment_ineligibility(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.evidence_judgment_answer_problems(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evidence_judgment_answer_problems(text, jsonb, jsonb) TO service_role;

-- ─── 5. what an answer decided; free text made safe to show ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.evidence_judgment_decision_key(p_kind text, p_answer jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_answer) IS DISTINCT FROM 'object' THEN NULL
    WHEN p_kind = 'receipt_part_visible' THEN (p_answer ->> 'visible') || '/' || (p_answer ->> 'installed')
    WHEN p_kind = 'fact_doubt' THEN (p_answer ->> 'outcome') || '/' || coalesce(p_answer ->> 'value', '') END
$$;

-- settled: the answer takes a side. cannot_tell and not_visible are answers and are stored, but the question stays open.
CREATE OR REPLACE FUNCTION public.evidence_judgment_decision_settled(p_kind text, p_answer jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_answer) IS DISTINCT FROM 'object' THEN false
    WHEN p_kind = 'receipt_part_visible' THEN (p_answer ->> 'visible' = 'no')
                                              OR (p_answer ->> 'visible' = 'yes' AND p_answer ->> 'installed' IN ('yes', 'no'))
    WHEN p_kind = 'fact_doubt' THEN p_answer ->> 'outcome' IN ('value', 'different_measures')
    ELSE false END
$$;

CREATE OR REPLACE FUNCTION public.evidence_public_words(p_text text) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$
  SELECT nullif(left(btrim(public.text_redact_contact(
           regexp_replace(regexp_replace(coalesce(p_text, ''), ';? *\ylist *\$?[0-9][0-9,]*(\.[0-9]+)?', '', 'gi'),
                          '\$ ?[0-9][0-9,]*(\.[0-9]+)?', '[amount]', 'g'))), 300), '')
$$;
COMMENT ON FUNCTION public.evidence_public_words(text) IS
  'Free text from a source or an answer, safe to show: contact details removed (text_redact_contact), supplier list prices dropped, any other dollar amount replaced, 300 characters.';

-- ─── 6. the reader ──────────────────────────────────────────────────────────────────────────────────────────────
-- Grain: one question per (kind, receipt line | doubt). Re-asked and retired rows are not questions; they are counted
-- under "retired". States: asked (raised, no answer yet; being_read when a reader holds it), answered (an answer that takes
-- a side, with no earlier reading that decided otherwise), open (answered cannot_tell / not_visible, or readings differ).
-- No amount, vendor, account id or params is returned. Frames are returned only when a visitor may see them. Never calls
-- evidence_judgment_ineligibility (it recomputes receipt_work_lines per row).
CREATE OR REPLACE FUNCTION public.vehicle_open_questions(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH v AS MATERIALIZED (
    SELECT v.id
      FROM public.vehicles v
     WHERE v.id = p_vehicle_id AND v.deleted_at IS NULL
       AND (v.is_public IS TRUE OR auth.role() = 'service_role' OR (auth.uid() IS NOT NULL AND (v.user_id = auth.uid()
            OR v.owner_id = auth.uid() OR v.uploaded_by = auth.uid() OR public.vehicle_user_has_access(v.id, auth.uid()))))),
  live AS MATERIALIZED (
    SELECT DISTINCT ON (j.question_kind, CASE WHEN j.question_kind = 'fact_doubt' THEN j.dedupe_key ELSE j.subject_id::text END)
           j.id, j.question_kind AS kind, j.status, j.subject_id, j.params, j.answer, j.answer_agent, j.answer_model,
           j.answer_version, j.answered_at, j.created_at, j.answer_history, j.trigger_evidence_dedupe_key
      FROM v JOIN public.evidence_judgment_requests j ON j.vehicle_id = v.id AND j.status IN ('pending', 'claimed', 'answered')
     ORDER BY j.question_kind, CASE WHEN j.question_kind = 'fact_doubt' THEN j.dedupe_key ELSE j.subject_id::text END,
              (j.status = 'answered') DESC, j.created_at DESC),
  readings AS (
    -- every reading of a question: the current answer and each earlier one kept in answer_history
    SELECT l.id, public.evidence_judgment_decision_key(l.kind, l.answer) AS dk,
           coalesce(l.answer_agent, '') || '/' || coalesce(l.answer_model, '') AS reader
      FROM live l WHERE l.status = 'answered'
    UNION ALL
    SELECT l.id, public.evidence_judgment_decision_key(l.kind, h.e -> 'answer'),
           coalesce(h.e ->> 'answer_agent', '') || '/' || coalesce(h.e ->> 'answer_model', '')
      FROM live l CROSS JOIN LATERAL jsonb_array_elements(l.answer_history) h(e)
     WHERE jsonb_typeof(h.e -> 'answer') = 'object'),
  ag AS (
    SELECT l.id, count(*) AS readings, count(*) FILTER (WHERE r.dk IS NOT DISTINCT FROM public.evidence_judgment_decision_key(l.kind, l.answer)) AS agreeing,
           count(DISTINCT r.reader) FILTER (WHERE r.dk IS NOT DISTINCT FROM public.evidence_judgment_decision_key(l.kind, l.answer)) AS agreeing_readers
      FROM live l JOIN readings r ON r.id = l.id WHERE l.status = 'answered' GROUP BY l.id),
  s AS (
    SELECT l.*, a.readings, a.agreeing, a.agreeing_readers,
           CASE WHEN l.status <> 'answered' THEN 'asked'
                WHEN NOT public.evidence_judgment_decision_settled(l.kind, l.answer) THEN 'open'
                WHEN a.readings > a.agreeing THEN 'open'
                ELSE 'answered' END AS state,
           (l.kind = 'receipt_part_visible' AND l.params #>> '{context,line_kind}' = 'part') AS bought_part,
           p.label AS key_label,
           -- the frames and lines that witness the answer; a frame only when a visitor may see it
           CASE l.kind WHEN 'receipt_part_visible' THEN CASE WHEN l.answer ->> 'image_id' IS NOT NULL THEN jsonb_build_array(l.answer ->> 'image_id') ELSE '[]'::jsonb END
                       ELSE CASE WHEN jsonb_typeof(l.answer -> 'image_ids') = 'array' THEN l.answer -> 'image_ids' ELSE '[]'::jsonb END END AS wit_images,
           CASE l.kind WHEN 'receipt_part_visible' THEN jsonb_build_array(l.subject_id::text)
                       ELSE CASE WHEN jsonb_typeof(l.answer -> 'receipt_item_ids') = 'array' THEN l.answer -> 'receipt_item_ids' ELSE '[]'::jsonb END END AS wit_items
      FROM live l
      LEFT JOIN ag a ON a.id = l.id
      LEFT JOIN public.observation_properties p ON p.id = l.subject_id AND l.kind = 'fact_doubt'),
  w AS (
    SELECT s.*,
           CASE WHEN s.status <> 'answered' THEN NULL WHEN s.kind = 'receipt_part_visible' THEN
             CASE WHEN s.answer ->> 'visible' = 'no' THEN 'The part is not visible in the candidate photos.'
                  WHEN s.answer ->> 'visible' = 'cannot_tell' THEN 'The photos do not settle whether the part is visible.'
                  WHEN s.answer ->> 'installed' = 'yes' THEN 'The part is visible and installed on the car in the cited photo.'
                  WHEN s.answer ->> 'installed' = 'no' THEN 'The part is visible but is not installed on the car.'
                  ELSE 'The part is visible in the cited photo; whether it is installed cannot be told.' END
             ELSE CASE s.answer ->> 'outcome'
                  WHEN 'value' THEN 'The evidence shows: ' || (s.answer ->> 'value') || '.'
                  WHEN 'not_visible' THEN 'Not visible in the cited photos.'
                  WHEN 'cannot_tell' THEN 'Cannot be told from the cited evidence.'
                  WHEN 'different_measures' THEN 'The two figures measure different things.' END END AS answer_words,
           (SELECT coalesce(jsonb_agg(i.id ORDER BY i.id), '[]'::jsonb)
              FROM public.vehicle_images i
             WHERE i.vehicle_id = p_vehicle_id AND i.id::text IN (SELECT jsonb_array_elements_text(s.wit_images))
               AND public.vehicle_image_gallery_eligible(i) AND coalesce(i.is_sensitive, false) = false
               AND coalesce(i.is_duplicate, false) = false AND coalesce(i.is_superseded, false) = false) AS seen_images
      FROM s)
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v) THEN NULL ELSE jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'as_of', now(),
    'source', 'evidence_judgment_requests (live questions; re-asked and withdrawn rows are counted under retired)',
    'counts', jsonb_build_object(
      'questions', (SELECT count(*) FROM w),
      'asked', (SELECT count(*) FROM w WHERE state = 'asked'),
      'answered', (SELECT count(*) FROM w WHERE state = 'answered'),
      'open', (SELECT count(*) FROM w WHERE state = 'open'),
      'by_kind', (SELECT coalesce(jsonb_agg(jsonb_build_object('kind', k.kind, 'questions', k.n, 'asked', k.a, 'answered', k.d, 'open', k.o) ORDER BY k.kind), '[]'::jsonb)
                    FROM (SELECT kind, count(*) AS n, count(*) FILTER (WHERE state = 'asked') AS a,
                                 count(*) FILTER (WHERE state = 'answered') AS d, count(*) FILTER (WHERE state = 'open') AS o
                            FROM w GROUP BY kind) k),
      'bought_parts', jsonb_build_object(
        'asked_about', (SELECT count(*) FROM w WHERE bought_part),
        'waiting', (SELECT count(*) FROM w WHERE bought_part AND state = 'asked'),
        'seen_installed', (SELECT count(*) FROM w WHERE bought_part AND state = 'answered' AND answer ->> 'visible' = 'yes' AND answer ->> 'installed' = 'yes'),
        'seen_not_installed', (SELECT count(*) FROM w WHERE bought_part AND state = 'answered' AND answer ->> 'visible' = 'yes' AND answer ->> 'installed' = 'no'),
        'not_visible', (SELECT count(*) FROM w WHERE bought_part AND state = 'answered' AND answer ->> 'visible' = 'no'),
        'still_open', (SELECT count(*) FROM w WHERE bought_part AND state = 'open')),
      'retired', (SELECT jsonb_build_object(
                    'rows', count(*),
                    'cancelled', count(*) FILTER (WHERE r.status = 'cancelled'),
                    'withdrawn', count(*) FILTER (WHERE r.status = 'withdrawn'),
                    'replaced_by_changed_question', count(*) FILTER (WHERE r.retire_kind = 'content_changed'))
                    FROM public.evidence_judgment_requests r WHERE r.vehicle_id = p_vehicle_id AND r.status IN ('cancelled', 'withdrawn'))),
    'questions', (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', q.id, 'kind', q.kind, 'state', q.state,
        'question', CASE q.kind WHEN 'receipt_part_visible' THEN 'Is the part on this receipt line visible, installed on this vehicle, in the candidate photos?'
                     ELSE CASE q.params ->> 'doubt_form' WHEN 'reader_pair' THEN 'Two readers disagree about ' || coalesce(q.key_label, q.params ->> 'property_key') || '. Do their figures measure the same thing?'
                          ELSE 'Does the evidence settle ' || coalesce(q.key_label, q.params ->> 'property_key') || ' for this vehicle?' END END,
        'subject', CASE q.kind WHEN 'receipt_part_visible' THEN public.evidence_public_words(q.params ->> 'description') ELSE coalesce(q.key_label, q.params ->> 'property_key') END,
        'receipt_item_id', CASE WHEN q.kind = 'receipt_part_visible' THEN q.subject_id END,
        'property_key', CASE WHEN q.kind = 'fact_doubt' THEN q.params ->> 'property_key' END,
        'raised_by', CASE WHEN q.kind = 'fact_doubt' THEN q.params ->> 'origin' ELSE 'receipt_work_reconciliation' END,
        'readers_named', CASE WHEN q.params ->> 'doubt_form' = 'reader_pair' THEN (SELECT jsonb_agg(e ->> 'reader') FROM jsonb_array_elements(q.params #> '{evidence_state,readers}') e) END,
        'asked_at', q.created_at,
        'being_read', CASE WHEN q.status = 'claimed' THEN true END,
        'evidence_trigger', left(q.trigger_evidence_dedupe_key, 16),
        'answer', CASE WHEN q.status = 'answered' THEN jsonb_build_object(
            'words', q.answer_words, 'confidence', q.answer -> 'confidence', 'quote', public.evidence_public_words(q.answer ->> 'quote'),
            'answered_at', q.answered_at, 'answered_by', q.answer_agent, 'answer_version', q.answer_version) END,
        'witnesses', CASE WHEN q.status = 'answered' THEN jsonb_build_object('image_ids', q.seen_images, 'receipt_item_ids', q.wit_items) END,
        'readings', CASE WHEN q.status = 'answered' THEN jsonb_build_object(
            'count', q.readings, 'agreeing', q.agreeing, 'independent_readers_agreeing', q.agreeing_readers,
            'verdict', CASE WHEN q.readings = 1 THEN 'one reading' WHEN q.readings > q.agreeing THEN 'readings differ'
                            WHEN q.agreeing_readers >= 2 THEN 'agreed by independent readers' ELSE 'same reader again' END) END
      )) ORDER BY CASE q.state WHEN 'open' THEN 0 WHEN 'asked' THEN 1 ELSE 2 END, q.answered_at DESC NULLS LAST, q.created_at DESC, q.id), '[]'::jsonb)
        FROM (SELECT * FROM w ORDER BY CASE state WHEN 'open' THEN 0 WHEN 'asked' THEN 1 ELSE 2 END, answered_at DESC NULLS LAST, created_at DESC, id LIMIT 300) q)
  ) END
$$;
COMMENT ON FUNCTION public.vehicle_open_questions(uuid) IS
  'What a vehicle has been asked and what came back, from the question store (evidence_judgment_requests): per question its state (asked | answered | open), the answer in plain words with its witnesses (frames only when a visitor may see them) and how many independent readers agree; counts by kind and for bought parts; retired questions counted apart. No amount, vendor, account or raw params. Same vehicle visibility as vehicle_build_reconstruction: public, or the signed-in owner or a granted user, or service role; null otherwise. At most 300 questions, open first. Read-only.';

REVOKE ALL ON FUNCTION public.vehicle_open_questions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_open_questions(uuid) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fact_doubt_evidence_state(uuid, text, uuid[], uuid[]), public.fact_doubt_trigger_key(jsonb),
  public.fact_doubt_params_problems(jsonb), public.fact_doubt_answer_problems(jsonb, jsonb),
  public.evidence_judgment_decision_key(text, jsonb), public.evidence_judgment_decision_settled(text, jsonb),
  public.evidence_public_words(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fact_doubt_evidence_state(uuid, text, uuid[], uuid[]), public.fact_doubt_trigger_key(jsonb),
  public.fact_doubt_params_problems(jsonb), public.fact_doubt_answer_problems(jsonb, jsonb),
  public.evidence_judgment_decision_key(text, jsonb), public.evidence_judgment_decision_settled(text, jsonb),
  public.evidence_public_words(text) TO service_role;

RESET lock_timeout;
RESET statement_timeout;
