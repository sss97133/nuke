-- Revert shadow v9 work (all additive; nothing deleted). Live estimate never touched.
-- v9 shadow rows: model_version = 'shadow-v9-pit-gbm', run 7e1d0c24-2026-4a10-9e00-0000000a5020 -> ignore model_version, or mark it:
update shadow_valuation_models set notes = coalesce(notes,'') || ' [RETIRED]' where model_version = 'shadow-v9-pit-gbm';
-- Leakage flag (mig 20261025214500): to undo,
-- alter table public.shadow_valuation_models drop column leakage_note, drop column leakage_flag;
