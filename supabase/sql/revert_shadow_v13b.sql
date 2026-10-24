-- Revert shadow v13b reference rows (run-scoped), then optionally the table.
delete from public.valuation_model_family_groups where run_id = 'model_family_v13b_20261024';
-- drop table if exists public.valuation_model_family_groups;
