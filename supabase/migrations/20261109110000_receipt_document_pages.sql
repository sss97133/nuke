-- Receipt document pages: photographed paper lands as the vehicle's dated receipts and shows on its timeline.
--
-- Owner, 2026-11-05 (Firebird binder, 84 frames shot on the phone, 78 of them paper): "nuke is the curator of the
-- data"; "we're just trying to make the digital replica of all this information ... so that at scale this data
-- becomes analysis friendly"; "I expect to see this all laid out in the timeline properly". A receipt names its
-- vendor, its date, its lines and whoever paid. It is a fact about the vehicle, never the uploader's expense.
--
-- The path (every piece already existed except the writer and the timeline leg):
--   original page(s) in the private user-documents bucket, named by sha256
--     -> vehicle_documents (one per document, private, on the vehicle, the citation the fold already understands)
--     -> receipts (vendor, document date, payer AS NAMED on the paper, totals) + receipt_items (lines; a work
--        order's labor entries keep their own date, performer and hours)
--     -> receipt_vehicle_links through receipt_link_one(): basis cited_document, the day on the paper
--        (receipt_page_date), type gate and document kind as for every other receipt
--     -> get_vehicle_contribution_days gains kind 'document' at the page date (the timeline bar)
--     -> get_vehicle_day_documents(vehicle, day): the day drawer's one read; money and payer masked for
--        anyone not tied to the vehicle (jsonb_mask_money / jsonb_mask_keys), amounts stay owner-only.
--
-- land_document_pages(p_owner, p_vehicle, p_run, p_docs) is the sanctioned writer: service role only, bounded
-- envelope, no card numbers or OCR dumps accepted, idempotent on the first page's sha256, one savepoint per
-- document so one bad page never blocks the binder. It writes no books row: financial_documents and the
-- accounting readers are untouched (a prior owner's receipts are not the custodian's expenses).
--
-- Additive: one column trio on receipt_items, two new functions, one replaced reader (its legs unchanged, one added).
-- Revert: supabase/sql/revert_20261109110000_receipt_document_pages.sql.
-- Contract: supabase/sql/test_receipt_document_pages.sql.

SET lock_timeout = '5s';
SET statement_timeout = '120s';

-- ─── Lines that carry their own clock (a work order's labor entries) ─────────────────────────────────────────
ALTER TABLE public.receipt_items
  ADD COLUMN IF NOT EXISTS line_date date,
  ADD COLUMN IF NOT EXISTS hours numeric,
  ADD COLUMN IF NOT EXISTS performer text;
COMMENT ON COLUMN public.receipt_items.line_date IS 'The date printed on this line when it differs from the document date (a work order labor entry). Null = the document date.';
COMMENT ON COLUMN public.receipt_items.hours IS 'Hours printed on a labor line. Unit: hours. Null when the line is not labor or prints none.';
COMMENT ON COLUMN public.receipt_items.performer IS 'The person named on a labor line, as printed (a first name on a shop work order). Never inferred.';

-- ─── The writer ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.land_document_pages(p_owner uuid, p_vehicle uuid, p_run text, p_docs jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_base text := p_docs->>'storage_base';
  v_docs jsonb := p_docs->'documents';
  v_method text := coalesce(p_docs->>'method', 'document_page_transcription');
  v_model text := p_docs->>'model';
  d jsonb; pg jsonb; ln jsonb;
  v_out jsonb := '[]';
  v_landed int := 0; v_dupes int := 0; v_errors int := 0;
  v_url text; v_doc_id uuid; v_receipt_id uuid; v_existing uuid;
  v_date date; v_date_basis text; v_pages jsonb; v_lines jsonb; v_n int;
  v_link jsonb; v_title text; v_desc text; v_type text;
  v_money text := '^-?[0-9]{1,9}(\.[0-9]{1,4})?$';
  v_txt text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'land_document_pages: service admission required' USING ERRCODE = '42501';
  END IF;
  IF p_owner IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_owner AND u.deleted_at IS NULL AND u.is_anonymous IS NOT TRUE) THEN
    RAISE EXCEPTION 'land_document_pages: custodian must be an account';
  END IF;
  IF p_vehicle IS NULL OR NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.id = p_vehicle AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL) THEN
    RAISE EXCEPTION 'land_document_pages: vehicle must exist and be current';
  END IF;
  IF receipt_user_vehicle_tie(p_owner, p_vehicle) IS NULL THEN
    RAISE EXCEPTION 'land_document_pages: custodian % is not tied to vehicle %', p_owner, p_vehicle;
  END IF;
  IF coalesce(length(p_run), 0) NOT BETWEEN 1 AND 120
     OR v_base !~ '^https://[a-z0-9]+\.supabase\.co$'
     OR jsonb_typeof(v_docs) IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_docs) NOT BETWEEN 1 AND 200
     OR length(v_method) NOT BETWEEN 1 AND 120
     OR octet_length(p_docs::text) > 4000000 THEN
    RAISE EXCEPTION 'land_document_pages: invalid envelope';
  END IF;
  -- Nothing that looks like a card number, an e-mail or an OCR dump enters the database.
  -- sha256 names and uuids are not card numbers
  v_txt := regexp_replace(regexp_replace(p_docs::text, '[a-f0-9]{64}', '', 'g'),
                          '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '', 'g');
  IF v_txt ~ '[0-9]{13,19}' OR v_txt ~ '[0-9]{4}[ -][0-9]{4}[ -][0-9]{4}[ -][0-9]{4}'
     OR v_txt ~* '"(ocr_text|raw_text|full_text|full_ocr)"\s*:' OR v_txt ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' THEN
    RAISE EXCEPTION 'land_document_pages: card numbers, e-mail addresses and OCR text stay out of the record';
  END IF;

  FOR d IN SELECT value FROM jsonb_array_elements(v_docs) LOOP
    BEGIN
      IF jsonb_typeof(d) <> 'object'
         OR EXISTS (SELECT 1 FROM jsonb_object_keys(d) k WHERE k NOT IN ('source_key','doc_type','vendor','doc_number','doc_date','date_basis','other_dates','bill_to_name','vehicle_noted','pages','lines','subtotal','discount','shipping','tax','total','payment','handwritten','confidence','notes','vehicle_context'))
         OR coalesce(length(d->>'source_key'), 0) NOT BETWEEN 1 AND 160
         OR coalesce(d->>'doc_type', '') NOT IN ('invoice','receipt','work_order','packing_slip','order_confirmation','alignment_report','estimate','statement','other')
         OR jsonb_typeof(d->'vendor') IS DISTINCT FROM 'object'
         OR coalesce(length(d#>>'{vendor,name}'), 0) NOT BETWEEN 1 AND 200
         OR coalesce(length(d#>>'{vendor,address}'), 0) > 300
         OR coalesce(length(d->>'doc_number'), 0) > 80
         OR (d->>'doc_date' IS NOT NULL AND d->>'doc_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
         OR coalesce(length(d->>'bill_to_name'), 0) > 120
         OR coalesce(length(d->>'vehicle_noted'), 0) > 200
         OR coalesce(length(d->>'notes'), 0) > 1000
         OR coalesce(length(d->>'vehicle_context'), 0) > 500
         OR jsonb_typeof(d->'pages') IS DISTINCT FROM 'array' OR jsonb_array_length(d->'pages') NOT BETWEEN 1 AND 20
         OR jsonb_typeof(coalesce(d->'lines', '[]')) IS DISTINCT FROM 'array' OR jsonb_array_length(coalesce(d->'lines', '[]')) > 300
         OR jsonb_typeof(coalesce(d->'other_dates', '[]')) IS DISTINCT FROM 'array'
         OR jsonb_typeof(coalesce(d->'handwritten', '[]')) IS DISTINCT FROM 'array'
         OR (d->'confidence' IS NOT NULL AND (jsonb_typeof(d->'confidence') <> 'number' OR (d->>'confidence')::numeric NOT BETWEEN 0 AND 1))
         OR EXISTS (SELECT 1 FROM unnest(ARRAY['subtotal','discount','shipping','tax','total']) k WHERE d->>k IS NOT NULL AND d->>k !~ v_money)
         OR (d->'payment' IS NOT NULL AND (jsonb_typeof(d->'payment') <> 'object' OR coalesce(length(d#>>'{payment,method}'), 0) > 40
             OR (d#>>'{payment,amount}' IS NOT NULL AND d#>>'{payment,amount}' !~ v_money)
             OR (d#>>'{payment,date}' IS NOT NULL AND d#>>'{payment,date}' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')))
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(d->'pages') p WHERE jsonb_typeof(p) <> 'object'
             OR EXISTS (SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('sha256','storage_path','byte_size','page_no','role','source_filename'))
             OR coalesce(p->>'sha256', '') !~ '^[a-f0-9]{64}$'
             OR coalesce(p->>'storage_path', '') NOT LIKE p_owner::text || '/%' OR position('..' in p->>'storage_path') > 0 OR length(p->>'storage_path') > 600
             OR coalesce(p->>'byte_size', '') !~ '^[0-9]{1,9}$' OR (p->>'byte_size')::bigint NOT BETWEEN 1 AND 52428800
             OR coalesce(p->>'page_no', '') !~ '^[0-9]{1,2}$'
             OR coalesce(p->>'role', 'page') NOT IN ('page','continuation','duplicate_confirmation')
             OR coalesce(length(p->>'source_filename'), 0) > 120)
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(d->'lines', '[]')) l WHERE jsonb_typeof(l) <> 'object'
             OR EXISTS (SELECT 1 FROM jsonb_object_keys(l) k WHERE k NOT IN ('description','part_number','quantity','unit_price','amount','line_date','performer','hours','category'))
             OR coalesce(length(l->>'description'), 0) NOT BETWEEN 1 AND 500
             OR coalesce(length(l->>'part_number'), 0) > 100 OR coalesce(length(l->>'performer'), 0) > 80 OR coalesce(length(l->>'category'), 0) > 60
             OR (l->>'line_date' IS NOT NULL AND l->>'line_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
             OR EXISTS (SELECT 1 FROM unnest(ARRAY['quantity','unit_price','amount','hours']) k WHERE l->>k IS NOT NULL AND l->>k !~ v_money))
      THEN
        RAISE EXCEPTION 'invalid document %', coalesce(d->>'source_key', '?');
      END IF;

      SELECT jsonb_agg(p ORDER BY (p->>'page_no')::int) INTO v_pages FROM jsonb_array_elements(d->'pages') p;
      v_url := v_base || '/storage/v1/object/authenticated/user-documents/' || (v_pages->0->>'storage_path');
      v_date := (d->>'doc_date')::date;
      v_date_basis := CASE WHEN v_date IS NOT NULL THEN coalesce(d->>'date_basis', 'printed_document_date') ELSE 'none' END;
      v_type := d->>'doc_type';
      v_lines := coalesce(d->'lines', '[]');
      v_n := jsonb_array_length(v_lines);

      -- Idempotent on the original: the same first page lands once.
      SELECT vd.id INTO v_existing FROM vehicle_documents vd
       WHERE vd.uploaded_by = p_owner AND vd.vehicle_id = p_vehicle AND vd.file_url = v_url LIMIT 1;
      IF v_existing IS NOT NULL THEN
        SELECT r.id INTO v_receipt_id FROM receipts r WHERE r.source_document_table = 'vehicle_documents' AND r.source_document_id = v_existing LIMIT 1;
        v_dupes := v_dupes + 1;
        v_out := v_out || jsonb_build_object('source_key', d->>'source_key', 'document_id', v_existing, 'receipt_id', v_receipt_id, 'duplicate', true,
          'link', (SELECT jsonb_build_object('status', l.status, 'basis', l.basis, 'confidence', l.confidence, 'hold_reason', l.hold_reason, 'page_date', l.page_date)
                     FROM receipt_vehicle_links l WHERE l.receipt_id = v_receipt_id AND l.retired_at IS NULL LIMIT 1));
        CONTINUE;
      END IF;

      v_title := concat_ws(' ', d#>>'{vendor,name}', replace(v_type, '_', ' '), d->>'doc_number');
      v_desc := concat_ws(' · ',
        CASE WHEN v_date IS NOT NULL THEN 'dated ' || v_date::text || ' (' || v_date_basis || ')' ELSE 'no printed date' END,
        jsonb_array_length(v_pages)::text || ' page' || CASE WHEN jsonb_array_length(v_pages) = 1 THEN '' ELSE 's' END,
        v_n::text || ' line' || CASE WHEN v_n = 1 THEN '' ELSE 's' END,
        CASE WHEN d->>'bill_to_name' IS NOT NULL THEN 'billed to ' || (d->>'bill_to_name') END,
        CASE WHEN d->>'vehicle_noted' IS NOT NULL THEN 'vehicle noted: ' || (d->>'vehicle_noted') END,
        d->>'vehicle_context');

      INSERT INTO vehicle_documents (vehicle_id, uploaded_by, document_type, title, description, file_url, file_type, amount, vendor_name, currency, privacy_level)
      VALUES (p_vehicle, p_owner, v_type, left(v_title, 200), left(v_desc, 1000), v_url, 'image/heic',
              (d->>'total')::numeric, left(d#>>'{vendor,name}', 200), 'USD', 'private')
      RETURNING id INTO v_doc_id;

      INSERT INTO receipts (user_id, created_by, vehicle_id, scope_type, scope_id, file_url, file_name, file_type, upload_date,
        processing_status, status, processed_at, vendor_name, vendor_address, transaction_date, receipt_date, purchase_date, occurred_at,
        invoice_number, subtotal, tax, tax_amount, total, total_amount, currency, payment_method, card_holder, confidence_score,
        source_document_table, source_document_id, ingest_kind, raw_extraction, raw_json)
      VALUES (p_owner, p_owner, p_vehicle, 'vehicle', p_vehicle::text, v_url,
        coalesce(v_pages->0->>'source_filename', (v_pages->0->>'sha256') || '.heic'), 'image/heic', now(),
        'completed', 'processed', now(), left(d#>>'{vendor,name}', 200), left(d#>>'{vendor,address}', 300), v_date, v_date, v_date,
        CASE WHEN v_date IS NOT NULL THEN (v_date::timestamp + interval '12 hours') AT TIME ZONE 'America/Los_Angeles' END,
        d->>'doc_number', (d->>'subtotal')::numeric, (d->>'tax')::numeric, (d->>'tax')::numeric, (d->>'total')::numeric, (d->>'total')::numeric,
        'USD', left(d#>>'{payment,method}', 40), left(d->>'bill_to_name', 120), (d->>'confidence')::numeric,
        'vehicle_documents', v_doc_id, 'import',
        jsonb_build_object('engine', v_method, 'model', v_model, 'run', p_run,
          'data', jsonb_build_object('document_type', v_type, 'transaction_date', v_date, 'vehicle_hint', d->>'vehicle_noted', 'notes', d->>'notes',
            'line_items', (SELECT coalesce(jsonb_agg(jsonb_build_object('description', l->>'description')), '[]') FROM jsonb_array_elements(v_lines) l))),
        jsonb_build_object(
          'data_v2', jsonb_build_object('document_type', v_type, 'transaction_date', v_date, 'vehicle_hint', d->>'vehicle_noted',
            'vendor', d->'vendor', 'document_number', d->>'doc_number', 'payer_as_named', d->>'bill_to_name',
            'subtotal', (d->>'subtotal')::numeric, 'discount', (d->>'discount')::numeric, 'shipping', (d->>'shipping')::numeric,
            'tax', (d->>'tax')::numeric, 'total', (d->>'total')::numeric, 'payment', d->'payment'),
          'document_pages', jsonb_build_object('run', p_run, 'method', v_method, 'model', v_model, 'source_key', d->>'source_key',
            'date_basis', v_date_basis, 'other_dates', coalesce(d->'other_dates', '[]'), 'handwritten', coalesce(d->'handwritten', '[]'),
            'vehicle_context', d->>'vehicle_context', 'pages', v_pages)))
      RETURNING id INTO v_receipt_id;

      INSERT INTO receipt_items (receipt_id, line_number, description, part_number, category, quantity, unit_price, total_price, line_date, hours, performer)
      SELECT v_receipt_id, o, left(l->>'description', 500), left(l->>'part_number', 100), left(l->>'category', 60),
             (l->>'quantity')::numeric, (l->>'unit_price')::numeric, (l->>'amount')::numeric,
             (l->>'line_date')::date, (l->>'hours')::numeric, left(l->>'performer', 80)
        FROM jsonb_array_elements(v_lines) WITH ORDINALITY AS x(l, o);

      -- The fold decides the vehicle link exactly as for every other receipt (cited document, page date, type gate, kind).
      v_link := receipt_link_one(v_receipt_id);
      v_landed := v_landed + 1;
      v_out := v_out || jsonb_build_object('source_key', d->>'source_key', 'document_id', v_doc_id, 'receipt_id', v_receipt_id, 'duplicate', false,
        'lines', v_n, 'date', v_date, 'date_basis', v_date_basis,
        'document_kind', (SELECT document_kind::text FROM receipts WHERE id = v_receipt_id),
        'link', CASE WHEN v_link IS NULL THEN NULL ELSE jsonb_build_object('status', v_link->>'status', 'basis', v_link->>'basis',
                  'confidence', v_link->'confidence', 'hold_reason', v_link->>'hold_reason', 'page_date', v_link->>'page_date', 'retired', (v_link->>'retired_at') IS NOT NULL) END);
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      v_out := v_out || jsonb_build_object('source_key', coalesce(d->>'source_key', '?'), 'error', left(SQLERRM, 300));
    END;
  END LOOP;

  RETURN jsonb_build_object('run', p_run, 'owner', p_owner, 'vehicle', p_vehicle, 'landed', v_landed, 'duplicates', v_dupes, 'errors', v_errors, 'documents', v_out);
END $$;

REVOKE ALL ON FUNCTION public.land_document_pages(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.land_document_pages(uuid, uuid, text, jsonb) TO service_role;
COMMENT ON FUNCTION public.land_document_pages(uuid, uuid, text, jsonb) IS
  'Sanctioned writer for photographed paper (receipts, invoices, work orders, slips): one vehicle_documents row, one receipts row with its receipt_items, then receipt_link_one(). Service role only; the custodian must be tied to the vehicle; card numbers, e-mail addresses and OCR text are refused; idempotent on the first page. Payer stays as named on the paper (receipts.card_holder, raw_json.data_v2.payer_as_named). Writes nothing to the books.';

-- ─── The timeline leg ────────────────────────────────────────────────────────────────────────────────────────
-- Same three legs as 20260610150000 plus the receipts linked to this vehicle, each on the day printed on its page
-- (receipt_vehicle_links.page_date, set by the fold). Duplicates and superseded readings stay off the bar.
CREATE OR REPLACE FUNCTION public.get_vehicle_contribution_days(p_vehicle_id uuid)
RETURNS TABLE(day date, kind text, n int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT vi.taken_at::date AS day, 'photo'::text AS kind, count(*)::int AS n
  FROM vehicle_images vi
  WHERE vi.vehicle_id = p_vehicle_id
    AND vi.taken_at IS NOT NULL
    AND vi.taken_at >= '2000-01-01'          -- bogus-EXIF floor
    AND COALESCE(vi.is_duplicate, false) = false
  GROUP BY 1
  UNION ALL
  SELECT ws.session_date, 'work', count(*)::int
  FROM work_sessions ws
  WHERE ws.vehicle_id = p_vehicle_id AND ws.session_date >= '2000-01-01'
  GROUP BY 1
  UNION ALL
  SELECT vte.event_date, 'event', count(*)::int
  FROM vehicle_timeline_events vte
  WHERE vte.vehicle_id = p_vehicle_id AND vte.event_date >= '2000-01-01'
  GROUP BY 1
  UNION ALL
  SELECT l.page_date, 'document', count(*)::int
  FROM receipt_vehicle_links l
  JOIN receipts r ON r.id = l.receipt_id
  WHERE l.vehicle_id = p_vehicle_id AND l.status = 'linked' AND l.retired_at IS NULL
    AND l.page_date IS NOT NULL AND l.page_date >= '2000-01-01'
    AND COALESCE(r.is_superseded, false) = false AND r.duplicate_of IS NULL
  GROUP BY 1;
$$;

-- ─── The day's paper, one read for the drawer ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_vehicle_day_documents(p_vehicle_id uuid, p_date date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH me AS MATERIALIZED (
    SELECT auth.uid() AS uid, auth.role() AS role
  ),
  gate AS MATERIALIZED (
    -- the vehicle, only if this caller may see it; tied = may see amounts and the payer's name
    SELECT v.id,
           (me.role = 'service_role'
            OR (me.uid IS NOT NULL AND (v.user_id = me.uid OR v.owner_id = me.uid OR v.uploaded_by = me.uid
                                        OR vehicle_user_has_access(v.id, me.uid)))) AS tied
      FROM vehicles v CROSS JOIN me
     WHERE v.id = p_vehicle_id
       AND ((v.is_public IS TRUE AND v.deleted_at IS NULL)
            OR me.role = 'service_role'
            OR (me.uid IS NOT NULL
                AND (v.user_id = me.uid OR v.owner_id = me.uid OR v.uploaded_by = me.uid
                     OR vehicle_user_has_access(v.id, me.uid))))
  ),
  docs AS (
    SELECT r.id, r.source_document_id, r.vendor_name, r.vendor_address, r.invoice_number, r.document_kind::text AS document_kind,
           r.raw_json #>> '{data_v2,document_type}' AS document_type,
           r.raw_json #>> '{data_v2,payer_as_named}' AS payer_as_named,
           r.raw_json #> '{document_pages,date_basis}' AS date_basis,
           coalesce(jsonb_array_length(r.raw_json #> '{document_pages,pages}'), 1) AS pages,
           r.subtotal, (r.raw_json #>> '{data_v2,discount}')::numeric AS discount, (r.raw_json #>> '{data_v2,shipping}')::numeric AS shipping,
           r.tax, r.total, r.currency, r.payment_method,
           l.page_date, l.page_date_source, l.basis::text AS basis, l.confidence
      FROM receipt_vehicle_links l
      JOIN receipts r ON r.id = l.receipt_id
     WHERE EXISTS (SELECT 1 FROM gate)
       AND l.vehicle_id = p_vehicle_id AND l.status = 'linked' AND l.retired_at IS NULL AND l.page_date = p_date
       AND COALESCE(r.is_superseded, false) = false AND r.duplicate_of IS NULL
  ),
  items AS (
    SELECT i.receipt_id,
           jsonb_agg(jsonb_build_object('line_number', i.line_number, 'description', i.description, 'part_number', i.part_number,
                                        'quantity', i.quantity, 'unit_price', i.unit_price, 'amount', i.total_price,
                                        'line_date', i.line_date, 'hours', i.hours, 'performer', i.performer)
                     ORDER BY i.line_number) AS lines
      FROM receipt_items i
     WHERE i.receipt_id IN (SELECT id FROM docs)
     GROUP BY i.receipt_id
  ),
  shaped AS (
    SELECT jsonb_build_object(
             'receipt_id', d.id, 'document_id', d.source_document_id, 'vendor', d.vendor_name, 'vendor_address', d.vendor_address,
             'document_type', d.document_type, 'document_kind', d.document_kind, 'document_number', d.invoice_number,
             'date', d.page_date, 'date_source', d.page_date_source, 'date_basis', d.date_basis, 'pages', d.pages,
             'payer_as_named', d.payer_as_named, 'payment_method', d.payment_method,
             'subtotal', d.subtotal, 'discount', d.discount, 'shipping', d.shipping, 'tax', d.tax, 'total', d.total, 'currency', d.currency,
             'link_basis', d.basis, 'link_confidence', d.confidence,
             'lines', coalesce(i.lines, '[]'::jsonb)) AS j,
           d.vendor_name, d.invoice_number
      FROM docs d LEFT JOIN items i ON i.receipt_id = d.id
  )
  SELECT jsonb_build_object(
    'date', p_date,
    'tied', coalesce((SELECT tied FROM gate), false),
    'documents', coalesce((
      SELECT jsonb_agg(CASE WHEN (SELECT tied FROM gate) THEN s.j
                            ELSE jsonb_mask_keys(jsonb_mask_money(s.j), ARRAY['payer_as_named', 'vendor_address', 'payment_method']) END
                       ORDER BY s.vendor_name, s.invoice_number)
        FROM shaped s), '[]'::jsonb));
$$;

REVOKE ALL ON FUNCTION public.get_vehicle_day_documents(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_vehicle_day_documents(uuid, date) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.get_vehicle_day_documents(uuid, date) IS
  'The receipts linked to a vehicle on one page date, with their lines, for the day drawer. Visible for a public vehicle or to anyone tied to it; amounts, the payer as named, the vendor address and the payment method are null unless the caller is tied (jsonb_mask_money, jsonb_mask_keys). Grain: one page date. Clock: the date printed on the paper (receipt_vehicle_links.page_date).';
