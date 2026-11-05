-- Receipt amounts are the vehicle's people's to see. The two public receipt views keep serving the public, undeleted vehicles'
-- receipts to everyone (vendor, dates, invoice number, status), and serve the money only to a caller tied to the vehicle.
--
-- Measured as a logged-out client on 2026-11-05 (REST with the anon key): receipts_public_summary answered 390 receipts on 21 public
-- vehicles with their totals, $420,648.36 in all; the 1973 Firebird 20d21fb0 alone 65 receipts, $21,161.81, every binder page the
-- custodian photographed on 2026-11-02. The day drawer of the same vehicle (get_vehicle_day_documents, 20261109110000) already
-- answers the same visitor with the lines and the performer and the money null: the rule there is that amounts and the payer's name
-- are for the vehicle's people (jsonb_mask_money), and the profile's "Build receipts" section and ledger cards read this view instead.
--
-- Tied, as 20261106160000 and 20261109110000 define it: a service-role request, or a signed-in user who is the vehicle's owner_id,
-- user_id, created_by_user_id or uploaded_by, or has vehicle_user_has_access (contributor with a working role, admin, organization).
--
-- Now:
--   receipts_public_summary    the same rows, columns, join (the indexed one of 20261031042352), barrier and grants; total and
--                              total_amount are NULL unless the caller is tied; a new last column amounts_visible says which it was,
--                              so a page can say "visible to the vehicle's people" instead of "not recorded". A caller's own filter on
--                              total runs on the masked column (the barrier keeps the subquery first), so no filter can tell a hidden
--                              amount from a missing one.
--   vehicle_receipts_rollup_v  the same rows and gate (a service-role request with no user still reads the public vehicles only); total_lifetime, total_90d and total_365d NULL unless tied; receipts_count stays
--                              public; amounts_visible added last. No repository or database caller reads it (20261106160000's census).
-- user_receipt_summary is untouched: it answers only its own user.
--
-- Stops without changing anything if a live definition is not the one this was written from (2026-11-05: the 20261106160000 filters
-- with the 20261031042352 join) or this migration's own (replay). Replay-safe: CREATE OR REPLACE, REVOKE and GRANT, one transaction.
-- The contract is supabase/sql/test_receipt_views_money_mask.sql.
SET lock_timeout = '90s';
SET statement_timeout = '120s';

BEGIN;

DO $guard$
DECLARE d text;
BEGIN
  d := pg_get_viewdef('public.receipts_public_summary'::regclass);
  IF d NOT LIKE '%is_public%' OR d NOT LIKE '%deleted_at%' OR d NOT LIKE '%[0-9a-f]{8}-[0-9a-f]{4}%' THEN
    RAISE EXCEPTION 'receipts_public_summary differs from the definition this migration was written from';
  END IF;
  d := pg_get_viewdef('public.vehicle_receipts_rollup_v'::regclass);
  IF d NOT LIKE '%receipt_doc_kind_excluded%' OR d NOT LIKE '%deleted_at%' OR d NOT LIKE '%vehicle_user_has_access%' THEN
    RAISE EXCEPTION 'vehicle_receipts_rollup_v differs from the definition this migration was written from';
  END IF;
END
$guard$;

-- 1. One receipt per public vehicle it belongs to, money only for the vehicle's people.
CREATE OR REPLACE VIEW public.receipts_public_summary WITH (security_barrier = true) AS
 SELECT r.id,
    r.vehicle_id,
    r.scope_type,
    r.scope_id,
    r.source_document_id,
    r.source_document_table,
    r.vendor_name,
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
COMMENT ON VIEW public.receipts_public_summary IS
  'Column-limited public view of receipts for vehicles that are public and not deleted (is_public = true AND deleted_at IS NULL). total and total_amount are NULL unless the caller is tied to the vehicle (service role; owner_id, user_id, created_by_user_id, uploaded_by; vehicle_user_has_access), and amounts_visible says which. Backs the vehicle-profile Build receipts section and ledger cards for anon/non-owner visitors. Never exposes card_last4/card_holder/vendor_address/raw_extraction/file_url (2026-11-05).';
COMMENT ON COLUMN public.receipts_public_summary.amounts_visible IS
  'true when this caller may see total and total_amount (tied to the vehicle); false when they are NULL for that reason. Unit: none. Source: vehicles ties + vehicle_user_has_access. Grain: one receipt per public vehicle. Clock: request.';

-- 2. Receipt totals per vehicle: rows for public vehicles and for the caller's own, money only for the vehicle's people.
CREATE OR REPLACE VIEW public.vehicle_receipts_rollup_v WITH (security_barrier = true) AS
 SELECT g.vehicle_id,
    CASE WHEN t.tied THEN g.total_lifetime END AS total_lifetime,
    CASE WHEN t.tied THEN g.total_90d END AS total_90d,
    CASE WHEN t.tied THEN g.total_365d END AS total_365d,
    g.receipts_count,
    t.tied AS amounts_visible
   FROM ( SELECT (r.scope_id)::uuid AS vehicle_id,
            sum(
                CASE
                    WHEN (COALESCE(r.processing_status, 'parsed'::text) = ANY (ARRAY['validated'::text, 'saved'::text])) THEN r.total_amount
                    ELSE (0)::numeric
                END) AS total_lifetime,
            sum(
                CASE
                    WHEN ((COALESCE(r.processing_status, 'parsed'::text) = ANY (ARRAY['validated'::text, 'saved'::text])) AND (r.transaction_date >= ((now() - '90 days'::interval))::date)) THEN r.total_amount
                    ELSE (0)::numeric
                END) AS total_90d,
            sum(
                CASE
                    WHEN ((COALESCE(r.processing_status, 'parsed'::text) = ANY (ARRAY['validated'::text, 'saved'::text])) AND (r.transaction_date >= ((now() - '365 days'::interval))::date)) THEN r.total_amount
                    ELSE (0)::numeric
                END) AS total_365d,
            count(*) FILTER (WHERE (COALESCE(r.processing_status, 'parsed'::text) = ANY (ARRAY['validated'::text, 'saved'::text]))) AS receipts_count
           FROM public.receipts r
          WHERE ((r.scope_type = 'vehicle'::text) AND (NOT public.receipt_doc_kind_excluded(r.document_kind)) AND ((r.duplicate_of IS NULL) AND (r.amount_check = ANY (ARRAY['verified'::public.receipt_amount_check, 'plausible'::public.receipt_amount_check]))))
          GROUP BY r.scope_id) g
     JOIN public.vehicles v ON v.id = g.vehicle_id
     CROSS JOIN LATERAL (
        SELECT o.own OR (SELECT auth.role()) = 'service_role' AS tied, o.own
          FROM (SELECT CASE
                         WHEN (SELECT auth.uid()) IS NULL THEN false
                         ELSE coalesce((SELECT auth.uid()) IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by), false)
                              OR public.vehicle_user_has_access(v.id, (SELECT auth.uid()))
                       END AS own) o) t
  WHERE (v.is_public = true AND v.deleted_at IS NULL) OR t.own;

