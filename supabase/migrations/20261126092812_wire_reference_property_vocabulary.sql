-- Extend the existing measured vocabulary gate with exact retained-document
-- witnesses. This files one OPEN concept proposal; values and engineering
-- applicability are not admitted. Ratification goes through the existing gate.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';
DO $guard$
BEGIN
 IF to_regprocedure('public.reference_document_evidence(uuid)') IS NULL THEN
  RAISE EXCEPTION 'Qualified reference custody prerequisite missing';
 END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.schema_proposal_key_gate(uuid[])'::regprocedure)
    IS DISTINCT FROM 'b8e33272b291d10bd6e40c7a3bd3bfbb' THEN
  RAISE EXCEPTION 'Measured vocabulary gate drift: inspect before adding reference witnesses';
 END IF;
 IF EXISTS (SELECT FROM public.schema_proposal_witness_sources WHERE source_table='document_pages'
   AND (text_column IS DISTINCT FROM 'extracted_text' OR generated_marker_column IS NOT NULL))
 OR EXISTS (SELECT FROM public.schema_proposal_quote_rules WHERE category='wiring') THEN
  RAISE EXCEPTION 'Reference witness or wiring quote profile already has another owner';
 END IF;
END $guard$;
INSERT INTO public.schema_proposal_witness_sources(source_table,text_column,generated_marker_column,note)
VALUES('document_pages','extracted_text',NULL,
 'Only canonical supplied_visual_reference_v1 pages in a current qualified public document, with exact document/revision/file binding; enforced by schema_proposal_key_gate.');
INSERT INTO public.schema_proposal_quote_rules(category,term_pattern,figure_required,min_quote_chars,basis)
VALUES('wiring','(resistance|ohms?|voltage|amps?|ampere|conductor)',true,21,
 'A quoted electrical concept and figure establish vocabulary need only. Source qualification binds exact reviewed pages. This does not admit a value, infer applicability or approve electrical construction.');

