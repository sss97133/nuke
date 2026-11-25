-- Revert 20261124163000_receipt_line_rules: restore the CASE bodies of 20261119200000 (copy them from that migration
-- into CREATE OR REPLACE FUNCTION statements first), then drop the rule tables. Run the restore before the drops: the
-- functions read the tables.
--   \i the receipt_line_system and receipt_line_labor_operation definitions from
--      supabase/migrations/20261119200000_vehicle_build_reconstruction.sql (lines 22-80)
DROP FUNCTION IF EXISTS public.receipt_line_rule_hit(text, text, text, text, text, int);
DROP TABLE IF EXISTS public.receipt_line_rules;
DROP FUNCTION IF EXISTS public.receipt_line_rules_check_pattern();
DROP TABLE IF EXISTS public.receipt_line_systems;
