-- Retire shadow-v6-hier-firstclass (shadow only, never promoted). Prefer ignoring the model_version; no hard delete.
-- Shadow rows: model_version = 'shadow-v6-hier-firstclass', run_id = '7e1d0c24-2026-4a10-9e00-0000000a5012' (49,611 rows).
-- Undo the snap sold-date fill (458 rows: B-J 407, Mecum 51, run ...a5011):
UPDATE shadow_sale_prices_snap SET sold_at_filled = NULL, sold_at_source = NULL, sold_at_run_id = NULL
 WHERE sold_at_run_id = '7e1d0c24-2026-4a10-9e00-0000000a5011';
-- v6 comp snapshot (new table, nothing depends on it):
-- DROP TABLE public.shadow_sale_prices_snap_v6;
-- First-class view swap: see the Revert line at the end of prepared_shadow_sale_prices_first_class.sql
-- (restores the latest def saved in public.shadow_view_defs_backup).
