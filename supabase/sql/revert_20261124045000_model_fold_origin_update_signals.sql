-- Revert 20261124045000_model_fold_origin_update_signals: drop the two update triggers and their function.
begin;
set local lock_timeout = '3s';
drop trigger if exists model_fold_signal_upd on public.vehicle_observations;
drop trigger if exists model_fold_signal_upd on public.field_evidence;
drop function if exists public.model_fold_origin_update_signal();
commit;