REVOKE ALL ON public.vehicle_receipts_rollup_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vehicle_receipts_rollup_v TO anon, authenticated;
COMMENT ON VIEW public.vehicle_receipts_rollup_v IS
  'Receipt counts per vehicle. A public, undeleted vehicle for everyone; any other vehicle only for its owner, uploader or a contributor with access (vehicle_user_has_access). The three totals are NULL unless the caller is tied to the vehicle; amounts_visible says which. Owner-run with a security barrier: the row filter is the gate (2026-11-05).';

-- This migration's own result, last, in the same transaction: a wrong end state rolls everything back.
DO $check$
DECLARE r regclass;
BEGIN
  FOREACH r IN ARRAY ARRAY['public.receipts_public_summary'::regclass, 'public.vehicle_receipts_rollup_v'::regclass] LOOP
    IF NOT has_table_privilege('anon', r, 'SELECT')
       OR NOT has_table_privilege('authenticated', r, 'SELECT')
       OR has_table_privilege('anon', r, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_table_privilege('authenticated', r, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_any_column_privilege('anon', r, 'INSERT,UPDATE,REFERENCES')
       OR has_any_column_privilege('authenticated', r, 'INSERT,UPDATE,REFERENCES')
       OR NOT coalesce((SELECT 'security_barrier=true' = ANY (reloptions) FROM pg_class WHERE oid = r), false)
       OR pg_get_viewdef(r) NOT LIKE '%deleted_at%'
       OR pg_get_viewdef(r) NOT LIKE '%vehicle_user_has_access%'
       OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = r AND attname = 'amounts_visible' AND NOT attisdropped) THEN
      RAISE EXCEPTION '%: grants, options, the gate or the amounts_visible column are not the intended ones', r;
    END IF;
  END LOOP;
END
$check$;

COMMIT;
