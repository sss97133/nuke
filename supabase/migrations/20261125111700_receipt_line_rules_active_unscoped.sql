-- receipt_line_rules_active_unscoped_v1: an active system or labor_operation rule is global and reads description.
--
-- WHY. receipt_line_gaps (20261124234600) and vehicle_build_reconstruction (20261124234700) read a line's system and
-- operation from receipt_line_edges when the line is a receipt item, and from the text wrappers receipt_line_system()
-- / receipt_line_labor_operation() when it is not. The edge writer honours vendor, make and year scope and the
-- part_number field; the wrappers take text only. Both migrations refused to switch while such a rule was active,
-- but only at deploy time (ta-skeptic on #3903, 2026-11-25): a scoped rule promoted later would make the two paths
-- disagree without anything noticing. This makes it a constraint. Live 2026-11-25: active system / labor_operation
-- rules that are scoped or read part_number: 0 (of any status: 0), so nothing is refused at deploy.
-- Vendor scope (by receipts.vendor_organization_id) arrives with readers that carry the vendor; that change drops
-- or widens this constraint in the same migration.
--
-- REVERT. ALTER TABLE public.receipt_line_rules DROP CONSTRAINT receipt_line_rules_active_unscoped;
SET lock_timeout = '5s';
SET statement_timeout = '30s';

DO $c$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'receipt_line_rules_active_unscoped'
                    AND conrelid = 'public.receipt_line_rules'::regclass) THEN
    ALTER TABLE public.receipt_line_rules ADD CONSTRAINT receipt_line_rules_active_unscoped CHECK (
      status <> 'active' OR classifier NOT IN ('system', 'labor_operation')
      OR (scope_vendor_pattern IS NULL AND scope_make IS NULL AND scope_year_min IS NULL AND scope_year_max IS NULL
          AND field = 'description'));
  END IF;
END $c$;
COMMENT ON CONSTRAINT receipt_line_rules_active_unscoped ON public.receipt_line_rules IS
'An active system or labor_operation rule is unscoped and reads description, so the stored edges and the text wrappers agree for every reader (20261124234600, 20261124234700). Migration 20261125111700.';
