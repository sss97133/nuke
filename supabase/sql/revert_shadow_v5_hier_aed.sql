-- Retire shadow-v5-hier-aed (shadow only, never promoted). Prefer ignoring the model_version; no hard delete.
-- Undo the snap sold-date fill that fed it (9,933 rows, run ...a5009):
UPDATE shadow_sale_prices_snap SET sold_at_filled = NULL, sold_at_source = NULL, sold_at_run_id = NULL
 WHERE sold_at_run_id = '7e1d0c24-2026-4a10-9e00-0000000a5009';
-- Shadow rows: model_version = 'shadow-v5-hier-aed', run_id = '7e1d0c24-2026-4a10-9e00-0000000a5010' (49,614 rows).