CREATE OR REPLACE FUNCTION public.schema_proposal_key_gate(p_proposal_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  pr public.schema_proposals%ROWTYPE;
  ev jsonb;
  src public.schema_proposal_witness_sources%ROWTYPE;
  document_evidence jsonb;
  qr public.schema_proposal_quote_rules%ROWTYPE;
  generated boolean;
  txt text;
  num text;
  reasons text[];
  all_reasons text[] := '{}';
  per jsonb := '[]'::jsonb;
  cites jsonb;
  n_proto int;
  agents text[];
  kinds text[];
  cats text[];
  props_before bigint;
  props_after bigint;
  hash_before text;
  hash_after text;
  measure jsonb;
  decision text;
BEGIN
  IF p_proposal_ids IS NULL OR cardinality(p_proposal_ids) = 0 THEN
    RAISE EXCEPTION 'schema_proposal_key_gate: no proposal ids';
  END IF;
  PERFORM 1 FROM public.schema_proposals WHERE id = ANY (p_proposal_ids) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM public.schema_proposals WHERE id = ANY (p_proposal_ids))
     <> (SELECT count(DISTINCT x) FROM unnest(p_proposal_ids) x) THEN
    RAISE EXCEPTION 'schema_proposal_key_gate: unknown proposal id';
  END IF;
  SELECT array_agg(DISTINCT coalesce(proposed_by_agent_key, '')) INTO agents
    FROM public.schema_proposals WHERE id = ANY (p_proposal_ids);
  IF cardinality(agents) <> 1 OR agents[1] = '' THEN
    all_reasons := all_reasons || 'one_agent_per_call'::text;
  END IF;
  SELECT array_agg(e.enumlabel::text) INTO kinds FROM pg_enum e WHERE e.enumtypid = 'public.observation_kind'::regtype;
  SELECT array_agg(e.enumlabel::text) INTO cats FROM pg_enum e WHERE e.enumtypid = 'public.source_category'::regtype;

  FOR pr IN SELECT * FROM public.schema_proposals WHERE id = ANY (p_proposal_ids) ORDER BY id LOOP
    reasons := '{}';
    cites := '[]'::jsonb;
    IF pr.status <> 'open' THEN reasons := reasons || ('status_' || pr.status); END IF;
    IF pr.proposal_type <> 'add_property' THEN reasons := reasons || 'not_add_property'::text; END IF;
    IF pr.proposed_by_user_id IS NOT NULL OR pr.proposed_by_agent_key IS NULL THEN
      reasons := reasons || 'not_an_agent_proposal'::text;
    END IF;
    IF coalesce(pr.payload->>'property_key', '') !~ '^[a-z][a-z0-9_]{1,62}$' THEN
      reasons := reasons || 'key_shape'::text;
    ELSIF EXISTS (SELECT 1 FROM public.observation_properties p WHERE p.property_key = pr.payload->>'property_key') THEN
      reasons := reasons || 'key_exists'::text;
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(pr.payload->'applies_to_kinds', '[]'::jsonb)) k
                WHERE k <> ALL (kinds)) THEN
      reasons := reasons || 'applies_to_kinds_unknown'::text;
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(pr.payload->'expected_source_categories', '[]'::jsonb)) c
                WHERE c <> ALL (cats)) THEN
      reasons := reasons || 'source_categories_unknown'::text;
    END IF;

    SELECT * INTO qr FROM public.schema_proposal_quote_rules WHERE category = pr.payload->>'category';
    IF NOT FOUND THEN reasons := reasons || 'no_quote_rule'::text; END IF;

    n_proto := 0;
    FOR ev IN SELECT e FROM jsonb_array_elements(coalesce(pr.evidence, '[]'::jsonb)) e WHERE e->>'role' = 'prototype_row' LOOP
      n_proto := n_proto + 1;
      txt := NULL;
      document_evidence := NULL;
      SELECT * INTO src FROM public.schema_proposal_witness_sources WHERE source_table = ev->>'source_table';
      IF NOT FOUND THEN
        cites := cites || jsonb_build_object('row_id', ev->>'row_id', 'source_table', ev->>'source_table', 'check', 'source_table_not_allowed');
        reasons := reasons || 'citation_source_not_allowed'::text;
        CONTINUE;
      END IF;
      IF coalesce(ev->>'row_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        cites := cites || jsonb_build_object('row_id', ev->>'row_id', 'source_table', src.source_table, 'check', 'row_id_shape');
        reasons := reasons || 'citation_row_missing'::text;
        CONTINUE;
      END IF;
      -- A page is admissible only inside its current reviewed public PDF
      -- revision. Registering the table never admits arbitrary extracted text.
      IF src.source_table = 'document_pages' THEN
        SELECT public.reference_document_evidence(p.document_id) INTO document_evidence
          FROM public.document_pages p WHERE p.id = (ev->>'row_id')::uuid
           AND p.extraction_method = 'supplied_visual_reference_v1';
        IF document_evidence IS NULL THEN
          cites := cites || jsonb_build_object('row_id', ev->>'row_id', 'source_table', src.source_table,
                                               'check', 'reference_not_current');
          reasons := reasons || 'citation_reference_not_current'::text;
          CONTINUE;
        END IF;
        IF ev->>'document_id' IS DISTINCT FROM document_evidence->>'document_id'
           OR ev->>'reference_revision' IS DISTINCT FROM document_evidence->>'reference_revision'
           OR ev->>'file_sha256' IS DISTINCT FROM document_evidence->>'file_sha256' THEN
          cites := cites || jsonb_build_object('row_id', ev->>'row_id', 'source_table', src.source_table,
                                               'check', 'reference_binding_mismatch');
          reasons := reasons || 'citation_reference_binding_mismatch'::text;
          CONTINUE;
        END IF;
      END IF;
      EXECUTE format('SELECT %I::text FROM public.%I WHERE id = $1', src.text_column, src.source_table)
         INTO txt USING (ev->>'row_id')::uuid;
      IF txt IS NULL THEN
        cites := cites || jsonb_build_object('row_id', ev->>'row_id', 'source_table', src.source_table, 'check', 'row_missing');
        reasons := reasons || 'citation_row_missing'::text;
        CONTINUE;
      END IF;
      IF src.generated_marker_column IS NOT NULL THEN
        EXECUTE format('SELECT %I IS NOT NULL FROM public.%I WHERE id = $1', src.generated_marker_column, src.source_table)
           INTO generated USING (ev->>'row_id')::uuid;
        IF generated THEN
          cites := cites || jsonb_build_object('row_id', ev->>'row_id', 'source_table', src.source_table, 'check', 'row_generated');
          reasons := reasons || 'citation_row_generated'::text;
          CONTINUE;
        END IF;
      END IF;
      IF qr.category IS NOT NULL THEN
        IF length(btrim(coalesce(ev->>'quote', ''))) < qr.min_quote_chars THEN
          cites := cites || jsonb_build_object('row_id', ev->>'row_id', 'source_table', src.source_table, 'check', 'quote_too_short');
          reasons := reasons || 'citation_quote_too_short'::text;
          CONTINUE;
        END IF;
        IF ev->>'quote' !~* qr.term_pattern THEN
          cites := cites || jsonb_build_object('row_id', ev->>'row_id', 'source_table', src.source_table, 'check', 'quote_no_term');
          reasons := reasons || 'citation_quote_no_term'::text;
          CONTINUE;
        END IF;
        IF qr.figure_required AND ev->>'quote' !~ '[0-9]' THEN
          cites := cites || jsonb_build_object('row_id', ev->>'row_id', 'source_table', src.source_table, 'check', 'quote_no_figure');
          reasons := reasons || 'citation_quote_no_figure'::text;
          CONTINUE;
        END IF;
      END IF;
      -- verbatim, on word boundaries: the characters either side of the quote are not letters or digits
      IF position(ev->>'quote' IN txt) = 0
         OR substr(txt, position(ev->>'quote' IN txt) - 1, 1) ~ '[[:alnum:]]'
         OR substr(txt, position(ev->>'quote' IN txt) + length(ev->>'quote'), 1) ~ '[[:alnum:]]' THEN
        cites := cites || jsonb_build_object('row_id', ev->>'row_id', 'source_table', src.source_table, 'check', 'quote_not_in_row');
        reasons := reasons || 'citation_quote_not_in_row'::text;
        CONTINUE;
      END IF;
      FOR num IN SELECT m[1] FROM regexp_matches(coalesce(ev->>'reads', ''), '(?:low|high)=([0-9]+(?:\.[0-9]+)?)', 'g') m LOOP
        IF NOT EXISTS (SELECT 1 FROM regexp_matches(ev->>'quote', '[0-9]+(?:\.[0-9]+)?', 'g') q
                        WHERE q[1]::numeric = num::numeric) THEN
          cites := cites || jsonb_build_object('row_id', ev->>'row_id', 'source_table', src.source_table, 'check', 'read_number_not_in_quote', 'number', num);
          reasons := reasons || 'citation_read_not_in_quote'::text;
        END IF;
      END LOOP;
      IF NOT (cites @> jsonb_build_array(jsonb_build_object('row_id', ev->>'row_id'))) THEN
        cites := cites || (jsonb_build_object('row_id', ev->>'row_id', 'source_table', src.source_table, 'check', 'verbatim',
                                             'text_md5', md5(txt)) ||
          CASE WHEN document_evidence IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
            'document_id', document_evidence->>'document_id',
            'reference_revision', document_evidence->>'reference_revision',
            'file_sha256', document_evidence->>'file_sha256',
            'page_text_sha256', encode(extensions.digest(txt, 'sha256'), 'hex')) END);
      END IF;
    END LOOP;
    IF n_proto = 0 THEN reasons := reasons || 'no_prototype_row'::text; END IF;

    per := per || jsonb_build_object('proposal_id', pr.id, 'property_key', pr.payload->>'property_key',
                                     'prototype_rows', n_proto, 'citations', cites,
                                     'reasons', to_jsonb(ARRAY(SELECT DISTINCT r FROM unnest(reasons) r ORDER BY r)));
    all_reasons := all_reasons || reasons;
  END LOOP;

  decision := CASE WHEN cardinality(all_reasons) = 0 THEN 'ratified' ELSE 'refused' END;
  PERFORM set_config('nuke.schema_proposal_key_gate', 'on', true);
  measure := jsonb_build_object(
    'basis', 'schema_proposal_key_gate_v1', 'measured_at', now(), 'decision', decision,
    'proposals', per,
    'not_assessed', jsonb_build_array('enum allowed values: held only in the description text'),
    'reasons', to_jsonb(ARRAY(SELECT DISTINCT r FROM unnest(all_reasons) r ORDER BY r)));

  IF decision = 'ratified' THEN
   BEGIN  -- the registry's own constraints (data_type, cardinality, namespace, scope) decide in a subtransaction
    SELECT count(*), md5(coalesce(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), ''))
      INTO props_before, hash_before FROM public.observation_properties p;
    UPDATE public.schema_proposals
       SET status = 'approved', resolved_at = now(), gate_measure = measure,
           decision_rationale = 'schema_proposal_key_gate_v1: measured key scope and verbatim citations; no person reviewed'
     WHERE id = ANY (p_proposal_ids);
    FOR pr IN SELECT * FROM public.schema_proposals WHERE id = ANY (p_proposal_ids) ORDER BY id LOOP
      PERFORM public.fn_schema_proposal_apply(pr.id);
    END LOOP;
    SELECT count(*), md5(coalesce(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), ''))
      INTO props_after, hash_after FROM public.observation_properties p
     WHERE coalesce(p.proposed_by_proposal_id <> ALL (p_proposal_ids), true);
    IF props_after <> props_before OR hash_after <> hash_before THEN
      RAISE EXCEPTION 'schema_proposal_key_gate: a ratified property moved during apply' USING ERRCODE = '23514';
    END IF;
   EXCEPTION WHEN check_violation OR invalid_text_representation OR unique_violation OR not_null_violation THEN
    decision := 'refused';
    measure := measure || jsonb_build_object('decision', decision,
                 'reasons', (measure->'reasons') || to_jsonb('apply_refused: ' || SQLERRM));
    UPDATE public.schema_proposals SET gate_measure = measure WHERE id = ANY (p_proposal_ids) AND status = 'open';
   END;
  ELSE
    -- a refusal never overwrites the measure that ratified an approved row
    UPDATE public.schema_proposals SET gate_measure = measure WHERE id = ANY (p_proposal_ids) AND status = 'open';
  END IF;
  PERFORM set_config('nuke.schema_proposal_key_gate', 'off', true);
  RETURN measure;
