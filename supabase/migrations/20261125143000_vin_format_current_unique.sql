-- vin_format_current_unique_v1: one current vin_format row per make and format code.
--
-- WHY. vin_format rows (20261125103000) are read by data_set_candidates_v1 and model_fold_scope_of by make and code;
-- two current rows with the same make and code would make the format's regex and body position ambiguous. The general
-- vehicle_decode_rules_current_unique index keys on the citation URL too, so a second citation of the same format
-- could land beside the first. Live 2026-11-25: 3 current vin_format rows, no duplicates.
--
-- WHAT CHANGES. A partial unique index on (lower(make), code) for current vin_format rows. A newer row for the same
-- format supersedes the old one first (superseded_at set), as every rule row does.
-- Contract: supabase/sql/test_vin_format_current_unique.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE UNIQUE INDEX IF NOT EXISTS vehicle_decode_rules_vin_format_current
  ON public.vehicle_decode_rules (lower(make), code)
  WHERE rule_key = 'vin_format' AND superseded_at IS NULL;
