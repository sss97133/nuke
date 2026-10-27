-- Books -> vehicle profile linker (owner, 2026-10-27: "all the nuke car profiles are supposed to ingest this data as
-- provenance and its not working").
--
-- Why nothing reached a profile: the books (financial_documents / financial_document_lines, read through
-- v_financial_accounting_records) had exactly one vehicle-facing path, the expense_use cells behind
-- accounting_vehicle_costs, and no job ever carried a book decision onto a vehicle. 0 of 3,287 current
-- retained_ledger_decision records have a vehicle key; their vehicles are cited only inside proof_links / evidence
-- text (16 records cite a vehicles.id, 11 cite a stored VIN). The vehicle writers
-- (correct_vehicle_purchase_provenance, correct_vehicle_sale_provenance_batch) exist but nothing called them from the books.
--
-- What this adds (no new table; extends vehicle_documents, receipt_vehicle_links and the existing writers):
--   books_vehicle_citations(owner)  read-only: current retained_ledger_decision records that cite a vehicle of that
--                                   owner by vehicles.id or by exact VIN, plus any receipts.id they cite.
--   link_books_to_vehicles(owner, apply, limit)  service-only. For every citation:
--     1. a private vehicle_documents row (document_type books_decision, file_url nuke-books://<owner>/<source_key>,
--        source_document_id = the books document) carrying the decision's category, amount, date and reasoning;
--     2. a linked receipt_vehicle_links row (basis cited_document, basis_ref names the books record) for a cited
--        receipt when the record cites exactly one vehicle;
--     3. typed facts: a current books cell vehicle_fact_<first 24 of source_key> with value
--        {kind: purchase|sale, vehicle_id | vin, price, date, location, counterparty, overwrite, reason} is applied
--        through correct_vehicle_purchase_provenance / correct_vehicle_sale_provenance_batch, cited to the books record.
--        A fact fills an empty field; it replaces a stored value only when the cell says overwrite = true.
--   Job link-books-to-vehicles runs it every 30 minutes, so new books records keep arriving on the profiles.
-- Private data stays in the database: the documents are private, and no name or amount is in this file.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

CREATE OR REPLACE FUNCTION public.books_vehicle_citations(p_owner_id uuid DEFAULT NULL)
RETURNS TABLE(owner_id uuid, document_id uuid, source_key text, vehicle_id uuid, via text, receipt_id uuid, n_vehicles integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH recs AS MATERIALIZED (
    SELECT r.owner_id, r.document_id, r.record->>'source_key' AS sk, upper(r.record::text) AS up, r.record::text AS raw
    FROM v_financial_accounting_records r
    WHERE r.record_kind = 'retained_ledger_decision' AND r.record ? 'source_key'
      AND (p_owner_id IS NULL OR r.owner_id = p_owner_id)
  ), ids AS (
    SELECT DISTINCT r.owner_id, r.document_id, r.sk, lower(m[1])::uuid AS id
    FROM recs r, regexp_matches(r.raw, '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})', 'g') m
  ), vins AS (
    SELECT DISTINCT r.owner_id, r.document_id, r.sk, m[1] AS vin
    FROM recs r, regexp_matches(r.up, '(?<![A-Z0-9])([A-HJ-NPR-Z0-9]{17})(?![A-Z0-9])', 'g') m
  ), cites AS (
    SELECT i.owner_id, i.document_id, i.sk, v.id AS vid, 'vehicle_id'::text AS via
      FROM ids i JOIN vehicles v ON v.id = i.id
    UNION
    SELECT n.owner_id, n.document_id, n.sk, v.id, 'vin'
      FROM vins n JOIN vehicles v ON v.vin = n.vin
  ), mine AS (
    SELECT c.* FROM cites c JOIN vehicles v ON v.id = c.vid
    WHERE v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
      AND (v.owner_id = c.owner_id OR v.user_id = c.owner_id OR v.uploaded_by = c.owner_id)
  )
  SELECT m.owner_id, m.document_id, m.sk, m.vid, m.via,
         (SELECT x.id FROM ids i JOIN receipts x ON x.id = i.id
           WHERE i.owner_id = m.owner_id AND i.sk = m.sk AND x.user_id = m.owner_id LIMIT 1),
         (count(*) OVER (PARTITION BY m.owner_id, m.document_id, m.sk))::integer
  FROM (SELECT DISTINCT ON (owner_id, document_id, sk, vid) * FROM mine ORDER BY owner_id, document_id, sk, vid, via) m
$$;

CREATE OR REPLACE FUNCTION public.link_books_to_vehicles(p_owner_id uuid DEFAULT NULL, p_apply boolean DEFAULT false, p_limit integer DEFAULT 2000)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c record; f record; v vehicles%ROWTYPE;
  v_url text; v_n_cit int := 0; v_docs_new int := 0; v_docs_upd int := 0; v_rc_linked int := 0; v_rc_skipped int := 0;
  v_facts int := 0; v_facts_applied int := 0; v_facts_skipped jsonb := '[]'::jsonb; v_res jsonb;
  v_rec jsonb; v_amt numeric; v_corr jsonb; v_vid uuid; v_ow boolean; v_src jsonb;
  v_price numeric; v_date date; v_loc text; v_kind text; v_cp text;
BEGIN
  -- 1 + 2: every cited vehicle gets a private books document; every cited receipt of a single-vehicle record gets a link
  FOR c IN SELECT * FROM books_vehicle_citations(p_owner_id) ORDER BY 1, 3, 4 LIMIT p_limit LOOP
    v_n_cit := v_n_cit + 1;
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
    SELECT e.owner_id, rec.document_id, e.value_normalized->'value' AS val, e.value_normalized->'evidence' AS ev
    FROM financial_document_extractions e
    CROSS JOIN LATERAL (SELECT r.document_id FROM v_financial_accounting_records r
                        WHERE r.owner_id = e.owner_id AND r.record_kind = 'retained_ledger_decision'
                          AND r.record->>'source_key' = e.value_normalized->'value'->>'source_key' LIMIT 1) rec
    WHERE NOT e.is_superseded AND e.field_key LIKE 'vehicle\_fact\_%'
      AND (p_owner_id IS NULL OR e.owner_id = p_owner_id)
    LIMIT p_limit
  LOOP
    v_facts := v_facts + 1;
    v_kind := f.val->>'kind';
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
    v_src := jsonb_build_object('type', 'books_decision', 'ref', 'financial_documents/' || f.document_id || '#' || (f.val->>'source_key'),
                                'document_id', f.document_id, 'source_key', f.val->>'source_key', 'evidence', f.ev);
    v_corr := '{}'::jsonb;
    IF v_kind = 'purchase' THEN
      IF v_price IS NOT NULL AND (v.purchase_price IS NULL OR v_ow) THEN v_corr := v_corr || jsonb_build_object('purchase_price', jsonb_build_object('value', v_price) || CASE WHEN v.purchase_price IS NOT NULL THEN jsonb_build_object('expected', v.purchase_price) ELSE '{}'::jsonb END); END IF;
      IF v_date IS NOT NULL AND (v.purchase_date IS NULL OR v_ow) THEN v_corr := v_corr || jsonb_build_object('purchase_date', jsonb_build_object('value', v_date) || CASE WHEN v.purchase_date IS NOT NULL THEN jsonb_build_object('expected', v.purchase_date) ELSE '{}'::jsonb END); END IF;
      IF v_loc IS NOT NULL AND (v.purchase_location IS NULL OR v_ow) THEN v_corr := v_corr || jsonb_build_object('purchase_location', jsonb_build_object('value', v_loc) || CASE WHEN v.purchase_location IS NOT NULL THEN jsonb_build_object('expected', v.purchase_location) ELSE '{}'::jsonb END); END IF;
      IF v_corr <> '{}'::jsonb AND p_apply THEN
        v_res := correct_vehicle_purchase_provenance(jsonb_build_array(jsonb_build_object('vehicle_id', v.id, 'source', v_src, 'corrections', v_corr, 'reason', coalesce(f.val->>'reason', 'books decision'))), 'books-linker', NULL);
        v_facts_applied := v_facts_applied + coalesce((v_res->>'fields_corrected')::int, 0);
      ELSIF v_corr <> '{}'::jsonb THEN v_facts_applied := v_facts_applied + (SELECT count(*) FROM jsonb_object_keys(v_corr));
      END IF;
      IF v_cp IS NOT NULL AND (v.seller_name IS NULL OR v_ow) AND p_apply THEN   -- who sold it to the owner
        v_res := correct_vehicle_sale_provenance_batch(jsonb_build_array(jsonb_build_object('vehicle_id', v.id, 'source', v_src,
                   'corrections', jsonb_build_object('seller_name', jsonb_build_object('value', v_cp) || CASE WHEN v.seller_name IS NOT NULL THEN jsonb_build_object('expected', v.seller_name) ELSE '{}'::jsonb END),
                   'reason', coalesce(f.val->>'reason', 'books decision'))), 'books-linker', NULL);
        v_facts_applied := v_facts_applied + coalesce((v_res->>'fields_corrected')::int, 0);
      END IF;
    ELSE
      IF v_price IS NOT NULL AND (v.sale_price IS NULL OR v_ow) THEN v_corr := v_corr || jsonb_build_object('sale_price', jsonb_build_object('value', v_price::integer) || CASE WHEN v.sale_price IS NOT NULL THEN jsonb_build_object('expected', v.sale_price) ELSE '{}'::jsonb END); END IF;
      IF v_date IS NOT NULL AND (v.sale_date IS NULL OR v_ow) THEN v_corr := v_corr || jsonb_build_object('sale_date', jsonb_build_object('value', v_date) || CASE WHEN v.sale_date IS NOT NULL THEN jsonb_build_object('expected', v.sale_date) ELSE '{}'::jsonb END); END IF;
      IF v_corr <> '{}'::jsonb AND (v.sale_status IS DISTINCT FROM 'sold') THEN v_corr := v_corr || jsonb_build_object('sale_status', jsonb_build_object('value', 'sold') || CASE WHEN v.sale_status IS NOT NULL THEN jsonb_build_object('expected', v.sale_status) ELSE '{}'::jsonb END); END IF;
      IF v_corr <> '{}'::jsonb AND p_apply THEN
        v_res := correct_vehicle_sale_provenance_batch(jsonb_build_array(jsonb_build_object('vehicle_id', v.id, 'source', v_src, 'corrections', v_corr, 'reason', coalesce(f.val->>'reason', 'books decision'))), 'books-linker', NULL);
        v_facts_applied := v_facts_applied + coalesce((v_res->>'fields_corrected')::int, 0);
      ELSIF v_corr <> '{}'::jsonb THEN v_facts_applied := v_facts_applied + (SELECT count(*) FROM jsonb_object_keys(v_corr));
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('apply', p_apply, 'owner_id', p_owner_id, 'citations', v_n_cit, 'documents_new', v_docs_new, 'documents_updated', v_docs_upd,
    'receipts_linked', v_rc_linked, 'receipts_skipped', v_rc_skipped, 'facts_seen', v_facts, 'fact_fields_applied', v_facts_applied, 'facts_skipped', v_facts_skipped);
END
$$;

REVOKE ALL ON FUNCTION public.books_vehicle_citations(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.link_books_to_vehicles(uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.books_vehicle_citations(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.link_books_to_vehicles(uuid, boolean, integer) TO service_role;
COMMENT ON FUNCTION public.books_vehicle_citations(uuid) IS
  'Current books decisions that cite a vehicle of the same owner by vehicles.id or exact VIN, with any receipts.id they cite; read-only, service role.';
COMMENT ON FUNCTION public.link_books_to_vehicles(uuid, boolean, integer) IS
  'Carries books decisions onto vehicle profiles: private vehicle_documents per citation, receipt_vehicle_links for cited receipts, and typed vehicle_fact cells through the cited purchase and sale writers. Dry run unless p_apply. Job link-books-to-vehicles.';

SELECT cron.schedule('link-books-to-vehicles', '7,37 * * * *',
  $c$set statement_timeout = '55s'; select public.link_books_to_vehicles(null, true, 1500)$c$);

COMMIT;