END $fn$;
COMMENT ON FUNCTION public.schema_proposal_key_gate(uuid[]) IS
 'Measured all-or-nothing vocabulary ratification, not a human decision: existing key scope/verbatim rules plus current retained public-document/page/revision witnesses. No numerical or installed-state claim admission. Service role only.';

DO $proposal$
DECLARE pid constant uuid := '1b91df64-a041-47f6-b7aa-dadf4c00e918';
BEGIN
 IF EXISTS (SELECT FROM public.observation_properties WHERE property_key='wire_dc_resistance_per_length')
 OR EXISTS (SELECT FROM public.schema_proposals WHERE id=pid) THEN
  RAISE EXCEPTION 'Resistance vocabulary or proposal already exists; inspect its owner';
 END IF;
 INSERT INTO public.schema_proposals(id,proposed_by_agent_key,proposal_type,payload,evidence,estimated_scope,backward_compatibility)
 VALUES(pid,'codex-wire-reference-properties','add_property',
 $payload${"property_key":"wire_dc_resistance_per_length","label":"Published wire DC resistance per length","data_type":"numeric","unit":"ohm_per_m","namespace_request":"core","category":"wiring","applies_to_kinds":["specification"],"cardinality":"multi","discriminator_key":"wire_condition_key","expected_source_categories":["documentation"],"verification_scope":"class","description":"Attributed published DC resistance per unit length for a specified wire class and gauge under explicit conductor temperature and maximum or nominal value role. Numeric values use ohm per metre; preserve each source quantity, unit, lexical token, part/size designation and exact retained page witnesses. The discriminator wire_condition_key must identify typed wire specification, AWG gauge, conductor temperature and value role. A repeated or dual-unit cell from one page is not independent support; inconsistent source cells remain visible. This is not ampacity, a fuse rating, an installed-wire measurement or an electrical/build/purchase release. Conditional claim intake and harness applicability must be separately enforced."}$payload$::jsonb,
 $evidence$[{"role":"prototype_row","source_table":"document_pages","row_id":"344e1e76-dccc-4117-a712-c155724b0fd2","document_id":"81e85839-b5ba-464f-bbfe-3290af0f634d","reference_revision":"a1a24cfbdc0d99a51acedc77fa58a6bf09b9d42919d17151511f499a31f0988d","file_sha256":"f65b07d18d4904d4ffa8fdc2bf536fcde9dd1d741a37512beee6c018e2091f59","quote":"Dimensions, Resistance, and Weights—M22759/16 (tin-plated copper conductor)","reads":"A manufacturer material-class table needs a conditioned resistance property; this proposal admits no numerical reading."},{"role":"prototype_row","source_table":"document_pages","row_id":"344e1e76-dccc-4117-a712-c155724b0fd2","document_id":"81e85839-b5ba-464f-bbfe-3290af0f634d","reference_revision":"a1a24cfbdc0d99a51acedc77fa58a6bf09b9d42919d17151511f499a31f0988d","file_sha256":"f65b07d18d4904d4ffa8fdc2bf536fcde9dd1d741a37512beee6c018e2091f59","quote":"Resistance in Ω/1,000 feet (Ω/Km), @20˚ C.","reads":"Source units and temperature belong to the reading context; the property unit is normalized, not a replacement for the source cells."}]$evidence$::jsonb,
 '{"scope":"material class, not a vehicle instance","source_documents":1,"source_pages":1,"numerical_claims_admitted":0,"intake":"requires separately enforced conditioned reference property profile"}',
 '{"human_reviews_written":0,"electrical_properties_changed":0,"vehicle_claims_written":0,"existing_wire_gauge_and_specification":"unchanged instance semantics"}');
END $proposal$;
COMMIT;
