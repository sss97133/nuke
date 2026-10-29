-- Books-evidence profiles are public; privacy is masking of line items (owner, 2026-10-27: "why make the profiles private?
-- there's line items that are profile within the profile").
--
-- What this changes:
--  1. create_vehicle_from_books creates a PUBLIC profile (was is_public=false, which hid the car itself).
--  2. set_vehicle_visibility may publish a profile the owner's books created (provenance_metadata.created_from_books)
--     on source.type owner_profile_rule, with no captured lot page (a books-only car has none). Everything else about it
--     (expected value, cited source, audit entry, visibility lock) is unchanged.
--  3. mask_vehicle_provenance_refs(vehicle): vehicles.provenance_metadata is readable by anon, and the cited-correction
--     source refs written from books, email and bank evidence carried the buyer's name and amounts in free text. Each such
--     ref moves, whole, into a private vehicle_documents row (document_type provenance_citation) and the public entry keeps
--     only {type, ref: private:<document id>, masked}. Nothing is deleted; the visible record loses names.
--  4. link_books_to_vehicles: facts may be RECONCILED cells (scripts/books/vehicle_evidence.py: candidates from agreements,
--     bank memos, ledgers and email, combined per vehicle and event) as well as single-decision cells. The citation it writes
--     is ids and counts only, and it masks every vehicle it touched.
--  5. vehicle_sale_citation labels a reconciled sale "reconciled from N records" with its disagreement count, never a name,
--     amount or ref.
-- No data is written by this migration.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.create_vehicle_from_books(p_owner_id uuid, p_vin text, p_year integer, p_make text, p_model text, p_source jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_vin text := upper(btrim(p_vin)); v_id uuid; v_existing uuid;
BEGIN
  IF p_owner_id IS NULL OR NOT EXISTS (SELECT 1 FROM financial_documents d WHERE d.owner_id = p_owner_id LIMIT 1) THEN
    RAISE EXCEPTION 'create_vehicle_from_books: % has no books', p_owner_id;
  END IF;
  IF p_source IS NULL OR (p_source ->> 'ref') IS NULL THEN
    RAISE EXCEPTION 'create_vehicle_from_books: a vehicle created from the books needs a cited source with a ref';
  END IF;
  IF v_vin !~ '^[A-Z0-9]{5,17}$' OR p_make IS NULL OR p_model IS NULL OR p_year IS NULL OR p_year NOT BETWEEN 1885 AND 2100 THEN
    RAISE EXCEPTION 'create_vehicle_from_books: VIN, year, make and model are required';
  END IF;
  SELECT id INTO v_existing FROM vehicles WHERE vin = v_vin AND deleted_at IS NULL AND merged_into_vehicle_id IS NULL ORDER BY created_at LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'exists', 'vehicle_id', v_existing);
  END IF;
  INSERT INTO vehicles (year, make, model, vin, owner_id, uploaded_by, is_public, provenance_metadata)
  VALUES (p_year, p_make, p_model, v_vin, p_owner_id, p_owner_id, true,
          jsonb_build_object('created_from_books', p_source || jsonb_build_object('created_at', now())))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('status', 'created', 'vehicle_id', v_id);
END
$$;
COMMENT ON FUNCTION public.create_vehicle_from_books(uuid, text, integer, text, text, jsonb) IS
  'Public vehicle profile for a car the owner''s books cite and Nuke does not hold; cited, idempotent on VIN, service role only. Private facts are masked line items, never a private profile.';

CREATE OR REPLACE FUNCTION public.set_vehicle_visibility(p_rows jsonb, p_asserted_by text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_writer     CONSTANT text := 'set_vehicle_visibility';
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  v_row        jsonb;
  v_id         uuid;
  v_value      boolean;
  v_expected   boolean;
  v_source     jsonb;
  v_veh        vehicles%ROWTYPE;
  v_doc_url    text;
  v_doc_status integer;
  v_doc_key    text;
  v_cite       jsonb;
  v_entry      jsonb;
  v_meta       jsonb;
  v_hits       jsonb;
  v_changed    integer := 0;
  v_noop       integer := 0;
  v_stale      jsonb := '[]'::jsonb;
  v_missing    jsonb := '[]'::jsonb;
  v_deleted    jsonb := '[]'::jsonb;
BEGIN
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION '%: caller must set statement_timeout between 1 ms and 60 s (now % ms)', c_writer, v_timeout_ms;
  END IF;
  PERFORM set_config('lock_timeout', '3s', true);
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 OR jsonb_array_length(p_rows) > 200 THEN
    RAISE EXCEPTION '%: p_rows must be a JSON array of 1 to 200 rows', c_writer;
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION '%: a reason of at least 10 characters is required', c_writer;
  END IF;
  IF coalesce(btrim(p_asserted_by), '') = '' THEN
    RAISE EXCEPTION '%: p_asserted_by is required', c_writer;
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF NOT coalesce(pg_input_is_valid(v_row ->> 'vehicle_id', 'uuid'), false)
       OR jsonb_typeof(v_row -> 'value') <> 'boolean' OR jsonb_typeof(v_row -> 'expected') <> 'boolean' THEN
      RAISE EXCEPTION '%: each row needs vehicle_id (uuid), value and expected (booleans): %', c_writer, v_row;
    END IF;
    v_id := (v_row ->> 'vehicle_id')::uuid;
    v_value := (v_row ->> 'value')::boolean;
    v_expected := (v_row ->> 'expected')::boolean;
    v_source := v_row -> 'source';
    IF v_source IS NULL OR jsonb_typeof(v_source) <> 'object' OR coalesce(btrim(v_source ->> 'type'), '') = ''
       OR coalesce(btrim(v_source ->> 'ref'), '') = '' OR coalesce(btrim(v_source ->> 'basis'), '') = '' THEN
      RAISE EXCEPTION '%: vehicle % has no cited source (source.type, source.ref and source.basis)', c_writer, v_id;
    END IF;
    -- pg_input_is_valid(NULL, ...) is NULL, not false: a missing snapshot_id must refuse too.
    -- A profile is public by rule; privacy is masking of line items inside it. A profile the owner's books created
    -- (provenance_metadata.created_from_books) is published on that rule with no lot page: source.type owner_profile_rule.
    IF v_value AND NOT coalesce(pg_input_is_valid(v_source ->> 'snapshot_id', 'uuid'), false)
       AND NOT (v_source ->> 'type' = 'owner_profile_rule'
                AND EXISTS (SELECT 1 FROM vehicles b WHERE b.id = v_id AND b.provenance_metadata ? 'created_from_books')) THEN
      RAISE EXCEPTION '%: vehicle %: publishing must cite a captured lot page (source.snapshot_id)', c_writer, v_id;
    END IF;

    SELECT * INTO v_veh FROM vehicles WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN v_missing := v_missing || to_jsonb(v_id); CONTINUE; END IF;
    IF v_veh.deleted_at IS NOT NULL OR v_veh.merged_into_vehicle_id IS NOT NULL OR v_veh.status = 'merged' THEN
      v_deleted := v_deleted || to_jsonb(v_id); CONTINUE;
    END IF;
    IF v_veh.is_public IS NOT DISTINCT FROM v_value THEN v_noop := v_noop + 1; CONTINUE; END IF;
    IF v_veh.is_public IS DISTINCT FROM v_expected THEN
      v_stale := v_stale || jsonb_build_object('vehicle_id', v_id, 'live', v_veh.is_public, 'expected', v_expected);
      CONTINUE;
    END IF;

    v_cite := NULL;
    IF coalesce(pg_input_is_valid(v_source ->> 'snapshot_id', 'uuid'), false) THEN
      SELECT s.listing_url, s.http_status INTO v_doc_url, v_doc_status
        FROM listing_page_snapshots s WHERE s.id = (v_source ->> 'snapshot_id')::uuid;
      IF NOT FOUND OR v_doc_status IS DISTINCT FROM 200 THEN
        RAISE EXCEPTION '%: vehicle % cites snapshot % which is not an HTTP-200 listing_page_snapshots row',
          c_writer, v_id, v_source ->> 'snapshot_id';
      END IF;
      v_doc_key := lower(regexp_replace(regexp_replace(regexp_replace(btrim(v_doc_url), '[?#].*$', ''),
                     '^(https?://)?(www\.)?', '', 'i'), '/+$', ''));
      SELECT jsonb_build_object('snapshot_id', v_source ->> 'snapshot_id', 'snapshot_url', v_doc_url,
                                'event_id', e.id, 'episode_url', e.source_url) INTO v_cite
        FROM vehicle_events e
       WHERE e.vehicle_id = v_id
         AND lower(regexp_replace(regexp_replace(regexp_replace(btrim(e.source_url), '[?#].*$', ''),
               '^(https?://)?(www\.)?', '', 'i'), '/+$', '')) = v_doc_key
       LIMIT 1;
      IF v_cite IS NULL THEN
        RAISE EXCEPTION '%: vehicle % cites snapshot % (%), which is not the page of any of its lots',
          c_writer, v_id, v_source ->> 'snapshot_id', v_doc_url;
      END IF;
    END IF;

    v_entry := jsonb_build_object('field', 'is_public', 'original', v_veh.is_public, 'corrected', v_value,
      'source', v_source, 'citation_match', v_cite, 'reason', btrim(p_reason), 'asserted_by', btrim(p_asserted_by),
      'writer', c_writer, 'at', now());
    v_meta := coalesce(v_veh.provenance_metadata, '{}'::jsonb);
    v_meta := v_meta
      || jsonb_build_object('visibility_corrections',
           CASE WHEN jsonb_typeof(v_meta -> 'visibility_corrections') = 'array' THEN v_meta -> 'visibility_corrections'
                ELSE '[]'::jsonb END || jsonb_build_array(v_entry))
      || jsonb_build_object('visibility_locked_by_correction', jsonb_build_object('value', v_value, 'writer', c_writer,
           'at', now(), 'rule', 'is_public changes only through set_vehicle_visibility on this row'));

    PERFORM set_config('app.writer', c_writer, true);
    UPDATE vehicles SET is_public = v_value, provenance_metadata = v_meta WHERE id = v_id;
    v_changed := v_changed + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'changed', v_changed, 'noop', v_noop, 'stale', v_stale,
    'missing', v_missing, 'deleted', v_deleted);
END;
$function$;


CREATE OR REPLACE FUNCTION public.mask_vehicle_provenance_refs(p_vehicle_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_meta jsonb; v_key text; v_arr jsonb; v_new jsonb; v_e jsonb; v_src jsonb; v_doc uuid; v_n int := 0; v_owner uuid;
  v_url text; v_text text;
BEGIN
  SELECT provenance_metadata, coalesce(owner_id, user_id, uploaded_by) INTO v_meta, v_owner FROM vehicles WHERE id = p_vehicle_id;
  IF v_meta IS NULL OR v_owner IS NULL THEN RETURN 0; END IF;
  FOR v_key IN SELECT k FROM jsonb_object_keys(v_meta) k WHERE k LIKE '%\_corrections' AND jsonb_typeof(v_meta -> k) = 'array' LOOP
    v_arr := v_meta -> v_key; v_new := '[]'::jsonb;
    FOR v_e IN SELECT x FROM jsonb_array_elements(v_arr) x LOOP
      v_src := v_e -> 'source';
      IF jsonb_typeof(v_src) = 'object' AND coalesce(v_src ->> 'masked', 'false') <> 'true'
         AND v_src ->> 'type' ~ '^(books|gmail|email|bank|document|receipt|ledger)'
         AND coalesce(v_src ->> 'ref', '') <> '' AND (v_src ->> 'ref') !~ '^(private:|financial_documents/)' THEN
        v_text := v_src::text;
        v_url := 'nuke-provenance://' || p_vehicle_id || '/' || encode(extensions.digest(v_text, 'sha256'), 'hex');
        SELECT id INTO v_doc FROM vehicle_documents WHERE vehicle_id = p_vehicle_id AND file_url = v_url;
        IF v_doc IS NULL THEN
          INSERT INTO vehicle_documents (vehicle_id, uploaded_by, document_type, title, description, file_url, file_type, privacy_level)
          VALUES (p_vehicle_id, v_owner, 'provenance_citation', left('Cited source for ' || coalesce(v_e ->> 'field', 'field') || ' ' || coalesce(v_e ->> 'asserted_at', ''), 200),
                  left(v_text, 4000), v_url, 'provenance/citation', 'private')
          RETURNING id INTO v_doc;
        END IF;
        v_e := jsonb_set(v_e, '{source}', jsonb_build_object('type', v_src ->> 'type', 'ref', 'private:' || v_doc, 'masked', true));
        v_n := v_n + 1;
      END IF;
      v_new := v_new || jsonb_build_array(v_e);
    END LOOP;
    v_meta := jsonb_set(v_meta, ARRAY[v_key], v_new);
  END LOOP;
  IF v_n > 0 THEN
    UPDATE vehicles SET provenance_metadata = v_meta WHERE id = p_vehicle_id;
  END IF;
  RETURN v_n;
END
$$;
REVOKE ALL ON FUNCTION public.mask_vehicle_provenance_refs(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mask_vehicle_provenance_refs(uuid) TO service_role;
COMMENT ON FUNCTION public.mask_vehicle_provenance_refs(uuid) IS
  'Moves the free-text source of cited books, email and bank corrections out of the anon-readable provenance_metadata into a private vehicle_documents row; the entry keeps type and private:<id>. Idempotent.';

CREATE OR REPLACE FUNCTION public.link_books_to_vehicles(p_owner_id uuid DEFAULT NULL, p_apply boolean DEFAULT false, p_limit integer DEFAULT 2000)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c record; f record; v vehicles%ROWTYPE;
  v_url text; v_n_cit int := 0; v_docs_new int := 0; v_docs_upd int := 0; v_rc_linked int := 0; v_rc_skipped int := 0;
  v_facts int := 0; v_facts_applied int := 0; v_facts_skipped jsonb := '[]'::jsonb; v_res jsonb;
  v_rec jsonb; v_amt numeric; v_corr jsonb; v_vid uuid; v_ow boolean; v_src jsonb;
  v_price numeric; v_date date; v_loc text; v_kind text; v_cp text; v_touched uuid[] := '{}'; v_recon boolean; v_masked int := 0; v_tv uuid;
BEGIN
  -- 1 + 2: every cited vehicle gets a private books document; every cited receipt of a single-vehicle record gets a link
  FOR c IN SELECT * FROM books_vehicle_citations(p_owner_id) ORDER BY 1, 3, 4 LIMIT p_limit LOOP
    v_n_cit := v_n_cit + 1;
    v_touched := v_touched || c.vehicle_id;
    SELECT r.record INTO v_rec FROM v_financial_accounting_records r
     WHERE r.owner_id = c.owner_id AND r.document_id = c.document_id AND r.record->>'source_key' = c.source_key
       AND r.record_kind = 'retained_ledger_decision' LIMIT 1;
    CONTINUE WHEN v_rec IS NULL;
    v_url := 'nuke-books://' || c.owner_id || '/' || c.source_key;
    v_amt := CASE WHEN v_rec->>'amount' ~ '^-?[0-9]{1,12}(\.[0-9]{1,6})?$' THEN (v_rec->>'amount')::numeric END;
    IF p_apply THEN
      UPDATE vehicle_documents d SET
        title = left(coalesce(v_rec->>'section', 'Books') || ': ' || coalesce(v_rec->>'category', ''), 200),
        description = left(coalesce(v_rec->>'date', '') || ' | ' || coalesce(v_rec->>'description', '') || ' | decision: ' || coalesce(v_rec->>'decision', '')
                           || ' | ruling ' || coalesce(v_rec->>'ruling_id', v_rec->>'local_id', ''), 4000),
        amount = v_amt, currency = v_rec->>'currency', source_document_id = c.document_id, updated_at = now()
      WHERE d.vehicle_id = c.vehicle_id AND d.file_url = v_url
        AND (d.amount, d.description) IS DISTINCT FROM (v_amt, left(coalesce(v_rec->>'date', '') || ' | ' || coalesce(v_rec->>'description', '') || ' | decision: ' || coalesce(v_rec->>'decision', '')
                           || ' | ruling ' || coalesce(v_rec->>'ruling_id', v_rec->>'local_id', ''), 4000));
      IF FOUND THEN v_docs_upd := v_docs_upd + 1; END IF;
      INSERT INTO vehicle_documents (vehicle_id, uploaded_by, document_type, title, description, file_url, file_type, amount, currency, privacy_level, source_document_id)
      SELECT c.vehicle_id, c.owner_id, 'books_decision',
             left(coalesce(v_rec->>'section', 'Books') || ': ' || coalesce(v_rec->>'category', ''), 200),
             left(coalesce(v_rec->>'date', '') || ' | ' || coalesce(v_rec->>'description', '') || ' | decision: ' || coalesce(v_rec->>'decision', '')
                  || ' | ruling ' || coalesce(v_rec->>'ruling_id', v_rec->>'local_id', ''), 4000),
             v_url, 'books/decision', v_amt, v_rec->>'currency', 'private', c.document_id
      WHERE NOT EXISTS (SELECT 1 FROM vehicle_documents d WHERE d.vehicle_id = c.vehicle_id AND d.file_url = v_url);
      IF FOUND THEN v_docs_new := v_docs_new + 1; END IF;
    END IF;

    IF c.receipt_id IS NOT NULL THEN
      IF c.n_vehicles <> 1 THEN
        v_rc_skipped := v_rc_skipped + 1;
      ELSIF NOT EXISTS (SELECT 1 FROM receipt_vehicle_links l WHERE l.receipt_id = c.receipt_id AND l.vehicle_id = c.vehicle_id AND l.status = 'linked' AND l.retired_at IS NULL) THEN
        IF p_apply THEN
          BEGIN
            UPDATE receipt_vehicle_links SET retired_at = now() WHERE receipt_id = c.receipt_id AND retired_at IS NULL;
            INSERT INTO receipt_vehicle_links (receipt_id, vehicle_id, status, basis, basis_ref, confidence, run_id)
            VALUES (c.receipt_id, c.vehicle_id, 'linked', 'cited_document',
                    jsonb_build_object('books_source_key', c.source_key, 'books_document_id', c.document_id, 'via', c.via), 0.95, 'books_link_' || to_char(now(), 'YYYYMMDD'));
            v_rc_linked := v_rc_linked + 1;
          EXCEPTION WHEN OTHERS THEN
            v_rc_skipped := v_rc_skipped + 1;   -- tie or type gate refused: the subtransaction rolls the retire back too
          END;
        ELSE
          v_rc_linked := v_rc_linked + 1;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- 3: typed facts (cells vehicle_fact_*, landed by scripts/books/vehicle_facts.py as their own revisioned original; each names the
  -- source_key of the current books decision it rests on) through the sanctioned vehicle writers
  FOR f IN
    SELECT e.owner_id, coalesce(rec.document_id, e.document_id) AS document_id, e.field_key, e.value_normalized->'value' AS val, e.value_normalized->'evidence' AS ev
    FROM financial_document_extractions e
    LEFT JOIN LATERAL (SELECT r.document_id FROM v_financial_accounting_records r
                        WHERE r.owner_id = e.owner_id AND r.record_kind = 'retained_ledger_decision'
                          AND r.record->>'source_key' = e.value_normalized->'value'->>'source_key' LIMIT 1) rec ON true
    WHERE NOT e.is_superseded AND e.field_key LIKE 'vehicle\_fact\_%'
      AND (rec.document_id IS NOT NULL OR e.value_normalized->'value'->>'reconciled' = 'true')
      AND (p_owner_id IS NULL OR e.owner_id = p_owner_id)
    LIMIT p_limit
  LOOP
    v_facts := v_facts + 1;
    v_touched := v_touched || CASE WHEN f.val->>'vehicle_id' ~* '^[0-9a-f-]{36}$' THEN (f.val->>'vehicle_id')::uuid END;
    v_kind := f.val->>'kind';
    v_recon := coalesce(f.val->>'reconciled', 'false') = 'true';
    v_vid := NULL;
    IF f.val->>'vehicle_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_vid := (f.val->>'vehicle_id')::uuid;
    ELSIF length(coalesce(f.val->>'vin', '')) = 17 THEN
      SELECT min(x.id) INTO v_vid FROM vehicles x WHERE upper(x.vin) = upper(f.val->>'vin') AND x.deleted_at IS NULL AND x.merged_into_vehicle_id IS NULL
         AND (SELECT count(*) FROM vehicles y WHERE upper(y.vin) = upper(f.val->>'vin') AND y.deleted_at IS NULL AND y.merged_into_vehicle_id IS NULL) = 1;
    END IF;
    SELECT * INTO v FROM vehicles WHERE id = v_vid AND deleted_at IS NULL AND merged_into_vehicle_id IS NULL
       AND (owner_id = f.owner_id OR user_id = f.owner_id OR uploaded_by = f.owner_id);
    IF NOT FOUND OR v_kind NOT IN ('purchase', 'sale') THEN
      v_facts_skipped := v_facts_skipped || jsonb_build_array(jsonb_build_object('source_key', f.val->>'source_key', 'why', 'vehicle not the owner''s or kind unsupported'));
      CONTINUE;
    END IF;
    v_ow := coalesce((f.val->>'overwrite')::boolean, false);
    v_price := CASE WHEN f.val->>'price' ~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' THEN (f.val->>'price')::numeric END;
    v_date := CASE WHEN f.val->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN (f.val->>'date')::date END;
    v_loc := nullif(f.val->>'location', '');
    v_cp := nullif(f.val->>'counterparty', '');
    -- The citation that reaches the (anon-readable) profile row carries ids and counts only: the prose cites, names and
    -- amounts of the evidence stay in the owner-private extraction cell this ref names.
    v_src := jsonb_build_object('type', CASE WHEN v_recon THEN 'reconciled_evidence' ELSE 'books_decision' END,
                                'ref', 'financial_documents/' || f.document_id || '#' || coalesce(f.val->>'source_key', f.field_key),
                                'document_id', f.document_id, 'cell', f.field_key,
                                'evidence', jsonb_build_object('cell', f.field_key, 'reconciled', v_recon,
                                   'n_sources', f.val->'n_sources', 'n_conflicts', f.val->'n_conflicts', 'confidence', f.val->'confidence'));
    v_corr := '{}'::jsonb;
    IF v_kind = 'purchase' THEN
      IF v_price IS NOT NULL AND (v.purchase_price IS NULL OR (v_ow AND v.purchase_price IS DISTINCT FROM v_price)) THEN v_corr := v_corr || jsonb_build_object('purchase_price', jsonb_build_object('value', v_price) || CASE WHEN v.purchase_price IS NOT NULL THEN jsonb_build_object('expected', v.purchase_price) ELSE '{}'::jsonb END); END IF;
      IF v_date IS NOT NULL AND (v.purchase_date IS NULL OR (v_ow AND v.purchase_date IS DISTINCT FROM v_date)) THEN v_corr := v_corr || jsonb_build_object('purchase_date', jsonb_build_object('value', v_date) || CASE WHEN v.purchase_date IS NOT NULL THEN jsonb_build_object('expected', v.purchase_date) ELSE '{}'::jsonb END); END IF;
      IF v_loc IS NOT NULL AND (v.purchase_location IS NULL OR (v_ow AND v.purchase_location IS DISTINCT FROM v_loc)) THEN v_corr := v_corr || jsonb_build_object('purchase_location', jsonb_build_object('value', v_loc) || CASE WHEN v.purchase_location IS NOT NULL THEN jsonb_build_object('expected', v.purchase_location) ELSE '{}'::jsonb END); END IF;
      IF v_corr <> '{}'::jsonb AND p_apply THEN
        v_res := correct_vehicle_purchase_provenance(jsonb_build_array(jsonb_build_object('vehicle_id', v.id, 'source', v_src, 'corrections', v_corr, 'reason', coalesce(f.val->>'reason', 'books decision'))), 'books-linker', NULL);
        v_facts_applied := v_facts_applied + coalesce((v_res->>'fields_corrected')::int, 0);
      ELSIF v_corr <> '{}'::jsonb THEN v_facts_applied := v_facts_applied + (SELECT count(*) FROM jsonb_object_keys(v_corr));
      END IF;
      IF v_cp IS NOT NULL AND (v.seller_name IS NULL OR (v_ow AND v.seller_name IS DISTINCT FROM v_cp)) AND NOT v_recon AND p_apply THEN   -- who sold it to the owner
        v_res := correct_vehicle_sale_provenance_batch(jsonb_build_array(jsonb_build_object('vehicle_id', v.id, 'source', v_src,
                   'corrections', jsonb_build_object('seller_name', jsonb_build_object('value', v_cp) || CASE WHEN v.seller_name IS NOT NULL THEN jsonb_build_object('expected', v.seller_name) ELSE '{}'::jsonb END),
                   'reason', coalesce(f.val->>'reason', 'books decision'))), 'books-linker', NULL);
        v_facts_applied := v_facts_applied + coalesce((v_res->>'fields_corrected')::int, 0);
      END IF;
    ELSE
      IF v_price IS NOT NULL AND (v.sale_price IS NULL OR (v_ow AND v.sale_price IS DISTINCT FROM v_price::integer)) THEN v_corr := v_corr || jsonb_build_object('sale_price', jsonb_build_object('value', v_price::integer) || CASE WHEN v.sale_price IS NOT NULL THEN jsonb_build_object('expected', v.sale_price) ELSE '{}'::jsonb END); END IF;
      IF v_date IS NOT NULL AND (v.sale_date IS NULL OR (v_ow AND v.sale_date IS DISTINCT FROM v_date)) THEN v_corr := v_corr || jsonb_build_object('sale_date', jsonb_build_object('value', v_date) || CASE WHEN v.sale_date IS NOT NULL THEN jsonb_build_object('expected', v.sale_date) ELSE '{}'::jsonb END); END IF;
      IF v_corr <> '{}'::jsonb AND (v.sale_status IS DISTINCT FROM 'sold') THEN v_corr := v_corr || jsonb_build_object('sale_status', jsonb_build_object('value', 'sold') || CASE WHEN v.sale_status IS NOT NULL THEN jsonb_build_object('expected', v.sale_status) ELSE '{}'::jsonb END); END IF;
      IF v_corr <> '{}'::jsonb AND p_apply THEN
        v_res := correct_vehicle_sale_provenance_batch(jsonb_build_array(jsonb_build_object('vehicle_id', v.id, 'source', v_src, 'corrections', v_corr, 'reason', coalesce(f.val->>'reason', 'books decision'))), 'books-linker', NULL);
        v_facts_applied := v_facts_applied + coalesce((v_res->>'fields_corrected')::int, 0);
      ELSIF v_corr <> '{}'::jsonb THEN v_facts_applied := v_facts_applied + (SELECT count(*) FROM jsonb_object_keys(v_corr));
      END IF;
    END IF;
  END LOOP;

  IF p_apply THEN   -- earlier unmasked citations on any vehicle this run touched move to the private side
    FOR v_tv IN SELECT DISTINCT t FROM unnest(v_touched) t WHERE t IS NOT NULL LOOP
      v_masked := v_masked + public.mask_vehicle_provenance_refs(v_tv);
    END LOOP;
  END IF;

  RETURN jsonb_build_object('apply', p_apply, 'citations_masked', v_masked, 'owner_id', p_owner_id, 'citations', v_n_cit, 'documents_new', v_docs_new, 'documents_updated', v_docs_upd,
    'receipts_linked', v_rc_linked, 'receipts_skipped', v_rc_skipped, 'facts_seen', v_facts, 'fact_fields_applied', v_facts_applied, 'facts_skipped', v_facts_skipped);
END
$$;

REVOKE ALL ON FUNCTION public.link_books_to_vehicles(uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_books_to_vehicles(uuid, boolean, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.vehicle_sale_citation(p_vehicle_id uuid, p_amount numeric)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT jsonb_build_object(
           'label', CASE c->'source'->>'type'
                      WHEN 'reconciled_evidence' THEN 'reconciled from ' || coalesce(nullif(c->'source'->'evidence'->>'n_sources', ''), 'several') || ' records'
                                                      || CASE WHEN coalesce((c->'source'->'evidence'->>'n_conflicts')::int, 0) > 0
                                                              THEN ' (' || (c->'source'->'evidence'->>'n_conflicts') || ' disagreeing)' ELSE '' END
                      WHEN 'books_decision' THEN 'owner books record'
                      WHEN 'gmail' THEN 'cited email'
                      WHEN 'books_finding' THEN 'owner books record'
                      ELSE 'cited record' END,
           'asserted_at', c->>'asserted_at')
  FROM vehicles v
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(v.provenance_metadata->'sale_provenance_corrections', '[]'::jsonb)) c
  WHERE v.id = p_vehicle_id AND c->>'field' = 'sale_price' AND c->'source'->>'ref' IS NOT NULL
    AND (c->>'corrected') ~ '^[0-9]+(\.[0-9]+)?$' AND (c->>'corrected')::numeric = p_amount
  ORDER BY c->>'asserted_at' DESC
  LIMIT 1
$f$;

COMMIT;
