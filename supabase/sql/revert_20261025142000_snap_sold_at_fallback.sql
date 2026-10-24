-- caller controls the transaction (wrap in BEGIN ... ROLLBACK for tests); no COMMIT here
-- Revert 20261025142000. sold_at is never modified; these columns are new.

DROP FUNCTION IF EXISTS public.fill_snap_sold_at(text, text, uuid);
ALTER TABLE public.shadow_sale_prices_snap DROP COLUMN IF EXISTS sold_at_filled, DROP COLUMN IF EXISTS sold_at_source, DROP COLUMN IF EXISTS sold_at_run_id;

