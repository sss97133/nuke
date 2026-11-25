-- receipt_line_system_paint_v1: 'paint' becomes a receipt system key, and the flat-rate book's paint operations point
-- at it.
--
-- WHY. labor_operations holds 8 operations whose book system is 'paint' (PAINT-PREP-PANEL, PAINT-BASE-PANEL,
-- PAINT-CLEAR-PANEL, PAINT-COMPLETE-PANEL, PAINT-COMPLETE-CAB, PAINT-COMPLETE-TRUCK, PAINT-ENGINE-BAY, PAINT-JAMBS).
-- receipt_line_systems has no 'paint' row, so those 8 carry system_key NULL (labor_book_system_key_v1, 20261125080000)
-- and no receipt_line_rules row can key a line to paint, because rules.system_key needs a key row to point at.
--
-- WHAT CHANGES.
--   receipt_line_systems  + ('paint', 'Paint', expects_operation true).
--   labor_operations      system_key = 'paint', system_key_basis = 'book_system' where system = 'paint' and
--                         system_key IS NULL (8 rows live 2026-11-24). Rows keyed 14 NULL -> 6 NULL.
-- No rule row. Measured 2026-11-24 on the promotion gate's population (vehicle-linked receipt lines, not superseded,
-- duplicate, quote or excluded): 0 paint-material lines lack a system key, so a paint rule proposed today is refused
-- fills_no_line. The paint lines that exist sit on quote receipts (excluded by the gate) or are keyed engine. A rule
-- goes through receipt_line_rule_propose / receipt_line_rule_promote when the first such line lands.
-- Test: supabase/sql/test_receipt_line_system_paint.sql (PG17).
--
-- REVERT. Set the 8 rows' system_key and system_key_basis back to NULL, then delete the 'paint' key row (no rule or
-- edge points at it until one is promoted).
SET lock_timeout = '5s';
SET statement_timeout = '60s';

INSERT INTO public.receipt_line_systems (system_key, label, expects_operation)
VALUES ('paint', 'Paint', true)
ON CONFLICT (system_key) DO NOTHING;

UPDATE public.labor_operations o
   SET system_key = o.system, system_key_basis = 'book_system'
 WHERE o.system = 'paint' AND o.system_key IS NULL;
