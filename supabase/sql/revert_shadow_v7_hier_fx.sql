-- Revert shadow v7 (all additive; no hard delete of shadow rows needed).
-- Shadow rows: model_version='shadow-v7-hier-fx', run_id='7e1d0c24-2026-4a10-9e00-0000000a5014' (49,649 rows) -> ignore model_version.
-- v7 comp snapshot (new table): DROP TABLE public.shadow_sale_prices_snap_v7;
-- View fx columns: re-create latest def saved in public.shadow_view_defs_backup (see footer of shadow_sale_prices_fx_v7.sql);
--   drop view first because columns were added.
-- Bonhams first-class hammer (1,126 auction_events, backup in price_basis_backup_v2):
select revert_price_basis_run_v2('7e1d0c24-2026-4a10-9e00-0000000a5013');
update price_basis_observation set superseded_at = now() where run_id = '7e1d0c24-2026-4a10-9e00-0000000a5013' and superseded_at is null;
