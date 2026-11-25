-- A receipt's vendor as an organisation: one foreign key per receipt, written when the receipt lands.
--
-- Until now the only receipt -> organisation relation was organization_supply_evidence (20261020050000): a projection
-- of grain receipt x supply kind, with a polymorphic basis_id and no foreign key to receipts, rebuilt only when someone
-- ran supply_resolve_counterparties() (last 2026-11-07, by hand). Measured 2026-11-24: 123 of 255 live linked receipts
-- had a row there; 140 matched a reviewed vendor alias.
--
--   receipts.vendor_organization_id -> organizations(id) and receipts.vendor_organization_basis
--     ('supply_vendor_alias:<vendor_slug>'): resolved from the same reviewed tables the supply projection uses
--     (supply_vendor_aliases on supply_vendor_key(vendor_name) -> supply_vendors.organization_id). Nothing is fuzzy
--     matched and no organisation is created here. A person never resolves: no alias is ever written for a person.
--   receipt_vendor_organization_set (BEFORE INSERT OR UPDATE OF vendor_name or the two columns on receipts): the edge
--     exists the moment a receipt lands, from every writer (land_document_pages, auto-sort-photos, imports); a direct
--     write of the columns is replaced by the resolver's answer.
--   supply_vendor_alias_receipts_refresh (AFTER INSERT OR UPDATE OR DELETE on supply_vendor_aliases, AFTER UPDATE OF
--     organization_id on supply_vendors): a reviewed alias or an organisation resolved later reaches the receipts that
--     already carry that vendor name.
--   Backfill: 417 receipts (291 not superseded or duplicate) on 2026-11-24.
-- Vendors with no reviewed alias stay NULL and are listed by supply_counterparty_gaps(). Readers that show a supplier
-- to logged-out visitors should show the organisation (when public) instead of the printed vendor string.
-- Contract: supabase/sql/test_receipt_vendor_organization.sql (PG17).
-- Revert: supabase/sql/revert_20261124205000_receipt_vendor_organization.sql.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS vendor_organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vendor_organization_basis text;
COMMENT ON COLUMN public.receipts.vendor_organization_id IS 'The organisation the paper names as its vendor, resolved from the reviewed vendor aliases (supply_vendor_aliases -> supply_vendors.organization_id) when the receipt lands or the alias is reviewed. NULL = no reviewed alias (a person, or an unreviewed business). Never fuzzy matched.';
COMMENT ON COLUMN public.receipts.vendor_organization_basis IS 'How vendor_organization_id was resolved: supply_vendor_alias:<vendor_slug>.';
CREATE INDEX IF NOT EXISTS receipts_vendor_organization_id_idx ON public.receipts (vendor_organization_id) WHERE vendor_organization_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.receipt_vendor_organization(p_vendor text)
RETURNS TABLE (organization_id uuid, vendor_slug text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT s.organization_id, s.vendor_slug
    FROM supply_vendor_aliases a JOIN supply_vendors s ON s.vendor_slug = a.vendor_slug
   WHERE a.alias_key = supply_vendor_key(p_vendor) AND s.organization_id IS NOT NULL
   ORDER BY s.vendor_slug LIMIT 1
$$;

-- SECURITY DEFINER: signed-in uploads insert receipts, and authenticated cannot read the reviewed alias tables (RLS on,
-- no grant); without it their insert would fail. It reads only the alias register and writes only NEW's two columns.
CREATE OR REPLACE FUNCTION public.receipt_vendor_organization_set()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o record;
BEGIN
  SELECT * INTO o FROM receipt_vendor_organization(NEW.vendor_name);
  NEW.vendor_organization_id := o.organization_id;
  NEW.vendor_organization_basis := CASE WHEN o.organization_id IS NOT NULL THEN 'supply_vendor_alias:' || o.vendor_slug END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.receipt_vendor_organization(text), public.receipt_vendor_organization_set() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS receipt_vendor_organization_set ON public.receipts;
-- Also on a direct write of the two columns: they are always the resolver's answer, never a caller's.
CREATE TRIGGER receipt_vendor_organization_set BEFORE INSERT OR UPDATE OF vendor_name, vendor_organization_id, vendor_organization_basis ON public.receipts
  FOR EACH ROW EXECUTE FUNCTION public.receipt_vendor_organization_set();

-- A reviewed alias or a later-resolved organisation reaches the receipts that carry the name.
CREATE OR REPLACE FUNCTION public.supply_vendor_alias_receipts_refresh()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_keys text[];
BEGIN
  IF TG_TABLE_NAME = 'supply_vendor_aliases' THEN
    v_keys := array_remove(ARRAY[CASE WHEN TG_OP <> 'INSERT' THEN OLD.alias_key END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.alias_key END], NULL);
  ELSE
    SELECT array_agg(a.alias_key) INTO v_keys FROM supply_vendor_aliases a WHERE a.vendor_slug = NEW.vendor_slug;
  END IF;
  -- Touch the rows; receipt_vendor_organization_set computes the value.
  UPDATE receipts r SET vendor_organization_basis = r.vendor_organization_basis
   WHERE supply_vendor_key(r.vendor_name) = ANY (coalesce(v_keys, '{}'))
     AND r.vendor_organization_id IS DISTINCT FROM (SELECT o.organization_id FROM receipt_vendor_organization(r.vendor_name) o);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.supply_vendor_alias_receipts_refresh() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS supply_vendor_alias_receipts_refresh ON public.supply_vendor_aliases;
CREATE TRIGGER supply_vendor_alias_receipts_refresh AFTER INSERT OR UPDATE OR DELETE ON public.supply_vendor_aliases
  FOR EACH ROW EXECUTE FUNCTION public.supply_vendor_alias_receipts_refresh();
DROP TRIGGER IF EXISTS supply_vendor_org_receipts_refresh ON public.supply_vendors;
CREATE TRIGGER supply_vendor_org_receipts_refresh AFTER UPDATE OF organization_id ON public.supply_vendors
  FOR EACH ROW EXECUTE FUNCTION public.supply_vendor_alias_receipts_refresh();

-- Backfill: touch the receipts whose resolved organisation differs; the trigger writes the two columns.
UPDATE public.receipts r SET vendor_organization_basis = r.vendor_organization_basis
 WHERE r.vendor_organization_id IS DISTINCT FROM (SELECT o.organization_id FROM public.receipt_vendor_organization(r.vendor_name) o);

COMMIT;
