-- 20261124173000 receipt_vendor_public_label (receipt_vendor_public_v1)
--
-- WHY. Measured as a logged-out client (anon key) on 2026-11-24 17:30 PT: three readers returned a receipt's vendor
-- string as typed on the paper, and on two public vehicles that string carries a private person's name (a marketplace
-- seller's own name, a "message signed <name>" note, or the buyer's name read as the vendor). Rows returned with such a
-- name, proof vehicle / second vehicle: receipts_public_summary.vendor_name 3 / 3; vehicle_build_reconstruction
-- systems[].suppliers, systems[].paper.shops and systems[].lines[].source 6 / 3; get_vehicle_day_documents
-- documents[].vendor 2 / 1. The web hid some of them at display; the API did not.
--
-- RULE (one function decides, the three readers call it):
--   receipt_vendor_for_viewer(vendor_name, tied)
--     tied viewer (service role, the vehicle's people)  -> the vendor string unchanged
--     anyone else, vendor on the organisation register  -> the organisation's name (else the register's business_name)
--     anyone else, a marketplace line ('eBay seller ...') -> 'eBay seller' (the marketplace, never the counterparty)
--     anyone else, otherwise                            -> 'Seller not identified'
--   KEYS. The register is the existing edge from a receipt's vendor to an organisation, the same join
--   get_vehicle_day_documents already uses for vendor_org: receipts.vendor_name -> supply_vendor_key() ->
--   supply_vendor_aliases.alias_key -> supply_vendors.vendor_slug -> supply_vendors.organization_id -> organizations.id.
--   The marketplace test is text shape (a prefix): no receipt -> marketplace edge exists today. When a receipt ->
--   organisation edge lands (ta-matcher), receipt_vendor_registered_name reads it first; nothing else changes.
--
-- WHAT CHANGES. receipts_public_summary: vendor_name becomes the viewer's label; every other column, the join, the
-- barrier and the grants are as in 20261109140000. vehicle_build_reconstruction and get_vehicle_day_documents: the
-- live definition is read and only the vendor expressions are wrapped (4 and 1 occurrences, counted; any other count
-- stops the migration). Descriptions, part numbers, money masking and every other key are untouched.
--
-- REVERT. supabase/sql/revert_20261124173000_receipt_vendor_public_label.sql.
-- TEST. supabase/sql/test_receipt_vendor_public_label.sql (disposable PG17).

SET statement_timeout = '60s';
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.receipt_vendor_registered_name(p_vendor_name text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(o.name, s.business_name)
    FROM public.supply_vendor_aliases a
    JOIN public.supply_vendors s ON s.vendor_slug = a.vendor_slug
    LEFT JOIN public.organizations o ON o.id = s.organization_id
   WHERE a.alias_key = public.supply_vendor_key(p_vendor_name)
   ORDER BY s.vendor_slug
   LIMIT 1
$$;
COMMENT ON FUNCTION public.receipt_vendor_registered_name(text) IS
  'receipt_vendor_public_v1: the organisation a receipt vendor string resolves to through the reviewed supply register (supply_vendor_key -> supply_vendor_aliases -> supply_vendors -> organizations), or NULL. Business names only.';

CREATE OR REPLACE FUNCTION public.receipt_vendor_for_viewer(p_vendor_name text, p_tied boolean) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE
           WHEN p_tied IS TRUE THEN p_vendor_name
           WHEN nullif(btrim(coalesce(p_vendor_name, '')), '') IS NULL THEN NULL
           ELSE coalesce(public.receipt_vendor_registered_name(p_vendor_name),
                         CASE WHEN p_vendor_name ~* '^\s*ebay\M' THEN 'eBay seller' END,
                         'Seller not identified')
         END
$$;
COMMENT ON FUNCTION public.receipt_vendor_for_viewer(text, boolean) IS
  'receipt_vendor_public_v1: the vendor a receipt reader returns. Tied viewers get the string as read; anyone else gets the registered organisation, ''eBay seller'' for a marketplace line, or ''Seller not identified''. A private person''s name never reaches an untied caller.';

REVOKE ALL ON FUNCTION public.receipt_vendor_registered_name(text), public.receipt_vendor_for_viewer(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receipt_vendor_registered_name(text), public.receipt_vendor_for_viewer(text, boolean)
  TO anon, authenticated, service_role;

-- 1. receipts_public_summary: 20261109140000's definition, vendor_name labelled for the viewer.
CREATE OR REPLACE VIEW public.receipts_public_summary WITH (security_barrier = true) AS
 SELECT r.id,
    r.vehicle_id,
    r.scope_type,
    r.scope_id,
    r.source_document_id,
    r.source_document_table,
    public.receipt_vendor_for_viewer(r.vendor_name, t.tied) AS vendor_name,
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
  'receipt_vendor_for_viewer(vendor_name, tied): the vendor as read for the vehicle''s people; for anyone else the registered organisation, ''eBay seller'' or ''Seller not identified'' (receipt_vendor_public_v1, 2026-11-24).';

-- 2 and 3. Wrap the vendor expressions in the two function readers, in place.
DO $patch$
DECLARE
  d text; n int;
  vbr_from text := 'public.text_redact_contact(x.vendor_name)';
  vbr_to   text := 'public.text_redact_contact(public.receipt_vendor_for_viewer(x.vendor_name, (SELECT tied FROM v)))';
  vbr_from2 text := 'public.text_redact_contact(r.vendor_name)';
  vbr_to2   text := 'public.text_redact_contact(public.receipt_vendor_for_viewer(r.vendor_name, (SELECT tied FROM v)))';
  gvd_from text := '''vendor'', d.vendor_name,';
  gvd_to   text := '''vendor'', public.receipt_vendor_for_viewer(d.vendor_name, (SELECT tied FROM gate)),';
BEGIN
  d := pg_get_functiondef('public.vehicle_build_reconstruction(uuid)'::regprocedure);
  IF position('receipt_vendor_for_viewer' IN d) = 0 THEN
    n := (length(d) - length(replace(d, vbr_from, ''))) / length(vbr_from);
    IF n <> 3 THEN RAISE EXCEPTION 'vehicle_build_reconstruction: expected 3 line vendor expressions, found %', n; END IF;
    n := (length(d) - length(replace(d, vbr_from2, ''))) / length(vbr_from2);
    IF n <> 1 THEN RAISE EXCEPTION 'vehicle_build_reconstruction: expected 1 quote vendor expression, found %', n; END IF;
    EXECUTE replace(replace(d, vbr_from, vbr_to), vbr_from2, vbr_to2);
  END IF;

  d := pg_get_functiondef('public.get_vehicle_day_documents(uuid, date)'::regprocedure);
  IF position('receipt_vendor_for_viewer' IN d) = 0 THEN
    n := (length(d) - length(replace(d, gvd_from, ''))) / length(gvd_from);
    IF n <> 1 THEN RAISE EXCEPTION 'get_vehicle_day_documents: expected 1 vendor key, found %', n; END IF;
    EXECUTE replace(d, gvd_from, gvd_to);
  END IF;
END
$patch$;
