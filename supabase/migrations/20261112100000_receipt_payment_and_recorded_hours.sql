-- Existing receipt reader: distinguish the printed payment from the document total.
-- Hours sum only this receipt's recorded line entries; concurrent entries remain person-hours.
-- Payment amount/date use the existing tied-viewer gate; no new grants or testimony writes.
SET lock_timeout = '5s';
SET statement_timeout = '10s';

DO $guard$
BEGIN
  IF to_regprocedure('public.get_vehicle_day_documents(uuid,date)') IS NULL OR
     md5(pg_get_functiondef('public.get_vehicle_day_documents(uuid,date)'::regprocedure)) <> '2ffd4191b24ce8c2607060c2e2df4121' THEN
    RAISE EXCEPTION 'get_vehicle_day_documents owner changed; review before replacement';
  END IF;
END $guard$;

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
    -- the vehicle, only if this caller may see it; tied = may see amounts, the payer's name and the page itself
    SELECT v.id,
           (me.role = 'service_role'
            OR (me.uid IS NOT NULL AND (v.user_id = me.uid OR v.owner_id = me.uid OR v.uploaded_by = me.uid
                                        OR vehicle_user_has_access(v.id, me.uid)))) AS tied
      FROM vehicles v CROSS JOIN me
     WHERE v.id = p_vehicle_id
       AND ((v.is_public IS TRUE AND v.deleted_at IS NULL)
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
           CASE WHEN jsonb_typeof(r.raw_json #> '{document_pages,pages}') = 'array' THEN r.raw_json #> '{document_pages,pages}' END AS pages_json,
           r.file_url,
           r.subtotal, (r.raw_json #>> '{data_v2,discount}')::numeric AS discount, (r.raw_json #>> '{data_v2,shipping}')::numeric AS shipping,
           r.tax, r.total, r.currency, r.payment_method,
           CASE WHEN r.raw_json #>> '{data_v2,payment,amount}' ~ '^-?[0-9]+([.][0-9]+)?$'
                THEN (r.raw_json #>> '{data_v2,payment,amount}')::numeric END AS payment_amount,
           CASE WHEN r.raw_json #>> '{data_v2,payment,date}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                     AND pg_input_is_valid(r.raw_json #>> '{data_v2,payment,date}', 'date')
                THEN r.raw_json #>> '{data_v2,payment,date}' END AS payment_date,
           l.page_date, l.page_date_source, l.basis::text AS basis, l.confidence
      FROM receipt_vehicle_links l
      JOIN receipts r ON r.id = l.receipt_id
     WHERE EXISTS (SELECT 1 FROM gate)
       AND l.vehicle_id = p_vehicle_id AND l.status = 'linked' AND l.retired_at IS NULL AND l.page_date = p_date
       AND COALESCE(r.is_superseded, false) = false AND r.duplicate_of IS NULL
  ),
  -- the original page(s): the binder's page list, or the receipt's own file when it lives in the private bucket
  pages AS (
    SELECT d.id AS receipt_id, p.path, p.bytes, p.page_no
      FROM docs d
      CROSS JOIN LATERAL (
        SELECT e->>'storage_path' AS path, NULLIF(regexp_replace(coalesce(e->>'byte_size', ''), '\D', '', 'g'), '')::bigint AS bytes,
               NULLIF(regexp_replace(coalesce(e->>'page_no', ''), '\D', '', 'g'), '')::int AS page_no
          FROM jsonb_array_elements(d.pages_json) e
         WHERE e->>'storage_path' IS NOT NULL
        UNION ALL
        SELECT substring(d.file_url FROM '/user-documents/(.+)$'), NULL::bigint, 1
         WHERE d.pages_json IS NULL AND d.file_url ~ '/storage/v1/object/(public|sign|authenticated)/user-documents/'
      ) p
  ),
  page_shape AS (
    SELECT receipt_id,
           (array_agg(jsonb_build_object('bucket', 'user-documents', 'path', path, 'bytes', bytes, 'page_no', page_no) ORDER BY page_no NULLS LAST, path))[1] AS page,
           jsonb_agg(path ORDER BY page_no NULLS LAST, path) AS page_paths
      FROM pages
     GROUP BY receipt_id
  ),
  -- the organization behind the vendor name, through the reviewed supply register
  vendor AS (
    SELECT d.id AS receipt_id,
           jsonb_strip_nulls(jsonb_build_object('id', CASE WHEN o.is_public IS TRUE THEN o.id END,
                                                'name', o.name, 'logo_url', o.logo_url, 'website', o.website)) AS vendor_org
      FROM docs d
      JOIN supply_vendor_aliases a ON a.alias_key = public.supply_vendor_key(d.vendor_name)
      JOIN supply_vendors s ON s.vendor_slug = a.vendor_slug
      JOIN organizations o ON o.id = s.organization_id
  ),
  items AS (
    SELECT i.receipt_id, sum(i.hours) AS recorded_hours, count(i.hours) AS hour_entries,
           jsonb_agg(jsonb_build_object('line_number', i.line_number, 'description', i.description, 'part_number', i.part_number,
                                        'quantity', i.quantity, 'unit_price', i.unit_price, 'amount', i.total_price,
                                        'line_date', i.line_date, 'hours', i.hours, 'performer', i.performer,
                                        'install', jsonb_build_object(
                                          'zone', z.zone,
                                          'status', CASE WHEN z.zone IS NULL THEN 'no_zone' WHEN pr.first_day IS NULL THEN 'no_photo' ELSE 'photographed' END,
                                          'photo_day', pr.first_day, 'photo_count', pr.n, 'image_id', pr.first_image))
                     ORDER BY i.line_number) AS lines
      FROM receipt_items i
      JOIN docs d ON d.id = i.receipt_id
      CROSS JOIN LATERAL (SELECT public.receipt_line_photo_zone(i.description) AS zone) z
      LEFT JOIN LATERAL (
        SELECT min(v.taken_at AT TIME ZONE 'UTC')::date AS first_day, count(*)::int AS n,
               (array_agg(v.id ORDER BY v.taken_at))[1] AS first_image
          FROM vehicle_images v
         WHERE z.zone IS NOT NULL
           AND v.vehicle_id = p_vehicle_id
           AND v.taken_at >= ((d.page_date + 1)::timestamp AT TIME ZONE 'UTC')
           AND v.is_duplicate IS NOT TRUE AND v.is_superseded IS NOT TRUE
           AND v.apple_ml_labels && public.receipt_zone_labels(z.zone)
      ) pr ON true
     GROUP BY i.receipt_id
  ),
  shaped AS (
    SELECT jsonb_build_object(
             'receipt_id', d.id, 'document_id', d.source_document_id, 'vendor', d.vendor_name, 'vendor_address', d.vendor_address,
             'vendor_org', ven.vendor_org,
             'document_type', d.document_type, 'document_kind', d.document_kind, 'document_number', d.invoice_number,
             'date', d.page_date, 'date_source', d.page_date_source, 'date_basis', d.date_basis, 'pages', d.pages,
             'page', ps.page, 'page_paths', ps.page_paths,
             'payer_as_named', d.payer_as_named, 'payment_method', d.payment_method,
             'recorded_payment', CASE WHEN (SELECT tied FROM gate) AND (d.payment_amount IS NOT NULL OR d.payment_date IS NOT NULL)
               THEN jsonb_build_object('amount', d.payment_amount, 'date', d.payment_date) END,
             'recorded_hours', i.recorded_hours, 'hour_entries', coalesce(i.hour_entries, 0),
             'subtotal', d.subtotal, 'discount', d.discount, 'shipping', d.shipping, 'tax', d.tax, 'total', d.total, 'currency', d.currency,
             'link_basis', d.basis, 'link_confidence', d.confidence,
             'lines', coalesce(i.lines, '[]'::jsonb)) AS j,
           d.vendor_name, d.invoice_number
      FROM docs d
      LEFT JOIN items i ON i.receipt_id = d.id
      LEFT JOIN page_shape ps ON ps.receipt_id = d.id
      LEFT JOIN vendor ven ON ven.receipt_id = d.id
  )
  SELECT jsonb_build_object(
    'date', p_date,
    'tied', coalesce((SELECT tied FROM gate), false),
    'documents', coalesce((
      SELECT jsonb_agg(CASE WHEN (SELECT tied FROM gate) THEN s.j
                            ELSE jsonb_mask_keys(jsonb_mask_money(s.j), ARRAY['payer_as_named', 'vendor_address', 'payment_method', 'page', 'page_paths']) END
                       ORDER BY s.vendor_name, s.invoice_number)
        FROM shaped s), '[]'::jsonb));
$$;

COMMENT ON FUNCTION public.get_vehicle_day_documents(uuid, date) IS
  'Current linked receipt pages and lines. Same public-vehicle/tied-viewer visibility; original pages, payer, payment amount/date and money remain tied-viewer only. recorded_payment is a separately printed payment, never added to document total. recorded_hours sums this receipt''s literal hour entries, not elapsed time or the entire build. Nearby photo candidates do not establish installation.';
