-- caller controls the transaction (wrap in BEGIN ... ROLLBACK for tests); no COMMIT here
-- Revert shadow-v3-hier-fallback (run 7e1d0c24-2026-4a10-9e00-0000000a5004). Shadow-only; live nuke_estimates untouched.

delete from public.nuke_estimates_shadow where run_id='7e1d0c24-2026-4a10-9e00-0000000a5004';
delete from public.shadow_valuation_models where model_version='shadow-v3-hier-fallback';

