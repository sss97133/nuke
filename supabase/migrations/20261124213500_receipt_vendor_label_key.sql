-- 20261124213500 receipt_vendor_label_key (receipt_vendor_public_v2)
--
-- WHY. 20261124173000 gave untied viewers a vendor label resolved by looking the vendor string up in the alias register
-- at read time. 20261124205000 (ta-paper) made that resolution a key: receipts.vendor_organization_id -> organizations(id),
-- written by trigger when a receipt lands or its alias is reviewed (417 of 2513 receipts keyed, 2026-11-24). The mask now
-- reads the key, not the string.
--
-- RULE. receipt_vendor_label(receipt_id, vendor_name, tied):
--   tied                                        -> the vendor as read
--   untied, receipts.vendor_organization_id set -> organizations.name of that row
--   untied, no receipt id (a non-receipt line)  -> receipt_vendor_for_viewer(vendor_name, false), the v1 rule
--   untied, a marketplace line ('eBay ...')     -> 'eBay seller' (text prefix: no receipt -> marketplace key exists)
--   untied, otherwise                           -> 'Seller not identified'
-- A person never has an alias (20261124205000), so a person's name never resolves.
--
-- WHAT CHANGES. receipts_public_summary.vendor_name; vehicle_build_reconstruction's four vendor expressions; and
-- get_vehicle_day_documents' vendor key move from receipt_vendor_for_viewer(vendor_name, tied) to
-- receipt_vendor_label(<receipt id>, vendor_name, tied). Occurrences are counted on the live definitions (4 and 1).
--
-- REVERT. supabase/sql/revert_20261124213500_receipt_vendor_label_key.sql.
-- TEST. supabase/sql/test_receipt_vendor_label_key.sql (disposable PG17).

SET statement_timeout = '60s';
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.receipt_vendor_label(p_receipt_id uuid, p_vendor_name text, p_tied boolean) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE
           WHEN p_tied IS TRUE THEN p_vendor_name
           WHEN nullif(btrim(coalesce(p_vendor_name, '')), '') IS NULL THEN NULL
           WHEN p_receipt_id IS NULL THEN public.receipt_vendor_for_viewer(p_vendor_name, false)
           ELSE coalesce((SELECT o.name FROM public.receipts r JOIN public.organizations o ON o.id = r.vendor_organization_id
                           WHERE r.id = p_receipt_id),
                         CASE WHEN p_vendor_name ~* '^\s*ebay\M' THEN 'eBay seller' END,
                         'Seller not identified')
         END
$$;
COMMENT ON FUNCTION public.receipt_vendor_label(uuid, text, boolean) IS
  'receipt_vendor_public_v2: the vendor a receipt reader returns. Tied viewers get it as read; anyone else gets the organisation keyed by receipts.vendor_organization_id, ''eBay seller'' for a marketplace line, or ''Seller not identified''.';
REVOKE ALL ON FUNCTION public.receipt_vendor_label(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receipt_vendor_label(uuid, text, boolean) TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.receipts_public_summary WITH (security_barrier = true) AS
 SELECT r.id,
    r.vehicle_id,
    r.scope_type,
    r.scope_id,
    r.source_document_id,
    r.source_document_table,
    public.receipt_vendor_label(r.id, r.vendor_name, t.tied) AS vendor_name,
    (CASE WHEN t.tied THEN r.total END)::numeric AS total,
    (CASE WHEN t.tied THEN r.total_amount END)::numeric(10,2) AS total_amount,
    r.currency,
    r.receipt_date,
    r.transaction_date,
    r.purchase_date,
    r.invoice_number,
    r.transaction_number,
    r.processing_status,
    r.status,
    r.created_at,
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
COMMENT ON COLUMN public.receipts_public_summary.vendor_name IS
  'receipt_vendor_label(id, vendor_name, tied): the vendor as read for the vehicle''s people; for anyone else the organisation keyed by receipts.vendor_organization_id, ''eBay seller'' or ''Seller not identified'' (receipt_vendor_public_v2, 2026-11-24).';

DO $patch$
DECLARE
  d text; n int;
  bx_from text := 'public.receipt_vendor_for_viewer(x.vendor_name, (SELECT tied FROM v))';
  bx_to   text := 'public.receipt_vendor_label(x.receipt_id, x.vendor_name, (SELECT tied FROM v))';
  br_from text := 'public.receipt_vendor_for_viewer(r.vendor_name, (SELECT tied FROM v))';
  br_to   text := 'public.receipt_vendor_label(r.id, r.vendor_name, (SELECT tied FROM v))';
  g_from  text := 'public.receipt_vendor_for_viewer(d.vendor_name, (SELECT tied FROM gate))';
  g_to    text := 'public.receipt_vendor_label(d.id, d.vendor_name, (SELECT tied FROM gate))';
BEGIN
  d := pg_get_functiondef('public.vehicle_build_reconstruction(uuid)'::regprocedure);
  IF position('receipt_vendor_label' IN d) = 0 THEN
    n := (length(d) - length(replace(d, bx_from, ''))) / length(bx_from);
    IF n <> 3 THEN RAISE EXCEPTION 'vehicle_build_reconstruction: expected 3 line vendor labels, found %', n; END IF;
    n := (length(d) - length(replace(d, br_from, ''))) / length(br_from);
    IF n <> 1 THEN RAISE EXCEPTION 'vehicle_build_reconstruction: expected 1 quote vendor label, found %', n; END IF;
    EXECUTE replace(replace(d, bx_from, bx_to), br_from, br_to);
  END IF;

  d := pg_get_functiondef('public.get_vehicle_day_documents(uuid, date)'::regprocedure);
  IF position('receipt_vendor_label' IN d) = 0 THEN
    n := (length(d) - length(replace(d, g_from, ''))) / length(g_from);
    IF n <> 1 THEN RAISE EXCEPTION 'get_vehicle_day_documents: expected 1 vendor label, found %', n; END IF;
    EXECUTE replace(d, g_from, g_to);
  END IF;
END
$patch$;
