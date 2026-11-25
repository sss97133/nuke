-- Revert 20261124205000_receipt_vendor_organization: drop the receipt -> organisation column pair and its triggers.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DROP TRIGGER IF EXISTS receipt_vendor_organization_set ON public.receipts;
DROP TRIGGER IF EXISTS supply_vendor_alias_receipts_refresh ON public.supply_vendor_aliases;
DROP TRIGGER IF EXISTS supply_vendor_org_receipts_refresh ON public.supply_vendors;
DROP FUNCTION IF EXISTS public.receipt_vendor_organization_set();
DROP FUNCTION IF EXISTS public.supply_vendor_alias_receipts_refresh();
DROP FUNCTION IF EXISTS public.receipt_vendor_organization(text);
DROP INDEX IF EXISTS public.receipts_vendor_organization_id_idx;
ALTER TABLE public.receipts DROP COLUMN IF EXISTS vendor_organization_basis, DROP COLUMN IF EXISTS vendor_organization_id;
COMMIT;
