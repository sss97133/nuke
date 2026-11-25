-- Revert 20261124173000_receipt_vendor_public_label: the three readers return the vendor string as read again.
-- Unwraps the expressions the migration wrapped (counted), restores receipts_public_summary.vendor_name, then drops the
-- two functions. Re-opens the logged-out name leak the migration closed; run only to back the change out.
SET statement_timeout = '60s';
SET lock_timeout = '5s';

DO $revert$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.vehicle_build_reconstruction(uuid)'::regprocedure);
  d := replace(d, 'public.receipt_vendor_for_viewer(x.vendor_name, (SELECT tied FROM v))', 'x.vendor_name');
  d := replace(d, 'public.receipt_vendor_for_viewer(r.vendor_name, (SELECT tied FROM v))', 'r.vendor_name');
  IF position('receipt_vendor_for_viewer' IN d) > 0 THEN RAISE EXCEPTION 'vehicle_build_reconstruction: unexpected wrapper left'; END IF;
  EXECUTE d;
  d := pg_get_functiondef('public.get_vehicle_day_documents(uuid, date)'::regprocedure);
  d := replace(d, 'public.receipt_vendor_for_viewer(d.vendor_name, (SELECT tied FROM gate))', 'd.vendor_name');
  IF position('receipt_vendor_for_viewer' IN d) > 0 THEN RAISE EXCEPTION 'get_vehicle_day_documents: unexpected wrapper left'; END IF;
  EXECUTE d;
END
$revert$;

CREATE OR REPLACE VIEW public.receipts_public_summary WITH (security_barrier = true) AS
 SELECT r.id, r.vehicle_id, r.scope_type, r.scope_id, r.source_document_id, r.source_document_table,
    r.vendor_name,
    (CASE WHEN t.tied THEN r.total END)::numeric AS total,
    (CASE WHEN t.tied THEN r.total_amount END)::numeric(10,2) AS total_amount,
    r.currency, r.receipt_date, r.transaction_date, r.purchase_date, r.invoice_number, r.transaction_number,
    r.processing_status, r.status, r.created_at,
    t.tied AS amounts_visible
   FROM public.receipts r
     JOIN public.vehicles v ON v.id = r.vehicle_id OR v.id =
        CASE
            WHEN r.scope_type = 'vehicle'::text AND r.scope_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text THEN r.scope_id::uuid
            ELSE NULL::uuid
        END
     CROSS JOIN LATERAL (
        SELECT CASE
                 WHEN (SELECT auth.role()) = 'service_role' THEN true
                 WHEN (SELECT auth.uid()) IS NULL THEN false
                 ELSE coalesce((SELECT auth.uid()) IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by), false)
                      OR public.vehicle_user_has_access(v.id, (SELECT auth.uid()))
               END AS tied) t
  WHERE v.is_public = true AND v.deleted_at IS NULL;
REVOKE ALL ON public.receipts_public_summary FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.receipts_public_summary TO anon, authenticated;
COMMENT ON COLUMN public.receipts_public_summary.vendor_name IS NULL;

DROP FUNCTION IF EXISTS public.receipt_vendor_for_viewer(text, boolean);
DROP FUNCTION IF EXISTS public.receipt_vendor_registered_name(text);
