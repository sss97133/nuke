-- Revert of 20261111090000_day_documents_vendor_page_install.sql. Restores get_vehicle_day_documents to its
-- 20261109110000 body and drops the two zone helpers. The supply vendor row and its organization stay (reviewed
-- reference data; remove by hand only if the vendor is retired).
SET lock_timeout = '5s';
SET statement_timeout = '60s';

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
DROP FUNCTION IF EXISTS public.receipt_zone_labels(text);
DROP FUNCTION IF EXISTS public.receipt_line_photo_zone(text);
