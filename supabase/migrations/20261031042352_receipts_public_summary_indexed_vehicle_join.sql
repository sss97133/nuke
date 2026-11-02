-- Preserve the public receipt projection, visibility, multiplicity and privileges.
-- Comparing v.id::text to scope_id forced repeated scans of vehicles. Compare
-- indexed UUID keys instead, admitting only the exact canonical text the old
-- comparison matched (not uppercase, braces, compact UUIDs or surrounding spaces).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = public;

CREATE TEMP VIEW receipt_summary_expected_before AS
SELECT r.id,r.vehicle_id,r.scope_type,r.scope_id,r.source_document_id,r.source_document_table,
  r.vendor_name,r.total,r.total_amount,r.currency,r.receipt_date,r.transaction_date,r.purchase_date,
  r.invoice_number,r.transaction_number,r.processing_status,r.status,r.created_at
FROM public.receipts r JOIN public.vehicles v
  ON v.id=r.vehicle_id OR (r.scope_type='vehicle' AND v.id::text=r.scope_id)
WHERE v.is_public=true AND v.deleted_at IS NULL;

CREATE TEMP VIEW receipt_summary_expected_after AS
SELECT r.id,r.vehicle_id,r.scope_type,r.scope_id,r.source_document_id,r.source_document_table,
  r.vendor_name,r.total,r.total_amount,r.currency,r.receipt_date,r.transaction_date,r.purchase_date,
  r.invoice_number,r.transaction_number,r.processing_status,r.status,r.created_at
FROM public.receipts r JOIN public.vehicles v
  ON v.id=r.vehicle_id OR v.id=CASE
    WHEN r.scope_type='vehicle' AND r.scope_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN r.scope_id::uuid ELSE NULL::uuid END
WHERE v.is_public=true AND v.deleted_at IS NULL;

DO $repair$
DECLARE current_definition text; before_definition text; after_definition text;
  saved_owner oid; saved_acl aclitem[]; saved_options text[];
BEGIN
  SELECT relowner,relacl,reloptions INTO STRICT saved_owner,saved_acl,saved_options
    FROM pg_class WHERE oid='public.receipts_public_summary'::regclass;
  IF EXISTS (SELECT 1 FROM pg_attribute a LEFT JOIN pg_collation c ON c.oid=a.attcollation
    WHERE a.attrelid='public.receipts'::regclass AND a.attname IN ('scope_id','scope_type')
      AND (a.atttypid<>'text'::regtype OR c.collisdeterministic IS DISTINCT FROM true)) THEN
    RAISE EXCEPTION 'Receipt scope text semantics differ from the measured deterministic text columns';
  END IF;
  IF NOT ('security_barrier=true'=ANY(saved_options)) THEN RAISE EXCEPTION 'Receipt summary security barrier differs from the measured view'; END IF;
  current_definition := regexp_replace(pg_get_viewdef('public.receipts_public_summary'::regclass,true),'[[:space:]]','','g');
  before_definition := regexp_replace(pg_get_viewdef('pg_temp.receipt_summary_expected_before'::regclass,true),'[[:space:]]','','g');
  after_definition := regexp_replace(pg_get_viewdef('pg_temp.receipt_summary_expected_after'::regclass,true),'[[:space:]]','','g');
  IF current_definition NOT IN (before_definition,after_definition) THEN
    RAISE EXCEPTION 'Receipt summary differs from the measured definition; preserve the later change';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.receipts_public_summary WITH (security_barrier=true) AS '
    || pg_get_viewdef('pg_temp.receipt_summary_expected_after'::regclass,true);
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid='public.receipts_public_summary'::regclass
    AND (relowner IS DISTINCT FROM saved_owner OR relacl IS DISTINCT FROM saved_acl OR reloptions IS DISTINCT FROM saved_options)) THEN
    RAISE EXCEPTION 'Receipt summary ownership, privileges or security options changed';
  END IF;
END $repair$;
DROP VIEW receipt_summary_expected_before,receipt_summary_expected_after;
COMMIT;
